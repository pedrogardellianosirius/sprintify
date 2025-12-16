import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { TicketSchema, type Ticket, type EditBatchResult } from "../types.js";
import { getGlobalCostTracker } from "../tools/costTracker.js";

// Configuration
const TICKETS_PER_EDIT_BATCH = 20; // Process 20 tickets at a time for edits
const MAX_OUTPUT_TOKENS = 4096;

// Schema for LLM edit response
const EditResponseSchema = z.object({
  toRemove: z.array(z.string()),
  toAddOrUpdate: z.array(TicketSchema),
});

/**
 * Options for batched edit operation
 */
export interface BatchedEditOptions {
  instruction: string;
  tickets: Ticket[];
  onBatchProgress?: (result: EditBatchResult) => void;
}

/**
 * Result of batched edit operation
 */
export interface BatchedEditResult {
  updatedTickets: Ticket[];
  results: EditBatchResult[];
  hasErrors: boolean;
}

/**
 * Keywords that indicate a bulk operation affecting all/many tickets
 */
const BULK_OPERATION_KEYWORDS = [
  "all tickets",
  "every ticket",
  "each ticket",
  "all of the tickets",
  "update all",
  "change all",
  "modify all",
  "add to all",
  "remove from all",
  "set all",
  "bulk",
  "across all",
  "for all",
  "to every",
  "on every",
  "all priorities",
  "all labels",
  "all acceptance criteria",
];

/**
 * Detect if an instruction is a bulk operation that affects all/many tickets
 */
function detectBulkOperation(instruction: string): boolean {
  const lower = instruction.toLowerCase();
  return BULK_OPERATION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Apply changes from a batch result to the ticket list
 */
function applyBatchChanges(tickets: Ticket[], result: EditBatchResult): Ticket[] {
  if (!result.success) return tickets;

  // Remove tickets marked for removal
  let updated = tickets.filter(
    (t) => !result.appliedChanges.removed.includes(t.id)
  );

  // Add or update tickets
  for (const newTicket of result.appliedChanges.addedOrUpdated) {
    const existingIdx = updated.findIndex((t) => t.id === newTicket.id);
    if (existingIdx >= 0) {
      // Update existing ticket
      updated[existingIdx] = newTicket;
    } else {
      // Add new ticket
      updated.push(newTicket);
    }
  }

  return updated;
}

/**
 * Process a single batch of tickets for editing
 */
async function processBatchEdit(
  instruction: string,
  batchTickets: Ticket[],
  batchIndex: number,
  allTickets: Ticket[]
): Promise<EditBatchResult> {
  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL || "gpt-4o",
    temperature: 0.2,
    maxTokens: MAX_OUTPUT_TOKENS,
    modelKwargs: {
      response_format: { type: "json_object" },
    },
  });

  const systemPrompt = `You are a ticket editor. Apply the given instruction to the tickets in this batch.

Return a JSON object with the following structure:
{
  "toRemove": ["id1", "id2"],  // IDs of tickets to remove (for split/merge operations)
  "toAddOrUpdate": [...]        // Full ticket objects that are new or modified
}

IMPORTANT RULES:
- Only process tickets from THIS BATCH
- If the instruction doesn't apply to a ticket in this batch, don't include it in the response
- For "split" operations: add the original ticket ID to toRemove, add new tickets to toAddOrUpdate
- For "merge" operations: add both original IDs to toRemove, add merged ticket to toAddOrUpdate
- For modifications: only include the ticket in toAddOrUpdate with ALL fields preserved
- Every ticket must have: id, title, description, acceptanceCriteria (array), effortPoints (1,2,3,5,8,13), useCase, priority (P1/P2/P3), labels (array), dependencies (array)
- Preserve existing field values unless the instruction specifically changes them`;

  // Create a summary of other tickets for context (not in this batch)
  const otherTicketsSummary = allTickets
    .filter((t) => !batchTickets.find((bt) => bt.id === t.id))
    .map((t) => ({ id: t.id, title: t.title, priority: t.priority }));

  const userPrompt = `
INSTRUCTION: ${instruction}

BATCH TICKETS TO PROCESS (${batchTickets.length} tickets):
${JSON.stringify(batchTickets, null, 2)}

OTHER TICKETS IN PROJECT (for reference only, do not modify):
${JSON.stringify(otherTicketsSummary, null, 2)}
`;

  try {
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    // Track costs
    const tracker = getGlobalCostTracker();
    if (response.usage_metadata) {
      tracker.track(
        response.usage_metadata.input_tokens || 0,
        response.usage_metadata.output_tokens || 0
      );
    }

    // Parse response
    const content = response.content as string;
    let jsonStr = content;

    // Handle markdown-wrapped JSON
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr);
    const validated = EditResponseSchema.safeParse(parsed);

    if (!validated.success) {
      return {
        success: false,
        batchIndex,
        appliedChanges: { removed: [], addedOrUpdated: [] },
        errors: [
          {
            message: `Validation failed: ${validated.error.message}`,
            instruction,
          },
        ],
      };
    }

    return {
      success: true,
      batchIndex,
      appliedChanges: {
        removed: validated.data.toRemove,
        addedOrUpdated: validated.data.toAddOrUpdate,
      },
      errors: [],
    };
  } catch (error) {
    return {
      success: false,
      batchIndex,
      appliedChanges: { removed: [], addedOrUpdated: [] },
      errors: [
        {
          message: error instanceof Error ? error.message : "Unknown error",
          instruction,
        },
      ],
    };
  }
}

