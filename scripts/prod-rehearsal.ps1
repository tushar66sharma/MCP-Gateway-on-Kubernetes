# Production rehearsal: installs deploy/values-prod.yaml (+ deploy/values-prod-test.yaml) into a temporary
# second k3d cluster called urumi-prod, checks it, and deletes it again.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prod-rehearsal.ps1 -Up       # stop urumi, create + install
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prod-rehearsal.ps1 -Verify   # PASS/FAIL rows
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prod-rehearsal.ps1 -Down     # delete urumi-prod, start urumi
# Safety:
#   * Every kubectl/helm call that changes state runs only after Assert-ProdContext (current context must be
#     k3d-urumi-prod) and also carries --context k3d-urumi-prod.
#   * -Down deletes only the cluster named urumi-prod (a literal, never a parameter). The local cluster urumi is
#     only stopped (-Up) and started (-Down): its data and volumes are never touched.
#   * Passwords are read from Secrets into variables and are never printed; temp files are removed afterwards.
# Needs: docker, k3d, kubectl, helm, git, bash (Git Bash), curl.exe, node (for the gateway smoke test).
[CmdletBinding()]
param([switch]$Up, [switch]$Verify, [switch]$Down, [switch]$SkipSmoke)
$ErrorActionPreference = 'Continue'

$ProdCluster = 'urumi-prod'
$ProdContext = 'k3d-urumi-prod'
$CertManagerUrl = 'https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml'
$StoreUrl = 'https://store.prod.localhost:8443'
$AppUrl = 'https://app.prod.localhost:8443'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$scratch = Join-Path ([IO.Path]::GetTempPath()) 'urumi-prod-rehearsal'

function Stop-WithError([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

if ((@($Up, $Verify, $Down) | Where-Object { $_ }).Count -ne 1) {
  Stop-WithError 'Pass exactly one of -Up, -Verify, -Down.'
}
foreach ($tool in 'docker', 'k3d', 'kubectl', 'helm', 'git') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-WithError "'$tool' was not found on PATH." }
}

function Assert-ProdContext {
  $ctx = (kubectl config current-context 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $ctx -or $ctx.Trim() -ne $ProdContext) {
    Stop-WithError "The kube context is '$ctx', not '$ProdContext'. Refusing to continue (run: kubectl config use-context $ProdContext)."
  }
}
# kubectl/helm wrappers: assert, then pin the context explicitly as well.
function Kube { Assert-ProdContext; kubectl --context $ProdContext @args }
function HelmP { Assert-ProdContext; helm --kube-context $ProdContext @args }

function Step([string]$Text) { Write-Host ""; Write-Host "== $Text" -ForegroundColor Cyan }

