# Live proof of the external-store mode (ADR-019): the built MCP server talks to the REAL local WooCommerce over
# HTTPS with HTTP Basic auth. TLS verification stays ON.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev\test-external-store.ps1 [-Write] [-WorkDir <dir>]
#
# What it does (the local k3d cluster must be running, the MCP server built: npm run build):
#   1. makes a throw-away CA and a leaf certificate for store.localhost (openssl) in -WorkDir;
#   2. creates, in namespace store, a TLS Secret and an extra Ingress (names ext-proof-*) for host store.localhost,
#      so Traefik presents that certificate on https://store.localhost (127.0.0.1:443);
#   3. runs apps/mcp-woocommerce/dist/main.js on the host with WOO_AUTH_MODE=basic, WOO_BASE_URL=https://store.localhost
#      and NODE_EXTRA_CA_CERTS=<CA>, the consumer key and secret read from the store-woo-api Secret into the process
#      environment only, and a random MCP_AUTH_TOKEN;
#   4. runs scripts\dev\mcp-smoke.mjs against it (-Write also creates one DRAFT product);
#   5. negative control: the same server WITHOUT NODE_EXTRA_CA_CERTS must fail, and a plain fetch must report a
#      certificate error;
#   6. cleanup: stops the processes, deletes the temporary Ingress and Secret and the CA files, and shows
#      `kubectl -n store get ingress,secret` before and after.
# Preflight (before anything is created or deleted): refuses with exit 1 and changes nothing unless the tools and
# the build output are present, the current kubectl context is k3d-urumi, and neither ingress ext-proof nor secret
# ext-proof-tls exists in namespace store (an existing one is left in place; the cleanup only runs after the preflight).
# Never prints the key, the secret or the token. NODE_TLS_REJECT_UNAUTHORIZED is never set.
[CmdletBinding()]
param([switch]$Write, [string]$WorkDir = '')
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$host_ = 'store.localhost'
$ingressName = 'ext-proof'
$tlsSecret = 'ext-proof-tls'
if (-not $WorkDir) { $WorkDir = Join-Path ([IO.Path]::GetTempPath()) ('urumi-ext-proof-' + [guid]::NewGuid().ToString('N')) }
$script:procs = @()
$script:failed = $false
$script:armed = $false

function Stop-WithError([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; $script:failed = $true; throw $Message }
function Step([string]$m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Run-Native([string]$exe, [string[]]$a) {
  $o = & $exe @a 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Stop-WithError "$exe failed (exit $LASTEXITCODE): $($o.Trim())" }
  return $o
}
function Show-Store([string]$title) {
  Write-Host "-- $title : kubectl -n store get ingress,secret"
  & kubectl -n store get ingress,secret 2>&1 | Out-String | Write-Host
}
function Wait-Port([int]$port, $proc) {
  for ($i = 0; $i -lt 40; $i++) {
    if ($proc.HasExited) { return $false }
    $tcp = New-Object Net.Sockets.TcpClient
    try { $tcp.Connect('127.0.0.1', $port); return $true } catch { } finally { $tcp.Close() }
    Start-Sleep -Milliseconds 250
  }
  return $false
}
function Start-McpServer([int]$port, [bool]$trustCa, [string]$token, [string]$key, [string]$secret, [string]$logFile) {
  $names = 'PORT', 'WOO_BASE_URL', 'WOO_AUTH_MODE', 'WOO_CONSUMER_KEY', 'WOO_CONSUMER_SECRET', 'MCP_AUTH_TOKEN', 'STORE_TIMEZONE', 'NODE_EXTRA_CA_CERTS'
  try {
    $env:PORT = "$port"; $env:WOO_BASE_URL = "https://$host_"; $env:WOO_AUTH_MODE = 'basic'
    $env:WOO_CONSUMER_KEY = $key; $env:WOO_CONSUMER_SECRET = $secret; $env:MCP_AUTH_TOKEN = $token; $env:STORE_TIMEZONE = 'Asia/Kolkata'
    if ($trustCa) { $env:NODE_EXTRA_CA_CERTS = (Join-Path $WorkDir 'ca.pem') } else { Remove-Item Env:NODE_EXTRA_CA_CERTS -ErrorAction SilentlyContinue }
    $p = Start-Process node -ArgumentList ('"' + (Join-Path $root 'apps\mcp-woocommerce\dist\main.js') + '"') -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $logFile -RedirectStandardError ($logFile + '.err')
    $script:procs += $p
    return $p
  }
  finally { foreach ($n in $names) { Remove-Item "Env:$n" -ErrorAction SilentlyContinue } }
}
function Invoke-Smoke([int]$port, [string]$token, [bool]$withWrite) {
  $env:MCP_TOKEN = $token
  try {
    $a = @((Join-Path $root 'scripts\dev\mcp-smoke.mjs'), '--url', "http://127.0.0.1:$port/mcp")
    if ($withWrite) { $a += '--write' }
    $o = & node @a 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $o }
  }
  finally { Remove-Item Env:MCP_TOKEN -ErrorAction SilentlyContinue }
}

