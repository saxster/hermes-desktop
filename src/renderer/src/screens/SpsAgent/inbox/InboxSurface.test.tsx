import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxSurface } from "./InboxSurface";

const ocr = vi.hoisted(() => ({
  ocrImageBlobToText: vi.fn(),
}));

vi.mock("../lib/ocr", () => ocr);

const vaultState = vi.hoisted(() => ({
  rows: [] as Array<{
    path: string;
    title: string;
    props: Record<string, unknown>;
    mtime: number;
  }>,
  refetch: vi.fn(),
}));

vi.mock("../hooks/useNoteIndex", () => ({
  useVaultQuery: () => vaultState,
}));

const storeState = vi.hoisted(() => ({
  ingestCommitPage: vi.fn(),
  flash: vi.fn(),
  setSurface: vi.fn(),
  importPdf: vi.fn(),
  saveStudyToWiki: vi.fn(),
  pendingInboxMode: null as "image" | null,
  clearPendingInboxMode: vi.fn(),
}));

function useStoreMock<T>(selector: (state: typeof storeState) => T): T {
  return selector(storeState);
}
useStoreMock.getState = () => storeState;

vi.mock("../store", () => ({
  useStore: useStoreMock,
}));

const api = {
  readObsidianFile: vi.fn(),
  writeObsidianFile: vi.fn(),
  spsExportRow: vi.fn(),
  spsPickImage: vi.fn(),
  spsReadFileBytes: vi.fn(),
  spsAssetWrite: vi.fn(),
  spsReadRow: vi.fn(),
  spsTeachCapture: vi.fn(),
  spsFileAnswer: vi.fn(),
  spsListRecentScreenshots: vi.fn(),
  spsEmailMonitorGetConfig: vi.fn(),
  spsEmailMonitorGetStatus: vi.fn(),
  spsEmailMonitorRunNow: vi.fn(),
  spsEmailMonitorApplyFeedback: vi.fn(),
  spsEmailMonitorSaveConfig: vi.fn(),
  spsEmailDraftReply: vi.fn(),
  spsEmailOpenReply: vi.fn(),
  spsClassifyTask: vi.fn(),
  spsRouteTask: vi.fn(),
  spsInboxDigestRunNow: vi.fn(),
  spsImportTranscript: vi.fn(),
  spsMeetingExtract: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  vaultState.rows = [];
  vaultState.refetch.mockReset();
  storeState.flash.mockReset();
  storeState.clearPendingInboxMode.mockReset();
  storeState.pendingInboxMode = null;
  storeState.saveStudyToWiki.mockResolvedValue({ ok: true, pageId: "study" });
  ocr.ocrImageBlobToText.mockReset();
  ocr.ocrImageBlobToText.mockResolvedValue("Question 1 OCR text.");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })),
    }),
  );
  installApi();
  api.readObsidianFile.mockResolvedValue(null);
  api.writeObsidianFile.mockResolvedValue(true);
  api.spsExportRow.mockResolvedValue(true);
  api.spsPickImage.mockResolvedValue("/tmp/biology-page.png");
  api.spsReadFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  api.spsAssetWrite.mockResolvedValue("a".repeat(64) + ".png");
  api.spsReadRow.mockResolvedValue(
    [
      "---",
      'title: "Textbook page"',
      'source: "image"',
      'assetPath: "' + "a".repeat(64) + '.png"',
      'ocrStatus: "not-run"',
      "---",
      "",
      "![Capture](../_assets/" + "a".repeat(64) + ".png)",
    ].join("\n"),
  );
  api.spsTeachCapture.mockResolvedValue({
    kind: "chat",
    reply: ["## Answers\n\n1. Worked answer with pedagogy."],
  });
  api.spsListRecentScreenshots.mockResolvedValue([]);
  api.spsEmailMonitorGetConfig.mockResolvedValue({
    accounts: [
      {
        id: "ops",
        label: "Ops inbox",
        emailAddress: "ops@example.com",
        imapHost: "imap.example.com",
        enabled: true,
        folders: ["INBOX"],
        allowSenders: [],
        allowDomains: [],
        blockSenders: [],
        blockDomains: [],
        importanceKeywords: ["roster"],
        ignoredKeywords: [],
        captureThreshold: 0.45,
        maxMessageBytes: 1048576,
        maxAttachmentBytes: 10485760,
      },
    ],
  });
  api.spsEmailMonitorGetStatus.mockResolvedValue({
    running: false,
    accounts: [
      {
        accountId: "ops",
        label: "Ops inbox",
        state: "idle",
        captured: 1,
        skipped: 2,
        errors: 0,
      },
    ],
  });
  api.spsEmailMonitorRunNow.mockResolvedValue({
    ok: true,
    captured: 1,
    skipped: 2,
    errors: 0,
  });
  api.spsEmailMonitorApplyFeedback.mockResolvedValue({
    accounts: [],
  });
  api.spsEmailMonitorSaveConfig.mockImplementation((config: unknown) =>
    Promise.resolve(config),
  );
  api.spsEmailDraftReply.mockResolvedValue({
    ok: true,
    draft: {
      to: "client@bluebay.example",
      subject: "Re: Bluebay roster change",
      body: "Thanks for the update — please send the roster over.",
    },
  });
  api.spsEmailOpenReply.mockResolvedValue(true);
  api.spsClassifyTask.mockResolvedValue({
    route: "human",
    assigneeId: "you",
    nagCadence: "daily",
  });
  api.spsRouteTask.mockResolvedValue({
    route: "human",
    status: "todo",
    dispatched: false,
  });
  api.spsInboxDigestRunNow.mockResolvedValue({
    ok: true,
    id: "inbox-2026-07-19",
    counts: { total: 3, action: 1, newsletters: 2 },
  });
  api.spsImportTranscript.mockResolvedValue({ success: true, id: "cap_m1" });
  api.spsMeetingExtract.mockResolvedValue({
    created: true,
    proposalId: "prop_1",
    tasks: 2,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("InboxSurface visual captures", () => {
  it("shows email source monitor status and sends feedback actions", async () => {
    render(<InboxSurface />);

    fireEvent.click(screen.getByRole("button", { name: /sources/i }));

    expect(await screen.findByText(/email sources/i)).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Ops inbox")).toBeInTheDocument();
    expect(screen.getByText(/1 captured/i)).toBeInTheDocument();
    expect(screen.getByText(/2 skipped/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/sender rule/i), {
      target: { value: "noise@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /ignore sender/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorApplyFeedback).toHaveBeenCalledWith(
        {
          accountId: "ops",
          action: "ignore-sender",
          sender: "noise@example.com",
        },
        "default",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /check now/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorRunNow).toHaveBeenCalledWith("default");
    });
  });

  it("toggles an account's enabled flag and persists on Save changes", async () => {
    render(<InboxSurface />);
    fireEvent.click(screen.getByRole("button", { name: /sources/i }));

    const toggle = await screen.findByLabelText(/enabled/i);
    expect(toggle).toBeChecked();

    // Save is inert until an edit dirties the config.
    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeDisabled();

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorSaveConfig).toHaveBeenCalledTimes(1);
    });
    const savedConfig = api.spsEmailMonitorSaveConfig.mock.calls[0][0] as {
      accounts: Array<{ id: string; enabled: boolean }>;
    };
    expect(savedConfig.accounts[0]).toMatchObject({
      id: "ops",
      enabled: false,
    });
  });

  it("adds a new account, edits it, and saves both accounts", async () => {
    render(<InboxSurface />);
    fireEvent.click(screen.getByRole("button", { name: /sources/i }));
    await screen.findByDisplayValue("Ops inbox");

    fireEvent.click(screen.getByRole("button", { name: /add account/i }));

    const addressInputs = screen.getAllByPlaceholderText(/you@example.com/i);
    expect(addressInputs).toHaveLength(2);
    fireEvent.change(addressInputs[1], {
      target: { value: "cafe@bluebop.cafe" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorSaveConfig).toHaveBeenCalledTimes(1);
    });
    const savedConfig = api.spsEmailMonitorSaveConfig.mock.calls[0][0] as {
      accounts: Array<{ emailAddress: string }>;
    };
    expect(savedConfig.accounts).toHaveLength(2);
    expect(savedConfig.accounts[1].emailAddress).toBe("cafe@bluebop.cafe");
  });

  it("removes an account and persists the smaller config", async () => {
    render(<InboxSurface />);
    fireEvent.click(screen.getByRole("button", { name: /sources/i }));
    await screen.findByDisplayValue("Ops inbox");

    fireEvent.click(screen.getByRole("button", { name: /remove account/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorSaveConfig).toHaveBeenCalledTimes(1);
    });
    const savedConfig = api.spsEmailMonitorSaveConfig.mock.calls[0][0] as {
      accounts: unknown[];
    };
    expect(savedConfig.accounts).toHaveLength(0);
  });

  it("opens image capture mode from the first-run checklist intent", async () => {
    storeState.pendingInboxMode = "image";

    render(<InboxSurface />);

    expect(
      await screen.findByRole("button", { name: /capture screen/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import from clipboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Image").closest("button")).toHaveClass("active");
    await waitFor(() => {
      expect(api.spsListRecentScreenshots).toHaveBeenCalledWith("default");
    });
    expect(storeState.clearPendingInboxMode).toHaveBeenCalledTimes(1);
  });

  it("saves a chosen image file to the Inbox without OCR or teaching", async () => {
    render(<InboxSurface />);

    fireEvent.click(screen.getByRole("button", { name: /image/i }));
    fireEvent.change(screen.getByLabelText(/image note/i), {
      target: { value: "Teach later, but save now." },
    });
    fireEvent.click(screen.getByRole("button", { name: /choose image file/i }));

    await waitFor(() => {
      expect(api.spsExportRow).toHaveBeenCalled();
    });
    const markdown = String(api.spsExportRow.mock.calls.at(-1)?.[2]);
    expect(markdown).toContain('source: "image"');
    expect(markdown).toContain('assetPath: "' + "a".repeat(64) + '.png"');
    expect(markdown).toContain('captureOrigin: "file"');
    expect(markdown).toContain('ocrStatus: "not-run"');
    expect(markdown).toContain("Teach later, but save now.");
    expect(ocr.ocrImageBlobToText).not.toHaveBeenCalled();
    expect(api.spsTeachCapture).not.toHaveBeenCalled();
  });

  it("runs OCR and Teach This only from explicit visual capture actions", async () => {
    vaultState.rows = [
      {
        path: "_inbox/cap-image.md",
        title: "Textbook page",
        props: {
          title: "Textbook page",
          source: "image",
          assetPath: "a".repeat(64) + ".png",
          ocrStatus: "not-run",
          capturedAt: 1,
        },
        mtime: 1,
      },
    ];

    render(<InboxSurface />);

    expect(api.spsTeachCapture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /extract text/i }));

    await waitFor(() => {
      expect(ocr.ocrImageBlobToText).toHaveBeenCalled();
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "_inbox",
        "cap-image",
        expect.stringContaining("## OCR Text\n\nQuestion 1 OCR text."),
        "default",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /teach this/i }));

    await waitFor(() => {
      expect(api.spsTeachCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          captureId: "cap-image",
          title: "Textbook page",
          corpusDescription: expect.stringContaining("Question 1 OCR text."),
        }),
        "default",
      );
      expect(
        screen.getByText(/worked answer with pedagogy/i),
      ).toBeInTheDocument();
    });
  });
});

