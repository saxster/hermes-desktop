// skill-packs.ts — preview + import of skill packs (see shared/skill-packs.ts
// for the envelope). Mirrors the Local Experts flow: preview-first with a
// pack hash, conflicts reported not overwritten, and installation = writing
// validated SKILL.md folders into the profile's own skills/ directory (the
// same write boundary importLocalSkill enforces). No network fetch.
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import { listInstalledSkills } from "./skills";
import { recordSkillCapability } from "./capability-risk-store";
import { profileHome, safeWriteFile } from "./utils";
import {
  SKILL_PACK_SCHEMA_VERSION,
  skillPackSkillToMarkdown,
  validateSkillPack,
  type SkillPack,
  type SkillPackImportResult,
  type SkillPackPreviewResult,
  type SkillPackSkill,
} from "../shared/skill-packs";
import { registerOutcomeKitContent } from "./outcome-kits";

/** Key-sorted stable JSON (recursive), so a pack's hash is content-defined. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/** sha256 over the pack object only (envelope metadata excluded). */
export function skillPackHash(pack: SkillPack): string {
  return createHash("sha256").update(stableStringify(pack)).digest("hex");
}

/** Unwrap `{schemaVersion: 1, pack}`; tolerate a bare pack for hand-authored files. */
function unwrapPackEnvelope(raw: unknown): unknown {
  const envelope = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  if (envelope.schemaVersion !== undefined) {
    if (envelope.schemaVersion !== SKILL_PACK_SCHEMA_VERSION) return null;
    return envelope.pack ?? null;
  }
  return raw;
}

function installedKeys(profile?: string): Set<string> {
  return new Set(
    listInstalledSkills(profile).map(
      (skill) => `${skill.category}/${skill.name}`,
    ),
  );
}

function skillCategory(skill: SkillPackSkill, pack: SkillPack): string {
  return skill.category ?? pack.packId;
}

/**
 * Validate a pack file and report import conflicts (skills already installed).
 * canImport requires zero validation errors and at least one new skill.
 */
export function previewSkillPack(
  filePath: string,
  profile?: string,
): SkillPackPreviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    return {
      ok: false,
      canImport: false,
      errors: [`Could not read the pack file: ${(err as Error).message}`],
    };
  }
  const raw = unwrapPackEnvelope(parsed);
  if (raw == null) {
    return {
      ok: false,
      canImport: false,
      errors: [
        `Unsupported schemaVersion (expected ${SKILL_PACK_SCHEMA_VERSION}).`,
      ],
    };
  }
  const validation = validateSkillPack(raw);
  if (!validation.ok || !validation.pack) {
    return { ok: false, canImport: false, errors: validation.errors };
  }
  const pack = validation.pack;
  const installed = installedKeys(profile);
  const conflicts = pack.skills
    .filter((skill) =>
      installed.has(`${skillCategory(skill, pack)}/${skill.name}`),
    )
    .map((skill) => skill.name);
  const errors: string[] = [];
  if (conflicts.length === pack.skills.length && !pack.outcomeKit) {
    errors.push("Every skill in this pack is already installed.");
  }
  return {
    ok: true,
    canImport: errors.length === 0,
    errors,
    conflicts,
    pack,
    skillCount: pack.skills.length,
    packHash: skillPackHash(pack),
  };
}

function skillsRootFor(profile?: string): string {
  return join(profileHome(profile), "skills");
}

/** Writes stay inside the profile's own skills/ root — same boundary as importLocalSkill. */
function isInsideSkillsRoot(target: string, profile?: string): boolean {
  const root = resolve(skillsRootFor(profile));
  const resolved = resolve(target);
  return resolved === root || resolved.startsWith(root + sep);
}

/**
 * Import = preview + write. Conflicting skills are skipped (never
 * overwritten); each installed skill gets a capability record, mirroring
 * importLocalSkill.
 */
export function importSkillPack(
  filePath: string,
  profile?: string,
): SkillPackImportResult {
  const preview = previewSkillPack(filePath, profile);
  if (!preview.canImport || !preview.pack) {
    return {
      ok: false,
      imported: [],
      skipped: preview.conflicts ?? [],
      errors: preview.errors,
    };
  }
  const pack = preview.pack;
  const installed = installedKeys(profile);
  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  for (const skill of pack.skills) {
    const category = skillCategory(skill, pack);
    const key = `${category}/${skill.name}`;
    if (installed.has(key)) {
      skipped.push(skill.name);
      continue;
    }
    const dest = join(skillsRootFor(profile), category, skill.name);
    if (!isInsideSkillsRoot(dest, profile)) {
      errors.push(`Refused write outside the skills directory: ${key}`);
      continue;
    }
    if (existsSync(dest)) {
      skipped.push(skill.name);
      continue;
    }
    try {
      mkdirSync(dest, { recursive: true });
      safeWriteFile(join(dest, "SKILL.md"), skillPackSkillToMarkdown(skill));
      for (const [relPath, content] of Object.entries(skill.files ?? {})) {
        const target = join(dest, relPath);
        if (!isInsideSkillsRoot(target, profile)) {
          throw new Error(`unsafe file path ${relPath}`);
        }
        mkdirSync(dirname(target), { recursive: true });
        safeWriteFile(target, content);
      }
      recordSkillCapability(
        {
          name: skill.name,
          category,
          path: dest,
          enabled: true,
          source: { localPath: filePath },
        },
        profile,
      );
      imported.push(skill.name);
    } catch (err) {
      errors.push(`${key}: ${(err as Error).message}`);
    }
  }
  let outcomeKitRegistered = false;
  if (errors.length === 0 && pack.outcomeKit) {
    registerOutcomeKitContent(
      pack.outcomeKit,
      skillPackHash(pack),
      [...imported, ...skipped],
      profile,
    );
    outcomeKitRegistered = true;
  }
  return {
    ok: errors.length === 0,
    packId: pack.packId,
    imported,
    skipped,
    errors,
    outcomeKitRegistered,
  };
}
