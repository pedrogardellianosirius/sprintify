"use client";

import { useState, useEffect } from "react";
import type { IntegrationConfig } from "agent";

interface IntegrationStatusProps {
  projectId: string;
  onConfigure: () => void;
}

interface IntegrationInfo {
  type: "jira" | "linear";
  projectMapping: {
    externalProjectKey: string;
    externalProjectName?: string;
    teamId?: string;
    projectId?: string;
  };
}

export function IntegrationStatus({
  projectId,
  onConfigure,
}: IntegrationStatusProps) {
  const [integration, setIntegration] = useState<IntegrationInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadIntegration();
  }, [projectId]);

  const loadIntegration = async () => {
    try {
      const response = await fetch(
        `/api/integrations/config?projectId=${projectId}`
      );
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setIntegration(data);
        }
      }
    } catch (error) {
      console.error("Failed to load integration:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return null;
  }

  if (!integration) {
    return (
      <button
        onClick={onConfigure}
        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
      >
        Configure Integration
      </button>
    );
  }

  return (
    <button
      onClick={onConfigure}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
        integration.type === "jira"
          ? "bg-blue-50 hover:bg-blue-100 text-blue-700"
          : "bg-purple-50 hover:bg-purple-100 text-purple-700"
      }`}
    >
      <span className="w-2 h-2 bg-green-500 rounded-full"></span>
      Connected to {integration.type === "jira" ? "Jira" : "Linear"}
      {integration.projectMapping.externalProjectKey && (
        <span className="text-xs opacity-75">
          ({integration.projectMapping.externalProjectKey})
        </span>
      )}
    </button>
  );
}
