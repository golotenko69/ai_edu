@echo off
rem Клиент для компьютера класса в режиме киоска (Microsoft Edge).
rem Использование: kiosk_client.bat http://адрес-сервера:8000
set URL=%1
if "%URL%"=="" set URL=http://localhost:8000
start "" "C:\Program Files (x86)\Microsoftdge\Application\msedge.exe" --kiosk %URL% --edge-kiosk-type=fullscreen --no-first-run --disable-features=Translate
