# Copies the MariaDB root password (for GUI clients such as HeidiSQL/DBeaver) to the clipboard. It is printed only with -Show.
#   powershell -ExecutionPolicy Bypass -File scripts\get-db-password.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\get-db-password.ps1 -Show
[CmdletBinding()]
param([switch]$Show)
$ErrorActionPreference = 'Stop'
$b64 = kubectl -n store get secret store-db -o 'jsonpath={.data.root-password}'
if ($LASTEXITCODE -ne 0 -or -not $b64) { Write-Host 'ERROR: Secret store/store-db not found. Is the store installed (scripts\up.ps1)?' -ForegroundColor Red; exit 1 }
$password = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
Set-Clipboard -Value $password
if ($Show) { Write-Host "Database root password: $password" } else { Write-Host 'Database root password copied to the clipboard (user: root). Use -Show to print it instead.' }
