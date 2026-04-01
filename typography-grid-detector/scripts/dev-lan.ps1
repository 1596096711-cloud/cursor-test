# 局域网开发：尝试放行防火墙并启动 Next（建议在「以管理员身份运行」的 PowerShell 中执行）
$ErrorActionPreference = "Continue"
# 新安装的 Node 若当前终端尚未刷新 PATH，仍能找到 npm
$nodeDir = "C:\Program Files\nodejs"
if (Test-Path $nodeDir) {
  $env:Path = "$nodeDir;$env:Path"
}
$Port = if ($env:PORT) { [int]$env:PORT } else { 3010 }
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "=== 排版分析器 · 局域网访问 ===" -ForegroundColor Cyan
Write-Host "固定端口: $Port （请用 http://本机IP:${Port} 访问，不要省略端口）`n"

try {
  $existing = Get-NetFirewallRule -DisplayName "Next.js Dev $Port" -ErrorAction SilentlyContinue
  if (-not $existing) {
    New-NetFirewallRule -DisplayName "Next.js Dev $Port" -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow | Out-Null
    Write-Host "[OK] 已添加防火墙入站规则 TCP $Port" -ForegroundColor Green
  } else {
    Write-Host "[OK] 防火墙规则已存在: Next.js Dev $Port" -ForegroundColor Green
  }
} catch {
  Write-Host "[提示] 未能自动添加防火墙（可忽略）。若其它电脑无法连接，请以管理员打开 PowerShell 执行：" -ForegroundColor Yellow
  Write-Host "  New-NetFirewallRule -DisplayName 'Next.js Dev $Port' -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow" -ForegroundColor Gray
}

Write-Host "`n本机 IPv4（在**运行服务的电脑**上查看；别人用浏览器打开 http://下列任一IP:${Port} ）:" -ForegroundColor Cyan
try {
  Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*"
    } |
    Sort-Object InterfaceMetric |
    ForEach-Object { Write-Host "  http://$($_.IPAddress):$Port" }
} catch {
  ipconfig | findstr /i "IPv4"
}

Write-Host "`n另一台电脑请先测: http://IP:$Port/api/health 应显示 {""ok"":true ...}`n" -ForegroundColor DarkGray

Set-Location $Root
& npm.cmd run dev:lan
