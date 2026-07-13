import { describe, expect, it, vi } from "vitest";
import { resolveLatestEngineRelease } from "./engine-release";

function response(
  body: unknown,
  ok = true,
  status = 200,
): {
  ok: boolean;
  status: number;
  statusText: string;
  json: ReturnType<typeof vi.fn>;
} {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Bad Request",
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("latest Hermes Agent release resolution", () => {
  it("resolves a named release tag to an immutable commit SHA", async () => {
    const sha = "a".repeat(40);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          tag_name: "v0.16.0",
          name: "Hermes Agent v0.16.0",
          html_url:
            "https://github.com/NousResearch/hermes-agent/releases/tag/v0.16.0",
          published_at: "2026-06-05T12:00:00Z",
          body: "Release notes",
        }),
      )
      .mockResolvedValueOnce(response({ sha }));

    await expect(resolveLatestEngineRelease(fetchImpl)).resolves.toEqual({
      tag: "v0.16.0",
      name: "Hermes Agent v0.16.0",
      sha,
      url: "https://github.com/NousResearch/hermes-agent/releases/tag/v0.16.0",
      publishedAt: "2026-06-05T12:00:00Z",
      notes: "Release notes",
    });
    expect(fetchImpl.mock.calls[1][0]).toMatch(/\/commits\/v0\.16\.0$/);
  });

  it("rejects malformed release tags before constructing a commit URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response({ tag_name: "../../main" }));

    await expect(resolveLatestEngineRelease(fetchImpl)).rejects.toThrow(
      "valid tag",
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects a tag that does not resolve to a full commit SHA", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ tag_name: "v0.16.0" }))
      .mockResolvedValueOnce(response({ sha: "main" }));

    await expect(resolveLatestEngineRelease(fetchImpl)).rejects.toThrow(
      "commit SHA",
    );
  });
});
