# ADR-0009 — Browser storage, cloud backup and versions

- Status: accepted (owner, 2026-11-12: "I prefer the browser … versioning and a 3rd
  party storage link? Nextcloud, Google Drive, OneDrive").
- Facts checked on 2026-11-12. Browser and provider rules change: re-check before M2b.

## Context

Safari and Firefox cannot open a real folder from a web page. There, a book lives in the
browser's own storage (OPFS). The browser can wipe that storage: when the author clears
site data, when the disk is full, or — in Safari — after a stretch of days without using
the site. The owner chose the browser over a desktop app for v0.1, so the browser copy
must never be the only copy.

## Decision: four layers of protection

### 1. Ask the browser to keep it

- Request persistent storage (`navigator.storage.persist()`) on the first save. Safari 17+
  and Firefox support it; a persistent site is exempt from automatic eviction. The browser
  may still say no, so the Backup screen shows the answer in plain words
  ("Protected from clean-up" / "Not protected").
- Suggest **installing Aurelia as an app** (Safari: Add to Dock / Add to Home Screen;
  Chrome and Edge: Install). In Safari an installed web app has its own usage counter,
  separate from the browser tab.
- This lowers the risk. It does not remove it: the author can still clear site data.

### 2. Cloud backup to the author's own account (the main protection)

Aurelia copies the workspace to a cloud account the author already has. No Aurelia
account, no Aurelia server: the browser talks to the provider directly with OAuth 2.0 +
PKCE (a public client, no secret in the app).

| Provider | Access Aurelia asks for | Notes |
|---|---|---|
| **Google Drive** | `drive.file` — only files Aurelia created | Non-sensitive scope. Short-lived browser tokens: if a silent refresh fails, Aurelia shows "Reconnect Google Drive" and keeps the changes queued. |
| **OneDrive** | `Files.ReadWrite.AppFolder` — only the `Apps/Aurelia` folder | MSAL.js, PKCE. Use the `approot` path, never a hard-coded folder name (it is translated). Test large uploads. |
| **Nextcloud and other WebDAV** | The author's server address + an app password | Nextcloud does not send CORS headers by default. One-time setup: install the **WebAppPassword** app and add Aurelia's address to its allowed origins. The Backup screen links a short guide. |
| **Dropbox** (next) | App folder — `Apps/Aurelia` only | PKCE without a secret. |

S3-compatible storage comes with sync (M10).

**What is written** — a folder the author can open without Aurelia:

```
Aurelia/                              (in the provider's app folder)
  <Workspace name> (wsp_…)/
    current/        the workspace, same layout as a real folder (ADR-0003)
    versions/       2026-11-12T18-30.zip, …
    backup.json     manifest: device id, revision, file hashes, last backup time
```

**When:**
- Changed files are uploaded about a minute after the author stops typing, and again
  when the tab is hidden or closed (best effort).
- A **version** (zip of the whole workspace) is saved every hour of writing and before
  any risky step (migration, restore, accepting AI suggestions). Kept: hourly for 2
  days, daily for 30 days, weekly for 6 months, monthly for ever. The author can change
  this, and the screen shows the space used.
- The provider's own version history (Google Drive, OneDrive, Nextcloud) adds another
  layer for free.

**Never overwrite silently.** Before each upload Aurelia reads `backup.json`. If another
device wrote a newer revision, it stops and asks: *Keep both* (this browser backs up to a
new folder) or *Use the backup here* (after saving a version of this browser's copy).

**Backup is not sync.** One browser writes a backup; other devices restore a copy. Real
two-way sync (M4b, see the amendment below) builds on the same manifest and hashes.

### 3. Restore

- Welcome screen: **"Restore from a backup"** — pick the provider, the workspace and a
  version (latest, or a date).
- If Aurelia opens and finds its storage empty but remembers a workspace (a tiny marker
  that survives in more places), it says what happened and offers the restore.
- Every restore first checks the files against the manifest hashes.

### 4. Download a copy

"Download a backup (.zip)" is always one click away. With no cloud backup turned on,
Aurelia reminds the author once a week and shows **"Only in this browser"** in the status
bar until a backup exists.

## Privacy and secrets

- Backups are ordinary files in the author's own cloud. The provider can read them like
  any other file. Optional end-to-end encryption comes with M10.
- Tokens and app passwords are stored like API keys (ADR-0008): in IndexedDB, wrapped
  with a non-extractable WebCrypto key, never in project files or logs.
- OAuth client IDs are tied to the site's address. People who host their own copy of
  Aurelia register their own client IDs; the docs explain how.

## Consequences

- PLANS: the v0.1 storage decision is made (browser storage for Safari and Firefox, real
  folders for Chrome and Edge). New milestone **M2b · Backup and versions** in v0.1.
- Cloud backup is also offered to real-folder (Chrome, Edge) users: versions help them
  too.
- The Tauri desktop app comes later, before M8 (ADR-0008 still needs it).
- Exit tests for M2b: clear all site data, then restore — every file matches its hash;
  two browsers backing up one workspace never overwrite each other; an expired token
  keeps changes queued and shows "Reconnect"; a WebDAV server without CORS gives a clear
  setup message, not a silent failure.

## Amendment (2026-11-12): your own server, and sync moved up

Owner, 2026-11-12: "I wanted to mount a volume and have local storage backup as well as
having the ability to add a secondary storage for syncing", then "Yes, sync after
editor". The owner runs Aurelia on their own TrueNAS behind Cloudflare Access
([docs/self-hosting.md](../self-hosting.md)).

**Your own server is a backup target (M2b).** A small storage container (WebDAV) runs
next to the app on the author's server and writes into a mounted volume (on TrueNAS, a
dataset, so ZFS snapshots add one more layer). The app's nginx sends `/dav/` to it, so it
is on the **same address** as the app: no CORS setup, and Cloudflare Access protects it
like the app. It uses the same `RemoteStore` WebDAV adapter and the same layout and
`backup.json` as every other target. A second place (Google Drive, OneDrive, Nextcloud)
can be added beside it.

**The storage door checks the login itself.** The app's port on the server is open on the
home network, where Cloudflare Access does not apply. So the storage container refuses
every request without a valid Cloudflare Access token (`Cf-Access-Jwt-Assertion`, checked
against the team's public keys and the application's AUD tag). Without this, anyone on
the home network could read or delete the books. Which WebDAV server to use (nginx's DAV
module has no `PROPFIND`) is chosen at the start of M2b.

**Sync moves up: M4b, right after the editor**, not after v1. Two-way sync of a workspace
between devices through a WebDAV target (your own server first; Nextcloud works the same
way). Rules:

- It builds on `backup.json`: per-file hashes and revisions, written with compare-and-write.
- Pull when the app opens and every few minutes; push changed files after saving.
- A file changed on two devices is **never overwritten**: both texts are kept and shown
  as a conflict for the author to resolve.
- A version is saved before remote changes are applied. Deletes are kept as markers
  (tombstones), so a stale device cannot bring a deleted scene back silently. Moves follow
  stable IDs (ADR-0003 ID paths).
- Exit: random edit sequences on two and three devices, online and offline, never lose
  a word (property tests).

Sync through Google Drive and OneDrive, S3-compatible storage and end-to-end encryption
stay in M10.

## Sources

- WebKit, Updates to Storage Policy (Safari 17): https://webkit.org/?p=14403
- Google Drive scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- OneDrive app folder: https://learn.microsoft.com/graph/onedrive-sharepoint-appfolder
- Dropbox OAuth guide (PKCE): https://developers.dropbox.com/oauth-guide
- Nextcloud CORS (WebAppPassword app): https://github.com/digital-blueprint/webapppassword
