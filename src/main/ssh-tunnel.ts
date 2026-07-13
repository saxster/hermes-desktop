import { ChildProcess, spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import net from "net";
import http from "node:http";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { buildSshControlOptions } from "./ssh-options";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import type { GatewayHealthStatus } from "../shared/gateway";
import { formatLogError, log } from "./log";

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  keyPath: string;
  remotePort: number;
  localPort: number;
}

export interface SshTunnelRuntime {
  spawn: typeof spawn;
  createServer: typeof net.createServer;
  connect: (
    port: number,
    host: string,
    connectionListener?: () => void,
  ) => net.Socket;
  request: (
    url: string | URL,
    options: RequestOptions,
    callback?: (res: IncomingMessage) => void,
  ) => ClientRequest;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  now: () => number;
}

export interface SshTunnelTiming {
  healthRequestTimeoutMs: number;
  healthPollRequestTimeoutMs: number;
  exitHealthTimeoutMs: number;
  healthPollIntervalMs: number;
  portReadyTimeoutMs: number;
  portPollIntervalMs: number;
  startupHealthTimeoutMs: number;
  connectionReadyDelayMs: number;
  connectionReadyTimeoutMs: number;
  connectionPollIntervalMs: number;
  connectionOverallTimeoutMs: number;
  connectionHealthRequestTimeoutMs: number;
  reconnectInitialDelayMs: number;
  reconnectMaxDelayMs: number;
  reconnectMaxAttempts: number;
}

const DEFAULT_SSH_TUNNEL_TIMING: SshTunnelTiming = {
  healthRequestTimeoutMs: 3000,
  healthPollRequestTimeoutMs: 1500,
  exitHealthTimeoutMs: 2000,
  healthPollIntervalMs: 500,
  portReadyTimeoutMs: 12000,
  portPollIntervalMs: 400,
  startupHealthTimeoutMs: 20000,
  connectionReadyDelayMs: 600,
  connectionReadyTimeoutMs: 15000,
  connectionPollIntervalMs: 400,
  connectionOverallTimeoutMs: 20000,
  connectionHealthRequestTimeoutMs: 3000,
  reconnectInitialDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  reconnectMaxAttempts: 5,
};

function defaultSshTunnelRuntime(): SshTunnelRuntime {
  return {
    spawn,
    createServer: net.createServer.bind(net) as typeof net.createServer,
    connect: net.connect.bind(net) as SshTunnelRuntime["connect"],
    request: http.request.bind(http) as SshTunnelRuntime["request"],
    setTimeout: globalThis.setTimeout.bind(globalThis) as typeof setTimeout,
    clearTimeout: globalThis.clearTimeout.bind(
      globalThis,
    ) as typeof clearTimeout,
    now: () => Date.now(),
  };
}

let sshTunnelRuntime = defaultSshTunnelRuntime();
let sshTunnelTiming: SshTunnelTiming = { ...DEFAULT_SSH_TUNNEL_TIMING };

let tunnelProcess: ChildProcess | null = null;
let activeConfig: SshConfig | null = null;
let desiredConfig: SshConfig | null = null;
let tunnelRunning = false;
let lifecycleToken = 0;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let statusBroadcaster: ((status: GatewayHealthStatus) => void) | null = null;

export function setSshTunnelStatusBroadcaster(
  broadcaster: (status: GatewayHealthStatus) => void,
): void {
  statusBroadcaster = broadcaster;
}

function broadcastStatus(status: GatewayHealthStatus): void {
  try {
    statusBroadcaster?.(status);
  } catch (err) {
    log.warn("ssh-tunnel", {
      msg: "health broadcast failed",
      status,
      error: formatLogError(err),
    });
  }
}

export function __setSshTunnelRuntimeForTests(
  runtime: Partial<SshTunnelRuntime>,
  timing: Partial<SshTunnelTiming> = {},
): void {
  sshTunnelRuntime = { ...sshTunnelRuntime, ...runtime };
  sshTunnelTiming = { ...sshTunnelTiming, ...timing };
}

export function __resetSshTunnelForTests(): void {
  stopSshTunnel();
  statusBroadcaster = null;
  sshTunnelRuntime = defaultSshTunnelRuntime();
  sshTunnelTiming = { ...DEFAULT_SSH_TUNNEL_TIMING };
}

export function getSshTunnelUrl(): string | null {
  if (!activeConfig || !tunnelRunning) return null;
  return `http://127.0.0.1:${activeConfig.localPort}`;
}

export function isSshTunnelActive(): boolean {
  return tunnelRunning && activeConfig !== null;
}

