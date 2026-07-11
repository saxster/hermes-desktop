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

setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 90000).unref();

const app = await electron.launch({
  args: [".", `--user-data-dir=${join(HOME, "electron-userdata")}`],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
});
const win = await app.firstWindow();
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

await check("Home is the only seeded page", async () => {
  const labels = await win.evaluate(() =>
    [...document.querySelectorAll(".tree-label")].map((n) =>
      (n.textContent || "").trim(),
    ),
  );
  return labels.length === 1 && labels[0] === "Home";
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

console.log(`FAILURES=${failures}`);
console.log("VERIFY_DONE");
await app.close();
process.exit(failures === 0 ? 0 : 1);
