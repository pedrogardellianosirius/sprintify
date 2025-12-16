import OpenAI from "openai";
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Ticket, TicketEmbedding, SimilarTicket, DuplicatePair } from "../types.js";
import { getGlobalCostTracker } from "../tools/costTracker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Embeddings stored at monorepo root: data/embeddings/
// Navigate from src/services/ or dist/services/ up to monorepo root
function getEmbeddingsDir(): string {
  let current = __dirname;

  // Go up until we find the monorepo root (has apps/ and data/ directories)
  for (let i = 0; i < 6; i++) {
    const potentialDataDir = join(current, "data", "embeddings");
    const potentialAppsDir = join(current, "apps");

    if (existsSync(potentialAppsDir)) {
      // We found the monorepo root
      return potentialDataDir;
    }
    current = join(current, "..");
  }

  // Fallback
  return join(__dirname, "../../../../../data/embeddings");
}

const EMBEDDINGS_DIR = getEmbeddingsDir();

// OpenAI embedding model configuration
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

// Pricing for text-embedding-3-small: $0.00002 per 1K tokens
const EMBEDDING_PRICE_PER_1K = 0.00002;

// Batch size for embedding API calls (OpenAI allows up to 2048)
const EMBEDDING_BATCH_SIZE = 100;

/**
 * Service for generating, storing, and searching ticket embeddings.
 * Uses OpenAI's text-embedding-3-small model for semantic similarity.
 */
