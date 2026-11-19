import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkDistTags, expectedDistTag, waitForDistTags } from "../scripts/check-dist-tag.mjs";

test("prereleases use beta and stable releases use latest", () => {
  assert.equal(expectedDistTag("1.3.0-beta.0"), "beta");
  assert.equal(expectedDistTag("1.3.0"), "latest");
});

test("a prerelease on latest is refused", () => {
  assert.throws(() => checkDistTags("1.3.0-beta.0", { beta: "1.3.0-beta.0", latest: "1.3.0-beta.0" }), /latest/);
  assert.equal(checkDistTags("1.3.0-beta.0", { beta: "1.3.0-beta.0", latest: "1.2.1" }), "beta");
});

test("a missing dist-tag is refused", () => {
  assert.throws(() => checkDistTags("1.3.0", { latest: "1.2.1" }), /latest/);
});

const workflow = readFileSync(new URL("../.github/workflows/publish-npm.yml", import.meta.url), "utf8");

test("the publish command always passes the tag from expectedDistTag", () => {
  const publishes = workflow.match(/\["publish"[^\]]*\]/g) ?? [];
  assert.equal(publishes.length, 1);
  assert.match(publishes[0], /"--tag", expectedDistTag\(pkg\.version\)/);
  assert.doesNotMatch(workflow, /npm publish/);
});

test("the dist-tag is verified after publishing, on the retry path too", () => {
  const publishAt = workflow.indexOf('["publish"');
  const verifyAt = workflow.indexOf("waitForDistTags(pkg.name, pkg.version, { integrity })");
  const retryAt = workflow.indexOf("already published with matching contents");
  assert.ok(publishAt > 0 && verifyAt > publishAt && verifyAt > retryAt);
  assert.match(workflow, /import \{[^}]*waitForDistTags[^}]*\} from "\.\/scripts\/check-dist-tag\.mjs"/);
});

test("publication verification allows a full processing window and leaves time to finish the job", () => {
  const checker = readFileSync(new URL("../scripts/check-dist-tag.mjs", import.meta.url), "utf8");
  assert.match(checker, /15 \* 60 \* 1000/);
  assert.match(checker, /"Cache-Control": "no-cache"/);
  assert.match(checker, /Pragma: "no-cache"/);
  assert.match(workflow, /timeout-minutes: 30/);
  assert.doesNotMatch(workflow, /attempt < 60/);
});

function registryClock(reply) {
  let elapsed = 0;
  const delays = [];
  const requests = [];
  return {
    elapsed: () => elapsed, delays, requests,
    options: {
      now: () => elapsed,
      sleep: async ms => { delays.push(ms); elapsed += ms; },
      fetchRegistry: async (url, options) => {
        requests.push({ url, options });
        return reply(elapsed, requests.length);
      },
    },
  };
}
const version = "1.3.0-beta.0";
const integrity = "sha512-example";
const metadata = (tags = { beta: version, latest: "1.2.1" }, contents = integrity) => ({
  ok: true,
  json: async () => ({ "dist-tags": tags, versions: { [version]: { dist: { integrity: contents } } } }),
});

test("registry waits beyond five minutes for processing, then requires both integrity and tags", async () => {
  const clock = registryClock(elapsed => elapsed < 6 * 60 * 1000
    ? { ok: false, status: 404 }
    : metadata({ beta: elapsed < 14 * 60 * 1000 ? "1.2.0-beta.0" : version, latest: "1.2.1" }));
  assert.equal(await waitForDistTags("@example/app", version, { integrity, ...clock.options }), "beta");
  assert.ok(clock.elapsed() >= 14 * 60 * 1000 && clock.elapsed() < 15 * 60 * 1000);
  assert.deepEqual(clock.delays.slice(0, 4), [5000, 10000, 20000, 30000]);
  assert.ok(Math.max(...clock.delays) <= 30000);
  for (const { url, options } of clock.requests) {
    assert.equal(url, "https://registry.npmjs.org/%40example%2Fapp");
    assert.equal(options.headers["Cache-Control"], "no-cache");
    assert.equal(options.headers.Pragma, "no-cache");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test("registry fails after fifteen minutes when the expected tag stays wrong", async () => {
  const clock = registryClock(() => metadata({ beta: "1.2.0-beta.0", latest: "1.2.1" }));
  await assert.rejects(waitForDistTags("acme", version, { integrity, ...clock.options }), /timed out.*beta dist-tag/);
  assert.equal(clock.elapsed(), 15 * 60 * 1000);
});

test("registry rejects prerelease latest immediately, even before contents are available", async () => {
  const clock = registryClock(() => metadata({ beta: version, latest: version }, null));
  await assert.rejects(waitForDistTags("acme", version, { integrity, ...clock.options }), /tagged latest/);
  assert.equal(clock.requests.length, 1);
  assert.deepEqual(clock.delays, []);
});

test("registry rejects immutable content mismatches instead of accepting correct tags", async () => {
  const clock = registryClock(() => metadata(undefined, "sha512-other"));
  await assert.rejects(waitForDistTags("acme", version, { integrity, ...clock.options }), /different contents/);
  assert.equal(clock.requests.length, 1);
  assert.deepEqual(clock.delays, []);
});

test("registry retries transient network, malformed JSON and missing integrity, with a bounded deadline", async () => {
  const clock = registryClock((elapsed, attempt) => {
    if (attempt === 1) throw new Error("network unavailable");
    if (attempt === 2) return { ok: true, json: async () => { throw new SyntaxError("incomplete JSON"); } };
    if (attempt === 3) return { ok: true, json: async () => ({ "dist-tags": { beta: version } }) };
    return metadata();
  });
  assert.equal(await waitForDistTags("acme", version, { integrity, ...clock.options }), "beta");
  assert.equal(clock.requests.length, 4);
  const absent = registryClock(() => ({ ok: false, status: 503 }));
  await assert.rejects(waitForDistTags("acme", version, { ...absent.options, timeoutMs: 12000 }), /timed out.*503/);
  assert.equal(absent.elapsed(), 12000);
  assert.deepEqual(absent.delays, [5000, 7000]);
});

test("tag-only callers still verify without an integrity argument", async () => {
  const clock = registryClock(() => metadata());
  assert.equal(await waitForDistTags("acme", version, clock.options), "beta");
  assert.equal(clock.requests.length, 1);
});
