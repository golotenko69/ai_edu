@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Сборка и запуск ИИ-наставника в Docker...
docker compose up -d --build || (pause & exit /b 1)
echo Платформа: http://localhost:8000
start "" http://localhost:8000