describe("InboxSurface email triage surface", () => {
  function emailRow(
    path: string,
    title: string,
    props: Record<string, unknown> = {},
  ) {
    return {
      path,
      title,
      props: {
        title,
        source: "email",
        status: "unprocessed",
        capturedAt: Date.now(),
        emailAccount: "Ops inbox",
        emailAccountId: "ops",
        emailFrom: "client@bluebay.example",
        ...props,
      },
      mtime: 0,
    };
  }

  it("renders the triage chip and reason line on an email capture card", async () => {
    vaultState.rows = [
      emailRow("_inbox/cap_1.md", "Bluebay roster change", {
        triageLabel: "action",
        triageReason: 'Matched important keyword "roster".',
        triageConfidence: 0.78,
      }),
    ];
    render(<InboxSurface />);

    const chip = await screen.findByText("action");
    expect(chip.className).toContain("chip");
    expect(chip.className).toContain("p-med");
    expect(chip).toHaveAttribute("title", "Confidence 78%");
    expect(
      screen.getByText(/matched important keyword "roster"/i),
    ).toBeInTheDocument();
  });

  it("sends card-level feedback with the capture's account id and sender", async () => {
    vaultState.rows = [
      emailRow("_inbox/cap_1.md", "Bluebay roster change", {
        triageLabel: "archive",
      }),
    ];
    render(<InboxSurface />);

    fireEvent.click(await screen.findByTitle(/triage is wrong/i));
    fireEvent.click(screen.getByRole("button", { name: /^ignore sender$/i }));

    await waitFor(() => {
      expect(api.spsEmailMonitorApplyFeedback).toHaveBeenCalledWith(
        {
          accountId: "ops",
          action: "ignore-sender",
          sender: "client@bluebay.example",
        },
        "default",
      );
    });
    expect(storeState.flash).toHaveBeenCalledWith(
      expect.stringContaining("client@bluebay.example"),
    );
  });

  it("falls back to the account-label lookup for pre-Slice-4 captures", async () => {
    vaultState.rows = [
      emailRow("_inbox/cap_old.md", "Old capture", {
        emailAccountId: undefined,
      }),
    ];
    render(<InboxSurface />);

    fireEvent.click(await screen.findByTitle(/triage is wrong/i));
    fireEvent.click(
      screen.getByRole("button", { name: /^always capture sender$/i }),
    );

    await waitFor(() => {
      expect(api.spsEmailMonitorApplyFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: "ops" }),
        "default",
      );
    });
  });

  it("folds digest captures into a collapsible Newsletters card", async () => {
    vaultState.rows = [
      emailRow("_inbox/cap_1.md", "Roster change"),
      emailRow("_inbox/cap_n1.md", "Newsletter one", { digest: true }),
      emailRow("_inbox/cap_n2.md", "Newsletter two", { digest: true }),
    ];
    render(<InboxSurface />);

    const toggle = await screen.findByRole("button", {
      name: /newsletters \(2\)/i,
    });
    // Digest rows stay hidden until expanded; normal rows render as cards.
    expect(screen.getByText("Roster change")).toBeInTheDocument();
    expect(screen.queryByText("Newsletter one")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("Newsletter one")).toBeInTheDocument();
    expect(screen.getByText("Newsletter two")).toBeInTheDocument();
  });
});

