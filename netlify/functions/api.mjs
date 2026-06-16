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

function cookieLine(name, value, maxAge) {
  if (!value) {
    return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  }
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function jsonResponse(data, status = 200, setCookies = []) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const c of setCookies) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(data), { status, headers });
}

async function readJson(req) {
  try {
    return await req.json();
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

function mergeSeed(db, seed) {
  const users = seed.users || [];
  const rounds = (seed.rounds || []).map((r) => ({
    ...r,
    scores: typeof r.scores === "string" ? JSON.parse(r.scores) : r.scores,
  }));

  let nextUserId = db.nextUserId;
  let nextRoundId = db.nextRoundId;
  const userMap = new Map(db.users.map((u) => [u.nickname.toLowerCase(), u.id]));

  for (const u of users) {
    const key = u.nickname.toLowerCase();
    if (userMap.has(key)) continue;
    const id = u.id ?? nextUserId++;
    userMap.set(key, id);
    db.users.push({ id, nickname: u.nickname, created_at: u.created_at || nowIso() });
    nextUserId = Math.max(nextUserId, id + 1);
  }

  const existingRoundIds = new Set(db.rounds.map((r) => r.id));

  for (const r of rounds) {
    const id = r.id ?? nextRoundId++;
    if (existingRoundIds.has(id)) continue;

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
    existingRoundIds.add(id);
    nextRoundId = Math.max(nextRoundId, id + 1);
  }

  db.nextUserId = nextUserId;
  db.nextRoundId = nextRoundId;
  return db;
}

async function loadDb(store, siteUrl) {
  const existing = await store.get(DB_KEY, { type: "json" });
  if (existing) return existing;

  let db = emptyDb();
  if (siteUrl) {
    try {
      const res = await fetch(`${siteUrl}/data/scores.json`);
      if (res.ok) {
        db = mergeSeed(db, await res.json());
      }
    } catch {
      /* optional seed */
    }
  }

  await store.setJSON(DB_KEY, db);
  return db;
}

async function saveDb(store, db) {
  await store.setJSON(DB_KEY, db);
}

function exportScoresJson(db) {
  return {
    users: db.users.map((u) => ({
      id: u.id,
      nickname: u.nickname,
      created_at: u.created_at,
    })),
    rounds: db.rounds.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      scores: r.scores,
      total_score: r.total_score,
      score_to_par: r.score_to_par,
      created_at: r.created_at,
    })),
  };
}

async function publishToGitHub(db) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  const repo = process.env.GITHUB_REPOSITORY || "wunderpc/alasenhelmi-dg";
  const filePath = "public/data/scores.json";
  const payload = exportScoresJson(db);
  const content = Buffer.from(JSON.stringify(payload, null, 2)).toString("base64");

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  let sha;
  const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers });
  if (getRes.ok) {
    const file = await getRes.json();
    sha = file.sha;
  }

  await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: "Update published scores",
      content,
      sha,
    }),
  });
}

