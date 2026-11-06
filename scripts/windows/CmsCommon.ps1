# 公司内部管理系统 Windows 脚本公共函数。
# 不修改全局 PATH，不改防火墙，不把密钥打印到终端。

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-CmsRoot {
  if ($PSScriptRoot) {
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  }
  throw "无法确定软件根目录"
}

function Protect-CmsFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "找不到需要保护的文件"
  }
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
    "FullControl",
    "Allow"
  )
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function ConvertFrom-CmsSecureString {
  param([Parameter(Mandatory = $true)][SecureString]$Secure)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

function Import-CmsEnv {
  param(
    [Parameter(Mandatory = $true)][string]$Path
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "未找到配置文件 .env。请先运行 scripts\New-CmsEnv.ps1"
  }
  $raw = Get-Content -LiteralPath $Path -Encoding UTF8
  foreach ($line in $raw) {
    $trim = $line.Trim()
    if (-not $trim -or $trim.StartsWith("#")) { continue }
    $eq = $trim.IndexOf("=")
    if ($eq -lt 1) { continue }
    $name = $trim.Substring(0, $eq).Trim()
    $value = $trim.Substring($eq + 1)
    if ($name -notmatch '^[A-Z0-9_]+$') { continue }
    Set-Item -Path "Env:$name" -Value $value
  }
}

function Test-CmsNode {
  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) {
    throw "当前 PowerShell 会话找不到 node 或 npm。请使用已安装的 Node 22 / npm 10（脚本不会修改系统 PATH）。"
  }
  $nodeVersion = (& node -v).Trim()
  $npmVersion = (& npm -v).Trim()
  Write-Host "检测到 Node $nodeVersion，npm $npmVersion"
  if ($nodeVersion -notmatch '^v22\.') {
    Write-Host "提示：目标环境为 Node 22.14，当前会话版本不同，请自行确认兼容性。"
  }
}

function Get-CmsPidPath {
  param([Parameter(Mandatory = $true)][string]$Root)
  return (Join-Path $Root "cms.pid")
}
