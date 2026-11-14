"""Вход, роли, токены. В архитектуре — LDAP/AD вуза; в прототипе — локальные учётки."""
import hashlib
import hmac
import os
import secrets
import time

from . import db

TOKEN_TTL = 14 * 24 * 3600


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()
    return f"{salt}${h}"


def check_password(password, stored):
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(hash_password(password, salt), stored)


def login(login_name, password):
    u = db.q1("SELECT * FROM users WHERE login=?", (login_name.strip(),))
    if not u or not check_password(password, u["password_hash"]):
        return None, None
    token = secrets.token_urlsafe(32)
    db.ex("INSERT INTO tokens (token, user_id, created_at) VALUES (?,?,?)", (token, u["id"], time.time()))
    return token, public_user(u)


def logout(token):
    db.ex("DELETE FROM tokens WHERE token=?", (token,))


def user_by_token(token):
    if not token:
        return None
    r = db.q1("SELECT u.*, t.created_at AS token_created FROM tokens t JOIN users u ON u.id=t.user_id "
              "WHERE t.token=?", (token,))
    if not r or time.time() - r["token_created"] > TOKEN_TTL:
        return None
    return public_user(r)


def public_user(u):
    g = db.q1("SELECT name FROM groups WHERE id=?", (u["group_id"],)) if u.get("group_id") else None
    return {"id": u["id"], "login": u["login"], "name": u["name"], "role": u["role"],
            "group_id": u.get("group_id"), "group": g["name"] if g else None}


def create_user(login_name, password, name, role, group_id=None):
    return db.ex("INSERT INTO users (login, password_hash, name, role, group_id) VALUES (?,?,?,?,?)",
                 (login_name.strip(), hash_password(password), name.strip(), role, group_id))
