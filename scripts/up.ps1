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
foreach ($h in 'store.localhost', 'app.localhost') {
  if (-not (Select-String -Path $hostsFile -Pattern ('^\s*127\.0\.0\.1\s+.*\b' + [regex]::Escape($h) + '\b') -Quiet)) {
    Write-Host "WARNING: $h is not in the hosts file. Run: powershell -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1" -ForegroundColor Yellow
  }
}

# 4. Install the release if it does not exist yet (or when -Redeploy); otherwise just wait for the pods.
#    `helm status` exits 0 for every release state (failed, pending-*), so read the state too.
function Get-UpAction([string]$Status, [bool]$NsExists, [bool]$Redeploy) {
  if ($Status -like 'pending-*') { return 'stop' }
  if ($Redeploy -or -not $Status -or $Status -ne 'deployed' -or -not $NsExists) { return 'deploy' }
  return 'wait'
}

cmd /c "helm status urumi --namespace urumi-system >nul 2>&1"
$status = ''
if ($LASTEXITCODE -eq 0) {
  $statusJson = helm status urumi --namespace urumi-system --output json
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not read the release status (helm status failed).' }
  $status = [string](($statusJson | ConvertFrom-Json).info.status)
}
cmd /c "kubectl get ns store >nul 2>&1"
$nsExists = ($LASTEXITCODE -eq 0)

$action = Get-UpAction $status $nsExists ([bool]$Redeploy)
if ($action -eq 'stop') {
  Write-Host "ERROR: a previous helm operation on release urumi was interrupted (status: $status)." -ForegroundColor Red
  if ($status -eq 'pending-install') {
    Write-Host '  Remove the half-made release (your data is kept, because of the keep policy), then run up.ps1 again:' -ForegroundColor Red
    Write-Host '    helm uninstall urumi --namespace urumi-system' -ForegroundColor Red
  } else {
    Write-Host '  Roll back to the last good revision, then run up.ps1 again:' -ForegroundColor Red
    Write-Host '    helm rollback urumi --namespace urumi-system' -ForegroundColor Red
  }
  Write-Host '  See docs/troubleshooting.md.' -ForegroundColor Red
  exit 1
}
if ($action -eq 'deploy') {
  if ($status -and -not $Redeploy -and ($status -ne 'deployed' -or -not $nsExists)) {
    $why = if ($status -ne 'deployed') { "status: $status" } else { 'namespace "store" is missing' }
    Write-Host "previous install did not complete ($why) - running deploy" -ForegroundColor Yellow
  }
  # Build and import our images first: with --wait the store setup hook only runs after every workload
  # (including mcp-woocommerce) is Ready, so the image must already exist in the cluster.
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-images.ps1')
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'build-images.ps1 failed (see above).' }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'deploy.ps1')
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'deploy.ps1 failed (see above).' }
} else {
  Write-Host 'Release urumi already installed; waiting for the store to be ready (use -Redeploy to apply chart changes)...'
  kubectl -n store rollout status statefulset/mariadb --timeout=300s
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'MariaDB did not become ready. See docs/troubleshooting.md.' }
  kubectl -n store rollout status deployment/wordpress --timeout=300s
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'WordPress did not become ready. See docs/troubleshooting.md.' }
  # The MCP server exists only when mcpWoocommerce.enabled. A slow start is a warning, not a failure.
  cmd /c "kubectl -n mcp get deployment mcp-woocommerce >nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    kubectl -n mcp rollout status deployment/mcp-woocommerce --timeout=120s
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'WARNING: mcp-woocommerce is not ready yet (kubectl -n mcp get pods). The store works without it; see docs/troubleshooting.md.' -ForegroundColor Yellow
    }
  }
  # The gateway (namespace gateway) exists only when gateway.enabled. Same rule: warn, do not abort.
  cmd /c "kubectl -n gateway get statefulset postgres >nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    kubectl -n gateway rollout status statefulset/postgres --timeout=180s
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'WARNING: postgres is not ready yet (kubectl -n gateway get pods). The store works without it; see docs/troubleshooting.md.' -ForegroundColor Yellow
    }
    kubectl -n gateway rollout status deployment/gateway --timeout=180s
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'WARNING: the gateway is not ready yet (kubectl -n gateway get pods). The store works without it; see docs/troubleshooting.md.' -ForegroundColor Yellow
    }
  }
}

# 5. Compute the public store URL from the release's values (same rule as the chart's urumi.publicUrl).
$valuesJson = helm get values urumi --namespace urumi-system --all --output json
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not read the release values.' }
$g = ($valuesJson | ConvertFrom-Json).global
$port = [int]$g.publicPort
$isDefaultPort = ($g.publicScheme -eq 'http' -and $port -eq 80) -or ($g.publicScheme -eq 'https' -and $port -eq 443)
$storeUrl = if ($isDefaultPort) { "$($g.publicScheme)://$($g.storeHost)" } else { "$($g.publicScheme)://$($g.storeHost):$port" }
$appUrl = if ($isDefaultPort) { "$($g.publicScheme)://$($g.appHost)" } else { "$($g.publicScheme)://$($g.appHost):$port" }

Write-Host ''
Write-Host '================ Urumi platform is running ================' -ForegroundColor Green
Write-Host "  Storefront   : $storeUrl/"
Write-Host "  Shop         : $storeUrl/shop/"
Write-Host "  My account   : $storeUrl/my-account/   (customers: register, log in, see their orders)"
Write-Host "  WP admin     : $storeUrl/wp-admin/     (user: admin)"
Write-Host '  MCP server   : internal only (namespace mcp) - check with scripts\check-mcp-woocommerce.ps1'
Write-Host "  Gateway API  : $appUrl/api"
Write-Host "  MCP endpoint : $appUrl/mcp   (needs a personal API key)"
Write-Host '  Gateway admin: admin@example.com - copy the password with: powershell -ExecutionPolicy Bypass -File scripts\get-secret.ps1 -Namespace gateway -Name gateway-bootstrap -Key password'
Write-Host ''
Write-Host '  Admin password - run this to copy it to the clipboard (it is never printed here):'
Write-Host '    powershell -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1'
Write-Host '  Stop everything (keeps data):'
Write-Host '    powershell -ExecutionPolicy Bypass -File scripts\stop.ps1'
Write-Host '  Full guide: docs/run-guide.md'
Write-Host '===========================================================' -ForegroundColor Green
if ($Open) { Start-Process "$storeUrl/" }
