import { describe, expect, it } from "vitest";
import { SPS_WORKSPACE_VERSION } from "../../shared/sps-types";
import { parseWorkspaceDocument, spsSave } from "./persistence";

const validWorkspace = {
  tree: [],
  meta: {},
  docs: {},
  comments: [],
  trash: [],
  page: "home",
};

describe("workspace document loading", () => {
  it("migrates the unversioned workspace shape to the current version", () => {
    const result = parseWorkspaceDocument(JSON.stringify(validWorkspace));
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.workspace.version).toBe(SPS_WORKSPACE_VERSION);
    }
  });

  it("distinguishes malformed JSON from an absent workspace", () => {
    expect(parseWorkspaceDocument("{broken")).toMatchObject({
      status: "corrupt",
    });
  });

  it("rejects an unsupported future schema version", () => {
    expect(
      parseWorkspaceDocument(
        JSON.stringify({ ...validWorkspace, version: 999 }),
      ),
    ).toEqual({
      status: "corrupt",
      error: "Unsupported workspace version: 999.",
    });
  });

  it("refuses to persist an invalid workspace payload", async () => {
    await expect(spsSave(null)).resolves.toMatchObject({
      ok: false,
      error: "Workspace schema is invalid.",
    });
  });
});
