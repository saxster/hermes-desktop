export type IpcArgumentKind =
  | "array"
  | "boolean"
  | "number"
  | "record"
  | "string"
  | "unknown";

export interface IpcArgumentContract {
  kind: IpcArgumentKind;
  optional?: boolean;
}

export type IpcArgumentTupleContract = readonly IpcArgumentContract[];

const optionalString = { kind: "string", optional: true } as const;

/**
 * Channel-specific contracts for arguments that cross security- or
 * configuration-sensitive boundaries. Other channels still receive the
 * universal bounded structured-clone validation below.
 */
export const IPC_ARGUMENT_CONTRACTS: Readonly<
  Record<string, IpcArgumentTupleContract>
> = {
  "add-mcp-server": [{ kind: "record" }, optionalString],
  "approve-pairing": [{ kind: "string" }, optionalString],
  "create-profile": [{ kind: "string" }, { kind: "boolean" }],
  "delete-profile": [{ kind: "string" }],
  "open-external": [{ kind: "string" }],
  "remove-mcp-server": [{ kind: "string" }, optionalString],
  "revoke-pairing": [{ kind: "string" }, optionalString],
  "run-hermes-import": [{ kind: "string" }, optionalString],
  "set-app-zoom-factor": [{ kind: "number" }],
  "set-env": [
    { kind: "string" },
    { kind: "string" },
    optionalString,
  ],
  "set-locale": [{ kind: "string" }],
  "set-mcp-server-enabled": [
    { kind: "string" },
    { kind: "boolean" },
    optionalString,
  ],
  "sps-trigger-screencapture": [optionalString],
  "test-mcp-server": [{ kind: "string" }, optionalString],
};

const MAX_ARGUMENTS = 64;
const MAX_DEPTH = 64;
const MAX_NODES = 100_000;
const MAX_STRING_LENGTH = 64 * 1024 * 1024;

function matchesKind(value: unknown, kind: IpcArgumentKind): boolean {
  switch (kind) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "record":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "unknown":
      return true;
  }
}

function validateBoundedValue(value: unknown): void {
  const seen = new WeakSet<object>();
  let nodes = 0;

  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_NODES) throw new Error("IPC argument graph is too large.");
    if (depth > MAX_DEPTH) throw new Error("IPC argument graph is too deep.");
    if (typeof current === "string" && current.length > MAX_STRING_LENGTH) {
      throw new Error("IPC string argument is too large.");
    }
    if (
      current === null ||
      current === undefined ||
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean"
    ) {
      return;
    }
    if (
      typeof current === "function" ||
      typeof current === "symbol" ||
      typeof current === "bigint"
    ) {
      throw new Error("IPC argument contains an unsupported value.");
    }
    if (typeof current !== "object") return;
    if (ArrayBuffer.isView(current) || current instanceof ArrayBuffer) return;
    if (seen.has(current)) return;
    seen.add(current);
    for (const nested of Object.values(current as Record<string, unknown>)) {
      visit(nested, depth + 1);
    }
  };

  visit(value, 0);
}

export function validateIpcArguments(
  channel: string,
  args: readonly unknown[],
): void {
  if (args.length > MAX_ARGUMENTS) {
    throw new Error(`Invalid IPC arguments for "${channel}": too many arguments.`);
  }

  const contract = IPC_ARGUMENT_CONTRACTS[channel];
  if (contract) {
    const required = contract.filter((argument) => !argument.optional).length;
    if (args.length < required || args.length > contract.length) {
      throw new Error(`Invalid IPC arguments for "${channel}": wrong arity.`);
    }
    for (let index = 0; index < contract.length; index += 1) {
      const argument = contract[index];
      const value = args[index];
      if (value === undefined && argument.optional) continue;
      if (!matchesKind(value, argument.kind)) {
        throw new Error(
          `Invalid IPC argument ${index + 1} for "${channel}": expected ${argument.kind}.`,
        );
      }
    }
  }

  for (const argument of args) validateBoundedValue(argument);
}
