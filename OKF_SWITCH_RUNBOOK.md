# OKF Switch — Production Runbook (for the prod agent)

Switch the Markdown mirror to a conformant Google OKF v0.2 bundle without
breaking the existing YouTube imports. Read ALL of §1–§2 before touching
anything; the order of operations is the safety mechanism.

Code commit: OKF frontmatter renderer (`server/services/mirror.js`), bundle
`index.md`, dual-format importer (`server/services/mirror-import.js`),
`js-yaml` dependency, `index.md` backup tracking, sync merge index regen,
rewritten `server/db/MARKDOWN_FORMAT.md`, `scripts/reexport-okf.js`,
`scripts/check-okf.js`.

## 1. Why this order is safe (read first)

- **SQLite is runtime truth; the mirror is derived.** No DB migration exists
  in this change. Every mirror file can be regenerated from the DB, so no
  step below is irreversible. Rollback is code-only (§6).
- **New code reads old mirrors perfectly** (YAML superset + `## Tags` /
  `exported_at` / legacy `status` fallbacks). **Old code does NOT read new
  mirrors well** (tags would import empty). Therefore: code goes to ALL
  machines BEFORE any page is re-exported. In the mixed window, old machines
  skip new hub files (`hubTime=0` → older → skip) rather than corrupting.
- **Sync converges, never duplicates.** Identity is `canonical_url`. Re-import
  is idempotent (block ids stable). Newer-wins may cause ONE churn round
  (every page "updated" once) — the second sync must be all-skipped (§4).
- **No link_index storm.** The importer preserves `link_state` across
  replace-imports, so content-identical re-imports hit the fingerprint gate
  and skip AI work. Genuinely changed pages still relink fully (correct).

## 2. Pre-flight (do not skip; all read-only)

On the server (`/root/crumbbase`):

```bash
cd /root/crumbbase
git log --oneline -3            # must include the OKF commit before proceeding
git status --short              # must be clean

# Inventory: how many pages/jobs are we switching?
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/crumbbase.db', { readonly: true });
console.log('sources:', JSON.stringify(db.prepare(\"SELECT status, COUNT(*) AS c FROM sources GROUP BY status\").all()));
console.log('pages:', db.prepare('SELECT COUNT(*) AS c FROM pages').get().c);
console.log('blocks:', db.prepare('SELECT COUNT(*) AS c FROM blocks').get().c);
console.log('mirror files:', require('fs').readdirSync('data/pages').length);
"
# ^^^ WRITE THE NUMBERS DOWN — you will compare against them in §4.

# Backup health (must be green / recently pushed):
curl -s http://127.0.0.1:3001/api/setup/status | python3 -m json.tool | grep -A6 backup
pm2 status                      # crumbbase-api + crumbbase-opencode online
curl -s -o /dev/null -w "sidecar: %{http_code}\n" http://127.0.0.1:4096/
ls data/.git >/dev/null && echo "data is a git repo" || echo "NO DATA REPO (sync never ran here — fine)"
```

Abort if: working tree dirty, sidecar down (re-export itself needs no AI,
but queued link_index jobs do), or backup failing (fix backup first — a
healthy push path is required in §4).

## 3. Deploy (code everywhere FIRST)

```bash
cd /root/crumbbase
git fetch origin
git pull --ff-only origin master
npm install                     # picks up js-yaml (pure JS — no native build,
                                # no interaction with the better-sqlite3 v12 pin)
node --check server/services/mirror.js && node --check server/services/mirror-import.js \
  && node --check server/handlers/sync.js && echo SYNTAX-OK
pm2 restart crumbbase-api
sleep 5
curl -s http://127.0.0.1:3001/api/setup/status | head -c 200; echo
pm2 logs crumbbase-api --lines 15 --nostream
# Expect: "[Worker] Service Started (SQLite queue)" + server running line,
# NO migration errors (there is no migration in this change).
```

Repeat on EVERY machine that syncs (local Mac included — pull + restart
there too). Do NOT re-export anything until all machines run the new code.

## 4. Flag day (re-export → push → sync)

**4a. Canary — one page only.** Pick any page id from the inventory:

```bash
cd /root/crumbbase
PAGE=<one-page-uuid-from-data/pages>
node -e "
const { getDb, closeDb } = require('./server/db/db');
getDb();
require('./server/services/mirror').writePageMirror('$PAGE', {});
closeDb(); console.log('exported');
"
head -20 data/pages/$PAGE.md
# Expect OKF frontmatter: type/title/description/resource/tags/sources/
# generated/status + crumbbase id/source_id/source_url/pipeline_status.
# Must NOT contain: ## Tags section, exported_at, notes_model.
node scripts/check-okf.js
# Expect: "OKF conformant: N concepts + index.md" (N counts ALL pages, but
# only the canary is converted — per-file violations would still fail it).
```

If the canary file looks wrong: STOP, do not continue — paste the head -20
output back for diagnosis. The DB is untouched; deleting the file + one more
`writePageMirror` after a fix restores it.

**4b. Re-export all + push:**

```bash
node scripts/reexport-okf.js
# Expect: "re-exported N/N pages" + "index.md: N entries", exit 0.
node scripts/check-okf.js
# Expect: "OKF conformant: N concepts + index.md".
curl -s -X POST http://127.0.0.1:3001/api/backup/run
# Worker pushes pages + manifest.json + index.md (one big commit — expected).
# Watch: pm2 logs crumbbase-api --lines 10 --nostream → "Backup pushed".
```

**4c. Sync each machine** (Library ⇅ Sync button, or
`POST /api/sync/run`). Expected first sync: some `imported`/`updated`
(hub-newer), `pushed: true`. **Second sync MUST be all-skipped with no
push** — if it isn't, stop and report the SUMMARY line.

**4d. Post-switch inventory** — numbers must match §2 (sources/pages/blocks
identical; tags identical or a superset only if a genuine update landed):

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/crumbbase.db', { readonly: true });
console.log('sources:', db.prepare('SELECT COUNT(*) AS c FROM sources').get().c);
console.log('blocks:', db.prepare('SELECT COUNT(*) AS c FROM blocks').get().c);
console.log('tags:', db.prepare('SELECT COUNT(*) AS c FROM tags').get().c);
"
# Spot-check search + one source page in the UI (FTS/concepts ride along).
```

## 5. What NOT to do

- Do NOT run `reexport-okf.js` before every syncing machine runs the new
  code (old importer would import tagless copies).
- Do NOT `git push --force` in `./data` for any reason — divergence is
  resolved by Sync's merge path, never by force.
- Do NOT commit `crumbbase.db*` / `.backup-state.json` (still gitignored;
  verify with `git -C data status --short` showing them untracked/`!!`).
- Do NOT edit hub files by hand — the hub is written only by backup/sync.
- Do NOT upgrade `better-sqlite3` alongside this (unrelated; v12 pin stays).

## 6. Rollback

```bash
cd /root/crumbbase
git log --oneline -3            # identify the OKF commit hash
git revert <okf-commit-hash>    # or: git reset --hard <previous-commit> if unpushed elsewhere
npm install                     # drops js-yaml
pm2 restart crumbbase-api
node scripts/reexport-okf.js    # regenerates old-format mirrors from the DB
curl -s -X POST http://127.0.0.1:3001/api/backup/run
```

DB needs no downgrade (schema untouched). Other machines: pull + restart +
one Sync (their importer reads both formats either way).

## 7. Troubleshooting

| Symptom | Meaning → action |
|---|---|
| `check-okf.js` VIOLATION on `type` | A page exported by old code slipped in — re-run `reexport-okf.js`, then `check-okf.js` again. |
| First sync imports 0 but hub has pages | Clock skew or manifest `updated_at` newer locally — inspect `manifest.json` timestamps; import is skipped only when local is newer-or-equal. |
| Sync repeats `updated` every run (never all-skipped) | Something rewrites the mirror each cycle (e.g. link_index mirror rewrites with new `generated.at`) — capture the sync SUMMARY + `processing_logs` and report; do not keep syncing. |
| `link_index` queue explodes after switch | Fingerprint gate should absorb identical pages — check logs for `already current — skipped (fingerprint match)`. Absence means content actually differs per machine (investigate one page's diff). |
| Backup push rejected (non-fast-forward) | Expected on a machine that never synced — run Sync (it merges), do NOT force-push. The error message names the sync endpoint. |
| `js-yaml` install fails | It is pure JS — failure means npm registry/network trouble, not a compiler issue. Retry `npm install`; server runs fine on old code until then. |
