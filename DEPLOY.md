# Crumbbase — Server Deploy Guide

Deploy the current code (revamp + mobile-friendly UI) to your own Linux server.
Stack on the server: **Node + SQLite + `opencode serve` sidecar + yt-dlp/ffmpeg +
optional nginx**. No Mongo, no RabbitMQ, no Ollama, no Docker.

> Frontend changes in this release are in `client/src/*` only (App shell,
> `index.css`, SourceView tags toggle, Graph scroll wrapper). No new env vars,
> no DB migration — safe to deploy over an existing server database.

---

## 0. How this deploy works (read once)

| Piece | What runs on the server | Port |
|---|---|---|
| API + worker | `node server/index.js` via pm2 (`crumbbase-api`) | `3001` (localhost) |
| AI sidecar | `opencode serve` via pm2 (`crumbbase-opencode`) | `4096` (localhost only) |
| Frontend | **Built static files** (`client/dist/`) served by nginx | `80` / `443` |
| Database | SQLite file `./data/crumbbase.db` — auto-migrates on boot | — |

Browser → nginx (`/`) serves the UI, nginx (`/api/*`) proxies to Node.
Node calls the sidecar at `OPENCODE_SERVER_URL` for AI structuring.
The SQLite DB lives in `./data/` (gitignored — it never travels via git).

---

## 1. Commit & push from your Mac (do this first)

Your working tree currently has uncommitted changes (revamp + mobile UI).
They must be committed and pushed before the server can pull them.

```bash
cd /Users/vignesh/Documents/project-book

# sanity: everything here should be intentional
git status --short

git add -A
git commit -m "feat: mobile-friendly UI (bottom tabs, compact source view, collapsed tags)"
git push origin master
```

Verify on GitHub that `Viki-17/crumbbase` shows the new commit.

> Do NOT commit `.env` or `data/` — both are gitignored (`.env` has secrets,
> `data/` holds your local SQLite DB). The server gets its own `.env` (§4)
> and starts its own empty DB.

---

## 2. Server prerequisites (Ubuntu 22.04/24.04)

SSH into your server, then install system packages:

```bash
sudo apt update
sudo apt install -y git curl python3 build-essential ffmpeg nginx
```

| Requirement | Why | Check |
|---|---|---|
| Node.js 20+ | API + build tools (`node --version` — local dev uses v24) | `node --version` |
| `build-essential` + `python3` | `better-sqlite3` compiles a native module on `npm install` | — |
| `ffmpeg` | Audio/transcript handling for captures | `ffmpeg -version` |
| `yt-dlp` | YouTube metadata + captions (primary ingest) | `yt-dlp --version` |
| `opencode` binary | AI sidecar (`opencode serve :4096`) | `opencode --version` |
| `pm2` | Keeps API + sidecar alive, restarts on reboot | `pm2 --version` |
| GitHub SSH access | `git clone git@github.com:…` + optional Markdown-mirror backup push | `ssh -T git@github.com` |

Install the remaining tools:

```bash
# Node 22 (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# yt-dlp (latest binary — apt's version is usually too old for YouTube)
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp
sudo chmod +x /usr/local/bin/yt-dlp

# opencode binary (see https://opencode.ai/docs for current installer)
# e.g.: curl -fsSL https://opencode.ai/install | bash
# then confirm:
opencode --version

# pm2 process manager
sudo npm install -g pm2
```

> **Piper TTS note:** `setup.sh` auto-downloads the Piper TTS binary + voice
> model on Linux (~hundreds of MB). That belongs to the old book app and the
> revamp does not use it. To save time/disk, skip `setup.sh` and run the
> manual `npm install` steps in §3 instead.

---

## 3. Clone & install (first time on the server)

```bash
# pick a home for the app (no sudo needed below this point)
mkdir -p ~/apps && cd ~/apps
git clone git@github.com:Viki-17/crumbbase.git
cd crumbbase

# backend deps (compiles better-sqlite3 — takes a minute on small boxes)
npm install

# frontend deps
cd client && npm install && cd ..
```

---

## 4. Create the server `.env` (do NOT copy your Mac's `.env`)

Your Mac's `.env` still contains stale `MONGODB_URI` / `OLLAMA_HOST` lines
from the old app — the new code ignores them, but don't copy them over.
Create a clean one on the server:

```bash
cp .env.example .env
nano .env
```

Fill in / confirm these values:

