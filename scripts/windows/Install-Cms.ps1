# 在解压目录安装生产依赖（npm ci --omit=dev）。需要能访问 npm 仓库的网络。
# 本包依赖均为纯 JavaScript（含 bcryptjs），无需 Visual Studio / Python 编译原生模块。
# 不修改全局 PATH，不改防火墙。

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "CmsCommon.ps1")

$root = Get-CmsRoot
Set-Location -LiteralPath $root
Test-CmsNode

if (-not (Test-Path -LiteralPath (Join-Path $root "package-lock.json"))) {
  throw "缺少 package-lock.json，无法执行 npm ci。"
}
if (-not (Test-Path -LiteralPath (Join-Path $root "backend\dist\index.js"))) {
  throw "缺少已编译后端 backend\\dist\\index.js。"
}
if (-not (Test-Path -LiteralPath (Join-Path $root "frontend\dist\index.html"))) {
  throw "缺少已构建前端 frontend\\dist\\index.html。"
}

Write-Host "开始安装生产依赖（npm ci --omit=dev --ignore-scripts）。需要网络访问 npm 源。"
& npm ci --omit=dev --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
  throw "npm ci 失败。请检查是否能访问 registry.npmjs.org（或当前 npm 配置的镜像）。"
}

# 快速确认关键纯 JS 依赖可被 Node 解析，不打印内部路径以外的敏感信息。
& node --input-type=module -e "await import('bcryptjs'); await import('pg'); await import('express'); console.log('依赖解析正常');"
if ($LASTEXITCODE -ne 0) {
  throw "依赖安装后无法解析 bcryptjs/pg/express。"
}

Write-Host "依赖安装完成。下一步："
Write-Host "  1) 若尚未生成配置：.\\scripts\\New-CmsEnv.ps1 -DbPort <实际端口> -AppPort 13082"
Write-Host "  2) 可选写入虚构演示账号：.\\scripts\\Initialize-CmsDemo.ps1"
Write-Host "  3) 启动：.\\scripts\\Start-Cms.ps1"
