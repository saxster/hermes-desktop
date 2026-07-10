import { useCallback, useEffect, useState } from "react";
import type { LearningProposal, SkillUsageEntry } from "../../../../../shared/learning";
import {
  ASSISTANT_RECIPE_TEMPLATES,
  type AssistantRecipe,
  type AssistantRecipeAction,
  type AssistantRecipeKind,
  type AssistantRecipeReviewMode,
  type AssistantRecipeRunRecord,
  type AssistantRecipeScheduleCadence,
} from "../../../../../shared/assistant-recipes";
import type {
  LocalExpertCheckRunResult,
  LocalExpertPackDetailResult,
  LocalExpertPackSummary,
} from "../../../../../shared/local-experts";
import { useStore } from "../store";
import {
  AssistantRecipesTab,
  compileTemplateRecipe,
  defaultFieldValues,
} from "./AssistantRecipesTab";
import { LocalExpertsTab } from "./LocalExpertsTab";
import {
  CuratorTab,
  MemoriesTab,
  SkillsTab,
  parseArchivedSkills,
  type LocalSkill,
  type SkillRow,
} from "./LearningDetailTabs";

type Tab = "recipes" | "experts" | "memories" | "skills" | "curator";

export function LearningSurface({
  profile = "default",
}: {
  profile?: string;
}): React.JSX.Element {
  const defaultRecipe = ASSISTANT_RECIPE_TEMPLATES[0];
  const setSurface = useStore((s) => s.setSurface);
  const [tab, setTab] = useState<Tab>("memories");
  const [recipes, setRecipes] = useState<AssistantRecipe[]>([]);
  const [recipeRuns, setRecipeRuns] = useState<AssistantRecipeRunRecord[]>([]);
  const [localExperts, setLocalExperts] = useState<LocalExpertPackSummary[]>(
    [],
  );
  const [selectedExpertId, setSelectedExpertId] = useState("");
  const [localExpertDetail, setLocalExpertDetail] =
    useState<LocalExpertPackDetailResult | null>(null);
  const [expertImportPath, setExpertImportPath] = useState("");
  const [expertExportPath, setExpertExportPath] = useState("");
  const [expertCheckRun, setExpertCheckRun] =
    useState<LocalExpertCheckRunResult | null>(null);
  const [proposals, setProposals] = useState<LearningProposal[]>([]);
  const [installed, setInstalled] = useState<SkillRow[]>([]);
  const [disabled, setDisabled] = useState<SkillRow[]>([]);
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([]);
  const [usage, setUsage] = useState<Record<string, SkillUsageEntry>>({});
  const [selectedSkill, setSelectedSkill] = useState<{
    name: string;
    content: string;
  } | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillBody, setSkillBody] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [curatorStatus, setCuratorStatus] = useState("");
  const [archived, setArchived] = useState<string[]>([]);
  const [manualSkill, setManualSkill] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [recipeKind, setRecipeKind] = useState<AssistantRecipeKind>(
    defaultRecipe.kind,
  );
  const [recipeName, setRecipeName] = useState(defaultRecipe.title);
  const [recipeDescription, setRecipeDescription] = useState(
    defaultRecipe.description,
  );
  const [recipeFieldValues, setRecipeFieldValues] = useState<
    Record<string, string>
  >(defaultFieldValues(defaultRecipe));
  const [recipeActions, setRecipeActions] = useState<AssistantRecipeAction[]>(
    defaultRecipe.defaultActions,
  );
  const [recipeReviewMode, setRecipeReviewMode] =
    useState<AssistantRecipeReviewMode>("review-first");
  const [recipeScheduleEnabled, setRecipeScheduleEnabled] = useState(false);
  const [recipeScheduleCadence, setRecipeScheduleCadence] =
    useState<AssistantRecipeScheduleCadence>("daily");
  const [recipeScheduleHour, setRecipeScheduleHour] = useState(8);
  const [recipeRunInput, setRecipeRunInput] = useState("");
  const [recipeRunResult, setRecipeRunResult] = useState("");
  const [lastRecipeRunId, setLastRecipeRunId] = useState("");

  const pendingMemories = proposals.filter(
    (p) => p.kind === "memory" && p.status === "pending",
  );
  const pendingSkills = proposals.filter(
    (p) => p.kind === "skill" && p.status === "pending",
  );

  const loadProposals = useCallback(async () => {
    setProposals(await window.hermesAPI.listLearningProposals(profile));
  }, [profile]);

  const loadRecipes = useCallback(async () => {
    setRecipes(await window.hermesAPI.spsListAssistantRecipes(profile));
  }, [profile]);

  const loadRecipeRuns = useCallback(async () => {
    setRecipeRuns(
      await window.hermesAPI.spsListAssistantRecipeRuns(undefined, profile),
    );
  }, [profile]);

  const loadLocalExperts = useCallback(async () => {
    const result = await window.hermesAPI.spsListLocalExperts(profile);
    setLocalExperts(result.packs);
    setSelectedExpertId((current) => current || result.packs[0]?.id || "");
  }, [profile]);

  const loadLocalExpertDetail = useCallback(
    async (packId: string) => {
      if (!packId) {
        setLocalExpertDetail(null);
        return;
      }
      setLocalExpertDetail(
        await window.hermesAPI.spsGetLocalExpert(packId, profile),
      );
    },
    [profile],
  );

  const loadSkills = useCallback(async () => {
    const [on, off, local, used] = await Promise.all([
      window.hermesAPI.listInstalledSkills(profile),
      window.hermesAPI.listDisabledSkills(profile),
      window.hermesAPI.discoverLocalSkills(profile).catch(() => []),
      window.hermesAPI.listSkillUsage(profile).catch(() => ({})),
    ]);
    setInstalled(on);
    setDisabled(off);
    setLocalSkills(local);
    setUsage(used);
  }, [profile]);

  const loadCurator = useCallback(async () => {
    const [status, rawArchived] = await Promise.all([
      window.hermesAPI.getCuratorStatus(profile).catch((err) => String(err)),
      window.hermesAPI.listArchivedSkills(profile).catch(() => ""),
    ]);
    setCuratorStatus(status || "No curator status returned.");
    setArchived(parseArchivedSkills(rawArchived));
  }, [profile]);

  useEffect(() => {
    void loadRecipes();
    void loadRecipeRuns();
    void loadLocalExperts();
    void loadProposals();
    void loadSkills();
    void loadCurator();
  }, [
    loadRecipes,
    loadRecipeRuns,
    loadLocalExperts,
    loadProposals,
    loadSkills,
    loadCurator,
  ]);

  useEffect(() => {
    if (tab === "experts") void loadLocalExpertDetail(selectedExpertId);
  }, [loadLocalExpertDetail, selectedExpertId, tab]);

  async function run<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    setBusy(label);
    setNotice("");
    try {
      return await fn();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Action failed.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function accept(id: string): Promise<void> {
    await run("accept", () =>
      window.hermesAPI.acceptLearningProposal(id, profile),
    );
    await loadProposals();
    await loadSkills();
  }

  async function dismiss(id: string): Promise<void> {
    await run("dismiss", () =>
      window.hermesAPI.dismissLearningProposal(id, profile),
    );
    await loadProposals();
  }

  async function proposeMemory(): Promise<void> {
    const body = memoryDraft.trim();
    if (!body) return;
    const res = await run("memory", () =>
      window.hermesAPI.createLearningProposal(
        { kind: "memory", body, source: { type: "manual" } },
        profile,
      ),
    );
    if (res) {
      setMemoryDraft("");
      await loadProposals();
    }
  }

  async function createSkill(): Promise<void> {
    const name = skillName.trim();
    const body = skillBody.trim();
    if (!name || !body) return;
    const res = await run("create-skill", () =>
      window.hermesAPI.createSkill({
        name,
        description: skillDescription,
        body,
        profile,
      }),
    );
    if (res?.success) {
      setSkillName("");
      setSkillDescription("");
      setSkillBody("");
      await loadSkills();
    } else if (res) {
      setNotice(res.error || "Could not create skill.");
    }
  }

  function selectRecipeTemplate(kind: AssistantRecipeKind): void {
    const template =
      ASSISTANT_RECIPE_TEMPLATES.find((item) => item.kind === kind) ||
      ASSISTANT_RECIPE_TEMPLATES[0];
    setRecipeKind(template.kind);
    setRecipeName(template.title);
    setRecipeDescription(template.description);
    setRecipeFieldValues(defaultFieldValues(template));
    setRecipeActions(template.defaultActions);
    setRecipeReviewMode("review-first");
    setRecipeScheduleEnabled(false);
  }

  function setRecipeFieldValue(key: string, value: string): void {
    setRecipeFieldValues((current) => ({ ...current, [key]: value }));
  }

  function toggleRecipeAction(action: AssistantRecipeAction): void {
    setRecipeActions((current) =>
      current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action],
    );
    if (
      action === "send_messages" ||
      action === "process_files" ||
      action === "schedule_runs"
    ) {
      setRecipeReviewMode("review-first");
    }
    if (action === "send_messages") {
      setRecipeScheduleEnabled(false);
    }
  }

  async function createRecipe(): Promise<void> {
    const name = recipeName.trim();
    const template =
      ASSISTANT_RECIPE_TEMPLATES.find((item) => item.kind === recipeKind) ||
      ASSISTANT_RECIPE_TEMPLATES[0];
    const { job, inputs, output } = compileTemplateRecipe(
      template,
      recipeFieldValues,
    );
    if (!name || !job || !inputs || !output) return;
    const res = await run("create-recipe", () =>
      window.hermesAPI.spsCreateAssistantRecipe(
        {
          name,
          kind: recipeKind,
          description: recipeDescription,
          job,
          inputs,
          output,
          allowedActions: recipeActions,
          reviewMode: recipeReviewMode,
          schedule: recipeScheduleEnabled
            ? {
                enabled: true,
                cadence: recipeScheduleCadence,
                hour: recipeScheduleHour,
              }
            : undefined,
        },
        profile,
      ),
    );
    if (res?.ok) {
      setNotice("Assistant created. It is ready to run from this tab.");
      await loadRecipes();
      await loadRecipeRuns();
      await loadSkills();
    } else if (res) {
      setNotice(res.error || "Could not create assistant.");
    }
  }

  async function runRecipe(recipe: AssistantRecipe): Promise<void> {
    const res = await run(`run-recipe-${recipe.id}`, () =>
      window.hermesAPI.spsRunAssistantRecipe(
        recipe.id,
        recipeRunInput,
        profile,
      ),
    );
    if (res?.ok) {
      const result = res.run?.resultText || "";
      setRecipeRunResult(result);
      setLastRecipeRunId(res.run?.id || "");
      setNotice(`${recipe.name} finished. Review the result below.`);
      await loadRecipes();
      await loadRecipeRuns();
    } else if (res) {
      setNotice(res.error || "Could not run assistant.");
      if (res.run) await loadRecipeRuns();
    }
  }

  async function saveRecipeResult(): Promise<void> {
    if (!lastRecipeRunId) return;
    const saved = await run("save-recipe-result", () =>
      window.hermesAPI.spsSaveAssistantRecipeRun(lastRecipeRunId, profile),
    );
    if (saved?.ok) {
      setNotice("Queued assistant result for review.");
      await loadRecipeRuns();
      setSurface("review");
    } else if (saved) {
      setNotice(saved.error || "Could not queue assistant result.");
    }
  }

  async function installExpert(packId: string): Promise<void> {
    const res = await run(`expert-${packId}`, () =>
      window.hermesAPI.spsInstallLocalExpert(packId, profile),
    );
    if (res?.ok) {
      const packTitle =
        localExperts.find((pack) => pack.id === packId)?.title || "expert";
      setNotice(`Installed ${packTitle}.`);
      await loadLocalExperts();
      await loadLocalExpertDetail(packId);
      await loadRecipes();
      await loadSkills();
    } else if (res) {
      setNotice(res.error || "Could not install local expert.");
    }
  }

  async function uninstallExpert(packId: string): Promise<void> {
    const res = await run(`expert-${packId}`, () =>
      window.hermesAPI.spsUninstallLocalExpert(packId, profile),
    );
    if (res?.ok) {
      const packTitle =
        localExperts.find((pack) => pack.id === packId)?.title || "expert";
      setNotice(`Removed ${packTitle}; vault records were preserved.`);
      await loadLocalExperts();
      await loadLocalExpertDetail(packId);
      await loadRecipes();
      await loadSkills();
    } else if (res) {
      setNotice(res.error || "Could not remove local expert.");
    }
  }

  function selectExpert(packId: string): void {
    setSelectedExpertId(packId);
    setExpertCheckRun(null);
    void loadLocalExpertDetail(packId);
  }

  async function pickExpertImportPack(): Promise<void> {
    const selected = await run("pick-expert-import", () =>
      window.hermesAPI.spsPickLocalExpertPack(),
    );
    if (selected) setExpertImportPath(selected);
  }

  async function previewExpertImport(): Promise<void> {
    const source = expertImportPath.trim();
    if (!source) return;
    const res = await run("preview-expert-import", () =>
      window.hermesAPI.spsPreviewLocalExpertPack(source, profile),
    );
    if (!res) return;
    setNotice(
      res.ok
        ? `Import preview: ${res.pack?.title || "expert pack"} with ${res.recordCount || 0} records.`
        : `Import preview failed: ${res.errors.join("; ")}`,
    );
  }

  async function importExpertPack(): Promise<void> {
    const source = expertImportPath.trim();
    if (!source) return;
    const res = await run("import-expert", () =>
      window.hermesAPI.spsImportLocalExpertPack(source, profile),
    );
    if (res?.ok && res.packId) {
      setNotice(`Imported ${res.packId}.`);
      setExpertImportPath("");
      await loadLocalExperts();
      selectExpert(res.packId);
    } else if (res) {
      setNotice(res.errors.join("; ") || "Could not import expert pack.");
    }
  }

  async function pickExpertExportPath(packId: string): Promise<void> {
    const selected = await run("pick-expert-export", () =>
      window.hermesAPI.spsPickLocalExpertPackExportPath(packId),
    );
    if (selected) setExpertExportPath(selected);
  }

  async function exportExpertPack(packId: string): Promise<void> {
    const target = expertExportPath.trim();
    if (!target) return;
    const res = await run("export-expert", () =>
      window.hermesAPI.spsExportLocalExpertPack(packId, target, profile),
    );
    if (res?.ok) {
      setNotice(`Exported ${packId}.`);
    } else if (res) {
      setNotice(res.error || "Could not export expert pack.");
    }
  }

  async function enableExpertChecks(packId: string): Promise<void> {
    const res = await run("enable-expert-checks", () =>
      window.hermesAPI.spsEnableLocalExpertChecks(packId, profile),
    );
    if (res?.ok) {
      setNotice("Read-only checks enabled for review.");
      await loadLocalExperts();
      await loadLocalExpertDetail(packId);
    } else if (res) {
      setNotice(res.error || "Could not enable checks.");
    }
  }

  async function runExpertChecks(packId: string): Promise<void> {
    const res = await run("run-expert-checks", () =>
      window.hermesAPI.spsRunLocalExpertChecks(packId, profile),
    );
    if (res?.ok) {
      setExpertCheckRun(res);
      setNotice("Read-only checks finished.");
    } else if (res) {
      setNotice(res.error || "Could not run checks.");
    }
  }

  async function toggleRecipe(recipe: AssistantRecipe): Promise<void> {
    const res = await run(`toggle-recipe-${recipe.id}`, () =>
      window.hermesAPI.spsUpdateAssistantRecipe(
        recipe.id,
        { enabled: !recipe.enabled },
        profile,
      ),
    );
    if (res?.ok) {
      await loadRecipes();
      await loadRecipeRuns();
    } else if (res) setNotice(res.error || "Could not update assistant.");
  }

  async function deleteRecipe(recipe: AssistantRecipe): Promise<void> {
    const res = await run(`delete-recipe-${recipe.id}`, () =>
      window.hermesAPI.spsDeleteAssistantRecipe(recipe.id, profile),
    );
    if (res?.ok) {
      await loadRecipes();
      await loadRecipeRuns();
    } else if (res) setNotice(res.error || "Could not delete assistant.");
  }

  async function generateDraft(): Promise<void> {
    const path = repoPath.trim();
    if (!path) return;
    const res = await run("generate", () =>
      window.hermesAPI.generateSkillFromRepo(path, profile),
    );
    if (!res?.success || !res.draft) {
      setNotice(res?.error || "Could not generate skill draft.");
      return;
    }
    await window.hermesAPI.createLearningProposal(
      {
        kind: "skill",
        draft: { ...res.draft, category: "custom" },
        source: { type: "repo", path },
      },
      profile,
    );
    setRepoPath("");
    await loadProposals();
  }

  async function viewSkill(skill: SkillRow): Promise<void> {
    const content = await run("view-skill", () =>
      window.hermesAPI.getSkillContent(skill.path),
    );
    if (typeof content === "string")
      setSelectedSkill({ name: skill.name, content });
  }

  async function toggleSkill(skill: SkillRow, enabled: boolean): Promise<void> {
    const res = await run("toggle-skill", () =>
      window.hermesAPI.setSkillEnabled(skill.path, enabled, profile),
    );
    if (res?.success) await loadSkills();
    else if (res) setNotice(res.error || "Could not update skill.");
  }

  async function uninstallSkill(skill: SkillRow): Promise<void> {
    const identifier = skill.path.split(/[\\/]+/).pop() || skill.name;
    const res = await run("uninstall-skill", () =>
      window.hermesAPI.uninstallSkill(identifier, profile),
    );
    if (res?.success) {
      if (selectedSkill?.name === skill.name) {
        setSelectedSkill(null);
      }
      await loadSkills();
    } else if (res) {
      setNotice(res.error || "Could not uninstall skill.");
    }
  }

  async function importSkill(skill: LocalSkill): Promise<void> {
    const res = await run("import-skill", () =>
      window.hermesAPI.importLocalSkill(
        skill.sourcePath,
        skill.category,
        profile,
      ),
    );
    if (res?.success) await loadSkills();
    else if (res) setNotice(res.error || "Could not import skill.");
  }

  async function curatorAction(
    label: string,
    action: () => Promise<{ success: boolean; output: string }>,
  ): Promise<void> {
    const res = await run(label, action);
    if (res?.output) setNotice(res.output);
    await loadCurator();
  }

  return (
    <div className="settings-container">
      <header className="memory-header">
        <div>
          <h1 className="settings-header learning-surface-header-title">
            Learning
          </h1>
          <p className="memory-subtitle">
            Review captured material, recent learnings, and what My Assistant
            should remember before opening builder controls.
          </p>
        </div>
      </header>

      <div className="settings-subnav">
        {(["memories", "recipes", "experts"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={`settings-subnav-tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {id === "memories"
              ? "Memories"
              : id === "recipes"
                ? "Assistants"
                : "Experts"}
          </button>
        ))}
        <button
          type="button"
          className={`settings-subnav-tab ${
            tab === "skills" || tab === "curator" ? "active" : ""
          }`}
          onClick={() => setTab("skills")}
        >
          Advanced
        </button>
      </div>

      {(tab === "skills" || tab === "curator") && (
        <div className="settings-subnav learning-advanced-subnav">
          {(["skills", "curator"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={`settings-subnav-tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {id === "skills" ? "Skills" : "Curator"}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div className="memory-error learning-surface-notice">{notice}</div>
      )}

      {tab === "recipes" && (
        <AssistantRecipesTab
          recipes={recipes}
          runs={recipeRuns}
          recipeKind={recipeKind}
          recipeName={recipeName}
          setRecipeName={setRecipeName}
          recipeDescription={recipeDescription}
          setRecipeDescription={setRecipeDescription}
          recipeFieldValues={recipeFieldValues}
          setRecipeFieldValue={setRecipeFieldValue}
          recipeActions={recipeActions}
          recipeReviewMode={recipeReviewMode}
          setRecipeReviewMode={setRecipeReviewMode}
          recipeScheduleEnabled={recipeScheduleEnabled}
          setRecipeScheduleEnabled={setRecipeScheduleEnabled}
          recipeScheduleCadence={recipeScheduleCadence}
          setRecipeScheduleCadence={setRecipeScheduleCadence}
          recipeScheduleHour={recipeScheduleHour}
          setRecipeScheduleHour={setRecipeScheduleHour}
          recipeRunInput={recipeRunInput}
          setRecipeRunInput={setRecipeRunInput}
          recipeRunResult={recipeRunResult}
          canSaveRecipeResult={Boolean(lastRecipeRunId)}
          selectRecipeTemplate={selectRecipeTemplate}
          toggleRecipeAction={toggleRecipeAction}
          createRecipe={createRecipe}
          runRecipe={runRecipe}
          saveRecipeResult={saveRecipeResult}
          toggleRecipe={toggleRecipe}
          deleteRecipe={deleteRecipe}
          busy={busy}
        />
      )}
      {tab === "experts" && (
        <LocalExpertsTab
          packs={localExperts}
          selectedPackId={selectedExpertId}
          selectExpert={selectExpert}
          detail={localExpertDetail}
          installExpert={installExpert}
          uninstallExpert={uninstallExpert}
          importPath={expertImportPath}
          pickImportPack={pickExpertImportPack}
          previewImport={previewExpertImport}
          importPack={importExpertPack}
          exportPath={expertExportPath}
          pickExportPath={pickExpertExportPath}
          exportPack={exportExpertPack}
          enableChecks={enableExpertChecks}
          runChecks={runExpertChecks}
          checkRun={expertCheckRun}
          busy={busy}
        />
      )}
      {tab === "memories" && (
        <MemoriesTab
          pending={pendingMemories}
          memoryDraft={memoryDraft}
          setMemoryDraft={setMemoryDraft}
          proposeMemory={proposeMemory}
          accept={accept}
          dismiss={dismiss}
          profile={profile}
          refresh={loadProposals}
          busy={busy}
        />
      )}
      {tab === "skills" && (
        <SkillsTab
          pending={pendingSkills}
          installed={installed}
          disabled={disabled}
          localSkills={localSkills}
          usage={usage}
          selectedSkill={selectedSkill}
          skillName={skillName}
          setSkillName={setSkillName}
          skillDescription={skillDescription}
          setSkillDescription={setSkillDescription}
          skillBody={skillBody}
          setSkillBody={setSkillBody}
          repoPath={repoPath}
          setRepoPath={setRepoPath}
          accept={accept}
          dismiss={dismiss}
          viewSkill={viewSkill}
          toggleSkill={toggleSkill}
          createSkill={createSkill}
          generateDraft={generateDraft}
          importSkill={importSkill}
          uninstallSkill={uninstallSkill}
          busy={busy}
        />
      )}
      {tab === "curator" && (
        <CuratorTab
          status={curatorStatus}
          archived={archived}
          manualSkill={manualSkill}
          setManualSkill={setManualSkill}
          busy={busy}
          runNow={() =>
            curatorAction("run-curator", () =>
              window.hermesAPI.runCuratorNow(profile),
            )
          }
          pause={() =>
            curatorAction("pause-curator", () =>
              window.hermesAPI.pauseCurator(profile),
            )
          }
          resume={() =>
            curatorAction("resume-curator", () =>
              window.hermesAPI.resumeCurator(profile),
            )
          }
          restore={(name) =>
            curatorAction(`restore-${name}`, () =>
              window.hermesAPI.restoreArchivedSkill(name, profile),
            )
          }
          pin={(name) =>
            curatorAction(`pin-${name}`, () =>
              window.hermesAPI.pinSkill(name, profile),
            )
          }
          unpin={(name) =>
            curatorAction(`unpin-${name}`, () =>
              window.hermesAPI.unpinSkill(name, profile),
            )
          }
        />
      )}
    </div>
  );
}
