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
if ($valuesPath -notlike '*values-local.yaml' -and $context -eq 'k3d-urumi') {
  Stop-WithError "Refusing to deploy '$ValuesFile' to the local development cluster (context k3d-urumi): only deploy/values-local.yaml belongs there. Switch context first for a real or rehearsal cluster."
}

$helmArgs = @('-f', $valuesPath)
if ($valuesPath -like '*values-local.yaml') {
  $imagesFile = Join-Path $root 'deploy/.images.local.yaml'
  if (Test-Path $imagesFile) { $helmArgs += @('-f', $imagesFile) }
  else { Write-Host 'no local image tag; run scripts\build-images.ps1 (up.ps1 does this automatically)' -ForegroundColor Yellow }
}

# One-time migration: the gateway Deployment moved from the default RollingUpdate strategy to
# Recreate. Helm's server-side apply cannot remove the API server's defaulted
# spec.strategy.rollingUpdate (no field manager owns it), so upgrading an existing install would
# fail with "may not be specified when strategy type is 'Recreate'". Switch the live strategy first
# with a merge patch (null removes rollingUpdate). Changing only the strategy restarts no pod.
# The selector matches only this release's gateway, so another product's Deployment on a shared
# cluster is never touched. A failed lookup (e.g. Forbidden for a namespace-scoped account) skips the
# step instead of aborting the deploy: see docs/troubleshooting.md for the manual patch.
$gatewaySelector = 'app.kubernetes.io/name=gateway,app.kubernetes.io/instance=urumi,app.kubernetes.io/part-of=urumi-platform'
$gatewayDeploys = $null
$lookupOk = $false
try {
  $ErrorActionPreference = 'Continue'
  $gatewayDeploys = kubectl get deploy -A -l $gatewaySelector -o json 2>$null
  $lookupOk = ($LASTEXITCODE -eq 0)
}
catch { $lookupOk = $false }
finally { $ErrorActionPreference = 'Stop' }
if (-not $lookupOk) {
  Write-Host 'Could not list gateway Deployments to check their rollout strategy; skipping that step. If helm upgrade fails on rollingUpdate, see docs/troubleshooting.md.' -ForegroundColor Yellow
}
elseif ($gatewayDeploys) {
  foreach ($d in ($gatewayDeploys | Out-String | ConvertFrom-Json).items) {
    if ($d.spec.strategy.type -ne 'Recreate') {
      $patchFile = [System.IO.Path]::GetTempFileName()
      try {
        Set-Content -Path $patchFile -Value '{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null}}}' -Encoding ascii
        kubectl -n $d.metadata.namespace patch deployment $d.metadata.name --type merge --patch-file $patchFile | Out-Null
        if ($LASTEXITCODE -ne 0) { Stop-WithError "Could not switch deployment $($d.metadata.name) to the Recreate strategy." }
        Write-Host "Switched deployment $($d.metadata.namespace)/$($d.metadata.name) to the Recreate strategy (one-time migration)."
      }
      finally {
        Remove-Item -Path $patchFile -ErrorAction SilentlyContinue
      }
    }
  }
}

Write-Host "Deploying release 'urumi' to context '$context' with $valuesPath (timeout $Timeout)..."
helm upgrade --install urumi $chart --namespace urumi-system --create-namespace @helmArgs --wait --timeout $Timeout
if ($LASTEXITCODE -ne 0) {
  Stop-WithError 'helm upgrade --install failed. Diagnose with: kubectl get pods -A ; kubectl -n store logs job/store-setup ; see docs/troubleshooting.md'
}
helm status urumi --namespace urumi-system