/**
 * Process a single-batch edit (for small ticket sets or targeted edits)
 */
async function singleBatchEdit(
  instruction: string,
  tickets: Ticket[]
): Promise<BatchedEditResult> {
  const result = await processBatchEdit(instruction, tickets, 0, tickets);
  const updatedTickets = applyBatchChanges(tickets, result);

  return {
    updatedTickets,
    results: [result],
    hasErrors: !result.success,
  };
}

/**
 * Edit tickets in batches with best-effort error handling.
 *
 * For bulk operations (detected via keywords like "all tickets"), tickets are
 * processed in batches of TICKETS_PER_EDIT_BATCH. Each batch is processed
 * independently, and successful changes are applied even if some batches fail.
 *
 * For targeted operations (specific ticket IDs), uses single-batch processing.
 */
export async function batchedEditTickets(
  options: BatchedEditOptions
): Promise<BatchedEditResult> {
  const { instruction, tickets, onBatchProgress } = options;

  // Determine if this is a bulk operation
  const isBulkOperation = detectBulkOperation(instruction);

  // For small sets or targeted edits, use single-batch processing
  if (!isBulkOperation && tickets.length <= TICKETS_PER_EDIT_BATCH) {
    console.log(`   📝 Processing ${tickets.length} ticket(s) in single batch...`);
    return singleBatchEdit(instruction, tickets);
  }

  // For bulk operations or large ticket sets, use batched processing
  const totalBatches = Math.ceil(tickets.length / TICKETS_PER_EDIT_BATCH);
  const results: EditBatchResult[] = [];
  let currentTickets = [...tickets];
  let hasErrors = false;

  console.log(
    `   📝 Processing ${tickets.length} ticket(s) in ${totalBatches} batch(es)...`
  );

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIdx = batchIndex * TICKETS_PER_EDIT_BATCH;
    const endIdx = Math.min(startIdx + TICKETS_PER_EDIT_BATCH, tickets.length);
    const batchTickets = tickets.slice(startIdx, endIdx);

    console.log(
      `   📝 Edit batch ${batchIndex + 1}/${totalBatches}: Processing tickets ${startIdx + 1}-${endIdx}...`
    );

    try {
      const batchResult = await processBatchEdit(
        instruction,
        batchTickets,
        batchIndex,
        currentTickets
      );

      results.push(batchResult);

      if (!batchResult.success) {
        hasErrors = true;
        console.warn(
          `   ⚠️ Batch ${batchIndex + 1}/${totalBatches} had errors:`,
          batchResult.errors.map((e) => e.message).join(", ")
        );
      } else {
        // Apply successful changes to currentTickets
        currentTickets = applyBatchChanges(currentTickets, batchResult);

        const changeCount =
          batchResult.appliedChanges.removed.length +
          batchResult.appliedChanges.addedOrUpdated.length;
        console.log(
          `   ✅ Batch ${batchIndex + 1}/${totalBatches}: Applied ${changeCount} change(s)`
        );
      }

      // Notify progress callback
      if (onBatchProgress) {
        onBatchProgress(batchResult);
      }
    } catch (error) {
      // Record batch-level failure, continue with next batch (best-effort)
      const errorResult: EditBatchResult = {
        success: false,
        batchIndex,
        appliedChanges: { removed: [], addedOrUpdated: [] },
        errors: [
          {
            message: error instanceof Error ? error.message : "Unknown error",
            instruction,
          },
        ],
      };

      results.push(errorResult);
      hasErrors = true;

      console.error(
        `   ❌ Batch ${batchIndex + 1}/${totalBatches} failed:`,
        error instanceof Error ? error.message : error
      );

      if (onBatchProgress) {
        onBatchProgress(errorResult);
      }
    }
  }

  // Summary
  const successfulBatches = results.filter((r) => r.success).length;
  console.log(
    `   📊 Edit complete: ${successfulBatches}/${totalBatches} batches successful`
  );

  return {
    updatedTickets: currentTickets,
    results,
    hasErrors,
  };
}

/**
 * Get a summary of edit results for logging/display
 */
export function summarizeEditResults(results: EditBatchResult[]): {
  totalBatches: number;
  successfulBatches: number;
  totalRemoved: number;
  totalAddedOrUpdated: number;
  errors: string[];
} {
  const totalBatches = results.length;
  const successfulBatches = results.filter((r) => r.success).length;
  const totalRemoved = results.reduce(
    (sum, r) => sum + r.appliedChanges.removed.length,
    0
  );
  const totalAddedOrUpdated = results.reduce(
    (sum, r) => sum + r.appliedChanges.addedOrUpdated.length,
    0
  );
  const errors = results.flatMap((r) => r.errors.map((e) => e.message));

  return {
    totalBatches,
    successfulBatches,
    totalRemoved,
    totalAddedOrUpdated,
    errors,
  };
}
