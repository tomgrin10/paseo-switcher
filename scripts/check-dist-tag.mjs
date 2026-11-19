import { readFileSync } from "node:fs";

// A prerelease belongs on beta and a stable release on latest. Never let a prerelease be latest.
export function expectedDistTag(version) {
  return version.includes("-") ? "beta" : "latest";
}

export function checkDistTags(version, tags) {
  const tag = expectedDistTag(version);
  if (tag === "beta" && tags.latest === version) {
    throw Object.assign(new Error(`Prerelease ${version} is tagged latest`), { permanent: true });
  }
  if (tags[tag] !== version) throw new Error(`The ${tag} dist-tag is ${tags[tag]}, expected ${version}`);
  return tag;
}

// One deadline covers npm processing, content visibility and tag propagation, including on reruns.
// Dependencies are injectable so tests exercise the full wait without network access or real delays.
export async function waitForDistTags(name, version, {
  integrity,
  timeoutMs = 15 * 60 * 1000,
  fetchRegistry = globalThis.fetch,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const deadline = now() + timeoutMs;
  let delay = 5000;
  let last = new Error("Could not read registry metadata");
  while (now() < deadline) {
    try {
      const response = await fetchRegistry(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        cache: "no-store",
        signal: AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - now()))),
      });
      if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`);
      const metadata = await response.json();
      const tags = metadata["dist-tags"] ?? {};
      // Do not wait out a channel violation, even if package contents are still processing.
      if (expectedDistTag(version) === "beta" && tags.latest === version) checkDistTags(version, tags);
      if (integrity !== undefined) {
        const remote = metadata.versions?.[version]?.dist?.integrity;
        if (!remote) throw new Error(`Registry contents for ${name}@${version} are not available yet`);
        if (remote !== integrity) {
          throw Object.assign(new Error(`${name}@${version} has different contents. Release a new version; do not rewrite the tag.`), { permanent: true });
        }
      }
      return checkDistTags(version, tags);
    } catch (error) {
      if (error.permanent) throw error;
      last = error;
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, 30000);
  }
  throw new Error(`Registry verification timed out for ${name}@${version}: ${last.message}`, { cause: last });
}

if (process.argv[1]?.endsWith("check-dist-tag.mjs")) {
  const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));
  console.log(`Registry verified: ${name}@${version} is ${await waitForDistTags(name, version)}.`);
}