```ini
PORT=3001
OPENCODE_SERVER_URL=http://127.0.0.1:4096

# Both default to opencode-go/muse-spark-1.3-contributor; override only if needed
# OPENCODE_PRO_MODEL=
# OPENCODE_FLASH_MODEL=

DATA_DIR=./data
TRANSCRIPT_PROVIDER=auto

# Markdown-mirror git backup (private repo). Leave false until SSH deploy
# access to the backup repo is set up, then flip to true.
GITHUB_BACKUP_ENABLED=false
GITHUB_BACKUP_REPO=
GITHUB_BACKUP_BRANCH=main
```

`TRANSCRIPT_PROVIDER` options: `auto` (try yt-dlp, fall back to pasting —
recommended), `yt-dlp` (fail loudly, no fallback), `paste` (never fetch).

---

## 5. Authenticate the AI sidecar (required for structuring)

The backend has no AI key of its own — it inherits auth from your
`opencode` login. Run this **as the same Linux user that will run pm2**:

```bash
opencode auth login
# select the `opencode-go` provider and complete the login
```

Confirm the sidecar answers:

```bash
opencode serve --port 4096 --hostname 127.0.0.1 &
sleep 3
curl -s http://127.0.0.1:4096/ -o /dev/null -w "%{http_code}\n"
kill %1   # stop the test instance; pm2 will own it from §7
```

Any HTTP response (even 404) means the sidecar is up. If `opencode auth
login` is skipped, every AI call fails with `fetch failed` and sources sit
in `processing` until you requeue them (see Troubleshooting).

---

## 6. Build the frontend

```bash
cd ~/apps/crumbbase/client
npm run build   # outputs static files to client/dist/
```

Rebuild after every `git pull` that touches `client/` — nginx serves
`dist/`, so **a stale `dist/` is the #1 cause of "my changes aren't showing"**.

> `client/dist/` is gitignored. Never commit it; always build on the server.

---

## 7. Start backend + sidecar with pm2

The repo's `ecosystem.config.js` defines three apps. For the nginx setup in
§8 you only need two of them (`crumbbase-opencode`, `crumbbase-api`) —
**do not start `crumbbase-client`** (that's a Vite dev server, not for
production).

```bash
cd ~/apps/crumbbase
mkdir -p logs

pm2 start ecosystem.config.js --only crumbbase-opencode
pm2 start ecosystem.config.js --only crumbbase-api

pm2 status
pm2 logs --lines 30   # watch boot: expect "[Worker] Service Started (SQLite queue)"
                      # and "Server running on http://localhost:3001 (runtime: sqlite)"
```

Persist the process list so both apps survive a reboot:

```bash
pm2 save
```

Verify the API (direct + through nginx — both must return the same JSON):

```bash
curl -s http://127.0.0.1:3001/api/setup/status | head -c 300; echo
curl -sk https://web.chatcrumbs.com/api/setup/status | head -c 300; echo
```

`setup/status` should report `"runtime":"sqlite"`, a migrated `sqlite.tables`
list, `"ytdlpAvailable":true`, `"ffmpegAvailable":true`, and
`"ai":{"opencodeReachable":true}`. If `opencodeReachable` is false, the
sidecar is down or unauthenticated — see Troubleshooting.

> **Node version gotcha (Oct 2026):** `better-sqlite3` is pinned to **v12**
> in `package.json` because the server runs **Node 20** and v13 requires
> Node ≥ 22 (v13 segfaults Node 20 with a core dump and zero log output —
> even `new Database(':memory:')` crashes). Do NOT upgrade to v13 without
> also moving the server to Node 22+. The server shares system Node with
> other pm2 apps (`chatcrumbs-api`, `digital-moments-api`, `stock`), so a
> Node upgrade needs care — the v12 pin is the safe default.

---

## 8. Frontend hosting (nginx → `web.chatcrumbs.com`)

The production UI is **static files**, not the pm2 `crumbbase-client` app.

| Item | Value |
|---|---|
| nginx site | `/etc/nginx/sites-enabled/web.chatcrumbs.com` |
| Static root | `/var/www/crumbbase/dist` (owner `www-data:www-data`) |
| SPA fallback | `try_files $uri $uri/ /index.html` |
| API proxy | `/api` → `http://127.0.0.1:3001/api` (long timeouts for AI jobs) |

After every `git pull` that touches `client/`, rebuild and re-sync:

