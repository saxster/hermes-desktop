import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  listSnapshotsIn,
  restoreSnapshotFrom,
  restoreWorkspaceSnapshot,
  selectSnapshotIdsToPrune,
  snapshotWorkspaceTo,
} from "./sps-backups";

let root: string;

function paths(): {
  workspaceJson: string;
  manifestJson: string;
  vaultDir: string;
  excludeDirs: string[];
} {
  return {
    workspaceJson: join(root, "sps-agent", "workspace.json"),
    manifestJson: join(root, "sps-agent", "vault", "_manifest.json"),
    vaultDir: join(root, "sps-agent", "vault"),
    excludeDirs: [join(root, "sps-agent", "backups")],
  };
}

async function seedWorkspace(): Promise<void> {
  const p = paths();
  await fs.mkdir(join(p.vaultDir, "_inbox"), { recursive: true });
  await fs.mkdir(join(p.vaultDir, ".obsidian"), { recursive: true });
  await fs.mkdir(join(p.vaultDir, "_assets"), { recursive: true });
  await fs.mkdir(join(p.vaultDir, "assets", "PAGE1"), { recursive: true });
  await fs.writeFile(p.workspaceJson, JSON.stringify({ __rev: 3, docs: {} }));
  await fs.writeFile(p.manifestJson, JSON.stringify({ tree: [] }));
  await fs.writeFile(join(p.vaultDir, "PAGE1.md"), "# Page one\n");
  await fs.writeFile(join(p.vaultDir, "_inbox", "cap_1.md"), "capture\n");
  await fs.writeFile(join(p.vaultDir, ".note-index.db"), "sqlite-bytes");
  await fs.writeFile(join(p.vaultDir, ".obsidian", "hidden.md"), "hidden\n");
  await fs.writeFile(join(p.vaultDir, "_assets", "img.png"), "png-bytes");
  await fs.writeFile(
    join(p.vaultDir, "assets", "PAGE1", "sketch.excalidraw"),
    "scene-bytes",
  );
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "sps-backups-"));
  await seedWorkspace();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("snapshotWorkspaceTo", () => {
  it("copies the authoritative artifacts and nothing else", async () => {
    const dest = join(root, "sps-agent", "backups", "1700000000000");
    const { fileCount } = await snapshotWorkspaceTo(paths(), dest);

    // workspace.json + manifest + 2 markdown pages + both asset stores.
    expect(fileCount).toBe(6);
    await expect(
      fs.readFile(join(dest, "workspace.json"), "utf-8"),
    ).resolves.toContain('"__rev":3');
    await expect(
      fs.readFile(join(dest, "_manifest.json"), "utf-8"),
    ).resolves.toContain("tree");
    await expect(
      fs.readFile(join(dest, "vault", "PAGE1.md"), "utf-8"),
    ).resolves.toBe("# Page one\n");
    await expect(
      fs.readFile(join(dest, "vault", "_inbox", "cap_1.md"), "utf-8"),
    ).resolves.toBe("capture\n");
    await expect(
      fs.readFile(join(dest, "vault", "_assets", "img.png"), "utf-8"),
    ).resolves.toBe("png-bytes");
    await expect(
      fs.readFile(
        join(dest, "vault", "assets", "PAGE1", "sketch.excalidraw"),
        "utf-8",
      ),
    ).resolves.toBe("scene-bytes");
    // Derived index and dot-dirs are excluded.
    await expect(
      fs.access(join(dest, "vault", ".note-index.db")),
    ).rejects.toThrow();
    await expect(fs.access(join(dest, "vault", ".obsidian"))).rejects.toThrow();
  });

  it("never recurses into the backups directory itself", async () => {
    const backupsDir = join(root, "sps-agent", "backups");
    const nestedVaultPaths = {
      ...paths(),
      vaultDir: join(root, "sps-agent"),
      manifestJson: join(root, "sps-agent", "vault", "_manifest.json"),
    };
    const first = join(backupsDir, "1700000000000");
    await snapshotWorkspaceTo(nestedVaultPaths, first);
    const second = join(backupsDir, "1700000000001");
    const result = await snapshotWorkspaceTo(nestedVaultPaths, second);

    const files = await fs.readdir(join(second, "vault", "vault"));
    expect(files).toContain("PAGE1.md");
    // The second snapshot must not have picked up the first one's contents.
    expect(result.fileCount).toBe(4);
  });

  it("throws when there is nothing to back up", async () => {
    rmSync(join(root, "sps-agent"), { recursive: true, force: true });
    await expect(
      snapshotWorkspaceTo(paths(), join(root, "dest")),
    ).rejects.toThrow(/nothing to back up/i);
  });
});

