# Live proof of gateway.internalUpstreams (Task 5b.6, ADR-016 addendum): an MCP server that runs inside the
# cluster but is not one of the three built-in ones.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev\test-internal-upstream.ps1
#
# What it does (local k3d cluster running, release installed, images built; the admin is read from the
# gateway-bootstrap Secret into variables only):
#   1. deploys a restricted-compliant `mcp-extra` (Deployment, Service, key Secret) from the urumi/mcp-utilities image
#      on port 3010 in namespace `mcp`, and the same in a new namespace `tools-test`;
#   2. BEFORE the setting: adds both through POST /api/servers. mcp -> saved but unreachable (NetworkPolicy);
#      tools-test -> 400 SSRF_REJECTED;
#   3. helm upgrade with a temporary values file that sets gateway.internalUpstreams for both, then refreshes:
#      mcp -> connected with 4 tools, tools-test can be added -> connected, and one tools/call works through a
#      temporary API key;
#   4. cleanup (always): deletes both servers, revokes the key, deletes the test Deployments, Services, Secrets and the
#      namespace tools-test, and runs up.ps1 -Redeploy without the setting;
#   5. shows the NetworkPolicy count, SSRF_ALLOWED_INTERNAL_HOSTS and `kubectl get ns` before and after.
# Safe to re-run (it removes leftovers first). Never prints a key, a password or a token.
[CmdletBinding()]
param([string]$ScratchDir = '')
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$chart = Join-Path $root 'charts/urumi-platform'
$base = 'http://app.localhost'
$origin = @{ Origin = 'http://app.localhost' }
$testNs = 'tools-test'
$slugMcp = 'extra-mcp'
$slugTools = 'extra-tools'
if (-not $ScratchDir) { $ScratchDir = [IO.Path]::GetTempPath() }
$work = Join-Path $ScratchDir ('urumi-internal-upstream-' + [guid]::NewGuid().ToString('N'))
$script:session = $null
$script:keyId = $null
$script:failed = $false
$script:checks = @()
$script:armed = $false   # set only after the preflight passed: cleanup and restore run only then

function Step([string]$m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  $script:checks += , @($name, $ok)
  if ($ok) { Write-Host "PASS  $name" -ForegroundColor Green } else { Write-Host "FAIL  $name $detail" -ForegroundColor Red; $script:failed = $true }
}
function Run-Native([string]$exe, [string[]]$a) {
  $o = & $exe @a 2>&1 | Out-String
  return @{ Code = $LASTEXITCODE; Out = $o }
}
function Get-State([string]$title) {
  Write-Host "-- $title"
  $n = (& kubectl get networkpolicy -A --no-headers 2>$null | Measure-Object -Line).Lines
  $ssrf = ''
  $dj = (& kubectl -n gateway get deploy gateway -o json 2>$null | Out-String | ConvertFrom-Json)
  foreach ($e in @($dj.spec.template.spec.containers[0].env)) { if ($e.name -eq 'SSRF_ALLOWED_INTERNAL_HOSTS') { $ssrf = [string]$e.value } }
  Write-Host "   NetworkPolicies (all namespaces): $n"
  Write-Host "   SSRF_ALLOWED_INTERNAL_HOSTS: $ssrf"
  Write-Host '   kubectl get ns:'
  & kubectl get ns --no-headers 2>&1 | ForEach-Object { Write-Host "     $($_ -replace '\s+', ' ')" }
  return @{ Policies = $n; Ssrf = $ssrf }
}

