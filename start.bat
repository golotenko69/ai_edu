@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запуск ИИ-наставника на http://localhost:8000
start "" http://localhost:8000
python run.py %*
pause