async function persistDb(store, db, siteUrl) {
  await saveDb(store, db);
  try {
    await publishToGitHub(db);
  } catch (err) {
    console.warn("GitHub publish skipped:", err.message);
  }
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

function roundFingerprint(round) {
  return `${round.user_id}:${round.total_score}:${JSON.stringify(round.scores)}:${round.created_at}`;
}

async function handleRequest(req, siteUrl) {
  const store = getStore(STORE_NAME);
  const method = req.method;
  const path = new URL(req.url).pathname;
  const cookies = parseCookies(req.headers.get("cookie") || "");
  const body = method === "GET" || method === "DELETE" ? {} : await readJson(req);
  const setCookies = [];

  let db = await loadDb(store, siteUrl);

  if (method === "GET" && path === "/api/course") {
    return jsonResponse(COURSE);
  }

  if (method === "GET" && path === "/api/me") {
    const userId = sessionUserId(db, cookies);
    const admin = isAdmin(db, cookies);
    if (!userId) return jsonResponse({ loggedIn: false, isAdmin: admin });
    const user = userById(db, userId);
    if (!user) return jsonResponse({ loggedIn: false, isAdmin: admin });
    return jsonResponse({
      loggedIn: true,
      user: { id: user.id, nickname: user.nickname },
      isAdmin: admin,
    });
  }

  if (method === "GET" && path === "/api/admin/me") {
    return jsonResponse({ loggedIn: isAdmin(db, cookies) });
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

    return jsonResponse({
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
    if (!userId) return jsonResponse({ error: "Et ole kirjautunut." }, 401);
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
    return jsonResponse({ rounds });
  }

  const roundDetailMatch = path.match(/^\/api\/rounds\/(\d+)$/);
  if (method === "GET" && roundDetailMatch) {
    const roundId = parseInt(roundDetailMatch[1], 10);
    const round = db.rounds.find((r) => r.id === roundId);
    if (!round) return jsonResponse({ error: "Kierrosta ei löytynyt." }, 404);
    return jsonResponse({ round: roundWithNickname(db, round) });
  }

  if (method === "POST" && path === "/api/login") {
    const nickname = (body.nickname || "").trim();
    if (nickname.length < 2 || nickname.length > 24) {
      return jsonResponse({ error: "Nimimerkin pituus 2–24 merkkiä." }, 400);
    }
    if (!NICKNAME_RE.test(nickname)) {
      return jsonResponse({ error: "Nimimerkki sisältää kiellettyjä merkkejä." }, 400);
    }

    let user = findUser(db.users, nickname);
    if (!user) {
      user = { id: db.nextUserId++, nickname, created_at: nowIso() };
      db.users.push(user);
    }

    const sid = newSessionId();
    db.sessions[sid] = user.id;
    await persistDb(store, db, siteUrl);
    setCookies.push(cookieLine("session", sid, 30 * 24 * 60 * 60));
    return jsonResponse({ user: { id: user.id, nickname: user.nickname } }, 200, setCookies);
  }

  if (method === "POST" && path === "/api/logout") {
    const sid = cookies.session;
    if (sid) delete db.sessions[sid];
    await persistDb(store, db, siteUrl);
    setCookies.push(cookieLine("session", "", 0));
    return jsonResponse({ ok: true }, 200, setCookies);
  }

  if (method === "POST" && path === "/api/admin/login") {
    const username = (body.username || "").trim();
    const password = body.password || "";
    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      return jsonResponse({ error: "Virheellinen käyttäjätunnus tai salasana." }, 401);
    }
    const sid = newSessionId();
    db.adminSessions.push(sid);
    await persistDb(store, db, siteUrl);
    setCookies.push(cookieLine("admin_session", sid, 24 * 60 * 60));
    return jsonResponse({ ok: true }, 200, setCookies);
  }

  if (method === "POST" && path === "/api/admin/logout") {
    const sid = cookies.admin_session;
    if (sid) db.adminSessions = db.adminSessions.filter((s) => s !== sid);
    await persistDb(store, db, siteUrl);
    setCookies.push(cookieLine("admin_session", "", 0));
    return jsonResponse({ ok: true }, 200, setCookies);
  }

  if (method === "POST" && path === "/api/migrate") {
    const userId = sessionUserId(db, cookies);
    if (!userId) return jsonResponse({ error: "Kirjaudu ensin sisään." }, 401);

    const localRounds = body.rounds || [];
    const localSessionId = body.sessionUserId;
    const existing = new Set(db.rounds.map(roundFingerprint));
    let imported = 0;

    for (const r of localRounds) {
      if (localSessionId != null && r.user_id !== localSessionId) continue;

      const scores = typeof r.scores === "string" ? JSON.parse(r.scores) : r.scores;
      const candidate = {
        user_id: userId,
        scores,
        total_score: r.total_score,
        score_to_par: r.score_to_par,
        created_at: r.created_at || nowIso(),
      };
      if (existing.has(roundFingerprint(candidate))) continue;
      db.rounds.push({ id: db.nextRoundId++, ...candidate });
      existing.add(roundFingerprint(candidate));
      imported++;
    }

    await persistDb(store, db, siteUrl);
    return jsonResponse({ ok: true, imported });
  }

  if (method === "POST" && path === "/api/rounds") {
    const userId = sessionUserId(db, cookies);
    if (!userId) return jsonResponse({ error: "Kirjaudu ensin sisään." }, 401);

    const scores = body.scores;
    if (!Array.isArray(scores) || scores.length !== COURSE.holes.length) {
      return jsonResponse({ error: "Virheelliset tulokset." }, 400);
    }
    for (const s of scores) {
      if (!Number.isInteger(s) || s < 1 || s > 15) {
        return jsonResponse({ error: "Väylän tuloksen pitää olla 1–15." }, 400);
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
    await persistDb(store, db, siteUrl);

    return jsonResponse({
      id: round.id,
      totalScore,
      scoreToPar,
      scores,
    });
  }

  if (method === "DELETE") {
    if (!isAdmin(db, cookies)) {
      return jsonResponse({ error: "Admin access required." }, 403);
    }

    if (path === "/api/admin/rounds") {
      db.rounds = [];
      await persistDb(store, db, siteUrl);
      return jsonResponse({ ok: true });
    }

    const adminDeleteMatch = path.match(/^\/api\/admin\/rounds\/(\d+)$/);
    if (adminDeleteMatch) {
      const roundId = parseInt(adminDeleteMatch[1], 10);
      const idx = db.rounds.findIndex((r) => r.id === roundId);
      if (idx === -1) return jsonResponse({ error: "Kierrosta ei löytynyt." }, 404);
      db.rounds.splice(idx, 1);
      await persistDb(store, db, siteUrl);
      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ error: "Not found" }, 404);
}

export default async (req, context) => {
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || context?.site?.url || "";
  try {
    return await handleRequest(req, siteUrl);
  } catch (err) {
    console.error("API error:", err);
    return jsonResponse({ error: err.message || "Server error" }, 500);
  }
};

export const config = {
  path: "/api/*",
};
