@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo 【公网链接】请先在本机另一个窗口运行: npm.cmd run dev
echo 本脚本会为 localhost 生成 https://xxx.trycloudflare.com 供外网访问。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\quick-public-url.ps1" -Port 3010
pause
