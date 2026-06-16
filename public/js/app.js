let course = null;
let currentUser = null;
let isAdmin = false;
let holeScores = [];
let currentHoleIndex = 0;
let pendingPlayAfterLogin = false;
let pendingViewAfterLogin = null;
let selectedRoundId = null;
let allBestRounds = [];
let allRecentRounds = [];
let lbExpanded = false;
let recentExpanded = false;

const LIST_LIMIT = 5;
const TZ = "Europe/Helsinki";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let useLocalApi = window.localApi?.isStaticHost?.() ?? false;

async function api(path, options = {}) {
  if (useLocalApi) {
    try {
      return await window.localApi.handle(path, options);
    } catch (err) {
      throw new Error(err.message || "Jokin meni pieleen");
    }
  }

  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Jokin meni pieleen");
  return data;
}

function formatPar(scoreToPar) {
  if (scoreToPar === 0) return "E";
  return scoreToPar > 0 ? `+${scoreToPar}` : `${scoreToPar}`;
}

function parClass(scoreToPar) {
  if (scoreToPar < 0) return "under";
  if (scoreToPar > 0) return "over";
  return "even";
}

function scoreClass(score, par) {
  const diff = score - par;
  if (diff <= -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff >= 2) return "double";
  if (diff === 1) return "bogey";
  return "par";
}

function scoreDotHtml(score, par, large = false) {
  const cls = scoreClass(score, par);
  const size = large ? " score-dot-lg" : "";
  return `<span class="score-dot score-dot-${cls}${size}">${score}</span>`;
}

function scoreLabel(score, par) {
  const diff = score - par;
  if (diff <= -2) return "Eagle tai parempi";
  if (diff === -1) return "Birdie";
  if (diff === 0) return "Par";
  if (diff === 1) return "Bogey";
  if (diff === 2) return "Double bogey";
  return `+${diff}`;
}

function parseDate(iso) {
  if (!iso) return new Date();
  if (iso.includes("T")) return new Date(iso);
  return new Date(iso.replace(" ", "T"));
}

