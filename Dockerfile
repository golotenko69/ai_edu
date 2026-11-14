# ИИ-наставник по программированию — образ платформы
# Содержит Python (сервер и запуск кода студентов) и g++ (задания на C++).
FROM python:3.12-slim

LABEL org.opencontainers.image.title="ai-nastavnik" \
      org.opencontainers.image.description="ИИ-наставник по программированию для вузов и колледжей: агент по правилам преподавателя, проверка понимания, запись сессий" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    AIEDU_IN_DOCKER=1 \
    AIEDU_DB=/app/data/aiedu.sqlite3

RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY run.py ./
COPY server ./server
COPY web ./web

# непривилегированный пользователь: код студентов не получает root внутри контейнера
RUN useradd --create-home --uid 10001 aiedu \
 && mkdir -p /app/data \
 && chown -R aiedu:aiedu /app/data
USER aiedu

VOLUME ["/app/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/index.html',timeout=4)" || exit 1

CMD ["python", "run.py", "--host", "0.0.0.0", "--port", "8000"]
