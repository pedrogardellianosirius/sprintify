import { z } from "zod";
import type { Ticket } from "../types.js";

// Integration type enum
export const IntegrationTypeSchema = z.enum(["jira", "linear"]);
export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;

// Jira credentials schema
export const JiraCredentialsSchema = z.object({
  email: z.string().email(),
  apiToken: z.string().min(1),
  baseUrl: z.string().url(),
});

export type JiraCredentials = z.infer<typeof JiraCredentialsSchema>;

// Linear credentials schema
export const LinearCredentialsSchema = z.object({
  apiKey: z.string().min(1),
});

export type LinearCredentials = z.infer<typeof LinearCredentialsSchema>;

// Union type for credentials
export const IntegrationCredentialsSchema = z.union([
  JiraCredentialsSchema,
  LinearCredentialsSchema,
]);

export type IntegrationCredentials = z.infer<typeof IntegrationCredentialsSchema>;

// Project mapping schema
export const ProjectMappingSchema = z.object({
  externalProjectKey: z.string().min(1), // Jira project key or Linear team/project ID
  externalProjectName: z.string().optional(),
  // For Linear: teamId is separate from projectId
  teamId: z.string().optional(), // Linear team ID
  projectId: z.string().optional(), // Linear project ID (optional)
});

export type ProjectMapping = z.infer<typeof ProjectMappingSchema>;

// Integration config schema
export const IntegrationConfigSchema = z.object({
  type: IntegrationTypeSchema,
  credentials: z.union([
    JiraCredentialsSchema,
    LinearCredentialsSchema,
  ]),
  projectMapping: ProjectMappingSchema,
});

export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;

// External ticket (normalized format from Jira/Linear)
export const ExternalTicketSchema = z.object({
  id: z.string(), // External issue key/ID
  title: z.string(),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  labels: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  url: z.string().optional(),
});

export type ExternalTicket = z.infer<typeof ExternalTicketSchema>;

// Push result schema
export const PushResultSchema = z.object({
  success: z.boolean(),
  results: z.array(
    z.object({
      ticketId: z.string(),
      externalKey: z.string().optional(),
      error: z.string().optional(),
    })
  ),
});

export type PushResult = z.infer<typeof PushResultSchema>;

// Test connection result
export const TestConnectionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;
