import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Get the project root directory (where package.json is)
// This works whether we're in src/ or dist/
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Navigate up from current location to find project root
// If in src/utils/, go up 2 levels
// If in dist/utils/, go up 2 levels
// Then we can access src/ or dist/ from there
function getProjectRoot(): string {
  let current = __dirname;
  
  // Keep going up until we find package.json or reach a reasonable limit
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }
    current = join(current, "..");
  }
  
  // Fallback: assume we're in apps/agent/ and go up from __dirname
  // If __dirname is dist/utils or src/utils, go up 2 levels
  return join(__dirname, "../..");
}

const PROJECT_ROOT = getProjectRoot();

/**
 * Resolve a path relative to the project root
 * Tries src/ first (for dev), then dist/ (for production)
 */
export function resolvePromptPath(relativePath: string): string {
  // Try src/ first (development)
  const srcPath = join(PROJECT_ROOT, "src", relativePath);
  if (existsSync(srcPath)) {
    return srcPath;
  }
  
  // Fallback to dist/ (production)
  const distPath = join(PROJECT_ROOT, "dist", relativePath);
  if (existsSync(distPath)) {
    return distPath;
  }
  
  // If neither exists, throw a helpful error
  throw new Error(
    `Prompt file not found: ${relativePath}\n` +
    `Tried:\n` +
    `  - ${srcPath}\n` +
    `  - ${distPath}`
  );
}

/**
 * Read a prompt file from the prompts directory
 */
export function readPromptFile(filename: string): string {
  const path = resolvePromptPath(`prompts/${filename}`);
  return readFileSync(path, "utf-8");
}