if ($Up) {
  Step 'Stop the local cluster urumi (data is kept)'
  $listed = k3d cluster list -o json | ConvertFrom-Json
  if ($listed | Where-Object { $_.name -eq $ProdCluster }) { Stop-WithError "Cluster $ProdCluster already exists. Run -Down first." }
  $local = $listed | Where-Object { $_.name -eq 'urumi' }
  if ($local -and $local.serversRunning -gt 0) {
    k3d cluster stop urumi
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'k3d cluster stop urumi failed.' }
  } else { Write-Host 'urumi is already stopped (or absent).' }

  Step "Create the cluster $ProdCluster"
  k3d cluster create --config deploy/k3d-prod-test.yaml
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'k3d cluster create failed.' }
  kubectl config use-context $ProdContext | Out-Null
  Assert-ProdContext
  Kube wait --for=condition=Ready node --all --timeout=180s
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'The node did not become Ready.' }

  Step 'Install cert-manager v1.21.2 and the self-signed issuer, Traefik config'
  Kube apply -f $CertManagerUrl | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not apply the cert-manager manifest.' }
  foreach ($d in 'cert-manager', 'cert-manager-cainjector', 'cert-manager-webhook') {
    Kube -n cert-manager rollout status "deployment/$d" --timeout=300s
    if ($LASTEXITCODE -ne 0) { Stop-WithError "cert-manager deployment $d did not become ready." }
  }
  # The webhook can answer "ready" a moment before it accepts ClusterIssuers: retry the apply.
  $applied = $false
  foreach ($i in 1..12) {
    Kube apply -f deploy/prod/cluster-issuer-selfsigned.yaml
    if ($LASTEXITCODE -eq 0) { $applied = $true; break }
    Start-Sleep -Seconds 5
  }
  if (-not $applied) { Stop-WithError 'Could not apply the selfsigned ClusterIssuer.' }
  Kube apply -f deploy/prod/traefik-config.yaml
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not apply the Traefik HelmChartConfig.' }

  Step 'Create the production Secrets (LLM keys are skipped: no terminal prompt)'
  Assert-ProdContext
  # Git Bash explicitly: the bash.exe in the Windows system folder is WSL and would run the script in the wrong environment.
  $gitCmd = (Get-Command git).Source
  $bash = Join-Path (Split-Path -Parent (Split-Path -Parent $gitCmd)) 'bin\bash.exe'
  if (-not (Test-Path $bash)) { Stop-WithError "Git Bash was not found at $bash." }
  # Piped (not a terminal) stdin: the script only asks for LLM keys on a terminal.
  $null | & $bash scripts/prod/create-prod-secrets.sh admin@example.com
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'create-prod-secrets.sh failed.' }

  Step 'Build the images for HEAD and import them into the rehearsal cluster'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-images.ps1') -Cluster $ProdCluster
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'build-images.ps1 failed.' }
  $imagesFile = Join-Path $root "deploy/.images.$ProdCluster.yaml"
  if (-not (Test-Path $imagesFile)) { Stop-WithError "$imagesFile was not written." }

  Step 'helm upgrade --install (values-prod.yaml + values-prod-test.yaml)'
  HelmP upgrade --install urumi charts/urumi-platform -n urumi-system --create-namespace `
    -f deploy/values-prod.yaml -f deploy/values-prod-test.yaml -f $imagesFile --wait --timeout 15m
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'helm upgrade --install failed (see output above).' }
  Write-Host 'Installed. Next: scripts\prod-rehearsal.ps1 -Verify' -ForegroundColor Green
  exit 0
}

if ($Down) {
  Step "Delete the rehearsal cluster $ProdCluster"
  $listed = k3d cluster list -o json | ConvertFrom-Json
  if ($listed | Where-Object { $_.name -eq $ProdCluster }) {
    k3d cluster delete urumi-prod
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'k3d cluster delete urumi-prod failed.' }
  } else { Write-Host "$ProdCluster does not exist." }
  if (Test-Path $scratch) { Remove-Item -Recurse -Force $scratch }
  Step 'Start the local cluster urumi again'
  k3d cluster start urumi
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'k3d cluster start urumi failed.' }
  kubectl config use-context k3d-urumi | Out-Null
  Write-Host 'Done. Wait for the pods, or run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1' -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------- -Verify (read-only)
$script:fail = 0
function Row([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { Write-Host "PASS  $Name  $Detail" } else { Write-Host "FAIL  $Name  $Detail" -ForegroundColor Red; $script:fail++ }
}
Assert-ProdContext
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$cookieJar = Join-Path $scratch 'cookies.txt'
$bodyFile = Join-Path $scratch 'login.json'
Remove-Item -Force -ErrorAction SilentlyContinue $cookieJar, $bodyFile

# 1. every pod ready under restricted
$pods = (Kube get pods -A -o json | ConvertFrom-Json).items | Where-Object { $_.metadata.namespace -in 'store', 'mcp', 'gateway' }
$bad = @()
foreach ($p in $pods) {
  if ($p.status.phase -eq 'Succeeded') { continue }
  $cs = @($p.status.containerStatuses)
  $ready = @($cs | Where-Object { $_.ready }).Count
  if ($p.status.phase -ne 'Running' -or $ready -ne $cs.Count -or $cs.Count -eq 0) { $bad += "$($p.metadata.namespace)/$($p.metadata.name) $ready/$($cs.Count)" }
}
$running = @($pods | Where-Object { $_.status.phase -eq 'Running' }).Count
$nsJson = (Kube get ns store mcp gateway -o json | ConvertFrom-Json).items
$restricted = @($nsJson | Where-Object { $_.metadata.labels.'pod-security.kubernetes.io/enforce' -eq 'restricted' }).Count
Row 'all pods ready (store, mcp, gateway)' (($bad.Count -eq 0) -and $running -ge 8) "running=$running notReady=[$($bad -join '; ')]"
Row 'namespaces enforce restricted' ($restricted -eq 3) "restricted=$restricted/3"

# 2. certificates
$certs = (Kube get certificate -A -o json | ConvertFrom-Json).items
$certsReady = @($certs | Where-Object { @($_.status.conditions | Where-Object { $_.type -eq 'Ready' -and $_.status -eq 'True' }).Count -eq 1 }).Count
Row 'certificates Ready=True' (($certs.Count -ge 2) -and ($certsReady -eq $certs.Count)) "ready=$certsReady/$($certs.Count): $(($certs | ForEach-Object { $_.metadata.namespace + '/' + $_.metadata.name }) -join ', ')"

# 3. http -> https redirect (the exact answer is recorded; a :443 target instead of :8443 is a port-mapping artefact)
$r = curl.exe -s -o NUL -w "%{http_code} %{redirect_url}" http://store.prod.localhost:8080/
Write-Host "      redirect store: $r"
Row 'http->https redirect (store): 301 to https' ($r -match '^301 https://') $r
$r2 = curl.exe -s -o NUL -w "%{http_code} %{redirect_url}" http://app.prod.localhost:8080/
Write-Host "      redirect app:   $r2"
Row 'http->https redirect (app): 301 to https' ($r2 -match '^301 https://') $r2

# 4. HSTS + 200 on the store
$h = curl.exe -k -s -I "$StoreUrl/"
$status = ($h | Select-Object -First 1)
Row 'store https: 200' ($status -match ' 200') "$status"
Row 'store https: Strict-Transport-Security header' ([bool]($h | Select-String -SimpleMatch 'Strict-Transport-Security' -Quiet)) (($h | Select-String 'Strict-Transport-Security') -join '')
$h2 = curl.exe -k -s -I "$AppUrl/"
Row 'dashboard https: HSTS header' ([bool]($h2 | Select-String -SimpleMatch 'Strict-Transport-Security' -Quiet)) ''

# 5. unauthenticated API
$me = curl.exe -k -s -w "`n%{http_code}" "$AppUrl/api/auth/me"
$meLines = @($me -split "`n")
$meCode = $meLines[-1].Trim()
Row '/api/auth/me without login: 401 JSON' (($meCode -eq '401') -and ($meLines[0] -match '^\s*\{')) "code=$meCode body=$($meLines[0])"

