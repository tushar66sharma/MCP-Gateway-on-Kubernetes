# Copies the WordPress admin password to the clipboard. It is printed only with -Show.
#   powershell -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1 -Show
[CmdletBinding()]
param([switch]$Show)
$ErrorActionPreference = 'Stop'
$b64 = kubectl -n store get secret store-admin -o 'jsonpath={.data.password}'
if ($LASTEXITCODE -ne 0 -or -not $b64) { Write-Host 'ERROR: Secret store/store-admin not found. Is the store installed (scripts\up.ps1)?' -ForegroundColor Red; exit 1 }
$password = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
Set-Clipboard -Value $password
if ($Show) { Write-Host "Admin password: $password" } else { Write-Host 'Admin password copied to the clipboard (user: admin). Use -Show to print it instead.' }
