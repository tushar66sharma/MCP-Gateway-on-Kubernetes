# Copies the MariaDB root password (for GUI clients such as HeidiSQL/DBeaver) to the clipboard. -Show copies AND prints it.
#   powershell -ExecutionPolicy Bypass -File scripts\get-db-password.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\get-db-password.ps1 -Show
[CmdletBinding()]
param(
  [switch]$Show,
  [string]$Namespace = 'store',
  [string]$SecretName = 'store-db'
)
$ErrorActionPreference = 'Stop'
$b64 = kubectl -n $Namespace get secret $SecretName -o 'jsonpath={.data.root-password}'
if ($LASTEXITCODE -ne 0 -or -not $b64) { Write-Host "ERROR: Secret $Namespace/$SecretName not found. Is the store installed (scripts\up.ps1)?" -ForegroundColor Red; exit 1 }
$password = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
$copied = $true
try { Set-Clipboard -Value $password } catch { $copied = $false; Write-Host 'Could not copy to the clipboard; re-run with -Show.' -ForegroundColor Yellow }
if ($Show) { Write-Host "Database root password: $password" } elseif ($copied) { Write-Host 'Database root password copied to the clipboard (user: root). Use -Show to copy AND print it.' }
