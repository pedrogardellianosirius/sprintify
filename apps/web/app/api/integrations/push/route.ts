import { NextRequest, NextResponse } from "next/server";
import { pushTicketsToExternal } from "agent";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, ticketIds } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 }
      );
    }

    const result = await pushTicketsToExternal(
      projectId,
      ticketIds && Array.isArray(ticketIds) ? ticketIds : undefined
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Push tickets error:", error);
    return NextResponse.json(
      {
        success: false,
        results: [],
        error: error instanceof Error ? error.message : "Failed to push tickets",
      },
      { status: 500 }
    );
  }
}
