import { useCallback, useEffect, useState } from "react";
import type { VaultProposal } from "../../../../../shared/sps-types";
import type { HumanAttentionItem } from "../../../../../shared/human-attention";
import { respondApproval } from "../../../lib/api/chat";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { commitVaultProposal } from "./commitVaultProposal";

interface ReviewQueueSurfaceProps {
  profile?: string;
}

export function ReviewQueueSurface({
  profile = "default",
}: ReviewQueueSurfaceProps): React.JSX.Element {
  const ingestCommitPage = useStore((s) => s.ingestCommitPage);
  const flash = useStore((s) => s.flash);
  const setSurface = useStore((s) => s.setSurface);
  const selectPage = useStore((s) => s.selectPage);
  const [proposals, setProposals] = useState<VaultProposal[]>([]);
  const [attention, setAttention] = useState<HumanAttentionItem[]>([]);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [proposalRows, attentionRows] = await Promise.all([
        window.hermesAPI.spsListVaultProposals?.(profile),
        window.hermesAPI.spsListHumanAttention({}, profile),
      ]);
      setProposals(proposalRows ?? []);
      setAttention(attentionRows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [profile]);

  useEffect(() => {
    load().catch((loadError: unknown) => {
      console.error("[Review Queue] Failed to load proposals:", loadError);
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    });
  }, [load]);

  const pending = proposals.filter((proposal) => proposal.status === "pending");

  const selectedFor = (proposal: VaultProposal): Set<string> =>
    selected[proposal.id] ?? new Set(proposal.operations.map((op) => op.id));

  const toggleOperation = (
    proposal: VaultProposal,
    operationId: string,
  ): void => {
    setSelected((prev) => {
      const next = new Set(selectedFor(proposal));
      if (next.has(operationId)) next.delete(operationId);
      else next.add(operationId);
      return { ...prev, [proposal.id]: next };
    });
  };

  const apply = async (proposal: VaultProposal): Promise<void> => {
    setBusy(proposal.id);
    setError("");
    try {
      const picked = selectedFor(proposal);
      await commitVaultProposal(proposal, {
        profile,
        selectedOperationIds: picked,
        commitPage: ingestCommitPage,
      });
      flash(
        `Applied ${picked.size} vault operation${picked.size === 1 ? "" : "s"}`,
      );
      await window.hermesAPI.spsAppendWikiLog?.(
        "ingest",
        proposal.summary,
        profile,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const dismiss = async (proposal: VaultProposal): Promise<void> => {
    setBusy(proposal.id);
    try {
      await window.hermesAPI.spsDismissVaultProposal?.(proposal.id, profile);
      await load();
    } finally {
      setBusy("");
    }
  };

  const resolveAttention = async (
    item: HumanAttentionItem,
    choiceId: string,
  ): Promise<void> => {
    setBusy(item.id);
    setError("");
    try {
      if (
        item.kind === "approval" &&
        item.requestId &&
        (choiceId === "once" || choiceId === "deny")
      ) {
        const upstream = await respondApproval(
          item.requestId,
          choiceId,
          profile,
        );
        if (!upstream.ok) {
          throw new Error(
            upstream.error || "Hermes could not accept this approval response.",
          );
        }
      }
      const result = await window.hermesAPI.spsResolveHumanAttention(
        item.id,
        { choiceId },
        profile,
      );
      if (!result.ok)
        throw new Error(result.error || "Could not resolve item.");
      await load();
      if (choiceId === "review-run" && item.resume?.kind === "active-work") {
        setSurface("activeWork");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const openPage = (pageId: string): void => {
    selectPage(pageId);
    setSurface("doc");
  };

  return (
    <div className="inbox-surface">
      <header className="inbox-header-mb">
        <h1 className="inbox-title">
          <Icon name="check" size={22} />
          Needs Attention
        </h1>
        <p className="inbox-subtitle">
          Decisions, blocked work, failures, and proposed workspace changes are
          held here until you handle them.
        </p>
      </header>

      {error && <div className="inbox-error">{error}</div>}

      {attention.length > 0 && (
        <section aria-labelledby="attention-items-title">
          <h2 id="attention-items-title">Assistant check-ins</h2>
          <ul className="inbox-card-list">
            {attention.map((item) => (
              <li key={item.id} className="inbox-proposed-page">
                <div className="inbox-flex-align-center-gap8-mb6">
                  <span className="inbox-card-badge">
                    {item.kind.replaceAll("-", " ")}
                  </span>
                  <strong>{item.title}</strong>
                </div>
                <div className="inbox-proposal-summary">{item.summary}</div>
                <div className="inbox-flex-align-center-gap8-mb6">
                  {item.choices.map((choice) => (
                    <button
                      key={choice.id}
                      className={
                        choice.tone === "primary"
                          ? "btn btn-primary btn-sm"
                          : "btn btn-ghost btn-sm"
                      }
                      disabled={busy === item.id}
                      onClick={() => void resolveAttention(item, choice.id)}
                    >
                      {busy === item.id ? "Saving..." : choice.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending.length === 0 && attention.length === 0 ? (
        <div className="inbox-empty-notice">Nothing needs your attention.</div>
      ) : pending.length > 0 ? (
        <ul className="inbox-card-list">
          {pending.map((proposal) => {
            const picked = selectedFor(proposal);
            return (
              <li key={proposal.id} className="inbox-proposed-page">
                <div className="inbox-flex-align-center-gap8-mb6">
                  <span className="inbox-card-badge">{proposal.source}</span>
                  <strong>{proposal.title}</strong>
                  <span className="flex-grow" />
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy === proposal.id}
                    onClick={() => void dismiss(proposal)}
                  >
                    Dismiss
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === proposal.id || picked.size === 0}
                    onClick={() => void apply(proposal)}
                  >
                    {busy === proposal.id ? "Applying..." : "Apply selected"}
                  </button>
                </div>
                <div className="inbox-proposal-summary">{proposal.summary}</div>
                <ul className="health-list">
                  {proposal.operations.map((operation) => (
                    <li key={operation.id} className="health-row">
                      <input
                        type="checkbox"
                        checked={picked.has(operation.id)}
                        onChange={() => toggleOperation(proposal, operation.id)}
                      />
                      <span className="health-mono-text">{operation.kind}</span>
                      {"pageId" in operation && (
                        <button
                          className="health-link"
                          onClick={() => openPage(operation.pageId)}
                        >
                          {operation.pageId}
                        </button>
                      )}
                      {operation.kind === "create-task" && (
                        <span className="health-mono-text">
                          tasks/{operation.rowId} · {operation.title}
                        </span>
                      )}
                      {operation.kind === "enrich-contact" && (
                        <span
                          className="health-mono-text"
                          style={{ opacity: 0.75 }}
                        >
                          {[
                            ...operation.fragments.map((f) => f.text),
                            ...operation.tags.map((t) => `#${t}`),
                          ].join(" · ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
