# Alasen Helmi — Disc Golf Scorebook

A simple scorebook web app for the **Alasen Helmi** disc golf course (6 holes, par 18, 278 m).

## Features

- **Nickname login** — no password, just pick a name to log scores
- **Scorecard** — tap +/− for each hole, save your round
- **Public leaderboard** — best score per player, plus recent rounds
- **Dark theme** — forest green palette inspired by the course

## Live website (GitHub Pages)

The app can run as a static site from this repository:

1. Push to GitHub (`main` or `master` branch).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. After the workflow runs, the site is available at:

   `https://<your-username>.github.io/alasenhelmi-dg/`

On GitHub Pages, scores are stored in your browser (localStorage). Everyone sees rounds listed in `public/data/scores.json` when that file is updated in the repo. To publish scores for all visitors, export or edit that JSON file and commit it.

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
