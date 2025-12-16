import { StateGraph, END } from "@langchain/langgraph";
import { v4 as uuidv4 } from "uuid";
import type { GraphState, ParseDocumentInput } from "./types.js";
import type { StreamCallback } from "./index.js";
import { parseDocument } from "./tools/parseDocument.js";
import { runSecurityChecks } from "./tools/security.js";
import { extractRequirements } from "./tools/extractRequirements.js";
import { generateTickets } from "./tools/generateTickets.js";
import { validateTickets } from "./tools/validateTickets.js";
import { persistProject } from "./tools/persistProject.js";
import { ragSearch } from "./tools/ragSearch.js";
import { initCostTracker } from "./tools/costTracker.js";
import { readExternalTickets, formatExternalTicketsAsContext } from "./tools/readExternalTickets.js";
import { loadIntegrationConfig } from "./tools/integrationConfig.js";
import { getEmbeddingService } from "./services/embeddingService.js";

// Global stream callback
let globalStreamCallback: StreamCallback | undefined;

/**
 * Parse document node
 */
async function parseNode(state: GraphState): Promise<Partial<GraphState>> {
  try {
    console.log("📄 Parsing document...");
    const rawText = state.rawText;
    return { rawText };
  } catch (error) {
    return { error: `Parse error: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
}

/**
 * Security check node
 */
async function securityNode(state: GraphState): Promise<Partial<GraphState>> {
  try {
    console.log("🔒 Running security checks...");
    globalStreamCallback?.({ type: 'status', message: '🔒 Running security checks...' });
    
    const result = runSecurityChecks(state.rawText);
    
    if (!result.passed) {
      return { error: `Security check failed: ${result.reason}` };
    }

    return { rawText: result.sanitized || state.rawText };
  } catch (error) {
    return { error: `Security check error: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
}

/**
 * Extract requirements node
 */
async function extractNode(state: GraphState): Promise<Partial<GraphState>> {
  try {
    console.log("📋 Extracting requirements...");
    globalStreamCallback?.({ type: 'status', message: '📋 Extracting requirements...' });
    
    const requirements = await extractRequirements(state.rawText);
    console.log(`   Extracted requirements: ${requirements.projectName}`);
    globalStreamCallback?.({ 
      type: 'progress', 
      message: `✅ Requirements extracted: ${requirements.projectName}`,
      data: { requirements }
    });
    
    return { requirements };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error("   Extract node error:", error);
    globalStreamCallback?.({ type: 'error', message: errorMsg });
    return { error: errorMsg };
  }
}

/**
 * RAG search node (optional)
 */
async function ragNode(state: GraphState): Promise<Partial<GraphState>> {
  // Skip if there's already an error
  if (state.error) {
    return {};
  }

  try {
    console.log("🔍 Searching for similar projects...");
    globalStreamCallback?.({ type: 'status', message: '🔍 Searching for similar projects...' });
    
    if (!state.requirements) {
      return {};
    }

    const suggestions = await ragSearch(state.requirements.summary);
    if (suggestions.length > 0) {
      console.log(`💡 Found ${suggestions.length} similar project(s)`);
      globalStreamCallback?.({ 
        type: 'progress', 
        message: `💡 Found ${suggestions.length} similar project(s)`,
        data: { suggestions }
      });
    }
    return {};
  } catch (error) {
    // RAG is optional, don't fail on error
    console.warn("RAG search failed:", error);
    return {};
  }
}

/**
 * Read external tickets node (optional - only if integration is configured)
 */
async function readExternalNode(state: GraphState): Promise<Partial<GraphState>> {
  // Skip if there's already an error
  if (state.error) {
    return {};
  }

  // Only read external tickets if projectId is available
  if (!state.projectId) {
    return {};
  }

  try {
    // Check if integration is configured
    const config = await loadIntegrationConfig(state.projectId);
    if (!config) {
      // No integration configured, skip
      return {};
    }

    console.log(`🔗 Reading existing tickets from ${config.type}...`);
    globalStreamCallback?.({ 
      type: 'status', 
      message: `🔗 Reading existing tickets from ${config.type}...` 
    });

    const externalTickets = await readExternalTickets(state.projectId);
    
    if (externalTickets.length > 0) {
      console.log(`   Found ${externalTickets.length} existing ticket(s)`);
      const context = formatExternalTicketsAsContext(externalTickets);
      
      globalStreamCallback?.({ 
        type: 'progress', 
        message: `📋 Found ${externalTickets.length} existing ticket(s) from ${config.type}`,
        data: { externalTicketCount: externalTickets.length }
      });

      return { externalTicketsContext: context };
    } else {
      console.log("   No existing tickets found");
      return {};
    }
  } catch (error) {
    // Reading external tickets is optional, don't fail on error
    console.warn("Failed to read external tickets:", error);
    globalStreamCallback?.({ 
      type: 'progress', 
      message: `⚠️ Could not read external tickets: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
    return {};
  }
}

/**
 * Generate tickets node
 */
async function generateNode(state: GraphState): Promise<Partial<GraphState>> {
  // Skip if there's already an error
  if (state.error) {
    return {};
  }

  try {
    console.log("🎫 Generating tickets...");
    globalStreamCallback?.({ type: 'status', message: '🎫 Generating tickets...' });
    
    console.log(`   State has requirements: ${!!state.requirements}`);
    if (!state.requirements) {
      console.error("   ERROR: Requirements missing in generate node!");
      return { error: "Requirements not available for ticket generation" };
    }

    const result = await generateTickets(
      state.requirements, 
      undefined,
      // Progress callback for batch processing
      (batchInfo) => {
        console.log(`   📦 Batch ${batchInfo.batch}/${batchInfo.total}: Generated ${batchInfo.tickets.length} tickets`);
        globalStreamCallback?.({ 
          type: 'progress', 
          message: `📦 Batch ${batchInfo.batch}/${batchInfo.total}: Generated ${batchInfo.tickets.length} tickets for this section`,
          data: { 
            batch: batchInfo.batch,
            totalBatches: batchInfo.total,
            batchTickets: batchInfo.tickets.length
          }
        });

        // Stream each ticket from this batch
        batchInfo.tickets.forEach((ticket, idx) => {
          globalStreamCallback?.({ 
            type: 'progress', 
            message: `  🎫 ${ticket.title}`,
            data: { ticket }
          });
        });
      },
      state.externalTicketsContext // Pass external tickets context
    );
    console.log(`   Generated ${result.tickets.length} total tickets`);

    
    globalStreamCallback?.({ 
      type: 'progress', 
      message: `✅ All ${result.tickets.length} ticket(s) generated`,
      data: { ticketCount: result.tickets.length }
    });
    
    return {
      tickets: result.tickets,
    };
  } catch (error) {
    console.error("   Generate node error:", error);
    globalStreamCallback?.({ type: 'error', message: `❌ Failed to generate tickets: ${error instanceof Error ? error.message : 'Unknown error'}` });
    return { error: `Generate error: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
}

/**
 * Validate tickets node
 */
async function validateNode(state: GraphState): Promise<Partial<GraphState>> {
  // Skip if there's already an error
  if (state.error) {
    return {};
  }

  try {
    console.log("✅ Validating tickets...");
    globalStreamCallback?.({ type: 'status', message: '✅ Validating tickets...' });
    
    console.log(`   DEBUG: requirements present: ${!!state.requirements}, tickets count: ${state.tickets?.length || 0}`);
    
    if (!state.requirements || !state.tickets || state.tickets.length === 0) {
      console.warn(`   Validation check failed: requirements=${!!state.requirements}, tickets=${state.tickets?.length || 0}`);
      return { error: "Requirements or tickets not available for validation" };
    }

    const result = await validateTickets(state.tickets, state.requirements);
    
    if (!result.valid && result.issues.length > 0) {
      console.warn(`⚠️ Found ${result.issues.length} validation issue(s)`);
      result.issues.forEach(issue => {
        console.warn(`  - ${issue.type}: ${issue.description}`);
      });
      globalStreamCallback?.({ 
        type: 'progress', 
        message: `⚠️ Found ${result.issues.length} validation issue(s)`,
        data: { issues: result.issues }
      });
    } else {
      console.log("✅ All tickets validated successfully");
      globalStreamCallback?.({ type: 'progress', message: '✅ All tickets validated successfully' });
    }

    return {};
  } catch (error) {
    // Validation is best-effort, don't fail the whole process
    console.warn("Validation failed:", error);
    return {};
  }
}

/**
 * Generate embeddings for tickets (optional, for semantic search and duplicate detection)
 */
async function embedNode(state: GraphState): Promise<Partial<GraphState>> {
  // Skip if there's already an error
  if (state.error) {
    return {};
  }

  try {
    console.log("🔢 Generating ticket embeddings...");
    globalStreamCallback?.({ type: 'status', message: '🔢 Generating ticket embeddings...' });

    if (!state.tickets || state.tickets.length === 0) {
      console.log("   No tickets to embed, skipping...");
      return {};
    }

    const embeddingService = getEmbeddingService();
    const projectId = state.projectId || 'temp';

    // Generate embeddings for all tickets
    const embeddings = await embeddingService.generateTicketEmbeddings(
      state.tickets,
      projectId
    );

    // Save embeddings if we have a project ID
    if (state.projectId) {
      embeddingService.saveEmbeddings(state.projectId, embeddings);
      console.log(`   💾 Saved embeddings for ${embeddings.length} ticket(s)`);
    }

    // Check for potential duplicates
    const duplicates = await embeddingService.findDuplicates(state.tickets, 0.85);
    if (duplicates.length > 0) {
      console.log(`   ⚠️ Found ${duplicates.length} potential duplicate ticket pair(s)`);

      // Log the duplicates
      for (const dup of duplicates.slice(0, 5)) { // Show max 5
        console.log(`      - ${dup.ticket1} ↔ ${dup.ticket2} (similarity: ${(dup.score * 100).toFixed(1)}%)`);
      }

      globalStreamCallback?.({
        type: 'progress',
        message: `⚠️ Found ${duplicates.length} potential duplicate ticket pair(s)`,
        data: { duplicates },
      });
    }

    console.log(`   ✅ Generated embeddings for ${embeddings.length} ticket(s)`);
    globalStreamCallback?.({
      type: 'progress',
      message: `✅ Generated embeddings for ${embeddings.length} ticket(s)`,
      data: { embeddingCount: embeddings.length },
    });

    return {};
  } catch (error) {
    // Embeddings are optional, don't fail the pipeline
    console.warn("   ⚠️ Embedding generation failed:", error instanceof Error ? error.message : error);
    globalStreamCallback?.({
      type: 'progress',
      message: `⚠️ Embedding generation skipped: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
    return {};
  }
}

/**
 * Persist project node
 */
async function persistNode(state: GraphState): Promise<Partial<GraphState>> {
  // Skip if there's already an error
  if (state.error) {
    return {};
  }

  try {
    console.log("💾 Persisting project...");
    globalStreamCallback?.({ type: 'status', message: '💾 Persisting project...' });
    
    const projectId = state.projectId || uuidv4();
    const now = new Date().toISOString();

    // Load existing project to preserve externalMappings if they exist
    const existingProject = state.projectId 
      ? await import("./tools/persistProject.js").then(m => m.loadProject(state.projectId!))
      : null;

    const projectState = {
      id: projectId,
      rawText: state.rawText,
      requirements: state.requirements!,
      tickets: state.tickets,
      cost: state.cost,
      createdAt: state.projectId ? state.createdAt || now : now,
      updatedAt: now,
      externalMappings: existingProject?.externalMappings || {},
    };

    await persistProject(projectState);
    
    console.log(`✅ Project saved: ${projectId}`);
    globalStreamCallback?.({ 
      type: 'progress', 
      message: `✅ Project saved: ${projectId}`,
      data: { projectId }
    });
    
    return { projectId };
  } catch (error) {
    globalStreamCallback?.({ type: 'error', message: `❌ Failed to persist project: ${error instanceof Error ? error.message : 'Unknown error'}` });
    return { error: `Persist error: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
}

/**
 * Build the agent graph
 */
export function buildGraph(streamCallback?: StreamCallback) {
  // Set the global stream callback
  globalStreamCallback = streamCallback;
  const workflow = new StateGraph<GraphState>({
    channels: {
      projectId: {
        value: (x: string | undefined, y?: string | undefined) => {
          if (y !== undefined) return y;
          if (x !== undefined) return x;
          return undefined;
        },
        default: () => undefined,
      },
      rawText: {
        value: (x: string, y?: string) => y !== undefined ? y : x,
        default: () => "",
      },
      requirements: {
        value: (x: any, y?: any) => {
          if (y !== undefined) {
            console.log("   REDUCER: Updating requirements");
            return y;
          }
          return x;
        },
        default: () => undefined,
      },
      tickets: {
        value: (x: any[], y?: any[]) => {
          if (y !== undefined) {
            console.log(`   REDUCER: Updating tickets (${y.length} tickets)`);
            return y;
          }
          return x;
        },
        default: () => [],
      },
      cost: {
        value: (x: any, y?: any) => y !== undefined ? y : x,
        default: () => ({ tokensIn: 0, tokensOut: 0, usd: 0 }),
      },
      error: {
        value: (x: string | undefined, y?: string | undefined) => y !== undefined ? y : x,
        default: () => undefined,
      },
      createdAt: {
        value: (x: string | undefined, y?: string | undefined) => y !== undefined ? y : x,
        default: () => undefined,
      },
      externalTicketsContext: {
        value: (x: string | undefined, y?: string | undefined) => y !== undefined ? y : x,
        default: () => undefined,
      },
    },
  });

  // Add nodes
  workflow.addNode("parse", parseNode);
  workflow.addNode("security", securityNode);
  workflow.addNode("extract", extractNode);
  workflow.addNode("rag", ragNode);
  workflow.addNode("readExternal", readExternalNode);
  workflow.addNode("generate", generateNode);
  workflow.addNode("validate", validateNode);
  workflow.addNode("embed", embedNode);
  workflow.addNode("persist", persistNode);

  // Define edges
  // Workflow: parse → security → extract → rag → readExternal → generate → validate → persist → embed → END
  // Note: persist runs before embed so projectId is available for saving embeddings
  // @ts-ignore - StateGraph type inference issue with channels
  workflow.setEntryPoint("parse");
  // @ts-ignore
  workflow.addEdge("parse", "security");
  // @ts-ignore
  workflow.addEdge("security", "extract");
  // @ts-ignore
  workflow.addEdge("extract", "rag");
  // @ts-ignore
  workflow.addEdge("rag", "readExternal");
  // @ts-ignore
  workflow.addEdge("readExternal", "generate");
  // @ts-ignore
  workflow.addEdge("generate", "validate");
  // @ts-ignore
  workflow.addEdge("validate", "persist");
  // @ts-ignore
  workflow.addEdge("persist", "embed");
  // @ts-ignore
  workflow.addEdge("embed", END);

  return workflow.compile();
}