# One API call; returns Status (HTTP code) and Json (parsed body, or $null). Never throws.
function Api([string]$method, [string]$path, $body = $null) {
  $p = @{ Uri = "$base$path"; Method = $method; UseBasicParsing = $true; TimeoutSec = 90 }
  if ($script:session) { $p.WebSession = $script:session }
  if ($method -ne 'GET') { $p.Headers = $origin; $p.ContentType = 'application/json' }
  if ($null -ne $body) { $p.Body = ($body | ConvertTo-Json -Depth 6) }
  $status = 0; $text = ''
  try {
    $r = Invoke-WebRequest @p
    $status = [int]$r.StatusCode; $text = [string]$r.Content
  }
  catch {
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try { $st = $_.Exception.Response.GetResponseStream(); if ($st.CanSeek) { $st.Position = 0 }; $sr = New-Object IO.StreamReader($st); $text = $sr.ReadToEnd() } catch { }
    }
  }
  $json = $null
  if ($text) { try { $json = $text | ConvertFrom-Json } catch { } }
  return @{ Status = $status; Json = $json }
}
function Login {
  $email = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((& kubectl -n gateway get secret gateway-bootstrap -o 'jsonpath={.data.email}')))
  $pw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((& kubectl -n gateway get secret gateway-bootstrap -o 'jsonpath={.data.password}')))
  $script:session = $null
  try {
    $null = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -Headers $origin -ContentType 'application/json' `
      -Body (@{ email = $email; password = $pw } | ConvertTo-Json) -SessionVariable s
    $script:session = $s
  }
  catch { Write-Host "login failed: $($_.Exception.Message)" -ForegroundColor Red }
  $pw = $null
  return [bool]$script:session
}
function Remove-Servers {
  $list = Api 'GET' '/api/servers'
  if ($list.Status -ne 200) { return }
  foreach ($srv in @($list.Json)) {
    if ($srv.slug -in $slugMcp, $slugTools) { $d = Api 'DELETE' "/api/servers/$($srv.id)"; Write-Host "   deleted server $($srv.slug): HTTP $($d.Status)" }
  }
}
function Get-ServerBySlug([string]$slug) {
  $list = Api 'GET' '/api/servers'
  foreach ($srv in @($list.Json)) { if ($srv.slug -eq $slug) { return $srv } }
  return $null
}
# $true when the namespace exists and carries our label (the only kind this script ever deletes).
function Test-OwnNamespace {
  $j = (& kubectl get namespace $testNs -o json 2>$null | Out-String)
  if (-not $j.Trim()) { return $false }
  try { $o = $j | ConvertFrom-Json } catch { return $false }
  return ($o.metadata.labels.'urumi.dev/test' -eq 'internal-upstream')
}
function Remove-TestKubernetes {
  & kubectl -n mcp delete deployment,service,secret -l 'urumi.dev/test=internal-upstream' --ignore-not-found 2>&1 | Out-Null
  # Only a namespace carrying our label is ever deleted.
  if (Test-OwnNamespace) { & kubectl delete namespace $testNs --wait=true --timeout=120s 2>&1 | Out-Null }
}

# Manifest for one test server. The pod is Pod Security "restricted" compliant (non-root, RuntimeDefault seccomp,
# drop ALL, no escalation, no service account token, read-only root with a /tmp volume). The key lives in a Secret.
function New-Manifest([string]$ns, [string]$tag) {
  $hosts = "mcp-extra,mcp-extra.$ns,mcp-extra.$ns.svc,mcp-extra.$ns.svc.cluster.local,127.0.0.1,localhost"
  return @"
apiVersion: v1
kind: Service
metadata:
  name: mcp-extra
  namespace: $ns
  labels: { urumi.dev/test: internal-upstream }
spec:
  selector: { app.kubernetes.io/name: mcp-extra }
  ports:
    - { name: http, port: 3010, targetPort: http }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-extra
  namespace: $ns
  labels: { urumi.dev/test: internal-upstream }
spec:
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: mcp-extra }
  template:
    metadata:
      labels: { app.kubernetes.io/name: mcp-extra, urumi.dev/test: internal-upstream }
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: mcp-extra
          image: "urumi/mcp-utilities:$tag"
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          ports:
            - { name: http, containerPort: 3010 }
          env:
            - { name: PORT, value: "3010" }
            - { name: LOG_LEVEL, value: info }
            - { name: DEFAULT_TIMEZONE, value: UTC }
            - { name: MCP_ALLOWED_HOSTS, value: "$hosts" }
            - name: UTILITIES_KEY
              valueFrom: { secretKeyRef: { name: mcp-extra-key, key: key } }
          readinessProbe: { httpGet: { path: /readyz, port: http }, periodSeconds: 5, timeoutSeconds: 3 }
          resources:
            requests: { cpu: 10m, memory: 32Mi }
            limits: { cpu: 200m, memory: 128Mi }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: tmp
          emptyDir: { sizeLimit: 16Mi }
"@
}
# Creates the key Secret from a generated value without putting the value on a command line, and returns it.
function New-KeySecret([string]$ns) {
  $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $key = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
  $f = Join-Path $work 'key.txt'
  [IO.File]::WriteAllText($f, $key)
  $r = Run-Native 'kubectl' @('-n', $ns, 'create', 'secret', 'generic', 'mcp-extra-key', "--from-file=key=$f")
  Remove-Item $f -Force -ErrorAction SilentlyContinue
  if ($r.Code -ne 0) { throw "could not create the key Secret in $ns" }
  & kubectl -n $ns label secret mcp-extra-key urumi.dev/test=internal-upstream 2>&1 | Out-Null
  return $key
}
function Deploy-TestServer([string]$ns, [string]$tag) {
  $key = New-KeySecret $ns
  $f = Join-Path $work "manifest-$ns.yaml"
  [IO.File]::WriteAllText($f, (New-Manifest $ns $tag))
  $r = Run-Native 'kubectl' @('apply', '-f', $f)
  if ($r.Code -ne 0) { throw "kubectl apply failed in ${ns}: $($r.Out)" }
  $r = Run-Native 'kubectl' @('-n', $ns, 'rollout', 'status', 'deployment/mcp-extra', '--timeout=120s')
  if ($r.Code -ne 0) { throw "mcp-extra in $ns did not become ready: $($r.Out)" }
  return $key
}
function Add-Server([string]$slug, [string]$ns, [string]$key) {
  return Api 'POST' '/api/servers' @{ slug = $slug; name = "Internal upstream proof ($ns)"; url = "http://mcp-extra.$ns.svc.cluster.local:3010/mcp"
    authType = 'header'; authHeaderName = 'X-Utilities-Key'; credential = $key }
}
# Refreshes until the server is connected (the kube-router rules for the new policy arrive a few seconds late).
function Wait-Connected([string]$id) {
  $last = $null
  for ($i = 0; $i -lt 12; $i++) {
    $r = Api 'POST' "/api/servers/$id/refresh"
    if ($r.Status -eq 200) { $last = $r.Json; if ($last.status -eq 'connected') { return $last } }
    Start-Sleep -Seconds 5
  }
  return $last
}
function Describe-Server($s) {
  if (-not $s) { return 'no response' }
  return "status=$($s.status), tools=$($s.toolCount), lastError=$($s.lastError)"
}

# Preflight: runs BEFORE the try block, so a refusal exits without any pre-clean, cleanup or redeploy.
function Stop-Preflight([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
foreach ($t in 'kubectl', 'helm', 'node') { if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Stop-Preflight "'$t' not found on PATH." } }
$ctx = ''
$ctxOut = (& kubectl config current-context 2>$null)
if ($LASTEXITCODE -eq 0 -and $ctxOut) { $ctx = ([string]$ctxOut).Trim() }
if ($ctx -ne 'k3d-urumi') { Stop-Preflight "Refusing to run against context '$ctx' (use k3d-urumi). Nothing was changed." }
$imagesFile = Join-Path $root 'deploy/.images.local.yaml'
$tag = ''
if (Test-Path $imagesFile) { if ((Get-Content $imagesFile -Raw) -match 'imageTag:\s*"?([A-Za-z0-9._-]+)"?') { $tag = $Matches[1] } }
if (-not $tag) { Stop-Preflight 'No image tag in deploy/.images.local.yaml; run scripts\build-images.ps1 first.' }
if (-not (Test-Path (Join-Path $root 'node_modules/@modelcontextprotocol/client'))) { Stop-Preflight 'Dependencies not installed: run npm ci from the repository root.' }
$nsExisting = (& kubectl get namespace $testNs --ignore-not-found --no-headers 2>$null)
if ($nsExisting) {
  if (-not (Test-OwnNamespace)) { Stop-Preflight "Namespace '$testNs' already exists and was not created by this script (no label urumi.dev/test=internal-upstream). Refusing to start; nothing was changed." }
}

$before = $null
New-Item -ItemType Directory -Path $work | Out-Null
$script:armed = $true
try {
  Step 'Pre-clean (leftovers of an earlier run)'
  if (-not (Login)) { throw 'Could not log in as the bootstrap admin.' }
  Remove-Servers
  Remove-TestKubernetes
  $before = Get-State 'BEFORE (state of the release)'

  Step '1. Deploy mcp-extra in mcp and in tools-test (restricted-compliant, key in a Secret, never printed)'
  $keyMcp = Deploy-TestServer 'mcp' $tag
  $nsFile = Join-Path $work 'namespace.yaml'
  [IO.File]::WriteAllText($nsFile, "apiVersion: v1`nkind: Namespace`nmetadata:`n  name: $testNs`n  labels:`n    urumi.dev/test: internal-upstream`n")
  $nr = Run-Native 'kubectl' @('apply', '-f', $nsFile)
  if ($nr.Code -ne 0) { throw "could not create namespace ${testNs}: $($nr.Out)" }
  $keyTools = Deploy-TestServer $testNs $tag
  & kubectl -n mcp get deploy,svc -l 'urumi.dev/test=internal-upstream' --no-headers 2>&1 | ForEach-Object { Write-Host "   mcp: $($_ -replace '\s+', ' ')" }
  & kubectl -n $testNs get deploy,svc --no-headers 2>&1 | ForEach-Object { Write-Host "   ${testNs}: $($_ -replace '\s+', ' ')" }

  Step '2. Before the setting: add both servers through POST /api/servers'
  $r1 = Add-Server $slugMcp 'mcp' $keyMcp
  Write-Host "   mcp-extra.mcp:   HTTP $($r1.Status); $(Describe-Server $r1.Json)"
  Check 'before: mcp-extra in mcp is saved (201) but not connected (NetworkPolicy blocks it)' (($r1.Status -eq 201) -and [bool]$r1.Json -and ($r1.Json.status -ne 'connected'))
  $r2 = Add-Server $slugTools $testNs $keyTools
  $code = ''
  if ($r2.Json -and $r2.Json.error) { $code = [string]$r2.Json.error.code }
  Write-Host "   mcp-extra.${testNs}: HTTP $($r2.Status); code $code"
  Check 'before: tools-test is rejected with 400 SSRF_REJECTED' (($r2.Status -eq 400) -and ($code -eq 'SSRF_REJECTED'))
  $srv = Get-ServerBySlug $slugMcp
  if ($srv) { $rf = Api 'POST' "/api/servers/$($srv.id)/refresh"; Write-Host "   mcp-extra.mcp after a refresh: $(Describe-Server $rf.Json)" }

  Step '3. Set gateway.internalUpstreams (temporary values file, helm upgrade with the same args as deploy.ps1)'
  $vals = Join-Path $work 'internal-upstreams.yaml'
  [IO.File]::WriteAllText($vals, "gateway:`n  internalUpstreams:`n    - namespace: mcp`n      port: 3010`n      podLabels:`n        app.kubernetes.io/name: mcp-extra`n    - namespace: $testNs`n      port: 3010`n")
  $helmArgs = @('upgrade', '--install', 'urumi', $chart, '--namespace', 'urumi-system', '--create-namespace',
    '-f', (Join-Path $root 'deploy/values-local.yaml'), '-f', $imagesFile, '-f', $vals, '--wait', '--timeout', '10m')
  $h = Run-Native 'helm' $helmArgs
  Write-Host ("   helm upgrade exit code {0}" -f $h.Code)
  if ($h.Code -ne 0) { throw "helm upgrade failed: $($h.Out)" }
  $during = Get-State 'DURING (internalUpstreams set)'
  Check 'during: one more NetworkPolicy (the Ingress policy in mcp)' ($during.Policies -eq ($before.Policies + 1))
  Check 'during: SSRF value lists mcp and tools-test' ($during.Ssrf -eq '*.mcp.svc.cluster.local,*.tools-test.svc.cluster.local')
  Start-Sleep -Seconds 10
  if (-not (Login)) { throw 'Could not log in again after the gateway restart.' }

  $srv = Get-ServerBySlug $slugMcp
  $ok = $false
  if ($srv) { $c = Wait-Connected $srv.id; Write-Host "   mcp-extra.mcp after refresh: $(Describe-Server $c)"; $ok = [bool]($c -and $c.status -eq 'connected' -and $c.toolCount -eq 4) }
  Check 'after the setting: mcp-extra in mcp refreshes to connected with 4 tools' $ok
  $r3 = Add-Server $slugTools $testNs $keyTools
  Write-Host "   mcp-extra.${testNs} add: HTTP $($r3.Status)"
  $ok = $false
  if ($r3.Status -eq 201 -and $r3.Json) { $c = Wait-Connected $r3.Json.id; Write-Host "   mcp-extra.${testNs} after refresh: $(Describe-Server $c)"; $ok = [bool]($c -and $c.status -eq 'connected' -and $c.toolCount -eq 4) }
  Check 'after the setting: tools-test server can be added and is connected with 4 tools' $ok

  Step 'tools/call through a temporary API key'
  $k = Api 'POST' '/api/keys' @{ name = 'internal-upstream proof (temporary)' }
  if ($k.Status -eq 201 -and $k.Json) {
    $script:keyId = $k.Json.key.id
    $env:GW_KEY = [string]$k.Json.plaintext
    try {
      $o = & node (Join-Path $root 'scripts/dev/call-gateway-tool.mjs') --url "$base/mcp" --slug $slugMcp --tool calculate --args '{\"expression\":\"6*7\"}' 2>&1 | Out-String
      $callCode = $LASTEXITCODE
    }
    finally { Remove-Item Env:GW_KEY -ErrorAction SilentlyContinue }
    Write-Host "   $($o.Trim())"
    Check 'tools/call calculate("6*7") through the gateway works (result contains 42)' (($callCode -eq 0) -and ($o -match '42'))
  }
  else { Check 'a temporary API key can be created' $false "(HTTP $($k.Status))" }
}
catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  $script:failed = $true
}
finally {
  if ($script:armed) {
    Step '4. Cleanup'
    try {
      if (-not $script:session -or ((Api 'GET' '/api/servers').Status -ne 200)) { $null = Login }
      if ($script:keyId) { $d = Api 'DELETE' "/api/keys/$($script:keyId)"; Write-Host "   revoked the temporary key: HTTP $($d.Status)" }
      Remove-Servers
    }
    catch { Write-Host "   API cleanup error: $($_.Exception.Message)" -ForegroundColor Yellow }
    Remove-TestKubernetes
    Remove-Item Env:GW_KEY -ErrorAction SilentlyContinue
    $up = Run-Native 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'scripts/up.ps1'), '-Redeploy')
    Write-Host "   up.ps1 -Redeploy exit code $($up.Code)"
    if ($up.Code -ne 0) { Write-Host $up.Out; $script:failed = $true }
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
    $after = Get-State 'AFTER (cleanup and redeploy without the setting)'
    if ($before) {
      Check 'after: NetworkPolicy count equals the count before' ($after.Policies -eq $before.Policies) "(before $($before.Policies), after $($after.Policies))"
      Check 'after: SSRF_ALLOWED_INTERNAL_HOSTS equals the value before' ($after.Ssrf -eq $before.Ssrf)
    }
    $nsLeft = (& kubectl get ns $testNs --ignore-not-found --no-headers 2>$null)
    Check "after: namespace $testNs is gone" (-not $nsLeft)
    $podsLeft = (& kubectl get pods -A --no-headers 2>$null | Where-Object { $_ -match 'mcp-extra' })
    Check 'after: no mcp-extra pod is left' (-not $podsLeft)
    & kubectl get pods -A --no-headers 2>&1 | Where-Object { $_ -notmatch 'Completed' } | ForEach-Object { Write-Host "   $($_ -replace '\s+', ' ')" }
  }
}
if ($script:failed) { Write-Host "`nFAILED" -ForegroundColor Red; exit 1 }
Write-Host "`nAll checks passed ($($script:checks.Count))" -ForegroundColor Green
exit 0
