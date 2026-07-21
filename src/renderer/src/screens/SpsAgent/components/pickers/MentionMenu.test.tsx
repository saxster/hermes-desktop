import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  tree: [
    {
      id: "home",
      children: [{ id: "project", children: [] }],
    },
    { id: "new-page", children: [] },
  ],
  meta: {
    home: { title: "Home", icon: "🏠" },
    project: { title: "Project Alpha", icon: "📁" },
    "new-page": { title: "New page", icon: "📄" },
  },
}));

vi.mock("../../store", () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock("../../hooks/usePersonPages", () => ({
  usePersonPages: () => ({
    persons: [
      {
        id: "ravi-menon",
        name: "Ravi Menon",
        aliases: [],
        fragments: [],
      },
    ],
  }),
}));

import { MentionMenu } from "./MentionMenu";

describe("MentionMenu", () => {
  it("lists nested and newly-created pages from the live workspace tree", () => {
    render(
      <MentionMenu x={10} y={10} query="" onPick={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    expect(screen.getByText("New page")).toBeInTheDocument();
  });

  it("invokes the enrichment and autofill callbacks for person items", () => {
    const onProposeEnrichment = vi.fn();
    const onProposeAutofill = vi.fn();
    render(
      <MentionMenu
        x={10}
        y={10}
        query=""
        onPick={vi.fn()}
        onClose={vi.fn()}
        onProposeEnrichment={onProposeEnrichment}
        onProposeAutofill={onProposeAutofill}
      />,
    );

    fireEvent.mouseDown(
      screen.getByRole("button", { name: /suggest details for ravi menon/i }),
    );
    expect(onProposeEnrichment).toHaveBeenCalledWith("ravi-menon");

    fireEvent.mouseDown(
      screen.getByRole("button", {
        name: /suggest properties for ravi menon/i,
      }),
    );
    expect(onProposeAutofill).toHaveBeenCalledWith("ravi-menon");
  });
});
