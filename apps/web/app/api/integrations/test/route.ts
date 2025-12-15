import { NextRequest, NextResponse } from "next/server";
import {
  readJiraIssues,
  readLinearIssues,
  IntegrationConfigSchema,
  type IntegrationConfig,
} from "agent";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, credentials, projectMapping } = body;

    if (!type || !credentials || !projectMapping) {
      return NextResponse.json(
        { success: false, message: "type, credentials, and projectMapping are required" },
        { status: 400 }
      );
    }

    // Validate config structure
    const config: IntegrationConfig = {
      type,
      credentials,
      projectMapping,
    };

    IntegrationConfigSchema.parse(config);

    // Test connection based on type
    if (type === "jira") {
      const projectKey = projectMapping.externalProjectKey;
      try {
        // Try to read issues (limit to 1 for testing)
        await readJiraIssues(credentials, projectKey, `project = ${projectKey} ORDER BY created DESC`);
        return NextResponse.json({
          success: true,
          message: "Successfully connected to Jira",
        });
      } catch (error) {
        return NextResponse.json({
          success: false,
          message: `Failed to connect to Jira: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    } else if (type === "linear") {
      const teamId = projectMapping.teamId || projectMapping.externalProjectKey;
      try {
        // Try to read issues (limit to 1 for testing)
        await readLinearIssues(credentials, teamId, projectMapping.projectId);
        return NextResponse.json({
          success: true,
          message: "Successfully connected to Linear",
        });
      } catch (error) {
        return NextResponse.json({
          success: false,
          message: `Failed to connect to Linear: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    } else {
      return NextResponse.json(
        { success: false, message: `Unsupported integration type: ${type}` },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Test connection error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to test connection",
      },
      { status: 500 }
    );
  }
}
