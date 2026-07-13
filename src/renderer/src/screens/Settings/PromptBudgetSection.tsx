import { useCallback, useEffect, useState } from "react";

interface PromptSizeBreakdown {
  total?: number;
  limit?: number;
  breakdown?: Record<string, number>;
  [key: string]: number | Record<string, number> | undefined;
}

export function PromptBudgetSection({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const [promptSize, setPromptSize] = useState<PromptSizeBreakdown | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const raw = await window.hermesAPI.getPromptSizeBreakdown(profile);
      setPromptSize(JSON.parse(raw) as PromptSizeBreakdown);
    } catch (error) {
      console.error("Failed to parse prompt budget size breakdown:", error);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = promptSize?.total || 0;
  const limit = promptSize?.limit || 8192;
  const percent = Math.min(Math.round((total / limit) * 100), 100);
  const breakdown: Record<string, number> = {};
  const source = promptSize?.breakdown || promptSize || {};
  for (const [key, value] of Object.entries(source)) {
    if (
      key !== "total" &&
      key !== "limit" &&
      key !== "breakdown" &&
      typeof value === "number"
    ) {
      breakdown[key] = value;
    }
  }

  return (
    <div className="settings-section" data-section-tab="troubleshooting">
      <div className="settings-section-title">Context Window</div>
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 12 }}>
          This visualizer shows the token usage budget for My Assistant&apos;s
          profile context window. If the prompt exceeds the model&apos;s budget,
          some memory or history may be truncated.
        </div>
        {loading ? (
          <div className="settings-loading prompt-budget-loading">
            <div className="loading-spinner prompt-budget-spinner" />
            <span className="settings-field-hint">
              Loading prompt size breakdown...
            </span>
          </div>
        ) : promptSize ? (
          <div>
            <div className="prompt-budget-header">
              <span>
                Usage: {total.toLocaleString()} / {limit.toLocaleString()}{" "}
                tokens
              </span>
              <span>{percent}%</span>
            </div>
            <div className="prompt-budget-progress-track">
              <div
                className={`prompt-budget-progress-bar ${
                  percent > 90
                    ? "bar-danger"
                    : percent > 75
                      ? "bar-warning"
                      : "bar-success"
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
            {Object.keys(breakdown).length > 0 ? (
              <div className="prompt-budget-grid">
                {Object.entries(breakdown).map(([key, value]) => {
                  const itemPercent =
                    limit > 0 ? Math.round((value / limit) * 100) : 0;
                  return (
                    <div key={key} className="prompt-budget-card">
                      <div className="prompt-budget-card-title">
                        {key.replace(/_/g, " ")}
                      </div>
                      <div className="prompt-budget-card-value">
                        {value.toLocaleString()}{" "}
                        <span className="prompt-budget-card-percent">
                          ({itemPercent}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="settings-field-hint">No breakdown available.</div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="settings-field-hint">
              No prompt budget data loaded.
            </span>
            <button className="btn btn-secondary" onClick={() => void load()}>
              Reload
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
