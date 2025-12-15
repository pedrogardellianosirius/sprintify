"use client";

import { useState } from "react";
import type { Ticket } from "../../lib/schemas";
import type { IntegrationConfig } from "agent";

interface PushToIntegrationProps {
  projectId: string;
  tickets: Ticket[];
  onPush: (ticketIds?: string[]) => Promise<{
    success: boolean;
    results: Array<{ ticketId: string; externalKey?: string; error?: string }>;
  }>;
  integrationConfig?: IntegrationConfig | null;
}

export function PushToIntegration({
  projectId,
  tickets,
  onPush,
  integrationConfig,
}: PushToIntegrationProps) {
  const [isPushing, setIsPushing] = useState(false);
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(
    new Set()
  );
  const [showSelection, setShowSelection] = useState(false);
  const [pushResult, setPushResult] = useState<{
    success: boolean;
    results: Array<{ ticketId: string; externalKey?: string; error?: string }>;
  } | null>(null);

  if (!integrationConfig) {
    return null;
  }

  const handlePushAll = async () => {
    setIsPushing(true);
    setPushResult(null);

    try {
      const result = await onPush();
      setPushResult(result);
    } catch (error) {
      setPushResult({
        success: false,
        results: [],
      });
    } finally {
      setIsPushing(false);
    }
  };

  const handlePushSelected = async () => {
    if (selectedTickets.size === 0) {
      return;
    }

    setIsPushing(true);
    setPushResult(null);

    try {
      const result = await onPush(Array.from(selectedTickets));
      setPushResult(result);
      setShowSelection(false);
      setSelectedTickets(new Set());
    } catch (error) {
      setPushResult({
        success: false,
        results: [],
      });
    } finally {
      setIsPushing(false);
    }
  };

  const toggleTicket = (ticketId: string) => {
    const newSelected = new Set(selectedTickets);
    if (newSelected.has(ticketId)) {
      newSelected.delete(ticketId);
    } else {
      newSelected.add(ticketId);
    }
    setSelectedTickets(newSelected);
  };

  const successCount =
    pushResult?.results.filter((r) => r.externalKey && !r.error).length || 0;
  const errorCount = pushResult?.results.filter((r) => r.error).length || 0;

  return (
    <div className="relative">
      <div className="flex gap-2">
        <button
          onClick={handlePushAll}
          disabled={isPushing}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            isPushing
              ? "bg-gray-300 text-gray-500 cursor-not-allowed"
              : "bg-green-600 hover:bg-green-700 text-white"
          }`}
        >
          {isPushing
            ? "Pushing..."
            : `Push All to ${integrationConfig.type === "jira" ? "Jira" : "Linear"}`}
        </button>
        <button
          onClick={() => setShowSelection(!showSelection)}
          disabled={isPushing}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            isPushing
              ? "bg-gray-300 text-gray-500 cursor-not-allowed"
              : "bg-gray-100 hover:bg-gray-200 text-gray-700"
          }`}
        >
          Select Tickets
        </button>
      </div>

      {/* Selection Dropdown */}
      {showSelection && (
        <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-10 max-h-96 overflow-y-auto min-w-[400px]">
          <div className="mb-3 flex justify-between items-center">
            <h3 className="font-medium">
              Select Tickets ({selectedTickets.size} selected)
            </h3>
            <button
              onClick={() => {
                setSelectedTickets(new Set(tickets.map((t) => t.id)));
              }}
              className="text-sm text-blue-600 hover:underline"
            >
              Select All
            </button>
          </div>
          <div className="space-y-2 mb-4">
            {tickets.map((ticket) => (
              <label
                key={ticket.id}
                className="flex items-start gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedTickets.has(ticket.id)}
                  onChange={() => toggleTicket(ticket.id)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">{ticket.title}</div>
                  <div className="text-xs text-gray-500">{ticket.id}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowSelection(false);
                setSelectedTickets(new Set());
              }}
              className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
            >
              Cancel
            </button>
            <button
              onClick={handlePushSelected}
              disabled={selectedTickets.size === 0 || isPushing}
              className={`px-3 py-1 text-sm rounded ${
                selectedTickets.size > 0 && !isPushing
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              }`}
            >
              Push Selected ({selectedTickets.size})
            </button>
          </div>
        </div>
      )}

      {/* Push Result */}
      {pushResult && (
        <div
          className={`mt-3 p-3 rounded-lg ${
            pushResult.success
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          {pushResult.success ? (
            <div>
              <div className="font-medium">
                Successfully pushed {successCount} ticket(s)
              </div>
              {errorCount > 0 && (
                <div className="text-sm mt-1">
                  {errorCount} ticket(s) failed to push
                </div>
              )}
              {pushResult.results.length > 0 && (
                <div className="text-xs mt-2 space-y-1">
                  {pushResult.results
                    .filter((r) => r.externalKey)
                    .map((r) => (
                      <div key={r.ticketId}>
                        {r.ticketId} → {r.externalKey}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <div>Failed to push tickets. Please try again.</div>
          )}
        </div>
      )}
    </div>
  );
}
