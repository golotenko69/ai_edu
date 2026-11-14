"""Слой-адаптер языковых моделей.

Агент обращается к единому интерфейсу chat(role, messages), а конкретная
модель подключается настройкой. Поддерживаются:

* openai  — любой OpenAI-совместимый сервер: Ollama (/v1), LM Studio,
            llama.cpp server, vLLM, LocalAI, а также облачные API с таким
            протоколом;
* mock    — демо-режим без модели: детерминированные ответы, чтобы
            платформа работала сразу после установки.

Две роли: main (ответы студенту) и checker (проверка ответов агента,
вопросы и оценка объяснений). Для checker можно указать более лёгкую модель.
"""
import json
import re
import urllib.error
import urllib.request

from . import db

import os

# В Docker-контейнере «localhost» — это сам контейнер, а модель обычно работает на хосте.
IN_DOCKER = os.path.exists("/.dockerenv") or os.environ.get("AIEDU_IN_DOCKER") == "1"
_HOST = "host.docker.internal" if IN_DOCKER else "localhost"

PRESETS = {
    "ollama": os.environ.get("AIEDU_OLLAMA_URL", f"http://{_HOST}:11434/v1"),
    "lmstudio": f"http://{_HOST}:1234/v1",
    "llamacpp": f"http://{_HOST}:8080/v1",
    "vllm": f"http://{_HOST}:8000/v1",
}

# Начальные настройки можно задать переменными окружения (удобно для docker-compose):
#   AIEDU_LLM_PROVIDER=openai  AIEDU_LLM_BASE_URL=http://ollama:11434/v1  AIEDU_LLM_MODEL=qwen2.5-coder:7b
#   AIEDU_LLM_API_KEY=...      AIEDU_CHECKER_MODEL=qwen2.5:3b (иначе контролёр = основная модель)
# Настройки, сохранённые в панели преподавателя, имеют приоритет.
_env_provider = os.environ.get("AIEDU_LLM_PROVIDER") or ("openai" if os.environ.get("AIEDU_LLM_MODEL") else "mock")
_env_base = os.environ.get("AIEDU_LLM_BASE_URL", PRESETS["ollama"])
DEFAULT_CFG = {
    "main": {"provider": _env_provider, "base_url": _env_base, "api_key": os.environ.get("AIEDU_LLM_API_KEY", ""),
             "model": os.environ.get("AIEDU_LLM_MODEL", ""), "temperature": 0.3, "timeout": 180},
    "checker": {"same_as_main": not os.environ.get("AIEDU_CHECKER_MODEL"), "provider": _env_provider,
                "base_url": os.environ.get("AIEDU_CHECKER_BASE_URL", _env_base),
                "api_key": os.environ.get("AIEDU_LLM_API_KEY", ""),
                "model": os.environ.get("AIEDU_CHECKER_MODEL", ""), "temperature": 0.0, "timeout": 120},
}


class LLMError(Exception):
    pass


def get_config():
    cfg = db.get_setting("llm")
    out = json.loads(json.dumps(DEFAULT_CFG))
    if isinstance(cfg, dict):
        for role in ("main", "checker"):
            out[role].update(cfg.get(role) or {})
    return out


def role_config(role):
    cfg = get_config()
    if role == "checker" and cfg["checker"].get("same_as_main"):
        c = dict(cfg["main"])
        c["temperature"] = 0.0
        return c
    return cfg[role]


def is_mock(role="main"):
    return role_config(role).get("provider") == "mock"


def _strip_think(text):
    # модели-«размышлялки» (DeepSeek-R1, Qwen3) выводят рассуждения в <think>
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    return text.strip()


def _http_json(url, payload=None, api_key="", timeout=60):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json")
    if api_key:
        req.add_header("Authorization", "Bearer " + api_key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:500]
        raise LLMError(f"HTTP {e.code} от {url}: {body}")
    except urllib.error.URLError as e:
        raise LLMError(f"Нет связи с моделью ({url}): {e.reason}")
    except TimeoutError:
        raise LLMError(f"Модель не ответила за {timeout} с ({url})")
    except ValueError:
        raise LLMError(f"Некорректный ответ сервера модели ({url})")


def chat_message(role, messages, tools=None, temperature=None, max_tokens=2000):
    """Низкоуровневый вызов: вернуть message-объект модели (content + tool_calls).
    tools — описание функций в формате OpenAI; поддерживают Ollama, LM Studio, vLLM, llama.cpp."""
    c = role_config(role)
    if not c.get("model"):
        raise LLMError("Не указано имя модели в настройках")
    url = c["base_url"].rstrip("/") + "/chat/completions"
    payload = {
        "model": c["model"],
        "messages": messages,
        "temperature": c.get("temperature", 0.3) if temperature is None else temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    data = _http_json(url, payload, c.get("api_key", ""), timeout=float(c.get("timeout") or 180))
    try:
        msg = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        raise LLMError("Неожиданный формат ответа модели: " + json.dumps(data, ensure_ascii=False)[:300])
    msg = dict(msg)
    msg["content"] = _strip_think(msg.get("content") or "")
    return msg


def chat(role, messages, temperature=None, max_tokens=1200, mock=None):
    """Отправить диалог модели. mock — функция, которая формирует ответ в демо-режиме."""
    c = role_config(role)
    if c.get("provider") == "mock":
        if mock is None:
            return "(демо-режим: модель не подключена)"
        return mock(messages)
    if not c.get("model"):
        raise LLMError("Не указано имя модели в настройках")
    url = c["base_url"].rstrip("/") + "/chat/completions"
    payload = {
        "model": c["model"],
        "messages": messages,
        "temperature": c.get("temperature", 0.3) if temperature is None else temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    data = _http_json(url, payload, c.get("api_key", ""), timeout=float(c.get("timeout") or 180))
    try:
        text = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise LLMError("Неожиданный формат ответа модели: " + json.dumps(data, ensure_ascii=False)[:300])
    return _strip_think(text)


def chat_json(role, messages, mock=None, max_tokens=600):
    """Запрос, ожидающий JSON-объект в ответе. Возвращает dict (или {} при ошибке разбора)."""
    text = chat(role, messages, temperature=0.0, max_tokens=max_tokens,
                mock=(lambda m: json.dumps(mock(m), ensure_ascii=False)) if mock else None)
    return parse_json(text)


def parse_json(text):
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if m:
        text = m.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        return {}
    try:
        return json.loads(text[start:end + 1])
    except ValueError:
        return {}


def list_models(base_url, api_key=""):
    data = _http_json(base_url.rstrip("/") + "/models", None, api_key, timeout=8)
    return sorted(m.get("id") for m in data.get("data", []) if m.get("id"))


def test_connection(role):
    c = role_config(role)
    if c.get("provider") == "mock":
        return {"ok": True, "message": "Демо-режим без модели: работает всегда"}
    import time
    t = time.time()
    text = chat(role, [{"role": "user", "content": "Ответь одним словом: работает?"}], max_tokens=30)
    return {"ok": True, "message": f"Ответ за {time.time() - t:.1f} с: {text[:120]}"}
