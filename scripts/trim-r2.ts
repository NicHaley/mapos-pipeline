#!/usr/bin/env tsx
/**
 * Shrink the published catalog to a keep list: rewrite R2's manifest.json so it only
 * lists --keep regions, then purge every other region prefix from the bucket. Default
 * is a dry run that prints the plan; pass --apply to execute. `_world/` is never touched.
 *
 * Order matters: the manifest is uploaded first, so a client never sees a region
 * whose files are already gone.
 *
 * Needs rclone's `r2` remote (RCLONE_CONFIG_R2_* in the env, see .env.example).
 *
 *   tsx scripts/trim-r2.ts --keep quebec,ontario,portugal           # plan
 *   tsx scripts/trim-r2.ts --keep quebec,ontario,portugal --apply   # do it
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Manifest = {
  schema: number;
  continents: Record<string, { name: string; groups: string[] }>;
  groups: Record<string, { name: string; regions: string[]; [k: string]: unknown }>;
  regions: Record<
    string,
    { latest: string; versions: Record<string, { total_bytes: number }>; [k: string]: unknown }
  >;
};

function optArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

const keep = new Set(
  (optArg("keep") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const apply = process.argv.includes("--apply");
const bucket = optArg("bucket") ?? process.env.BUCKET ?? "mapos-regions";
const remote = `r2:${bucket}`;

if (keep.size === 0) {
  console.error("usage: trim-r2.ts --keep <slug,slug,...> [--apply] [--bucket name]");
  process.exit(2);
}

function rclone(args: string[]): string {
  return execFileSync("rclone", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const gb = (n: number) => `${(n / 1e9).toFixed(2)} GB`;

// --- current state -----------------------------------------------------------
const manifest = JSON.parse(rclone(["cat", `${remote}/manifest.json`])) as Manifest;
const prefixes = rclone(["lsd", remote])
  .split("\n")
  .map((l) => l.trim().split(/\s+/).pop() ?? "")
  .filter((p) => p && !p.startsWith("_"));

const missing = [...keep].filter((s) => !manifest.regions[s]);
if (missing.length) {
  console.error(`error: not in the published manifest: ${missing.join(", ")}`);
  process.exit(1);
}

const bytesOf = (slug: string) =>
  Object.values(manifest.regions[slug]?.versions ?? {}).reduce((n, v) => n + v.total_bytes, 0);

// Everything on R2 that isn't kept — including stale prefixes the manifest no longer
// mentions, so the trim leaves nothing behind.
const drop = prefixes.filter((p) => !keep.has(p)).sort();
const keptBytes = [...keep].reduce((n, s) => n + bytesOf(s), 0);
const dropBytes = drop.reduce((n, s) => n + bytesOf(s), 0);

// --- trimmed manifest --------------------------------------------------------
const next: Manifest = { schema: manifest.schema, continents: {}, groups: {}, regions: {} };
for (const slug of Object.keys(manifest.regions).sort()) {
  if (keep.has(slug)) next.regions[slug] = manifest.regions[slug];
}
for (const [key, g] of Object.entries(manifest.groups)) {
  const regions = g.regions.filter((s) => keep.has(s));
  if (regions.length) next.groups[key] = { ...g, regions };
}
for (const [key, c] of Object.entries(manifest.continents)) {
  const groups = c.groups.filter((g) => next.groups[g]);
  if (groups.length) next.continents[key] = { ...c, groups };
}

// --- plan --------------------------------------------------------------------
console.log(`bucket:  ${remote}`);
console.log(`keep:    ${[...keep].sort().join(", ")}  (${gb(keptBytes)} + _world)`);
console.log(`drop:    ${drop.length} region prefixes  (${gb(dropBytes)} per manifest)`);
console.log(
  `manifest: ${Object.keys(manifest.regions).length} -> ${Object.keys(next.regions).length} regions`
);

if (!apply) {
  console.log("\ndry run — re-run with --apply to upload the trimmed manifest and purge the rest.");
  process.exit(0);
}

// --- apply -------------------------------------------------------------------
const tmp = join(mkdtempSync(join(tmpdir(), "trim-r2-")), "manifest.json");
writeFileSync(tmp, JSON.stringify(next));
rclone(["copyto", tmp, `${remote}/manifest.json`, "--s3-no-check-bucket"]);
console.log("==> uploaded trimmed manifest.json");

let i = 0;
for (const slug of drop) {
  i += 1;
  process.stdout.write(`==> purge ${slug} (${i}/${drop.length})\n`);
  rclone(["purge", `${remote}/${slug}`]);
}
console.log(`==> done: ${drop.length} regions removed, ${keep.size} kept`);
