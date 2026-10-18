# Adds *.localhost names to the Windows hosts file (needs admin; self-elevates via UAC).
# Browsers and curl resolve *.localhost themselves, but Node-based MCP clients use the OS resolver.
$hosts = "$env:WINDIR\System32\drivers\etc\hosts"
$line = '127.0.0.1 store.localhost app.localhost hello.localhost'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  return
}
if (-not (Select-String -Path $hosts -SimpleMatch $line -Quiet)) { Add-Content -Path $hosts -Value "`r`n$line" }
Write-Host 'hosts entries present.'
