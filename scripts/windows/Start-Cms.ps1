# 在本机回环地址启动服务。不会修改防火墙，默认绑定 127.0.0.1。

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "CmsCommon.ps1")

$root = Get-CmsRoot
Set-Location -LiteralPath $root
Test-CmsNode
Import-CmsEnv -Path (Join-Path $root ".env")

if (-not $env:HOST) { $env:HOST = "127.0.0.1" }
if (-not $env:PORT) { $env:PORT = "13082" }
if (-not $env:SERVE_STATIC) { $env:SERVE_STATIC = "true" }

$pidPath = Get-CmsPidPath -Root $root
if (Test-Path -LiteralPath $pidPath) {
  $oldId = [int]((Get-Content -LiteralPath $pidPath -Encoding ASCII | Select-Object -First 1).Trim())
  $existing = Get-Process -Id $oldId -ErrorAction SilentlyContinue
  if ($existing) {
    throw "服务似乎已在运行（PID 文件存在）。请先运行 scripts\Stop-Cms.ps1"
  }
  Remove-Item -LiteralPath $pidPath -Force
}

$logDir = Join-Path $root "logs"
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}
$outLog = Join-Path $logDir "cms.out.log"
$errLog = Join-Path $logDir "cms.err.log"

$entry = Join-Path $root "backend\dist\index.js"
$proc = Start-Process -FilePath "node" -ArgumentList @($entry) -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Set-Content -LiteralPath $pidPath -Value ([string]$proc.Id) -Encoding ASCII

$origin = "http://$($env:HOST):$($env:PORT)"
Write-Host "已启动本机服务，PID $($proc.Id)。访问地址：$origin"
Write-Host "正在检查 /health ..."

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 400
  if ($proc.HasExited) { break }
  try {
    $resp = Invoke-WebRequest -Uri "$origin/health" -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
      $ok = $true
      break
    }
  } catch {
    # 继续等待
  }
}

if (-not $ok) {
  Write-Host "进程未能通过健康检查。请查看 logs\\cms.err.log（其中不应出现数据库口令；若看到连接失败，请核对端口与用户是否与实际 PostgreSQL 一致）。"
  if ($proc.HasExited) {
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    throw "服务进程已退出，退出码 $($proc.ExitCode)"
  }
  throw "服务已启动但健康检查未通过，请检查日志后使用 Stop-Cms.ps1 停止。"
}

Write-Host "健康检查通过。这是本机内测，数据若经过演示初始化则为虚构账号。"
