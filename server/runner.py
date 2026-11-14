"""Запуск кода студентов и автотесты.

В архитектуре код запускается в изолированных Docker-контейнерах. В локальном
прототипе код запускается отдельным процессом во временной папке с лимитом
времени и вывода. Если установлен Docker и в настройках включён режим
docker, используется контейнер без сети и с ограничением памяти/CPU.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time

from . import db

MAX_OUTPUT = 20000


def _cfg():
    c = db.get_setting("runner") or {}
    in_container = os.path.exists("/.dockerenv") or os.environ.get("AIEDU_IN_DOCKER") == "1"
    return {
        "timeout": float(c.get("timeout", 5)),
        # внутри контейнера платформы код и так изолирован контейнером; Docker-in-Docker не используем
        "use_docker": bool(c.get("use_docker", False)) and not in_container,
        "docker_python_image": c.get("docker_python_image", "python:3.12-slim"),
        "docker_cpp_image": c.get("docker_cpp_image", "gcc:13"),
    }


def find_cpp_compiler():
    for name in ("g++", "clang++"):
        p = shutil.which(name)
        if p:
            return p
    # частые места установки MinGW / MSYS2 на Windows
    for p in (r"C:\msys64\ucrt64\bin\g++.exe", r"C:\msys64\mingw64\bin\g++.exe", r"C:\MinGW\bin\g++.exe",
              r"C:\Program Files\LLVM\bin\clang++.exe"):
        if os.path.exists(p):
            return p
    return None


def languages_status():
    return {
        "python": {"available": True, "info": sys.version.split()[0]},
        "cpp": {"available": bool(find_cpp_compiler()) or _cfg()["use_docker"],
                "info": find_cpp_compiler() or ("docker" if _cfg()["use_docker"] else
                                                "компилятор g++/clang++ не найден")},
    }


def _clip(s):
    if len(s) > MAX_OUTPUT:
        return s[:MAX_OUTPUT] + "\n…[вывод обрезан]"
    return s


def _run(cmd, stdin, timeout, cwd, env=None):
    t = time.time()
    try:
        p = subprocess.run(cmd, input=stdin.encode("utf-8"), capture_output=True, timeout=timeout, cwd=cwd,
                           env=env, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return {
            "stdout": _clip(p.stdout.decode("utf-8", "replace")),
            "stderr": _clip(p.stderr.decode("utf-8", "replace")),
            "exit_code": p.returncode,
            "timeout": False,
            "time": round(time.time() - t, 3),
        }
    except subprocess.TimeoutExpired as e:
        return {
            "stdout": _clip((e.stdout or b"").decode("utf-8", "replace")),
            "stderr": f"Превышено время выполнения ({timeout:g} с). Возможно, бесконечный цикл?",
            "exit_code": -1,
            "timeout": True,
            "time": round(time.time() - t, 3),
        }
    except FileNotFoundError as e:
        return {"stdout": "", "stderr": f"Не найдена программа: {e}", "exit_code": -1, "timeout": False, "time": 0}


def run_code(code, language, stdin="", timeout=None):
    cfg = _cfg()
    timeout = timeout or cfg["timeout"]
    with tempfile.TemporaryDirectory(prefix="aiedu_") as d:
        env = {k: v for k, v in os.environ.items() if k.upper() in
               ("PATH", "SYSTEMROOT", "TEMP", "TMP", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "HOME")}
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        if language == "python":
            path = os.path.join(d, "main.py")
            with open(path, "w", encoding="utf-8") as f:
                f.write(code)
            if cfg["use_docker"]:
                cmd = ["docker", "run", "--rm", "-i", "--network", "none", "--memory", "128m", "--cpus", "0.5",
                       "-v", f"{d}:/w", "-w", "/w", cfg["docker_python_image"], "python", "-I", "main.py"]
                return _run(cmd, stdin, timeout + 5, d)
            return _run([sys.executable, "-I", "-X", "utf8", path], stdin, timeout, d, env)
        if language == "cpp":
            src = os.path.join(d, "main.cpp")
            with open(src, "w", encoding="utf-8") as f:
                f.write(code)
            if cfg["use_docker"]:
                cmd = ["docker", "run", "--rm", "-i", "--network", "none", "--memory", "256m", "--cpus", "0.5",
                       "-v", f"{d}:/w", "-w", "/w", cfg["docker_cpp_image"], "sh", "-c",
                       "g++ -O2 -std=c++17 -o main main.cpp && ./main"]
                return _run(cmd, stdin, timeout + 20, d)
            cxx = find_cpp_compiler()
            if not cxx:
                return {"stdout": "", "exit_code": -1, "timeout": False, "time": 0,
                        "stderr": "Компилятор C++ не найден. Установите MinGW-w64/MSYS2 (g++) или LLVM (clang++) "
                                  "и добавьте его в PATH, либо включите запуск в Docker в настройках."}
            exe = os.path.join(d, "main.exe" if os.name == "nt" else "main")
            env["PATH"] = os.path.dirname(cxx) + os.pathsep + env.get("PATH", "")
            comp = _run([cxx, "-O2", "-std=c++17", "-o", exe, src], "", 60, d, env)
            if comp["exit_code"] != 0:
                comp["stderr"] = "Ошибка компиляции:\n" + comp["stderr"]
                comp["compile_error"] = True
                return comp
            return _run([exe], stdin, timeout, d, env)
        return {"stdout": "", "stderr": f"Язык {language} не поддерживается", "exit_code": -1, "timeout": False,
                "time": 0}


def _norm(s):
    return "\n".join(ln.rstrip() for ln in s.replace("\r\n", "\n").strip().split("\n"))


def run_tests(code, language, tests, reveal_hidden=False):
    """tests: [{input, expected, hidden}] → {passed, total, cases:[...]}"""
    cases = []
    passed = 0
    for i, t in enumerate(tests):
        r = run_code(code, language, t.get("input", ""))
        ok = r["exit_code"] == 0 and _norm(r["stdout"]) == _norm(t.get("expected", ""))
        passed += ok
        hidden = bool(t.get("hidden")) and not reveal_hidden
        case = {"n": i + 1, "ok": ok, "hidden": bool(t.get("hidden")), "time": r["time"],
                "timeout": r["timeout"]}
        if not hidden:
            case.update({"input": t.get("input", ""), "expected": t.get("expected", ""),
                         "actual": r["stdout"], "stderr": r["stderr"][-2000:]})
        elif not ok:
            case["stderr"] = "Скрытый тест не пройден" + (" (ошибка выполнения)" if r["exit_code"] else "")
        cases.append(case)
        if r.get("compile_error"):
            # нет смысла гонять остальные тесты
            for j in range(i + 1, len(tests)):
                cases.append({"n": j + 1, "ok": False, "hidden": bool(tests[j].get("hidden")),
                              "stderr": "Не скомпилировано"})
            break
    return {"passed": passed, "total": len(tests), "cases": cases}
