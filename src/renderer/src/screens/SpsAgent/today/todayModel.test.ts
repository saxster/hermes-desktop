import { describe, expect, it } from "vitest";
import {
  dailyBriefPageId,
  daysBetween,
  isOverdue,
  latestBriefDate,
  localDateKey,
  splitTasks,
  taskNeedsAttentionToday,
  untriagedCount,
} from "./todayModel";
import type { Task } from "../types";
import type { VaultRow } from "../hooks/useNoteIndex";

function task(patch: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Renew the guard licences",
    status: "todo",
    prio: "med",
    who: "self",
    due: "",
    est: "",
    ...patch,
  };
}

function row(props: Record<string, unknown>): VaultRow {
  return { path: "_inbox/x.md", title: "x", props, mtime: 0 };
}

describe("localDateKey", () => {
  it("formats local Y-M-D with zero padding", () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("uses the LOCAL date, not the UTC one", () => {
    // 2026-07-27T00:30 local. In any timezone east of UTC this is still the
    // 26th in UTC — a UTC key would hand the owner yesterday.
    const localMidnightish = new Date(2026, 6, 27, 0, 30);
    expect(localDateKey(localMidnightish)).toBe("2026-07-27");
  });
});

describe("dailyBriefPageId", () => {
  it("matches the id the engine is told to write", () => {
    expect(dailyBriefPageId("2026-07-26")).toBe("daily-brief-2026-07-26");
  });
});

describe("taskNeedsAttentionToday", () => {
  it("is true for work in motion or stuck", () => {
    for (const status of ["doing", "review", "blocked"] as const) {
      expect(taskNeedsAttentionToday(task({ status }), "2026-07-26")).toBe(
        true,
      );
    }
  });

  it("is true for a task due today or already past", () => {
    expect(
      taskNeedsAttentionToday(task({ due: "2026-07-26" }), "2026-07-26"),
    ).toBe(true);
    expect(
      taskNeedsAttentionToday(task({ due: "2026-07-20" }), "2026-07-26"),
    ).toBe(true);
  });

  it("is false for an untouched task due later", () => {
    expect(
      taskNeedsAttentionToday(task({ due: "2026-08-30" }), "2026-07-26"),
    ).toBe(false);
  });

  it("is false for an open task with no due date and no motion", () => {
    expect(taskNeedsAttentionToday(task(), "2026-07-26")).toBe(false);
  });
});

describe("isOverdue", () => {
  it("separates past-due from due-today", () => {
    expect(isOverdue(task({ due: "2026-07-25" }), "2026-07-26")).toBe(true);
    expect(isOverdue(task({ due: "2026-07-26" }), "2026-07-26")).toBe(false);
  });

  it("is false when there is no due date, whatever the status", () => {
    expect(isOverdue(task({ status: "blocked" }), "2026-07-26")).toBe(false);
  });
});

describe("splitTasks", () => {
  it("drops done tasks from both lanes", () => {
    const split = splitTasks(
      [task({ id: "a", status: "done", due: "2026-07-01" })],
      "2026-07-26",
    );
    expect(split.today).toHaveLength(0);
    expect(split.next).toHaveLength(0);
  });

  it("routes each open task to exactly one lane", () => {
    const tasks = [
      task({ id: "due", due: "2026-07-26" }),
      task({ id: "moving", status: "doing" }),
      task({ id: "someday" }),
      task({ id: "later", due: "2026-09-01" }),
    ];
    const split = splitTasks(tasks, "2026-07-26");
    expect(split.today.map((t) => t.id)).toEqual(["due", "moving"]);
    expect(split.next.map((t) => t.id)).toEqual(["someday", "later"]);
  });
});

describe("untriagedCount", () => {
  it("counts unprocessed and processing, not processed or discarded", () => {
    const rows = [
      row({ status: "unprocessed" }),
      row({ status: "processing" }),
      row({ status: "processed" }),
      row({ status: "discarded" }),
    ];
    expect(untriagedCount(rows)).toBe(2);
  });

  it("treats a row with no status as still waiting", () => {
    expect(untriagedCount([row({})])).toBe(1);
  });
});

describe("latestBriefDate", () => {
  it("returns the newest brief date", () => {
    const ids = [
      "daily-brief-2026-07-20",
      "home",
      "daily-brief-2026-07-25",
      "daily-brief-2026-07-11",
    ];
    expect(latestBriefDate(ids)).toBe("2026-07-25");
  });

  it("ignores brief-ish ids that are not dated", () => {
    expect(latestBriefDate(["daily-brief-draft", "daily-brief-"])).toBeNull();
  });

  it("returns null when the vault has no briefs", () => {
    expect(latestBriefDate(["home", "tasks"])).toBeNull();
  });
});

describe("daysBetween", () => {
  it("counts whole days forward and back", () => {
    expect(daysBetween("2026-07-20", "2026-07-26")).toBe(6);
    expect(daysBetween("2026-07-26", "2026-07-20")).toBe(-6);
    expect(daysBetween("2026-07-26", "2026-07-26")).toBe(0);
  });

  it("survives a DST-style month boundary", () => {
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2);
  });
});
