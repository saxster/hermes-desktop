import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  taskBodyFromCapture,
  taskTextFromCapture,
  turnCaptureIntoTask,
  type EmailActionsApi,
} from "./emailActions";
import { parseYamlFrontmatterMarkdown } from "../../../../../shared/sps-frontmatter";
import type { VaultRow } from "../hooks/useNoteIndex";

const CAPTURE_MARKDOWN = `---
title: "Roster change"
source: "email"
emailFrom: "client@bluebay.example"
status: "unprocessed"
---

Please send the updated roster by Friday.
`;

function emailRow(): VaultRow {
  return {
    path: "_inbox/cap_1.md",
    title: "Roster change",
    props: {
      title: "Roster change",
      source: "email",
      emailFrom: "client@bluebay.example",
    },
    mtime: 0,
  };
}

function makeApi(overrides: Partial<EmailActionsApi> = {}): EmailActionsApi {
  return {
    spsReadRow: vi.fn(async () => CAPTURE_MARKDOWN),
    spsExportRow: vi.fn(async () => true),
    spsClassifyTask: vi.fn(async () => ({
      route: "human" as const,
      assigneeId: "you",
      nagCadence: "daily" as const,
    })),
    spsRouteTask: vi.fn(async () => ({
      route: "human" as const,
      status: "todo" as const,
      dispatched: false,
    })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("turnCaptureIntoTask", () => {
  it("persists the task first, then classifies and routes it", async () => {
    const api = makeApi();
    const result = await turnCaptureIntoTask(api, emailRow(), "default");
    expect(result).toEqual({
      ok: true,
      rowId: expect.stringMatching(/^task-/),
      status: "todo",
    });

    const exportMock = api.spsExportRow as ReturnType<typeof vi.fn>;
    expect(exportMock).toHaveBeenCalledTimes(2);
    // First write: status inbox, persist-first so nothing is lost.
    const firstMarkdown = exportMock.mock.calls[0][2] as string;
    expect(parseYamlFrontmatterMarkdown(firstMarkdown).props.status).toBe(
      "inbox",
    );
    // Final write: routing outcome + assignee mirrored onto who.
    const finalProps = parseYamlFrontmatterMarkdown(
      exportMock.mock.calls[1][2] as string,
    ).props;
    expect(finalProps.status).toBe("todo");
    expect(finalProps.route).toBe("human");
    expect(finalProps.who).toBe("you");

    const classifyMock = api.spsClassifyTask as ReturnType<typeof vi.fn>;
    const classifyText = classifyMock.mock.calls[0][0] as string;
    expect(classifyText).toContain("Roster change");
    expect(classifyText).toContain("From: client@bluebay.example");
    expect(classifyText).toContain("updated roster by Friday");

    const routeMock = api.spsRouteTask as ReturnType<typeof vi.fn>;
    expect(routeMock.mock.calls[0][0].rowId).toBe(result.rowId);
  });

  it("links the task back to its source capture", async () => {
    const api = makeApi();
    await turnCaptureIntoTask(api, emailRow());
    const exportMock = api.spsExportRow as ReturnType<typeof vi.fn>;
    const finalMarkdown = exportMock.mock.calls[1][2] as string;
    expect(finalMarkdown).toContain("source:: [[cap_1]]");
    expect(finalMarkdown).toContain("From: client@bluebay.example");
  });

  it("fails cleanly when the capture row is gone", async () => {
    const api = makeApi({ spsReadRow: vi.fn(async () => null) });
    const result = await turnCaptureIntoTask(api, emailRow());
    expect(result).toEqual({ ok: false, error: "capture-not-found" });
    expect(api.spsExportRow).not.toHaveBeenCalled();
  });

  it("does not classify when the initial persist fails", async () => {
    const api = makeApi({ spsExportRow: vi.fn(async () => false) });
    const result = await turnCaptureIntoTask(api, emailRow());
    expect(result).toEqual({ ok: false, error: "task-write-failed" });
    expect(api.spsClassifyTask).not.toHaveBeenCalled();
  });

  it("keeps the task in the inbox lane when classify/route fails", async () => {
    const api = makeApi({
      spsClassifyTask: vi.fn(async () => {
        throw new Error("gateway unreachable");
      }),
    });
    const result = await turnCaptureIntoTask(api, emailRow());
    expect(result.ok).toBe(true);
    expect(result.status).toBe("inbox");
    expect(api.spsExportRow).toHaveBeenCalledTimes(1);
  });
});

describe("taskTextFromCapture / taskBodyFromCapture", () => {
  it("builds classification text with sender context", () => {
    const text = taskTextFromCapture("Subject", "a@b.co", "Body here");
    expect(text).toBe("Subject\n\nFrom: a@b.co\n\nBody here");
  });

  it("omits the From line when the sender is unknown", () => {
    expect(taskTextFromCapture("Subject", "", "Body")).toBe("Subject\n\nBody");
  });

  it("appends provenance and the capture backlink to the task body", () => {
    const detail = taskBodyFromCapture("a@b.co", "Body here", "cap_9");
    expect(detail).toContain("Body here");
    expect(detail).toContain("From: a@b.co");
    expect(detail).toContain("source:: [[cap_9]]");
  });
});
