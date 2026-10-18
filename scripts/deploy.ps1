# Installs or upgrades the whole platform with Helm. Safe to run repeatedly.
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -ValuesFile deploy\values-prod.yaml
[CmdletBinding()]
param(
  [string]$ValuesFile = 'deploy/values-local.yaml',
  [string]$Timeout = '10m'
)
$ErrorActionPreference = 'Stop'

function Stop-WithError([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

foreach ($tool in 'helm', 'kubectl') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Stop-WithError "'$tool' was not found on PATH. Install it (docs/learning/00-setup-log.md) or open a NEW terminal so PATH refreshes."
  }
}

$root = Split-Path -Parent $PSScriptRoot
$chart = Join-Path $root 'charts/urumi-platform'
$valuesPath = if ([System.IO.Path]::IsPathRooted($ValuesFile)) { $ValuesFile } else { Join-Path $root $ValuesFile }
if (-not (Test-Path $valuesPath)) { Stop-WithError "Values file not found: $valuesPath" }

$context = kubectl config current-context
if ($LASTEXITCODE -ne 0) { Stop-WithError 'No current kube context. Run scripts\cluster-up.ps1 first.' }
if ($valuesPath -like '*values-local.yaml' -and $context -ne 'k3d-urumi') {
  Stop-WithError "Refusing to deploy local values to context '$context'. Run: kubectl config use-context k3d-urumi"
}

Write-Host "Deploying release 'urumi' to context '$context' with $valuesPath (timeout $Timeout)..."
helm upgrade --install urumi $chart --namespace urumi-system --create-namespace -f $valuesPath --wait --timeout $Timeout
if ($LASTEXITCODE -ne 0) {
  Stop-WithError 'helm upgrade --install failed. Diagnose with: kubectl get pods -A ; kubectl -n store logs job/store-setup ; see docs/troubleshooting.md'
}
helm status urumi --namespace urumi-system
