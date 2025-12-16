"use client";

import { useState, useEffect } from "react";
import type { ProjectState } from "../lib/schemas";
import type { IntegrationConfig } from "agent";
import { Upload } from "./components/Upload";
import { TicketsBoard } from "./components/TicketsBoard";
import { ChatEditor } from "./components/ChatEditor";
import { CostMeter } from "./components/CostMeter";
import { IntegrationConfig as IntegrationConfigModal } from "./components/IntegrationConfig";
import { IntegrationStatus } from "./components/IntegrationStatus";
import { PushToIntegration } from "./components/PushToIntegration";
import { ProjectHistory } from "./components/ProjectHistory";

type AppState = "integration" | "upload" | "tickets";

export default function Home() {
  const [state, setState] = useState<AppState>("integration");
  const [projectState, setProjectState] = useState<ProjectState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [generatingTickets, setGeneratingTickets] = useState(false);
  const [validatingTickets, setValidatingTickets] = useState(false);
  const [currentBatch, setCurrentBatch] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [showIntegrationConfig, setShowIntegrationConfig] = useState(false);
  const [integrationConfig, setIntegrationConfig] =
    useState<IntegrationConfig | null>(null);

  const addLog = (message: string) => {
    setLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
  };

  const handleGenerate = async (data: {
    text?: string;
    fileData?: string;
    fileName?: string;
  }) => {
    setIsLoading(true);
    setError(null);
    setLogs([]);
    addLog("Starting ticket generation...");

    try {
      const requestBody: {
        text?: string;
        fileData?: string;
        fileName?: string;
        integrationConfig?: IntegrationConfig;
      } = { ...data };

      // Include integration config if configured
      if (integrationConfig) {
        requestBody.integrationConfig = integrationConfig;
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate tickets");
      }

      // Check if it's a streaming response
      const contentType = response.headers.get("Content-Type");
      if (contentType?.includes("text/event-stream")) {
        // Handle streaming response
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error("No reader available");
        }

        let buffer = "";
        let hasError = false;
        let errorMessage = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));

                // Handle different event types
                if (event.type === "status") {
                  addLog(event.message);

                  // Detect when ticket generation starts
                  if (event.message.includes("Generating tickets")) {
                    setGeneratingTickets(true);
                    setValidatingTickets(false);
                  }

                  // Detect when validation starts
                  if (event.message.includes("Validating tickets")) {
                    setGeneratingTickets(false);
                    setValidatingTickets(true);
                  }
                } else if (event.type === "progress") {
                  addLog(event.message);

                  // Update batch info if available
                  if (event.data?.batch && event.data?.totalBatches) {
                    setCurrentBatch({
                      current: event.data.batch,
                      total: event.data.totalBatches,
                    });
                  }

                  // If message indicates all tickets are done
                  if (
                    event.message.includes("All") &&
                    event.message.includes("ticket(s) generated")
                  ) {
                    setGeneratingTickets(false);
                    setCurrentBatch(null);
                  }

                  // If validation completes (either successfully or with issues)
                  if (
                    event.message.includes("validated successfully") ||
                    event.message.includes("validation issue")
                  ) {
                    setValidatingTickets(false);
                  }
                } else if (event.type === "error") {
                  hasError = true;
                  errorMessage = event.message;
                  setError(event.message);
                  addLog(event.message);
                  setGeneratingTickets(false);
                  setValidatingTickets(false);
                  setCurrentBatch(null);
                } else if (event.type === "complete") {
                  setProjectState(event.data);
                  setGeneratingTickets(false);
                  setValidatingTickets(false);
                  setCurrentBatch(null);
                  addLog("🎉 Tickets generated successfully!");

                  setState("tickets");
                }
              } catch (e) {
                console.error("Failed to parse event:", e);
              }
            }
          }
        }

        // If there was an error during streaming, throw it to stop execution
        if (hasError) {
          throw new Error(errorMessage);
        }
      } else {
        // Fallback to non-streaming response
        const result = await response.json();
        setProjectState(result);
        addLog("✅ Requirements extracted successfully");
        addLog(`Found ${result.tickets?.length || 0} tickets`);
        addLog("🎉 Tickets generated successfully!");
        setState("tickets");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      addLog(`❌ Error: ${errorMessage}`);
    } finally {
      setIsLoading(false);
      setGeneratingTickets(false);
      setValidatingTickets(false);
      setCurrentBatch(null);
    }
  };

  const handleEdit = async (instruction: string) => {
    if (!projectState) return;

    setIsLoading(true);
    setError(null);
    addLog(`Editing tickets: "${instruction}"`);

    try {
      const response = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectState.id,
          instruction,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to edit tickets");
      }

      const result = await response.json();
      setProjectState(result);
      addLog("✅ Tickets updated successfully");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      addLog(`❌ Error: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async (format: "json" | "csv" | "md") => {
    if (!projectState) return;

    addLog(`Exporting as ${format.toUpperCase()}...`);

    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectState.id,
          format,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to export");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectState.requirements.projectName || "project"}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      addLog("✅ Export completed");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      addLog(`❌ Export error: ${errorMessage}`);
    }
  };

  const handleReset = () => {
    setState("integration");
    setProjectState(null);
    setError(null);
    setLogs([]);
    setIntegrationConfig(null);
  };

  const handleLoadProject = async (projectId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) {
        throw new Error("Failed to load project");
      }

      const project = await response.json();
      setProjectState(project);
      setState("tickets");

      // Load integration config if exists
      const configResponse = await fetch(
        `/api/integrations/config?projectId=${projectId}`
      );
      if (configResponse.ok) {
        const configData = await configResponse.json();
        if (configData && configData.type) {
          setIntegrationConfig({
            type: configData.type,
            credentials:
              configData.type === "jira"
                ? { email: "", apiToken: "", baseUrl: "" }
                : { apiKey: "" },
            projectMapping: configData.projectMapping,
          } as IntegrationConfig);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleIntegrationConfigure = (config: IntegrationConfig) => {
    setIntegrationConfig(config);
    setShowIntegrationConfig(false);
    // Integration config will be saved by backend when project is created
    setState("upload");
  };

  const handleIntegrationSkip = () => {
    setIntegrationConfig(null);
    setState("upload");
  };

  // Load integration config when project state is available
  useEffect(() => {
    if (projectState?.id) {
      fetch(`/api/integrations/config?projectId=${projectState.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.type) {
            // We only get type and projectMapping from API, not full config
            // Store minimal info for display - full config will be loaded when modal opens
            setIntegrationConfig({
              type: data.type,
              credentials:
                data.type === "jira"
                  ? { email: "", apiToken: "", baseUrl: "" }
                  : { apiKey: "" },
              projectMapping: data.projectMapping,
            } as IntegrationConfig);
          } else {
            setIntegrationConfig(null);
          }
        })
        .catch((err) => {
          console.error("Failed to load integration:", err);
          setIntegrationConfig(null);
        });
    } else {
      setIntegrationConfig(null);
    }
  }, [projectState?.id]);

  const handleIntegrationSave = async (config: IntegrationConfig) => {
    setIntegrationConfig(config);
    setShowIntegrationConfig(false);
  };

  const handlePushTickets = async (ticketIds?: string[]) => {
    if (!projectState) return { success: false, results: [] };

    const response = await fetch("/api/integrations/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: projectState.id,
        ticketIds,
      }),
    });

    return response.json();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-80 bg-gray-900 text-gray-100 flex flex-col fixed h-screen overflow-y-auto">
        {/* App Name/Logo */}
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            Sprintify
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            AI-powered ticket generation
          </p>
        </div>

        {/* Project History */}
        <ProjectHistory
          onLoadProject={handleLoadProject}
          currentProjectId={projectState?.id}
        />

        {/* Process Status */}
        {isLoading && (
          <div className="p-4 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              <div className="animate-spin h-4 w-4 border-2 border-green-400 border-t-transparent rounded-full"></div>
              <span className="font-semibold text-green-400">
                {validatingTickets
                  ? "Validando..."
                  : generatingTickets && currentBatch
                    ? `Batch ${currentBatch.current}/${currentBatch.total}`
                    : "Processing..."}
              </span>
            </div>
            {generatingTickets && currentBatch && (
              <div className="mt-2">
                <div className="w-full bg-gray-700 rounded-full h-1.5">
                  <div
                    className="bg-green-500 h-1.5 rounded-full transition-all duration-500"
                    style={{
                      width: `${(currentBatch.current / currentBatch.total) * 100}%`,
                    }}
                  ></div>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {Math.round(
                    (currentBatch.current / currentBatch.total) * 100
                  )}
                  % completado
                </p>
              </div>
            )}
          </div>
        )}

        {/* Logs */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-xs uppercase font-semibold text-gray-500 mb-3">
              Process Log
            </h2>
            {logs.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No activity yet...</p>
            ) : (
              <div className="space-y-1.5 font-mono text-xs">
                {logs.map((log, i) => (
                  <div
                    key={i}
                    className="text-green-400 animate-fadeIn break-words"
                  >
                    {log}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Info */}
        {projectState && (
          <div className="p-4 border-t border-gray-800 bg-gray-800">
            <div className="text-xs space-y-1">
              <div className="flex justify-between text-gray-400">
                <span>Tickets:</span>
                <span className="text-white font-semibold">
                  {projectState.tickets?.length || 0}
                </span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Cost:</span>
                <span className="text-green-400 font-semibold">
                  ${projectState.cost?.usd?.toFixed(4) || "0.0000"}
                </span>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-80 p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 font-medium">❌ Error</p>
              <p className="text-red-700 text-sm mt-1">{error}</p>
            </div>
          )}

          {/* Ticket Generation Progress with Skeletons */}
          {state !== "tickets" &&
          ((generatingTickets && currentBatch) || validatingTickets) ? (
            <div className="p-6 mb-6">
              {generatingTickets && currentBatch && (
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Generando Tickets - Sección {currentBatch.current}/
                      {currentBatch.total}
                    </h3>
                    <span className="text-sm text-gray-600">
                      {Math.round(
                        (currentBatch.current / currentBatch.total) * 100
                      )}
                      %
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                      style={{
                        width: `${(currentBatch.current / currentBatch.total) * 100}%`,
                      }}
                    ></div>
                  </div>
                </div>
              )}

              {validatingTickets && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Validando Tickets
                    </h3>
                    <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                  </div>
                </div>
              )}

              {/* Skeleton Tickets */}
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {[...Array(12)].map((_, i) => (
                  <div
                    key={i}
                    className="animate-pulse bg-gray-100 rounded-lg p-4 border border-gray-200"
                  >
                    <div className="h-4 bg-gray-300 rounded w-3/4 mb-3"></div>
                    <div className="h-3 bg-gray-200 rounded w-full mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-5/6 mb-3"></div>
                    <div className="h-3 bg-gray-200 rounded w-full mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-5/6 mb-3"></div>
                    <div className="h-3 bg-gray-200 rounded w-full mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-5/6 mb-3"></div>
                    <div className="flex gap-2 mt-3">
                      <div className="h-6 bg-gray-200 rounded-full w-16"></div>
                      <div className="h-6 bg-gray-200 rounded-full w-12"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Integration State */}
          {state === "integration" && (
            <div className="w-full max-w-4xl mx-auto">
              <IntegrationConfigModal
                projectId={crypto.randomUUID()} // Temporary ID, will be replaced when project is created
                onSave={handleIntegrationConfigure}
                onClose={() => {}}
                existingConfig={integrationConfig}
                inline={true}
                onSkip={handleIntegrationSkip}
              />
            </div>
          )}

          {/* Upload State */}
          {state === "upload" &&
            !((generatingTickets && currentBatch) || validatingTickets) && (
              <Upload
                onGenerate={handleGenerate}
                isLoading={isLoading}
                integrationConfig={integrationConfig}
                onConfigureIntegration={() => setState("integration")}
              />
            )}

          {/* Tickets State */}
          {state === "tickets" && projectState && projectState.tickets && (
            <>
              {/* Action Bar */}
              <div className="flex flex-wrap gap-3 items-center justify-between bg-white p-4 rounded-lg border border-gray-200">
                <div className="flex gap-2 items-center">
                  <button
                    onClick={() => handleExport("json")}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Export JSON
                  </button>
                  <button
                    onClick={() => handleExport("csv")}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Export CSV
                  </button>
                  <button
                    onClick={() => handleExport("md")}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Export Markdown
                  </button>
                  <div className="border-l border-gray-300 h-6 mx-2" />
                  <IntegrationStatus
                    projectId={projectState.id}
                    onConfigure={() => setShowIntegrationConfig(true)}
                  />
                  {integrationConfig && (
                    <PushToIntegration
                      projectId={projectState.id}
                      tickets={projectState.tickets}
                      onPush={handlePushTickets}
                      integrationConfig={integrationConfig}
                    />
                  )}
                </div>
                <button
                  onClick={handleReset}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  New Project
                </button>
              </div>

              {/* Chat Editor */}
              <ChatEditor onEdit={handleEdit} isLoading={isLoading} />

              {/* Tickets Board */}
              <TicketsBoard
                tickets={projectState.tickets || []}
                projectName={projectState.requirements?.projectName}
              />
            </>
          )}

          {/* Integration Config Modal */}
          {showIntegrationConfig && projectState && (
            <IntegrationConfigModal
              projectId={projectState.id}
              onSave={handleIntegrationSave}
              onClose={() => setShowIntegrationConfig(false)}
              existingConfig={integrationConfig}
            />
          )}
        </div>
      </main>
    </div>
  );
}
