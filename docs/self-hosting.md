# Self-hosting Aurelia on TrueNAS

This guide puts Aurelia on your own TrueNAS SCALE server, as a custom app. Your
Cloudflare Tunnel makes it reachable from any device. Cloudflare protects it with a
login. A second container, the storage server, keeps a backup of your books on the NAS.

You need a Cloudflare Tunnel that already runs on the NAS. No tunnel yet? In the
Cloudflare dashboard, go to **Networking** → **Tunnels** → **Create a tunnel**, and
run it on the NAS as Cloudflare shows. Then come back here.

## 1. What you get

- A web address (for example `https://write.example.com`).
- A Cloudflare login page in front of it. Only your email can pass.
- No open port on your router. The tunnel connects out to Cloudflare.
- A storage server on the NAS. Your books can be backed up to a dataset there. ZFS
  snapshots of the dataset keep older copies.

**Your books live in your browser first.** The app works offline, with no account.
The storage server is a backup: it holds a copy, and it does not run your writing.

- Each device has its own books. The backup lets you copy books between devices.
- The storage server has no port of its own. You reach it only through the app's
  address, at `/dav/`. It refuses every request that has no valid Cloudflare login,
  also on your home network.
- Right now, version 0.1 shows the sample book only.

**Always open the `https://` address.** The NAS address (`http://<NAS IP>:30080`) is
for the tunnel only. On that address the browser cannot keep books or work offline,
and books saved on one address do not show on the other.

## 2. Create the Access application first

Do this first. Then the site is never open without the login.

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com). Go to **Zero Trust**.
2. Go to **Access controls** → **Applications** → **Create new application** →
   **Self-hosted and private**.
3. Application name: `Aurelia`. Session duration: `1 week` (shorter is safer; longer
   means fewer logins).
4. Select **Add public hostname**. Choose your domain and a name such as `write`
   (for example `write.example.com`).
5. Add a policy. Name: `Owner`. Action: **Allow**. Under **Include**, choose
   **Emails** and type your email address. Add no other rule.
6. Under login methods, select **One-time PIN**. Cloudflare emails you a code each time.
7. Save the application.
8. Edit the application again. Open **Advanced settings** → **Cookie settings**. Leave
   **HTTP Only** on (it is on by default). Turn on **Binding Cookie**. Save.
9. Edit the application again. In **Additional settings**, copy the
   **Application Audience (AUD) Tag**. You need it in sections 4 and 6.
10. Write down your **team domain**: the address of the Cloudflare login page, for
    example `myteam.cloudflareaccess.com`. It is also in **Zero Trust** →
    **Settings** → **Custom pages**. You need it in sections 4 and 6.

## 3. Check the images

GitHub builds two images each time the code on `main` changes. Both are public, so
TrueNAS downloads them without a login. Nothing to do here.

- `ghcr.io/lukemoreira/aurelia`: the app.
- `ghcr.io/lukemoreira/aurelia-store`: the storage server.

## 4. Back up to your NAS: the dataset and the two values

The storage server writes your books into a dataset. You need a dataset and two values.

1. In TrueNAS, go to **Datasets** and create a dataset for the books. This guide uses
   `MainPool/aurelia-books`. Its path on the NAS is `/mnt/MainPool/aurelia-books`.
2. Give the `apps` user (uid `568`) the **Modify** permission on that dataset. The
   storage server runs as that user. Open the dataset, then **Permissions** → **Edit**.
3. Add snapshots. Go to **Data Protection** → **Periodic Snapshot Tasks** → **Add**.
   Choose the dataset. Run it **hourly**. Keep the snapshots for **2 weeks**. Leave
   **Allow taking empty snapshots** off. A snapshot is a second layer: if a book is
   deleted by mistake, you can get it back from an older snapshot.
4. Have these two values ready. You find both in the Cloudflare dashboard:

   | Value                    | Where                                                                    |
   | ------------------------ | ------------------------------------------------------------------------ |
   | `CF_ACCESS_TEAM_DOMAIN`  | Your team domain, for example `myteam.cloudflareaccess.com` (section 2). |
   | `CF_ACCESS_AUD`          | **Zero Trust** → **Access controls** → **Applications** → **Aurelia** → **Edit** → **Additional settings** → **Application Audience (AUD) Tag**. |

   The storage server needs both. Without them, it does not start. It uses them to check
   that each request carries a login from your Cloudflare team, for the Aurelia
   application only.

## 5. Install on TrueNAS

1. In TrueNAS, go to **Apps** → **Discover Apps** → **⋮** (three dots) →
   **Install via YAML**.
2. Name: `aurelia`.
3. Paste the whole file [`deploy/truenas/compose.yaml`](../deploy/truenas/compose.yaml).
4. Find the two lines that start with `CF_ACCESS_`. Replace the whole `${…}` text on
   each line with your value from section 4. For example:
   `CF_ACCESS_TEAM_DOMAIN: myteam.cloudflareaccess.com`.
