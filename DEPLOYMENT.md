# Publishing the app (one-time setup)

The app is a set of static files in the `docs/` folder. To be installable on phones, it must be served over **HTTPS**. The simplest free way is **GitHub Pages**, which uses the repository the app already lives in.

> **Why can't Claude publish it for you?** This build environment can push code to your repository, but it can't change repository settings. It also can't reach `github.io` to check a live site. The steps below take about five minutes in a web browser and need no coding.

## Option A: GitHub Pages (recommended, free)

GitHub Pages is free for **public** repositories. This repository is currently **private**, and Pages for private repositories requires a paid GitHub plan (Pro, Team or Enterprise).

Making the repository public is safe for this app. The code contains no passwords, keys or personal data. Everyone's financial data lives only on their own phone, never in the repository.

1. **Merge the code into `main`.** Open the pull request for branch `claude/dazzling-johnson-3yuvoj` on GitHub and click **Merge**. If no pull request exists, go to the repository page, click **Compare & pull request**, then **Create pull request**, then **Merge**.
2. **Make the repository public** (skip this if you have a paid plan):
   **Settings** → scroll to **Danger Zone** → **Change visibility** → **Make public** → confirm.
3. **Turn on GitHub Pages:**
   **Settings** → **Pages** (left menu) → under **Build and deployment** choose
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/docs** → **Save**.
4. Wait 1–2 minutes and refresh the Pages settings screen. It shows your link, for example:
   **`https://meerzabayg-cloud.github.io/Expense-Management/`**
5. Open that link on your phone and install it (see [USER_GUIDE.md](USER_GUIDE.md#2-installing-the-app-one-time-about-one-minute)).

That link is the one you share with family and friends.

## Option B: Netlify Drop (no GitHub settings, free)

1. Download the repository as a ZIP from GitHub (**Code** → **Download ZIP**) and unzip it.
2. Go to <https://app.netlify.com/drop> and create a free account.
3. Drag the **`docs`** folder onto the page.
4. Netlify gives you an HTTPS link such as `https://your-name.netlify.app`. You can rename it in **Site settings**.

To publish a new version later, drag the updated `docs` folder onto the same site again.

## Option C: Cloudflare Pages (free)

Connect the GitHub repository at <https://pages.cloudflare.com>. Set the framework preset to **None**, leave the build command empty, and set the output directory to **`docs`**.

## Ongoing costs

| Item | Cost |
|---|---|
| Hosting (GitHub Pages, Netlify or Cloudflare free tiers) | Free |
| Database, servers, OCR service | None needed |
| Custom domain (optional, e.g. `familybudget.ae`) | About USD 10–20/year from a domain registrar |

## Updating the app later

1. Change files in `docs/`.
2. In `docs/sw.js`, increase `VERSION` (for example `1.0.0` → `1.0.1`). This makes phones download the update.
3. Push or merge to `main`. GitHub Pages republishes automatically within about a minute.
4. The next time users open the app while online, they see **"A new version of the app is ready — Update now"**. Their data is not affected.

If you change the database structure, add a new migration in `docs/js/db.js` and increase `DB_VERSION`. Never edit an old migration.
