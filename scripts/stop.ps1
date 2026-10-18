# Stops the local k3d cluster to free RAM. All data (volumes, Secrets) is kept.
# Start again with: powershell -ExecutionPolicy Bypass -File scripts\up.ps1
$ErrorActionPreference = 'Stop'
if (-not (Get-Command k3d -ErrorAction SilentlyContinue)) { Write-Host "ERROR: 'k3d' not found on PATH." -ForegroundColor Red; exit 1 }
k3d cluster stop urumi
if ($LASTEXITCODE -ne 0) { Write-Host 'ERROR: k3d cluster stop urumi failed (is Docker Desktop running?).' -ForegroundColor Red; exit 1 }
Write-Host 'Cluster urumi stopped. Data is kept. Start again with: powershell -ExecutionPolicy Bypass -File scripts\up.ps1'