5. If your dataset has another path, change `/mnt/MainPool/aurelia-books` in the
   `volumes` line.
6. The app uses port `30080` on the NAS. If that port is taken, change `30080` in the
   pasted text, and use your number in section 6.
7. Save. Wait until both containers show **Running**.

**To update:**

1. In TrueNAS, go to **Apps**. Open `aurelia`.
2. Select **Edit**. Select **Save**. Change nothing.

TrueNAS pulls the newest images, because the file says `pull_policy: always`, and
restarts both containers. The **Update** button of TrueNAS stays grey for this app. This
is normal.

Open Aurelia. It shows **Update available**: press **Reload**. If it shows
**Sign in again to get updates**, press **Sign in**, then look for **Update available**.

For a fixed version, use the image tag `sha-<commit>` instead of `latest`, on both
images.

## 6. Add a route to your tunnel

1. In the Cloudflare dashboard, go to **Networking** → **Tunnels**. Open your tunnel.
2. On the **Routes** tab, select **Add route** → **Published application**:
   - Subdomain and domain: the same as in section 2 (for example `write` and
     `example.com`).
   - Service URL: `http://<NAS IP>:30080`. Use the address you type to open TrueNAS
     (for example `http://192.168.1.20:30080`).
3. Expand **Additional application settings** → **Access**. Turn on
   **Protect with Access**. Enter your **team name** (the part before
   `.cloudflareaccess.com` in your team domain) and the **AUD tag** from
   section 2. Now the tunnel refuses every request that has no valid Access login. If
   the Access application is deleted or set up wrong, the site stays closed.
4. Save.

## 7. Check these Cloudflare settings

In the Cloudflare dashboard, open your domain. Check:

1. **SSL/TLS** → **Edge Certificates** → **Always Use HTTPS**: **On**.
2. **Speed** → **Optimization** → **Content Optimization** → **Rocket Loader**: **Off**.
3. **Scrape Shield** → **Email Address Obfuscation**: **Off**.
4. **Web Analytics** (under **Analytics & Logs**): do not turn on automatic setup for
   this site.

These three features add scripts to the page. Aurelia's security policy blocks them,
so they would only break the page.

## 8. Security rules

- **Keep the Access policy to your own email only.**
- **Keep Protect with Access on** for the Aurelia route.
- **Never add a route to the TrueNAS web page.** Only Aurelia goes through the tunnel.
- **Never publish a port for the storage server.** In the YAML it has no `ports`. Keep it so.
- **Never add a self-hosted GitHub runner to this repo.** The repo is public. A
  stranger could open a pull request and run code on your NAS. CI uses GitHub's own
  runners only.
- Your home network can open `http://<NAS IP>:30080`. It sees the app. For `/dav/`
  (your books) it must give a login: the storage server answers `401` without one.

## 9. Check that it works

1. Open your `https://` address in a **private window**. You must see the Cloudflare
   login page, not Aurelia.
2. Type your email. Type the code from your email. Aurelia opens.
3. To install it as an app, use your browser's install option (in Chrome or Edge, the
   install icon in the address bar; on a phone, **Add to Home screen**).
4. In TrueNAS, the apps `aurelia` and `aurelia-store` show as healthy.
5. In Aurelia, open the **Backup** screen. **Your server** must show as connected.
6. Check that the storage server refuses a request without a login. On a computer in your
   home network, run (use your NAS address):

   ```
   curl -i http://<NAS IP>:30080/dav/
   ```

   The first line must be `HTTP/1.1 401 Unauthorized`. If you see `502`, the storage
   server does not run: look at its logs in TrueNAS. If you see `200` or `207`, stop:
   the login check is off. Do not use the backup. Check that the YAML has no
   `AURELIA_STORE_INSECURE_NO_AUTH` line.
7. After the first backup, look in `/mnt/MainPool/aurelia-books` on the NAS. Your book
   folders are there, and your next snapshot includes them.

## 10. The assistant (optional)

The assistant reads your story and suggests changes, fixes and new text. It runs Claude Code, and each
person signs in to Claude Code with **their own Claude account**, through Claude Code's own sign-in.
Nobody's plan is used for anybody else. It can only read and suggest. Every suggestion waits until you accept it, and
accepting saves a snapshot first. See [ADR-0015](adr/0015-assistant-on-your-server.md).

The third container, `aurelia-agent`, runs Anthropic's own program, Claude Code, for each person. It is
not inside Aurelia's image: on its first start, the container downloads and installs it with
Anthropic's installer, into its own dataset.

**You need:** a Claude Pro or Max plan (or an Anthropic Console account), and sync turned on for the
workspace (the assistant reads the copy on your server).

1. In TrueNAS, create a second dataset, for example `MainPool/aurelia-assistant`. Give the `apps`
   user (uid `568`) the **Modify** permission on it, as in section 4. It holds Claude Code and each
   person's own Claude sign-in. Do **not** use the books dataset, and do not share this dataset over
   SMB or NFS.
