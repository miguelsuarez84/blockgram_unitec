import hashlib
import hmac
import json
import math
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from datetime import date
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get(
    "BLOCKGRAM_DB_PATH",
    str(Path.home() / ".blockgram" / "blockgram.sqlite3"),
)).expanduser()
COOKIE_NAME = "blockgram_session"
SESSION_SECONDS = 30 * 24 * 60 * 60
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_AUTH_ATTEMPT_KEYS = 10000
AUTH_ATTEMPT_WINDOW_SECONDS = 60
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$")
DEFAULT_DATA = {
    "notes": [],
    "projects": [],
    "selectedProjectId": None,
    "activeWorkSession": None,
    "dailyProgress": {"count": 0, "lastProgressDate": ""},
}
AUTH_ATTEMPTS = OrderedDict()
AUTH_ATTEMPTS_LOCK = threading.Lock()
AUTH_ATTEMPTS_LAST_PRUNE = 0


@contextmanager
def connect_database():
    connection = sqlite3.connect(DATABASE, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    with connect_database() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL,
                username_key TEXT NOT NULL UNIQUE,
                password_salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS account_data (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                document TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1
            );
            """
        )
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(account_data)")}
        if "revision" not in columns:
            connection.execute(
                "ALTER TABLE account_data ADD COLUMN revision INTEGER NOT NULL DEFAULT 1"
            )
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))


def hash_password(password, salt):
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)


def default_document():
    return json.dumps(DEFAULT_DATA, ensure_ascii=False, separators=(",", ":"))


def is_safe_integer(value):
    return type(value) is int and 0 <= value <= 9007199254740991


def validate_account_document(document):
    notes = document.get("notes")
    projects = document.get("projects")
    if not isinstance(notes, list) or not isinstance(projects, list):
        raise ValueError("Los datos deben incluir listas de notas y proyectos.")

    note_ids = set()
    for note in notes:
        if not isinstance(note, dict):
            raise ValueError("El documento contiene una nota inválida.")
        note_id = note.get("id")
        if (not isinstance(note_id, str) or not note_id or len(note_id) > 100 or note_id in note_ids or
                not isinstance(note.get("title"), str) or not note["title"].strip() or len(note["title"]) > 200 or
                not isinstance(note.get("content"), str) or len(note["content"]) > 50000 or
                not isinstance(note.get("linkedTo"), str) or len(note["linkedTo"]) > 100 or
                note.get("language") not in {"auto", "python", "javascript", "html", "css", "json", "text"} or
                not is_safe_integer(note.get("createdAt")) or not is_safe_integer(note.get("updatedAt"))):
            raise ValueError("El documento contiene una nota con datos inválidos.")
        note_ids.add(note_id)

    project_ids = set()
    for project in projects:
        if not isinstance(project, dict):
            raise ValueError("El documento contiene un proyecto inválido.")
        project_id = project.get("id")
        deadline = project.get("deadline")
        if deadline:
            if not isinstance(deadline, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", deadline):
                raise ValueError("El documento contiene una fecha de entrega inválida.")
            try:
                date.fromisoformat(deadline)
            except (TypeError, ValueError):
                raise ValueError("El documento contiene una fecha de entrega inválida.") from None
        if (not isinstance(project_id, str) or not project_id or len(project_id) > 100 or project_id in project_ids or
                not isinstance(project.get("name"), str) or not project["name"].strip() or len(project["name"]) > 100 or
                not isinstance(project.get("description"), str) or len(project["description"]) > 180 or
                project.get("type") not in {"project", "task", "exam"} or
                project.get("importance") not in {"important", "normal", "low", "upcoming"} or
                not isinstance(deadline, str) or
                not isinstance(project.get("noteId"), str) or
                not isinstance(project.get("tasks"), list) or len(project["tasks"]) > 500 or
                not isinstance(project.get("dailyLimit"), (int, float)) or isinstance(project.get("dailyLimit"), bool) or
                not math.isfinite(project["dailyLimit"]) or not 0.5 <= project["dailyLimit"] <= 12 or
                not isinstance(project.get("estimatedHours"), (int, float)) or isinstance(project.get("estimatedHours"), bool) or
                not math.isfinite(project["estimatedHours"]) or not 0.5 <= project["estimatedHours"] <= 500 or
                not isinstance(project.get("workedSeconds"), (int, float)) or isinstance(project.get("workedSeconds"), bool) or
                not math.isfinite(project["workedSeconds"]) or project["workedSeconds"] < 0 or
                not is_safe_integer(project.get("createdAt")) or not is_safe_integer(project.get("updatedAt"))):
            raise ValueError("El documento contiene un proyecto con datos inválidos.")
        task_ids = set()
        for task in project["tasks"]:
            if not isinstance(task, dict):
                raise ValueError("El documento contiene una tarea inválida.")
            task_id = task.get("id")
            hours = task.get("hours")
            if (not isinstance(task_id, str) or not task_id or len(task_id) > 100 or task_id in task_ids or
                    not isinstance(task.get("title"), str) or not task["title"].strip() or len(task["title"]) > 120 or
                    not isinstance(hours, (int, float)) or isinstance(hours, bool) or
                    not math.isfinite(hours) or not 0 < hours <= 500 or type(task.get("done")) is not bool):
                raise ValueError("El documento contiene una tarea con datos inválidos.")
            task_ids.add(task_id)
        project_ids.add(project_id)

    selected_project_id = document.get("selectedProjectId")
    if selected_project_id is not None and (
            not isinstance(selected_project_id, str) or selected_project_id not in project_ids):
        raise ValueError("El proyecto seleccionado no existe.")
    active_session = document.get("activeWorkSession")
    if active_session is not None and (
            not isinstance(active_session, dict) or active_session.get("projectId") not in project_ids or
            not is_safe_integer(active_session.get("startedAt"))):
        raise ValueError("La sesión de trabajo activa no es válida.")
    progress = document.get("dailyProgress", DEFAULT_DATA["dailyProgress"])
    if (not isinstance(progress, dict) or not is_safe_integer(progress.get("count")) or
            not isinstance(progress.get("lastProgressDate"), str)):
        raise ValueError("El registro de progreso no es válido.")
    progress_date = progress["lastProgressDate"]
    if progress_date:
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", progress_date):
            raise ValueError("La fecha del registro de progreso no es válida.")
        try:
            date.fromisoformat(progress_date)
        except ValueError:
            raise ValueError("La fecha del registro de progreso no es válida.") from None
    return {
        "notes": notes,
        "projects": projects,
        "selectedProjectId": selected_project_id,
        "activeWorkSession": active_session,
        "dailyProgress": progress,
    }


class PayloadTooLargeError(ValueError):
    pass


class BlockgramHandler(BaseHTTPRequestHandler):
    server_version = "Blockgram"

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, document, extra_headers=None):
        body = json.dumps(document, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if extra_headers:
            for name, value in extra_headers:
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, message):
        self.send_json(status, {"error": message})

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("La solicitud no tiene un tamaño válido.") from None
        if length > MAX_REQUEST_BYTES:
            raise PayloadTooLargeError("La solicitud supera el límite de 2 MiB.")
        if length < 1:
            raise ValueError("La solicitud está vacía.")
        if self.headers.get_content_type() != "application/json":
            raise ValueError("El servidor espera datos JSON.")
        try:
            document = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError, RecursionError):
            raise ValueError("Los datos enviados no son JSON válido.") from None
        if not isinstance(document, dict):
            raise ValueError("El formato de la solicitud no es válido.")
        return document

    def check_same_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return False
        parsed = urlsplit(origin)
        return parsed.scheme in ("http", "https") and parsed.netloc.lower() == self.headers.get("Host", "").lower()

    def check_auth_rate(self, username):
        now = time.time()
        key = (urlsplit(self.path).path, username.lower())
        global AUTH_ATTEMPTS_LAST_PRUNE
        with AUTH_ATTEMPTS_LOCK:
            if now - AUTH_ATTEMPTS_LAST_PRUNE >= AUTH_ATTEMPT_WINDOW_SECONDS:
                for old_key, old_attempts in list(AUTH_ATTEMPTS.items()):
                    current_attempts = [
                        attempt for attempt in old_attempts
                        if now - attempt < AUTH_ATTEMPT_WINDOW_SECONDS
                    ]
                    if current_attempts:
                        AUTH_ATTEMPTS[old_key] = current_attempts
                    else:
                        del AUTH_ATTEMPTS[old_key]
                AUTH_ATTEMPTS_LAST_PRUNE = now

            attempts = [
                attempt for attempt in AUTH_ATTEMPTS.get(key, [])
                if now - attempt < AUTH_ATTEMPT_WINDOW_SECONDS
            ]
            if len(attempts) >= 8:
                AUTH_ATTEMPTS[key] = attempts
                AUTH_ATTEMPTS.move_to_end(key)
                return False
            attempts.append(now)
            AUTH_ATTEMPTS[key] = attempts
            AUTH_ATTEMPTS.move_to_end(key)
            while len(AUTH_ATTEMPTS) > MAX_AUTH_ATTEMPT_KEYS:
                AUTH_ATTEMPTS.popitem(last=False)
            return True

    def clear_auth_rate(self, username):
        key = (urlsplit(self.path).path, username.lower())
        with AUTH_ATTEMPTS_LOCK:
            AUTH_ATTEMPTS.pop(key, None)

    def session_user(self):
        cookie = SimpleCookie()
        cookie.load(self.headers.get("Cookie", ""))
        morsel = cookie.get(COOKIE_NAME)
        if not morsel:
            return None
        token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
        now = int(time.time())
        with connect_database() as connection:
            return connection.execute(
                """
                SELECT users.id, users.username
                FROM sessions JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ? AND sessions.expires_at > ?
                """,
                (token_hash, now),
            ).fetchone()

    def session_cookie(self, token, max_age):
        secure = os.environ.get("BLOCKGRAM_COOKIE_SECURE", "").lower() in ("1", "true", "yes")
        value = f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"
        if secure:
            value += "; Secure"
        return ("Set-Cookie", value)

    def require_same_origin(self):
        if not self.check_same_origin():
            self.send_error_json(HTTPStatus.FORBIDDEN, "La solicitud debe provenir de esta misma página.")
            return False
        return True

    def require_user(self):
        user = self.session_user()
        if not user:
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "Inicia sesión para continuar.")
            return None
        return user

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/session":
            user = self.session_user()
            if not user:
                self.send_json(HTTPStatus.OK, {"authenticated": False})
                return
            self.send_json(HTTPStatus.OK, {"authenticated": True, "username": user["username"]})
            return
        if path == "/api/data":
            user = self.require_user()
            if user:
                if self.headers.get("X-Blockgram-Account") != user["username"]:
                    self.send_error_json(HTTPStatus.CONFLICT, "La sesión de esta pestaña pertenece a otra cuenta.")
                    return
                with connect_database() as connection:
                    row = connection.execute(
                        "SELECT document, revision FROM account_data WHERE user_id = ?", (user["id"],)
                    ).fetchone()
                if not row:
                    self.send_error_json(HTTPStatus.NOT_FOUND, "La cuenta no tiene un documento guardado.")
                    return
                document = json.loads(row["document"])
                document["_revision"] = row["revision"]
                self.send_json(HTTPStatus.OK, document)
            return
        if path in ("/", "/proyecto.html", "/proyecto.css", "/proyecto.js", "/auth.js"):
            filename = "proyecto.html" if path == "/" else path.lstrip("/")
            file_path = ROOT / filename
            try:
                body = file_path.read_bytes()
            except OSError:
                self.send_error_json(HTTPStatus.NOT_FOUND, "No se encontró el archivo solicitado.")
                return
            content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            if filename.endswith((".html", ".css", ".js")):
                content_type += "; charset=utf-8"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "No se encontró la ruta solicitada.")

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ("/api/register", "/api/login", "/api/logout"):
            self.send_error_json(HTTPStatus.NOT_FOUND, "No se encontró la ruta solicitada.")
            return
        if not self.require_same_origin():
            return
        try:
            document = self.read_json()
        except PayloadTooLargeError as error:
            self.send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, str(error))
            return
        except ValueError as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
            return

        if path == "/api/logout":
            user = self.session_user()
            if user and self.headers.get("X-Blockgram-Account") != user["username"]:
                self.send_error_json(HTTPStatus.CONFLICT, "La sesión de esta pestaña pertenece a otra cuenta.")
                return
            cookie = SimpleCookie()
            cookie.load(self.headers.get("Cookie", ""))
            morsel = cookie.get(COOKIE_NAME)
            if morsel:
                token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
                with connect_database() as connection:
                    connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            self.send_json(
                HTTPStatus.OK,
                {"ok": True},
                [self.session_cookie("", 0)],
            )
            return

        username = document.get("username")
        password = document.get("password")
        if not isinstance(username, str) or not isinstance(password, str):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Escribe un usuario y una contraseña.")
            return
        username = username.strip()
        if not USERNAME_PATTERN.fullmatch(username):
            self.send_error_json(
                HTTPStatus.BAD_REQUEST,
                "El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.",
            )
            return
        if len(password) > 128 or len(password.encode("utf-8")) > 512:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "La contraseña no puede superar 128 caracteres.")
            return
        if path == "/api/register" and len(password) < 10:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "La contraseña debe tener al menos 10 caracteres.")
            return
        if not self.check_auth_rate(username):
            self.send_error_json(HTTPStatus.TOO_MANY_REQUESTS, "Demasiados intentos. Espera un minuto e inténtalo de nuevo.")
            return

        with connect_database() as connection:
            if path == "/api/register":
                salt = secrets.token_bytes(16)
                try:
                    cursor = connection.execute(
                        """
                        INSERT INTO users (username, username_key, password_salt, password_hash, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (username, username.lower(), salt, hash_password(password, salt), int(time.time())),
                    )
                except sqlite3.IntegrityError:
                    self.send_error_json(HTTPStatus.CONFLICT, "Ese usuario ya está ocupado.")
                    return
                user_id = cursor.lastrowid
                connection.execute(
                    "INSERT INTO account_data (user_id, document, updated_at) VALUES (?, ?, ?)",
                    (user_id, default_document(), int(time.time())),
                )
                status = HTTPStatus.CREATED
            else:
                user = connection.execute(
                    "SELECT id, username, password_salt, password_hash FROM users WHERE username_key = ?",
                    (username.lower(),),
                ).fetchone()
                valid_password = bool(user) and hmac.compare_digest(
                    hash_password(password, user["password_salt"]),
                    user["password_hash"],
                )
                if not valid_password:
                    self.send_error_json(HTTPStatus.UNAUTHORIZED, "Usuario o contraseña incorrectos.")
                    return
                user_id = user["id"]
                username = user["username"]
                status = HTTPStatus.OK

            token = secrets.token_urlsafe(32)
            self.clear_auth_rate(username)
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
            connection.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (hashlib.sha256(token.encode("utf-8")).hexdigest(), user_id, int(time.time()) + SESSION_SECONDS),
            )
        self.send_json(
            status,
            {"username": username},
            [self.session_cookie(token, SESSION_SECONDS)],
        )

    def do_PUT(self):
        if urlsplit(self.path).path != "/api/data":
            self.send_error_json(HTTPStatus.NOT_FOUND, "No se encontró la ruta solicitada.")
            return
        if not self.require_same_origin():
            return
        user = self.require_user()
        if not user:
            return
        if self.headers.get("X-Blockgram-Account") != user["username"]:
            self.send_error_json(HTTPStatus.CONFLICT, "La sesión de esta pestaña pertenece a otra cuenta.")
            return
        try:
            document = self.read_json()
            expected_revision = document.get("expectedRevision")
            if not is_safe_integer(expected_revision) or expected_revision < 1:
                raise ValueError("La versión del documento no es válida.")
            stored_document = validate_account_document(document)
            serialized = json.dumps(stored_document, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        except PayloadTooLargeError as error:
            self.send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, str(error))
            return
        except (ValueError, TypeError, RecursionError) as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error) or "Los datos no tienen un formato válido.")
            return

        conflict = None
        with connect_database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT document, revision FROM account_data WHERE user_id = ?", (user["id"],)
            ).fetchone()
            if not row:
                self.send_error_json(HTTPStatus.NOT_FOUND, "La cuenta no tiene un documento guardado.")
                return
            if expected_revision != row["revision"]:
                conflict = {
                    "error": "El documento cambió en otro dispositivo.",
                    "revision": row["revision"],
                    "data": json.loads(row["document"]),
                }
            else:
                new_revision = row["revision"] + 1
                connection.execute(
                    """
                    UPDATE account_data
                    SET document = ?, updated_at = ?, revision = ?
                    WHERE user_id = ? AND revision = ?
                    """,
                    (serialized, int(time.time()), new_revision, user["id"], expected_revision),
                )
        if conflict:
            self.send_json(HTTPStatus.CONFLICT, conflict)
            return
        self.send_json(HTTPStatus.OK, {"ok": True, "revision": new_revision})

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")


def main():
    initialize_database()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), BlockgramHandler)
    print(f"Blockgram escuchando en http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrando Blockgram...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
