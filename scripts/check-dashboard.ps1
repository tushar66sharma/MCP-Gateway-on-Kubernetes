# End-to-end smoke of the dashboard in a real browser (Playwright, Chromium) at desktop and mobile widths,
# plus one live chat turn when the AI provider is configured.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-dashboard.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-dashboard.ps1 -Project mobile
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-dashboard.ps1 -Base http://127.0.0.1:8080
# The admin login is read from Secret gateway/gateway-bootstrap into this process's environment only and is
# never printed. Playwright records nothing (no screenshots, traces or videos).
[CmdletBinding()]
param([string]$Base = '', [ValidateSet('', 'desktop', 'mobile')][string]$Project = '')
$ErrorActionPreference = 'Stop'
function Stop-WithError([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

foreach ($tool in 'kubectl', 'node', 'npx') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-WithError "'$tool' not found on PATH." }
}
$root = Split-Path -Parent $PSScriptRoot
$config = Join-Path $root 'apps/dashboard/playwright.config.ts'

$nodeMajor = [int]((node --version) -replace '^v(\d+).*$', '$1')
if ($nodeMajor -lt 24) { Stop-WithError "Node 24 or newer is required (found $(node --version))." }
if (-not (Test-Path (Join-Path $root 'node_modules/@playwright/test'))) {
  Stop-WithError 'Dependencies not installed: run `npm ci` from the repository root, then run this again.'
}

# The Chromium build this Playwright version expects (a dry run lists its install folders; nothing is downloaded).
Push-Location $root
$ErrorActionPreference = 'Continue'
try { $plan = npx playwright install --dry-run chromium 2>$null } finally { $ErrorActionPreference = 'Stop'; Pop-Location }
$folders = @($plan | Select-String -Pattern 'Install location:\s+(.+)$' | ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() } |
    Where-Object { (Split-Path -Leaf $_) -like 'chromium*' })
if ($folders.Count -eq 0) { Stop-WithError 'Could not ask Playwright where Chromium belongs. Is @playwright/test installed (npm ci)?' }
$missing = @($folders | Where-Object { -not (Test-Path $_) })
if ($missing.Count -gt 0) {
  Write-Host 'Playwright Chromium is not installed. Run this once, then run this script again:' -ForegroundColor Yellow
  Write-Host '  npx playwright install chromium'
  exit 1
}

if (-not $Base) { $Base = 'http://app.localhost' }
$hostName = ([Uri]$Base).Host
try { [void][System.Net.Dns]::GetHostAddresses($hostName) }
catch { Stop-WithError "$hostName does not resolve. Run: powershell -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1" }

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
  $pwArgs = @('playwright', 'test', '-c', $config)
  if ($Project) { $pwArgs += @('--project', $Project) }
  npx @pwArgs
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:E2E_ADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:E2E_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:E2E_BASE_URL -ErrorAction SilentlyContinue
  Pop-Location
}
if ($code -ne 0) { Write-Host "ERROR: Dashboard end-to-end check failed (Playwright exit code $code)." -ForegroundColor Red; exit $code }
# The Phase 4 open item: opening /invite/<token> must leave no trace of the token in the dashboard log.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-invite-log.ps1') -Base $Base
if ($LASTEXITCODE -ne 0) { Write-Host 'ERROR: Invite-log check failed.' -ForegroundColor Red; exit 1 }
$scope = if ($Project) { $Project } else { 'desktop and mobile' }
Write-Host "Dashboard works end to end in Chromium ($scope)." -ForegroundColor Green
exit 0
