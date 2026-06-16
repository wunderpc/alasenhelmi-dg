# Alasen Helmi — Disc Golf Scorebook

A simple scorebook web app for the **Alasen Helmi** disc golf course (6 holes, par 18, 278 m).

## Features

- **Nickname login** — no password, just pick a name to log scores
- **Scorecard** — tap +/− for each hole, save your round
- **Public leaderboard** — best score per player, plus recent rounds
- **Dark theme** — forest green palette inspired by the course

## Quick start

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

## Course layout

| Hole | Par | Distance |
|------|-----|----------|
| 1    | 3   | 38 m     |
| 2    | 3   | 40 m     |
| 3    | 3   | 67 m     |
| 4    | 3   | 45 m     |
| 5    | 3   | 59 m     |
| 6    | 3   | 39 m     |

Scores are stored in `scores.db` (SQLite) in the project folder.
