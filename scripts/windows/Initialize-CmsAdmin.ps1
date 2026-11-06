# 交互创建首位 Boss 管理员。密码由当前窗口输入，不作为命令行参数传递。

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "CmsCommon.ps1")

$root = Get-CmsRoot
Set-Location -LiteralPath $root
Test-CmsNode
Import-CmsEnv -Path (Join-Path $root ".env")

Write-Host "将交互创建管理员。请在随后的提示中输入登录名、显示名和密码（脚本不会把密码放到命令行）。"
& node (Join-Path $root "backend\dist\scripts\init-admin.js")
if ($LASTEXITCODE -ne 0) {
  throw "管理员初始化失败。"
}
