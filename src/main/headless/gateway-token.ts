import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getHermesHome } from "../installer/paths";
import { safeWriteFile } from "../utils";

export function syncHeadlessGatewayToken(apiServerKey: string): void {
  if (process.platform !== "darwin") return;
  const tokenPath = join(getHermesHome(), "headless-gateway.token");
  const key = apiServerKey.trim();
  if (!key) {
    if (existsSync(tokenPath)) unlinkSync(tokenPath);
    return;
  }
  safeWriteFile(tokenPath, `${key}\n`);
}
