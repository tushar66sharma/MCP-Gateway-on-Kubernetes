# Creates (or restarts) the local k3d cluster "urumi". Safe to run repeatedly.
# Exits non-zero with a clear message as soon as any step fails.
$ErrorActionPreference = 'Stop'

# PowerShell 5.1 does not throw when a native command (k3d, kubectl) fails, so every
# native call below is followed by an explicit exit-code check.
function Stop-WithError([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

foreach ($tool in 'k3d', 'kubectl') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Stop-WithError "'$tool' was not found on PATH. Install it (docs/learning/00-setup-log.md) or open a NEW terminal so PATH refreshes."
  }
}

$root = Split-Path -Parent $PSScriptRoot
$listJson = k3d cluster list -o json
if ($LASTEXITCODE -ne 0) { Stop-WithError 'k3d cluster list failed. Is Docker Desktop running?' }
$existing = $listJson | ConvertFrom-Json | Where-Object { $_.name -eq 'urumi' }
if (-not $existing) {
  k3d cluster create --config (Join-Path $root 'deploy/k3d-config.yaml')
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'k3d cluster create failed (is host port 80 or 443 already in use?). See the k3d output above.' }
} else {
  k3d cluster start urumi
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'k3d cluster start urumi failed. See the k3d output above.' }
}
kubectl config use-context k3d-urumi
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not switch to kube context k3d-urumi.' }
kubectl wait --for=condition=Ready nodes --all --timeout=180s
if ($LASTEXITCODE -ne 0) { Stop-WithError 'The cluster node did not become Ready within 180 s.' }

# k3s installs Traefik asynchronously through a HelmChart job, so the Deployment
# may not exist yet when the node first becomes Ready. Wait for it to appear.
# Failures are expected while polling, so this loop deliberately tolerates them.
$deadline = (Get-Date).AddSeconds(300)
$ErrorActionPreference = 'Continue'   # kubectl writes "NotFound" to stderr while we poll
kubectl -n kube-system get deployment traefik 2>&1 | Out-Null
while ($LASTEXITCODE -ne 0) {
  if ((Get-Date) -gt $deadline) { Stop-WithError 'Timed out after 300 s waiting for deployment/traefik to be created.' }
  Start-Sleep -Seconds 3
  kubectl -n kube-system get deployment traefik 2>&1 | Out-Null
}
$ErrorActionPreference = 'Stop'
kubectl -n kube-system rollout status deployment/traefik --timeout=300s
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Traefik did not finish rolling out within 300 s.' }
Write-Host 'Cluster urumi is ready.'
