@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo 未找到 Node.js。请先安装 LTS：https://nodejs.org
  echo 或用 winget：winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo 首次运行：正在安装依赖...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
if not exist "api-credentials.env" (
  copy /Y "api-credentials.env.example" "api-credentials.env" >nul
  echo 已创建 api-credentials.env — 请用「记事本」打开此文件，在 OPENAI_API_KEY= 后填写密钥并保存。
  echo.
)
echo.
echo 本脚本已将开发端口固定为 3010（避免与其它占用 3000 的程序混淆）。
echo 请在浏览器打开 http://localhost:3010
echo 若你改动了端口参数，以终端里 Next 打印的 Local 行为准。
echo 按 Ctrl+C 停止服务。
echo.
call npm run dev
