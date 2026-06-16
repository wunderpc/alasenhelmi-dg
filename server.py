#!/usr/bin/env python3
"""Alasen Helmi disc golf scorebook server."""

import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta
from http import cookies
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

try:
    from zoneinfo import ZoneInfo

    HELSINKI = ZoneInfo("Europe/Helsinki")
except Exception:
    HELSINKI = None

ROOT = Path(__file__).parent
DB_PATH = ROOT / "scores.db"
PUBLIC = ROOT / "public"
IMAGES = ROOT

COURSE = {
    "name": "Alasen Helmi",
    "totalPar": 18,
    "totalDistance": 278,
    "holes": [
        {"number": 1, "par": 3, "distance": 38, "image": "/images/alasen-helmi-tee-sign-1.jpg"},
        {"number": 2, "par": 3, "distance": 40, "image": "/images/alasen-helmi-tee-sign-2.jpg"},
        {"number": 3, "par": 3, "distance": 67, "image": "/images/alasen-helmi-tee-sign-3.jpg"},
        {"number": 4, "par": 3, "distance": 45, "image": "/images/alasen-helmi-tee-sign-4.jpg"},
        {"number": 5, "par": 3, "distance": 59, "image": "/images/alasen-helmi-tee-sign-5.jpg"},
        {"number": 6, "par": 3, "distance": 39, "image": "/images/alasen-helmi-tee-sign-6.jpg"},
    ],
}

ADMIN_USER = "Jone"
ADMIN_PASS = "admin123"

SESSIONS: dict[str, int] = {}
ADMIN_SESSIONS: set[str] = set()
NICKNAME_RE = re.compile(r"^[a-zA-Z0-9_\-\säöåÄÖÅ]+$")


def helsinki_offset_hours(when: datetime | None = None) -> int:
    """EET/EEST offset for Finland (Mar–Oct ≈ +3, else +2)."""
    when = when or datetime.now(timezone.utc)
    return 3 if 3 <= when.month <= 10 else 2


def helsinki_tz(when: datetime | None = None):
    if HELSINKI is not None:
        return HELSINKI
    return timezone(timedelta(hours=helsinki_offset_hours(when)))


def helsinki_now_str() -> str:
    return datetime.now(helsinki_tz()).strftime("%Y-%m-%d %H:%M:%S")


