"use client";

import { useState, useEffect } from "react";
import type { IntegrationConfig } from "agent";

interface IntegrationConfigProps {
  projectId: string;
  onSave: (config: IntegrationConfig) => void;
  onClose: () => void;
  existingConfig?: IntegrationConfig | null;
  inline?: boolean; // If true, render as inline step instead of modal
  onSkip?: () => void; // Callback for skip button (only shown in inline mode)
}

export function IntegrationConfig({
  projectId,
  onSave,
  onClose,
  existingConfig,
  inline = false,
  onSkip,
}: IntegrationConfigProps) {
  const [type, setType] = useState<"jira" | "linear">(
    existingConfig?.type || "jira"
  );
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [linearApiKey, setLinearApiKey] = useState("");
  const [linearTeamId, setLinearTeamId] = useState("");
  const [linearProjectId, setLinearProjectId] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (existingConfig) {
      setType(existingConfig.type);
      if (existingConfig.type === "jira") {
        const creds = existingConfig.credentials as {
          email: string;
          apiToken: string;
          baseUrl: string;
        };
        setJiraEmail(creds.email);
        setJiraApiToken(creds.apiToken);
        setJiraBaseUrl(creds.baseUrl);
        setJiraProjectKey(existingConfig.projectMapping.externalProjectKey);
      } else {
        const creds = existingConfig.credentials as { apiKey: string };
        setLinearApiKey(creds.apiKey);
        setLinearTeamId(
          existingConfig.projectMapping.teamId ||
            existingConfig.projectMapping.externalProjectKey
        );
        setLinearProjectId(existingConfig.projectMapping.projectId || "");
      }
    }
  }, [existingConfig]);

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const config: IntegrationConfig = {
        type,
        credentials:
          type === "jira"
            ? {
                email: jiraEmail,
                apiToken: jiraApiToken,
                baseUrl: jiraBaseUrl,
              }
            : {
                apiKey: linearApiKey,
              },
        projectMapping:
          type === "jira"
            ? {
                externalProjectKey: jiraProjectKey,
              }
            : {
                externalProjectKey: linearTeamId,
                teamId: linearTeamId,
                projectId: linearProjectId || undefined,
              },
      };

      const response = await fetch("/api/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: config.type,
          credentials: config.credentials,
          projectMapping: config.projectMapping,
        }),
      });

      const result = await response.json();
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to test connection",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);

    try {
      const config: IntegrationConfig = {
        type,
        credentials:
          type === "jira"
            ? {
                email: jiraEmail,
                apiToken: jiraApiToken,
                baseUrl: jiraBaseUrl,
              }
            : {
                apiKey: linearApiKey,
              },
        projectMapping:
          type === "jira"
            ? {
                externalProjectKey: jiraProjectKey,
              }
            : {
                externalProjectKey: linearTeamId,
                teamId: linearTeamId,
                projectId: linearProjectId || undefined,
              },
      };

      // In inline mode, don't save to API - backend will handle it when project is created
      if (!inline) {
        await fetch("/api/integrations/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, config }),
        });
      }

      onSave(config);
    } catch (error) {
      console.error("Failed to save:", error);
      alert("Failed to save integration config");
    } finally {
      setIsSaving(false);
    }
  };

  const canTest =
    type === "jira"
      ? jiraEmail && jiraApiToken && jiraBaseUrl && jiraProjectKey
      : linearApiKey && linearTeamId;

  const canSave = canTest && testResult?.success;

  const content = (
    <div
      className={
        inline
          ? "w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md"
          : "bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
      }
    >
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Configure Integration</h2>
        {!inline && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        )}
      </div>

      {/* Integration Type Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">
          Integration Type
        </label>
        <div className="flex gap-4">
          <label className="flex items-center">
            <input
              type="radio"
              value="jira"
              checked={type === "jira"}
              onChange={(e) => setType(e.target.value as "jira")}
              className="mr-2"
            />
            Jira
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              value="linear"
              checked={type === "linear"}
              onChange={(e) => setType(e.target.value as "linear")}
              className="mr-2"
            />
            Linear
          </label>
        </div>
      </div>

      {/* Jira Form */}
      {type === "jira" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg"
              placeholder="your-email@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              API Token <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={jiraApiToken}
              onChange={(e) => setJiraApiToken(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg"
              placeholder="Your Jira API token"
            />
            <a
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              Generate API token
            </a>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Base URL <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              value={jiraBaseUrl}
              onChange={(e) => setJiraBaseUrl(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg"
              placeholder="https://your-domain.atlassian.net"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Project Key <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={jiraProjectKey}
              onChange={(e) => setJiraProjectKey(e.target.value.toUpperCase())}
              className="w-full p-2 border border-gray-300 rounded-lg"
              placeholder="PROJ"
            />
          </div>
        </div>
      )}

      {/* Linear Form */}
      {type === "linear" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              API Key <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={linearApiKey}
              onChange={(e) => setLinearApiKey(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg"
              placeholder="Your Linear API key"
            />
            <a
              href="https://linear.app/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              Get API key
            </a>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Team ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={linearTeamId}
              onChange={(e) => setLinearTeamId(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg"
              placeholder="Team ID"
            />
            <p className="text-sm text-gray-500 mt-1">
              Find your Team ID in Linear settings
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Project ID <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="text"
              value={linearProjectId}
              onChange={(e) => setLinearProjectId(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg"
              placeholder="Project ID (optional)"
            />
          </div>
        </div>
      )}

      {/* Test Result */}
      {testResult && (
        <div
          className={`mt-4 p-3 rounded-lg ${
            testResult.success
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          {testResult.message}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 mt-6">
        <button
          onClick={handleTest}
          disabled={!canTest || isTesting}
          className={`px-4 py-2 rounded-lg font-medium ${
            canTest && !isTesting
              ? "bg-gray-100 hover:bg-gray-200 text-gray-700"
              : "bg-gray-300 text-gray-500 cursor-not-allowed"
          }`}
        >
          {isTesting ? "Testing..." : "Test Connection"}
        </button>
        <div className="flex-1" />
        {inline && onSkip && (
          <button
            onClick={onSkip}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium"
          >
            Skip Integration
          </button>
        )}
        {!inline && (
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={!canSave || isSaving}
          className={`px-4 py-2 rounded-lg font-medium ${
            canSave && !isSaving
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "bg-gray-300 text-gray-500 cursor-not-allowed"
          }`}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );

  if (inline) {
    return content;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      {content}
    </div>
  );
}
