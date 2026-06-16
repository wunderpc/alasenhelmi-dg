/**
 * Client-side API for static hosting (GitHub Pages).
 * Persists rounds in localStorage and merges optional shared data/scores.json.
 */
(function () {
  const DB_KEY = "alasen-helmi-db";
  const DELETED_KEY = "alasen-helmi-deleted";
  const ADMIN_USER = "Jone";
  const ADMIN_PASS = "admin123";
  const LOCAL_ID_START = 100000;

  const COURSE = {
    name: "Alasen Helmi",
    totalPar: 18,
    totalDistance: 278,
    holes: [
      { number: 1, par: 3, distance: 38, image: "images/alasen-helmi-tee-sign-1.jpg" },
      { number: 2, par: 3, distance: 40, image: "images/alasen-helmi-tee-sign-2.jpg" },
      { number: 3, par: 3, distance: 67, image: "images/alasen-helmi-tee-sign-3.jpg" },
      { number: 4, par: 3, distance: 45, image: "images/alasen-helmi-tee-sign-4.jpg" },
      { number: 5, par: 3, distance: 59, image: "images/alasen-helmi-tee-sign-5.jpg" },
      { number: 6, par: 3, distance: 39, image: "images/alasen-helmi-tee-sign-6.jpg" },
    ],
  };

  let sharedUsers = [];
  let sharedRounds = [];
  let sharedLoaded = false;

  function loadDb() {
    try {
      return JSON.parse(localStorage.getItem(DB_KEY)) || defaultDb();
    } catch {
      return defaultDb();
    }
  }

  function defaultDb() {
    return { users: [], rounds: [], sessionUserId: null, isAdmin: false, nextUserId: 1, nextRoundId: LOCAL_ID_START };
  }

  function saveDb(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function loadDeletedIds() {
    try {
      return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }

  function saveDeletedIds(set) {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...set]));
  }

  function helsinkiNowIso() {
    return new Date().toISOString();
  }

  function findUser(users, nickname) {
    const lower = nickname.toLowerCase();
    return users.find((u) => u.nickname.toLowerCase() === lower);
  }

  function allUsers(db) {
    const map = new Map();
    for (const u of sharedUsers) map.set(u.id, u);
    for (const u of db.users) map.set(u.id, u);
    return [...map.values()];
  }

  function allRounds(db) {
    const deleted = loadDeletedIds();
    const map = new Map();
    for (const r of sharedRounds) {
      if (!deleted.has(r.id)) map.set(r.id, { ...r, source: "shared" });
    }
    for (const r of db.rounds) {
      if (!deleted.has(r.id)) map.set(r.id, { ...r, source: "local" });
    }
    return [...map.values()];
  }

  function userById(db, userId) {
    return allUsers(db).find((u) => u.id === userId);
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

  function leaderboardData(db) {
    const rounds = allRounds(db);
    const users = allUsers(db);

    const bestByUser = new Map();
    for (const r of rounds) {
      const prev = bestByUser.get(r.user_id);
      if (!prev || r.total_score < prev.total_score || (r.total_score === prev.total_score && r.created_at < prev.created_at)) {
        bestByUser.set(r.user_id, r);
      }
    }

    const bestRounds = [...bestByUser.values()]
      .sort((a, b) => a.total_score - b.total_score || a.created_at.localeCompare(b.created_at))
      .map((r) => roundWithNickname(db, r));

    const recentRounds = [...rounds]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20)
      .map((r) => roundWithNickname(db, r));

    const playerIds = new Set(rounds.map((r) => r.user_id));
    const courseRecord = rounds.length ? Math.min(...rounds.map((r) => r.total_score)) : null;

    return {
      bestRounds,
      recentRounds,
      stats: {
        players: playerIds.size,
        rounds: rounds.length,
        course_record: courseRecord,
      },
    };
  }

  async function importSharedScores() {
    try {
      const res = await fetch("data/scores.json", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      sharedUsers = data.users || [];
      sharedRounds = (data.rounds || []).map((r) => ({
        ...r,
        scores: typeof r.scores === "string" ? JSON.parse(r.scores) : r.scores,
      }));
    } catch {
      /* optional file */
    }
    sharedLoaded = true;
  }

  function route(path, method) {
    const roundDetail = path.match(/^\/api\/rounds\/(\d+)$/);
    if (roundDetail && method === "GET") return { type: "roundDetail", id: parseInt(roundDetail[1], 10) };

    const adminDelete = path.match(/^\/api\/admin\/rounds\/(\d+)$/);
    if (adminDelete && method === "DELETE") return { type: "adminDelete", id: parseInt(adminDelete[1], 10) };

    const routes = {
      GET: {
        "/api/course": "course",
        "/api/me": "me",
        "/api/leaderboard": "leaderboard",
        "/api/my-rounds": "myRounds",
      },
      POST: {
        "/api/login": "login",
        "/api/logout": "logout",
        "/api/rounds": "rounds",
        "/api/admin/login": "adminLogin",
        "/api/admin/logout": "adminLogout",
      },
      DELETE: {
        "/api/admin/rounds": "adminReset",
      },
    };

    const handler = routes[method]?.[path];
    return handler ? { type: handler } : null;
  }

  async function handle(path, options = {}) {
    if (!sharedLoaded) await importSharedScores();

    const method = (options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};
    const r = route(path, method);
    if (!r) throw new Error("Not found");

    const db = loadDb();

    switch (r.type) {
      case "course":
        return COURSE;

      case "me":
        if (!db.sessionUserId) {
          return { loggedIn: false, isAdmin: db.isAdmin };
        }
        const user = userById(db, db.sessionUserId);
        if (!user) {
          db.sessionUserId = null;
          saveDb(db);
          return { loggedIn: false, isAdmin: db.isAdmin };
        }
        return { loggedIn: true, user: { id: user.id, nickname: user.nickname }, isAdmin: db.isAdmin };

      case "login": {
        const nickname = (body.nickname || "").trim();
        if (nickname.length < 2 || nickname.length > 24) {
          throw new Error("Nickname must be 2–24 characters.");
        }
        if (!/^[a-zA-Z0-9_\-\säöåÄÖÅ]+$/.test(nickname)) {
          throw new Error("Nickname contains invalid characters.");
        }

        let user = findUser(db.users, nickname) || findUser(sharedUsers, nickname);
        if (!user) {
          user = { id: db.nextUserId++, nickname };
          db.users.push(user);
        } else if (!db.users.some((u) => u.id === user.id)) {
          db.users.push({ id: user.id, nickname: user.nickname });
        }

        db.sessionUserId = user.id;
        saveDb(db);
        return { user: { id: user.id, nickname: user.nickname } };
      }

      case "logout":
        db.sessionUserId = null;
        saveDb(db);
        return { ok: true };

      case "rounds": {
        if (!db.sessionUserId) throw new Error("Please log in first.");

        const scores = body.scores;
        if (!Array.isArray(scores) || scores.length !== COURSE.holes.length) {
          throw new Error("Invalid scores.");
        }
        for (const s of scores) {
          if (!Number.isInteger(s) || s < 1 || s > 15) {
            throw new Error("Each hole score must be 1–15.");
          }
        }

        const totalScore = scores.reduce((a, b) => a + b, 0);
        const scoreToPar = totalScore - COURSE.totalPar;
        const round = {
          id: db.nextRoundId++,
          user_id: db.sessionUserId,
          scores,
          total_score: totalScore,
          score_to_par: scoreToPar,
          created_at: helsinkiNowIso(),
        };
        db.rounds.push(round);
        saveDb(db);

        return {
          id: round.id,
          totalScore,
          scoreToPar,
          scores,
        };
      }

      case "leaderboard":
        return leaderboardData(db);

      case "myRounds": {
        if (!db.sessionUserId) throw new Error("Not logged in.");
        const rounds = allRounds(db)
          .filter((r) => r.user_id === db.sessionUserId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 20)
          .map((r) => ({
            id: r.id,
            scores: r.scores,
            total_score: r.total_score,
            score_to_par: r.score_to_par,
            created_at: r.created_at,
          }));
        return { rounds };
      }

      case "roundDetail": {
        const round = allRounds(db).find((x) => x.id === r.id);
        if (!round) throw new Error("Round not found.");
        return { round: roundWithNickname(db, round) };
      }

      case "adminLogin": {
        const username = (body.username || "").trim();
        const password = body.password || "";
        if (username !== ADMIN_USER || password !== ADMIN_PASS) {
          throw new Error("Virheellinen käyttäjätunnus tai salasana.");
        }
        db.isAdmin = true;
        saveDb(db);
        return { ok: true };
      }

      case "adminLogout":
        db.isAdmin = false;
        saveDb(db);
        return { ok: true };

      case "adminDelete": {
        if (!db.isAdmin) throw new Error("Admin access required.");
        const round = allRounds(db).find((x) => x.id === r.id);
        if (!round) throw new Error("Round not found.");

        const deleted = loadDeletedIds();
        deleted.add(r.id);
        saveDeletedIds(deleted);

        if (round.source === "local") {
          db.rounds = db.rounds.filter((x) => x.id !== r.id);
          saveDb(db);
        }
        return { ok: true };
      }

      case "adminReset": {
        if (!db.isAdmin) throw new Error("Admin access required.");
        const deleted = loadDeletedIds();
        for (const r of allRounds(db)) deleted.add(r.id);
        saveDeletedIds(deleted);
        db.rounds = [];
        saveDb(db);
        return { ok: true };
      }

      default:
        throw new Error("Not found");
    }
  }

  window.localApi = {
    handle,
    importSharedScores,
    isStaticHost: function () {
      return (
        location.hostname.endsWith("github.io") ||
        location.hostname.endsWith("gitlab.io") ||
        location.protocol === "file:"
      );
    },
  };
})();
