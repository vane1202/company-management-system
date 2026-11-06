# 生成本机 .env（不含示例密钥）。数据库口令通过安全输入，不打印到终端。
# 用法示例：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\New-CmsEnv.ps1 -DbPort 15434 -AppPort 13082

[CmdletBinding()]
param(
  [string]$DbHost = "127.0.0.1",
  [int]$DbPort = 15434,
  [string]$DbName = "cms",
  [string]$DbUser = "cms",
  [SecureString]$DbPassword,
  [int]$AppPort = 13082,
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "CmsCommon.ps1")

$root = Get-CmsRoot
$envPath = Join-Path $root ".env"
if ((Test-Path -LiteralPath $envPath) -and -not $Force) {
  throw ".env 已存在。若确认覆盖，请加上 -Force（不会在终端显示其中的密钥）。"
}

if (-not $DbPassword) {
  $DbPassword = Read-Host "请输入本机 PostgreSQL 用户 $DbUser 的密码（不回显）" -AsSecureString
}
$plain = ConvertFrom-CmsSecureString -Secure $DbPassword
if ([string]::IsNullOrWhiteSpace($plain)) {
  throw "数据库密码不能为空"
}

$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$sessionSecret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
$encodedUser = [uri]::EscapeDataString($DbUser)
$encodedPass = [uri]::EscapeDataString($plain)
$databaseUrl = "postgres://${encodedUser}:${encodedPass}@${DbHost}:${DbPort}/${DbName}"
$origin = "http://127.0.0.1:$AppPort"

# 尽快丢掉明文密码变量
$plain = $null
$encodedPass = $null

$lines = @(
  "# 本机内测配置。不要提交、不要发送、不要打印。",
  "# 本安装绑定 127.0.0.1，演示数据为虚构，备份不加密，无 Cloudflare 同步，非正式生产。",
  "NODE_ENV=production",
  "HOST=127.0.0.1",
  "PORT=$AppPort",
  "APP_ORIGIN=$origin",
  "BUSINESS_TIMEZONE=Asia/Shanghai",
  "FAN_REPORT_BACKFILL_DAYS=3",
  "SERVE_STATIC=true",
  "TRUST_PROXY=0",
  "COOKIE_SECURE=false",
  "COOKIE_SAMESITE=lax",
  "SESSION_SECRET=$sessionSecret",
  "DATABASE_URL=$databaseUrl",
  "LOGIN_WINDOW_MS=900000",
  "LOGIN_MAX_ATTEMPTS=8"
)

Set-Content -LiteralPath $envPath -Value $lines -Encoding UTF8
Protect-CmsFile -Path $envPath
Write-Host "已生成本机配置文件（仅当前 Windows 用户可读写）。"
Write-Host "监听地址将是 $origin （127.0.0.1）。数据库主机 ${DbHost}:${DbPort}，库名 $DbName。"
Write-Host "未在终端显示 SESSION_SECRET 或数据库口令。"
