# Builds our Node app images, imports them into the k3d cluster and records the tag for deploy.ps1.
#   powershell -ExecutionPolicy Bypass -File scripts\build-images.ps1
# The tag is the git short SHA, plus -dirty-<timestamp> when the working tree has changes, so every
# build of changed code gets a new tag and Kubernetes rolls the pods. Never prints secrets.
$ErrorActionPreference = 'Stop'

function Stop-WithError([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

foreach ($tool in 'docker', 'k3d', 'git') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-WithError "'$tool' was not found on PATH." }
}

$apps = @('mcp-woocommerce')   # later phases add more apps here
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$sha = (git rev-parse --short HEAD)
if ($LASTEXITCODE -ne 0 -or -not $sha) { Stop-WithError 'git rev-parse failed. Is this a git repository with a commit?' }
$dirty = git status --porcelain
if ($LASTEXITCODE -ne 0) { Stop-WithError 'git status failed.' }
$tag = $sha
if ($dirty) { $tag = "$sha-dirty-$(Get-Date -Format 'yyyyMMddHHmmss')" }

foreach ($app in $apps) {
  $image = "urumi/${app}:$tag"
  Write-Host "Building $image ..."
  docker build -f docker/node-app.Dockerfile --build-arg "APP=$app" -t $image .
  if ($LASTEXITCODE -ne 0) { Stop-WithError "docker build failed for $app." }
  Write-Host "Importing $image into k3d cluster 'urumi' ..."
  k3d image import $image -c urumi
  if ($LASTEXITCODE -ne 0) { Stop-WithError "k3d image import failed for $app. Is the cluster running (scripts\cluster-up.ps1)?" }
}

$out = Join-Path $root 'deploy/.images.local.yaml'
[IO.File]::WriteAllText($out, "global:`n  imageTag: $tag`n")
Write-Host "Image tag: $tag (written to deploy/.images.local.yaml)" -ForegroundColor Green
