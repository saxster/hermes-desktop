import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from "fs";
import { basename, join } from "path";
import type { VaultProposal, VaultProposalInput } from "../shared/sps-types";
import {
  frontmatterJsonLine,
  wrapFrontmatterLines,
} from "../shared/sps-frontmatter";
import { createSkill, listInstalledSkills } from "./skills";
import {
  createVaultProposalIn,
  listVaultProposalsIn,
} from "./vault-review-queue";
import { deliverOwnerEvent } from "./owner-delivery";
import { profileHome } from "./utils";
import { createActiveWorkRun, updateActiveWorkRun } from "./active-work-runs";

export interface TaskProposalSpoolInput {
  requestId: string;
  title: string;
  body?: string;
  due?: string;
  priority?: "high" | "med" | "low";
  requester?: string;
  source?: "telegram" | "email";
  requestedAt?: number;
}

export interface TaskProposalDrainResult {
  created: VaultProposal[];
  rejected: string[];
  duplicates: string[];
}

const TASK_PROPOSAL_SKILL_NAME = "SPS task proposal";
const TASK_PROPOSAL_SKILL_BODY = `# SPS task proposal

Use this skill when an inbound Telegram or email message asks to create, add, remember, or follow up on a task in the SPS workspace.

This workflow is review-first. Never write to the SPS vault or task markdown directly. Instead run:

\`~/.hermes/bin/sps-propose-task --title "<task>" --source-message-id "<stable platform message id>" [--body "<context>"] [--due YYYY-MM-DD] [--priority high|med|low] [--source telegram|email]\`

Use the platform's stable message id so retries remain idempotent. Preserve the user's words. Include a due date or priority only when the message states one; do not infer missing facts. After the command succeeds, tell the sender the task is awaiting approval in the SPS AI Review Queue.

Ontology source: Hermes Desktop \`docs/ONTOLOGY.md\` defines Task as a Note with \`type: task\`, workflow status, dates, and assignee. The desktop adapter translates an approved proposal into the current folder-backed \`vault/tasks/<id>.md\` task schema. Approval is the only write boundary.`;

function spoolDir(profileRoot: string): string {
  return join(profileRoot, "sps-agent", "task-proposals", "inbox");
}

function rejectedDir(profileRoot: string): string {
  return join(profileRoot, "sps-agent", "task-proposals", "rejected");
}

