import { LinearClient } from "@linear/sdk";
import type { Ticket } from "../types.js";
import type { ExternalTicket, LinearCredentials } from "./types.js";

/**
 * Create a Linear API client
 */
export function createLinearClient(apiKey: string): LinearClient {
  return new LinearClient({ apiKey });
}

/**
 * Check if a string is a valid UUID
 */
function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Resolve a team identifier (UUID, key, or name) to a team ID
 */
async function resolveTeamId(
  client: LinearClient,
  teamIdentifier: string
): Promise<string> {
  // If it's already a UUID, return it
  if (isUUID(teamIdentifier)) {
    try {
      const team = await client.team(teamIdentifier);
      if (team) {
        return teamIdentifier;
      }
    } catch {
      // Team not found by ID, continue to try by key/name
    }
  }

  // Try to find team by key or name
  const teamsResponse = await client.teams();
  const teams = teamsResponse.nodes || [];

  // First try to find by key (case-insensitive)
  const teamByKey = teams.find(
    (team) => team.key?.toLowerCase() === teamIdentifier.toLowerCase()
  );
  if (teamByKey) {
    return teamByKey.id;
  }

  // Then try to find by name (case-insensitive)
  const teamByName = teams.find(
    (team) => team.name?.toLowerCase() === teamIdentifier.toLowerCase()
  );
  if (teamByName) {
    return teamByName.id;
  }

  throw new Error(
    `Team not found: "${teamIdentifier}". Please provide a valid team ID (UUID), team key, or team name.`
  );
}

/**
 * Read Linear issues from a team/project
 */
export async function readLinearIssues(
  credentials: LinearCredentials,
  teamId: string,
  projectId?: string
): Promise<ExternalTicket[]> {
  const client = createLinearClient(credentials.apiKey);

  try {
    // Resolve team identifier to actual team ID
    const resolvedTeamId = await resolveTeamId(client, teamId);

    const issuesResponse = await client.issues({
      filter: {
        team: { id: { eq: resolvedTeamId } },
        ...(projectId && { project: { id: { eq: projectId } } }),
      },
      first: 100,
    });

    const issues = issuesResponse.nodes || [];

    // Process issues and await LinearFetch objects
    const externalTickets: ExternalTicket[] = [];
    for (const issue of issues) {
      const state = issue.state ? await issue.state : null;
      const assignee = issue.assignee ? await issue.assignee : null;
      // Labels is a function that returns a connection, need to call it first
      const labelsResponse = issue.labels ? await issue.labels() : null;
      const labels = labelsResponse?.nodes || [];

      externalTickets.push({
        id: issue.id,
        title: issue.title,
        description: issue.description || "",
        status: state?.name || undefined,
        priority: issue.priorityLabel || undefined,
        labels: labels.map((label: { name: string }) => label.name),
        assignee: assignee?.name || undefined,
        createdAt: issue.createdAt instanceof Date 
          ? issue.createdAt.toISOString() 
          : typeof issue.createdAt === 'string' 
            ? issue.createdAt 
            : undefined,
        updatedAt: issue.updatedAt instanceof Date 
          ? issue.updatedAt.toISOString() 
          : typeof issue.updatedAt === 'string' 
            ? issue.updatedAt 
            : undefined,
        url: issue.url,
      });
    }

    return externalTickets;
  } catch (error) {
    throw new Error(
      `Failed to read Linear issues: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Map Sprintify ticket to Linear issue input
 */
export function mapTicketToLinear(ticket: Ticket): {
  teamId: string;
  title: string;
  description: string;
  priority?: number;
  labelIds?: string[];
  projectId?: string | null;
  estimate?: number;
} {
  // Map priority (Linear uses 0-4, where 0 is no priority, 1-4 are Urgent, High, Medium, Low)
  let priority: number | undefined;
  if (ticket.priority === "P1") {
    priority = 1; // Urgent
  } else if (ticket.priority === "P2") {
    priority = 2; // High
  } else if (ticket.priority === "P3") {
    priority = 3; // Medium
  }

  // Format description with acceptance criteria
  let description = ticket.description || "";
  if (ticket.acceptanceCriteria && ticket.acceptanceCriteria.length > 0) {
    description += "\n\n**Acceptance Criteria:**\n";
    ticket.acceptanceCriteria.forEach((criteria) => {
      description += `- ${criteria}\n`;
    });
  }

  return {
    teamId: "", // Will be set by caller
    title: ticket.title,
    description,
    ...(priority !== undefined && { priority }),
    // Note: Labels need to be created/fetched first to get IDs
    // For now, we'll skip labels as they require additional API calls
    ...(ticket.effortPoints && { estimate: ticket.effortPoints }),
  };
}

/**
 * Create a Linear issue from a Sprintify ticket
 */
export async function createLinearIssue(
  credentials: LinearCredentials,
  teamId: string,
  projectId: string | null,
  ticket: Ticket
): Promise<string> {
  const client = createLinearClient(credentials.apiKey);

  const issueInput = mapTicketToLinear(ticket);
  
  // Resolve team identifier to actual team ID
  const resolvedTeamId = await resolveTeamId(client, teamId);
  issueInput.teamId = resolvedTeamId;
  issueInput.projectId = projectId;

  try {
    // Verify team exists (already resolved, but double-check)
    const team = await client.team(resolvedTeamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    // Create issue - Linear will use default state if stateId is not provided
    const result = await client.createIssue({
      teamId: resolvedTeamId,
      title: issueInput.title,
      description: issueInput.description,
      priority: issueInput.priority,
      estimate: issueInput.estimate,
      projectId: issueInput.projectId || undefined,
      // stateId is optional - Linear will use the default state for the team
    });

    if (!result.success || !result.issue) {
      throw new Error("Failed to create Linear issue");
    }

    // Await the issue to get the actual Issue object
    const issue = await result.issue;
    return issue.id;
  } catch (error) {
    throw new Error(
      `Failed to create Linear issue: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Map Linear issue to ExternalTicket format
 */
export function mapLinearToTicket(issue: {
  id: string;
  title: string;
  description?: string;
  state?: { name: string };
  priorityLabel?: string;
  labels?: { nodes: Array<{ name: string }> };
  assignee?: { name: string };
  createdAt: string;
  updatedAt: string;
  url: string;
}): ExternalTicket {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description || "",
    status: issue.state?.name,
    priority: issue.priorityLabel,
    labels: issue.labels?.nodes?.map((label) => label.name) || [],
    assignee: issue.assignee?.name,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    url: issue.url,
  };
}
