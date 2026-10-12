#!/usr/bin/env tsx
/**
 * Put regions back on R2 from a dist/ that still holds their built artifacts and
 * the manifest.json that catalogued them (e.g. the batch drive). The reverse of
 * trim-r2.ts: artifacts go up first, then the live manifest is rewritten with the
 * restored entries merged in — kept regions are untouched. Default is a dry run.
 *
 * Needs rclone's `r2` remote (RCLONE_CONFIG_R2_* in the env, see .env.example).
 *
 *   tsx scripts/restore-r2.ts --dist /Volumes/MapOS/mapos-dist \
 *     --groups united-kingdom,spain,france,italy --slugs monaco            # plan
 *   tsx scripts/restore-r2.ts --dist ... --groups ... --slugs ... --apply  # do it
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type RegionEntry = {
  group?: string;
  continent?: string;
  latest: string;
  versions: Record<string, { path: string; total_bytes: number; [k: string]: unknown }>;
  [k: string]: unknown;
};
type Manifest = {
  schema: number;
  continents: Record<string, { name: string; groups: string[] }>;
  groups: Record<string, { name: string; regions: string[]; [k: string]: unknown }>;
  regions: Record<string, RegionEntry>;
};

function optArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}
const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const dist = optArg("dist") ?? "dist";
const groups = list(optArg("groups"));
const slugs = list(optArg("slugs"));
const apply = process.argv.includes("--apply");
const bucket = optArg("bucket") ?? process.env.BUCKET ?? "mapos-regions";
const remote = `r2:${bucket}`;

if (!groups.length && !slugs.length) {
  console.error(
    "usage: restore-r2.ts --dist <dir> [--groups a,b] [--slugs x,y] [--apply] [--bucket name]"
  );
  process.exit(2);
}

function rclone(args: string[], inherit = false): string {
  return execFileSync("rclone", args, {
    encoding: "utf8",
    stdio: ["ignore", inherit ? "inherit" : "pipe", "inherit"]
  });
}
const gb = (n: number) => `${(n / 1e9).toFixed(2)} GB`;

// --- sources -----------------------------------------------------------------
const oldPath = join(dist, "manifest.json");
if (!existsSync(oldPath)) {
  console.error(`error: ${oldPath} not found — restore needs the manifest that catalogued dist/`);
  process.exit(1);
}
const old = JSON.parse(readFileSync(oldPath, "utf8")) as Manifest;
const live = JSON.parse(rclone(["cat", `${remote}/manifest.json`])) as Manifest;
if (old.schema !== live.schema) {
  console.error(`error: schema mismatch — dist manifest ${old.schema}, live ${live.schema}`);
  process.exit(1);
}

// --- what to restore ---------------------------------------------------------
const wanted = new Set<string>(slugs);
for (const g of groups) {
  const entry = old.groups[g];
  if (!entry) {
    console.error(`error: group "${g}" not in ${oldPath}`);
    process.exit(1);
  }
  for (const s of entry.regions) wanted.add(s);
}

const restore: string[] = [];
const skipped: string[] = [];
const problems: string[] = [];
for (const slug of [...wanted].sort()) {
  const e = old.regions[slug];
  if (!e) {
    problems.push(`${slug}: not in ${oldPath}`);
    continue;
  }
  if (live.regions[slug]) {
    skipped.push(slug);
    continue;
  }
  const dir = join(dist, e.versions[e.latest].path);
  if (!existsSync(dir)) {
    problems.push(`${slug}: ${dir} missing on disk`);
    continue;
  }
  restore.push(slug);
}
if (problems.length) {
  console.error(`error:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const bytes = restore.reduce((n, s) => {
  const e = old.regions[s];
  return n + e.versions[e.latest].total_bytes;
}, 0);
const liveBytes = Object.values(live.regions).reduce(
  (n, e) => n + Object.values(e.versions).reduce((m, v) => m + v.total_bytes, 0),
  0
);

// --- merged manifest ---------------------------------------------------------
// Only the restored version goes in; older versions on the batch drive stay there.
const next: Manifest = structuredClone(live);
for (const slug of restore) {
  const e = old.regions[slug];
  next.regions[slug] = { ...e, versions: { [e.latest]: e.versions[e.latest] } };
  if (e.group) {
    const g = next.groups[e.group] ?? { ...old.groups[e.group], regions: [] };
    if (!g.regions.includes(slug)) g.regions.push(slug);
    next.groups[e.group] = g;
    if (e.continent) {
      const c = next.continents[e.continent] ?? { ...old.continents[e.continent], groups: [] };
      if (!c.groups.includes(e.group)) c.groups.push(e.group);
      next.continents[e.continent] = c;
    }
  }
}
for (const g of Object.values(next.groups)) g.regions.sort();

// --- plan --------------------------------------------------------------------
console.log(`bucket:   ${remote}`);
console.log(`restore:  ${restore.length} packs, ${gb(bytes)}`);
if (skipped.length) console.log(`already live (skipped): ${skipped.join(", ")}`);
console.log(
  `manifest: ${Object.keys(live.regions).length} -> ${Object.keys(next.regions).length} regions`
);
console.log(`bucket after: ~${gb(liveBytes + bytes)} + _world`);

if (!apply) {
  console.log("\ndry run — re-run with --apply to upload the packs and the merged manifest.");
  process.exit(0);
}

// --- apply: artifacts first, manifest last -----------------------------------
let i = 0;
for (const slug of restore) {
  i += 1;
  const e = old.regions[slug];
  const rel = e.versions[e.latest].path;
  process.stdout.write(
    `==> upload ${slug} (${i}/${restore.length}, ${gb(e.versions[e.latest].total_bytes)})\n`
  );
  // Idempotent: rclone skips files already present with matching size/time, so a
  // crashed run can simply be re-run.
  rclone(
    [
      "copy",
      join(dist, rel),
      `${remote}/${rel}/`,
      "--s3-no-check-bucket",
      "--exclude",
      "**/.DS_Store",
      "--exclude",
      ".DS_Store",
      "--exclude",
      ".no-routing"
    ],
    true
  );
}

const tmp = join(mkdtempSync(join(tmpdir(), "restore-r2-")), "manifest.json");
writeFileSync(tmp, JSON.stringify(next));
rclone(["copyto", tmp, `${remote}/manifest.json`, "--s3-no-check-bucket"]);
console.log(
  `==> done: ${restore.length} regions restored, manifest now lists ${Object.keys(next.regions).length}`
);
