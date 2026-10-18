# Creates (or restarts) the local k3d cluster "urumi". Safe to run repeatedly.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$existing = k3d cluster list -o json | ConvertFrom-Json | Where-Object { $_.name -eq 'urumi' }
if (-not $existing) {
  k3d cluster create --config (Join-Path $root 'deploy/k3d-config.yaml')
} else {
  k3d cluster start urumi
}
kubectl config use-context k3d-urumi
kubectl wait --for=condition=Ready nodes --all --timeout=180s

# k3s installs Traefik asynchronously through a HelmChart job, so the Deployment
# may not exist yet when the node first becomes Ready. Wait for it to appear.
$deadline = (Get-Date).AddSeconds(300)
$ErrorActionPreference = 'Continue'   # kubectl writes "NotFound" to stderr while we poll; that is expected
kubectl -n kube-system get deployment traefik 2>&1 | Out-Null
while ($LASTEXITCODE -ne 0) {
  if ((Get-Date) -gt $deadline) { throw 'Timed out waiting for deployment/traefik to be created.' }
  Start-Sleep -Seconds 3
  kubectl -n kube-system get deployment traefik 2>&1 | Out-Null
}
$ErrorActionPreference = 'Stop'
kubectl -n kube-system rollout status deployment/traefik --timeout=300s
