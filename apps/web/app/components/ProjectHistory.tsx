"use client";

import { useState, useEffect } from "react";

interface Project {
  id: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  ticketCount: number;
}

interface ProjectHistoryProps {
  onLoadProject: (projectId: string) => void;
  currentProjectId?: string;
}

export function ProjectHistory({
  onLoadProject,
  currentProjectId,
}: ProjectHistoryProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadProjects = async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/projects");
      if (response.ok) {
        const data = await response.json();
        setProjects(data);
      }
    } catch (error) {
      console.error("Failed to load projects:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  return (
    <div className="p-4 border-b border-gray-800">
      <h2 className="text-xs uppercase font-semibold text-gray-500 mb-3">
        Project History
      </h2>
      {isLoading ? (
        <p className="text-sm text-gray-500 italic">Loading...</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No projects yet</p>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => onLoadProject(project.id)}
              className={`w-full text-left p-2 rounded-lg transition-colors ${
                currentProjectId === project.id
                  ? "bg-gray-800 text-white"
                  : "bg-gray-800/50 hover:bg-gray-800 text-gray-300 hover:text-white"
              }`}
            >
              <div className="font-medium text-sm truncate">
                {project.projectName}
              </div>
              <div className="text-xs text-gray-400 mt-1 flex items-center justify-between">
                <span>{formatDate(project.updatedAt)}</span>
                <span className="text-gray-500">
                  {project.ticketCount} ticket
                  {project.ticketCount !== 1 ? "s" : ""}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