describe("InboxSurface email actions", () => {
  function emailActionRow(path: string, title: string) {
    return {
      path,
      title,
      props: {
        title,
        source: "email",
        status: "unprocessed",
        capturedAt: Date.now(),
        emailAccountId: "ops",
        emailFrom: "client@bluebay.example",
        triageLabel: "action",
      },
      mtime: 0,
    };
  }

  it("drafts a reply, lets the user edit it, and hands off to Mail", async () => {
    vaultState.rows = [
      emailActionRow("_inbox/cap_1.md", "Bluebay roster change"),
    ];
    render(<InboxSurface />);

    fireEvent.click(await screen.findByRole("button", { name: /^reply$/i }));

    await waitFor(() => {
      expect(api.spsEmailDraftReply).toHaveBeenCalledWith("cap_1", "default");
    });
    const toField = await screen.findByLabelText(/reply recipient/i);
    expect(toField).toHaveValue("client@bluebay.example");
    expect(screen.getByLabelText(/reply subject/i)).toHaveValue(
      "Re: Bluebay roster change",
    );
    const bodyField = screen.getByLabelText(/reply body/i);
    expect(bodyField).toHaveValue(
      "Thanks for the update — please send the roster over.",
    );

    fireEvent.change(bodyField, { target: { value: "Edited reply body." } });
    fireEvent.click(screen.getByRole("button", { name: /open in mail/i }));

    await waitFor(() => {
      expect(api.spsEmailOpenReply).toHaveBeenCalledWith({
        to: "client@bluebay.example",
        subject: "Re: Bluebay roster change",
        body: "Edited reply body.",
      });
    });
    expect(storeState.flash).toHaveBeenCalledWith(
      expect.stringContaining("mail app"),
    );
  });

  it("turns an email capture into a routed task and marks it processed", async () => {
    api.spsReadRow.mockResolvedValue(
      [
        "---",
        'title: "Bluebay roster change"',
        'source: "email"',
        'emailFrom: "client@bluebay.example"',
        'status: "unprocessed"',
        "---",
        "",
        "Please send the updated roster by Friday.",
      ].join("\n"),
    );
    vaultState.rows = [
      emailActionRow("_inbox/cap_1.md", "Bluebay roster change"),
    ];
    render(<InboxSurface />);

    fireEvent.click(await screen.findByRole("button", { name: /→ task/i }));

    await waitFor(() => {
      expect(api.spsClassifyTask).toHaveBeenCalled();
      expect(api.spsRouteTask).toHaveBeenCalled();
    });
    // Task row persisted to the tasks folder; capture flipped to processed.
    const exportCalls = api.spsExportRow.mock.calls;
    expect(
      exportCalls.some(
        (call: unknown[]) =>
          call[0] === "tasks" &&
          /^task-/.test(call[1] as string) &&
          (call[2] as string).includes("source:: [[cap_1]]"),
      ),
    ).toBe(true);
    await waitFor(() => {
      expect(
        exportCalls.some(
          (call: unknown[]) =>
            call[0] === "_inbox" &&
            call[1] === "cap_1" &&
            (call[2] as string).includes("processed"),
        ),
      ).toBe(true);
    });
    expect(storeState.flash).toHaveBeenCalledWith(
      expect.stringContaining("Task created"),
    );
  });
});

