# Copies a Kubernetes Secret value to the clipboard. -Show copies AND prints it.
#   powershell -ExecutionPolicy Bypass -File scripts\get-secret.ps1 -Namespace mcp -Name mcp-woocommerce-token -Key token
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Namespace,
  [Parameter(Mandatory)][string]$Name,
  [Parameter(Mandatory)][string]$Key,
  [switch]$Show
)
$ErrorActionPreference = 'Stop'
$b64 = kubectl -n $Namespace get secret $Name -o "jsonpath={.data.$Key}"
if ($LASTEXITCODE -ne 0 -or -not $b64) { Write-Host "ERROR: Secret $Namespace/$Name key '$Key' not found. Is the platform installed (scripts\up.ps1)?" -ForegroundColor Red; exit 1 }
$value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
$copied = $true
try { Set-Clipboard -Value $value } catch { $copied = $false; Write-Host 'Could not copy to the clipboard; re-run with -Show.' -ForegroundColor Yellow }
if ($Show) { Write-Host "${Namespace}/${Name} ${Key}: $value" } elseif ($copied) { Write-Host "Secret $Namespace/$Name key '$Key' copied to the clipboard. Use -Show to copy AND print it." }
