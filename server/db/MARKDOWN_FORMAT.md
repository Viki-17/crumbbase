# Crumbbase Markdown mirror format (revamp P0 — frozen)

The mirror under `./data/pages/` is the **safe copy**: human-readable,
`git`-diffable, and **reimportable**. SQLite is runtime truth; these files are
what get pushed to the private GitHub backup repo and what a rebuild reads back.

## Layout

```text
data/
  crumbbase.db            # runtime DB — NEVER committed
  pages/<page-id>.md      # one file per page
  assets/<source-id>.*    # thumbnails etc.
  manifest.json           # { version, exported_at, pages: [{id, file, updated_at}] }
  .backup-state.json      # written by the backup job (lastBackupAt, lastCommit, lastError)
```

## Page file

```markdown
---
id: <page-uuid>
source_id: <source-uuid>
source_url: https://www.youtube.com/watch?v=...
source_type: youtube
title: How X works
creator: Channel Name
duration_seconds: 754
status: complete
notes_model: opencode:pro
exported_at: 1699999999999
---

# How X works

## Source
- Creator: Channel Name
- Type: youtube
- Duration: 12:34
- Source: [https://...](https://...)
- Notes model: opencode:pro

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

## Tags
#tag-one #tag-two

## Concepts
- [[Palantir]] (3 notes)
- [[forward deployed engineer]] (2 notes)

## Transcript
- Segment text [12:34](https://...?t=754). <!-- block:<uuid> -->
- ...
```

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
6. **Tags:** `#tag` tokens are extracted to the `tags` table AND kept inline.
7. Headings other than the ones above are ignored on import (except `## Extra`,
   whose bullets import as `kind: note` blocks). Renderers must not emit other
   `##` sections — with two approved additions:
   - `## Zettels` (P1 polish): bullets import as `kind: zettel` blocks with
     `zettelTitle`/`sourceBlockId` parsed from `**Title:** body` + an optional
     `<!-- source:<uuid> -->` comment.
   - `## Concepts` (P2): export-only metadata (`- [[Name]] (N notes)` lines).
     Ignored on import; edges rebuild via entity linking on restructure.
