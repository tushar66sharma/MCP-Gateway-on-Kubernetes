# Proves the WooCommerce REST API key works with OAuth1 signing from outside the WordPress pod.
# The request goes to 127.0.0.1 (port-forward) but is signed with the PUBLIC store URL, because
# WooCommerce rebuilds the signature base URL from get_home_url(), not from the Host header.
# Signing base = public store URL (WP_HOME) with its scheme replaced by http; the port stays only if
# WP_HOME has one (publicPort not the default for publicScheme). Derived from the release values, like
# up.ps1 does for the store URL (same rule as the chart's urumi.storeSigningBaseUrl).
$ErrorActionPreference = 'Stop'
function Stop-WithError([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }
foreach ($tool in 'kubectl', 'node') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-WithError "'$tool' not found on PATH." }
}
$root = Split-Path -Parent $PSScriptRoot
function Get-SecretValue([string]$Name, [string]$Key) {
  $b64 = kubectl -n store get secret $Name -o "jsonpath={.data.$Key}"
  if ($LASTEXITCODE -ne 0 -or -not $b64) { Stop-WithError "Could not read secret $Name/$Key. Is the store deployed?" }
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
}
$env:WOO_CONSUMER_KEY = Get-SecretValue 'store-woo-api' 'consumer-key'
$env:WOO_CONSUMER_SECRET = Get-SecretValue 'store-woo-api' 'consumer-secret'
$valuesJson = helm get values urumi --namespace urumi-system --all --output json
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not read the release values (helm get values). Is the release installed?' }
$g = ($valuesJson | ConvertFrom-Json).global
$pubPort = [int]$g.publicPort
$isDefaultPort = ($g.publicScheme -eq 'http' -and $pubPort -eq 80) -or ($g.publicScheme -eq 'https' -and $pubPort -eq 443)
$signBase = if ($isDefaultPort) { "http://$($g.storeHost)" } else { "http://$($g.storeHost):$pubPort" }

$port = 18088
$pf = Start-Process kubectl -ArgumentList "-n store port-forward svc/wordpress ${port}:80" -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 3
  node (Join-Path $root 'scripts/dev/woo-oauth-check.mjs') --target "http://127.0.0.1:$port" --sign-base $signBase
  $code = $LASTEXITCODE
} finally {
  Stop-Process -Id $pf.Id -Force -ErrorAction SilentlyContinue
  Remove-Item Env:WOO_CONSUMER_KEY, Env:WOO_CONSUMER_SECRET -ErrorAction SilentlyContinue
}
if ($code -ne 0) { Stop-WithError 'Signed request with the public store URL did not return 200. See docs/troubleshooting.md.' }
Write-Host 'WooCommerce REST API key works (OAuth1, signed with the public store URL).'
