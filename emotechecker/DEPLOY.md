# Emote Checker — Deploy Guide

Two pieces to deploy:
1. **`worker.js`** — the Cloudflare Worker (does the authenticated Roblox fetching)
2. **`index.html`** — the page itself (goes on `l-xoxo.com/emotechecker/`)

The Worker is the part that makes animation similarity work. Without it, the page only shows emote stats.

---

## Part 1: Deploy the Cloudflare Worker (5 min)

### 1. Open Cloudflare Workers
Go to <https://dash.cloudflare.com>, sign in (use the same account your `l-xoxo.com` domain is on), then click **Workers & Pages** in the left sidebar.

### 2. Create the Worker
- Click **Create application** → **Create Worker**.
- Name it `lxoxo-proxy` (or anything you like — this becomes part of the URL).
- Click **Deploy**. Cloudflare creates a placeholder worker at `lxoxo-proxy.YOUR-ACCOUNT.workers.dev`.

### 3. Paste the code
- Click **Edit Code** on the Worker's page.
- **Delete everything** in the editor.
- Open `worker.js` from this folder, copy all of it, paste it into the editor.
- Click **Save and Deploy** (top right).

### 4. Add your Roblox cookie
- On the Worker's page, click **Settings** → **Variables and Secrets** → **Add variable**.
- **Variable name**: `ROBLOX_COOKIE`
- **Type**: **Secret** (important — hides the value)
- **Value**: your `.ROBLOSECURITY` cookie value (instructions below)
- Click **Deploy**.

#### How to get your `.ROBLOSECURITY` cookie
1. Open <https://www.roblox.com> in Chrome and make sure you're logged in.
2. Press **F12** → **Application** tab → **Cookies** → `https://www.roblox.com`.
3. Find the row named `.ROBLOSECURITY`.
4. **Value**: copy the entire string (it's long and starts with `_|WARNING:-DO-NOT-SHARE...`).
5. Paste that into the Worker's Secret value field.

> Keep this cookie secret. Anyone with it can log in as you on Roblox. It lives inside Cloudflare's secret storage and never touches your browser page code. If you ever suspect it leaked, log out of Roblox (that invalidates the cookie) and log back in to generate a new one, then update the Worker secret.

### 5. Restrict CORS to your site
- Same **Variables and Secrets** page → **Add variable**.
- **Variable name**: `ALLOWED_ORIGIN`
- **Type**: **Text** (not secret)
- **Value**: `https://l-xoxo.com,https://www.l-xoxo.com`
- Click **Deploy**.

### 6. Copy the Worker URL
At the top of the Worker's page, you'll see something like:
`https://lxoxo-proxy.YOUR-ACCOUNT.workers.dev`

Copy this URL. You'll need it in Part 2.

### 7. Test it
Open `https://lxoxo-proxy.YOUR-ACCOUNT.workers.dev/health` in your browser. You should see:
```json
{"ok": true, "hasCookie": true}
```
If `hasCookie` is `false`, your secret isn't set correctly. If the page doesn't load, the Worker isn't deployed.

---

## Part 2: Deploy the page

### 1. Drop the folder into your site
Copy this entire `emotechecker/` folder (containing `index.html` at least) into your site's repo at the root, so the path becomes:
```
your-site/
├── index.html           (existing homepage)
└── emotechecker/
    └── index.html       (this file)
```
Push / redeploy. The page is now live at `https://l-xoxo.com/emotechecker/`.

### 2. Point the page at your Worker
Open `https://l-xoxo.com/emotechecker/` in your browser. In the **Worker** panel on the right:
- Paste your Worker URL into the input (e.g. `https://lxoxo-proxy.YOUR-ACCOUNT.workers.dev`).
- Click **Save & Test**.

If the status pill turns green (`ready`), everything is wired up. Try entering an emote ID — it should fetch the animation, hash it, extract features, and (once you've indexed a few emotes) show similarity scores.

---

## Custom domain (optional)

If you want the Worker on a nicer URL like `proxy.l-xoxo.com` instead of `lxoxo-proxy.your-account.workers.dev`:

- Worker page → **Settings** → **Triggers** → **Add Custom Domain**.
- Enter `proxy.l-xoxo.com`.
- Cloudflare sets up the DNS automatically (since your domain is already on Cloudflare).
- Update the Worker URL in the page's Worker panel.

---

## Troubleshooting

**Worker panel shows `unreachable`**
- URL typo. It must start with `https://` and match the Worker's URL exactly (no trailing slash matters).
- Worker not deployed. Go back to Cloudflare and click Deploy again.

**Worker shows `no cookie`**
- Secret not saved, or saved under the wrong name. It must be exactly `ROBLOX_COOKIE`.
- Typed the cookie value with extra whitespace / quotes.

**Emote search fails with "Worker returned no animation bytes"**
- Your cookie expired. Roblox rotates cookies periodically. Log out + back in on roblox.com, grab a fresh `.ROBLOSECURITY`, update the secret, redeploy the Worker.
- The asset is genuinely private / deleted.

**CORS error in the browser console**
- `ALLOWED_ORIGIN` doesn't include the exact origin you're viewing from. If you're testing locally at `http://localhost:XXXX` or `file://`, temporarily set `ALLOWED_ORIGIN` to `*` to unblock, then lock it back down before going live.

**"Rate limited" or 429**
- Cloudflare free tier is 100k requests/day. You won't hit this for personal use.
- Roblox side also rate-limits — if you bulk-seed thousands of emotes in a burst, pause and retry.
