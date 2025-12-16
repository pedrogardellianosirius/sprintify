import { NextRequest, NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

// Get the projects directory
function getProjectsDir(): string {
  // Navigate from apps/web to data/projects
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

export interface ProjectSummary {
  id: string;
  projectName: string;
  ticketCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function GET(request: NextRequest) {
  try {
    if (!existsSync(PROJECTS_DIR)) {
      return NextResponse.json([]);
    }

    const files = readdirSync(PROJECTS_DIR).filter((f) => f.endsWith(".json"));

    const projects: ProjectSummary[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(PROJECTS_DIR, file), "utf-8");
        const project = JSON.parse(content);

        projects.push({
          id: project.id,
          projectName: project.requirements?.projectName || "Unnamed Project",
          ticketCount: project.tickets?.length || 0,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        });
      } catch {
        // Skip invalid files
      }
    }

    // Sort by updatedAt descending (most recent first)
    projects.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return NextResponse.json(projects);
  } catch (error) {
    console.error("Failed to list projects:", error);
    return NextResponse.json(
      { error: "Failed to list projects" },
      { status: 500 }
    );
  }
}
