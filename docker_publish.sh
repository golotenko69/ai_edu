#!/bin/sh
# Публикация образа в Docker Hub: ./docker_publish.sh ВАШ_ЛОГИН [тег]
set -e
[ -z "$1" ] && { echo "Укажите логин Docker Hub: ./docker_publish.sh ВАШ_ЛОГИН [тег]"; exit 1; }
USER="$1"; TAG="${2:-latest}"
cd "$(dirname "$0")"
docker login
docker buildx create --name aiedu-builder --use 2>/dev/null || docker buildx use aiedu-builder
docker buildx build --platform linux/amd64,linux/arm64 -t "$USER/ai-nastavnik:$TAG" -t "$USER/ai-nastavnik:latest" --push .
echo "Готово: docker pull $USER/ai-nastavnik:$TAG"
