"""Десктопная версия «ИИ-наставника».

Запускается ярлыком с рабочего стола (pythonw — без консольного окна):
  1. если платформа уже работает на порту (например, в Docker) — подключается к ней;
  2. иначе поднимает сервер внутри этого процесса;
  3. открывает платформу отдельным окном приложения (Microsoft Edge / Chrome в режиме --app),
     со своим профилем — без адресной строки и вкладок;
  4. когда окно закрыто — останавливает сервер, если запускал его сам.
"""
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
PORT = int(os.environ.get("AIEDU_PORT", "8000"))
URL = f"http://127.0.0.1:{PORT}/"
LOG = os.path.join(ROOT, "data", "desktop.log")


def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")


def alive(url):
    try:
        with urllib.request.urlopen(url + "index.html", timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def port_busy(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def find_browser():
    cands = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles%\Yandex\YandexBrowser\Application\browser.exe"),
        os.path.expandvars(r"%LocalAppData%\Yandex\YandexBrowser\Application\browser.exe"),
    ]
    for c in cands:
        if os.path.exists(c):
            return c
    for name in ("msedge", "chrome", "chromium", "google-chrome", "chromium-browser"):
        p = shutil.which(name)
        if p:
            return p
    return None


def message(text):
    try:
        import tkinter
        from tkinter import messagebox
        root = tkinter.Tk()
        root.withdraw()
        messagebox.showerror("ИИ-наставник", text)
        root.destroy()
    except Exception:
        log("ERROR " + text)


def start_server():
    from server import app
    ready = threading.Event()

    def target():
        try:
            app.run("127.0.0.1", PORT, ready=ready)
        except Exception as e:  # noqa
            log(f"server error: {e!r}")
            ready.set()

    threading.Thread(target=target, daemon=True).start()
    ready.wait(15)
    for _ in range(50):
        if alive(URL):
            return True
        time.sleep(0.2)
    return False


def main():
    global PORT, URL
    own_server = False
    if not alive(URL):
        if port_busy(PORT):
            # порт занят чем-то другим — берём следующий свободный
            for p in range(PORT + 1, PORT + 50):
                if not port_busy(p):
                    PORT, URL = p, f"http://127.0.0.1:{p}/"
                    break
        if not start_server():
            message(f"Не удалось запустить сервер платформы. Подробности: {LOG}")
            return
        own_server = True
        log(f"server started on {URL}")
    else:
        log(f"connected to running platform {URL}")

    browser = find_browser()
    if not browser:
        webbrowser.open(URL)
        if own_server:
            message("Окно приложения требует Microsoft Edge или Chrome. Платформа открыта в браузере по умолчанию; "
                    "закройте это сообщение, чтобы остановить сервер.")
        return
    profile = os.path.join(ROOT, "data", "desktop-profile")
    os.makedirs(profile, exist_ok=True)
    args = [browser, f"--app={URL}", f"--user-data-dir={profile}", "--window-size=1440,900",
            "--no-first-run", "--no-default-browser-check", "--disable-features=Translate"]
    t0 = time.time()
    proc = subprocess.Popen(args)
    proc.wait()
    if own_server and time.time() - t0 < 4:
        # окно отдали уже открытому экземпляру — держим сервер, пока профиль используется
        lock = os.path.join(profile, "lockfile")
        while os.path.exists(lock):
            time.sleep(2)
    log("window closed")


if __name__ == "__main__":
    main()
