import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { buildGraph } from "./graph.js";
import { parseDocument } from "./tools/parseDocument.js";
import { loadProject, persistProject } from "./tools/persistProject.js";
import { initCostTracker, getGlobalCostTracker } from "./tools/costTracker.js";
import { ChatOpenAI } from "@langchain/openai";
import type { ProjectState, ParseDocumentInput, GraphState } from "./types.js";
import { TicketSchema } from "./types.js";

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
  initCostTracker(process.env.OPENAI_MODEL || "gpt-4-turbo-preview");

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
 * Edit tickets based on natural language instruction
 */
export async function editTickets(
  projectId: string,
  instruction: string
): Promise<ProjectState> {
  const existingState = await loadProject(projectId);
  if (!existingState) {
    throw new Error(`Project ${projectId} not found`);
  }

  initCostTracker(process.env.OPENAI_MODEL || "gpt-4-turbo-preview");

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL || "gpt-4-turbo-preview",
    temperature: 0.2,
    modelKwargs: {
      response_format: { type: "json_object" }
    }
  });

  // Step 1: Ask LLM to identify which tickets to modify and provide the changes
  const systemPrompt = `You are a ticket editor. Given a list of tickets and a user instruction, identify which tickets need to be modified and provide ONLY those modified tickets.

Possible instructions include:
- "Split ticket X into Y and Z" - Remove X, add Y and Z
- "Merge tickets X and Y" - Remove X and Y, add merged ticket
- "Add acceptance criteria to ticket X" - Modify X
- "Increase detail on ticket X" - Modify X
- "Change priority of ticket X to P1" - Modify X
- "Add dependency from X to Y" - Modify Y

Return a JSON object with:
{
  "toRemove": ["id1", "id2"],  // IDs of tickets to remove
  "toAddOrUpdate": [...]  // New or modified tickets (full ticket objects)
}

If splitting or merging, include new tickets in toAddOrUpdate. Each ticket must have: id, title, description, acceptanceCriteria (array), effortPoints (number: 1,2,3,5,8,13), useCase, priority (P1/P2/P3), labels (array), dependencies (array).`;

  // Only send a summary of tickets to reduce token count
  const ticketSummary = existingState.tickets.map(t => ({
    id: t.id,
    title: t.title,
    priority: t.priority
  }));

  const userPrompt = `Ticket summary:\n${JSON.stringify(ticketSummary, null, 2)}\n\nFull tickets (for reference):\n${JSON.stringify(existingState.tickets, null, 2)}\n\nInstruction: ${instruction}`;

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  const tracker = getGlobalCostTracker();
  if (response.usage_metadata) {
    tracker.track(
      response.usage_metadata.input_tokens || 0,
      response.usage_metadata.output_tokens || 0
    );
  }

  // Parse and validate response
  const content = response.content as string;
  let parsed;
  
  try {
    parsed = JSON.parse(content);
  } catch (parseError) {
    console.error("JSON parse error:", parseError);
    console.error("Content:", content.substring(0, 500));
    throw new Error(`Failed to parse JSON response. Please try a simpler edit instruction.`);
  }
  
  // Validate with Zod
  const editSchema = z.object({
    toRemove: z.array(z.string()),
    toAddOrUpdate: z.array(TicketSchema)
  });

  const validationResult = editSchema.safeParse(parsed);

  if (!validationResult.success) {
    console.error("Validation error:", validationResult.error);
    throw new Error(`Invalid response format. Please try a simpler edit instruction.`);
  }

  // Apply changes
  const { toRemove, toAddOrUpdate } = validationResult.data;
  
  // Start with existing tickets, removing the ones to delete
  let updatedTickets = existingState.tickets.filter(t => !toRemove.includes(t.id));
  
  // Update or add tickets
  for (const newTicket of toAddOrUpdate) {
    const existingIndex = updatedTickets.findIndex(t => t.id === newTicket.id);
    if (existingIndex >= 0) {
      // Update existing ticket
      updatedTickets[existingIndex] = newTicket;
    } else {
      // Add new ticket
      updatedTickets.push(newTicket);
    }
  }

  const additionalCost = tracker.getCost();

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

  await persistProject(updatedState);
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

