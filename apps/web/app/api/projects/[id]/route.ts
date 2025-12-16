import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Get the projects directory
function getProjectsDir(): string {
  const possiblePaths = [
    join(process.cwd(), "../../data/projects"),
    join(process.cwd(), "../data/projects"),
    join(process.cwd(), "data/projects"),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  return possiblePaths[0];
}

const PROJECTS_DIR = getProjectsDir();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const filePath = join(PROJECTS_DIR, `${id}.json`);

    if (!existsSync(filePath)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const content = readFileSync(filePath, "utf-8");
    const project = JSON.parse(content);

    return NextResponse.json(project);
  } catch (error) {
    console.error("Failed to load project:", error);
    return NextResponse.json(
      { error: "Failed to load project" },
      { status: 500 }
    );
  }
}
