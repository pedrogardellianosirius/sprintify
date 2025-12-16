import { v4 as uuidv4 } from "uuid";
import { buildGraph } from "./graph.js";
import { parseDocument } from "./tools/parseDocument.js";
import { loadProject, persistProject } from "./tools/persistProject.js";
import { initCostTracker, getGlobalCostTracker } from "./tools/costTracker.js";
import { batchedEditTickets, summarizeEditResults } from "./services/batchedEditService.js";
import type { ProjectState, ParseDocumentInput, GraphState, EditBatchResult } from "./types.js";

export type StreamEvent = {
  type: 'status' | 'progress' | 'error' | 'complete';
  message: string;
  data?: any;
};

export type StreamCallback = (event: StreamEvent) => void;

/**
 * Run the agent workflow
 */
export async function runAgent(input: {
  file?: { buffer: Buffer; mime: string };
  text?: string;
  projectId?: string;
  onStream?: StreamCallback;
}): Promise<ProjectState> {
  // Initialize cost tracker
  initCostTracker(process.env.OPENAI_MODEL || "gpt-4o");

  // Stream parsing status
  input.onStream?.({ type: 'status', message: '📄 Parsing document...' });

  // Parse document first
  const parseInput: ParseDocumentInput = {
    fileBuffer: input.file?.buffer,
    mime: input.file?.mime,
    pastedText: input.text,
  };

  const rawText = await parseDocument(parseInput);

  // Build initial state
  const initialState: GraphState = {
    projectId: input.projectId,
    rawText,
    tickets: [],
    cost: { tokensIn: 0, tokensOut: 0, usd: 0 },
  };

  // Run the graph with streaming
  const graph = buildGraph(input.onStream);
  const result = await graph.invoke(initialState);

  if (result.error) {
    throw new Error(result.error);
  }

  // Get final cost
  const tracker = getGlobalCostTracker();
  const cost = tracker.getCost();

  // Build and return project state
  const projectState: ProjectState = {
    id: result.projectId || uuidv4(),
    rawText: result.rawText,
    requirements: result.requirements!,
    tickets: result.tickets,
    cost,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Send completion event
  input.onStream?.({ 
    type: 'complete', 
    message: '✨ Tickets generated successfully!',
    data: projectState
  });

  return projectState;
}

/**
 * Edit tickets based on natural language instruction.
 *
 * Supports both targeted edits (e.g., "split ticket 3") and bulk operations
 * (e.g., "add security criteria to all tickets"). Bulk operations are processed
 * in batches with best-effort error handling.
 *
 * @param projectId - The project ID to edit
 * @param instruction - Natural language instruction for the edit
 * @param onProgress - Optional callback for batch progress updates
 * @returns Updated project state
 */
export async function editTickets(
  projectId: string,
  instruction: string,
  onProgress?: (result: EditBatchResult) => void
): Promise<ProjectState> {
  const existingState = await loadProject(projectId);
  if (!existingState) {
    throw new Error(`Project ${projectId} not found`);
  }

  console.log(`📝 Editing tickets for project ${projectId}...`);
  console.log(`   Instruction: "${instruction}"`);
  console.log(`   Total tickets: ${existingState.tickets.length}`);

  initCostTracker(process.env.OPENAI_MODEL || "gpt-4o");

  // Use batched edit service for robust handling of large edits
  const { updatedTickets, results, hasErrors } = await batchedEditTickets({
    instruction,
    tickets: existingState.tickets,
    onBatchProgress: onProgress,
  });

  // Get cost from tracker
  const tracker = getGlobalCostTracker();
  const additionalCost = tracker.getCost();

  // Build updated state
  const updatedState: ProjectState = {
    ...existingState,
    tickets: updatedTickets,
    cost: {
      tokensIn: existingState.cost.tokensIn + additionalCost.tokensIn,
      tokensOut: existingState.cost.tokensOut + additionalCost.tokensOut,
      usd: existingState.cost.usd + additionalCost.usd,
    },
    updatedAt: new Date().toISOString(),
  };

  // Persist the updated state
  await persistProject(updatedState);

  // Log summary
  const summary = summarizeEditResults(results);
  console.log(`📊 Edit summary:`);
  console.log(`   Batches: ${summary.successfulBatches}/${summary.totalBatches} successful`);
  console.log(`   Removed: ${summary.totalRemoved} ticket(s)`);
  console.log(`   Added/Updated: ${summary.totalAddedOrUpdated} ticket(s)`);

  if (hasErrors) {
    console.warn(`   ⚠️ Some batches had errors:`, summary.errors.join("; "));
  }

  return updatedState;
}

// Export types and tools
export * from "./types.js";
export { loadProject } from "./tools/persistProject.js";
export {
  saveIntegrationConfig,
  loadIntegrationConfig,
  deleteIntegrationConfig,
} from "./tools/integrationConfig.js";
export { pushTicketsToExternal } from "./tools/pushToExternal.js";
export { readJiraIssues } from "./integrations/jiraClient.js";
export { readLinearIssues } from "./integrations/linearClient.js";
export * from "./integrations/types.js";

// Export new services
export { getEmbeddingService } from "./services/embeddingService.js";
export { batchedEditTickets, summarizeEditResults } from "./services/batchedEditService.js";

