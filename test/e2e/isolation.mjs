// The browser scripts reset plugin state, open workspaces and reload the plugin. They run only
// against a throwaway daemon, never against the one in ~/.paseo. Pure, so it can be unit tested.

import { join } from "node:path";

const HOW =
  "Run it against a throwaway daemon (see TESTING.md, \"Against an isolated daemon\"):\n" +
  "  E2E_ORIGIN=http://127.0.0.1:<port> PASEO_HOME=<dir> npm run e2e -- --reload";

const LIVE_PORT = "6767";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The port a daemon home listens on, from its config.json, or null when it doesn't say. */
function listenPort(config) {
  const listen = config?.daemon?.listen;
  if (typeof listen !== "string") return null;
  const port = listen.slice(listen.lastIndexOf(":") + 1);
  return /^\d+$/.test(port) ? port : null;
}

/**
 * Why the suite must not run, or null when PASEO_HOME and E2E_ORIGIN name an isolated daemon.
 * `readConfig(home)` returns that home's parsed config.json, or null.
 */
export function isolationProblem({ env, userHome, realpath, readConfig }) {
  const refuse = (why) => `Refusing to run: ${why}\n${HOW}`;
  if (!env.PASEO_HOME) return refuse("PASEO_HOME is not set, so the suite would drive your own daemon in ~/.paseo.");
  if (!env.E2E_ORIGIN) return refuse("E2E_ORIGIN is not set; point it at the throwaway daemon's web UI.");

  const userPaseo = realpath(join(userHome, ".paseo"));
  if (realpath(env.PASEO_HOME) === userPaseo) return refuse(`PASEO_HOME is ${env.PASEO_HOME}, your own daemon's home.`);

  let origin;
  try {
    origin = new URL(env.E2E_ORIGIN);
  } catch {
    return refuse(`E2E_ORIGIN (${env.E2E_ORIGIN}) is not a URL.`);
  }
  if (!LOOPBACK.has(origin.hostname)) return refuse(`E2E_ORIGIN (${env.E2E_ORIGIN}) is not a loopback address.`);
  const port = origin.port || (origin.protocol === "https:" ? "443" : "80");

  const livePort = listenPort(readConfig(userPaseo)) ?? LIVE_PORT;
  if (port === livePort) return refuse(`E2E_ORIGIN uses port ${port}, your own daemon's port.`);

  const harnessPort = listenPort(readConfig(env.PASEO_HOME));
  if (harnessPort && harnessPort !== port) {
    return refuse(`E2E_ORIGIN uses port ${port}, but the daemon in PASEO_HOME listens on ${harnessPort}.`);
  }
  return null;
}
