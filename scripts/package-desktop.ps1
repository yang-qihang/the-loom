<#
  织界桌面安装包唯一构建入口（Windows 版）：
    源码 → 插件 jar → 真实引擎 → Windows runtime → Studio → Tauri release/NSIS。

  用法：
    pwsh -File scripts/package-desktop.ps1
    pwsh -File scripts/package-desktop.ps1 -NoBundle
    pwsh -File scripts/package-desktop.ps1 -SkipRuntime

  产物：
    apps/desktop/src-tauri/target/release/bundle/nsis/*.exe
#>
[CmdletBinding()]
param(
  [switch]$NoBundle,
  [switch]$SkipRuntime,
  [string]$Bundles = "nsis"
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$NodeDir = Join-Path $Root ".tools\node-v22.23.4-win-x64"
$NodeExe = Join-Path $NodeDir "node.exe"
if (-not (Test-Path $NodeExe)) { $NodeExe = (Get-Command node.exe -ErrorAction Stop).Source; $NodeDir = Split-Path $NodeExe }

function Fail([string]$Message) { throw "[package] $Message" }
function Section([string]$Message) { Write-Host "[package] $Message" }

# 让 tauri build 内部 spawn 的 node/npm 也能找到 Node。
$env:PATH = "$NodeDir;$env:PATH"

# Visual Studio MSVC 环境（cargo build 需要 link.exe / Windows SDK）。
$vsDevCmd = "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"
if (Test-Path $vsDevCmd) {
  $envDump = cmd /c "`"$vsDevCmd`" -arch=x64 >nul && set"
  foreach ($line in $envDump) {
    if ($line -match '^([^=]+)=(.*)$') {
      Set-Item -Path "env:$($matches[1])" -Value $matches[2]
    }
  }
  Section "已加载 Visual Studio x64 环境"
}

# 只清理本仓库/本安装目录下的旧织界进程；不要按 "paper.jar" 误杀用户其它 Paper 服务。
Section "0/5 清理旧织界/内置 runtime 进程"
$installRoot = Join-Path $env:LOCALAPPDATA "Loomcraft"
$repoRuntime = Join-Path $Root "apps\desktop\src-tauri\runtime\real"
$old = Get-CimInstance Win32_Process | Where-Object {
  $commandLine = $_.CommandLine
  $_.Name -in @("java.exe", "node.exe", "loomcraft-desktop.exe") -and
  $commandLine -and (
    $commandLine -match [regex]::Escape($installRoot) -or
    $commandLine -match [regex]::Escape($repoRuntime)
  )
}
foreach ($proc in $old) {
  try { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "  stopped $($proc.Name) $($proc.ProcessId)" }
  catch {}
}

if (-not $SkipRuntime) {
  Section "1/5 构建插件 + 真实引擎 + Windows runtime"
  & (Join-Path $PSScriptRoot "build-real-runtime.ps1")
  if ($LASTEXITCODE -ne 0) { Fail "build-real-runtime.ps1 失败" }
} else {
  Section "1/5 跳过 runtime（-SkipRuntime）"
}

Section "2/5 构建 Studio + 桌面壳前端资源"
Push-Location (Join-Path $Root "apps\desktop")
try {
  & $NodeExe (Join-Path $Root "apps\desktop\scripts\build-assets.mjs")
  if ($LASTEXITCODE -ne 0) { Fail "build-assets.mjs 失败" }
} finally {
  Pop-Location
}

Section "3/5 Tauri release 构建"
$tauri = Join-Path $Root "apps\desktop\node_modules\.bin\tauri.cmd"
if (-not (Test-Path $tauri)) { Fail "缺少 Tauri CLI：$tauri" }
Push-Location (Join-Path $Root "apps\desktop")
try {
  if ($NoBundle) {
    & $tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { Fail "tauri build --no-bundle 失败" }
  } else {
    & $tauri build --bundles $Bundles
    if ($LASTEXITCODE -ne 0) { Fail "tauri build --bundles $Bundles 失败" }
  }
} finally {
  Pop-Location
}

Section "4/5 release 产物"
$release = Join-Path $Root "apps\desktop\src-tauri\target\release"
$exe = Join-Path $release "loomcraft-desktop.exe"
if (-not (Test-Path $exe)) { Fail "没有生成 $exe" }
Write-Host ("  exe  = {0} ({1:N1} MB)" -f $exe, ((Get-Item $exe).Length / 1MB))
$bundleRoot = Join-Path $release "bundle"
if ($bundleRoot -and (Test-Path $bundleRoot)) {
  Get-ChildItem -Path $bundleRoot -Recurse -File |
    Where-Object { $_.Extension -in @(".exe", ".msi") -and $_.Name -notmatch "loomcraft-desktop\.exe$" } |
    ForEach-Object { Write-Host ("  pkg  = {0} ({1:N1} MB)" -f $_.FullName, ($_.Length / 1MB)) }
}
if (-not $NoBundle) {
  $nsisDir = Join-Path $bundleRoot "nsis"
  $installer = Get-ChildItem -LiteralPath $nsisDir -Filter "*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $installer) { Fail "没有生成 NSIS 安装包：$nsisDir" }
  if ($installer.Length -lt 200MB) { Fail "NSIS 安装包过小（$($installer.Length) B），runtime 可能未打进去" }
  Write-Host ("  setup = {0} ({1:N1} MB, sha256={2})" -f $installer.FullName, ($installer.Length / 1MB), (Get-FileHash $installer.FullName -Algorithm SHA256).Hash)
}

Section "5/5 验收 runtime 布局"
$runtime = Join-Path $Root "apps\desktop\src-tauri\runtime\real"
$required = @(
  "engine.mjs",
  "node\bin\node.exe",
  "java\bin\java.exe",
  "paper\paper.jar",
  "paper\plugins\loomcraft-plugin.jar",
  "bot\manager.mjs"
)
foreach ($rel in $required) {
  if (-not (Test-Path (Join-Path $runtime $rel))) { Fail "runtime 缺少 $rel" }
}
$engineText = Get-Content -LiteralPath (Join-Path $runtime "engine.mjs") -Raw
if ($engineText -notmatch "playerGive") { Fail "engine bundle 未包含 playerGive" }
Write-Host "[package] OK"
