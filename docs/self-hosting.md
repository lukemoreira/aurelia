# Self-hosting Aurelia on TrueNAS

This guide puts Aurelia on your own TrueNAS SCALE server, as a custom app. Your
Cloudflare Tunnel makes it reachable from any device. Cloudflare protects it with a
login.

You need a Cloudflare Tunnel that already runs on the NAS. No tunnel yet? In the
Cloudflare dashboard, go to **Networking** → **Tunnels** → **Create a tunnel**, and
run it on the NAS as Cloudflare shows. Then come back here.

## 1. What you get

- A web address (for example `https://write.example.com`).
- A Cloudflare login page in front of it. Only your email can pass.
- No open port on your router. The tunnel connects out to Cloudflare.

**Your books stay in your browser.** The server only gives the app to the browser.
It never sees, keeps or backs up your writing.

- Each device has its own books. Your laptop and your phone do not share them.
- Cloud backup (planned, milestone M2b) will let you move books between devices.
  It is not ready yet.
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
   **Application Audience (AUD) Tag**. You need it in section 5.

## 3. Check the image

GitHub builds the Aurelia image each time the code on `main` changes:
`ghcr.io/lukemoreira/aurelia`. It is public, so TrueNAS downloads it without a login.
Nothing to do here.

## 4. Install on TrueNAS

1. In TrueNAS, go to **Apps** → **Discover Apps** → **⋮** (three dots) →
   **Install via YAML**.
2. Name: `aurelia`.
3. Paste the whole file [`deploy/truenas/compose.yaml`](../deploy/truenas/compose.yaml).
   It uses port `30080` on the NAS. If that port is taken, change `30080` in the
   pasted text, and use your number in section 5.
4. Save. Wait until the app shows **Running**.

**To update:** in TrueNAS, open **Apps**, open `aurelia`, and use **Update** or
**Pull images** (the name depends on your TrueNAS version), then restart the app.
Open Aurelia. It shows **Update available**: press **Reload**. If it shows
**Sign in again to get updates**, press **Sign in**, then look for **Update available**.

For a fixed version, use the image tag `ghcr.io/lukemoreira/aurelia:sha-<commit>`
instead of `latest`.

## 5. Add a route to your tunnel

1. In the Cloudflare dashboard, go to **Networking** → **Tunnels**. Open your tunnel.
2. On the **Routes** tab, select **Add route** → **Published application**:
   - Subdomain and domain: the same as in section 2 (for example `write` and
     `example.com`).
   - Service URL: `http://<NAS IP>:30080`. Use the address you type to open TrueNAS
     (for example `http://192.168.1.20:30080`).
3. Expand **Additional application settings** → **Access**. Turn on
   **Protect with Access**. Enter your **team name** (the part before
   `.cloudflareaccess.com` in the login page address) and the **AUD tag** from
   section 2. Now the tunnel refuses every request that has no valid Access login. If
   the Access application is deleted or set up wrong, the site stays closed.
4. Save.

## 6. Check these Cloudflare settings

In the Cloudflare dashboard, open your domain. Check:

1. **SSL/TLS** → **Edge Certificates** → **Always Use HTTPS**: **On**.
2. **Speed** → **Optimization** → **Content Optimization** → **Rocket Loader**: **Off**.
3. **Scrape Shield** → **Email Address Obfuscation**: **Off**.
4. **Web Analytics** (under **Analytics & Logs**): do not turn on automatic setup for
   this site.

These three features add scripts to the page. Aurelia's security policy blocks them,
so they would only break the page.

## 7. Security rules

- **Keep the Access policy to your own email only.**
- **Keep Protect with Access on** for the Aurelia route.
- **Never add a route to the TrueNAS web page.** Only Aurelia goes through the tunnel.
- **Never add a self-hosted GitHub runner to this repo.** The repo is public. A
  stranger could open a pull request and run code on your NAS. CI uses GitHub's own
  runners only.
- Your home network can open `http://<NAS IP>:30080` without a login. It shows only
  the app, never your books.

## 8. Check that it works

1. Open your `https://` address in a **private window**. You must see the Cloudflare
   login page, not Aurelia.
2. Type your email. Type the code from your email. Aurelia opens.
3. To install it as an app, use your browser's install option (in Chrome or Edge, the
   install icon in the address bar; on a phone, **Add to Home screen**).
4. In TrueNAS, the app `aurelia` shows as healthy.
