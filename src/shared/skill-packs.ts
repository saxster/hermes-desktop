// skill-packs.ts — shared types + pure validation for skill packs: a JSON
// envelope of original SKILL.md-based skills (Agent Skills standard) that the
// owner previews and imports into the profile's skills/ directory. Modeled on
// the Local Experts pack pattern (schemaVersion + pack hash + preview-first);
// there is no upstream bundle format, so this envelope is ours.
import { validateOutcomeKit, type OutcomeKitDefinition } from "./outcome-kits";

export const SKILL_PACK_SCHEMA_VERSION = 1;
export const SKILL_PACK_MAX_SKILLS = 50;
export const SKILL_PACK_MAX_BODY_CHARS = 50_000;
export const SKILL_PACK_MAX_FILES = 10;
export const SKILL_PACK_MAX_FILE_CHARS = 100_000;

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** One skill in a pack — becomes `<category>/<name>/SKILL.md` (+ files). */
export interface SkillPackSkill {
  /** kebab-case folder/skill name. */
  name: string;
  /** Folder grouping under skills/; defaults to the packId. */
  category?: string;
  /** One sentence (<=200 chars) describing WHEN the agent should use it. */
  description: string;
  /** Markdown body after the SKILL.md frontmatter. */
  body: string;
  /** Optional extra files (e.g. main.py), relative safe paths → content. */
  files?: Record<string, string>;
}

export interface SkillPack {
  packId: string;
  title: string;
  version: number;
  description?: string;
  skills: SkillPackSkill[];
  /** Optional outcome contract layered over the installed skills. */
  outcomeKit?: OutcomeKitDefinition;
}

export interface SkillPackValidationResult {
  ok: boolean;
  errors: string[];
  pack?: SkillPack;
}

export interface SkillPackPreviewResult {
  ok: boolean;
  canImport: boolean;
  errors: string[];
  /** Skill names already installed (import skips them, never overwrites). */
  conflicts?: string[];
  pack?: SkillPack;
  skillCount?: number;
  packHash?: string;
}

export interface SkillPackImportResult {
  ok: boolean;
  packId?: string;
  imported: string[];
  skipped: string[];
  errors: string[];
  outcomeKitRegistered?: boolean;
}

function isSafeRelativeFilePath(value: string): boolean {
  if (!value || value.length > 200) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  const segments = value.split(/[\\/]+/);
  return segments.every(
    (segment) => segment && segment !== "." && segment !== "..",
  );
}

function validateSkill(
  raw: unknown,
  index: number,
  errors: string[],
): SkillPackSkill | null {
  const skill = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const label = `skills[${index}]`;
  const name = typeof skill.name === "string" ? skill.name.trim() : "";
  if (!SLUG_RE.test(name)) {
    errors.push(`${label}.name must be a kebab-case slug`);
    return null;
  }
  const description =
    typeof skill.description === "string" ? skill.description.trim() : "";
  if (!description || description.length > 200) {
    errors.push(`${label}.description must be 1-200 characters`);
    return null;
  }
  const body = typeof skill.body === "string" ? skill.body.trim() : "";
  if (!body || body.length > SKILL_PACK_MAX_BODY_CHARS) {
    errors.push(
      `${label}.body must be 1-${SKILL_PACK_MAX_BODY_CHARS} characters`,
    );
    return null;
  }
  const category =
    typeof skill.category === "string" ? skill.category.trim() : "";
  if (category && !SLUG_RE.test(category)) {
    errors.push(`${label}.category must be a kebab-case slug when present`);
    return null;
  }
  let files: Record<string, string> | undefined;
  if (skill.files !== undefined) {
    if (
      !skill.files ||
      typeof skill.files !== "object" ||
      Array.isArray(skill.files)
    ) {
      errors.push(`${label}.files must be an object of path → content`);
      return null;
    }
    const entries = Object.entries(skill.files as Record<string, unknown>);
    if (entries.length > SKILL_PACK_MAX_FILES) {
      errors.push(
        `${label}.files allows at most ${SKILL_PACK_MAX_FILES} files`,
      );
      return null;
    }
    files = {};
    for (const [path, content] of entries) {
      if (!isSafeRelativeFilePath(path)) {
        errors.push(`${label}.files has an unsafe path: ${path}`);
        return null;
      }
      if (
        typeof content !== "string" ||
        content.length > SKILL_PACK_MAX_FILE_CHARS
      ) {
        errors.push(
          `${label}.files["${path}"] must be text up to ${SKILL_PACK_MAX_FILE_CHARS} chars`,
        );
        return null;
      }
      files[path] = content;
    }
  }
  return {
    name,
    description,
    body,
    ...(category ? { category } : {}),
    ...(files ? { files } : {}),
  };
}

/** Validate an unknown payload as a SkillPack. PURE + total. */
export function validateSkillPack(raw: unknown): SkillPackValidationResult {
  const errors: string[] = [];
  const pack = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const packId = typeof pack.packId === "string" ? pack.packId.trim() : "";
  if (!SAFE_ID.test(packId)) errors.push("packId must be a lowercase safe id");
  const title = typeof pack.title === "string" ? pack.title.trim() : "";
  if (!title || title.length > 120)
    errors.push("title must be 1-120 characters");
  const version = pack.version;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    errors.push("version must be a positive integer");
  }
  const description =
    typeof pack.description === "string" ? pack.description.trim() : "";
  if (description.length > 500) {
    errors.push("description must be at most 500 characters");
  }
  let outcomeKit: OutcomeKitDefinition | undefined;
  if (pack.outcomeKit !== undefined) {
    const validated = validateOutcomeKit(pack.outcomeKit);
    if (!validated.ok || !validated.kit) {
      errors.push(...validated.errors.map((error) => `outcomeKit.${error}`));
    } else {
      outcomeKit = validated.kit;
      if (outcomeKit.kitId !== packId) {
        errors.push("outcomeKit.kitId must match packId");
      }
    }
  }
  if (!Array.isArray(pack.skills) || pack.skills.length === 0) {
    errors.push("skills must be a non-empty array");
  }
  const skills: SkillPackSkill[] = [];
  if (Array.isArray(pack.skills)) {
    if (pack.skills.length > SKILL_PACK_MAX_SKILLS) {
      errors.push(`skills allows at most ${SKILL_PACK_MAX_SKILLS} entries`);
    }
    const seen = new Set<string>();
    pack.skills.slice(0, SKILL_PACK_MAX_SKILLS).forEach((rawSkill, index) => {
      const skill = validateSkill(rawSkill, index, errors);
      if (!skill) return;
      const key = `${skill.category ?? ""}/${skill.name}`;
      if (seen.has(key)) {
        errors.push(`skills[${index}] duplicates ${key}`);
        return;
      }
      seen.add(key);
      skills.push(skill);
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    pack: {
      packId,
      title,
      version: version as number,
      ...(description ? { description } : {}),
      skills,
      ...(outcomeKit ? { outcomeKit } : {}),
    },
  };
}

/** Render one pack skill as a SKILL.md file (mirrors createSkill's format). */
export function skillPackSkillToMarkdown(skill: SkillPackSkill): string {
  const description = skill.description.replace(/"/g, '\\"');
  return `---\nname: "${skill.name}"\ndescription: "${description}"\n---\n\n${skill.body.trim()}\n`;
}
