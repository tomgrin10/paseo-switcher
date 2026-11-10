// Shared setup for the browser scripts: refuse anything but a throwaway daemon, and log a fresh browser in.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isolationProblem } from "./isolation.mjs";

// Every browser script imports this module, so this one check keeps all of them off your own daemon.
{
  const problem = isolationProblem({
    env: process.env,
    userHome: homedir(),
    realpath: (path) => (existsSync(path) ? realpathSync(path) : resolve(path)),
    readConfig: (home) => {
      try {
        return JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
      } catch {
        return null;
      }
    },
  });
  if (problem) {
    console.error(problem);
    process.exit(2);
  }
}

/** The throwaway daemon's web UI. The isolation check above guarantees it is set. */
export const ORIGIN = process.env.E2E_ORIGIN.replace(/\/$/, "");
/** Written by the running daemon; local clients can authenticate with it instead of the password. */
const CREDENTIAL = join(process.env.PASEO_HOME, "local-credential");

/** `paseo` arguments for the daemon under test, always the isolated one in PASEO_HOME. */
export function paseoArgs(...args) {
  return ["--home", process.env.PASEO_HOME, ...args];
}

// ---- connecting a fresh browser to the daemon ------------------------------------------------------

/**
 * The web UI greets the daemon with a hello message, and a password-protected daemon rejects a
 * fresh browser's hello. The desktop app avoids that by sending the daemon's local credential, a
 * token the daemon writes to ~/.paseo/local-credential at startup. Do the same here: patch
 * WebSocket.send in the page to add that token to hello messages sent to a local daemon. It runs
 * in the page, not through a proxy, so it adds no latency to the performance checks.
 */
export async function authenticate(context) {
  if (!existsSync(CREDENTIAL)) throw new Error(`No daemon credential at ${CREDENTIAL}. Is the Paseo daemon running?`);
  const token = readFileSync(CREDENTIAL, "utf8").trim();
  await context.addInitScript((token) => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && data.startsWith('{"type":"hello"') && /^wss?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(this.url)) {
        const hello = JSON.parse(data);
        if (!hello.auth) data = JSON.stringify({ ...hello, auth: { kind: "localCredential", token } });
      }
      return send.call(this, data);
    };
  }, token);
}