function normalizeInput(value: unknown): TaskProposalSpoolInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<TaskProposalSpoolInput>;
  const requestId =
    typeof input.requestId === "string" ? input.requestId.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!requestId || requestId.length > 240 || !title || title.length > 240) {
    return null;
  }
  const body =
    typeof input.body === "string" ? input.body.trim().slice(0, 10_000) : "";
  const due =
    typeof input.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.due)
      ? input.due
      : undefined;
  const priority = ["high", "med", "low"].includes(input.priority || "")
    ? input.priority
    : "med";
  const source = input.source === "email" ? "email" : "telegram";
  return {
    requestId,
    title,
    ...(body ? { body } : {}),
    ...(due ? { due } : {}),
    priority,
    source,
    requester:
      typeof input.requester === "string"
        ? input.requester.trim().slice(0, 240)
        : undefined,
    requestedAt:
      typeof input.requestedAt === "number" &&
      Number.isFinite(input.requestedAt)
        ? input.requestedAt
        : Date.now(),
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function taskProposalInput(
  input: TaskProposalSpoolInput,
): VaultProposalInput {
  const requestSuffix = slug(input.requestId).slice(-12) || "request";
  const rowId = `${slug(input.title) || "task"}-${requestSuffix}`;
  const due = input.due || "";
  const priority = input.priority || "med";
  const props: Record<string, unknown> = {
    title: input.title,
    type: "task",
    status: "todo",
    prio: priority,
    priority,
    who: "me",
    route: "human",
    source: input.source || "telegram",
    sourceMessageId: input.requestId,
    requestedAt: input.requestedAt || Date.now(),
  };
  if (due) {
    props.due = due;
    props.due_date = due;
  }
  if (input.requester) props.requester = input.requester;
  const markdown = wrapFrontmatterLines(
    Object.entries(props).map(([key, value]) =>
      frontmatterJsonLine(key, value),
    ),
    input.body || "",
    input.body ? "\n\n" : "\n",
  );
  const marker = `[request:${input.requestId}]`;
  return {
    source: "telegram",
    title: `Create task: ${input.title}`,
    summary: `${marker} ${input.source || "telegram"} requested a task. Review before writing to SPS.`,
    operations: [
      {
        id: `task-${requestSuffix}`,
        kind: "create-task",
        rowId,
        title: input.title,
        markdown,
      },
    ],
  };
}

function quarantine(profileRoot: string, path: string): void {
  const targetDir = rejectedDir(profileRoot);
  mkdirSync(targetDir, { recursive: true });
  renameSync(path, join(targetDir, basename(path)));
}

export async function drainTaskProposalSpoolIn(
  profileRoot: string,
): Promise<TaskProposalDrainResult> {
  const dir = spoolDir(profileRoot);
  const result: TaskProposalDrainResult = {
    created: [],
    rejected: [],
    duplicates: [],
  };
  if (!existsSync(dir)) return result;
  const existing = await listVaultProposalsIn(profileRoot);

  for (const name of readdirSync(dir)
    .filter((item) => item.endsWith(".json"))
    .slice(0, 100)) {
    const path = join(dir, name);
    let input: TaskProposalSpoolInput | null = null;
    try {
      input = normalizeInput(JSON.parse(readFileSync(path, "utf-8")));
    } catch {
      input = null;
    }
    if (!input) {
      quarantine(profileRoot, path);
      result.rejected.push(name);
      continue;
    }
    const marker = `[request:${input.requestId}]`;
    if (existing.some((proposal) => proposal.summary.includes(marker))) {
      unlinkSync(path);
      result.duplicates.push(input.requestId);
      continue;
    }
    const proposal = await createVaultProposalIn(
      profileRoot,
      taskProposalInput(input),
    );
    existing.push(proposal);
    unlinkSync(path);
    result.created.push(proposal);
  }
  return result;
}

export async function drainTaskProposalSpool(
  profile?: string,
): Promise<TaskProposalDrainResult> {
  const result = await drainTaskProposalSpoolIn(profileHome(profile));
  for (const proposal of result.created) {
    const active = await createActiveWorkRun(
      {
        source: "proposal-triggered",
        trigger: "external",
        reviewPolicy: "review-first",
        clientRunId: `task-proposal:${proposal.id}`,
        title: proposal.title,
        goal: "Preserve the inbound task request as a reviewable workspace proposal.",
        criteria: [
          {
            text: "Create a reviewable task proposal without writing it directly to the workspace.",
          },
        ],
        expectedArtifacts: [
          { kind: "proposal", label: "Task proposal", required: true },
        ],
      },
      profile,
    );
    const createdAt = Date.now();
    const proposalArtifact = {
      id: `artifact_${createdAt.toString(36)}_proposal`,
      kind: "proposal" as const,
      label: proposal.title,
      ref: proposal.id,
      createdAt,
    };
    await updateActiveWorkRun(
      active.id,
      {
        status: "awaiting-review",
        summary: proposal.summary,
        criteria: active.criteria.map((criterion) => ({
          ...criterion,
          done: true,
          evidence: {
            summary:
              "The inbound request was converted into a review-only proposal.",
            artifactId: proposalArtifact.id,
            verifiedAt: createdAt,
            verifiedBy: "system" as const,
          },
        })),
        artifacts: [proposalArtifact],
      },
      profile,
    );
    await deliverOwnerEvent(
      {
        id: `task-proposal:${proposal.id}`,
        kind: "task-proposal",
        title: "Task proposal needs review",
        body: proposal.title.replace(/^Create task:\s*/, ""),
      },
      profile,
    );
  }
  return result;
}

export function ensureSpsTaskProposalSkill(profile?: string): void {
  const installed = listInstalledSkills(profile);
  if (
    installed.some(
      (skill) =>
        skill.name.toLowerCase() === TASK_PROPOSAL_SKILL_NAME.toLowerCase(),
    )
  ) {
    return;
  }
  createSkill({
    name: TASK_PROPOSAL_SKILL_NAME,
    description:
      "Turn inbound Telegram or email task requests into review-only SPS task proposals.",
    category: "productivity",
    body: TASK_PROPOSAL_SKILL_BODY,
    profile,
  });
}
