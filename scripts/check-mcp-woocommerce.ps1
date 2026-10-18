# End-to-end check through the real in-cluster WooCommerce MCP server (port-forward + bearer token).
#   powershell -ExecutionPolicy Bypass -File scripts\check-mcp-woocommerce.ps1          # read-only calls
#   powershell -ExecutionPolicy Bypass -File scripts\check-mcp-woocommerce.ps1 -Write   # also creates a DRAFT product
# Never prints the token.
[CmdletBinding()]
param([switch]$Write)
$ErrorActionPreference = 'Stop'
function Stop-WithError([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

foreach ($tool in 'kubectl', 'node') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-WithError "'$tool' not found on PATH." }
}
$root = Split-Path -Parent $PSScriptRoot

$b64 = kubectl -n mcp get secret mcp-woocommerce-token -o 'jsonpath={.data.token}'
if ($LASTEXITCODE -ne 0 -or -not $b64) { Stop-WithError 'Could not read secret mcp/mcp-woocommerce-token. Is the platform deployed (scripts\up.ps1)?' }
$env:MCP_TOKEN = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))

$port = 13001
$pf = $null
$code = 1
try {
  $pf = Start-Process kubectl -ArgumentList "-n mcp port-forward svc/mcp-woocommerce ${port}:3001" -PassThru -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if ($pf.HasExited) { break }
    $tcp = New-Object Net.Sockets.TcpClient
    try { $tcp.Connect('127.0.0.1', $port); $ready = $true } catch { } finally { $tcp.Close() }
    if ($ready) { break }
    Start-Sleep -Milliseconds 500
  }
  if ($pf.HasExited) { Stop-WithError 'kubectl port-forward exited. Is the mcp-woocommerce pod running (kubectl -n mcp get pods)?' }
  if (-not $ready) { Stop-WithError "port-forward did not open port $port within 15 seconds." }

  $nodeArgs = @((Join-Path $root 'scripts/dev/mcp-smoke.mjs'), '--url', "http://127.0.0.1:$port/mcp")
  if ($Write) { $nodeArgs += '--write' }
  node @nodeArgs
  $code = $LASTEXITCODE
} finally {
  if ($pf -and -not $pf.HasExited) { Stop-Process -Id $pf.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:MCP_TOKEN -ErrorAction SilentlyContinue
}
if ($code -ne 0) { Stop-WithError 'MCP end-to-end check failed. See docs/troubleshooting.md.' }
Write-Host 'WooCommerce MCP server works end to end (bearer auth, signed requests to the in-cluster store).' -ForegroundColor Green
