# Crumbbase Markdown mirror format — OKF v0.2 profile (Oct 2026)

The mirror under `./data/` is the **safe copy**: human-readable,
`git`-diffable, and **reimportable**. It is a conformant
[Google Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format)
(v0.2) bundle: every page is a concept document (`type` + YAML frontmatter),
the bundle root carries `index.md` with `okf_version: "0.2"`, and consumers
MUST tolerate our producer-extension keys. SQLite is runtime truth; these
files are what get pushed to the private GitHub backup repo and what hub
sync reads back.

## Layout

```text
data/
  crumbbase.db            # runtime DB — NEVER committed
  index.md                # OKF bundle index (okf_version + per-page entries)
  pages/<page-id>.md      # one OKF concept per page
  assets/<source-id>.*    # thumbnails etc.
  manifest.json           # { version, exported_at, pages: [{id, file, updated_at}] }
                          # crumbbase sync clock — NOT an OKF file
  .backup-state.json      # written by the backup job (never committed)
```

## Page file (concept)

```markdown
---
type: Video Notes
title: How X works
description: One-sentence gist for indexes and snippets.
resource: https://www.youtube.com/watch?v=abc123
tags: [startup-lessons, palantir]
sources:
  - id: video
    resource: https://www.youtube.com/watch?v=abc123
    title: How X works
    author: Channel Name
generated: {by: crumbbase/muse-spark, at: '2026-10-11T10:00:00.000Z'}
status: stable
id: 1aaa577b-7021-4eb7-8b3b-7e61535e961e
source_id: 5f626814-a728-429a-aa42-8e326c9ea66c
source_url: https://youtu.be/abc123?si=xyz
source_type: youtube
creator: Channel Name
duration_seconds: 754
pipeline_status: complete
---

# How X works

## Source
...human-readable header (creator, type, duration, links, status)...

## TL;DR
One-paragraph gist. <!-- block:<uuid> -->

## Key ideas
- Idea text with [12:34](https://...?t=754) deep-link. <!-- block:<uuid> -->
  <!-- aliases: alternate phrasing one; alternate phrasing two -->
- Next idea. <!-- block:<uuid> -->

## Notable claims
- Claim text (support). <!-- block:<uuid> -->

## Follow-up questions
- Question? <!-- block:<uuid> -->

## Zettels
- **Title:** body <!-- block:<uuid> --> <!-- source:<uuid> -->

## Concepts
- [[Palantir]] (3 notes)

## Transcript
- Segment text [12:34](https://...?t=754). <!-- block:<uuid> -->
- ...
```

## Field mapping (OKF §4–§5)

| Frontmatter key | OKF family | Value |
|---|---|---|
| `type` | required | `Video Notes` (consumers must tolerate unknown types) |
| `title` | recommended | source title |
| `description` | recommended | TL;DR first sentence, `#tags` stripped, ≤220 chars |
| `resource` | recommended | canonical URL (dedupe identity) |
| `tags` | recommended | YAML list; the ONLY tag source (no `## Tags` body section) |
| `sources` | provenance | single `video` entry: canonical resource + title + creator as `author` |
| `generated` | trust | `{by: crumbbase/<notes_model or mvp>, at: <ISO UTC>}` |
| `status` | lifecycle | `complete`→`stable`, anything else→`draft` |
| `id`, `source_id`, `source_url`, `source_type`, `creator`, `duration_seconds`, `pipeline_status` | producer extensions | sync identity (`source_url`→canonical) + reimport fidelity; `pipeline_status` is the old `status` key renamed (it collided with lifecycle `status`) |

`log.md` is intentionally absent (processing logs stay DB-only). Timestamps
for machines are epoch-ms in `manifest.json`; human/agent trust timestamps
are ISO-8601 UTC in `generated.at`. The sync newer-wins clock reads
`generated.at` (legacy `exported_at` accepted on import during transition).

## Rules (parser ↔ renderer contract)

1. **Identity:** every AI/transcript bullet ends its first line with
   `<!-- block:<uuid> -->`. That uuid IS the block id — stable across exports.
2. **Tree:** bullets nested under a bullet become child blocks (`parent_id`).
   Top-level bullets attach to the page root in file order (`position`).
3. **Aliases:** an `<!-- aliases: a; b -->` comment line directly under a bullet
   is search metadata (indexed in FTS, hidden by renderers), not content.
4. **Timestamps:** inline `[mm:ss](url?t=secs)` links; `secs` also lands in
   `props_json.timestamp` on import.
5. **Unknown bullets** (no id comment — e.g. hand-added in a future editor):
   import assigns fresh uuids (additive, never destructive).
6. **Tags:** frontmatter `tags:` is authoritative (extracted to the `tags`
   table; attached to tldr + key-idea blocks exactly like structuring does).
   Legacy `## Tags` sections still import (fallback) but are never rendered.
7. **Zettels:** `**Title:** body` + optional `<!-- source:<uuid> -->` imports
   as `kind: zettel` with `zettelTitle`/`sourceBlockId` (+ links edge when the
   target block exists in the same import).
8. **Concepts:** `## Concepts` is export-only (`- [[Name]] (N notes)` lines).
   Ignored on import; edges rebuild via entity linking.
9. **Reserved files:** `index.md`/`log.md` are never concepts; the importer
   refuses them with a `Reserved bundle file` error. Sync only ever reads
   files listed in `manifest.json`.
