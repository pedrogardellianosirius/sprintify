import { NextRequest } from "next/server";
import { runAgent } from "agent";
import { GenerateRequestSchema } from "../../../lib/schemas";
import { base64ToBuffer } from "../../../lib/adapters";

export const maxDuration = 60; // 60 seconds for long-running LLM calls

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = GenerateRequestSchema.parse(body);

    // Prepare input for agent
    const agentInput: {
      file?: { buffer: Buffer; mime: string };
      text?: string;
      integrationConfig?: any;
      onStream?: (event: any) => void;
    } = {};

    if (validated.text) {
      agentInput.text = validated.text;
    } else if (validated.fileData && validated.fileName) {
      const buffer = base64ToBuffer(validated.fileData);
      // Determine MIME type from file extension
      const mime = validated.fileName.endsWith(".pdf")
        ? "application/pdf"
        : "text/plain";
      agentInput.file = { buffer, mime };
    } else {
      return new Response(
        JSON.stringify({ error: "Either text or fileData must be provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Add integration config if provided
    if (validated.integrationConfig) {
      agentInput.integrationConfig = validated.integrationConfig;
    }

    // Create a TransformStream for streaming
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Run the agent with streaming
    agentInput.onStream = (event: any) => {
      const data = `data: ${JSON.stringify(event)}\n\n`;
      writer.write(encoder.encode(data));
    };

    // Start the agent in the background
    runAgent(agentInput)
      .then((projectState) => {
        // Close the stream when done
        writer.close();
      })
      .catch((error) => {
        console.error("Generate error:", error);
        const errorEvent = {
          type: "error",
          message: error instanceof Error ? error.message : "Failed to generate tickets",
        };
        const data = `data: ${JSON.stringify(errorEvent)}\n\n`;
        writer.write(encoder.encode(data));
        writer.close();
      });

    // Return the stream as Server-Sent Events
    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Generate error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to generate tickets",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

