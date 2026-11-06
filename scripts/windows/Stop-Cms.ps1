# 停止由 Start-Cms.ps1 启动的本机服务。

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "CmsCommon.ps1")

$root = Get-CmsRoot
$pidPath = Get-CmsPidPath -Root $root
if (-not (Test-Path -LiteralPath $pidPath)) {
  Write-Host "未找到 cms.pid，没有由本脚本记录的运行中服务。"
  return
}

$oldId = [int]((Get-Content -LiteralPath $pidPath -Encoding ASCII | Select-Object -First 1).Trim())
$existing = Get-Process -Id $oldId -ErrorAction SilentlyContinue
if ($existing) {
  Stop-Process -Id $oldId -ErrorAction Stop
  Start-Sleep -Milliseconds 400
  Write-Host "已停止 PID $oldId"
} else {
  Write-Host "PID $oldId 对应进程不存在，清理 pid 文件。"
}
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
