import { promises as fs } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import type { IntegrationConfig } from "../integrations/types.js";
import { IntegrationConfigSchema } from "../integrations/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the data directory path (relative to the agent package)
const DATA_DIR = join(__dirname, "../../../data/integrations");

/**
 * Ensure the integrations directory exists
 */
async function ensureIntegrationsDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist, that's fine
    if (error instanceof Error && !error.message.includes("EEXIST")) {
      throw error;
    }
  }
}

/**
 * Get the path to an integration config file
 */
function getConfigPath(projectId: string): string {
  return join(DATA_DIR, `${projectId}.json`);
}

/**
 * Save integration configuration for a project
 */
export async function saveIntegrationConfig(
  projectId: string,
  config: IntegrationConfig
): Promise<void> {
  await ensureIntegrationsDir();

  // Validate config
  IntegrationConfigSchema.parse(config);

  const configPath = getConfigPath(projectId);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Load integration configuration for a project
 */
export async function loadIntegrationConfig(
  projectId: string
): Promise<IntegrationConfig | null> {
  const configPath = getConfigPath(projectId);

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);
    return IntegrationConfigSchema.parse(parsed);
  } catch (error) {
    // File doesn't exist or invalid format
    if (
      error instanceof Error &&
      (error.message.includes("ENOENT") || error.message.includes("JSON"))
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Delete integration configuration for a project
 */
export async function deleteIntegrationConfig(
  projectId: string
): Promise<void> {
  const configPath = getConfigPath(projectId);

  try {
    await fs.unlink(configPath);
  } catch (error) {
    // File doesn't exist, that's fine
    if (error instanceof Error && !error.message.includes("ENOENT")) {
      throw error;
    }
  }
}
