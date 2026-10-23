# Builds our images (the Node apps and the dashboard), imports them into the k3d cluster and records the
# tag for deploy.ps1.
#   powershell -ExecutionPolicy Bypass -File scripts\build-images.ps1
# The tag is the git short SHA, plus -dirty-<timestamp> when the working tree has changes, so every
# build of changed code gets a new tag and Kubernetes rolls the pods. Never prints secrets.
#   ... -Cluster <name>   imports into another k3d cluster instead of urumi (scripts\prod-rehearsal.ps1 uses it)
[CmdletBinding()]
param([string]$Cluster = 'urumi')
$ErrorActionPreference = 'Stop'

function Stop-WithError([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

foreach ($tool in 'docker', 'k3d', 'git') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-WithError "'$tool' was not found on PATH." }
}

$apps = @('mcp-woocommerce','mcp-notes','mcp-utilities','gateway')
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$sha = (git rev-parse --short HEAD)
if ($LASTEXITCODE -ne 0 -or -not $sha) { Stop-WithError 'git rev-parse failed. Is this a git repository with a commit?' }
$dirty = git status --porcelain
if ($LASTEXITCODE -ne 0) { Stop-WithError 'git status failed.' }
$tag = $sha
if ($dirty) { $tag = "$sha-dirty-$(Get-Date -Format 'yyyyMMddHHmmss')" }

# Node apps share docker/node-app.Dockerfile (APP build arg); the dashboard is static files on nginx.
$builds = @($apps | ForEach-Object { @{ Name = $_; Dockerfile = 'docker/node-app.Dockerfile'; BuildArgs = @('--build-arg', "APP=$_") } })
$builds += @{ Name = 'dashboard'; Dockerfile = 'docker/dashboard.Dockerfile'; BuildArgs = @() }

foreach ($b in $builds) {
  $app = $b.Name
  $image = "urumi/${app}:$tag"
  Write-Host "Building $image ..."
  $buildArgs = $b.BuildArgs
  docker build -f $b.Dockerfile @buildArgs -t $image .
  if ($LASTEXITCODE -ne 0) { Stop-WithError "docker build failed for $app." }
  Write-Host "Importing $image into k3d cluster '$Cluster' ..."
  k3d image import $image -c $Cluster
  if ($LASTEXITCODE -ne 0) { Stop-WithError "k3d image import failed for $app. Is the cluster running (scripts\cluster-up.ps1)?" }
}

# The default cluster keeps writing deploy/.images.local.yaml; any other cluster gets its own file.
$outName = if ($Cluster -eq 'urumi') { '.images.local.yaml' } else { ".images.$Cluster.yaml" }
$out = Join-Path $root "deploy/$outName"
# Quoted: an all-digit short SHA (e.g. 1234567) would otherwise be read by YAML as a number and fail the
# chart schema (imageTag must be a string).
[IO.File]::WriteAllText($out, "global:`n  imageTag: `"$tag`"`n")
Write-Host "Image tag: $tag (written to deploy/$outName)" -ForegroundColor Green
