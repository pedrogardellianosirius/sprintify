import { z } from "zod";

// Re-export types from agent package
export { type Ticket, type Requirements, type ProjectState, type Cost } from "agent";

// Ticket schema with strict validation
export const TicketSchema = z.object({
  id: z.string(),
  title: z.string().min(1, "Title is required"),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()).min(1, "At least one acceptance criterion required"),
  effortPoints: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(5),
    z.literal(8),
    z.literal(13),
  ]),
  useCase: z.string(),
  priority: z.enum(["P1", "P2", "P3"]),
  labels: z.array(z.string()),
  dependencies: z.array(z.string()),
});

// Requirements schema
export const RequirementsSchema = z.object({
  projectName: z.string(),
  summary: z.string(),
  goals: z.array(z.string()),
  constraints: z.array(z.string()),
  features: z.array(z.string()),
  stakeholders: z.array(z.string()),
  techHints: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

// Cost schema
export const CostSchema = z.object({
  tokensIn: z.number(),
  tokensOut: z.number(),
  usd: z.number(),
});

// ProjectState schema
export const ProjectStateSchema = z.object({
  id: z.string(),
  rawText: z.string(),
  requirements: RequirementsSchema,
  tickets: z.array(TicketSchema),
  cost: CostSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

// API request schemas
export const GenerateRequestSchema = z.object({
  text: z.string().optional(),
  fileData: z.string().optional(), // base64 encoded
  fileName: z.string().optional(),
});

export const EditRequestSchema = z.object({
  projectId: z.string(),
  instruction: z.string(),
});

export const ExportRequestSchema = z.object({
  projectId: z.string(),
  format: z.enum(["json", "csv", "md"]),
});

export const CostRequestSchema = z.object({
  projectId: z.string(),
});

// Integration schemas
export const IntegrationConfigRequestSchema = z.object({
  projectId: z.string(),
  config: z.object({
    type: z.enum(["jira", "linear"]),
    credentials: z.union([
      z.object({
        email: z.string().email(),
        apiToken: z.string().min(1),
        baseUrl: z.string().url(),
      }),
      z.object({
        apiKey: z.string().min(1),
      }),
    ]),
    projectMapping: z.object({
      externalProjectKey: z.string().min(1),
      externalProjectName: z.string().optional(),
      teamId: z.string().optional(),
      projectId: z.string().optional(),
    }),
  }),
});

export const PushRequestSchema = z.object({
  projectId: z.string(),
  ticketIds: z.array(z.string()).optional(),
});

export const TestConnectionRequestSchema = z.object({
  type: z.enum(["jira", "linear"]),
  credentials: z.union([
    z.object({
      email: z.string().email(),
      apiToken: z.string().min(1),
      baseUrl: z.string().url(),
    }),
    z.object({
      apiKey: z.string().min(1),
    }),
  ]),
  projectMapping: z.object({
    externalProjectKey: z.string().min(1),
    externalProjectName: z.string().optional(),
    teamId: z.string().optional(),
    projectId: z.string().optional(),
  }),
});