function formatDate(iso) {
  return parseDate(iso).toLocaleDateString("fi-FI", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso) {
  return parseDate(iso).toLocaleString("fi-FI", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showToast(msg) {
  const toast = $("#toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3000);
}

function openLogin(forPlay = false, viewAfter = null) {
  pendingPlayAfterLogin = forPlay;
  pendingViewAfterLogin = viewAfter;
  $("#loginError").classList.add("hidden");
  $("#nicknameInput").value = currentUser?.nickname || "";
  $("#loginModal").showModal();
  $("#nicknameInput").focus();
}

function switchView(name) {
  if (name === "profile" && !currentUser) {
    openLogin(false, "profile");
    return;
  }

  $$(".view").forEach((v) => v.classList.remove("active"));
  $$(".nav-btn").forEach((b) => b.classList.remove("active"));
  $(`#view-${name}`).classList.add("active");
  const navBtn = $(`.nav-btn[data-view="${name}"]`);
  if (navBtn) navBtn.classList.add("active");

  const playing = name === "play";
  $("#mainHeader").classList.toggle("header-minimal", playing);
  $("#mainNav").classList.toggle("hidden", playing);
  $("#adminFooter").classList.toggle("hidden", playing);

  if (name === "profile" && currentUser) loadMyRounds();
}

function updateUserArea() {
  const area = $("#userArea");
  if (currentUser) {
    area.innerHTML = `
      <button class="btn btn-ghost btn-sm user-profile-btn" id="headerProfileBtn">${escapeHtml(currentUser.nickname)}</button>
    `;
    $("#headerProfileBtn").addEventListener("click", () => switchView("profile"));
  } else {
    area.innerHTML = `<button class="btn btn-ghost" id="loginBtn">Kirjaudu nimellä</button>`;
    $("#loginBtn").addEventListener("click", () => openLogin(false));
  }
  updateProfileVisibility();
}

function updateProfileVisibility() {
  const loggedIn = !!currentUser;
  $("#profileLoginPrompt").classList.toggle("hidden", loggedIn);
  $("#profileCard").classList.toggle("hidden", !loggedIn);
  if (loggedIn) $("#profileName").textContent = currentUser.nickname;
}

function updateAdminUI() {
  $("#adminLoginForm").classList.toggle("hidden", isAdmin);
  $("#adminLoggedIn").classList.toggle("hidden", !isAdmin);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function initRoundScores() {
  if (!course) return;
  holeScores = course.holes.map((h) => h.par);
  currentHoleIndex = 0;
}

function updateRunningTotal() {
  const played = holeScores.slice(0, currentHoleIndex);
  const current = holeScores[currentHoleIndex];
  const totalSoFar = played.reduce((a, b) => a + b, 0) + current;
  const holesDone = currentHoleIndex + 1;
  const parSoFar = course.holes.slice(0, holesDone).reduce((a, h) => a + h.par, 0);
  const toPar = totalSoFar - parSoFar;

  $("#runningTotal").textContent = totalSoFar;
  const parEl = $("#runningPar");
  parEl.textContent = formatPar(toPar);
  parEl.className = `running-par par-display ${parClass(toPar)}`;
}

function renderPlayProgress() {
  $("#playProgress").innerHTML = course.holes
    .map((hole, i) => {
      let cls = "progress-dot";
      if (i < currentHoleIndex) cls += " done";
      if (i === currentHoleIndex) cls += " active";
      return `<span class="${cls}" title="Väylä ${hole.number}">${hole.number}</span>`;
    })
    .join("");
}

function renderCurrentHole() {
  if (!course) return;
  const hole = course.holes[currentHoleIndex];
  const score = holeScores[currentHoleIndex];
  const isLast = currentHoleIndex === course.holes.length - 1;

  $("#playHoleLabel").textContent = `Väylä ${hole.number}`;
  $("#playHoleMeta").textContent = `Par ${hole.par} · ${hole.distance} m`;
  $("#holeMapImg").src = hole.image;
  $("#holeMapImg").alt = `Väylä ${hole.number} kartta`;

  $("#currentScoreWrap").innerHTML = scoreDotHtml(score, hole.par, true);

  $("#scoreRelative").textContent = scoreLabel(score, hole.par);
  $("#scoreRelative").className = `score-relative score-text-${scoreClass(score, hole.par)}`;

  $("#prevHole").disabled = currentHoleIndex === 0;
  $("#nextHole").textContent = isLast ? "Tallenna kierros" : "Seuraava väylä";

  renderPlayProgress();
  updateRunningTotal();
}

function startRound() {
  if (!currentUser) {
    openLogin(true);
    return;
  }
  initRoundScores();
  renderCurrentHole();
  switchView("play");
}

function exitRound() {
  $("#exitModal").showModal();
}

function confirmExitRound() {
  switchView("leaderboard");
}

function adjustCurrentScore(delta) {
  const i = currentHoleIndex;
  const next = holeScores[i] + delta;
  if (next < 1 || next > 15) return;
  holeScores[i] = next;
  renderCurrentHole();
}

async function nextHole() {
  const isLast = currentHoleIndex === course.holes.length - 1;
  if (isLast) {
    await submitRound();
    return;
  }
  currentHoleIndex++;
  renderCurrentHole();
}

function prevHole() {
  if (currentHoleIndex > 0) {
    currentHoleIndex--;
    renderCurrentHole();
  }
}

async function loadCourse() {
  course = await api("/api/course");
}

async function checkSession() {
  const data = await api("/api/me");
  currentUser = data.loggedIn ? data.user : null;
  isAdmin = !!data.isAdmin;
  updateUserArea();
  updateAdminUI();
}

async function login(nickname) {
  const data = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
  currentUser = data.user;
  updateUserArea();
  await loadMyRounds();
  showToast(`Tervetuloa, ${currentUser.nickname}!`);
  if (pendingPlayAfterLogin) {
    pendingPlayAfterLogin = false;
    pendingViewAfterLogin = null;
    startRound();
  } else if (pendingViewAfterLogin) {
    const view = pendingViewAfterLogin;
    pendingViewAfterLogin = null;
    switchView(view);
  }
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  currentUser = null;
  updateUserArea();
  switchView("leaderboard");
  showToast("Kirjauduit ulos");
}

async function adminLogin(username, password) {
  await api("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  isAdmin = true;
  updateAdminUI();
  showToast("Admin-kirjautuminen onnistui");
}

async function adminLogout() {
  await api("/api/admin/logout", { method: "POST" });
  isAdmin = false;
  updateAdminUI();
  showToast("Admin-kirjautuminen päättyi");
}

async function deleteRound(roundId) {
  await api(`/api/admin/rounds/${roundId}`, { method: "DELETE" });
  $("#roundModal").close();
  showToast("Kierros poistettu");
  await Promise.all([loadLeaderboard(), loadMyRounds()]);
}

async function resetScoreboard() {
  await api("/api/admin/rounds", { method: "DELETE" });
  showToast("Tulostaulu tyhjennetty");
  await Promise.all([loadLeaderboard(), loadMyRounds()]);
}

async function submitRound() {
  const btn = $("#nextHole");
  btn.disabled = true;
  try {
    const result = await api("/api/rounds", {
      method: "POST",
      body: JSON.stringify({ scores: holeScores }),
    });
    showToast(`Kierros tallennettu — ${result.totalScore} (${formatPar(result.scoreToPar)})`);
    await Promise.all([loadLeaderboard(), loadMyRounds()]);
    switchView("leaderboard");
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function openRoundOverview(roundId) {
  selectedRoundId = roundId;
  try {
    const data = await api(`/api/rounds/${roundId}`);
    renderRoundModal(data.round);
    $("#roundModal").showModal();
  } catch (err) {
    showToast(err.message);
  }
}

function renderRoundModal(round) {
  $("#roundModalTitle").textContent = round.nickname;
  $("#roundModalTime").textContent = formatDateTime(round.created_at);
  $("#roundModalMeta").textContent = `Tulos ${round.total_score} (${formatPar(round.score_to_par)})`;

  const scores = typeof round.scores === "string" ? JSON.parse(round.scores) : round.scores;
  $("#roundOverviewGrid").innerHTML = course.holes
    .map((hole, i) => {
      const score = scores[i];
      return `
        <div class="overview-hole">
          <span class="overview-hole-num">V${hole.number}</span>
          <span class="overview-hole-par">Par ${hole.par}</span>
          ${scoreDotHtml(score, hole.par)}
        </div>
      `;
    })
    .join("");

  $("#roundModalSummary").innerHTML = `
    <span>Yhteensä <strong>${round.total_score}</strong></span>
    <span class="par-display ${parClass(round.score_to_par)}">${formatPar(round.score_to_par)}</span>
    <div class="overview-scores-dots">${scores.map((s, i) => scoreDotHtml(s, course.holes[i].par)).join("")}</div>
  `;

  $("#roundModalAdminActions").classList.toggle("hidden", !isAdmin);
}

function bindRoundClicks(container) {
  container.querySelectorAll("[data-round-id]").forEach((el) => {
    const open = () => openRoundOverview(parseInt(el.dataset.roundId, 10));
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

function updateShowMoreBtn(btn, expanded, total) {
  if (total <= LIST_LIMIT) {
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");
  const rest = total - LIST_LIMIT;
  btn.textContent = expanded ? "Näytä vähemmän" : `Näytä lisää (${rest})`;
}

function renderLeaderboardTable() {
  const lbBody = $("#leaderboardTable tbody");
  const empty = $("#leaderboardEmpty");

  if (allBestRounds.length === 0) {
    lbBody.innerHTML = "";
    empty.classList.remove("hidden");
    $("#leaderboardTable").classList.add("hidden");
    $("#lbShowMore").classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  $("#leaderboardTable").classList.remove("hidden");
  lbBody.innerHTML = allBestRounds
    .map((r, i) => {
      const rank = i + 1;
      const rankClass = rank <= 3 ? `rank-${rank}` : "rank-other";
      const rowRank = rank <= 3 ? `lb-rank-${rank}` : "";
      const collapsed = !lbExpanded && i >= LIST_LIMIT ? "row-collapsed" : "";
      return `
        <tr class="clickable-row ${rowRank} ${collapsed}" data-round-id="${r.id}" tabindex="0" role="button">
          <td><span class="rank-badge ${rankClass}">${rank}</span></td>
          <td><strong>${escapeHtml(r.nickname)}</strong></td>
          <td><strong>${r.total_score}</strong></td>
          <td><span class="par-display ${parClass(r.score_to_par)}">${formatPar(r.score_to_par)}</span></td>
          <td>${formatDate(r.created_at)}</td>
        </tr>
      `;
    })
    .join("");
  bindRoundClicks(lbBody);
  updateShowMoreBtn($("#lbShowMore"), lbExpanded, allBestRounds.length);
}

function renderRecentTable() {
  const recentBody = $("#recentTable tbody");
  recentBody.innerHTML = allRecentRounds
    .map((r, i) => {
      const collapsed = !recentExpanded && i >= LIST_LIMIT ? "row-collapsed" : "";
      return `
    <tr class="clickable-row ${collapsed}" data-round-id="${r.id}" tabindex="0" role="button">
      <td>${escapeHtml(r.nickname)}</td>
      <td><strong>${r.total_score}</strong></td>
      <td><span class="par-display ${parClass(r.score_to_par)}">${formatPar(r.score_to_par)}</span></td>
      <td>${formatDate(r.created_at)}</td>
    </tr>
  `;
    })
    .join("");
  bindRoundClicks(recentBody);
  updateShowMoreBtn($("#recentShowMore"), recentExpanded, allRecentRounds.length);
}

async function loadLeaderboard() {
  const data = await api("/api/leaderboard");
  const stats = data.stats;

  $("#statsRow").innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${stats.players || 0}</div>
      <div class="stat-label">Pelaajaa</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.rounds || 0}</div>
      <div class="stat-label">Kierrosta</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.course_record ?? "—"}</div>
      <div class="stat-label">Paras tulos</div>
    </div>
  `;

  allBestRounds = data.bestRounds;
  allRecentRounds = data.recentRounds;
  renderLeaderboardTable();
  renderRecentTable();
}

async function loadMyRounds() {
  if (!currentUser) return;
  try {
    const data = await api("/api/my-rounds");
    const list = $("#myRoundsList");
    if (data.rounds.length === 0) {
      list.innerHTML = `<p class="empty-msg">Ei vielä kierroksia</p>`;
      return;
    }
    list.innerHTML = data.rounds
      .map(
        (r) => `
      <button type="button" class="round-card" data-round-id="${r.id}">
        <div class="round-card-main">
          <span class="round-card-score">${r.total_score}</span>
          <span class="par-display ${parClass(r.score_to_par)}">${formatPar(r.score_to_par)}</span>
        </div>
        <div class="round-card-meta">${formatDate(r.created_at)}</div>
        <div class="round-card-holes">${r.scores.map((s, i) => scoreDotHtml(s, course?.holes[i]?.par ?? 3)).join("")}</div>
      </button>
    `
      )
      .join("");

    list.querySelectorAll("[data-round-id]").forEach((btn) => {
      btn.addEventListener("click", () => openRoundOverview(parseInt(btn.dataset.roundId, 10)));
    });
  } catch {
    /* not logged in */
  }
}

function bindEvents() {
  $$(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  $("#loginBtn")?.addEventListener("click", () => openLogin(false));
  $("#profileLoginBtn").addEventListener("click", () => openLogin(false));
  $("#profileLogoutBtn").addEventListener("click", logout);
  $("#playRoundBtn").addEventListener("click", startRound);

  $("#cancelLogin").addEventListener("click", () => {
    pendingPlayAfterLogin = false;
    pendingViewAfterLogin = null;
    $("#loginModal").close();
  });

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nickname = $("#nicknameInput").value.trim();
    const errEl = $("#loginError");
    try {
      await login(nickname);
      $("#loginModal").close();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    }
  });

  $("#decScore").addEventListener("click", () => adjustCurrentScore(-1));
  $("#incScore").addEventListener("click", () => adjustCurrentScore(1));
  $("#prevHole").addEventListener("click", prevHole);
  $("#nextHole").addEventListener("click", nextHole);
  $("#exitRound").addEventListener("click", exitRound);
  $("#cancelExit").addEventListener("click", () => $("#exitModal").close());
  $("#exitForm").addEventListener("submit", (e) => {
    e.preventDefault();
    $("#exitModal").close();
    confirmExitRound();
  });

  $("#adminToggle").addEventListener("click", () => {
    $("#adminPanel").classList.toggle("hidden");
  });

  $("#adminLoginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#adminError");
    errEl.classList.add("hidden");
    try {
      await adminLogin($("#adminUser").value.trim(), $("#adminPass").value);
      $("#adminUser").value = "";
      $("#adminPass").value = "";
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    }
  });

  $("#adminLogoutBtn").addEventListener("click", adminLogout);
  $("#resetScoreboard").addEventListener("click", () => $("#resetModal").showModal());
  $("#cancelReset").addEventListener("click", () => $("#resetModal").close());
  $("#resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#resetModal").close();
    try {
      await resetScoreboard();
    } catch (err) {
      showToast(err.message);
    }
  });

  $("#closeRoundModal").addEventListener("click", () => $("#roundModal").close());
  $("#deleteRoundBtn").addEventListener("click", async () => {
    if (!selectedRoundId) return;
    if (!confirm("Poistetaanko kierros?")) return;
    try {
      await deleteRound(selectedRoundId);
    } catch (err) {
      showToast(err.message);
    }
  });

  $("#lbShowMore").addEventListener("click", () => {
    lbExpanded = !lbExpanded;
    renderLeaderboardTable();
  });

  $("#recentShowMore").addEventListener("click", () => {
    recentExpanded = !recentExpanded;
    renderRecentTable();
  });
}

async function detectApiMode() {
  if (useLocalApi) return;
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (!res.ok) useLocalApi = true;
  } catch {
    useLocalApi = true;
  }
}

async function init() {
  bindEvents();
  await detectApiMode();
  await loadCourse();
  initRoundScores();
  await checkSession();
  await loadLeaderboard();
  if (currentUser) await loadMyRounds();
}

init();
