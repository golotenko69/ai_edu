@echo off
chcp 65001 >nul
cd /d "%~dp0"
python desktop\install_shortcut.py
pause
