import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ProjectState } from "../types.js";
import { getEmbeddingService } from "../services/embeddingService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Navigate to data directories
function getDataDir(subdir: string): string {
  let current = __dirname;
  for (let i = 0; i < 6; i++) {
    const potentialDir = join(current, "data", subdir);
    const potentialAppsDir = join(current, "apps");
    if (existsSync(potentialAppsDir)) {
      return potentialDir;
    }
    current = join(current, "..");
  }
  return join(__dirname, "../../../../data", subdir);
}

const PROJECTS_DIR = getDataDir("projects");
const EMBEDDINGS_DIR = getDataDir("embeddings");

const SIMILARITY_THRESHOLD = 0.7;
const MAX_SUGGESTIONS = 3;

/**
 * Load a project by ID
 */
function loadProject(projectId: string): ProjectState | null {
  const filePath = join(PROJECTS_DIR, `${projectId}.json`);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Get all project IDs that have embeddings
 */
function getProjectsWithEmbeddings(): string[] {
  if (!existsSync(EMBEDDINGS_DIR)) return [];

  return readdirSync(EMBEDDINGS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

/**
 * Semantic RAG search using embeddings to find similar past projects.
 */
export async function ragSearch(
  requirements: string,
  excludeProjectId?: string
): Promise<string[]> {
  try {
    const projectIds = getProjectsWithEmbeddings();

    if (projectIds.length === 0) {
      return [];
    }

    const embeddingService = getEmbeddingService();
    const queryEmbedding = await embeddingService.generateEmbedding(requirements);

    const results: Array<{
      projectName: string;
      features: string[];
      ticketCount: number;
      score: number;
    }> = [];

    for (const projectId of projectIds) {
      if (projectId === excludeProjectId) continue;

      const embeddings = embeddingService.loadEmbeddings(projectId);
      if (!embeddings || embeddings.length === 0) continue;

      const project = loadProject(projectId);
      if (!project) continue;

      // Calculate average similarity across ticket embeddings
      let totalSimilarity = 0;
      for (const emb of embeddings) {
        totalSimilarity += cosineSimilarity(queryEmbedding, emb.embedding);
      }
      const avgSimilarity = totalSimilarity / embeddings.length;

      if (avgSimilarity >= SIMILARITY_THRESHOLD) {
        results.push({
          projectName: project.requirements.projectName,
          features: project.requirements.features,
          ticketCount: project.tickets.length,
          score: avgSimilarity,
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS)
      .map((r) => {
        const scorePercent = Math.round(r.score * 100);
        const featuresPreview = r.features.slice(0, 3).join(", ");
        return `Similar project "${r.projectName}" (${scorePercent}% match) had ${r.ticketCount} tickets covering: ${featuresPreview}`;
      });
  } catch (error) {
    console.warn("RAG search failed:", error);
    return [];
  }
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
