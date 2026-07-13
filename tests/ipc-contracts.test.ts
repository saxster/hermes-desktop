import { describe, expect, it } from "vitest";
import {
  IPC_ARGUMENT_CONTRACTS,
  validateIpcArguments,
} from "../src/shared/ipc-contracts";

describe("IPC argument contracts", () => {
  it("declares the sensitive configuration and capability channels", () => {
    expect(Object.keys(IPC_ARGUMENT_CONTRACTS)).toEqual(
      expect.arrayContaining([
        "add-mcp-server",
        "open-external",
        "run-hermes-import",
        "set-env",
        "set-mcp-server-enabled",
      ]),
    );
  });

  it("accepts optional trailing profile arguments", () => {
    expect(() =>
      validateIpcArguments("set-mcp-server-enabled", ["github", true, "work"]),
    ).not.toThrow();
    expect(() =>
      validateIpcArguments("set-mcp-server-enabled", ["github", false]),
    ).not.toThrow();
  });

  it("rejects wrong arity and non-finite numbers", () => {
    expect(() => validateIpcArguments("set-locale", [])).toThrow("wrong arity");
    expect(() =>
      validateIpcArguments("set-app-zoom-factor", [Number.NaN]),
    ).toThrow("expected number");
  });

  it("applies bounded structured-clone validation to undeclared channels", () => {
    expect(() =>
      validateIpcArguments("plain-channel", [{ ok: true }]),
    ).not.toThrow();
    expect(() =>
      validateIpcArguments("plain-channel", [{ callback: () => undefined }]),
    ).toThrow("unsupported value");
  });
});
