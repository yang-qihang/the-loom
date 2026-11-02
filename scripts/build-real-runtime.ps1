<#
  组装的桌面包内置真实运行时（Windows 版）：
    Node + Java + Paper + 插件 + 世界 + 真实引擎 + 织偶依赖。

  用法：
    pwsh -File scripts/build-real-runtime.ps1
    pwsh -File scripts/build-real-runtime.ps1 -PaperDir D:\...\it\.mc-server -JavaHome ... -NodeExe ...

  产物：apps/desktop/src-tauri/runtime/real/
  这是 build-real-runtime.sh 的 Windows 等价物；布局与 Linux 一致，
  只有可执行文件名不同（node/bin/node.exe、java/bin/java.exe）。
#>
[CmdletBinding()]
param(
  [string]$PaperDir = "",
  [string]$JavaHome = "",
  [string]$NodeExe = "",
  [string]$OutDir = ""
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $PaperDir) { $PaperDir = Join-Path $Root "it\.mc-server" }
if (-not $JavaHome) { $JavaHome = Join-Path $Root ".tools\jdk25\jdk-25.0.5+8" }
if (-not $NodeExe) {
  $candidate = Join-Path $Root ".tools\node-v22.23.4-win-x64\node.exe"
  if (Test-Path $candidate) { $NodeExe = $candidate }
  else { $NodeExe = (Get-Command node.exe -ErrorAction Stop).Source }
}
if (-not $OutDir) { $OutDir = Join-Path $Root "apps\desktop\src-tauri\runtime\real" }

function Fail([string]$Message) { throw "[build-real-runtime] $Message" }
function Assert-File([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "缺少 $Label：$Path" }
}
function Assert-Dir([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { Fail "缺少 $Label：$Path" }
}

Assert-File (Join-Path $PaperDir "paper.jar") "Paper server（paper.jar）"
Assert-File (Join-Path $JavaHome "bin\java.exe") "Java runtime（JAVA_HOME/bin/java.exe）"
Assert-File $NodeExe "Node（node.exe）"
Assert-Dir (Join-Path $Root "bot\node_modules") "bot/node_modules"
Assert-Dir (Join-Path $Root "node_modules\esbuild") "node_modules/esbuild"
Assert-Dir (Join-Path $Root "node_modules\typescript") "node_modules/typescript"

Write-Host "[runtime] root       = $Root"
Write-Host "[runtime] paper      = $PaperDir"
Write-Host "[runtime] java       = $JavaHome"
Write-Host "[runtime] node       = $NodeExe"
Write-Host "[runtime] output     = $OutDir"

if (Test-Path -LiteralPath $OutDir) { Remove-Item -LiteralPath $OutDir -Recurse -Force }
foreach ($dir in @("bot", "node\bin", "node\lib", "node_modules", "paper", "java")) {
  New-Item -ItemType Directory -Path (Join-Path $OutDir $dir) -Force | Out-Null
}

# 1) 真实引擎 bundle：Paper 适配器真实现，bot 保持 external（运行时从 ./bot/manager.mjs 加载）
$bundleScript = Join-Path $Root "tmp\build-real-engine.mjs"
New-Item -ItemType Directory -Path (Split-Path $bundleScript) -Force | Out-Null
@'
import { build } from "esbuild";
import { statSync } from "node:fs";
const out = process.argv[2];
await build({
  entryPoints: ["apps/engine/src/server.ts"], bundle: true, platform: "node", format: "esm",
  target: "node22", outfile: out, external: ["esbuild", "typescript"],
  plugins: [{ name: "bot-external", setup(b) { b.onResolve({ filter: /bot[/\\]manager\.mjs$/ }, () => ({ path: "./bot/manager.mjs", external: true })); } }],
  logLevel: "warning",
});
console.log("engine", statSync(out).size);
'@ | Set-Content -LiteralPath $bundleScript -Encoding utf8
try {
  & $NodeExe $bundleScript (Join-Path $OutDir "engine.mjs")
  if ($LASTEXITCODE -ne 0) { Fail "engine bundle 失败" }
} finally {
  Remove-Item -LiteralPath $bundleScript -Force -ErrorAction SilentlyContinue
}

# 2) 织偶 + 依赖（Windows 原生依赖随 node_modules 一起复制）
Copy-Item -LiteralPath (Join-Path $Root "bot\manager.mjs") -Destination (Join-Path $OutDir "bot\manager.mjs")
Copy-Item -LiteralPath (Join-Path $Root "bot\package.json") -Destination (Join-Path $OutDir "bot\package.json")
Copy-Item -LiteralPath (Join-Path $Root "bot\node_modules") -Destination (Join-Path $OutDir "bot\node_modules") -Recurse -Force

# 3) engine 外部依赖：esbuild/typescript + Windows 下的 @esbuild/win32-* 二进制包
Copy-Item -LiteralPath (Join-Path $Root "node_modules\esbuild") -Destination (Join-Path $OutDir "node_modules\esbuild") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $Root "node_modules\typescript") -Destination (Join-Path $OutDir "node_modules\typescript") -Recurse -Force
$esbuildScope = Join-Path $Root "node_modules\@esbuild"
if (Test-Path $esbuildScope) {
  Copy-Item -LiteralPath $esbuildScope -Destination (Join-Path $OutDir "node_modules\@esbuild") -Recurse -Force
}