# Preflight: runs BEFORE the try block, so a refusal exits without touching the cluster (no cleanup runs).
function Stop-Preflight([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
foreach ($t in 'kubectl', 'node') { if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Stop-Preflight "'$t' not found on PATH." } }
$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) { $openssl = 'C:\Program Files\Git\usr\bin\openssl.exe' }
if (-not (Test-Path $openssl)) { Stop-Preflight 'openssl not found (it ships with Git for Windows: usr\bin\openssl.exe).' }
if (-not (Test-Path (Join-Path $root 'apps\mcp-woocommerce\dist\main.js'))) { Stop-Preflight 'apps/mcp-woocommerce is not built: run `npm run build` from the repository root.' }
if (-not (Test-Path (Join-Path $root 'node_modules/@modelcontextprotocol/client'))) { Stop-Preflight 'Dependencies not installed: run `npm ci` from the repository root.' }
# The context is the first kubectl call: nothing is read from or written to any other cluster.
$ctx = ''
$ctxOut = (& kubectl config current-context 2>$null)
if ($LASTEXITCODE -eq 0 -and $ctxOut) { $ctx = ([string]$ctxOut).Trim() }
if ($ctx -ne 'k3d-urumi') { Stop-Preflight "Refusing to run against context '$ctx' (use k3d-urumi). Nothing was changed." }
foreach ($kind in @(@('ingress', $ingressName), @('secret', $tlsSecret))) {
  $found = (& kubectl -n store get $kind[0] $kind[1] --ignore-not-found --no-headers 2>$null)
  if ($LASTEXITCODE -ne 0) { Stop-Preflight "Could not query $($kind[0]) $($kind[1]) in namespace store (is the cluster running?). Nothing was changed." }
  if ($found) { Stop-Preflight "$($kind[0]) $($kind[1]) already exists in namespace store; it was left in place. Delete it yourself if it is a leftover, then re-run. Nothing was changed." }
}

