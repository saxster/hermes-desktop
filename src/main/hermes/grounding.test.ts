import { beforeEach, describe, expect, it, vi } from "vitest";

// grounding.ts statically imports note-index (better-sqlite3, Electron ABI)
// and semantic-index — both are mocked so the module loads under vitest. The
// fake index drives the entity-relations path end to end.
const fakeIndex = vi.hoisted(() => ({
  search: vi.fn(),
  status: vi.fn(() => ({ root: "/vault" })),
  links: vi.fn(
    (): Array<{
      source: string;
      target: string;
      type: string;
      kind: string;
    }> => [],
  ),
  backlinkDetails: vi.fn(
    (): Array<{ source: string; type: string; kind: string }> => [],
  ),
}));

vi.mock("../note-index", () => ({
  getSpsNoteIndex: vi.fn(async () => fakeIndex),
  parseFrontmatter: (raw: string) => {
    const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
    if (!match) return { props: null, body: raw };
    const props: Record<string, unknown> = {};
    for (const line of match[1].split("\n")) {
      const m = /^(\w+):\s*(.+)$/.exec(line);
      if (m) {
        try {
          props[m[1]] = JSON.parse(m[2]);
        } catch {
          props[m[1]] = m[2];
        }
      }
    }
    return { props, body: match[2] };
  },
}));

vi.mock("../semantic-index", () => ({
  semanticManager: { search: vi.fn(async () => ({ results: [] })) },
}));

const readFileMock = vi.hoisted(() => vi.fn());
vi.mock("fs/promises", () => ({
  default: { readFile: readFileMock },
  readFile: readFileMock,
}));

import {
  buildRetrievalSystemMessage,
  formatRetrievalSystemMessage,
  isEntityFrontmatter,
} from "./grounding";

const PERSON_MARKDOWN = `---
title: "Ravi Menon"
schema: "person"
---

Investor at Bluebay.
`;

const PLAIN_MARKDOWN = `---
title: "Random note"
---

Some prose.
`;

beforeEach(() => {
  vi.clearAllMocks();
  fakeIndex.status.mockReturnValue({ root: "/vault" });
  fakeIndex.links.mockReturnValue([]);
  fakeIndex.backlinkDetails.mockReturnValue([]);
});

describe("isEntityFrontmatter", () => {
  it("recognizes schema and type entity markers", () => {
    expect(isEntityFrontmatter({ schema: "person" })).toBe(true);
    expect(isEntityFrontmatter({ type: "task" })).toBe(true);
    expect(isEntityFrontmatter({ schema: "  " })).toBe(false);
    expect(isEntityFrontmatter({})).toBe(false);
  });
});

describe("formatRetrievalSystemMessage", () => {
  it("renders the Linked line for sources with relations", () => {
    const message = formatRetrievalSystemMessage([
      {
        title: "Ravi Menon",
        relPath: "people/ravi-menon.md",
        absPath: "/vault/people/ravi-menon.md",
        excerpt: "Investor at Bluebay.",
        relations: ["attendee → meeting-2026-07-19-sync"],
      },
    ]);
    expect(message?.content).toContain(
      "Linked: attendee → meeting-2026-07-19-sync",
    );
  });

  it("omits the Linked line when there are no relations", () => {
    const message = formatRetrievalSystemMessage([
      {
        title: "Note",
        relPath: "note.md",
        absPath: "/vault/note.md",
        excerpt: "Text.",
      },
    ]);
    expect(message?.content).not.toContain("Linked:");
  });
});

describe("buildRetrievalSystemMessage (entity relations)", () => {
  it("attaches typed outgoing + incoming neighbors to entity hits", async () => {
    fakeIndex.search.mockReturnValue([
      { path: "people/ravi-menon.md", title: "Ravi Menon", snippet: "ravi" },
    ]);
    fakeIndex.links.mockReturnValue([
      {
        source: "people/ravi-menon.md",
        target: "meeting-2026-07-19-sync.md",
        type: "attendee",
        kind: "link",
      },
    ]);
    fakeIndex.backlinkDetails.mockReturnValue([
      { source: "tasks/task-deck.md", type: "assignee", kind: "link" },
    ]);
    readFileMock.mockResolvedValue(PERSON_MARKDOWN);

    const message = await buildRetrievalSystemMessage(
      "tell me about ravi",
      undefined,
      {
        expandQuery: false,
      },
    );
    expect(message?.content).toContain("attendee → meeting-2026-07-19-sync");
    expect(message?.content).toContain("assignee ← task-deck");
  });

  it("leaves non-entity hits relation-free", async () => {
    fakeIndex.search.mockReturnValue([
      { path: "notes/plain.md", title: "Plain", snippet: "plain" },
    ]);
    readFileMock.mockResolvedValue(PLAIN_MARKDOWN);

    const message = await buildRetrievalSystemMessage("plain note", undefined, {
      expandQuery: false,
    });
    expect(message?.content).not.toContain("Linked:");
    expect(fakeIndex.links).not.toHaveBeenCalled();
  });
});