function checkTunnelHealth(
  port: number,
  timeoutMs = sshTunnelTiming.healthRequestTimeoutMs,
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = sshTunnelRuntime.request(
      `http://127.0.0.1:${port}/health`,
      { method: "GET", timeout: timeoutMs },
      (res) => {
        const healthy = res.statusCode === 200;
        res.resume();
        resolve(healthy);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = sshTunnelRuntime.now() + timeoutMs;
  while (sshTunnelRuntime.now() <= deadline) {
    if (
      await checkTunnelHealth(port, sshTunnelTiming.healthPollRequestTimeoutMs)
    )
      return;
    await new Promise((resolve) =>
      sshTunnelRuntime.setTimeout(
        resolve,
        sshTunnelTiming.healthPollIntervalMs,
      ),
    );
  }
  throw new Error(`SSH tunnel health check failed after ${timeoutMs}ms`);
}

export async function isSshTunnelHealthy(): Promise<boolean> {
  return activeConfig !== null && tunnelRunning
    ? checkTunnelHealth(activeConfig.localPort)
    : false;
}

function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const server = sshTunnelRuntime.createServer();
    server.listen(preferred, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      const fallback = sshTunnelRuntime.createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const port = (fallback.address() as net.AddressInfo).port;
        fallback.close(() => resolve(port));
      });
    });
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = sshTunnelRuntime.now() + timeoutMs;
    function attempt(): void {
      const socket = sshTunnelRuntime.connect(port, "127.0.0.1", () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (sshTunnelRuntime.now() > deadline) {
          reject(new Error(`SSH tunnel not ready after ${timeoutMs}ms`));
        } else {
          sshTunnelRuntime.setTimeout(
            attempt,
            sshTunnelTiming.portPollIntervalMs,
          );
        }
      });
    }
    attempt();
  });
}

function buildSshArgs(config: SshConfig, localPort: number): string[] {
  const keyPath = config.keyPath || join(homedir(), ".ssh", "id_rsa");
  return [
    "-N",
    "-L",
    `${localPort}:127.0.0.1:${config.remotePort}`,
    "-p",
    String(config.port),
    "-i",
    keyPath,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "BatchMode=yes",
    ...buildSshControlOptions(process.platform, { forTunnel: true }),
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    `${config.username}@${config.host}`,
  ];
}