export class EmbeddingService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI();
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });

    // Track embedding cost
    this.trackEmbeddingCost(text);

    return response.data[0].embedding;
  }

  /**
   * Generate embeddings for multiple tickets in batch
   */
  async generateTicketEmbeddings(
    tickets: Ticket[],
    projectId: string
  ): Promise<TicketEmbedding[]> {
    const texts = tickets.map((t) => `${t.title}\n${t.description}`);
    const embeddings: TicketEmbedding[] = [];
    const now = new Date().toISOString();

    // Process in batches
    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      const batchTexts = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
      const batchTickets = tickets.slice(i, i + EMBEDDING_BATCH_SIZE);

      const response = await this.openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batchTexts,
      });

      // Track cost for this batch
      for (const text of batchTexts) {
        this.trackEmbeddingCost(text);
      }

      // Map responses to ticket embeddings
      for (let j = 0; j < response.data.length; j++) {
        embeddings.push({
          ticketId: batchTickets[j].id,
          projectId,
          embedding: response.data[j].embedding,
          text: batchTexts[j],
          createdAt: now,
        });
      }
    }

    return embeddings;
  }

  /**
   * Save embeddings to JSON file
   */
  saveEmbeddings(projectId: string, embeddings: TicketEmbedding[]): void {
    this.ensureDir();
    const filePath = join(EMBEDDINGS_DIR, `${projectId}.json`);
    writeFileSync(filePath, JSON.stringify(embeddings, null, 2), "utf-8");
  }

  /**
   * Load embeddings for a project
   */
  loadEmbeddings(projectId: string): TicketEmbedding[] | null {
    const filePath = join(EMBEDDINGS_DIR, `${projectId}.json`);
    if (!existsSync(filePath)) return null;

    try {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  /**
   * Delete embeddings for a project
   */
  deleteEmbeddings(projectId: string): void {
    const filePath = join(EMBEDDINGS_DIR, `${projectId}.json`);
    if (existsSync(filePath)) {
      const { unlinkSync } = require("fs");
      unlinkSync(filePath);
    }
  }

  /**
   * Find similar tickets across all projects using cosine similarity
   */
  async findSimilarTickets(
    queryText: string,
    topK: number = 5,
    excludeProjectId?: string,
    threshold: number = 0.7
  ): Promise<SimilarTicket[]> {
    const queryEmbedding = await this.generateEmbedding(queryText);

    // Load all embeddings from all projects
    const allEmbeddings = this.loadAllEmbeddings(excludeProjectId);

    // Calculate similarities
    const similarities: SimilarTicket[] = [];
    for (const emb of allEmbeddings) {
      const score = this.cosineSimilarity(queryEmbedding, emb.embedding);
      if (score >= threshold) {
        similarities.push({
          ticketId: emb.ticketId,
          projectId: emb.projectId,
          title: emb.text.split("\n")[0], // First line is title
          score,
        });
      }
    }

    // Sort by score descending and return top K
    return similarities.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Find duplicate tickets within a set of tickets
   * Returns pairs of tickets with similarity above threshold
   */
  async findDuplicates(
    tickets: Ticket[],
    threshold: number = 0.85
  ): Promise<DuplicatePair[]> {
    if (tickets.length < 2) return [];

    const texts = tickets.map((t) => `${t.title}\n${t.description}`);

    // Generate all embeddings in batch
    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
    });

    // Track cost
    for (const text of texts) {
      this.trackEmbeddingCost(text);
    }

    const embeddings = response.data.map((d) => d.embedding);

    // Find duplicates using pairwise comparison
    const duplicates: DuplicatePair[] = [];
    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        const score = this.cosineSimilarity(embeddings[i], embeddings[j]);
        if (score >= threshold) {
          duplicates.push({
            ticket1: tickets[i].id,
            ticket2: tickets[j].id,
            score,
          });
        }
      }
    }

    // Sort by score descending
    return duplicates.sort((a, b) => b.score - a.score);
  }

  /**
   * Find similar tickets from previously generated embeddings (no API call)
   */
  findSimilarFromEmbeddings(
    queryEmbedding: number[],
    embeddings: TicketEmbedding[],
    topK: number = 5,
    threshold: number = 0.7
  ): SimilarTicket[] {
    const similarities: SimilarTicket[] = [];

    for (const emb of embeddings) {
      const score = this.cosineSimilarity(queryEmbedding, emb.embedding);
      if (score >= threshold) {
        similarities.push({
          ticketId: emb.ticketId,
          projectId: emb.projectId,
          title: emb.text.split("\n")[0],
          score,
        });
      }
    }

    return similarities.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * Ensure the embeddings directory exists
   */
  private ensureDir(): void {
    if (!existsSync(EMBEDDINGS_DIR)) {
      mkdirSync(EMBEDDINGS_DIR, { recursive: true });
    }
  }

  /**
   * Load all embeddings from all projects
   */
  private loadAllEmbeddings(excludeProjectId?: string): TicketEmbedding[] {
    this.ensureDir();

    const files = readdirSync(EMBEDDINGS_DIR).filter((f) => f.endsWith(".json"));
    const allEmbeddings: TicketEmbedding[] = [];

    for (const file of files) {
      const projectId = file.replace(".json", "");
      if (projectId === excludeProjectId) continue;

      const embeddings = this.loadEmbeddings(projectId);
      if (embeddings) {
        allEmbeddings.push(...embeddings);
      }
    }

    return allEmbeddings;
  }

  /**
   * Track embedding cost in the global cost tracker
   */
  private trackEmbeddingCost(text: string): void {
    // Estimate tokens (1 token ≈ 4 characters)
    const estimatedTokens = Math.ceil(text.length / 4);
    const cost = (estimatedTokens / 1000) * EMBEDDING_PRICE_PER_1K;

    // Add to cost tracker as input tokens (embeddings only use input)
    const tracker = getGlobalCostTracker();
    // We track as "tokensIn" since embeddings only process input
    // The cost is already calculated, so we add it directly
    tracker.track(estimatedTokens, 0);
  }
}

// Singleton instance
let embeddingService: EmbeddingService | null = null;

/**
 * Get the singleton embedding service instance
 */
export function getEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService();
  }
  return embeddingService;
}

/**
 * Reset the embedding service (useful for testing)
 */
export function resetEmbeddingService(): void {
  embeddingService = null;
}
