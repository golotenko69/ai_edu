"""Хранилище: SQLite (локальная замена PostgreSQL из архитектуры).

Журнал событий хранится в отдельной таблице events, как и предполагает
архитектура: это самый объёмный поток данных.
"""
import json
import os
import sqlite3
import threading
import time

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.environ.get("AIEDU_DB", os.path.join(DATA_DIR, "aiedu.sqlite3"))

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    login TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student','teacher','admin')),
    group_id INTEGER REFERENCES groups(id)
);
CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    group_id INTEGER REFERENCES groups(id),
    teacher_id INTEGER REFERENCES users(id),
    materials TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'python',
    starter_code TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'hints',
    live_mode TEXT,
    rules TEXT NOT NULL DEFAULT '{}',
    tests TEXT NOT NULL DEFAULT '[]',
    kind TEXT NOT NULL DEFAULT 'study' CHECK (kind IN ('study','control')),
    control_active INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    started_at REAL NOT NULL,
    ended_at REAL,
    last_activity REAL NOT NULL,
    mode_override TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    code TEXT NOT NULL DEFAULT '',
    agent_lines TEXT NOT NULL DEFAULT '[]',
    hints_used INTEGER NOT NULL DEFAULT 0,
    workplace TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts REAL NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, id);
CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'insert',
    fragment TEXT NOT NULL DEFAULT '',
    question TEXT NOT NULL,
    answer TEXT,
    score REAL,
    passed INTEGER,
    feedback TEXT,
    created_at REAL NOT NULL,
    answered_at REAL
);
CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    results TEXT NOT NULL DEFAULT '{}',
    passed INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    grade TEXT,
    comment TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'python',
    mode TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ws_events (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ts REAL NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ws_events_project ON ws_events(project_id, id);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def connect():
    conn = getattr(_local, "conn", None)
    if conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 30000")
        _local.conn = conn
    return conn


def init():
    connect().executescript(SCHEMA)


def q(sql, params=()):
    return [dict(r) for r in connect().execute(sql, params).fetchall()]


def q1(sql, params=()):
    r = connect().execute(sql, params).fetchone()
    return dict(r) if r else None


def ex(sql, params=()):
    cur = connect().execute(sql, params)
    return cur.lastrowid


def log_event(session_id, etype, payload=None):
    now = time.time()
    ex("INSERT INTO events (session_id, ts, type, payload) VALUES (?,?,?,?)",
       (session_id, now, etype, json.dumps(payload or {}, ensure_ascii=False)))
    ex("UPDATE sessions SET last_activity=? WHERE id=?", (now, session_id))


def get_setting(key, default=None):
    r = q1("SELECT value FROM settings WHERE key=?", (key,))
    if not r:
        return default
    try:
        return json.loads(r["value"])
    except ValueError:
        return r["value"]


def set_setting(key, value):
    ex("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
       (key, json.dumps(value, ensure_ascii=False)))
