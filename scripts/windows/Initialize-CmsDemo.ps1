# 写入虚构演示账号与基础数据。口令只写入当前用户主目录下的受保护文件，不在终端显示。

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "CmsCommon.ps1")

$root = Get-CmsRoot
Set-Location -LiteralPath $root
Test-CmsNode
Import-CmsEnv -Path (Join-Path $root ".env")

$credDir = Join-Path $env:USERPROFILE ".cms-internal"
if (-not (Test-Path -LiteralPath $credDir)) {
  New-Item -ItemType Directory -Path $credDir | Out-Null
}
Protect-CmsFile -Path $credDir
$credFile = Join-Path $credDir "demo-credentials.txt"
$env:SEED_DEMO = "1"
$env:SEED_DEMO_CREDENTIALS_FILE = $credFile

& node (Join-Path $root "backend\dist\scripts\seed-demo.js")
if ($LASTEXITCODE -ne 0) {
  throw "演示数据写入失败。若库中已有同名演示账号，需要使用空库或自行清理后重试。"
}

if (Test-Path -LiteralPath $credFile) {
  Protect-CmsFile -Path $credFile
}

Write-Host "虚构演示账号已写入受保护文件（终端不显示密码）："
Write-Host $credFile
Write-Host "请用文本编辑器本地打开该文件查看用户名与口令，不要把文件发给他人或提交到仓库。"
