import { ChatOpenAI } from "@langchain/openai";
import { RequirementsSchema, type Requirements } from "../types.js";
import { getGlobalCostTracker } from "./costTracker.js";
import { readPromptFile } from "../utils/pathResolver.js";

/**
 * Extract structured requirements from plain text using LLM
 */
export async function extractRequirements(
  plainText: string,
  externalTicketsContext?: string
): Promise<Requirements> {
  const systemPrompt = readPromptFile("extractRequirements.system.txt");

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL || "gpt-4o",
    temperature: 0.1,
  });

  // Build user prompt with optional external tickets context
  let userPrompt = `Extract requirements from this document:\n\n${plainText}`;
  
  if (externalTicketsContext) {
    userPrompt = `IMPORTANT: The following existing tickets/work items are already in the project management system. When extracting requirements, be aware of these existing items to avoid duplication and ensure consistency:\n\n${externalTicketsContext}\n\n${"=".repeat(80)}\n\nNow extract requirements from this document:\n\n${plainText}`;
  }

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  // Track costs
  const tracker = getGlobalCostTracker();
  if (response.usage_metadata) {
    tracker.track(
      response.usage_metadata.input_tokens || 0,
      response.usage_metadata.output_tokens || 0
    );
  }

  // Parse and validate response
  const content = response.content as string;
  
  // Try to extract JSON from response (might be wrapped in markdown)
  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const requirements = RequirementsSchema.parse(parsed);
    
    // Validate that this is actually a software project
    validateSoftwareProject(requirements, plainText);
    
    return requirements;
  } catch (error) {
    throw new Error(`Failed to parse requirements: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Validate that the extracted requirements represent a legitimate software project
 */
function validateSoftwareProject(requirements: Requirements, originalText: string): void {
  const errors: string[] = [];
  
  // Check 1: Must have at least 1 feature
  if (!requirements.features || requirements.features.length === 0) {
    errors.push("No se encontraron características/funcionalidades de software.");
  }
  
  // Check 2: Must have at least 1 goal
  if (!requirements.goals || requirements.goals.length === 0) {
    errors.push("No se encontraron objetivos del proyecto.");
  }
  
  // Check 3: Check if features/goals contain software-related keywords
  const softwareKeywords = [
    'app', 'aplicación', 'sistema', 'plataforma', 'web', 'website', 'sitio',
    'api', 'base de datos', 'database', 'usuario', 'user', 'login', 'autenticación',
    'authentication', 'frontend', 'backend', 'interfaz', 'interface', 'dashboard',
    'móvil', 'mobile', 'software', 'código', 'code', 'desarrollar', 'develop',
    'página', 'page', 'formulario', 'form', 'servidor', 'server', 'nube', 'cloud',
    'servicio', 'service', 'integración', 'integration', 'módulo', 'module'
  ];
  
  const allText = [
    requirements.projectName,
    requirements.summary,
    ...requirements.goals,
    ...requirements.features,
    ...(requirements.stakeholders || [])
  ].join(' ').toLowerCase();
  
  const hasKeywords = softwareKeywords.some(keyword => 
    allText.includes(keyword.toLowerCase())
  );
  
  if (!hasKeywords) {
    errors.push("El contenido no parece describir un proyecto de software o aplicación.");
  }
  
  // Check 4: Red flags for non-software projects
  const nonSoftwareKeywords = [
    'comprar', 'buy', 'vender', 'sell', 'alquilar', 'rent',
    'contratar', 'hire', 'inversión', 'investment',
    'real estate', 'bienes raíces', 'inmueble', 'property'
  ];
  
  const originalLower = originalText.toLowerCase();
  const hasNonSoftwareKeywords = nonSoftwareKeywords.some(keyword =>
    originalLower.includes(keyword.toLowerCase())
  );
  
  // If it's very short and has non-software keywords, likely not a project
  if (originalText.length < 200 && hasNonSoftwareKeywords && !hasKeywords) {
    errors.push("El texto parece describir una compra o transacción, no un proyecto de desarrollo de software.");
  }
  
  if (errors.length > 0) {
    throw new Error(
      `❌ Este no parece ser un proyecto de software válido:\n\n` +
      errors.map(e => `• ${e}`).join('\n') +
      `\n\n💡 Por favor, proporciona una descripción de un proyecto de software, aplicación o sistema que necesites desarrollar.`
    );
  }
}

