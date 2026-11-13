# ADR-0011 — Our own storage server (`aurelia-store`), not an off-the-shelf WebDAV server

- Status: accepted (owner, 2026-11-12). Settles the open question in the
  [ADR-0009 amendment](0009-browser-storage-and-backup.md): "which WebDAV server to use".

## Context

Aurelia runs on the owner's TrueNAS behind Cloudflare Access. Backup to "your own
server" (M2b) needs a place the browser can write books to. Two facts shape it:

- The app's port on the NAS is also open on the home network, where Cloudflare Access
  does not apply. Whatever stores the books must check the login itself.
- Every save is **compare-and-write** (AGENTS.md rule 1). A browser file API cannot do
  that. A server can: check the version and write in one step, under a lock.

## Decision

Aurelia ships its own small server, `aurelia-store`, in `server/store/`, as a second
container image (`ghcr.io/lukemoreira/aurelia-store`). It runs next to the app and
writes into a mounted volume (on TrueNAS, a dataset). The app's nginx sends `/dav/` to it,
so it has the **same address** as the app: no CORS.

Why not an existing WebDAV server:

1. **A real compare-and-write.** `If-Match` and `If-None-Match` are checked under a lock per
   path, and the file is replaced by temp file + `fsync` + `rename`. Two writers with the
   same `If-Match` cannot both win. Off-the-shelf servers check preconditions without a
   lock, or not at all (nginx's DAV module has no `PROPFIND`).
2. **It checks the Cloudflare Access login itself** (`Cf-Access-Jwt-Assertion`, RS256, the
   team's keys, `iss`, `aud`, `exp`, `nbf`). Without it, anyone on the home network could
   read or delete the books. It refuses to start without its two settings.
3. **It is small and fully tested.** About 650 lines, one dependency (`jose`, MIT), tests
   for every method, status, race and escape.

It speaks a **standard WebDAV subset** (class 1), so the same browser client later also
works with Nextcloud.

## The protocol

Mounted at `/dav/`. Paths are URL-encoded UTF-8, `/`-separated. The root is the volume.

| Method     | Behaviour                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPTIONS`  | 200, `DAV: 1`, `Allow`.                                                                                                                                                                |
| `PROPFIND` | `Depth: 0` or `1` (anything else, or none: 403). `207` with `resourcetype`, `getetag`, `getcontentlength` (files), `getlastmodified`, `getcontenttype`. 404 if missing.                 |
| `GET/HEAD` | 200, strong `ETag` = `"` + SHA-256 hex of the content + `"`, `Content-Length`, `Last-Modified`, `Content-Type`. A folder: 405.                                                         |
| `PUT`      | Atomic create/replace. `If-Match` (412 if different or missing), `If-None-Match: *` (412 if it exists). 409 without parent folder, 405 on a folder, 413 over 64 MiB. 201 or 204 + `ETag`. |
| `DELETE`   | 204, 404. Honours `If-Match` on files and folders. Folders go with their content. The root: 405.                                                                                                   |
| `MKCOL`    | 201, 405 if it exists, 409 without parent.                                                                                                                                             |
| `MOVE`     | `Destination` (a path or a URL; only the path counts) and `Overwrite: T\|F` (default T). 201 or 204; 412 on `Overwrite: F` over an existing target; 409 without parent.                |
| other      | 405.                                                                                                                                                                                   |

Errors have a one-line plain-text body: `412 Precondition Failed`.

A folder's ETag follows its own modification time, not its content. Names starting with
`.aurelia-store` are the store's temp files: never listed, never served (403).

## Safety

- Every check-then-act (`If-Match`, `If-None-Match`, `Overwrite`) runs under a per-path lock
  (`MOVE` takes both paths, sorted). An upload goes to a temp file first, outside the lock,
  so a slow client does not block others; only the check and the rename are locked.
- Paths: `..`, `.`, empty segments, NUL and control characters, backslashes, `%2f`, bad
  UTF-8 and bad percent-encoding are 400. The parent folder and any symlink are resolved with
  `realpath` and must be inside the root, or the answer is 403. A symlink that leaves the root
  is never followed, listed, written through or moved through.
- Login: every request except `/healthz` needs a valid token. Keys are cached; an unknown
  `kid` fetches them again at most once per 30 s. `AURELIA_STORE_INSECURE_NO_AUTH=1` turns
  the check off, prints a loud warning, and is for tests only.
- Files are data, never pages: every `GET`/`HEAD` sends `Content-Security-Policy: default-src 'none'; sandbox` and `X-Content-Type-Options: nosniff`, and `Content-Disposition: attachment` for anything but text, markdown, JSON and zip, so a stored SVG or HTML cannot run script on the app's origin.
- The token must carry `exp`, and `CF_ACCESS_TEAM_DOMAIN` must be `<team>.cloudflareaccess.com` (the store refuses to start otherwise).
- On start the store deletes `.aurelia-store-*.tmp` files older than an hour (no symlink is followed, nothing else is touched).
- Logs: method, path, status, duration. Never the token or file contents.
- The container runs as `568:568` (the TrueNAS `apps` user), read-only root, no
  capabilities, no published port.

## Known limits

- A lock is per path, in one process. Run one store per volume. A folder `DELETE` or `MOVE`
  does not lock the files inside it.
- Someone who can write into the volume by other means (SMB, a shell) can swap a folder for a
  symlink between the store's check and its write. Keep the dataset's own permissions tight.
- A crash during an upload leaves a hidden `.aurelia-store-*.tmp` file. It is never served;
  the next start deletes it once it is an hour old.
- ETags are the SHA-256 of the whole file, read once per (device, inode, size, mtime) and
  remembered (4096 entries). A first listing of a big file is slow; fine for manuscripts (text), not for gigabytes.
- `LOCK`, `COPY`, `PROPPATCH` are not supported. Nextcloud clients that need them are not
  the target; Aurelia's own client does not use them.

## Consequences

- One more image to build, scan and publish; its CI is in `ci.yml` (typecheck + tests) and
  `image.yml` (build + smoke test, `deploy/smoke-store.sh`).
- `scripts/check-licenses.mjs` and `scripts/check-spdx.mjs` cover `server/`.
- The app image still starts when no store exists: nginx resolves the store's name per request,
  so `/dav/` answers 502 and the app works. The browser client treats that as "no server".
