// gateway-chat.test.ts — which api_server_key a one-shot gateway call sends.
//
// getRemoteAuthHeader() takes no profile, so it resolves the DEFAULT profile's
// key. gatewayChat is always given a profile, and getApiServerKey reads
// API_SERVER_KEY / api_server.token per profile (config/api-server-key.ts), so
// a non-default profile with its own key was being sent the default one.
import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayFetch = vi.fn();
const getGatewayAuthHeader = vi.fn();

vi.mock("./security/network-policy", () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
}));
vi.mock("./hermes", () => ({
  getApiUrl: () => "http://127.0.0.1:8642",
  getGatewayAuthHeader: (profile?: string) => getGatewayAuthHeader(profile),
}));

vi.mock("./log", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { gatewayChat, GatewayChatError } from "./gateway-chat";

function okResponse(): unknown {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: "hi" } }] }),
  };
}

function headersOfLastCall(): Record<string, string> {
  const init = gatewayFetch.mock.calls[0][1] as {
    headers: Record<string, string>;
  };
  return init.headers;
}

function bodyOfLastCall(): Record<string, unknown> {
  const init = gatewayFetch.mock.calls[0][1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("gatewayChat auth", () => {
  beforeEach(() => {
    gatewayFetch.mockReset().mockResolvedValue(okResponse());
    getGatewayAuthHeader.mockReset().mockReturnValue({});
  });

  it("resolves the auth header against the profile it is calling for", async () => {
    await gatewayChat([{ role: "user", content: "ping" }], 64, "work");

    expect(getGatewayAuthHeader).toHaveBeenCalledWith("work");
  });

  it("passes the resolved key through to the request", async () => {
    getGatewayAuthHeader.mockReturnValue({ Authorization: "Bearer sk-work" });

    await gatewayChat([{ role: "user", content: "ping" }], 64, "work");

    expect(headersOfLastCall().Authorization).toBe("Bearer sk-work");
  });

  it("sends no Authorization when the gateway has no key configured", async () => {
    await gatewayChat([{ role: "user", content: "ping" }], 64);

    expect(headersOfLastCall().Authorization).toBeUndefined();
    expect(headersOfLastCall()["Content-Type"]).toBe("application/json");
  });
});

describe("gatewayChat request shape", () => {
  beforeEach(() => {
    gatewayFetch.mockReset().mockResolvedValue(okResponse());
    getGatewayAuthHeader.mockReset().mockReturnValue({});
  });

  it("sends max_tokens when a cap is given", async () => {
    await gatewayChat([{ role: "user", content: "ping" }], 512);

    expect(bodyOfLastCall().max_tokens).toBe(512);
  });

  // The callers collapsed onto this helper did NOT all cap their output. A
  // default cap would silently truncate a long page mid-JSON, so `null` must
  // omit the field rather than substitute a number.
  it("omits max_tokens entirely when the cap is null", async () => {
    await gatewayChat([{ role: "user", content: "ping" }], null);

    expect("max_tokens" in bodyOfLastCall()).toBe(false);
  });

  it("always asks for a non-streaming completion", async () => {
    await gatewayChat([{ role: "user", content: "ping" }], null);

    expect(bodyOfLastCall().stream).toBe(false);
  });

  it("carries vision content parts through unchanged", async () => {
    const content = [
      { type: "text" as const, text: "what broke?" },
      { type: "image_url" as const, image_url: { url: "data:image/png;b" } },
    ];

    await gatewayChat([{ role: "user", content }], null);

    expect(bodyOfLastCall().messages).toEqual([{ role: "user", content }]);
  });
});

describe("gatewayChat errors", () => {
  beforeEach(() => {
    gatewayFetch.mockReset();
    getGatewayAuthHeader.mockReset().mockReturnValue({});
  });

  // Callers with a retry loop branch on the status: a 4xx must not be retried,
  // a 5xx gets one more attempt. Before this, each re-derived that from a raw
  // Response; now the status has to survive on the thrown error.
  it("throws a GatewayChatError carrying the status and body", async () => {
    gatewayFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "slow down",
    });

    const err = await gatewayChat([{ role: "user", content: "x" }], null).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(GatewayChatError);
    expect((err as GatewayChatError).status).toBe(429);
    expect((err as GatewayChatError).body).toBe("slow down");
    expect((err as GatewayChatError).message).toBe("gateway 429: slow down");
  });

  it("still reports the status when the error body cannot be read", async () => {
    gatewayFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => {
        throw new Error("socket closed");
      },
    });

    const err = await gatewayChat([{ role: "user", content: "x" }], null).catch(
      (e: unknown) => e,
    );

    expect((err as GatewayChatError).status).toBe(503);
    expect((err as GatewayChatError).body).toBe("");
  });

  it("returns an empty string when the gateway sends no choices", async () => {
    gatewayFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const text = await gatewayChat([{ role: "user", content: "x" }], null);

    expect(text).toBe("");
  });
});
