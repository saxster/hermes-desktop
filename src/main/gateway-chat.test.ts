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

import { gatewayChat } from "./gateway-chat";

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
