import { NextRequest, NextResponse } from "next/server";
import { listProjects } from "agent";

/**
 * GET /api/projects - List all projects with metadata
 */
export async function GET(request: NextRequest) {
  try {
    const projects = await listProjects();
    
    return NextResponse.json(projects);
  } catch (error) {
    console.error("List projects error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list projects",
      },
      { status: 500 }
    );
  }
}
