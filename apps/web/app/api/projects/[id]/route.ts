import { NextRequest, NextResponse } from "next/server";
import { loadProject } from "agent";

/**
 * GET /api/projects/[id] - Load full project by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;

    if (!projectId) {
      return NextResponse.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    const project = await loadProject(projectId);

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error("Load project error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load project",
      },
      { status: 500 }
    );
  }
}
