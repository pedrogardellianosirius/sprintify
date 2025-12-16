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
  constraints: z.array(z.string()).default([]),
  features: z.array(z.string()),
  stakeholders: z.array(z.string()).default([]),
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

// ============================================================================
// Cross-batch Context Types (for coherent ticket generation)
// ============================================================================

// Lightweight ticket summary for cross-batch context
export const TicketSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  useCase: z.string(),
  labels: z.array(z.string()),
  dependencies: z.array(z.string()),
});

export type TicketSummary = z.infer<typeof TicketSummarySchema>;

// Context passed between batches during generation
export const BatchContextSchema = z.object({
  batchNumber: z.number(),
  previousTicketSummaries: z.array(TicketSummarySchema),
  coveredFeatures: z.array(z.string()),
  infrastructureTicketIds: z.array(z.string()), // IDs of setup/infra tickets for dependencies
});

export type BatchContext = z.infer<typeof BatchContextSchema>;

// ============================================================================
// Batched Edit Types (for bulk edit operations)
// ============================================================================

// Single error in an edit batch
export const EditErrorSchema = z.object({
  ticketId: z.string().optional(),
  message: z.string(),
  instruction: z.string().optional(),
});

export type EditError = z.infer<typeof EditErrorSchema>;

// Result of processing a single edit batch
export const EditBatchResultSchema = z.object({
  success: z.boolean(),
  batchIndex: z.number(),
  appliedChanges: z.object({
    removed: z.array(z.string()),
    addedOrUpdated: z.array(TicketSchema),
  }),
  errors: z.array(EditErrorSchema),
});

export type EditBatchResult = z.infer<typeof EditBatchResultSchema>;

// ============================================================================
// Embedding Types (for semantic similarity and duplicate detection)
// ============================================================================

// Stored embedding for a ticket
export const TicketEmbeddingSchema = z.object({
  ticketId: z.string(),
  projectId: z.string(),
  embedding: z.array(z.number()), // 1536 dimensions for text-embedding-3-small
  text: z.string(), // The text that was embedded (title + description)
  createdAt: z.string(),
});

export type TicketEmbedding = z.infer<typeof TicketEmbeddingSchema>;

// Result from similarity search
export const SimilarTicketSchema = z.object({
  ticketId: z.string(),
  projectId: z.string(),
  title: z.string(),
  score: z.number(), // Cosine similarity score (0-1)
});

export type SimilarTicket = z.infer<typeof SimilarTicketSchema>;

// Duplicate pair detected
export const DuplicatePairSchema = z.object({
  ticket1: z.string(),
  ticket2: z.string(),
  score: z.number(),
});

export type DuplicatePair = z.infer<typeof DuplicatePairSchema>;

// ============================================================================
// Graph State
// ============================================================================

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
  batchContext?: BatchContext; // Context from previous batches
  integrationConfig?: import("./integrations/types.js").IntegrationConfig; // Integration config passed from outside
}

