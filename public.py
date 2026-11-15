"""Публичная ссылка для теста: платформа на этом ПК + бесплатный туннель Cloudflare.

  python public.py            — запустить и получить ссылку https://….trycloudflare.com
  python public.py --reset    — выдать новые пароли демо-учёткам

Работает отдельный экземпляр со своими данными (data/public/), а не с данными десктопной версии.
Пароли демо-учёток заменяются случайными и сохраняются в data/public/passwords.txt.
На странице входа демо-кнопки скрыты. Ссылка живёт, пока открыто это окно.

Внимание: агент запускает код на этом компьютере. Давайте ссылку и пароли только тем, кому доверяете.
"""
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
PUB_DIR = os.path.join(ROOT, "data", "public")
os.makedirs(PUB_DIR, exist_ok=True)
os.environ["AIEDU_PUBLIC"] = "1"
os.environ.setdefault("AIEDU_DB", os.path.join(PUB_DIR, "aiedu.sqlite3"))
os.environ.setdefault("AIEDU_LLM_PROVIDER", "openai")
os.environ.setdefault("AIEDU_LLM_BASE_URL", "http://127.0.0.1:11434/v1")
os.environ.setdefault("AIEDU_LLM_MODEL", "qwen2.5-coder:3b")
sys.path.insert(0, ROOT)

from server import app, auth, db, seed  # noqa: E402

PORT = int(os.environ.get("AIEDU_PUBLIC_PORT", "8050"))
PASSWORDS = os.path.join(PUB_DIR, "passwords.txt")
URL_FILE = os.path.join(PUB_DIR, "url.txt")
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def setup_accounts(reset=False):
    db.init()
    first = seed.seed_if_empty()
    if first:
        cfg = db.get_setting("llm") or {}
        main = dict(cfg.get("main") or {})
        main["timeout"] = 300
        cfg["main"] = main
        db.set_setting("llm", cfg)
    if os.path.exists(PASSWORDS) and not reset:
        return
    lines = []
    for u in db.q("SELECT id, login, name, role FROM users ORDER BY id"):
        pw = secrets.token_urlsafe(9)
        db.ex("UPDATE users SET password_hash=? WHERE id=?", (auth.hash_password(pw), u["id"]))
        db.ex("DELETE FROM tokens WHERE user_id=?", (u["id"],))
        lines.append(f"{u['login']:<10} {pw:<14} {u['role']:<8} {u['name']}")
    with open(PASSWORDS, "w", encoding="utf-8") as f:
        f.write("Логин      Пароль         Роль     Имя\n" + "\n".join(lines) + "\n")


def find_cloudflared():
    for c in (r"D:\cloudflared\cloudflared.exe", os.path.join(ROOT, "cloudflared.exe")):
        if os.path.exists(c):
            return c
    return shutil.which("cloudflared")


def ollama_alive():
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/version", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def main():
    setup_accounts(reset="--reset" in sys.argv)
    exe = find_cloudflared()
    if not exe:
        print("Не найден cloudflared. Скачайте cloudflared-windows-amd64.exe с "
              "https://github.com/cloudflare/cloudflared/releases и положите как D:\\cloudflared\\cloudflared.exe")
        return 1
    if not ollama_alive():
        print("! Ollama не отвечает на 127.0.0.1:11434 — запустите её, иначе агент не сможет отвечать.")

    ready = threading.Event()
    threading.Thread(target=app.run, args=("127.0.0.1", PORT), kwargs={"ready": ready}, daemon=True).start()
    ready.wait(15)

    proc = subprocess.Popen([exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{PORT}"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                            errors="replace")
    url = None
    try:
        for line in proc.stdout:
            if os.environ.get("AIEDU_VERBOSE"):
                print(line.rstrip())
            m = URL_RE.search(line)
            if m and not url:
                url = m.group(0)
                with open(URL_FILE, "w", encoding="utf-8") as f:
                    f.write(url + "\n")
                print("\n" + "=" * 60)
                print(f"  Ссылка для теста:  {url}")
                print(f"  Пароли учёток:     {PASSWORDS}")
                print("  Закройте это окно (Ctrl+C), чтобы отключить доступ.")
                print("=" * 60 + "\n", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        proc.terminate()
        try:
            os.remove(URL_FILE)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