# 6. no mixed content
$html = curl.exe -k -s "$StoreUrl/"
$mixed = @($html | Select-String -Pattern 'http://store\.prod' -AllMatches).Count
$https = @($html | Select-String -Pattern 'https://store\.prod\.localhost:8443' -AllMatches).Count
Row 'store HTML: no http://store.prod references' ($mixed -eq 0 -and $https -gt 0) "http=$mixed https-lines=$https"

# 7. login with the bootstrap admin: Set-Cookie must be Secure (password never printed)
$email = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((Kube -n gateway get secret gateway-bootstrap -o 'jsonpath={.data.email}')))
$pw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((Kube -n gateway get secret gateway-bootstrap -o 'jsonpath={.data.password}')))
[IO.File]::WriteAllText($bodyFile, (@{ email = $email; password = $pw } | ConvertTo-Json -Compress))
$pw = $null
$hdr = curl.exe -k -s -D - -o NUL -c $cookieJar -H "Origin: $AppUrl" -H 'Content-Type: application/json' --data-binary "@$bodyFile" "$AppUrl/api/auth/login"
Remove-Item -Force -ErrorAction SilentlyContinue $bodyFile
$loginCode = ($hdr | Select-Object -First 1)
$setCookies = @($hdr | Where-Object { $_ -match '^(?i)set-cookie:' })
$secureAll = ($setCookies.Count -ge 1) -and (@($setCookies | Where-Object { $_ -notmatch '(?i);\s*secure' }).Count -eq 0)
Row 'login: HTTP 200' ($loginCode -match ' 200') "$loginCode"
Row 'login: every Set-Cookie has Secure' $secureAll "cookies=$($setCookies.Count) httpOnly=$(@($setCookies | Where-Object { $_ -match '(?i);\s*httponly' }).Count)"

# 8. chat not configured
$chat = curl.exe -k -s -b $cookieJar "$AppUrl/api/chat/status"
Row 'chat status: configured=false' ($chat -match '"configured"\s*:\s*false') $chat
Remove-Item -Force -ErrorAction SilentlyContinue $cookieJar

# 9. NetworkPolicy probes (current context is urumi-prod)
Assert-ProdContext
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'test-network-policies.ps1') | Tee-Object -Variable npOut | Out-Host
Row 'NetworkPolicy probe script' ($LASTEXITCODE -eq 0) "exit=$LASTEXITCODE"

# 10. gateway smoke test over https (Node needs the CA and a name it can resolve)
if ($SkipSmoke) { Write-Host 'NOTRUN  gateway smoke (-SkipSmoke)' }
else {
  Assert-ProdContext
  $secretName = (Kube -n gateway get ingress -o 'jsonpath={.items[0].spec.tls[0].secretName}')
  $caFile = Join-Path $scratch 'app-tls.crt'
  $crtB64 = Kube -n gateway get secret $secretName -o 'jsonpath={.data.tls\.crt}'
  [IO.File]::WriteAllBytes($caFile, [Convert]::FromBase64String($crtB64))
  $env:NODE_EXTRA_CA_CERTS = $caFile
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-gateway.ps1') -Base $AppUrl | Out-Host
  Row 'check-gateway.ps1 over https' ($LASTEXITCODE -eq 0) "exit=$LASTEXITCODE"
  Remove-Item Env:NODE_EXTRA_CA_CERTS -ErrorAction SilentlyContinue
}

if (Test-Path $scratch) { Remove-Item -Recurse -Force $scratch }
Write-Host ""
if ($script:fail -gt 0) { Write-Host "$($script:fail) check(s) FAILED" -ForegroundColor Red; exit 1 }
Write-Host 'All checks passed.' -ForegroundColor Green
