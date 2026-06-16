import { getStore } from "@netlify/blobs";
import { randomBytes } from "crypto";

const STORE_NAME = "alasen-helmi";
const DB_KEY = "db";

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

const ADMIN_USER = "Jone";
const ADMIN_PASS = "admin123";
const NICKNAME_RE = /^[a-zA-Z0-9_\-\säöåÄÖÅ]+$/;

function emptyDb() {
  return {
    users: [],
    rounds: [],
    nextUserId: 1,
    nextRoundId: 1,
    sessions: {},
    adminSessions: [],
  };
}

function getStoreInstance() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

async function loadDb() {
  const store = getStoreInstance();
  const existing = await store.get(DB_KEY, { type: "json" });
  if (existing) return existing;

  let db = emptyDb();
  const siteUrl = process.env.URL || process.env.DEPLOY_URL;
  if (siteUrl) {
    try {
      const res = await fetch(`${siteUrl}/data/scores.json`);
      if (res.ok) {
        const seed = await res.json();
        db = mergeSeed(db, seed);
      }
    } catch {
      /* optional seed file */
    }
  }

  await store.setJSON(DB_KEY, db);
  return db;
}

async function saveDb(db) {
  const store = getStoreInstance();
  await store.setJSON(DB_KEY, db);
}

function mergeSeed(db, seed) {
  const users = seed.users || [];
  const rounds = (seed.rounds || []).map((r) => ({
    ...r,
    scores: typeof r.scores === "string" ? JSON.parse(r.scores) : r.scores,
  }));

  let nextUserId = 1;
  let nextRoundId = 1;
  const userMap = new Map();

  for (const u of users) {
    const id = u.id ?? nextUserId++;
    userMap.set(u.nickname.toLowerCase(), id);
    db.users.push({ id, nickname: u.nickname, created_at: u.created_at || nowIso() });
    nextUserId = Math.max(nextUserId, id + 1);
  }

  for (const r of rounds) {
    const id = r.id ?? nextRoundId++;
    let userId = r.user_id;
    if (!userId && r.nickname) {
      const key = r.nickname.toLowerCase();
      if (!userMap.has(key)) {
        userId = nextUserId++;
        userMap.set(key, userId);
        db.users.push({ id: userId, nickname: r.nickname, created_at: r.created_at || nowIso() });
      } else {
        userId = userMap.get(key);
      }
    }
    db.rounds.push({
      id,
      user_id: userId,
      scores: r.scores,
      total_score: r.total_score,
      score_to_par: r.score_to_par,
      created_at: r.created_at || nowIso(),
    });
    nextRoundId = Math.max(nextRoundId, id + 1);
  }

  db.nextUserId = nextUserId;
  db.nextRoundId = nextRoundId;
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    cookies[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return cookies;
}

function cookieHeader(name, value, maxAge) {
  if (!value) {
    return `${name}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`;
  }
  return `${name}=${value}; Path=/; HttpOnly; Max-Age=${maxAge}; SameSite=Lax`;
}

function json(data, status = 200, setCookies = []) {
  const headers = { "Content-Type": "application/json" };
  const multiValueHeaders = {};
  if (setCookies.length) multiValueHeaders["Set-Cookie"] = setCookies;
  return {
    statusCode: status,
    headers,
    multiValueHeaders,
    body: JSON.stringify(data),
  };
}

function resolveApiPath(event) {
  if (event.rawUrl) {
    try {
      return new URL(event.rawUrl).pathname;
    } catch {
      /* fall through */
    }
  }

  let path = event.path || "";
  const fnPrefix = "/.netlify/functions/api";
  if (path.startsWith(fnPrefix)) {
    path = "/api" + path.slice(fnPrefix.length);
  }
  if (!path.startsWith("/api")) {
    path = "/api/" + path.replace(/^\/+/, "");
  }
  return path;
}

function readBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function findUser(users, nickname) {
  const lower = nickname.toLowerCase();
  return users.find((u) => u.nickname.toLowerCase() === lower);
}

function userById(db, id) {
  return db.users.find((u) => u.id === id);
}

function sessionUserId(db, cookies) {
  const sid = cookies.session;
  if (!sid) return null;
  return db.sessions[sid] ?? null;
}

function isAdmin(db, cookies) {
  const sid = cookies.admin_session;
  return sid && db.adminSessions.includes(sid);
}

function newSessionId() {
  return randomBytes(24).toString("hex");
}

function bestRounds(db) {
  const bestByUser = new Map();
  for (const r of db.rounds) {
    const prev = bestByUser.get(r.user_id);
    if (
      !prev ||
      r.total_score < prev.total_score ||
      (r.total_score === prev.total_score && r.created_at < prev.created_at)
    ) {
      bestByUser.set(r.user_id, r);
    }
  }
  return [...bestByUser.values()].sort(
    (a, b) => a.total_score - b.total_score || a.created_at.localeCompare(b.created_at)
  );
}

function roundWithNickname(db, round) {
  const user = userById(db, round.user_id);
  return {
    id: round.id,
    user_id: round.user_id,
    nickname: user?.nickname || "?",
    scores: round.scores,
    total_score: round.total_score,
    score_to_par: round.score_to_par,
    created_at: round.created_at,
  };
}

export async function handler(event) {
  const method = event.httpMethod;
  const path = resolveApiPath(event);
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
  const body = readBody(event);
  const setCookies = [];

  try {
    const db = await loadDb();

    if (method === "GET" && path === "/api/course") {
      return json(COURSE);
    }

    if (method === "GET" && path === "/api/me") {
      const userId = sessionUserId(db, cookies);
      const admin = isAdmin(db, cookies);
      if (!userId) return json({ loggedIn: false, isAdmin: admin });
      const user = userById(db, userId);
      if (!user) return json({ loggedIn: false, isAdmin: admin });
      return json({ loggedIn: true, user: { id: user.id, nickname: user.nickname }, isAdmin: admin });
    }

    if (method === "GET" && path === "/api/admin/me") {
      return json({ loggedIn: isAdmin(db, cookies) });
    }

    if (method === "GET" && path === "/api/leaderboard") {
      const best = bestRounds(db).map((r) => roundWithNickname(db, r));
      const recent = [...db.rounds]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 20)
        .map((r) => roundWithNickname(db, r));

      const playerIds = new Set(db.rounds.map((r) => r.user_id));
      const courseRecord =
        db.rounds.length > 0 ? Math.min(...db.rounds.map((r) => r.total_score)) : null;

      return json({
        bestRounds: best,
        recentRounds: recent,
        stats: {
          players: playerIds.size,
          rounds: db.rounds.length,
          course_record: courseRecord,
        },
      });
    }

    if (method === "GET" && path === "/api/my-rounds") {
      const userId = sessionUserId(db, cookies);
      if (!userId) return json({ error: "Et ole kirjautunut." }, 401);
      const rounds = db.rounds
        .filter((r) => r.user_id === userId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 20)
        .map((r) => ({
          id: r.id,
          scores: r.scores,
          total_score: r.total_score,
          score_to_par: r.score_to_par,
          created_at: r.created_at,
        }));
      return json({ rounds });
    }

    const roundDetailMatch = path.match(/^\/api\/rounds\/(\d+)$/);
    if (method === "GET" && roundDetailMatch) {
      const roundId = parseInt(roundDetailMatch[1], 10);
      const round = db.rounds.find((r) => r.id === roundId);
      if (!round) return json({ error: "Kierrosta ei löytynyt." }, 404);
      return json({ round: roundWithNickname(db, round) });
    }

    if (method === "POST" && path === "/api/login") {
      const nickname = (body.nickname || "").trim();
      if (nickname.length < 2 || nickname.length > 24) {
        return json({ error: "Nimimerkin pituus 2–24 merkkiä." }, 400);
      }
      if (!NICKNAME_RE.test(nickname)) {
        return json({ error: "Nimimerkki sisältää kiellettyjä merkkejä." }, 400);
      }

      let user = findUser(db.users, nickname);
      if (!user) {
        user = { id: db.nextUserId++, nickname, created_at: nowIso() };
        db.users.push(user);
      }

      const sid = newSessionId();
      db.sessions[sid] = user.id;
      await saveDb(db);
      setCookies.push(cookieHeader("session", sid, 30 * 24 * 60 * 60));
      return json({ user: { id: user.id, nickname: user.nickname } }, 200, setCookies);
    }

    if (method === "POST" && path === "/api/logout") {
      const sid = cookies.session;
      if (sid) delete db.sessions[sid];
      await saveDb(db);
      setCookies.push(cookieHeader("session", "", 0));
      return json({ ok: true }, 200, setCookies);
    }

    if (method === "POST" && path === "/api/admin/login") {
      const username = (body.username || "").trim();
      const password = body.password || "";
      if (username !== ADMIN_USER || password !== ADMIN_PASS) {
        return json({ error: "Virheellinen käyttäjätunnus tai salasana." }, 401);
      }
      const sid = newSessionId();
      db.adminSessions.push(sid);
      await saveDb(db);
      setCookies.push(cookieHeader("admin_session", sid, 24 * 60 * 60));
      return json({ ok: true }, 200, setCookies);
    }

    if (method === "POST" && path === "/api/admin/logout") {
      const sid = cookies.admin_session;
      if (sid) db.adminSessions = db.adminSessions.filter((s) => s !== sid);
      await saveDb(db);
      setCookies.push(cookieHeader("admin_session", "", 0));
      return json({ ok: true }, 200, setCookies);
    }

    if (method === "POST" && path === "/api/rounds") {
      const userId = sessionUserId(db, cookies);
      if (!userId) return json({ error: "Kirjaudu ensin sisään." }, 401);

      const scores = body.scores;
      if (!Array.isArray(scores) || scores.length !== COURSE.holes.length) {
        return json({ error: "Virheelliset tulokset." }, 400);
      }
      for (const s of scores) {
        if (!Number.isInteger(s) || s < 1 || s > 15) {
          return json({ error: "Väylän tuloksen pitää olla 1–15." }, 400);
        }
      }

      const totalScore = scores.reduce((a, b) => a + b, 0);
      const scoreToPar = totalScore - COURSE.totalPar;
      const round = {
        id: db.nextRoundId++,
        user_id: userId,
        scores,
        total_score: totalScore,
        score_to_par: scoreToPar,
        created_at: nowIso(),
      };
      db.rounds.push(round);
      await saveDb(db);

      return json({
        id: round.id,
        totalScore,
        scoreToPar,
        scores,
      });
    }

    if (method === "DELETE") {
      if (!isAdmin(db, cookies)) {
        return json({ error: "Admin access required." }, 403);
      }

      if (path === "/api/admin/rounds") {
        db.rounds = [];
        await saveDb(db);
        return json({ ok: true });
      }

      const adminDeleteMatch = path.match(/^\/api\/admin\/rounds\/(\d+)$/);
      if (adminDeleteMatch) {
        const roundId = parseInt(adminDeleteMatch[1], 10);
        const idx = db.rounds.findIndex((r) => r.id === roundId);
        if (idx === -1) return json({ error: "Kierrosta ei löytynyt." }, 404);
        db.rounds.splice(idx, 1);
        await saveDb(db);
        return json({ ok: true });
      }
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("API error:", err);
    return json({ error: "Server error" }, 500);
  }
}
