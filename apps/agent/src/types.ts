import { z } from "zod";

// Ticket type
export const TicketSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()).min(1),
  effortPoints: z.union([
    z.enum(["1", "2", "3", "5", "8", "13"]).transform(Number),
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

export type Ticket = z.infer<typeof TicketSchema>;

// Requirements type
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

export type Requirements = z.infer<typeof RequirementsSchema>;

// Cost tracking type
export const CostSchema = z.object({
  tokensIn: z.number(),
  tokensOut: z.number(),
  usd: z.number(),
});

export type Cost = z.infer<typeof CostSchema>;

// ProjectState type
export const ProjectStateSchema = z.object({
  id: z.string(),
  rawText: z.string(),
  requirements: RequirementsSchema,
  tickets: z.array(TicketSchema),
  cost: CostSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  externalMappings: z.record(z.string(), z.string()).optional(), // ticket.id -> external issue key/ID
});

export type ProjectState = z.infer<typeof ProjectStateSchema>;

// Agent input types
export interface ParseDocumentInput {
  fileBuffer?: Buffer;
  mime?: string;
  pastedText?: string;
}

export interface ExtractRequirementsInput {
  plainText: string;
}

export interface ClarifyInput {
  requirements: Requirements;
}

export interface GenerateTicketsInput {
  requirements: Requirements;
  answers?: Record<string, string>;
}

export interface ValidateTicketsInput {
  tickets: Ticket[];
  requirements: Requirements;
}

// Graph state type
export interface GraphState {
  projectId?: string;
  rawText: string;
  requirements?: Requirements;
  tickets: Ticket[];
  cost: Cost;
  error?: string;
  createdAt?: string;
  externalTicketsContext?: string; // Context from external tickets (Jira/Linear)
}

