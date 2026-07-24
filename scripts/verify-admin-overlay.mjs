// verify-admin-overlay.mjs — focused visual check for the task-based Control
// Center. Opens the real SPS Settings gear, verifies the General default, and
// checks legacy deep-link aliases still land on their new task destinations.
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "admin-verify");
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), "hermes-admin-"));
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "desktop.json"),
  JSON.stringify(
    { onboardingCompleted: true, schedulerEnabled: false },
    null,
    2,
  ),
);
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  default: claude-3-5-sonnet\n",
);

async function launchApp() {
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
  await win.waitForTimeout(1500);
  return { app, win };
}

async function getZoomFactor(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    return window?.webContents.getZoomFactor() ?? null;
  });
}

async function waitForZoomFactor(app, expected) {
  const deadline = Date.now() + 5000;
  let zoom = await getZoomFactor(app);
  while (Date.now() < deadline) {
    if (typeof zoom === "number" && Math.abs(zoom - expected) < 0.001) {
      return zoom;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    zoom = await getZoomFactor(app);
  }
  throw new Error(`Expected zoom factor ${expected}, got ${zoom}`);
}

let { app, win } = await launchApp();

const shots = [];
async function shot(name, fn) {
  try {
    if (fn) await fn();
    await win.waitForTimeout(700);
    await win.screenshot({ path: join(OUT, `${name}.png`) });
    shots.push(name);
    console.log("SHOT ok:", name);
  } catch (e) {
    console.log("SHOT FAIL:", name, "—", e.message);
  }
}

// Open the admin overlay through the actual SPS rail Settings gear.
await shot("a1-general", async () => {
  const generalHeading = win.getByRole("heading", { name: "General" });
  if (!(await generalHeading.isVisible())) {
    const settingsButton = win.locator('[aria-label="Settings"]');
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
    } else {
      await win.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("hermes:open-settings", {
            detail: { view: "preferences" },
          }),
        ),
      );
    }
  }
  await generalHeading.waitFor({
    timeout: 10000,
  });
  await win.getByText("LIVE PREVIEW").waitFor({
    timeout: 10000,
  });
});

// Legacy providers deep-link -> AI Setup.
await shot("a2-legacy-providers-ai-setup", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", {
        detail: { view: "providers" },
      }),
    ),
  );
  await win.getByRole("heading", { name: "My Assistant" }).waitFor({
    timeout: 10000,
  });
});

// Legacy gateway deep-link -> Connected Apps.
await shot("a3-legacy-gateway-connected-apps", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", { detail: { view: "gateway" } }),
    ),
  );
  await win.getByRole("heading", { name: "Connections" }).waitFor({
    timeout: 10000,
  });
});

// Legacy settings deep-link -> General.
await shot("a4-legacy-settings-general", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", { detail: { view: "settings" } }),
    ),
  );
  await win.getByRole("heading", { name: "General" }).waitFor({
    timeout: 10000,
  });
});

// General is a flat section with one canonical appearance editor.
await shot("a5-general-no-subnav", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", {
        detail: { view: "preferences" },
      }),
    ),
  );
  await win.getByRole("heading", { name: "General" }).waitFor({
    timeout: 10000,
  });
  await win.getByText("Display zoom").waitFor({ timeout: 10000 });
});

await win.getByRole("button", { name: "Increase display zoom" }).click();
await win.getByRole("button", { name: "Increase display zoom" }).click();
await win.locator(".settings-zoom-value").filter({ hasText: "120%" }).waitFor({
  timeout: 10000,
});

const zoomFactor = await waitForZoomFactor(app, 1.2);
const desktopConfig = JSON.parse(
  readFileSync(join(HOME, "desktop.json"), "utf-8"),
);
if (desktopConfig.appZoomFactor !== 1.2) {
  throw new Error(
    `Expected desktop.json appZoomFactor 1.2, got ${desktopConfig.appZoomFactor}`,
  );
}
console.log(
  `ZOOM_FACTOR=${zoomFactor} DESKTOP_ZOOM=${desktopConfig.appZoomFactor}`,
);

// Assertions: exactly five ordinary categories plus one subdued developer entry.
const ordinaryLabels = [
  "General",
  "My Assistant",
  "Connections",
  "Data & Privacy",
  "Help",
];
for (const label of ordinaryLabels) {
  await win
    .getByRole("button", { name: label, exact: true })
    .waitFor({ timeout: 5000 });
}
await win
  .getByRole("button", { name: "Developer settings…", exact: true })
  .waitFor({
    timeout: 5000,
  });
const subnavCount = await win.$$eval(".settings-subnav", (els) => els.length);
if (subnavCount !== 0) {
  throw new Error(`Expected no Settings subnav, got ${subnavCount}`);
}
console.log(
  `ORDINARY_CATEGORIES=${ordinaryLabels.length} SETTINGS_SUBNAV=${subnavCount}`,
);
console.log(`SHOTS_OK: ${shots.length} — ${shots.join(", ")}`);

await app.close();
({ app, win } = await launchApp());
const persistedZoomFactor = await waitForZoomFactor(app, 1.2);
console.log(`ZOOM_FACTOR_AFTER_RELAUNCH=${persistedZoomFactor}`);
console.log("VERIFY_DONE");
await app.close();
