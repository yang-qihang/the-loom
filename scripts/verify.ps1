<#
  Windows quality-gate entrypoint, equivalent to scripts/verify.sh layers l0..l3 (+lg).
  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
    powershell -ExecutionPolicy Bypass -File scripts/verify.ps1 -Layers l0,l1,l2,l3
#>
[CmdletBinding()]
param(
  [string]$Layers = "l0,l1,l2,l3",
  [string]$Task = "adhoc"
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
$NodeDir = Join-Path $Root ".tools\node-v22.23.4-win-x64"
if (Test-Path (Join-Path $NodeDir "node.exe")) { $env:PATH = "$NodeDir;$env:PATH" }
$Npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$Npx = (Get-Command npx.cmd -ErrorAction Stop).Source

$logDir = Join-Path $Root "verify-reports"
New-Item -ItemType Directory -Path $logDir, (Join-Path $Root "qa\evidence") -Force | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$log = Join-Path $logDir "$stamp-$Task.log"
$results = @{}
$failed = $false
$commit = (& git rev-parse --short HEAD 2>$null | Select-Object -First 1)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Append-Utf8([string]$Text) {
  [System.IO.File]::AppendAllText($log, $Text + [Environment]::NewLine, $utf8NoBom)
}

function Log([string]$Message) {
  $line = "$((Get-Date).ToUniversalTime().ToString('HH:mm:ssZ')) $Message"
  Write-Host $line
  Append-Utf8 $line
}

function Run-Layer([string]$Name, [scriptblock]$Body) {
  $start = Get-Date
  Log "== LAYER $Name =="
  $output = & $Body 2>&1 | Out-String
  Append-Utf8 $output
  $code = $LASTEXITCODE
  $ms = [int]((Get-Date) - $start).TotalMilliseconds
  if ($code -eq 0) {
    Log "PASS $Name (${ms}ms)"
    $results[$Name] = @{ status = "pass"; ms = $ms }
  } else {
    Log "FAIL $Name (exit $code, ${ms}ms)"
    $results[$Name] = @{ status = "fail"; ms = $ms; detail = "exit=$code" }
    $script:failed = $true
  }
}

foreach ($layer in ($Layers -split ",")) {
  switch ($layer.Trim()) {
    "l0" {
      Run-Layer "l0" {
        & $Npm run typecheck
        if ($LASTEXITCODE -ne 0) { return }
        & $Npx tsx scripts/check-copy.mjs --pure-zh --json "qa/evidence/qa-copy.json"
        # copy gate is warning-only by default in verify.sh; keep it visible but not blocking.
        & (Get-Command node.exe).Source scripts/check-style-policy.mjs
        if ($LASTEXITCODE -ne 0) { return }
        & (Get-Command node.exe).Source scripts/guard-tests.mjs --check --warn
        $global:LASTEXITCODE = 0
      }
    }
    "l1" {
      Run-Layer "l1" {
        & $Npx vitest run packages --reporter=default --reporter=json --outputFile="qa/evidence/vitest-packages.json"
      }
    }
    "l2" {
      Run-Layer "l2" {
        & $Npx tsx qa/spec-check.mjs
        if ($LASTEXITCODE -ne 0) { return }
        & $Npx tsx qa/contract-check.mjs
      }
    }
    "l3" {
      Run-Layer "l3" {
        & $Npx tsx qa/content-check.mjs
        if ($LASTEXITCODE -ne 0) { return }
        $contentTests = Get-ChildItem (Join-Path $Root "content\levels") -Filter "*.test.ts" -ErrorAction SilentlyContinue
        if ($contentTests) {
          & $Npx vitest run --config qa/vitest.content.config.ts --reporter=json --outputFile="qa/evidence/qa-content-tests.json"
        }
      }
    }
    "lg" {
      Run-Layer "lg" {
        & $Npx tsx qa/gates.mjs
      }
    }
    default { throw "Unknown layer: $layer" }
  }
}

$summary = [ordered]@{
  ts = $stamp
  task = $Task
  commit = $commit
  result = if ($failed) { "fail" } else { "pass" }
  log = $log
  layers = $results
}
$json = $summary | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $Root "qa\evidence\qa-verify-latest.json"), $json + [Environment]::NewLine, $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $logDir "latest.json"), $json + [Environment]::NewLine, $utf8NoBom)
if ($failed) { Log "VERIFY FAIL"; exit 1 }
Log "VERIFY OK"; exit 0
