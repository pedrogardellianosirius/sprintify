import { NextRequest, NextResponse } from "next/server";
import {
  saveIntegrationConfig,
  loadIntegrationConfig,
  deleteIntegrationConfig,
  IntegrationConfigSchema,
} from "agent";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, config } = body;

    if (!projectId || !config) {
      return NextResponse.json(
        { error: "projectId and config are required" },
        { status: 400 }
      );
    }

    // Validate config
    const validatedConfig = IntegrationConfigSchema.parse(config);

    await saveIntegrationConfig(projectId, validatedConfig);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Save integration config error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save integration config",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 }
      );
    }

    const config = await loadIntegrationConfig(projectId);

    // Don't expose full credentials in response - only return type and project mapping
    if (config) {
      return NextResponse.json({
        type: config.type,
        projectMapping: config.projectMapping,
        // Don't include credentials for security
      });
    }

    return NextResponse.json(null);
  } catch (error) {
    console.error("Load integration config error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load integration config",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 }
      );
    }

    await deleteIntegrationConfig(projectId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete integration config error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete integration config",
      },
      { status: 500 }
    );
  }
}
