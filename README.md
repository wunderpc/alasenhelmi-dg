# Alasen Helmi — Disc Golf Scorebook

A simple scorebook web app for the **Alasen Helmi** disc golf course (6 holes, par 18, 278 m).

## Features

- **Nickname login** — no password, just pick a name to log scores
- **Scorecard** — tap +/− for each hole, save your round
- **Public leaderboard** — best score per player, plus recent rounds
- **Dark theme** — forest green palette inspired by the course

## Hosting on Netlify

1. Connect this GitHub repo in [Netlify](https://app.netlify.com/).
2. Build settings (also in `netlify.toml`):
   - **Build command:** `npm install`
   - **Publish directory:** `public`
3. Deploy.

Scores are saved to **Netlify Blobs** (shared for all visitors). Each saved round appears on the public leaderboard immediately.

### Optional: publish scores to GitHub

To also write scores into `public/data/scores.json` in the repo (visible on GitHub and GitHub Pages):

1. Create a [GitHub personal access token](https://github.com/settings/tokens) with **Contents: Read and write** on this repo.
2. In Netlify → **Site configuration → Environment variables**, add:
   - `GITHUB_TOKEN` = your token

After each save, the function updates `public/data/scores.json` in the repo.

## Hosting on GitHub Pages

1. Push to the `main` branch.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose branch **`gh-pages`**, folder **`/ (root)`**.
5. The workflow `.github/workflows/deploy-pages.yml` updates `gh-pages` on each push to `main`.

Site URL: `https://<username>.github.io/alasenhelmi-dg/`

## Local development

**Python (recommended — no install needed):**

```bash
python server.py
```

**Node.js (alternative):**

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

With a local server, scores are stored in `scores.db` (SQLite) and shared across all users on that server.

## Course layout

| Hole | Par | Distance |
|------|-----|----------|
| 1    | 3   | 38 m     |
| 2    | 3   | 40 m     |
| 3    | 3   | 67 m     |
| 4    | 3   | 45 m     |
| 5    | 3   | 59 m     |
| 6    | 3   | 39 m     |
