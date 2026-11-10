import assert from "node:assert/strict";
import { test } from "node:test";
import { isolationProblem } from "./e2e/isolation.mjs";

// A fake filesystem view: the user's daemon home and one throwaway harness home.
const USER_HOME = "/home/u";
const configs: Record<string, unknown> = {
  "/home/u/.paseo": { daemon: { listen: "127.0.0.1:6767" } },
  "/tmp/harness/paseo": { daemon: { listen: "127.0.0.1:41234" } },
};
const check = (env: Record<string, string | undefined>) =>
  isolationProblem({ env, userHome: USER_HOME, realpath: (p: string) => p.replace(/\/$/, ""), readConfig: (home: string) => configs[home] ?? null });

const ok = { PASEO_HOME: "/tmp/harness/paseo", E2E_ORIGIN: "http://127.0.0.1:41234" };

test("an isolated harness home and its own origin are allowed", () => {
  assert.equal(check(ok), null);
});

test("no PASEO_HOME refuses: the suite would drive the user's daemon", () => {
  assert.match(check({ E2E_ORIGIN: ok.E2E_ORIGIN }) ?? "", /PASEO_HOME/);
});

test("no E2E_ORIGIN refuses", () => {
  assert.match(check({ PASEO_HOME: ok.PASEO_HOME }) ?? "", /E2E_ORIGIN/);
});

test("PASEO_HOME pointing at ~/.paseo refuses, with or without a trailing slash", () => {
  assert.match(check({ ...ok, PASEO_HOME: "/home/u/.paseo" }) ?? "", /your own daemon/);
  assert.match(check({ ...ok, PASEO_HOME: "/home/u/.paseo/" }) ?? "", /your own daemon/);
});

test("an origin on the user's daemon port refuses even with an isolated home", () => {
  assert.match(check({ ...ok, E2E_ORIGIN: "http://127.0.0.1:6767" }) ?? "", /your own daemon/);
  assert.match(check({ ...ok, E2E_ORIGIN: "http://localhost:6767/" }) ?? "", /your own daemon/);
});

test("the default port 6767 counts as the user's daemon when ~/.paseo has no listen setting", () => {
  const bare = isolationProblem({ env: { ...ok, E2E_ORIGIN: "http://127.0.0.1:6767" }, userHome: USER_HOME, realpath: (p: string) => p, readConfig: () => null });
  assert.match(bare ?? "", /your own daemon/);
});

test("an origin that is not the harness daemon's port refuses", () => {
  assert.match(check({ ...ok, E2E_ORIGIN: "http://127.0.0.1:5555" }) ?? "", /41234/);
});

test("a non-loopback origin refuses", () => {
  assert.match(check({ ...ok, E2E_ORIGIN: "http://10.0.0.5:41234" }) ?? "", /loopback/);
});

test("every refusal says how to run against a harness", () => {
  for (const env of [{}, { PASEO_HOME: "/home/u/.paseo", E2E_ORIGIN: ok.E2E_ORIGIN }]) {
    assert.match(check(env) ?? "", /E2E_ORIGIN=http:\/\/127\.0\.0\.1:<port> PASEO_HOME=<dir>/);
  }
});
