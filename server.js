const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const COURSE = {
  name: "Alasen Helmi",
  totalPar: 18,
  totalDistance: 278,
  holes: [
    { number: 1, par: 3, distance: 38, image: "/images/alasen-helmi-tee-sign-1.jpg" },
    { number: 2, par: 3, distance: 40, image: "/images/alasen-helmi-tee-sign-2.jpg" },
    { number: 3, par: 3, distance: 67, image: "/images/alasen-helmi-tee-sign-3.jpg" },
    { number: 4, par: 3, distance: 45, image: "/images/alasen-helmi-tee-sign-4.jpg" },
    { number: 5, par: 3, distance: 59, image: "/images/alasen-helmi-tee-sign-5.jpg" },
    { number: 6, par: 3, distance: 39, image: "/images/alasen-helmi-tee-sign-6.jpg" },
  ],
};

const db = new Database(path.join(__dirname, "scores.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT UNIQUE NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    scores TEXT NOT NULL,
    total_score INTEGER NOT NULL,
    score_to_par INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_rounds_user ON rounds(user_id);
  CREATE INDEX IF NOT EXISTS idx_rounds_total ON rounds(total_score);
`);

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "alasen-helmi-disc-golf",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, "public")));
app.use("/images", express.static(path.join(__dirname, "public", "images")));

app.get("/api/course", (_req, res) => {
  res.json(COURSE);
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.json({ loggedIn: false });
  }
  const user = db
    .prepare("SELECT id, nickname FROM users WHERE id = ?")
    .get(req.session.userId);
  res.json({ loggedIn: true, user });
});

app.post("/api/login", (req, res) => {
  const nickname = (req.body.nickname || "").trim();
  if (nickname.length < 2 || nickname.length > 24) {
    return res.status(400).json({ error: "Nickname must be 2–24 characters." });
  }
  if (!/^[a-zA-Z0-9_\-\säöåÄÖÅ]+$/.test(nickname)) {
    return res.status(400).json({ error: "Nickname contains invalid characters." });
  }

  let user = db
    .prepare("SELECT id, nickname FROM users WHERE nickname = ? COLLATE NOCASE")
    .get(nickname);

  if (!user) {
    const result = db.prepare("INSERT INTO users (nickname) VALUES (?)").run(nickname);
    user = { id: result.lastInsertRowid, nickname };
  }

  req.session.userId = user.id;
  res.json({ user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post("/api/rounds", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in first." });
  }

  const scores = req.body.scores;
  if (!Array.isArray(scores) || scores.length !== COURSE.holes.length) {
    return res.status(400).json({ error: "Invalid scores." });
  }

  for (const s of scores) {
    if (!Number.isInteger(s) || s < 1 || s > 15) {
      return res.status(400).json({ error: "Each hole score must be 1–15." });
    }
  }

  const totalScore = scores.reduce((a, b) => a + b, 0);
  const scoreToPar = totalScore - COURSE.totalPar;

  const result = db
    .prepare(
      "INSERT INTO rounds (user_id, scores, total_score, score_to_par) VALUES (?, ?, ?, ?)"
    )
    .run(req.session.userId, JSON.stringify(scores), totalScore, scoreToPar);

  res.json({
    id: result.lastInsertRowid,
    totalScore,
    scoreToPar,
    scores,
  });
});

app.get("/api/leaderboard", (_req, res) => {
  const bestRounds = db
    .prepare(
      `
    SELECT r.id, u.nickname, r.total_score, r.score_to_par, r.scores, r.created_at
    FROM rounds r
    JOIN users u ON u.id = r.user_id
    WHERE r.id IN (
      SELECT r2.id FROM rounds r2
      WHERE r2.user_id = r.user_id
      ORDER BY r2.total_score ASC, r2.created_at ASC
      LIMIT 1
    )
    ORDER BY r.total_score ASC, r.created_at ASC
  `
    )
    .all();

  const recentRounds = db
    .prepare(
      `
    SELECT r.id, u.nickname, r.total_score, r.score_to_par, r.created_at
    FROM rounds r
    JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC
    LIMIT 20
  `
    )
    .all();

  const stats = db
    .prepare(
      `
    SELECT
      COUNT(DISTINCT user_id) AS players,
      COUNT(*) AS rounds,
      MIN(total_score) AS course_record
    FROM rounds
  `
    )
    .get();

  res.json({ bestRounds, recentRounds, stats });
});

app.get("/api/my-rounds", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in." });
  }

  const rounds = db
    .prepare(
      `
    SELECT id, scores, total_score, score_to_par, created_at
    FROM rounds
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `
    )
    .all(req.session.userId)
    .map((r) => ({ ...r, scores: JSON.parse(r.scores) }));

  res.json({ rounds });
});

app.listen(PORT, () => {
  console.log(`Alasen Helmi scorebook running at http://localhost:${PORT}`);
});
