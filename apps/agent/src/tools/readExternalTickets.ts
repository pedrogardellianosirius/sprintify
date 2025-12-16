import type { ExternalTicket, IntegrationConfig } from "../integrations/types.js";
import { loadIntegrationConfig } from "./integrationConfig.js";
import { readJiraIssues } from "../integrations/jiraClient.js";
import { readLinearIssues } from "../integrations/linearClient.js";

/**
 * Read existing tickets from external integration (Jira/Linear)
 */
export async function readExternalTickets(
  projectIdOrConfig: string | IntegrationConfig
): Promise<ExternalTicket[]> {
  let config: IntegrationConfig | null;
  
  if (typeof projectIdOrConfig === 'string') {
    // Legacy: projectId provided
    config = await loadIntegrationConfig(projectIdOrConfig);
  } else {
    // New: config provided directly
    config = projectIdOrConfig;
  }

  if (!config) {
    return [];
  }

  try {
    if (config.type === "jira") {
      const projectKey = config.projectMapping.externalProjectKey;
      // TypeScript needs explicit type narrowing for union types
      if (config.credentials && 'email' in config.credentials) {
        return await readJiraIssues(config.credentials, projectKey);
      }
    } else if (config.type === "linear") {
      const teamId =
        config.projectMapping.teamId || config.projectMapping.externalProjectKey;
      const projectId = config.projectMapping.projectId;
      // TypeScript needs explicit type narrowing for union types
      if (config.credentials && 'apiKey' in config.credentials) {
        return await readLinearIssues(config.credentials, teamId, projectId);
      }
    }
  } catch (error) {
    // Log error but don't fail - this is optional context
    const identifier = typeof projectIdOrConfig === 'string' 
      ? projectIdOrConfig 
      : `${config.type} (${config.projectMapping.externalProjectKey})`;
    console.warn(
      `Failed to read external tickets for ${identifier}:`,
      error instanceof Error ? error.message : "Unknown error"
    );
    return [];
  }

  return [];
}

/**
 * Format external tickets as context string for LLM
 */
export function formatExternalTicketsAsContext(
  tickets: ExternalTicket[]
): string {
  if (tickets.length === 0) {
    return "";
  }

  let context = `\n${"=".repeat(80)}\n`;
  context += `EXISTING TICKETS FROM EXTERNAL PROJECT MANAGEMENT TOOL (${tickets.length} tickets):\n`;
  context += `${"=".repeat(80)}\n\n`;

  tickets.forEach((ticket, index) => {
    context += `${index + 1}. [${ticket.id}] ${ticket.title}\n`;
    if (ticket.description) {
      context += `   Description: ${ticket.description.substring(0, 200)}${ticket.description.length > 200 ? "..." : ""}\n`;
    }
    if (ticket.status) {
      context += `   Status: ${ticket.status}\n`;
    }
    if (ticket.priority) {
      context += `   Priority: ${ticket.priority}\n`;
    }
    if (ticket.labels && ticket.labels.length > 0) {
      context += `   Labels: ${ticket.labels.join(", ")}\n`;
    }
    context += `\n`;
  });

  context += `${"=".repeat(80)}\n`;
  context += `IMPORTANT: When generating new tickets, avoid duplicating the above existing tickets.\n`;
  context += `If a new ticket depends on an existing one, reference it by its ID (e.g., ${tickets[0]?.id || "EXISTING-ID"}).\n`;
  context += `${"=".repeat(80)}\n\n`;

  return context;
}
