import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { TaskDrawer } from "./TaskDrawer";

let replaceTask: (task: Task) => void = () => {};
const store = vi.hoisted(() => ({
  setOpenTask: vi.fn((task: Task) => replaceTask(task)),
  updateTask: vi.fn(),
  flash: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock("../hooks/usePersonPages", () => ({
  usePersonPages: () => ({ persons: [] }),
}));

vi.mock("../hooks/useKanbanStatuses", () => ({
  useKanbanStatuses: () => ({ statusFor: () => null }),
}));

const initialTask: Task = {
  id: "tasks/task-1.md",
  title: "Initial task",
  status: "todo",
  prio: "med",
  who: "you",
  due: "",
  est: "",
};

function Harness(): React.JSX.Element {
  const [task, setTask] = useState(initialTask);
  useEffect(() => {
    replaceTask = setTask;
    return () => {
      replaceTask = () => {};
    };
  }, []);
  return <TaskDrawer task={task} onClose={() => {}} />;
}

describe("TaskDrawer folder-backed writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps optimistic edits visible and serializes whole-row writes", async () => {
    let releaseFirstWrite: (() => void) | undefined;
    const firstWrite = new Promise<boolean>((resolve) => {
      releaseFirstWrite = () => resolve(true);
    });
    const spsExportRow = vi
      .fn()
      .mockReturnValueOnce(firstWrite)
      .mockResolvedValue(true);
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        spsReadRow: vi
          .fn()
          .mockResolvedValue(
            '---\ntitle: "Initial task"\nstatus: "todo"\nprio: "med"\nwho: "you"\n---\n',
          ),
        spsExportRow,
      },
    });

    render(<Harness />);
    const title = await screen.findByDisplayValue("Initial task");
    fireEvent.change(title, { target: { value: "Renamed task" } });
    fireEvent.blur(title);
    await waitFor(() => expect(spsExportRow).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "doing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    expect(screen.getByDisplayValue("New subtask")).toBeInTheDocument();
    expect(window.hermesAPI.spsReadRow).toHaveBeenCalledTimes(1);
    expect(spsExportRow).toHaveBeenCalledTimes(1);

    releaseFirstWrite?.();
    await waitFor(() => expect(spsExportRow).toHaveBeenCalledTimes(3));
    const finalMarkdown = spsExportRow.mock.calls[2]?.[2] as string;
    expect(finalMarkdown).toContain('title: "Renamed task"');
    expect(finalMarkdown).toContain('status: "doing"');
    expect(finalMarkdown).toContain("- [ ] New subtask");
  });

  it("warns when a folder-backed task cannot be saved", async () => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        spsReadRow: vi.fn().mockResolvedValue(
          '---\ntitle: "Initial task"\nstatus: "todo"\nprio: "med"\nwho: "you"\n---\n',
        ),
        spsExportRow: vi.fn().mockResolvedValue(false),
      },
    });

    render(<Harness />);
    const title = await screen.findByDisplayValue("Initial task");
    fireEvent.change(title, { target: { value: "Unsaved title" } });
    fireEvent.blur(title);

    await waitFor(() =>
      expect(store.flash).toHaveBeenCalledWith(
        expect.stringMatching(/not saved/i),
        expect.objectContaining({ tone: "warn" }),
      ),
    );
  });
});
