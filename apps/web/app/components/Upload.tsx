"use client";

import { useState, useCallback } from "react";
import { fileToBase64 } from "../../lib/adapters";

interface UploadProps {
  onGenerate: (data: {
    text?: string;
    fileData?: string;
    fileName?: string;
  }) => void;
  isLoading: boolean;
  integrationConfig?: { type: "jira" | "linear"; projectMapping: any } | null;
  onConfigureIntegration?: () => void;
}

export function Upload({
  onGenerate,
  isLoading,
  integrationConfig,
  onConfigureIntegration,
}: UploadProps) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setText(""); // Clear text if file is uploaded
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setText(""); // Clear text if file is uploaded
    }
  };

  const handleSubmit = async () => {
    if (file) {
      const base64 = await fileToBase64(file);
      onGenerate({ fileData: base64, fileName: file.name });
    } else if (text.trim()) {
      onGenerate({ text: text.trim() });
    }
  };

  const canSubmit = (text.trim().length > 0 || file !== null) && !isLoading;

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Upload Requirements</h2>
        {onConfigureIntegration && (
          <div className="flex items-center gap-3">
            {integrationConfig ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">
                  {integrationConfig.type === "jira" ? "🔗 Jira" : "🔗 Linear"}{" "}
                  configured
                </span>
                <button
                  onClick={onConfigureIntegration}
                  className="text-blue-600 hover:text-blue-700 underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <button
                onClick={onConfigureIntegration}
                className="text-sm text-blue-600 hover:text-blue-700 underline"
              >
                Configure Integration
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {/* File upload area */}
        <div
          className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 hover:border-gray-400"
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept=".pdf,.txt"
            onChange={handleFileChange}
            disabled={isLoading}
          />
          <label htmlFor="file-upload" className="cursor-pointer">
            <div className="text-gray-600">
              {file ? (
                <div>
                  <p className="font-medium text-blue-600">{file.name}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Click to change file
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-medium">Drop your PDF or text file here</p>
                  <p className="text-sm text-gray-500 mt-1">
                    or click to browse (max 5MB)
                  </p>
                </div>
              )}
            </div>
          </label>
        </div>

        {/* OR divider */}
        <div className="flex items-center gap-4">
          <div className="flex-1 border-t border-gray-300"></div>
          <span className="text-gray-500 text-sm font-medium">OR</span>
          <div className="flex-1 border-t border-gray-300"></div>
        </div>

        {/* Text area */}
        <div>
          <label
            htmlFor="text-input"
            className="block text-sm font-medium mb-2"
          >
            Paste your requirements
          </label>
          <textarea
            id="text-input"
            className="w-full h-48 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            placeholder="Paste your project requirements or proposal here..."
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim()) {
                setFile(null); // Clear file if text is entered
              }
            }}
            disabled={isLoading}
          />
        </div>

        {/* Generate button */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`w-full py-3 px-6 rounded-lg font-medium transition-colors ${
            canSubmit
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "bg-gray-300 text-gray-500 cursor-not-allowed"
          }`}
        >
          {isLoading ? "Generating..." : "Generate Tickets"}
        </button>
      </div>
    </div>
  );
}
