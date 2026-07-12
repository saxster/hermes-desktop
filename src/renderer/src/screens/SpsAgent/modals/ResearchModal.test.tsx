import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchModal } from "./ResearchModal";

const store = vi.hoisted(() => ({
  setResearchOpen: vi.fn(),
  setScheduledOpen: vi.fn(),
  setScheduledDraftTopic: vi.fn(),
  importResearchWork: vi.fn(),
  runResearch: vi.fn(),
  saveStudyToWiki: vi.fn(),
  flash: vi.fn(),
  openContentStudioIdea: vi.fn(),
  openDeckStudioInput: vi.fn(),
  selectPage: vi.fn(),
  setSurface: vi.fn(),
}));

const api = vi.hoisted(() => ({
  spsResearchEnsureAgentTool: vi.fn(),
  getToolsets: vi.fn(),
  getResearchReachStatus: vi.fn(),
  spsResearchGetConfig: vi.fn(),
  spsNotebookLmStatus: vi.fn(),
  spsCuratedBrief: vi.fn(),
  spsStudyCard: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
  store.runResearch.mockResolvedValue({
    ok: true,
    summary: "Sourced summary for operators.",
    pageId: "research-page",
    undo: vi.fn(),
  });
  store.saveStudyToWiki.mockResolvedValue({
    ok: true,
    summary: "Saved curated brief.",
    undo: vi.fn(),
  });
  api.spsCuratedBrief.mockResolvedValue({
    kind: "chat",
    reply: [
      [
        "## Perspectives",
        "Operators need grounded pre-writing.",
        "",
        "## Brief",
        "Curated briefs help teams draft from sources.",
        "",
        "## Sources",
        "- [Brief](https://brief.example/source)",
      ].join("\n"),
    ],
  });
  api.spsStudyCard.mockResolvedValue({
    kind: "chat",
    reply: [
      [
        "# Distilled video",
        "",
        "## Big takeaway",
        "Long media becomes a scannable card.",
        "",
        "## Time economics",
        "- Source: 20 min",
        "- Read: 4 min",
        "- Saved: 16 min",
        "",
        "## Sections",
        "",
        "### Point",
        "- Keep the structure fixed",
        "",
        "## Sources",
        "- [Talk](https://www.youtube.com/watch?v=card-demo)",
      ].join("\n"),
    ],
  });
  api.getToolsets.mockResolvedValue([{ key: "web", enabled: true }]);
  api.getResearchReachStatus.mockResolvedValue({
    installed: false,
    channels: [],
  });
  api.spsResearchGetConfig.mockResolvedValue({ mailto: "", hasApiKey: false });
  api.spsNotebookLmStatus.mockResolvedValue({
    registered: false,
    alreadyPresent: false,
    commandFound: true,
    command: "notebooklm-mcp",
    args: [],
    source: "path",
    nlmCommand: "nlm",
    restarted: false,
    message: "NotebookLM can connect through the local MCP server.",
  });
});

describe("ResearchModal", () => {
  it("renders as a persistent workspace without modal chrome", () => {
    const { container } = render(<ResearchModal embedded />);

    expect(screen.getByLabelText("Research workspace")).toBeInTheDocument();
    expect(container.querySelector(".scrim")).toBeNull();
    expect(screen.getByText("Recent research")).toBeInTheDocument();
  });

  it("opens the saved page from the embedded research workspace", async () => {
    render(<ResearchModal embedded />);

    fireEvent.change(screen.getByPlaceholderText(/research any topic/i), {
      target: { value: "Open the saved result" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Research$/ }));
    await screen.findByText("Sourced summary for operators.");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(store.selectPage).toHaveBeenCalledWith("research-page");
    expect(store.setSurface).toHaveBeenCalledWith("doc");
  });

  it("removes an undone result from recent research", async () => {
    render(<ResearchModal embedded />);

    fireEvent.change(screen.getByPlaceholderText(/research any topic/i), {
      target: { value: "Undo this result" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Research$/ }));
    await screen.findByText("Sourced summary for operators.");
    expect(localStorage.getItem("sps-research-history-v1")).toContain(
      "research-page",
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(localStorage.getItem("sps-research-history-v1")).toBe("[]");
  });

  it("ignores valid JSON with an invalid history shape", () => {
    localStorage.setItem("sps-research-history-v1", '{"pageId":"bad"}');

    render(<ResearchModal embedded />);

    expect(
      screen.getByText("Completed research will appear here for quick return."),
    ).toBeInTheDocument();
  });

  it("warns when social source coverage is not ready", async () => {
    api.getResearchReachStatus.mockResolvedValue({
      installed: true,
      version: "1.5.0",
      checkedAt: Date.now(),
      channels: [
        {
          key: "web",
          label: "Web pages",
          status: "ready",
          tier: 0,
          activeBackend: "Jina Reader",
          backends: ["Jina Reader"],
          message: "ready",
          needsLogin: false,
          zeroConfig: true,
        },
        {
          key: "reddit",
          label: "Reddit",
          status: "needsSetup",
          tier: 1,
          activeBackend: null,
          backends: ["OpenCLI"],
          message: "login required",
          needsLogin: true,
          zeroConfig: false,
        },
        {
          key: "twitter",
          label: "Twitter/X",
          status: "unavailable",
          tier: 1,
          activeBackend: null,
          backends: ["twitter-cli"],
          message: "missing backend",
          needsLogin: true,
          zeroConfig: false,
        },
      ],
    });

    render(<ResearchModal />);
    fireEvent.click(await screen.findByRole("button", { name: /socials/i }));

    expect(
      await screen.findByText("Social sources need setup: Reddit, Twitter/X."),
    ).toBeInTheDocument();
  });

  it("opens Content Studio from saved research", async () => {
    render(<ResearchModal />);

    fireEvent.change(screen.getByPlaceholderText(/research any topic/i), {
      target: { value: "Research-backed content idea" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Research$/ }));

    expect(
      await screen.findByText("Sourced summary for operators."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /save as content idea/i }),
    );

    await waitFor(() =>
      expect(store.openContentStudioIdea).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Research-backed content idea",
          capturedFrom: "research-reach",
        }),
      ),
    );
  });

  it("runs a Curated Brief, saves it to the wiki, and opens Content Studio", async () => {
    render(<ResearchModal />);

    fireEvent.click(screen.getByRole("button", { name: /curated brief/i }));
    fireEvent.change(screen.getByPlaceholderText(/topic or decision/i), {
      target: { value: "Source-backed product research" },
    });
    fireEvent.change(screen.getByTitle("Corpus description"), {
      target: { value: "Use https://one.example/source." },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate brief/i }));

    expect(await screen.findByText(/curated briefs help/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save to wiki/i }));

    await waitFor(() => {
      expect(api.spsCuratedBrief).toHaveBeenCalledWith(
        "Source-backed product research",
        "Use https://one.example/source.",
      );
      expect(store.saveStudyToWiki).toHaveBeenCalledWith(
        "Source-backed product research",
        expect.stringContaining("## Sources"),
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: /save as content idea/i }),
    );

    await waitFor(() =>
      expect(store.openContentStudioIdea).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Source-backed product research",
          capturedFrom: "curated-brief",
        }),
      ),
    );
  });

  it("does not save a Curated Brief without usable sources", async () => {
    api.spsCuratedBrief.mockResolvedValue({
      kind: "chat",
      reply: ["## Brief\nUnsupported.\n\n## Sources\n- Internal notes"],
    });
    render(<ResearchModal />);

    fireEvent.click(screen.getByRole("button", { name: /curated brief/i }));
    fireEvent.change(screen.getByPlaceholderText(/topic or decision/i), {
      target: { value: "Unsourced curated brief" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate brief/i }));

    expect(await screen.findByText(/unsupported/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save to wiki/i }));

    expect(store.saveStudyToWiki).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/could not find usable source links/i),
    ).toBeInTheDocument();
  });

  it("runs a Study card, shows time saved, and opens Deck Studio", async () => {
    render(<ResearchModal />);

    fireEvent.click(screen.getByRole("button", { name: /^study card$/i }));
    fireEvent.change(
      screen.getByPlaceholderText(/video, article, or source/i),
      { target: { value: "YouTube procrastination talk" } },
    );
    fireEvent.change(screen.getByTitle("Corpus description"), {
      target: { value: "https://www.youtube.com/watch?v=card-demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /distill card/i }));

    expect(
      await screen.findByText(/long media becomes a scannable card/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("study-card-time-saved")).toHaveTextContent(
      /You just saved 16 min/i,
    );
    expect(api.spsStudyCard).toHaveBeenCalledWith(
      "YouTube procrastination talk",
      "https://www.youtube.com/watch?v=card-demo",
    );

    fireEvent.click(
      screen.getByRole("button", { name: /deck from study card/i }),
    );

    expect(store.openDeckStudioInput).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "YouTube procrastination talk",
        theme: "research",
        notes: expect.stringContaining("Big takeaway"),
      }),
    );
  });

  it("opens Deck Studio from a Curated Brief", async () => {
    render(<ResearchModal />);

    fireEvent.click(screen.getByRole("button", { name: /curated brief/i }));
    fireEvent.change(screen.getByPlaceholderText(/topic or decision/i), {
      target: { value: "Deckable curated brief" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate brief/i }));

    expect(await screen.findByText(/curated briefs help/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /deck from brief/i }));

    expect(store.openDeckStudioInput).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Deckable curated brief",
        notes: expect.stringContaining("## Perspectives"),
        theme: "research",
      }),
    );
  });
});