$script:armed = $true   # set only after the preflight passed: the cleanup in finally runs only then
try {
  Step 'Before'
  Show-Store 'before'

  Step '1. Throw-away CA and a leaf certificate for store.localhost (in the work directory only)'
  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  Set-Content -LiteralPath (Join-Path $WorkDir 'openssl.cnf') -Value "[req]`ndistinguished_name=dn`n[dn]`n" -Encoding ascii
  Set-Content -LiteralPath (Join-Path $WorkDir 'leaf.ext') -Value "basicConstraints=CA:FALSE`nkeyUsage=digitalSignature,keyEncipherment`nextendedKeyUsage=serverAuth`nsubjectAltName=DNS:$host_`n" -Encoding ascii
  Set-Content -LiteralPath (Join-Path $WorkDir 'ca.ext') -Value "basicConstraints=critical,CA:TRUE`nkeyUsage=critical,keyCertSign,cRLSign`n" -Encoding ascii
  $env:OPENSSL_CONF = Join-Path $WorkDir 'openssl.cnf'
  Push-Location $WorkDir
  try {
    Run-Native $openssl @('genrsa', '-out', 'ca.key', '2048') | Out-Null
    Run-Native $openssl @('req', '-x509', '-new', '-key', 'ca.key', '-sha256', '-days', '1', '-subj', '/CN=urumi throwaway test CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', 'ca.pem') | Out-Null
    Run-Native $openssl @('genrsa', '-out', 'leaf.key', '2048') | Out-Null
    Run-Native $openssl @('req', '-new', '-key', 'leaf.key', '-subj', "/CN=$host_", '-out', 'leaf.csr') | Out-Null
    Run-Native $openssl @('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '1', '-sha256', '-extfile', 'leaf.ext', '-out', 'leaf.pem') | Out-Null
  }
  finally { Pop-Location; Remove-Item Env:OPENSSL_CONF -ErrorAction SilentlyContinue }
  Write-Host "CA and leaf certificate for $host_ created (valid 1 day, SAN DNS:$host_)."

  Step '2. Temporary TLS Secret and Ingress in namespace store (not Helm-managed, deleted at the end)'
  Run-Native kubectl @('-n', 'store', 'create', 'secret', 'tls', $tlsSecret, "--cert=$(Join-Path $WorkDir 'leaf.pem')", "--key=$(Join-Path $WorkDir 'leaf.key')") | Write-Host
  $ing = @"
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: $ingressName
  namespace: store
  labels:
    app.kubernetes.io/name: ext-proof
    urumi.dev/temporary: "true"
spec:
  ingressClassName: traefik
  tls:
    - hosts: [$host_]
      secretName: $tlsSecret
  rules:
    - host: $host_
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: wordpress
                port:
                  name: http
"@
  $ing | & kubectl apply -f - 2>&1 | Write-Host
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'could not create the temporary Ingress.' }

  # Direct TLS check with the throw-away CA: wait until Traefik serves the leaf (it picks certificates by SNI).
  $probe = @'
const https = require('https');
const req = https.get({ host: '127.0.0.1', port: 443, servername: 'store.localhost', path: '/', headers: { host: 'store.localhost' }, timeout: 4000 }, (res) => {
  console.log('HTTPS status ' + res.statusCode + ', certificate authorized=' + res.socket.authorized + ', subject CN=' + res.socket.getPeerCertificate().subject.CN);
  res.resume(); process.exit(res.socket.authorized ? 0 : 3);
});
req.on('error', (e) => { console.log('error ' + (e.code || e.message)); process.exit(2); });
req.on('timeout', () => { console.log('timeout'); process.exit(2); });
'@
  $probeFile = Join-Path $WorkDir 'probe.cjs'
  Set-Content -LiteralPath $probeFile -Value $probe -Encoding ascii
  $ready = $false
  $env:NODE_EXTRA_CA_CERTS = Join-Path $WorkDir 'ca.pem'
  for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
    $o = & node $probeFile 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) { $ready = $true; Write-Host "With the throw-away CA trusted: $($o.Trim())" } else { Start-Sleep -Seconds 1 }
  }
  Remove-Item Env:NODE_EXTRA_CA_CERTS -ErrorAction SilentlyContinue
  if (-not $ready) { Stop-WithError 'Traefik did not serve the leaf certificate on https://store.localhost within 30 seconds.' }

  Step '3. Run the built MCP server on the host (basic auth, https, TLS verification on)'
  $b64k = & kubectl -n store get secret store-woo-api -o 'jsonpath={.data.consumer-key}'
  $b64s = & kubectl -n store get secret store-woo-api -o 'jsonpath={.data.consumer-secret}'
  if (-not $b64k -or -not $b64s) { Stop-WithError 'could not read secret store/store-woo-api.' }
  $key = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64k)); $b64k = $null
  $secret = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64s)); $b64s = $null
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = [Convert]::ToBase64String($bytes).Replace('+', 'a').Replace('/', 'b').Replace('=', 'c')
  Write-Host 'consumer key/secret: read from Secret store-woo-api into the server process environment only (not printed); MCP_AUTH_TOKEN: random, not printed.'

  $p1 = Start-McpServer 13011 $true $token $key $secret (Join-Path $WorkDir 'server-trusted.log')
  if (-not (Wait-Port 13011 $p1)) { Stop-WithError 'the MCP server did not start (see the work directory log).' }
  $startLine = (Get-Content -LiteralPath (Join-Path $WorkDir 'server-trusted.log') -ErrorAction SilentlyContinue | Select-Object -First 1)
  Write-Host "server start log: $startLine"

  Step "4. mcp-smoke.mjs against it$(if ($Write) { ' (with -Write: creates one draft product)' })"
  $s = Invoke-Smoke 13011 $token ([bool]$Write)
  Write-Host $s.Out
  Write-Host "smoke exit code: $($s.Code)"
  if ($s.Code -ne 0) { Stop-WithError 'the smoke run against the HTTPS store failed.' }
  if ($s.Out -notmatch 'list_products: [1-9]') { Stop-WithError 'list_products returned no products.' }
  Write-Host 'PASS  list_products returned the store products over HTTPS with Basic auth, certificate verified against the throw-away CA' -ForegroundColor Green

  Step '5. Negative control: the same server WITHOUT NODE_EXTRA_CA_CERTS must fail'
  $p2 = Start-McpServer 13012 $false $token $key $secret (Join-Path $WorkDir 'server-untrusted.log')
  if (-not (Wait-Port 13012 $p2)) { Stop-WithError 'the second MCP server did not start.' }
  $n = Invoke-Smoke 13012 $token $false
  $lines = ($n.Out -split "`r?`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -First 6) -join "`n"
  Write-Host $lines
  Write-Host "smoke exit code (expected non-zero): $($n.Code)"
  $fetch = & node -e "fetch('https://store.localhost/').then(r=>console.log('unexpected status '+r.status),e=>console.log('plain fetch without the CA: '+(e.cause&&e.cause.code||e.message)))" 2>&1 | Out-String
  Write-Host $fetch.Trim()
  if ($n.Code -eq 0) { Stop-WithError 'NEGATIVE CONTROL FAILED: the run without the CA succeeded, so verification was not on.' }
  if ($fetch -notmatch 'CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ISSUER') { Stop-WithError 'the plain fetch did not report a certificate error.' }
  Write-Host 'PASS  without the CA the call fails with a certificate error: TLS verification is on' -ForegroundColor Green
}
catch {
  $script:failed = $true
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  if ($script:armed) {
    Step '6. Cleanup'
    foreach ($p in $script:procs) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
    & kubectl -n store delete ingress $ingressName --ignore-not-found 2>&1 | Write-Host
    & kubectl -n store delete secret $tlsSecret --ignore-not-found 2>&1 | Write-Host
    Start-Sleep -Milliseconds 500
    if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue }
    Write-Host ("work directory removed: " + (-not (Test-Path $WorkDir)))
    Show-Store 'after'
  }
}
if ($script:failed) { exit 1 }
Write-Host "`nExternal-store proof passed." -ForegroundColor Green
exit 0
