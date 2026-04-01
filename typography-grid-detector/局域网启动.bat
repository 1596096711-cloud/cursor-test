@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
echo.
echo 正在启动（局域网可访问）。若防火墙提示，请允许 Node.js。
echo 若其它电脑仍无法打开，请右键本脚本「以管理员身份运行」一次，或查看 DEPLOY.md
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-lan.ps1"
pause
