import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ProjectState } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Data directory is at the root of the monorepo
const DATA_DIR = join(__dirname, "../../../../data/projects");

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Save project state to file
 */
export async function persistProject(state: ProjectState): Promise<void> {
  ensureDataDir();
  
  const filePath = join(DATA_DIR, `${state.id}.json`);
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Load project state from file
 */
export async function loadProject(projectId: string): Promise<ProjectState | null> {
  ensureDataDir();
  
  const filePath = join(DATA_DIR, `${projectId}.json`);
  
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as ProjectState;
}

/**
 * Check if project exists
 */
export function projectExists(projectId: string): boolean {
  ensureDataDir();
  const filePath = join(DATA_DIR, `${projectId}.json`);
  return existsSync(filePath);
}

/**
 * List all projects with metadata
 */
export async function listProjects(): Promise<Array<{
  id: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  ticketCount: number;
}>> {
  ensureDataDir();
  
  try {
    const files = readdirSync(DATA_DIR);
    const projectFiles = files.filter(f => f.endsWith('.json'));
    
    const projects = await Promise.all(
      projectFiles.map(async (file) => {
        try {
          const filePath = join(DATA_DIR, file);
          const content = readFileSync(filePath, "utf-8");
          const project = JSON.parse(content) as ProjectState;
          
          return {
            id: project.id,
            projectName: project.requirements?.projectName || 'Untitled Project',
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            ticketCount: project.tickets?.length || 0,
          };
        } catch (error) {
          // Skip invalid project files
          console.warn(`Failed to read project file ${file}:`, error);
          return null;
        }
      })
    );
    
    // Filter out nulls and sort by updatedAt descending
    const validProjects = projects.filter((p): p is NonNullable<typeof p> => p !== null);
    return validProjects.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch (error) {
    console.error("Failed to list projects:", error);
    return [];
  }
}