describe("InboxSurface daily digest", () => {
  function digestRow() {
    return {
      path: "digests/inbox-2026-07-19.md",
      title: "Inbox digest — 2026-07-19",
      props: {
        title: "Inbox digest — 2026-07-19",
        kind: "inbox-digest",
        date: "2026-07-19",
        createdAt: Date.now(),
      },
      mtime: 0,
    };
  }

  it("shows the latest digest and expands its body on toggle", async () => {
    api.spsReadRow.mockResolvedValue(
      [
        "---",
        'title: "Inbox digest — 2026-07-19"',
        'kind: "inbox-digest"',
        "---",
        "",
        "## Needs action",
        "",
        "**Ravi** — pricing answer",
      ].join("\n"),
    );
    vaultState.rows = [digestRow()];
    render(<InboxSurface />);

    const toggle = await screen.findByRole("button", {
      name: /daily digest — 2026-07-19/i,
    });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(api.spsReadRow).toHaveBeenCalledWith(
        "digests",
        "inbox-2026-07-19",
        "default",
      );
    });
    expect(await screen.findByText(/pricing answer/i)).toBeInTheDocument();
  });

  it("never renders the digest card for non-digest rows", async () => {
    vaultState.rows = [
      {
        path: "_inbox/cap_1.md",
        title: "Roster change",
        props: { title: "Roster change", source: "email" },
        mtime: 0,
      },
    ];
    render(<InboxSurface />);
    await screen.findByText("Roster change");
    expect(
      screen.queryByRole("button", { name: /daily digest —/i }),
    ).not.toBeInTheDocument();
  });

  it("runs the digest on demand from the header button", async () => {
    vaultState.rows = [];
    render(<InboxSurface />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Daily digest" }),
    );

    await waitFor(() => {
      expect(api.spsInboxDigestRunNow).toHaveBeenCalledWith("default");
    });
    expect(storeState.flash).toHaveBeenCalledWith(
      expect.stringContaining("3 emails today"),
    );
  });
});

