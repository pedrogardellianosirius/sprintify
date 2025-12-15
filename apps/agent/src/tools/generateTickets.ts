import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { TicketSchema, type Ticket, type Requirements } from "../types.js";
import { getGlobalCostTracker } from "./costTracker.js";
import { readPromptFile } from "../utils/pathResolver.js";

const GenerateTicketsResponseSchema = z.object({
  tickets: z.array(TicketSchema),
});

/**
 * Generate development tickets from requirements (for a subset of features)
 */
export async function generateTicketsForFeatures(
  requirements: Requirements,
  features: string[],
  batchNumber: number,
  totalBatches: number,
  answers?: Record<string, string>
): Promise<{ tickets: Ticket[] }> {
  const systemPrompt = readPromptFile("generateTickets.system.txt");

  // Build user prompt with requirements and optional answers
  let userPrompt = `Generate development tickets for BATCH ${batchNumber} of ${totalBatches} of this project.\n\n`;
  userPrompt += `Project: ${requirements.projectName}\n`;
  userPrompt += `Summary: ${requirements.summary}\n\n`;
  userPrompt += `Overall Goals:\n${requirements.goals.map(g => `- ${g}`).join("\n")}\n\n`;
  userPrompt += `Constraints:\n${requirements.constraints.map(c => `- ${c}`).join("\n")}\n\n`;
  userPrompt += `\n${"=".repeat(80)}\n`;
  userPrompt += `FEATURES FOR THIS BATCH (${features.length} features):\n`;
  userPrompt += `${features.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n`;
  userPrompt += `${"=".repeat(80)}\n\n`;
  userPrompt += `Stakeholders:\n${requirements.stakeholders.map(s => `- ${s}`).join("\n")}\n\n`;

  if (requirements.techHints && requirements.techHints.length > 0) {
    userPrompt += `Tech Hints:\n${requirements.techHints.map(t => `- ${t}`).join("\n")}\n\n`;
  }

  if (requirements.scope) {
    userPrompt += `Scope: ${requirements.scope}\n\n`;
  }

  if (answers && Object.keys(answers).length > 0) {
    userPrompt += `Additional Clarifications:\n`;
    Object.entries(answers).forEach(([question, answer]) => {
      userPrompt += `Q: ${question}\nA: ${answer}\n\n`;
    });
  }

  // Calculate expected minimum tickets for this batch
  const minExpectedTickets = Math.max(features.length * 3, 5);
  const maxExpectedTickets = features.length * 6;
  
  userPrompt += `\n${"=".repeat(80)}\n`;
  userPrompt += `CRITICAL INSTRUCTIONS FOR THIS BATCH:\n`;
  userPrompt += `- You are processing ${features.length} features in this batch (batch ${batchNumber}/${totalBatches})\n`;
  userPrompt += `- Generate AT LEAST ${minExpectedTickets} tickets for these ${features.length} features\n`;
  userPrompt += `- Aim for ${maxExpectedTickets}+ tickets for comprehensive coverage\n`;
  userPrompt += `- Break EACH feature into multiple tickets (backend, frontend, testing, etc.)\n`;
  if (batchNumber === 1) {
    userPrompt += `- Include initial setup/infrastructure tickets (this is the first batch)\n`;
  }
  userPrompt += `- Include testing tickets (unit, integration, e2e) for these features\n`;
  userPrompt += `- Include security and performance tickets where relevant\n`;
  userPrompt += `- NO feature should result in just 1 ticket\n`;
  userPrompt += `- Use ticket IDs like TICKET-${String(batchNumber).padStart(2, '0')}01, TICKET-${String(batchNumber).padStart(2, '0')}02, etc.\n`;
  userPrompt += `- More tickets = better granularity = better project management\n`;
  userPrompt += `${"=".repeat(80)}\n`;

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL || "gpt-4-turbo-preview",
    temperature: 0.3,
    maxTokens: 4096, // Maximum allowed by the model
  });

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

  // Parse and validate response
  const content = response.content as string;
  
  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return GenerateTicketsResponseSchema.parse(parsed);
  } catch (error) {
    throw new Error(`Failed to parse tickets: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Generate development tickets from requirements (dividing into batches for large projects)
 */
export async function generateTickets(
  requirements: Requirements,
  answers?: Record<string, string>,
  onProgress?: (batchInfo: { batch: number; total: number; tickets: Ticket[] }) => void
): Promise<{ tickets: Ticket[] }> {
  const FEATURES_PER_BATCH = 3; // Process 3 features at a time for optimal results
  
  const totalFeatures = requirements.features.length;
  const totalBatches = Math.ceil(totalFeatures / FEATURES_PER_BATCH);
  
  let allTickets: Ticket[] = [];

  console.log(`📦 Processing ${totalFeatures} features in ${totalBatches} batch(es)...`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchNumber = batchIndex + 1;
    const startIdx = batchIndex * FEATURES_PER_BATCH;
    const endIdx = Math.min(startIdx + FEATURES_PER_BATCH, totalFeatures);
    const batchFeatures = requirements.features.slice(startIdx, endIdx);

    console.log(`   📦 Batch ${batchNumber}/${totalBatches}: Processing features ${startIdx + 1}-${endIdx}...`);

    try {
      const result = await generateTicketsForFeatures(
        requirements,
        batchFeatures,
        batchNumber,
        totalBatches,
        answers
      );

      allTickets = allTickets.concat(result.tickets);

      console.log(`   ✅ Batch ${batchNumber}/${totalBatches}: Generated ${result.tickets.length} tickets`);

      // Call progress callback if provided
      if (onProgress) {
        onProgress({
          batch: batchNumber,
          total: totalBatches,
          tickets: result.tickets
        });
      }

    } catch (error) {
      console.error(`   ❌ Batch ${batchNumber}/${totalBatches} failed:`, error);
      throw error;
    }
  }

  console.log(`🎉 Total tickets generated: ${allTickets.length}`);

  return {
    tickets: allTickets
  };
}