# 4) Node（Windows 的 node.exe 不依赖额外共享库）
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $OutDir "node\bin\node.exe")
New-Item -ItemType Directory -Path (Join-Path $OutDir "node\lib") -Force | Out-Null

# 5) Java（整个 JDK runtime）
Copy-Item -Path (Join-Path $JavaHome "*") -Destination (Join-Path $OutDir "java") -Recurse -Force

# 6) Paper / 插件 / 世界；排除运行期日志和 session.lock
$paperDest = Join-Path $OutDir "paper"
$rc = & robocopy $PaperDir $paperDest /E /XD logs crash-reports /XF "console.*" "*.log" "session.lock" /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { Fail "robocopy Paper 失败（exit $LASTEXITCODE）" }
$global:LASTEXITCODE = 0

$worldLayoutVersion = if ($env:LOOM_WORLD_LAYOUT_VERSION) { $env:LOOM_WORLD_LAYOUT_VERSION } else { "loomworld-v2" }
New-Item -ItemType Directory -Path (Join-Path $paperDest "world") -Force | Out-Null
Set-Content -LiteralPath (Join-Path $paperDest "world\.loom-world-version") -Value $worldLayoutVersion -Encoding ascii

# 7) 插件必须和当前源码一起构建
$env:JAVA_HOME = $JavaHome
$env:GRADLE_USER_HOME = if ($env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME } else { Join-Path $Root "tmp\plugin-work\gradle-home" }
New-Item -ItemType Directory -Path $env:GRADLE_USER_HOME -Force | Out-Null
Push-Location (Join-Path $Root "plugin")
try {
  & (Join-Path $Root "plugin\gradlew.bat") clean build --no-daemon -q
  if ($LASTEXITCODE -ne 0) { Fail "插件 Gradle 构建失败（exit $LASTEXITCODE）" }
} finally {
  Pop-Location
}
$pluginJar = Join-Path $Root "plugin\build\libs\loomcraft-plugin.jar"
Assert-File $pluginJar "插件 jar"
New-Item -ItemType Directory -Path (Join-Path $paperDest "plugins\spark") -Force | Out-Null
Copy-Item -LiteralPath $pluginJar -Destination (Join-Path $paperDest "plugins\loomcraft-plugin.jar") -Force

# 8) server.properties / eula / spark
$sourceProperties = Join-Path $PaperDir "server.properties"
$targetProperties = Join-Path $paperDest "server.properties"
if (Test-Path $sourceProperties) {
  $props = Get-Content -LiteralPath $sourceProperties
  $props = $props | ForEach-Object {
    if ($_ -match '^server-port=') { "server-port=25565" }
    elseif ($_ -match '^online-mode=') { "online-mode=false" }
    elseif ($_ -match '^enforce-secure-profile=') { "enforce-secure-profile=false" }
    else { $_ }
  }
  $keys = $props | ForEach-Object { ($_ -split '=', 2)[0] }
  if ($keys -notcontains "server-port") { $props += "server-port=25565" }
  if ($keys -notcontains "online-mode") { $props += "online-mode=false" }
  if ($keys -notcontains "enforce-secure-profile") { $props += "enforce-secure-profile=false" }
  Set-Content -LiteralPath $targetProperties -Value $props -Encoding ascii
}
Set-Content -LiteralPath (Join-Path $paperDest "eula.txt") -Value "eula=true" -Encoding ascii
Set-Content -LiteralPath (Join-Path $paperDest "plugins\spark\config.json") -Value '{"_header":"spark configuration file - https://spark.lucko.me/docs/Configuration","backgroundProfiler":false}' -Encoding utf8

# 9) 验收运行时内容
$engineText = Get-Content -LiteralPath (Join-Path $OutDir "engine.mjs") -Raw
if ($engineText -notmatch "playerGive") { Fail "engine bundle 未包含 playerGive" }
$javap = Join-Path $JavaHome "bin\javap.exe"
$javapOut = & $javap -p -classpath $pluginJar -c dev.loomcraft.mc.SceneManager 2>&1 | Out-String
if ($javapOut -notmatch "PlayerInventory\.setItem") { Fail "插件 jar 未包含快捷键 setItem 逻辑" }

# 10) 包内运行时自检：不能只检查文件存在，必须真的能执行。
& (Join-Path $OutDir "node\bin\node.exe") --version | Out-Host
if ($LASTEXITCODE -ne 0) { Fail "包内 node.exe 无法执行" }
& (Join-Path $OutDir "java\bin\java.exe") -version 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Fail "包内 java.exe 无法执行" }
if (-not (Test-Path (Join-Path $paperDest "cache"))) {
  Write-Warning "[runtime] Paper cache/ 未复制：离线首启可能依赖网络（检查 LOOM_PAPER_DIR）"
}

$sizeMb = [math]::Round(((Get-ChildItem -LiteralPath $OutDir -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB), 1)
Write-Host "[runtime] OK: $OutDir ($sizeMb MB)"