describe("InboxSurface meeting transcripts", () => {
  function meetingRow() {
    return {
      path: "_inbox/cap_m1.md",
      title: "Phoenix launch sync",
      props: {
        title: "Phoenix launch sync",
        source: "meeting",
        status: "unprocessed",
        capturedAt: Date.now(),
      },
      mtime: 0,
    };
  }

  it("imports a pasted transcript from the Meeting tab", async () => {
    render(<InboxSurface />);

    fireEvent.click(screen.getByRole("button", { name: /meeting/i }));
    fireEvent.change(screen.getByLabelText(/meeting transcript/i), {
      target: { value: "Alice: Kickoff.\nBob: noted." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /import transcript/i }),
    );

    await waitFor(() => {
      expect(api.spsImportTranscript).toHaveBeenCalledWith(
        { title: undefined, content: "Alice: Kickoff.\nBob: noted." },
        "default",
      );
    });
  });

  it("extracts a meeting capture into a review-queue proposal", async () => {
    vaultState.rows = [meetingRow()];
    render(<InboxSurface />);

    fireEvent.click(await screen.findByRole("button", { name: /^extract$/i }));

    await waitFor(() => {
      expect(api.spsMeetingExtract).toHaveBeenCalledWith("cap_m1", "default");
    });
    expect(storeState.flash).toHaveBeenCalledWith(
      expect.stringContaining("2 task(s)"),
    );
  });

  it("explains a duplicate extraction", async () => {
    api.spsMeetingExtract.mockResolvedValue({
      created: false,
      reason: "duplicate",
    });
    vaultState.rows = [meetingRow()];
    render(<InboxSurface />);

    fireEvent.click(await screen.findByRole("button", { name: /^extract$/i }));

    await waitFor(() => {
      expect(storeState.flash).toHaveBeenCalledWith(
        expect.stringContaining("Already proposed"),
      );
    });
  });
});
