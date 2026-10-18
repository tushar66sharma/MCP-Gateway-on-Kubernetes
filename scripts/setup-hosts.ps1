# Adds *.localhost names to the Windows hosts file (needs admin; self-elevates via UAC).
# Browsers and curl resolve *.localhost themselves, but Node-based MCP clients use the OS resolver.
$hosts = "$env:WINDIR\System32\drivers\etc\hosts"
$line = '127.0.0.1 store.localhost app.localhost hello.localhost'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  if (Select-String -Path $hosts -SimpleMatch $line -Quiet) { Write-Host 'hosts entries already present.'; return }
  Write-Host 'Requesting administrator rights (accept the UAC prompt)...'
  try {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  } catch {
    Write-Host "ERROR: elevation was cancelled or failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
  if (Select-String -Path $hosts -SimpleMatch $line -Quiet) { Write-Host 'hosts entries present.'; exit 0 }
  Write-Host "ERROR: hosts entries were not added. Add this line manually to $hosts : $line" -ForegroundColor Red
  exit 1
}
if (-not (Select-String -Path $hosts -SimpleMatch $line -Quiet)) { Add-Content -Path $hosts -Value "`r`n$line" }
Write-Host 'hosts entries present.'
