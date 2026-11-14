@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Публикация образа в Docker Hub: docker_publish.bat ВАШ_ЛОГИН [тег]
if "%1"=="" (echo Укажите логин Docker Hub: docker_publish.bat ВАШ_ЛОГИН [тег] & exit /b 1)
set USER=%1
set TAG=%2
if "%TAG%"=="" set TAG=latest
echo Вход в Docker Hub (если ещё не выполнен)...
docker login || exit /b 1
docker buildx create --name aiedu-builder --use 2>nul || docker buildx use aiedu-builder
docker buildx build --platform linux/amd64,linux/arm64 -t %USER%/ai-nastavnik:%TAG% -t %USER%/ai-nastavnik:latest --push . || exit /b 1
echo.
echo Готово: docker pull %USER%/ai-nastavnik:%TAG%
