import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import parse from "semver/functions/parse.js";
import satisfies from "semver/functions/satisfies.js";

const manifest = JSON.parse(readFileSync(new URL("../paseo-plugin.json", import.meta.url), "utf8"));
const range: string = manifest.requirements.paseo;

/** Paseo's own check (@getpaseo/protocol plugin-requirements): the version or its stable core must satisfy the range. */
function accepts(version: string): boolean {
  const v = parse(version)!;
  return satisfies(v, range) || satisfies(`${v.major}.${v.minor}.${v.patch}`, range);
}

test("every supported Paseo version, prereleases included, loads the plugin", () => {
  for (const version of ["0.15.0", "0.16.0-beta.1", "0.16.2", "0.17.0-beta.1", "0.17.0", "0.17.3"])
    assert.ok(accepts(version), `Paseo ${version} would refuse the plugin (requires ${range})`);
});

test("versions the plugin was never checked on are refused", () => {
  for (const version of ["0.14.9", "0.18.0-beta.1", "0.18.0"])
    assert.ok(!accepts(version), `Paseo ${version} would load the plugin (requires ${range})`);
});

test("the README badge names every supported minor", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const badge = readme.match(/badge\/Paseo-([^-]+)-/)?.[1] ?? "";
  const minors = decodeURIComponent(badge).split(" | ");
  for (let minor = 15; ; minor++) {
    if (!accepts(`0.${minor}.0`)) break;
    assert.ok(minors.includes(`0.${minor}`), `README badge misses Paseo 0.${minor}`);
  }
});
