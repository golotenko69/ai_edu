@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Сервер доступен компьютерам класса: http://IP-этого-ПК:8000
python run.py --host 0.0.0.0 %*
pause
