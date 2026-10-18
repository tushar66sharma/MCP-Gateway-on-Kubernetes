# Deletes the local k3d cluster "urumi".
# WARNING: this deletes ALL cluster data (databases, volumes, secrets). To pause
# without losing data (expected) use:  k3d cluster stop urumi
$ErrorActionPreference = 'Stop'
k3d cluster delete urumi
if ($LASTEXITCODE -ne 0) {
  Write-Host 'ERROR: k3d cluster delete urumi failed. See the k3d output above.' -ForegroundColor Red
  exit 1
}
