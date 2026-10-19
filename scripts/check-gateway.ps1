# End-to-end check through the gateway: login, API key, aggregated /mcp (15 tools), audit log.
#   powershell -ExecutionPolicy Bypass -File scripts\check-gateway.ps1               # read-only calls
#   powershell -ExecutionPolicy Bypass -File scripts\check-gateway.ps1 -Write        # also creates and searches a note
#   powershell -ExecutionPolicy Bypass -File scripts\check-gateway.ps1 -Isolation    # also scales mcp-utilities to 0 and back
# Never prints the admin password, the session cookie or the API key.
[CmdletBinding()]
param([switch]$Write, [switch]$Isolation, [string]$Base = '')
$ErrorActionPreference = 'Stop'
function Stop-WithError([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

foreach ($tool in 'kubectl', 'node') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-WithError "'$tool' not found on PATH." }
}
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $root 'node_modules/@modelcontextprotocol/client'))) {
  Stop-WithError 'Dependencies not installed: run `npm ci` from the repository root (needs Node 24), then run this again.'
}

if (-not $Base) { $Base = 'http://app.localhost' }
$hostName = ([Uri]$Base).Host
try { [void][System.Net.Dns]::GetHostAddresses($hostName) }
catch { Stop-WithError "$hostName does not resolve. Run: powershell -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1  (or pass -Base http://127.0.0.1:<port> with a kubectl port-forward to svc/gateway)" }

$emailB64 = kubectl -n gateway get secret gateway-bootstrap -o 'jsonpath={.data.email}'
if ($LASTEXITCODE -ne 0 -or -not $emailB64) { Stop-WithError 'Could not read secret gateway/gateway-bootstrap. Is the platform deployed (scripts\up.ps1)?' }
$passB64 = kubectl -n gateway get secret gateway-bootstrap -o 'jsonpath={.data.password}'
if ($LASTEXITCODE -ne 0 -or -not $passB64) { Stop-WithError 'Could not read the password from gateway/gateway-bootstrap.' }

$code = 1
try {
  $env:GATEWAY_ADMIN_EMAIL = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($emailB64))
  $env:GATEWAY_ADMIN_PASSWORD = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($passB64))
  $emailB64 = $null; $passB64 = $null
  $nodeArgs = @((Join-Path $root 'scripts/dev/gateway-smoke.mjs'), '--base', $Base)
  if ($Write) { $nodeArgs += '--write' }
  if ($Isolation) { $nodeArgs += '--isolation' }
  node @nodeArgs
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:GATEWAY_ADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:GATEWAY_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  if ($Isolation) {
    # Covers the case where node itself was killed mid-run: mcp-utilities must never stay at 0 replicas.
    kubectl -n mcp scale deploy/mcp-utilities --replicas=1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'ERROR: could not restore mcp-utilities. Run this by hand NOW: kubectl -n mcp scale deploy/mcp-utilities --replicas=1' -ForegroundColor Red
      $code = 1
    }
  }
}
if ($code -ne 0) { Stop-WithError 'Gateway end-to-end check failed. See docs/troubleshooting.md.' }
Write-Host 'Gateway works end to end (login, API key, 15 aggregated tools, audit log).' -ForegroundColor Green
exit 0
