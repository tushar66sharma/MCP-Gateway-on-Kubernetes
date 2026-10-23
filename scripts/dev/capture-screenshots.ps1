# Retakes the dashboard screenshots in docs/screenshots (Playwright, Chromium) from the running local cluster:
# overview, servers, server detail, team (users list only), audit log, one chat turn and the phone-width servers page.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev\capture-screenshots.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev\capture-screenshots.ps1 -SkipChat   # no LLM tokens
# The chat shot spends ONE live chat turn (about 3,000 tokens of the daily AI budget). The admin login is read from
# Secret gateway/gateway-bootstrap into this process's environment only and is never printed. It opens no key-creation
# dialog, no invite dialog and no URL with a token. Look at every PNG before committing (no secrets, no LAN IP, no real email).
[CmdletBinding()]
param([string]$Base = '', [string]$OutDir = '', [switch]$SkipChat)
$ErrorActionPreference = 'Stop'
function Stop-WithError([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

foreach ($tool in 'kubectl', 'node', 'npx') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-WithError "'$tool' not found on PATH." }
}
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$config = Join-Path $root 'apps/dashboard/playwright.screenshots.config.ts'
if (-not (Test-Path (Join-Path $root 'node_modules/@playwright/test'))) {
  Stop-WithError 'Dependencies not installed: run `npm ci` from the repository root, then run this again (and `npx playwright install chromium` once).'
}
if (-not $Base) { $Base = 'http://app.localhost' }
if (-not $OutDir) { $OutDir = Join-Path $root 'docs/screenshots' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$emailB64 = kubectl -n gateway get secret gateway-bootstrap -o 'jsonpath={.data.email}'
if ($LASTEXITCODE -ne 0 -or -not $emailB64) { Stop-WithError 'Could not read secret gateway/gateway-bootstrap. Is the platform deployed (scripts\up.ps1)?' }
$passB64 = kubectl -n gateway get secret gateway-bootstrap -o 'jsonpath={.data.password}'
if ($LASTEXITCODE -ne 0 -or -not $passB64) { Stop-WithError 'Could not read the password from gateway/gateway-bootstrap.' }

$code = 1
Push-Location $root
try {
  $env:E2E_ADMIN_EMAIL = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($emailB64))
  $env:E2E_ADMIN_PASSWORD = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($passB64))
  $emailB64 = $null; $passB64 = $null
  $env:E2E_BASE_URL = $Base
  $env:SCREENSHOT_DIR = $OutDir
  $pwArgs = @('playwright', 'test', '-c', $config)
  if ($SkipChat) { $pwArgs += @('--grep-invert', 'chat after one') }
  npx @pwArgs
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:E2E_ADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:E2E_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:E2E_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:SCREENSHOT_DIR -ErrorAction SilentlyContinue
  Pop-Location
}
if ($code -ne 0) { Write-Host "ERROR: Screenshot capture failed (Playwright exit code $code)." -ForegroundColor Red; exit $code }
Write-Host "Screenshots written to $OutDir. Look at every image before committing." -ForegroundColor Green
exit 0
