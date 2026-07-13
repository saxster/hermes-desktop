import type {
  LearningProposal,
  SkillUsageEntry,
} from "../../../../../shared/learning";
import { MemoryTimeline } from "../you/MemoryTimeline";

export interface SkillRow {
  name: string;
  category: string;
  description: string;
  path: string;
}

export interface LocalSkill {
  name: string;
  description: string;
  category: string;
  source: string;
  sourcePath: string;
}

export function MemoriesTab({
  pending,
  memoryDraft,
  setMemoryDraft,
  proposeMemory,
  accept,
  dismiss,
  profile,
  refresh,
  busy,
}: {
  pending: LearningProposal[];
  memoryDraft: string;
  setMemoryDraft: (value: string) => void;
  proposeMemory: () => void;
  accept: (id: string) => void;
  dismiss: (id: string) => void;
  profile: string;
  refresh: () => void;
  busy: string;
}): React.JSX.Element {
  return (
    <>
      <section className="settings-section">
        <div className="settings-section-title">Pending memories</div>
        <div className="settings-field-hint learning-surface-hint">
          Review facts before they become durable memory.
        </div>
        <textarea
          className="memory-entry-textarea"
          value={memoryDraft}
          onChange={(event) => setMemoryDraft(event.target.value)}
          placeholder="Add a fact My Assistant should remember."
          rows={2}
        />
        <div className="memory-entry-form-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={proposeMemory}
            disabled={busy === "memory" || !memoryDraft.trim()}
          >
            Propose memory
          </button>
        </div>
        {pending.length === 0 ? (
          <div className="memory-empty learning-surface-empty-mt">
            No pending memories.
          </div>
        ) : (
          <div className="you-rules-list learning-surface-list-mt">
            {pending.map((proposal) => (
              <div key={proposal.id} className="memory-entry-card">
                <span className="memory-entry-content">
                  {proposal.kind === "memory" ? proposal.body : ""}
                  {proposal.kind === "memory" && proposal.reason && (
                    <small className="learning-surface-small-block">
                      {proposal.reason}
                    </small>
                  )}
                </span>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => accept(proposal.id)}
                >
                  Accept
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => dismiss(proposal.id)}
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Learned memories</div>
        <MemoryTimeline profile={profile} onRefresh={refresh} />
      </section>
    </>
  );
}

export function SkillsTab(props: {
  pending: LearningProposal[];
  installed: SkillRow[];
  disabled: SkillRow[];
  localSkills: LocalSkill[];
  usage: Record<string, SkillUsageEntry>;
  selectedSkill: { name: string; content: string } | null;
  skillName: string;
  setSkillName: (value: string) => void;
  skillDescription: string;
  setSkillDescription: (value: string) => void;
  skillBody: string;
  setSkillBody: (value: string) => void;
  repoPath: string;
  setRepoPath: (value: string) => void;
  accept: (id: string) => void;
  dismiss: (id: string) => void;
  viewSkill: (skill: SkillRow) => void;
  toggleSkill: (skill: SkillRow, enabled: boolean) => void;
  uninstallSkill: (skill: SkillRow) => void;
  createSkill: () => void;
  generateDraft: () => void;
  importSkill: (skill: LocalSkill) => void;
  busy: string;
}): React.JSX.Element {
  return (
    <>
      <section className="settings-section">
        <div className="settings-section-title">Pending skill drafts</div>
        {props.pending.length === 0 ? (
          <div className="memory-empty">No pending skill drafts.</div>
        ) : (
          props.pending.map((proposal) =>
            proposal.kind === "skill" ? (
              <div key={proposal.id} className="memory-entry-card">
                <span className="memory-entry-content">
                  <strong>{proposal.draft.name}</strong>
                  <small className="learning-surface-small-block">
                    {proposal.draft.description}
                  </small>
                </span>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => props.accept(proposal.id)}
                >
                  Accept
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => props.dismiss(proposal.id)}
                >
                  Dismiss
                </button>
              </div>
            ) : null,
          )
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Installed skills</div>
        {[...props.installed, ...props.disabled].map((skill) => {
          const enabled = props.installed.some(
            (item) => item.path === skill.path,
          );
          const usage = props.usage[skill.path];
          return (
            <div key={skill.path} className="memory-entry-card">
              <span className="memory-entry-content">
                <strong>{skill.name}</strong>
                <small className="learning-surface-small-block">
                  {usageSummary(usage)}
                </small>
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => props.viewSkill(skill)}
              >
                View
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => props.toggleSkill(skill, !enabled)}
              >
                {enabled ? "Disable" : "Enable"}
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  if (
                    window.confirm(
                      `Are you sure you want to uninstall and permanently delete "${skill.name}"?`,
                    )
                  ) {
                    props.uninstallSkill(skill);
                  }
                }}
              >
                Uninstall
              </button>
            </div>
          );
        })}
        {props.selectedSkill && (
          <pre className="config-health-output learning-surface-pre-mt">
            {props.selectedSkill.content}
          </pre>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Create skill</div>
        <input
          className="inbox-input"
          aria-label="Skill name"
          placeholder="Skill name"
          value={props.skillName}
          onChange={(event) => props.setSkillName(event.target.value)}
        />
        <input
          className="inbox-input"
          aria-label="Skill description"
          placeholder="When should My Assistant use it?"
          value={props.skillDescription}
          onChange={(event) => props.setSkillDescription(event.target.value)}
        />
        <textarea
          className="memory-entry-textarea"
          aria-label="Skill body"
          placeholder="# Skill instructions"
          rows={5}
          value={props.skillBody}
          onChange={(event) => props.setSkillBody(event.target.value)}
        />
        <button className="btn btn-primary btn-sm" onClick={props.createSkill}>
          Create skill
        </button>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Generate from repo</div>
        <input
          className="inbox-input"
          aria-label="Repository path"
          placeholder="/path/to/repo"
          value={props.repoPath}
          onChange={(event) => props.setRepoPath(event.target.value)}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={props.generateDraft}
        >
          Generate draft
        </button>
      </section>

      {props.localSkills.length > 0 && (
        <section className="settings-section">
          <div className="settings-section-title">Import local skills</div>
          {props.localSkills.map((skill) => (
            <div key={skill.sourcePath} className="memory-entry-card">
              <span className="memory-entry-content">{skill.name}</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => props.importSkill(skill)}
              >
                Import
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

export function CuratorTab({
  status,
  archived,
  manualSkill,
  setManualSkill,
  runNow,
  pause,
  resume,
  restore,
  pin,
  unpin,
}: {
  status: string;
  archived: string[];
  manualSkill: string;
  setManualSkill: (value: string) => void;
  busy: string;
  runNow: () => void;
  pause: () => void;
  resume: () => void;
  restore: (name: string) => void;
  pin: (name: string) => void;
  unpin: (name: string) => void;
}): React.JSX.Element {
  const clean = manualSkill.trim();
  return (
    <>
      <section className="settings-section">
        <div className="settings-section-title">Curator status</div>
        <div className="curator-tab-actions-bar">
          <button className="btn btn-secondary btn-sm" onClick={runNow}>
            Run now
          </button>
          <button className="btn btn-secondary btn-sm" onClick={pause}>
            Pause
          </button>
          <button className="btn btn-secondary btn-sm" onClick={resume}>
            Resume
          </button>
        </div>
        <pre className="config-health-output">{status}</pre>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Archived skills</div>
        {archived.length === 0 ? (
          <div className="memory-empty">No archived skills found.</div>
        ) : (
          archived.map((name) => (
            <div key={name} className="memory-entry-card">
              <span className="memory-entry-content">{name}</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => restore(name)}
              >
                Restore {name}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => pin(name)}
              >
                Pin
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => unpin(name)}
              >
                Unpin
              </button>
            </div>
          ))
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Manual skill action</div>
        <input
          className="inbox-input"
          aria-label="Skill to manage"
          placeholder="Skill name"
          value={manualSkill}
          onChange={(event) => setManualSkill(event.target.value)}
        />
        <div className="curator-tab-manual-actions">
          <button
            className="btn btn-secondary btn-sm"
            disabled={!clean}
            onClick={() => restore(clean)}
          >
            Restore
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={!clean}
            onClick={() => pin(clean)}
          >
            Pin
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={!clean}
            onClick={() => unpin(clean)}
          >
            Unpin
          </button>
        </div>
      </section>
    </>
  );
}

export function parseArchivedSkills(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter((line) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(line));
}

function usageSummary(usage?: SkillUsageEntry): string {
  if (!usage || (usage.loadCount === 0 && usage.injectedCount === 0)) {
    return "Never used";
  }
  const loaded = `Loaded ${usage.loadCount} time${usage.loadCount === 1 ? "" : "s"}`;
  const used =
    usage.injectedCount > 0
      ? `used in chat ${usage.injectedCount} time${usage.injectedCount === 1 ? "" : "s"}`
      : "not used in chat yet";
  return `${loaded}; ${used}.`;
}
