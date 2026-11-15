@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Публичная ссылка для теста (Cloudflare Tunnel). Закройте окно, чтобы отключить доступ.
where py >nul 2>nul && (py public.py %*) || (python public.py %*)
pause
