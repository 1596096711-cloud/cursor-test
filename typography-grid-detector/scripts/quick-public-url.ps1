# 生成本地服务的公网 HTTPS 预览链接（需已安装 cloudflared，且本机 Next 已在运行）
param(
  [int]$Port = 3010
)
$ErrorActionPreference = "Continue"
$local = "http://127.0.0.1:$Port"

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  Write-Host ""
  Write-Host "未找到 cloudflared。请先安装后再运行本脚本：" -ForegroundColor Yellow
  Write-Host "  winget install --id Cloudflare.cloudflared" -ForegroundColor Gray
  Write-Host "安装完成后重新打开终端，再执行本脚本。" -ForegroundColor Gray
  Write-Host "文档: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/" -ForegroundColor DarkGray
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "=== 公网预览（Quick Tunnel）===" -ForegroundColor Cyan
Write-Host "请确认本机已启动网站: npm.cmd run dev  （默认端口 $Port）" -ForegroundColor DarkGray
Write-Host "正在把 $local 映射到公网 HTTPS，请勿关闭本窗口…" -ForegroundColor DarkGray
Write-Host "终端稍后会打印 https://xxxx.trycloudflare.com —— 把该链接发给任意电脑即可访问。" -ForegroundColor Green
Write-Host ""

& cloudflared tunnel --url $local
