import type { Ticket } from "../types.js";
import type {
  ExternalTicket,
  JiraCredentials,
} from "./types.js";

/**
 * Create a Jira REST API client
 */
export function createJiraClient(
  email: string,
  apiToken: string,
  baseUrl: string
) {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");

  return {
    async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
      const url = `${baseUrl.replace(/\/$/, "")}/rest/api/3${endpoint}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Jira API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      return response.json() as Promise<T>;
    },
  };
}

/**
 * Read Jira issues from a project
 */
export async function readJiraIssues(
  credentials: JiraCredentials,
  projectKey: string,
  jql?: string
): Promise<ExternalTicket[]> {
  const client = createJiraClient(
    credentials.email,
    credentials.apiToken,
    credentials.baseUrl
  );

  // Build JQL query
  const query = jql || `project = ${projectKey} ORDER BY created DESC`;

  try {
    const response = await client.request<{
      issues: Array<{
        key: string;
        fields: {
          summary: string;
          description?: string;
          status: { name: string };
          priority?: { name: string };
          labels: string[];
          assignee?: { displayName: string };
          created: string;
          updated: string;
        };
      }>;
    }>(`/search?jql=${encodeURIComponent(query)}&maxResults=100`);

    return response.issues.map((issue) => ({
      id: issue.key,
      title: issue.fields.summary,
      description: issue.fields.description || "",
      status: issue.fields.status.name,
      priority: issue.fields.priority?.name,
      labels: issue.fields.labels || [],
      assignee: issue.fields.assignee?.displayName,
      createdAt: issue.fields.created,
      updatedAt: issue.fields.updated,
      url: `${credentials.baseUrl}/browse/${issue.key}`,
    }));
  } catch (error) {
    throw new Error(
      `Failed to read Jira issues: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Map Sprintify ticket to Jira issue fields
 */
export function mapTicketToJira(ticket: Ticket): {
  fields: {
    project: { key: string };
    summary: string;
    description: string;
    issuetype: { name: string };
    priority?: { name: string };
    labels?: string[];
    customfield_10016?: number; // Story points (may vary by Jira instance)
  };
} {
  // Map priority
  let priority: string | undefined;
  if (ticket.priority === "P1") {
    priority = "Highest";
  } else if (ticket.priority === "P2") {
    priority = "High";
  } else if (ticket.priority === "P3") {
    priority = "Medium";
  }

  // Format description with acceptance criteria
  let description = ticket.description || "";
  if (ticket.acceptanceCriteria && ticket.acceptanceCriteria.length > 0) {
    description += "\n\n*Acceptance Criteria:*\n";
    ticket.acceptanceCriteria.forEach((criteria) => {
      description += `* ${criteria}\n`;
    });
  }

  return {
    fields: {
      project: { key: "" }, // Will be set by caller
      summary: ticket.title,
      description,
      issuetype: { name: "Story" }, // Default to Story, can be customized
      ...(priority && { priority: { name: priority } }),
      ...(ticket.labels.length > 0 && { labels: ticket.labels }),
      // Story points - note: custom field ID may vary by Jira instance
      // This is a common field ID, but may need to be configured per instance
      ...(ticket.effortPoints && {
        customfield_10016: ticket.effortPoints,
      }),
    },
  };
}

/**
 * Create a Jira issue from a Sprintify ticket
 */
export async function createJiraIssue(
  credentials: JiraCredentials,
  projectKey: string,
  ticket: Ticket
): Promise<string> {
  const client = createJiraClient(
    credentials.email,
    credentials.apiToken,
    credentials.baseUrl
  );

  const issueFields = mapTicketToJira(ticket);
  issueFields.fields.project.key = projectKey;

  try {
    const response = await client.request<{ key: string }>("/issue", {
      method: "POST",
      body: JSON.stringify(issueFields),
    });

    return response.key;
  } catch (error) {
    throw new Error(
      `Failed to create Jira issue: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Map Jira issue to ExternalTicket format
 */
export function mapJiraToTicket(issue: {
  key: string;
  fields: {
    summary: string;
    description?: string;
    status: { name: string };
    priority?: { name: string };
    labels: string[];
    assignee?: { displayName: string };
    created: string;
    updated: string;
  };
  self: string;
}): ExternalTicket {
  const baseUrl = issue.self.split("/rest/api/3")[0];

  return {
    id: issue.key,
    title: issue.fields.summary,
    description: issue.fields.description || "",
    status: issue.fields.status.name,
    priority: issue.fields.priority?.name,
    labels: issue.fields.labels || [],
    assignee: issue.fields.assignee?.displayName,
    createdAt: issue.fields.created,
    updatedAt: issue.fields.updated,
    url: `${baseUrl}/browse/${issue.key}`,
  };
}
