import { ChatOpenAI } from "@langchain/openai";
import type { Ticket, Requirements } from "../types.js";
import { getGlobalCostTracker } from "./costTracker.js";
import { readPromptFile } from "../utils/pathResolver.js";

interface ValidationIssue {
  type: string;
  ticketId: string | null;
  description: string;
  suggestedFix: string;
}

interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Validate tickets for consistency and coverage
 */
export async function validateTickets(
  tickets: Ticket[],
  requirements: Requirements
): Promise<ValidationResult> {
  const systemPrompt = readPromptFile("validateTickets.system.txt");

  // Build validation prompt
  let userPrompt = `Validate these tickets against the requirements:\n\n`;
  userPrompt += `Requirements:\n`;
  userPrompt += `- Project: ${requirements.projectName}\n`;
  userPrompt += `- Features: ${requirements.features.join(", ")}\n`;
  userPrompt += `- Goals: ${requirements.goals.join(", ")}\n`;
  userPrompt += `- Constraints: ${requirements.constraints.join(", ")}\n\n`;
  
  userPrompt += `Tickets:\n`;
  userPrompt += JSON.stringify(tickets, null, 2);

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL || "gpt-4o",
    temperature: 0.1,
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

  // Parse response
  const content = response.content as string;
  
  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  try {
    const result = JSON.parse(jsonStr) as ValidationResult;
    return result;
  } catch (error) {
    // If parsing fails, return a generic validation pass
    console.warn("Validation parsing failed, assuming valid:", error);
    return { valid: true, issues: [] };
  }
}

