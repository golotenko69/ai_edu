"""Запуск платформы «ИИ-наставник»: python run.py [--host 0.0.0.0] [--port 8000]"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server import app  # noqa: E402

if __name__ == "__main__":
    p = argparse.ArgumentParser(description="ИИ-наставник по программированию — локальный сервер")
    p.add_argument("--host", default="127.0.0.1",
                   help="127.0.0.1 — только этот ПК; 0.0.0.0 — доступ компьютерам класса по сети")
    p.add_argument("--port", type=int, default=8000)
    a = p.parse_args()
    app.run(a.host, a.port)
