import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("../you/MemoryTimeline", () => ({
  MemoryTimeline: () => <div>Learned memory timeline</div>,
}));

const { setSurface } = vi.hoisted(() => ({ setSurface: vi.fn() }));

vi.mock("../store", () => ({
  useStore: (selector: (state: { setSurface: typeof setSurface }) => unknown) =>
    selector({ setSurface }),
}));

import { LearningSurface } from "./LearningSurface";

const api = {
  listLearningProposals: vi.fn(),
  acceptLearningProposal: vi.fn(),
  dismissLearningProposal: vi.fn(),
  rollbackLearningProposal: vi.fn(),
  createLearningProposal: vi.fn(),
  listInstalledSkills: vi.fn(),
  listDisabledSkills: vi.fn(),
  setSkillEnabled: vi.fn(),
  getSkillContent: vi.fn(),
  createSkill: vi.fn(),
  discoverLocalSkills: vi.fn(),
  importLocalSkill: vi.fn(),
  generateSkillFromRepo: vi.fn(),
  listSkillUsage: vi.fn(),
  getCuratorStatus: vi.fn(),
  runCuratorNow: vi.fn(),
  pauseCurator: vi.fn(),
  resumeCurator: vi.fn(),
  listArchivedSkills: vi.fn(),
  restoreArchivedSkill: vi.fn(),
  pinSkill: vi.fn(),
  unpinSkill: vi.fn(),
  spsListAssistantRecipes: vi.fn(),
  spsCreateAssistantRecipe: vi.fn(),
  spsUpdateAssistantRecipe: vi.fn(),
  spsDeleteAssistantRecipe: vi.fn(),
  spsRunAssistantRecipe: vi.fn(),
  spsListAssistantRecipeRuns: vi.fn(),
  spsSaveAssistantRecipeRun: vi.fn(),
  spsListOutcomeKits: vi.fn(),
  spsActivateOutcomeKit: vi.fn(),
  spsEnableOutcomeKitSchedule: vi.fn(),
  spsRunOutcomeKit: vi.fn(),
  spsListLocalExperts: vi.fn(),
  spsGetLocalExpert: vi.fn(),
  spsInstallLocalExpert: vi.fn(),
  spsUninstallLocalExpert: vi.fn(),
  spsPickLocalExpertPack: vi.fn(),
  spsPreviewLocalExpertPack: vi.fn(),
  spsImportLocalExpertPack: vi.fn(),
  spsExportLocalExpertPack: vi.fn(),
  spsPickLocalExpertPackExportPath: vi.fn(),
  spsEnableLocalExpertChecks: vi.fn(),
  spsRunLocalExpertChecks: vi.fn(),
  spsCreateVaultProposal: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  installApi();
  api.listLearningProposals.mockResolvedValue([
    {
      id: "m1",
      kind: "memory",
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
      body: "Prefers terse answers.",
      reason: "The user corrected a long response.",
    },
  ]);
  api.acceptLearningProposal.mockResolvedValue({ ok: true });
  api.dismissLearningProposal.mockResolvedValue({ ok: true });
  api.rollbackLearningProposal.mockResolvedValue({ ok: true });
  api.createLearningProposal.mockResolvedValue({ ok: true });
  api.listInstalledSkills.mockResolvedValue([
    {
      name: "Daily Brief",
      category: "custom",
      description: "Brief",
      path: "/s/daily",
    },
  ]);
  api.listDisabledSkills.mockResolvedValue([
    {
      name: "Old Skill",
      category: "custom",
      description: "Old",
      path: "/s/old",
    },
  ]);
  api.setSkillEnabled.mockResolvedValue({ success: true });
  api.getSkillContent.mockResolvedValue("# Daily Brief\n\nDo the brief.");
  api.createSkill.mockResolvedValue({ success: true });
  api.discoverLocalSkills.mockResolvedValue([]);
  api.importLocalSkill.mockResolvedValue({ success: true });
  api.generateSkillFromRepo.mockResolvedValue({
    success: true,
    draft: {
      name: "repo-helper",
      description: "Helps in repo.",
      body: "# Repo Helper\n\nUse repo conventions.",
    },
  });
  api.listSkillUsage.mockResolvedValue({
    "/s/daily": {
      name: "Daily Brief",
      path: "/s/daily",
      loadCount: 2,
      injectedCount: 1,
      lastLoadedAt: 1,
      lastUsedAt: 1,
    },
  });
  api.getCuratorStatus.mockResolvedValue("Curator is running");
  api.listArchivedSkills.mockResolvedValue("old-skill\nunused-skill");
  api.restoreArchivedSkill.mockResolvedValue({
    success: true,
    output: "restored",
  });
  api.pinSkill.mockResolvedValue({ success: true, output: "pinned" });
  api.unpinSkill.mockResolvedValue({ success: true, output: "unpinned" });
  api.runCuratorNow.mockResolvedValue({ success: true, output: "ran" });
  api.pauseCurator.mockResolvedValue({ success: true, output: "paused" });
  api.resumeCurator.mockResolvedValue({ success: true, output: "resumed" });
  api.spsListAssistantRecipes.mockResolvedValue([
    {
      id: "r1",
      name: "Research brief",
      kind: "research-brief",
      description: "Research a topic.",
      job: "Research the topic.",
      inputs: "A topic.",
      output: "A briefing.",
      allowedActions: ["read_workspace", "search_web", "draft_content"],
      reviewMode: "review-first",
      skillName: "assistant-research-brief",
      skillPath: "/s/assistant-research-brief",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  api.spsListAssistantRecipeRuns.mockResolvedValue([
    {
      id: "run1",
      recipeId: "r1",
      recipeName: "Research brief",
      input: "Focus on risks.",
      resultText: "Brief finished.",
      status: "success",
      createdAt: 1,
      durationMs: 25,
      savedProposalId: "vp1",
      savedPageId: "assistant-results/research-brief-19700101000000",
      trigger: "manual",
    },
  ]);
  api.spsCreateAssistantRecipe.mockResolvedValue({
    ok: true,
    recipe: {
      id: "r2",
      name: "Article Agent",
      kind: "article-writer",
      description: "",
      job: "Draft articles.",
      inputs: "Topic.",
      output: "Article.",
      allowedActions: ["read_workspace", "draft_content"],
      reviewMode: "review-first",
      skillName: "assistant-article-agent",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    },
  });
  api.spsUpdateAssistantRecipe.mockResolvedValue({ ok: true });
  api.spsDeleteAssistantRecipe.mockResolvedValue({ ok: true });
  api.spsRunAssistantRecipe.mockResolvedValue({
    ok: true,
    run: {
      id: "run2",
      recipeId: "r1",
      recipeName: "Research brief",
      input: "",
      resultText: "Brief finished.",
      status: "success",
      createdAt: 2,
      durationMs: 30,
      trigger: "manual",
    },
    result: { kind: "chat", reply: ["Brief finished."] },
  });
  api.spsSaveAssistantRecipeRun.mockResolvedValue({
    ok: true,
    proposalId: "vp2",
    pageId: "assistant-results/research-brief-19700101000002",
  });
  api.spsListOutcomeKits.mockResolvedValue([]);
  api.spsActivateOutcomeKit.mockResolvedValue({
    ok: true,
    recipeId: "kit-recipe",
  });
  api.spsEnableOutcomeKitSchedule.mockResolvedValue({ ok: true });
  api.spsRunOutcomeKit.mockResolvedValue({
    ok: true,
    run: {
      id: "kit-run",
      recipeId: "kit-recipe",
      recipeName: "Research Kit",
      input: "Topic: AI safety",
      resultText: "Sourced brief.",
      status: "success",
      createdAt: 3,
      durationMs: 20,
      trigger: "manual",
    },
  });
  api.spsListLocalExperts.mockResolvedValue({
    packs: [
      {
        id: "macos",
        title: "Mac Expert",
        description:
          "Source-backed macOS guidance for privacy, security, updates, Finder, networking, and developer workflows.",
        domain: "macos",
        version: "1.0.0",
        recordCount: 12,
        sourceTiers: ["apple_official", "mac_admin"],
        installed: false,
        packHash: "abc123def4567890",
        freshness: {
          status: "current",
          current: 12,
          stale: 0,
          expired: 0,
          unknown: 0,
        },
      },
    ],
  });
  api.spsGetLocalExpert.mockResolvedValue({
    ok: true,
    packId: "macos",
    sourceTiers: ["apple_official", "mac_admin"],
    freshness: {
      status: "current",
      current: 12,
      stale: 0,
      expired: 0,
      unknown: 0,
    },
    pack: {
      id: "macos",
      title: "Mac Expert",
      domain: "macos",
      version: "1.0.0",
      description: "Source-backed macOS guidance.",
      sourceTiers: ["apple_official", "mac_admin"],
      recipe: {
        name: "Mac Expert",
        description: "Mac guidance",
        job: "Ask before suggesting Terminal commands; never claim a setting is enabled unless evidence is provided.",
        inputs: "Question",
        output: "Answer",
      },
      records: [
        {
          id: "privacy-screen-recording",
          title: "Grant Screen Recording Permission",
          topic: "privacy.screen_recording",
          sourceTier: "apple_official",
          macosVersions: ["15"],
          symptoms: ["Black screen capture"],
          steps: ["Open System Settings"],
          verification: ["Permission is enabled"],
          risk: "low",
          sourceUrls: ["https://support.apple.com/guide/mac-help/welcome/mac"],
          lastVerified: "2026-06-17",
          tags: ["privacy"],
          freshnessDays: 180,
        },
      ],
      scenarios: [
        {
          id: "client-cannot-open-shared-file",
          title: "Client cannot open shared file",
          prompt: "A client says they cannot open a shared Google file.",
          recordIds: ["privacy-screen-recording"],
          requiredEvidence: ["Exact error text", "Shared role"],
          expectedSections: [
            "What to check",
            "Steps",
            "Verification",
            "Risk",
            "Sources",
          ],
          risk: "medium",
        },
      ],
    },
  });
  api.spsInstallLocalExpert.mockResolvedValue({
    ok: true,
    packId: "macos",
    installed: true,
    recordsWritten: 12,
    recordsSkipped: 0,
    recipeId: "ar_macos",
    skillPath: "/skills/assistant-recipes/assistant-mac-expert",
    recordsLeftInVault: false,
  });
  api.spsUninstallLocalExpert.mockResolvedValue({
    ok: true,
    packId: "macos",
    installed: false,
    recordsWritten: 0,
    recordsSkipped: 12,
    recordsLeftInVault: true,
  });
  api.spsPickLocalExpertPack.mockResolvedValue("/granted/excel.json");
  api.spsPreviewLocalExpertPack.mockResolvedValue({
    ok: true,
    canImport: true,
    errors: [],
    recordCount: 1,
    pack: { title: "Excel Expert" },
  });
  api.spsImportLocalExpertPack.mockResolvedValue({
    ok: true,
    packId: "excel",
    packHash: "feedface",
    errors: [],
  });
  api.spsExportLocalExpertPack.mockResolvedValue({
    ok: true,
    packId: "macos",
    targetPath: "/granted/exports/macos.json",
    packHash: "abc123",
  });
  api.spsPickLocalExpertPackExportPath.mockResolvedValue(
    "/granted/exports/macos.json",
  );
  api.spsEnableLocalExpertChecks.mockResolvedValue({
    ok: true,
    packId: "macos",
  });
  api.spsRunLocalExpertChecks.mockResolvedValue({
    ok: true,
    packId: "macos",
    results: [
      {
        id: "macos-version",
        title: "macOS version",
        status: "ok",
        stdout: "15.5",
      },
    ],
  });
  api.spsCreateVaultProposal.mockResolvedValue({ id: "vp1" });
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("LearningSurface", () => {
  it("renders a focused learning list without developer controls", async () => {
    render(<LearningSurface profile="default" />);

    expect(await screen.findByText("Learning")).toBeInTheDocument();
    expect(screen.getByText("Assistants")).toBeInTheDocument();
    expect(screen.getByText("Memories")).toBeInTheDocument();
    expect(screen.queryByText("Advanced")).toBeNull();
    expect(screen.queryByText("Skills")).toBeNull();
    expect(
      await screen.findByText("Prefers terse answers."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Assistants"));
    expect(await screen.findByText("Build an Assistant")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Memories"));
    expect(
      await screen.findByText("Prefers terse answers."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Accept"));
    await waitFor(() =>
      expect(api.acceptLearningProposal).toHaveBeenCalledWith("m1", "default"),
    );
  });

  it("creates a saved assistant recipe from the form", async () => {
    render(<LearningSurface profile="default" />);

    fireEvent.click(screen.getByText("Assistants"));
    fireEvent.change(await screen.findByLabelText("Assistant template"), {
      target: { value: "article-writer" },
    });
    fireEvent.change(screen.getByLabelText("Assistant name"), {
      target: { value: "Article Agent" },
    });
    fireEvent.change(screen.getByLabelText("Audience"), {
      target: { value: "Founders" },
    });
    fireEvent.change(screen.getByLabelText("Tone"), {
      target: { value: "Clear" },
    });
    fireEvent.change(screen.getByLabelText("Length"), {
      target: { value: "Short post" },
    });
    fireEvent.click(screen.getByText("Create assistant"));

    await waitFor(() =>
      expect(api.spsCreateAssistantRecipe).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Article Agent",
          kind: "article-writer",
          job: expect.stringContaining("Audience: Founders"),
          inputs: expect.stringContaining("Tone: Clear"),
          output: expect.stringContaining("Length: Short post"),
          reviewMode: "review-first",
        }),
        "default",
      ),
    );
  });

  it("keeps Outcome Kit activation, schedule, and execution as separate decisions", async () => {
    api.spsListOutcomeKits.mockResolvedValue([
      {
        contractVersion: 1,
        kit: {
          contractVersion: 1,
          kitId: "research-kit",
          title: "Research Kit",
          version: 1,
          outcome: "Produce a sourced brief.",
          inputs: [{ id: "topic", label: "Topic", required: true }],
          artifacts: [{ kind: "text", label: "Brief", required: true }],
          criteria: [{ id: "sourced", text: "Claims are sourced." }],
          dependencies: {
            skills: [],
            connectors: [],
            model: { capabilities: ["research"], requireVerified: false },
          },
          recipe: {
            name: "Research Kit",
            kind: "research-brief",
            description: "Research.",
            job: "Research.",
            inputs: "Topic.",
            output: "Brief.",
            allowedActions: ["read_workspace", "search_web", "draft_content"],
          },
          reviewPolicy: "review-first",
          risk: { mode: "INTERACTIVE", classes: ["READ"] },
          triggerTemplates: ["manual", "scheduled"],
          scheduleTemplate: { cadence: "weekly", hour: 8 },
          evalFixtures: [
            {
              id: "basic",
              input: "AI safety",
              expectedCriteria: ["sourced"],
              expectedArtifactKinds: ["text"],
            },
          ],
          provenance: { publisher: "Fathah Hermes" },
        },
        packHash: "abc",
        contentInstalledAt: 1,
        importedSkills: [],
        readiness: {
          kitId: "research-kit",
          status: "attention",
          canActivate: true,
          items: [
            {
              id: "schedule",
              kind: "schedule",
              status: "attention",
              title: "Schedule template",
              summary: "Disabled until separately enabled.",
            },
          ],
          modelFitness: {
            status: "unverified",
            provider: "custom",
            model: "private",
            required: ["research"],
            supported: [],
            missing: ["research"],
            reason: "Unverified model.",
          },
          generatedAt: 1,
        },
      },
    ]);

    const view = render(<LearningSurface profile="default" />);
    fireEvent.click(screen.getByText("Assistants"));
    fireEvent.click(await screen.findByText("Activate content"));
    await waitFor(() =>
      expect(api.spsActivateOutcomeKit).toHaveBeenCalledWith(
        "research-kit",
        "default",
      ),
    );
    expect(api.spsEnableOutcomeKitSchedule).not.toHaveBeenCalled();

    api.spsListOutcomeKits.mockResolvedValue([
      {
        ...(await api.spsListOutcomeKits.mock.results[0].value)[0],
        recipeId: "kit-recipe",
        activatedAt: 2,
      },
    ]);
    view.rerender(<LearningSurface profile="alternate" />);
    fireEvent.click(await screen.findByText("Assistants"));
    fireEvent.change(await screen.findByLabelText("Research Kit Topic"), {
      target: { value: "AI safety" },
    });
    fireEvent.click(screen.getByText("Run kit"));
    await waitFor(() =>
      expect(api.spsRunOutcomeKit).toHaveBeenCalledWith(
        "research-kit",
        { topic: "AI safety" },
        "alternate",
        "manual",
      ),
    );
    fireEvent.click(screen.getByText("Enable schedule"));
    await waitFor(() =>
      expect(api.spsEnableOutcomeKitSchedule).toHaveBeenCalledWith(
        "research-kit",
        "alternate",
      ),
    );
  });

  it("runs a saved assistant recipe", async () => {
    render(<LearningSurface profile="default" />);

    fireEvent.click(screen.getByText("Assistants"));
    fireEvent.click(await screen.findByText("Run"));

    await waitFor(() =>
      expect(api.spsRunAssistantRecipe).toHaveBeenCalledWith(
        "r1",
        "",
        "default",
      ),
    );
    expect(await screen.findByText("Brief finished.")).toBeInTheDocument();
  });

  it("queues the latest assistant result for vault review", async () => {
    render(<LearningSurface profile="default" />);

    fireEvent.click(screen.getByText("Assistants"));
    fireEvent.change(await screen.findByLabelText("Assistant run input"), {
      target: { value: "Focus on risks." },
    });
    fireEvent.click(screen.getByText("Run"));
    fireEvent.click(await screen.findByText("Send to review"));

    await waitFor(() =>
      expect(api.spsSaveAssistantRecipeRun).toHaveBeenCalledWith(
        "run2",
        "default",
      ),
    );
    expect(setSurface).toHaveBeenCalledWith("review");
  });

  it("shows compact assistant run history", async () => {
    render(<LearningSurface profile="default" />);

    fireEvent.click(screen.getByText("Assistants"));
    expect(await screen.findByText(/saved/)).toBeInTheDocument();
    fireEvent.click(await screen.findByText("View past runs"));
    expect(screen.getAllByText(/saved/).length).toBeGreaterThan(1);
  });

  it("creates a pending skill proposal from a repo draft", async () => {
    render(<LearningSurface profile="default" developerOnly />);

    expect(await screen.findByText("Skills")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Repository path"), {
      target: { value: "/tmp/repo" },
    });
    fireEvent.click(screen.getByText("Generate draft"));

    await waitFor(() =>
      expect(api.createLearningProposal).toHaveBeenCalledWith(
        {
          kind: "skill",
          draft: {
            name: "repo-helper",
            description: "Helps in repo.",
            category: "custom",
            body: "# Repo Helper\n\nUse repo conventions.",
          },
          source: { type: "repo", path: "/tmp/repo" },
        },
        "default",
      ),
    );
  });

  it("restores archived curator skills", async () => {
    render(<LearningSurface profile="default" developerOnly />);

    fireEvent.click(await screen.findByText("Curator"));
    fireEvent.click(await screen.findByText("Restore old-skill"));

    await waitFor(() =>
      expect(api.restoreArchivedSkill).toHaveBeenCalledWith(
        "old-skill",
        "default",
      ),
    );
  });

  it("installs a local expert from the Experts tab", async () => {
    render(<LearningSurface profile="default" />);

    fireEvent.click(await screen.findByText("Experts"));
    expect(await screen.findByText("Mac Expert")).toBeInTheDocument();
    expect(screen.getByText(/12 records/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Install"));

    await waitFor(() =>
      expect(api.spsInstallLocalExpert).toHaveBeenCalledWith(
        "macos",
        "default",
      ),
    );
    expect(await screen.findByText(/Installed Mac Expert/)).toBeInTheDocument();
  });

  it("shows Google Docs Editors workflows and installs that expert from the existing Experts tab", async () => {
    api.spsListLocalExperts.mockResolvedValue({
      packs: [
        {
          id: "macos",
          title: "Mac Expert",
          description: "Source-backed macOS guidance.",
          domain: "macos",
          version: "1.0.0",
          recordCount: 12,
          sourceTiers: ["apple_official", "mac_admin"],
          installed: false,
          packHash: "abc123def4567890",
          freshness: {
            status: "current",
            current: 12,
            stale: 0,
            expired: 0,
            unknown: 0,
          },
        },
        {
          id: "google-docs-editors",
          title: "Google Docs Editors Expert",
          description:
            "Source-backed Google Workspace guidance for Drive sharing, Docs, Sheets, Slides, and lightweight Apps Script automation.",
          domain: "google-workspace",
          version: "1.0.0",
          recordCount: 10,
          sourceTiers: [
            "google_workspace_official",
            "google_developer_official",
          ],
          installed: false,
          packHash: "feed1234cafe5678",
          freshness: {
            status: "current",
            current: 10,
            stale: 0,
            expired: 0,
            unknown: 0,
          },
        },
      ],
    });
    api.spsGetLocalExpert.mockImplementation(async (packId: string) =>
      packId === "google-docs-editors"
        ? {
            ok: true,
            packId: "google-docs-editors",
            sourceTiers: [
              "google_workspace_official",
              "google_developer_official",
            ],
            freshness: {
              status: "current",
              current: 10,
              stale: 0,
              expired: 0,
              unknown: 0,
            },
            pack: {
              id: "google-docs-editors",
              title: "Google Docs Editors Expert",
              domain: "google-workspace",
              version: "1.0.0",
              description:
                "Source-backed Google Workspace guidance for Drive sharing, Docs, Sheets, Slides, and lightweight Apps Script automation.",
              sourceTiers: [
                "google_workspace_official",
                "google_developer_official",
              ],
              recipe: {
                name: "Google Docs Editors Expert",
                description: "Google Workspace guidance",
                job: "Never access Gmail, Drive, Docs, Sheets, Slides, or Apps Script directly.",
                inputs: "Question and visible evidence",
                output: "Cited guidance",
              },
              records: [
                {
                  id: "drive-share-specific-people",
                  title: "Share Drive Files With Specific People",
                  topic: "drive.sharing.people",
                  sourceTier: "google_workspace_official",
                  appliesTo: ["Google Drive", "Google Docs editors"],
                  symptoms: ["A collaborator cannot open a Google file"],
                  steps: ["Open Share"],
                  verification: ["The intended person appears"],
                  risk: "medium",
                  sourceUrls: [
                    "https://support.google.com/docs/answer/2494822?hl=en",
                  ],
                  lastVerified: "2026-06-18",
                  tags: ["drive", "sharing", "permissions"],
                },
                {
                  id: "workspace-admin-policy-boundaries",
                  title: "Recognize Workspace Admin Policy Boundaries",
                  topic: "workspace.admin_policy",
                  sourceTier: "google_workspace_official",
                  appliesTo: ["Google Workspace Admin", "Google Drive"],
                  symptoms: ["External sharing is blocked"],
                  steps: ["Collect the exact error text"],
                  verification: ["A Workspace admin confirms the policy"],
                  risk: "high",
                  sourceUrls: ["https://support.google.com/a/answer/60781"],
                  lastVerified: "2026-06-18",
                  tags: ["admin", "policy", "sharing"],
                },
              ],
              scenarios: [
                {
                  id: "client-cannot-open-shared-file",
                  title: "Client cannot open shared file",
                  prompt:
                    "A client or outside collaborator says they cannot open a shared Google file.",
                  recordIds: [
                    "drive-share-specific-people",
                    "workspace-admin-policy-boundaries",
                  ],
                  requiredEvidence: [
                    "Exact error text or access request message",
                    "Current role shown in Share: viewer, commenter, or editor",
                  ],
                  expectedSections: [
                    "What to check",
                    "Steps",
                    "Verification",
                    "Risk",
                    "Sources",
                  ],
                  risk: "medium",
                },
              ],
            },
          }
        : {
            ok: true,
            packId: "macos",
            sourceTiers: ["apple_official", "mac_admin"],
            freshness: {
              status: "current",
              current: 12,
              stale: 0,
              expired: 0,
              unknown: 0,
            },
            pack: {
              id: "macos",
              title: "Mac Expert",
              domain: "macos",
              version: "1.0.0",
              description: "Source-backed macOS guidance.",
              sourceTiers: ["apple_official", "mac_admin"],
              recipe: {
                name: "Mac Expert",
                description: "Mac guidance",
                job: "Ask before suggesting Terminal commands.",
                inputs: "Question",
                output: "Answer",
              },
              records: [],
            },
          },
    );
    api.spsInstallLocalExpert.mockResolvedValue({
      ok: true,
      packId: "google-docs-editors",
      installed: true,
      recordsWritten: 10,
      recordsSkipped: 0,
      recipeId: "ar_google_docs",
      skillPath:
        "/skills/assistant-recipes/assistant-google-docs-editors-expert",
      recordsLeftInVault: false,
    });

    render(<LearningSurface profile="default" />);

    fireEvent.click(await screen.findByText("Experts"));
    const googleCard = (
      await screen.findAllByText("Google Docs Editors Expert")
    )[0].closest(".memory-entry-card");
    if (!(googleCard instanceof HTMLElement)) {
      throw new Error("Google expert card was not rendered.");
    }
    expect(within(googleCard).getByText(/10 records/)).toBeInTheDocument();

    fireEvent.click(within(googleCard).getByText("View"));

    expect(
      await screen.findByText("Client cannot open shared file"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Common workflows/)).toBeInTheDocument();
    expect(
      screen.getByText(/Exact error text or access request message/),
    ).toBeInTheDocument();
    expect(screen.getByText(/drive-share-specific-people/)).toBeInTheDocument();
    expect(
      screen.getByText("Share Drive Files With Specific People"),
    ).toBeInTheDocument();

    const selectedGoogleCard = screen
      .getAllByText("Google Docs Editors Expert")[0]
      .closest(".memory-entry-card");
    if (!(selectedGoogleCard instanceof HTMLElement)) {
      throw new Error("Google expert card was not available for install.");
    }
    fireEvent.click(within(selectedGoogleCard).getByText("Install"));

    await waitFor(() =>
      expect(api.spsInstallLocalExpert).toHaveBeenCalledWith(
        "google-docs-editors",
        "default",
      ),
    );
    expect(
      await screen.findByText(/Installed Google Docs Editors Expert/),
    ).toBeInTheDocument();
  });

  it("shows local expert detail and runs pack actions", async () => {
    render(<LearningSurface profile="default" />);

    fireEvent.click(await screen.findByText("Experts"));
    expect(await screen.findByText("Pack detail")).toBeInTheDocument();
    expect(
      await screen.findByText("Grant Screen Recording Permission"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Common workflows")).toBeInTheDocument();
    expect(
      await screen.findByText("Client cannot open shared file"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Exact error text/)).toBeInTheDocument();
    expect(screen.getByText(/privacy-screen-recording/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Choose pack"));
    await waitFor(() => expect(api.spsPickLocalExpertPack).toHaveBeenCalled());
    expect(screen.getByDisplayValue("/granted/excel.json")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Preview import"));
    await waitFor(() =>
      expect(api.spsPreviewLocalExpertPack).toHaveBeenCalledWith(
        "/granted/excel.json",
        "default",
      ),
    );

    fireEvent.click(screen.getByText("Choose export path"));
    await waitFor(() =>
      expect(api.spsPickLocalExpertPackExportPath).toHaveBeenCalledWith(
        "macos",
      ),
    );
    expect(
      screen.getByDisplayValue("/granted/exports/macos.json"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Export pack"));
    await waitFor(() =>
      expect(api.spsExportLocalExpertPack).toHaveBeenCalledWith(
        "macos",
        "/granted/exports/macos.json",
        "default",
      ),
    );

    fireEvent.click(screen.getByText("Enable checks"));
    await waitFor(() =>
      expect(api.spsEnableLocalExpertChecks).toHaveBeenCalledWith(
        "macos",
        "default",
      ),
    );
  });
});