```bash
cd ~/apps/crumbbase/client   # on this server the repo lives at /root/crumbbase
npm run build                # emits hashed assets to client/dist/ (gitignored)

# publish to the nginx root (rsync preferred; cp fallback below)
rsync -a --delete client/dist/ /var/www/crumbbase/dist/
# fallback: rm -rf /var/www/crumbbase/dist/* && cp -r client/dist/* /var/www/crumbbase/dist/

chown -R www-data:www-data /var/www/crumbbase/dist
nginx -t && nginx -s reload   # the `protocol options redefined` warn on 443 is pre-existing/harmless
curl -s https://web.chatcrumbs.com/ | grep -o 'assets/index-[^"]*'
```

The `index-*.js` / `index-*.css` hashes must change after a real frontend
update — if they don't, you're looking at a stale `dist/` (the #1 cause of
"my changes aren't showing"). Server-only changes (`server/`) need no
frontend build — just `pm2 restart crumbbase-api`.

---

## 9. Update flow (repeat deploy)

On the server (`/root/crumbbase`):

```bash
cd /root/crumbbase
git fetch origin
git log --oneline -3          # sanity: know what you're pulling
git pull --ff-only origin master   # diverged history needs a decision — never force-pull blindly
npm install                    # backend (rebuilds better-sqlite3 if Node changed)
cd client && npm install && npm run build && cd ..
rsync -a --delete client/dist/ /var/www/crumbbase/dist/
chown -R www-data:www-data /var/www/crumbbase/dist
pm2 restart crumbbase-api      # picks up server/ changes + runs pending SQLite migrations
nginx -t && nginx -s reload
curl -sk https://web.chatcrumbs.com/api/setup/status | head -c 200; echo
```

`pm2 save` once after any pm2 start/delete change so reboots restore the
right set. The SQLite DB (`./data/crumbbase.db`, gitignored) auto-migrates
on boot — never commit it, never copy it over git.

---

## 10. Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `https://web.chatcrumbs.com/` loads but API calls fail / `/api/*` → 502 | `crumbbase-api` not running: `pm2 status`, then `pm2 restart crumbbase-api`; check `logs/api-*.log` (repo-local logs, not `~/.pm2/logs/`). |
| `crumbbase-api` crash-loops (`restarts` climbing, `uptime 0s`), empty err log | Native module ABI mismatch. Check `node --version` vs `better-sqlite3` engines (`node -p "require('better-sqlite3/package.json').engines"`). If Node is v20, keep the v12 pin; if Node was upgraded, `rm -rf node_modules && npm install` to rebuild. Diagnose with `timeout 20 node server/index.js` in the foreground. |
| Sources stuck in `processing` | Sidecar down or unauthenticated: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4096/` must answer; `pm2 logs crumbbase-opencode`. Auth lives in `~/.local/share/opencode/auth.json` for the user running pm2 — re-run `opencode auth login` as that user if missing. Reset the source to `processing` + enqueue a fresh `structure` job to retry (retries are exhausted, not infinite). |
| `fetch failed` from AI calls | Same as above — sidecar not running. Client error names the sidecar URL; confirm `OPENCODE_SERVER_URL` in `.env`. |
| `yt-dlp` fails on new YouTube videos | apt's yt-dlp is too old — reinstall the binary per §2. With `TRANSCRIPT_PROVIDER=auto`, captures fall back to `awaiting_paste` instead of failing. |
| YouTube says "Sign in to confirm you're not a bot" | Datacenter-IP challenge. Fix: export a Netscape cookies file from a logged-in browser (e.g. "Get cookies.txt LOCALLY" for `youtube.com`), upload to `./data/youtube-cookies.txt` (`chmod 600`, gitignored — never commit it), set `YTDLP_COOKIES=./data/youtube-cookies.txt` in `.env`, `pm2 restart crumbbase-api`. `setup/status → tools` reports `ytdlpCookiesConfigured` / `ytdlpCookiesFileExists`. A missing file only warns and fetches unauthenticated. Cookies expire every weeks–months — re-export when bot errors return. |
| Old Mongo/Rabbit/Ollama strings in logs | Stale `logs/*.log` content from the pre-revamp stack. `truncate -s 0 logs/api-*.log` after a restart to get a clean view. The revamp code has zero references to those services. |
| `git pull` reports diverged branches | The server sometimes carries local-only commits. Inspect with `git log --oneline -5` vs `origin/master` before merging; when the server is purely a deploy target, `git stash` + `git reset --hard origin/master` is cleaner than a merge. |