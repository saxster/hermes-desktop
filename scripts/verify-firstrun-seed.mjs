// verify-firstrun-seed.mjs — proves the clean first-run workspace.
//
// Unlike sps-smoke.mjs (which writes its OWN workspace.json fixture), this probe
// launches the BUILT app against a fresh profile with NO sps-agent/workspace.json
// so the renderer falls back to buildInitialWorkspace() — the real first-run path.
// It asserts that Home lands without sample pages or tasks and is ready for
// editing. Run `npm run build` first.
//
// Usage:  node scripts/verify-firstrun-seed.mjs
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { launchElectronSmoke } from "./lib/electron-smoke-launch.mjs";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "firstrun-seed");
mkdirSync(OUT, { recursive: true });

const HOME = mkdtempSync(join(tmpdir(), "hermes-firstrun-"));
// Install markers (skip welcome/installing/setup) + onboarding already completed
// (skip the Onboarding screen) — but deliberately NO sps-agent/ workspace, so the
// SPS store starts from buildInitialWorkspace().
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);
writeFileSync(
  join(HOME, "desktop.json"),
  JSON.stringify({ onboardingCompleted: true }, null, 2),
);

console.log("HERMES_HOME=", HOME);

const watchdog = setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 90000).unref();

const app = await launchElectronSmoke(
  electron,
  {
    args: [".", `--user-data-dir=${join(HOME, "electron-userdata")}`],
    env: {
      ...process.env,
      HERMES_HOME: HOME,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  },
  { label: "first-run seed verifier" },
);
const win = await app.firstWindow({ timeout: 60000 });
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
await win.waitForTimeout(2000);

let failures = 0;
async function check(name, fn) {
  try {
    const ok = await fn();
    if (ok) {
      console.log("CHECK ok:", name);
    } else {
      failures++;
      console.log("CHECK FAIL:", name, "— assertion false");
    }
  } catch (e) {
    failures++;
    console.log("CHECK FAIL:", name, "—", e.message);
  }
}

await win.screenshot({ path: join(OUT, "firstrun.png") });

await check("Home has one navigation entry", async () => {
  const labels = await win.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".rail-scroll .nav-label, .rail-scroll .tree-label",
      ),
    ]
      .map((n) => (n.textContent || "").trim())
      .filter((label) => label === "Home"),
  );
  return labels.length === 1;
});

await check("sample workspace content is absent", async () => {
  return await win.evaluate(
    () =>
      !document.body.innerText.includes("First project") &&
      !document.body.innerText.includes("Draft the project brief"),
  );
});

await check("Home editor is ready for input", async () => {
  return (await win.locator('[contenteditable="true"]').count()) > 0;
});

async function runPaletteAction(label) {
  await win.getByRole("button", { name: "Search", exact: true }).click();
  const input = win.getByPlaceholder("Search or open in new tab…");
  await input.fill(label);
  await win.getByText(label, { exact: true }).first().click();
}

await check("Dashboard creates a canonical task visible in Work", async () => {
  await runPaletteAction("Open Dashboard");
  await win.getByRole("button", { name: "New task" }).click();
  const title = win.locator(".drawer-title-input");
  await title.waitFor({ timeout: 10000 });
  if ((await title.inputValue()) !== "New task") return false;
  await win.getByRole("button", { name: "Close" }).click();
  await win.getByRole("button", { name: "Work" }).click();
  await win.getByRole("tab", { name: "Next" }).click();
  await win.getByText("New task", { exact: true }).waitFor({ timeout: 10000 });
  return true;
});

await check(
  "Reset command accurately describes the blank destructive action",
  async () => {
    await win.evaluate(() => {
      window.__spsResetConfirmation = "";
      window.confirm = (message) => {
        window.__spsResetConfirmation = String(message);
        return false;
      };
    });
    await win.getByRole("button", { name: "Search", exact: true }).click();
    const input = win.getByPlaceholder("Search or open in new tab…");
    await input.fill("Reset to a blank workspace");
    const label = win.getByText("Reset to a blank workspace", { exact: true });
    await label.click();
    return await win.evaluate(
      () =>
        window.__spsResetConfirmation ===
        "Delete all workspace content and reset to a blank Home page? A backup will be attempted first.",
    );
  },
);

const closed = await Promise.race([
  app.close().then(() => true),
  new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10000);
    timeout.unref?.();
  }),
]);
if (!closed) {
  failures++;
  console.log("CHECK FAIL: Electron closes cleanly — shutdown timed out");
  app.process().kill("SIGTERM");
} else {
  console.log("CHECK ok: Electron closes cleanly");
}

clearTimeout(watchdog);
console.log(`FAILURES=${failures}`);
console.log("VERIFY_DONE");
process.exit(failures === 0 ? 0 : 1);
