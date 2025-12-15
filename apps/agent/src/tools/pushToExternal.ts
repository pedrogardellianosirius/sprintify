import type { Ticket } from "../types.js";
import type { PushResult } from "../integrations/types.js";
import { loadProject } from "./persistProject.js";
import { loadIntegrationConfig } from "./integrationConfig.js";
import { createJiraIssue } from "../integrations/jiraClient.js";
import { createLinearIssue } from "../integrations/linearClient.js";
import { persistProject } from "./persistProject.js";

/**
 * Push tickets to external integration (Jira/Linear)
 */
export async function pushTicketsToExternal(
  projectId: string,
  ticketIds?: string[]
): Promise<PushResult> {
  // Load project state
  const projectState = await loadProject(projectId);
  if (!projectState) {
    throw new Error(`Project ${projectId} not found`);
  }

  // Load integration config
  const config = await loadIntegrationConfig(projectId);
  if (!config) {
    throw new Error(`No integration configured for project ${projectId}`);
  }

  // Filter tickets if specific IDs provided
  let ticketsToPush: Ticket[] = projectState.tickets;
  if (ticketIds && ticketIds.length > 0) {
    ticketsToPush = projectState.tickets.filter((t) =>
      ticketIds.includes(t.id)
    );
  }

  const results: Array<{
    ticketId: string;
    externalKey?: string;
    error?: string;
  }> = [];

  // Initialize external mappings if not present
  const externalMappings: Record<string, string> =
    (projectState as { externalMappings?: Record<string, string> })
      .externalMappings || {};

  // Push each ticket
  for (const ticket of ticketsToPush) {
    // Skip if already pushed
    if (externalMappings[ticket.id]) {
      results.push({
        ticketId: ticket.id,
        externalKey: externalMappings[ticket.id],
      });
      continue;
    }

    try {
      let externalKey: string;

      if (config.type === "jira") {
        const projectKey = config.projectMapping.externalProjectKey;
        // TypeScript needs explicit type narrowing for union types
        if (config.credentials && 'email' in config.credentials) {
          externalKey = await createJiraIssue(
            config.credentials,
            projectKey,
            ticket
          );
        } else {
          throw new Error("Invalid Jira credentials");
        }
      } else if (config.type === "linear") {
        const teamId =
          config.projectMapping.teamId ||
          config.projectMapping.externalProjectKey;
        const projectId = config.projectMapping.projectId || null;
        // TypeScript needs explicit type narrowing for union types
        if (config.credentials && 'apiKey' in config.credentials) {
          externalKey = await createLinearIssue(
            config.credentials,
            teamId,
            projectId,
            ticket
          );
        } else {
          throw new Error("Invalid Linear credentials");
        }
      } else {
        throw new Error(`Unsupported integration type: ${config.type}`);
      }

      // Store mapping
      externalMappings[ticket.id] = externalKey;

      results.push({
        ticketId: ticket.id,
        externalKey,
      });
    } catch (error) {
      results.push({
        ticketId: ticket.id,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  }

  // Update project state with mappings
  const updatedProjectState = {
    ...projectState,
    externalMappings,
  };
  await persistProject(updatedProjectState);

  const success = results.every((r) => !r.error);

  return {
    success,
    results,
  };
}
