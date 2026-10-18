# One-command local start for the Urumi platform.
#   powershell -ExecutionPolicy Bypass -File scripts\up.ps1            # start; installs the release only if missing
#   powershell -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy  # also apply chart/value changes (helm upgrade)
#   powershell -ExecutionPolicy Bypass -File scripts\up.ps1 -Open      # also open the storefront in the browser
# Never prints passwords: it prints the command that retrieves them.
[CmdletBinding()]
param([switch]$Redeploy, [switch]$Open)
$ErrorActionPreference = 'Stop'

function Stop-WithError([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

foreach ($tool in 'docker', 'k3d', 'kubectl', 'helm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Stop-WithError "'$tool' was not found on PATH. Install it (docs/run-guide.md) or open a NEW terminal so PATH refreshes."
  }
}

# 1. Docker Desktop must be running (k3d runs Kubernetes inside Docker containers).
cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Docker is not running. Start Docker Desktop, wait for "Engine running", then run this again.' }

# 2. Start (or create) the k3d cluster.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'cluster-up.ps1')
if ($LASTEXITCODE -ne 0) { Stop-WithError 'cluster-up.ps1 failed (see above).' }

# 3. Warn (do not fail) if the hosts entries are missing; browsers still work, Node-based tools need them.
$hostsFile = "$env:WINDIR\System32\drivers\etc\hosts"
if (-not (Select-String -Path $hostsFile -Pattern '^\s*127\.0\.0\.1\s+.*\bstore\.localhost\b' -Quiet)) {
  Write-Host 'WARNING: store.localhost is not in the hosts file. Run: powershell -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1' -ForegroundColor Yellow
}

# 4. Install the release if it does not exist yet (or when -Redeploy); otherwise just wait for the pods.
cmd /c "helm status urumi --namespace urumi-system >nul 2>&1"
$installed = ($LASTEXITCODE -eq 0)
if (-not $installed -or $Redeploy) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'deploy.ps1')
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'deploy.ps1 failed (see above).' }
} else {
  Write-Host 'Release urumi already installed; waiting for the store to be ready (use -Redeploy to apply chart changes)...'
  kubectl -n store rollout status statefulset/mariadb --timeout=300s
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'MariaDB did not become ready. See docs/troubleshooting.md.' }
  kubectl -n store rollout status deployment/wordpress --timeout=300s
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'WordPress did not become ready. See docs/troubleshooting.md.' }
}

# 5. Compute the public store URL from the release's values (same rule as the chart's urumi.publicUrl).
$valuesJson = helm get values urumi --namespace urumi-system --all --output json
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not read the release values.' }
$g = ($valuesJson | ConvertFrom-Json).global
$port = [int]$g.publicPort
$isDefaultPort = ($g.publicScheme -eq 'http' -and $port -eq 80) -or ($g.publicScheme -eq 'https' -and $port -eq 443)
$storeUrl = if ($isDefaultPort) { "$($g.publicScheme)://$($g.storeHost)" } else { "$($g.publicScheme)://$($g.storeHost):$port" }

Write-Host ''
Write-Host '================ Urumi platform is running ================' -ForegroundColor Green
Write-Host "  Storefront   : $storeUrl/"
Write-Host "  Shop         : $storeUrl/shop/"
Write-Host "  My account   : $storeUrl/my-account/   (customers: register, log in, see their orders)"
Write-Host "  WP admin     : $storeUrl/wp-admin/     (user: admin)"
Write-Host ''
Write-Host '  Admin password (copied to clipboard, not printed):'
Write-Host '    powershell -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1'
Write-Host '  Stop everything (keeps data):'
Write-Host '    powershell -ExecutionPolicy Bypass -File scripts\stop.ps1'
Write-Host '  Full guide: docs/run-guide.md'
Write-Host '===========================================================' -ForegroundColor Green
if ($Open) { Start-Process "$storeUrl/" }
