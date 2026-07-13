import { publicFetch } from "./security/network-policy";

const RELEASE_URL =
  "https://api.github.com/repos/NousResearch/hermes-agent/releases/latest";
const COMMITS_URL =
  "https://api.github.com/repos/NousResearch/hermes-agent/commits";

interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export type EngineReleaseFetch = (
  url: string,
  init?: RequestInit,
) => Promise<FetchResponse>;

export interface EngineReleaseTarget {
  tag: string;
  name: string;
  sha: string;
  url: string | null;
  publishedAt: string | null;
  notes: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function fetchJson(
  fetchImpl: EngineReleaseFetch,
  url: string,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub release lookup failed (${response.status} ${response.statusText}).`,
    );
  }
  return record(await response.json());
}

export async function resolveLatestEngineRelease(
  fetchImpl: EngineReleaseFetch = publicFetch,
): Promise<EngineReleaseTarget> {
  const release = await fetchJson(fetchImpl, RELEASE_URL);
  const tag = string(release.tag_name);
  if (!tag || !/^[A-Za-z0-9._-]+$/.test(tag)) {
    throw new Error("Latest Hermes Agent release did not provide a valid tag.");
  }

  // A GitHub release's target_commitish may be a branch name. Resolve the tag
  // through the commits API so update and rollback always receive an immutable
  // full commit SHA, including when the tag is annotated.
  const commit = await fetchJson(
    fetchImpl,
    `${COMMITS_URL}/${encodeURIComponent(tag)}`,
  );
  const sha = string(commit.sha);
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`Hermes Agent release ${tag} did not resolve to a commit SHA.`);
  }

  return {
    tag,
    name: string(release.name) || tag,
    sha,
    url: string(release.html_url),
    publishedAt: string(release.published_at),
    notes: string(release.body) || "",
  };
}
