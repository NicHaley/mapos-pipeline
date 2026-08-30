# MapOS region build pipeline

Builds the region packs that the [MapOS](https://github.com/NicHaley/mapos) desktop app
downloads for offline maps, routing, and geocoding. Standalone: it shares no code with
the app, only the artifact format and the R2 bucket they're published to.

Turns one OSM extract into a downloadable region pack — `<region>.pmtiles` (basemap),
`valhalla_tiles.tar` (routing), `geocode.sqlite` (forward/reverse geocode) — versioned
under `dist/<region>/<version>/`, plus a `dist/manifest.json` the app reads to discover
regions. Uploads to Cloudflare R2.

World coverage comes from `regions.json` — a checked-in catalog of all ~512 Geofabrik
leaf extracts — and a batch driver that builds them through the same make stages.

## Prerequisites

```sh
brew install osmium-tool pmtiles rclone     # extract/export, tile slicing, R2 upload
pnpm install                                # build scripts (tsx, biome, pmtiles readers)
cp .env.example .env                        # then fill in the R2 credentials
# Docker Desktop running — used for the Valhalla tile build.
```

If geocode fails with `NODE_MODULE_VERSION`, run `pnpm rebuild better-sqlite3`
(the native binary must match your current Node).

## Build one region

Make builds a single pack into `dist/<region>/<version>/`. It does not walk the
catalog or upload.

Smoke-test the pipeline (default extract: Monaco, small enough to finish in minutes):

```sh
make region
```

A region already in `regions.json` (URL, name, group, country come from the catalog):

```sh
make build-slug SLUG=us-georgia
```

An extract you specify. `NAME` is the display name; `GROUP`/`GROUP_NAME` nest it
under a country in the download UI:

```sh
make region REGION=berlin GROUP=germany GROUP_NAME=Germany NAME=Berlin \
  SRC_URL=https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf
```

Clip with `BBOX=minlng,minlat,maxlng,maxlat`; otherwise the pack uses the extract's
data bounds. Stages: `make pmtiles`, `valhalla`, `geocode`, `manifest`.

## Catalog

`regions.json` is every Geofabrik **leaf** extract (~512): a country's subregions
when it is split (US states, German states, …), otherwise the country. Leaves do
not overlap. Continents and redundant combos (dach, alps, us-west, …) are
excluded; combos that are a country's only coverage (gcc-states, …) are kept.
Subregions group under their country in the manifest; standalone countries under
their continent.

Regenerate when Geofabrik reshuffles (deterministic; `--check` verifies without
writing):

```sh
pnpm exec tsx scripts/gen-catalog.ts
```

Unclassified new extracts are warned — add them to `EXCLUDE` or `REVIEWED_KEEP`
in `scripts/gen-catalog.ts` and re-run.

## Batch (catalog / world)

Runs `make region` → `upload` → `clean` for each catalog entry, sequentially.
Don't run two drivers at once (Valhalla + Geofabrik).

```sh
pnpm exec tsx scripts/batch-build.ts --dry-run            # work list
pnpm exec tsx scripts/batch-build.ts --continent europe
pnpm exec tsx scripts/batch-build.ts --group germany --no-upload
pnpm exec tsx scripts/batch-build.ts                      # whole catalog
```

Each run refreshes the world backdrop first (~8s) and aborts the batch if that
fails. `--no-world` skips it; `--limit 0` is "just refresh and publish the world."

One `VERSION` (default: today) stamps the batch. Complete
`dist/<slug>/<version>/` dirs are skipped — resume with `--version YYYY-MM-DD`
(the driver prints the flag). Failures append to `failures.log`;
`--retry-failed` re-runs those. Also: `--limit N`, `--sleep N`, `--retain N`.

Uploads per region (`--no-upload` to skip). Credentials from `.env`.

A full-world `dist/` at `RETAIN=2` is several hundred GB — `--retain 1` or an
external `DIST_DIR` for the first pass. Large extracts may need more Docker RAM.

## Output location

Set `DIST_DIR` in `.env` to put artifacts on another volume (the directory must
already exist — `mkdir -p` on an unmounted `/Volumes/...` would silently build
onto the internal disk):

```sh
DIST_DIR=/Volumes/T7/mapos-dist
```

`work/` stays local (hot I/O: downloads, osmium, Valhalla's docker mount). Format
the drive APFS — the checksum cache keys on mtimes, and exFAT's are too coarse.
Keep it from sleeping on multi-day runs.

## World backdrop

Low-zoom world basemap, built once, shipped inside the app rather than as a pack.
The batch driver refreshes it; to do it alone:

```sh
make world world-geocode upload-world
```

`upload-world` publishes `world.pmtiles` and `world.sqlite` to `_world/` on R2 —
the only channel to the app repo. `make upload` is per-region and never touches
`_world/`.

## Upload

```sh
make upload                                 # artifacts → prune → manifest (atomic)
```

Reads `BUCKET` and `RCLONE_CONFIG_R2_*` from `.env`. Artifacts go up first,
`manifest.json` last, so a client never sees a half-uploaded version. Overrides
still win: `make upload DIST_DIR=...`.

## Versions & retention

Each build is `dist/<region>/<VERSION>/` (`VERSION` defaults to today). The
manifest keeps a `latest` pointer per region. Only the newest `RETAIN` versions
(default **2**: live + previous) are kept; older ones are pruned from disk and
R2 on `make upload`. Override with `RETAIN=3`, or `make prune`.

## Cleanup

`make clean` removes `work/`; `make distclean` also wipes `dist/`.

## Built on

[OpenStreetMap](https://www.openstreetmap.org/copyright) ·
[Protomaps](https://protomaps.com) ·
[Valhalla](https://github.com/valhalla/valhalla) ·
[Geofabrik](https://www.geofabrik.de) ·
[Natural Earth](https://www.naturalearthdata.com) ·
[Wikidata](https://www.wikidata.org)

Map data © OpenStreetMap contributors, available under the
[Open Database License](https://www.openstreetmap.org/copyright).

## License

[Apache-2.0](LICENSE)

## Contact

[hello@mapos.md](mailto:hello@mapos.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and how to submit changes.