function cancelReconnect(): void {
  if (!reconnectTimer) return;
  sshTunnelRuntime.clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function stopCurrentProcess(): void {
  lifecycleToken += 1;
  const process = tunnelProcess;
  tunnelProcess = null;
  if (process && !process.killed) process.kill("SIGTERM");
  tunnelRunning = false;
  activeConfig = null;
}

function scheduleReconnect(config: SshConfig): void {
  if (!desiredConfig || reconnectTimer) return;
  if (reconnectAttempts >= sshTunnelTiming.reconnectMaxAttempts) {
    broadcastStatus("down");
    log.error("ssh-tunnel", {
      msg: "automatic reconnect exhausted",
      host: config.host,
      attempts: reconnectAttempts,
    });
    return;
  }
  const delay = Math.min(
    sshTunnelTiming.reconnectInitialDelayMs * 2 ** reconnectAttempts,
    sshTunnelTiming.reconnectMaxDelayMs,
  );
  reconnectAttempts += 1;
  broadcastStatus("recovering");
  log.warn("ssh-tunnel", {
    msg: "scheduling reconnect",
    host: config.host,
    attempt: reconnectAttempts,
    delayMs: delay,
  });
  // Mark scheduled before invoking the runtime: test/fake timers may execute
  // synchronously, and must not be overwritten with a stale handle afterward.
  reconnectTimer = 1 as unknown as ReturnType<typeof setTimeout>;
  const timer = sshTunnelRuntime.setTimeout(() => {
    reconnectTimer = null;
    const target = desiredConfig;
    if (!target) return;
    void startTunnelAttempt(target).catch((err) => {
      log.warn("ssh-tunnel", {
        msg: "reconnect attempt failed",
        host: target.host,
        attempt: reconnectAttempts,
        error: formatLogError(err),
      });
      scheduleReconnect(target);
    });
  }, delay);
  if (reconnectTimer !== null) {
    reconnectTimer = timer;
    reconnectTimer.unref?.();
  }
}

async function handleTunnelTermination(
  token: number,
  config: SshConfig,
  localPort: number,
): Promise<void> {
  if (token !== lifecycleToken || !desiredConfig) return;
  const healthy = await checkTunnelHealth(
    localPort,
    sshTunnelTiming.exitHealthTimeoutMs,
  );
  if (token !== lifecycleToken || !desiredConfig) return;
  if (healthy) return;
  tunnelRunning = false;
  activeConfig = null;
  broadcastStatus("unhealthy");
  scheduleReconnect(config);
}

async function startTunnelAttempt(config: SshConfig): Promise<void> {
  stopCurrentProcess();

  const localPort = await findFreePort(config.localPort || 18642);
  activeConfig = { ...config, localPort };
  tunnelRunning = false;
  const token = lifecycleToken;

  const process = sshTunnelRuntime.spawn(
    "ssh",
    buildSshArgs(config, localPort),
    {
      stdio: "ignore",
      detached: false,
      ...HIDDEN_SUBPROCESS_OPTIONS,
    },
  );
  tunnelProcess = process;

  process.on("exit", () => {
    if (tunnelProcess === process) tunnelProcess = null;
    // Confirm health before declaring the foreground tunnel dead; an exit event
    // can race a final successful health response during shutdown/replacement.
    void handleTunnelTermination(token, config, localPort);
  });

  process.on("error", () => {
    if (tunnelProcess === process) tunnelProcess = null;
    void handleTunnelTermination(token, config, localPort);
  });

  try {
    await waitForPort(localPort, sshTunnelTiming.portReadyTimeoutMs);
    if (token !== lifecycleToken) throw new Error("SSH tunnel start cancelled");
    tunnelRunning = true;
    await waitForHealth(localPort, sshTunnelTiming.startupHealthTimeoutMs);
    if (token !== lifecycleToken) throw new Error("SSH tunnel start cancelled");
    reconnectAttempts = 0;
    broadcastStatus("healthy");
  } catch (err) {
    if (token === lifecycleToken) stopCurrentProcess();
    throw err;
  }
}

export async function startSshTunnel(config: SshConfig): Promise<void> {
  cancelReconnect();
  desiredConfig = { ...config };
  reconnectAttempts = 0;
  try {
    await startTunnelAttempt(config);
  } catch (err) {
    desiredConfig = null;
    broadcastStatus("down");
    throw err;
  }
}

export function stopSshTunnel(): void {
  desiredConfig = null;
  reconnectAttempts = 0;
  cancelReconnect();
  stopCurrentProcess();
}

export async function ensureSshTunnel(config: SshConfig): Promise<void> {
  if (isSshTunnelActive() && (await isSshTunnelHealthy())) return;
  await startSshTunnel(config);
}

// Test SSH reachability + hermes health endpoint through a temporary tunnel
export function testSshConnection(config: SshConfig): Promise<boolean> {
  return findFreePort(config.localPort || 19642)
    .then(
      (localPort) =>
        new Promise<boolean>((resolve) => {
          const args = buildSshArgs(config, localPort);
          const proc = sshTunnelRuntime.spawn("ssh", args, {
            stdio: "ignore",
            ...HIDDEN_SUBPROCESS_OPTIONS,
          });

          let done = false;
          const finish = (result: boolean): void => {
            if (done) return;
            done = true;
            proc.kill("SIGTERM");
            resolve(result);
          };

          proc.on("error", () => finish(false));

          const timeout = sshTunnelRuntime.setTimeout(
            () => finish(false),
            sshTunnelTiming.connectionOverallTimeoutMs,
          );

          // Poll until tunnel port is reachable, then hit /health
          const deadline =
            sshTunnelRuntime.now() + sshTunnelTiming.connectionReadyTimeoutMs;
          async function poll(): Promise<void> {
            if (done) return;
            const portOpen = await new Promise<boolean>((res) => {
              const s = sshTunnelRuntime.connect(localPort, "127.0.0.1", () => {
                s.destroy();
                res(true);
              });
              s.on("error", () => {
                s.destroy();
                res(false);
              });
            });

            if (!portOpen) {
              if (sshTunnelRuntime.now() > deadline) {
                sshTunnelRuntime.clearTimeout(timeout);
                finish(false);
                return;
              }
              sshTunnelRuntime.setTimeout(
                poll,
                sshTunnelTiming.connectionPollIntervalMs,
              );
              return;
            }

            // Port is open — hit hermes /health
            const req = sshTunnelRuntime.request(
              `http://127.0.0.1:${localPort}/health`,
              {
                method: "GET",
                timeout: sshTunnelTiming.connectionHealthRequestTimeoutMs,
              },
              (res) => {
                sshTunnelRuntime.clearTimeout(timeout);
                finish(res.statusCode === 200);
                res.resume();
              },
            );
            req.on("error", () => {
              sshTunnelRuntime.clearTimeout(timeout);
              finish(false);
            });
            req.end();
          }

          sshTunnelRuntime.setTimeout(
            poll,
            sshTunnelTiming.connectionReadyDelayMs,
          );
        }),
    )
    .catch(() => false);
}