def serialize_timestamp(ts: str) -> str:
    if not ts:
        return ts
    try:
        naive = datetime.strptime(ts[:19], "%Y-%m-%d %H:%M:%S")
        dt = naive.replace(tzinfo=helsinki_tz(naive))
        return dt.isoformat()
    except ValueError:
        return ts


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nickname TEXT UNIQUE NOT NULL COLLATE NOCASE,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE TABLE IF NOT EXISTS rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            scores TEXT NOT NULL,
            total_score INTEGER NOT NULL,
            score_to_par INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_rounds_user ON rounds(user_id);
        CREATE INDEX IF NOT EXISTS idx_rounds_total ON rounds(total_score);
        """
    )
    conn.commit()
    conn.close()


def db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def json_response(handler, data, status=200, extra_headers=None):
    body = json.dumps(data).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    if extra_headers:
        for key, value in extra_headers:
            handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler):
    length = int(handler.headers.get("Content-Length", 0))
    if length == 0:
        return {}
    return json.loads(handler.rfile.read(length))


def get_session_user_id(handler):
    cookie = cookies.SimpleCookie(handler.headers.get("Cookie", ""))
    if "session" not in cookie:
        return None
    return SESSIONS.get(cookie["session"].value)


def is_admin(handler):
    cookie = cookies.SimpleCookie(handler.headers.get("Cookie", ""))
    if "admin_session" not in cookie:
        return False
    return cookie["admin_session"].value in ADMIN_SESSIONS


def set_session(handler, user_id):
    sid = uuid.uuid4().hex
    SESSIONS[sid] = user_id
    cookie = cookies.SimpleCookie()
    cookie["session"] = sid
    cookie["session"]["path"] = "/"
    cookie["session"]["httponly"] = True
    cookie["session"]["max-age"] = str(30 * 24 * 60 * 60)
    handler.send_header("Set-Cookie", cookie.output(header="").strip())


def clear_session(handler):
    cookie = cookies.SimpleCookie(handler.headers.get("Cookie", ""))
    if "session" in cookie:
        sid = cookie["session"].value
        SESSIONS.pop(sid, None)
    c = cookies.SimpleCookie()
    c["session"] = ""
    c["session"]["path"] = "/"
    c["session"]["max-age"] = "0"
    handler.send_header("Set-Cookie", c.output(header="").strip())


def set_admin_session(handler):
    sid = uuid.uuid4().hex
    ADMIN_SESSIONS.add(sid)
    cookie = cookies.SimpleCookie()
    cookie["admin_session"] = sid
    cookie["admin_session"]["path"] = "/"
    cookie["admin_session"]["httponly"] = True
    cookie["admin_session"]["max-age"] = str(24 * 60 * 60)
    handler.send_header("Set-Cookie", cookie.output(header="").strip())


def clear_admin_session(handler):
    cookie = cookies.SimpleCookie(handler.headers.get("Cookie", ""))
    if "admin_session" in cookie:
        sid = cookie["admin_session"].value
        ADMIN_SESSIONS.discard(sid)
    c = cookies.SimpleCookie()
    c["admin_session"] = ""
    c["admin_session"]["path"] = "/"
    c["admin_session"]["max-age"] = "0"
    handler.send_header("Set-Cookie", c.output(header="").strip())


def parse_round_row(row):
    item = dict(row)
    if "scores" in item and isinstance(item["scores"], str):
        item["scores"] = json.loads(item["scores"])
    if "created_at" in item:
        item["created_at"] = serialize_timestamp(item["created_at"])
    return item


def row_with_timestamp(row):
    item = dict(row)
    if item.get("created_at"):
        item["created_at"] = serialize_timestamp(item["created_at"])
    return item


class ScorebookHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/images/"):
            rel = path[len("/images/") :]
            file_path = IMAGES / rel
            if file_path.is_file():
                return self._serve_file(file_path)
            self.send_error(404)
            return

        if path.startswith("/api/rounds/"):
            round_id = path.rsplit("/", 1)[-1]
            if round_id.isdigit():
                return self.api_round_detail(int(round_id))

        api_routes = {
            "/api/course": self.api_course,
            "/api/me": self.api_me,
            "/api/leaderboard": self.api_leaderboard,
            "/api/my-rounds": self.api_my_rounds,
            "/api/admin/me": self.api_admin_me,
        }
        if path in api_routes:
            return api_routes[path]()

        if path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        routes = {
            "/api/login": self.api_login,
            "/api/logout": self.api_logout,
            "/api/rounds": self.api_rounds,
            "/api/admin/login": self.api_admin_login,
            "/api/admin/logout": self.api_admin_logout,
        }
        if parsed.path in routes:
            return routes[parsed.path]()
        self.send_error(404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if not is_admin(self):
            return json_response(self, {"error": "Admin access required."}, 403)

        if parsed.path == "/api/admin/rounds":
            return self.api_admin_reset_all()

        if parsed.path.startswith("/api/admin/rounds/"):
            round_id = parsed.path.rsplit("/", 1)[-1]
            if round_id.isdigit():
                return self.api_admin_delete_round(int(round_id))

        self.send_error(404)

    def _serve_file(self, file_path: Path):
        ext = file_path.suffix.lower()
        types = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }
        content_type = types.get(ext, "application/octet-stream")
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def api_course(self):
        json_response(self, COURSE)

    def api_me(self):
        user_id = get_session_user_id(self)
        admin = is_admin(self)
        if not user_id:
            return json_response(self, {"loggedIn": False, "isAdmin": admin})
        conn = db_conn()
        row = conn.execute(
            "SELECT id, nickname FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        conn.close()
        if not row:
            return json_response(self, {"loggedIn": False, "isAdmin": admin})
        json_response(self, {"loggedIn": True, "user": dict(row), "isAdmin": admin})

    def api_admin_me(self):
        json_response(self, {"loggedIn": is_admin(self)})

    def api_login(self):
        body = read_json(self)
        nickname = (body.get("nickname") or "").strip()
        if len(nickname) < 2 or len(nickname) > 24:
            return json_response(self, {"error": "Nimimerkin pituus 2–24 merkkiä."}, 400)
        if not NICKNAME_RE.match(nickname):
            return json_response(
                self, {"error": "Nimimerkki sisältää kiellettyjä merkkejä."}, 400
            )

        conn = db_conn()
        row = conn.execute(
            "SELECT id, nickname FROM users WHERE nickname = ? COLLATE NOCASE",
            (nickname,),
        ).fetchone()
        if not row:
            cur = conn.execute("INSERT INTO users (nickname) VALUES (?)", (nickname,))
            conn.commit()
            user = {"id": cur.lastrowid, "nickname": nickname}
        else:
            user = dict(row)
        conn.close()

        self.send_response(200)
        set_session(self, user["id"])
        body = json.dumps({"user": user}).encode()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_logout(self):
        self.send_response(200)
        clear_session(self)
        body = json.dumps({"ok": True}).encode()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_admin_login(self):
        body = read_json(self)
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        if username != ADMIN_USER or password != ADMIN_PASS:
            return json_response(self, {"error": "Virheellinen käyttäjätunnus tai salasana."}, 401)

        self.send_response(200)
        set_admin_session(self)
        body = json.dumps({"ok": True}).encode()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_admin_logout(self):
        self.send_response(200)
        clear_admin_session(self)
        body = json.dumps({"ok": True}).encode()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_rounds(self):
        user_id = get_session_user_id(self)
        if not user_id:
            return json_response(self, {"error": "Kirjaudu ensin sisään."}, 401)

        body = read_json(self)
        scores = body.get("scores")
        if not isinstance(scores, list) or len(scores) != len(COURSE["holes"]):
            return json_response(self, {"error": "Virheelliset tulokset."}, 400)
        for s in scores:
            if not isinstance(s, int) or s < 1 or s > 15:
                return json_response(self, {"error": "Väylän tuloksen pitää olla 1–15."}, 400)

        total = sum(scores)
        to_par = total - COURSE["totalPar"]
        conn = db_conn()
        cur = conn.execute(
            "INSERT INTO rounds (user_id, scores, total_score, score_to_par, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, json.dumps(scores), total, to_par, helsinki_now_str()),
        )
        conn.commit()
        round_id = cur.lastrowid
        row = conn.execute(
            """
            SELECT r.id, r.scores, r.total_score, r.score_to_par, r.created_at, u.nickname
            FROM rounds r JOIN users u ON u.id = r.user_id WHERE r.id = ?
            """,
            (round_id,),
        ).fetchone()
        conn.close()
        result = parse_round_row(row)
        json_response(
            self,
            {
                "id": result["id"],
                "totalScore": result["total_score"],
                "scoreToPar": result["score_to_par"],
                "scores": result["scores"],
                "created_at": result["created_at"],
                "nickname": result["nickname"],
            },
        )

    def api_round_detail(self, round_id):
        conn = db_conn()
        row = conn.execute(
            """
            SELECT r.id, r.scores, r.total_score, r.score_to_par, r.created_at, u.nickname
            FROM rounds r JOIN users u ON u.id = r.user_id WHERE r.id = ?
            """,
            (round_id,),
        ).fetchone()
        conn.close()
        if not row:
            return json_response(self, {"error": "Kierrosta ei löytynyt."}, 404)
        json_response(self, {"round": parse_round_row(row)})

    def api_leaderboard(self):
        conn = db_conn()
        best = conn.execute(
            """
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
            """
        ).fetchall()

        recent = conn.execute(
            """
            SELECT r.id, u.nickname, r.total_score, r.score_to_par, r.created_at
            FROM rounds r
            JOIN users u ON u.id = r.user_id
            ORDER BY r.created_at DESC
            LIMIT 20
            """
        ).fetchall()

        stats = conn.execute(
            """
            SELECT
                COUNT(DISTINCT user_id) AS players,
                COUNT(*) AS rounds,
                MIN(total_score) AS course_record
            FROM rounds
            """
        ).fetchone()
        conn.close()

        json_response(
            self,
            {
                "bestRounds": [row_with_timestamp(r) for r in best],
                "recentRounds": [row_with_timestamp(r) for r in recent],
                "stats": dict(stats) if stats else {"players": 0, "rounds": 0, "course_record": None},
            },
        )

    def api_my_rounds(self):
        user_id = get_session_user_id(self)
        if not user_id:
            return json_response(self, {"error": "Et ole kirjautunut."}, 401)

        conn = db_conn()
        rows = conn.execute(
            """
            SELECT id, scores, total_score, score_to_par, created_at
            FROM rounds WHERE user_id = ?
            ORDER BY created_at DESC LIMIT 20
            """,
            (user_id,),
        ).fetchall()
        conn.close()

        rounds = [parse_round_row(r) for r in rows]
        json_response(self, {"rounds": rounds})

    def api_admin_delete_round(self, round_id):
        conn = db_conn()
        cur = conn.execute("DELETE FROM rounds WHERE id = ?", (round_id,))
        conn.commit()
        deleted = cur.rowcount
        conn.close()
        if deleted == 0:
            return json_response(self, {"error": "Kierrosta ei löytynyt."}, 404)
        json_response(self, {"ok": True})

    def api_admin_reset_all(self):
        conn = db_conn()
        conn.execute("DELETE FROM rounds")
        conn.commit()
        conn.close()
        json_response(self, {"ok": True})


def main():
    init_db()
    port = int(os.environ.get("PORT", 3000))
    server = HTTPServer(("0.0.0.0", port), ScorebookHandler)
    print(f"Alasen Helmi scorebook running at http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