describe("restoreSnapshotFrom", () => {
  it("returns the workspace and its assets to exactly snapshot time", async () => {
    const snapDir = join(root, "sps-agent", "backups", "1700000000000");
    await snapshotWorkspaceTo(paths(), snapDir);

    // Mutate the live workspace after the snapshot.
    const p = paths();
    await fs.writeFile(p.workspaceJson, JSON.stringify({ __rev: 9 }));
    await fs.writeFile(join(p.vaultDir, "PAGE1.md"), "# Rewritten\n");
    await fs.writeFile(join(p.vaultDir, "NEW-PAGE.md"), "# New page\n");
    await fs.rm(join(p.vaultDir, "_inbox", "cap_1.md"));
    await fs.writeFile(join(p.vaultDir, "_assets", "img.png"), "changed");
    await fs.writeFile(
      join(p.vaultDir, "assets", "PAGE1", "sketch.excalidraw"),
      "changed-scene",
    );

    await restoreSnapshotFrom(snapDir, p);

    await expect(fs.readFile(p.workspaceJson, "utf-8")).resolves.toContain(
      '"__rev":3',
    );
    await expect(
      fs.readFile(join(p.vaultDir, "PAGE1.md"), "utf-8"),
    ).resolves.toBe("# Page one\n");
    await expect(
      fs.readFile(join(p.vaultDir, "_inbox", "cap_1.md"), "utf-8"),
    ).resolves.toBe("capture\n");
    // Pages created after the snapshot are removed…
    await expect(fs.access(join(p.vaultDir, "NEW-PAGE.md"))).rejects.toThrow();
    // Snapshot-owned assets are restored; the derived index is untouched.
    await expect(
      fs.readFile(join(p.vaultDir, "_assets", "img.png"), "utf-8"),
    ).resolves.toBe("png-bytes");
    await expect(
      fs.readFile(
        join(p.vaultDir, "assets", "PAGE1", "sketch.excalidraw"),
        "utf-8",
      ),
    ).resolves.toBe("scene-bytes");
    await expect(
      fs.access(join(p.vaultDir, ".note-index.db")),
    ).resolves.toBeUndefined();
  });

  it("rejects an empty snapshot directory", async () => {
    const emptyDir = join(root, "sps-agent", "backups", "1700000000001");
    await fs.mkdir(emptyDir, { recursive: true });
    await expect(restoreSnapshotFrom(emptyDir, paths())).rejects.toThrow(
      /empty or unreadable/i,
    );
  });

  it("preserves unsnapshotted markdown in a repointed vault", async () => {
    rmSync(join(root, "sps-agent"), { recursive: true, force: true });
    const externalVault = join(root, "obsidian-vault");
    const spsRoot = join(root, "sps-agent");
    const p = {
      workspaceJson: join(spsRoot, "workspace.json"),
      manifestJson: join(externalVault, "_manifest.json"),
      vaultDir: externalVault,
      excludeDirs: [join(spsRoot, "backups")],
    };
    await fs.mkdir(externalVault, { recursive: true });
    await fs.mkdir(spsRoot, { recursive: true });
    await fs.writeFile(
      join(spsRoot, "sps-storage.json"),
      JSON.stringify({ vaultDir: externalVault }),
    );
    await fs.writeFile(p.workspaceJson, JSON.stringify({ __rev: 1 }));
    await fs.writeFile(p.manifestJson, JSON.stringify({ tree: [] }));
    await fs.writeFile(join(externalVault, "SPS-PAGE.md"), "before\n");
    const id = "1700000000010";
    await snapshotWorkspaceTo(p, join(spsRoot, "backups", id));
    await fs.writeFile(join(externalVault, "SPS-PAGE.md"), "after\n");
    await fs.writeFile(
      join(externalVault, "personal-notes.md"),
      "must survive\n",
    );

    const previousHome = process.env.HERMES_HOME;
    process.env.HERMES_HOME = root;
    try {
      await expect(restoreWorkspaceSnapshot(id)).resolves.toMatchObject({
        ok: true,
      });
    } finally {
      if (previousHome === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = previousHome;
    }

    await expect(
      fs.readFile(join(externalVault, "personal-notes.md"), "utf-8"),
    ).resolves.toBe("must survive\n");
    await expect(
      fs.readFile(join(externalVault, "SPS-PAGE.md"), "utf-8"),
    ).resolves.toBe("before\n");
  });

  it("restores a snapshot when the current workspace is empty", async () => {
    rmSync(join(root, "sps-agent"), { recursive: true, force: true });
    const id = "1700000000011";
    const snapDir = join(root, "sps-agent", "backups", id);
    await fs.mkdir(join(snapDir, "vault"), { recursive: true });
    await fs.writeFile(
      join(snapDir, "workspace.json"),
      JSON.stringify({ __rev: 4 }),
    );
    await fs.writeFile(join(snapDir, "_manifest.json"), '{"tree":[]}');
    await fs.writeFile(join(snapDir, "vault", "RESTORED.md"), "restored\n");

    const previousHome = process.env.HERMES_HOME;
    process.env.HERMES_HOME = root;
    let result;
    try {
      result = await restoreWorkspaceSnapshot(id);
    } finally {
      if (previousHome === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = previousHome;
    }

    expect(result).toEqual({ ok: true });
    await expect(
      fs.readFile(join(root, "sps-agent", "workspace.json"), "utf-8"),
    ).resolves.toContain('"__rev":4');
    await expect(
      fs.readFile(join(root, "sps-agent", "vault", "RESTORED.md"), "utf-8"),
    ).resolves.toBe("restored\n");
  });
});

describe("listSnapshotsIn / selectSnapshotIdsToPrune", () => {
  it("lists snapshots newest-first with sizes, ignoring stray entries", async () => {
    const backupsDir = join(root, "sps-agent", "backups");
    await snapshotWorkspaceTo(paths(), join(backupsDir, "1700000000000"));
    await snapshotWorkspaceTo(paths(), join(backupsDir, "1700000000005"));
    await fs.mkdir(join(backupsDir, "not-a-snapshot"), { recursive: true });

    const infos = await listSnapshotsIn(backupsDir);
    expect(infos.map((i) => i.id)).toEqual(["1700000000005", "1700000000000"]);
    expect(infos[0].fileCount).toBe(6);
    expect(infos[0].bytes).toBeGreaterThan(0);
  });

  it("prunes everything beyond the newest N", () => {
    const ids = ["100", "300", "200", "junk", "500", "400"];
    expect(selectSnapshotIdsToPrune(ids, 2)).toEqual(["300", "200", "100"]);
    expect(selectSnapshotIdsToPrune(ids, 10)).toEqual([]);
  });
});