2. In **Apps** → `aurelia` → **Edit**, make sure the YAML has the `aurelia-agent` service from
   [`deploy/truenas/compose.yaml`](../deploy/truenas/compose.yaml), with your two `CF_ACCESS_` values
   (the same as the storage server) and your dataset path. **Put no token or API key in the YAML**: the
   assistant ignores them. Save.
3. Wait until `aurelia-agent` shows **Running**. The first start installs Claude Code; it needs to reach
   `claude.ai` and `downloads.claude.ai`. Its log says `Claude Code … installed`.
4. In Aurelia, open a scene. In the inspector on the right, open the **Assistant** tab (or press the
   command palette and type **Ask the assistant**).
5. Under **Claude Code on this server**, select **Start Claude Code sign-in**. Claude Code shows a link.
   Open it, sign in with your own Claude account, and copy the code that page gives you. Paste it into
   **Code for Claude Code** and select **Send code**. (With an Anthropic Console account, select
   **Start Claude Code sign-in (Anthropic Console)** instead.)
6. Ask something, for example "Check Tomas's continuity in chapter 7". The tab lists what the assistant
   read. Its suggestions appear in the **Review inbox** below the chat and inside the text, each with
   **Accept**, **Reject** and **Ask for changes**.

**To sign out:** **Sign out of Claude Code** in the Assistant tab runs Claude Code's own logout.

**Each person signs in alone.** Aurelia tells people apart by their Cloudflare login email. Someone else
you let in sees the **Start Claude Code sign-in** step and uses their own account. Claude Code keeps each
person's sign-in in a folder of their own in the assistant's dataset. Aurelia's code does not read, log
or send it, but **the server's owner can read that folder**: let in only people who accept that.

**Check it:** on a computer in your home network, run `curl -i http://<NAS IP>:30080/agent/status`. The
first line must be `HTTP/1.1 401 Unauthorized`. `502` means the assistant does not run.

**To change the Claude Code version:** the image sets `CLAUDE_CODE_VERSION`. A newer Aurelia image may
raise it; the container then installs that version on its next start. Claude Code does not update
itself here.

### Use the same tools from Claude Code on your own computer

You can also talk about your book in Claude Code on your own computer. Claude Code then starts the
assistant's tools on that computer. They read your book from your server and write suggestions to
your **Review inbox**, as the Assistant tab does. They cannot change the book: you accept each
suggestion in Aurelia.

**It works on your home network only.** The tools go straight to the NAS address, not through
Cloudflare. Cloudflare refuses them while **Binding Cookie** is on (section 2, step 8), because that
setting accepts only your browser. Keep it on.

**You need:** Claude Code, Docker, and Cloudflare's `cloudflared` tool on the computer, and sync turned
on for the workspace.

1. Sign in once, as you:
   `cloudflared access login https://aurelia.example.com`
   A browser tab opens. Sign in there. If the sign-in never finishes in Safari, open the same link in
   another browser. The tool can then show `failed to verify token`. That is expected: it checks the
   sign-in through Cloudflare, and the Binding Cookie refuses it there. The sign-in is saved and works
   on your home network. Do this again when it ends, after about a day.
2. Find the workspace folder on your server. It is under the books dataset, in `Aurelia/`, with a name
   like `My book (wsp_…)`.
3. Make a folder for the book on your computer. In it, put this `.mcp.json`. Change the two addresses and
   the folder name:

   ```json
   {
     "mcpServers": {
       "aurelia": {
         "type": "stdio",
         "command": "sh",
         "args": [
           "-c",
           "AURELIA_ACCESS_JWT=\"$(cloudflared access token -app=https://aurelia.example.com)\" || exit 1; export AURELIA_ACCESS_JWT; exec docker run -i --rm --platform linux/amd64 -e AURELIA_ACCESS_JWT -e AURELIA_STORE_URL=http://<NAS IP>:30080/dav/ -e 'AURELIA_FOLDER=Aurelia/My book (wsp_…)' ghcr.io/lukemoreira/aurelia-agent:latest node --import ./server/agent/src/register.ts server/agent/src/mcp.ts"
         ]
       }
     }
   }
   ```

   The image is built for `linux/amd64`. `--platform linux/amd64` lets a Mac with Apple silicon run it
   through Docker's emulation.

4. Start Claude Code in that folder and allow the `aurelia` server. Ask, for example, "Read the
   outline and tell me what chapter 3 is missing".

The sign-in token comes from `cloudflared` each time Claude Code starts the tools. It is not in the
file. The storage server checks it as it checks the app's. When your Cloudflare session ends, run
step 1 again. The NAS address is plain HTTP, so the token crosses your home network unencrypted, as
the app's does on that address: use it only on a network you trust. Claude Code on your computer also
has its own tools: they can change files on your computer, not your book.
