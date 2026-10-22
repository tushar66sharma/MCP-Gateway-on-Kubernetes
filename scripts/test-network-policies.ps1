# Probes the NetworkPolicies from short-lived pods (curlimages/curl) in the CURRENT kube context.
# "Blocked" = curl exit code 7 (refused) or 28 (timeout) and no HTTP code. Prints a table and exits 1
# on any mismatch. Probe pods comply with Pod Security "restricted" (non-root, seccomp, no caps, no token).
param([int]$SettleSeconds = 10)
$ErrorActionPreference = 'Stop'
function Stop-WithError([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) { Stop-WithError "'kubectl' not found on PATH." }
$ctx = (kubectl config current-context).Trim()
if ($ctx -notin 'k3d-urumi', 'k3d-urumi-prod') {
  Stop-WithError "Refusing to run against context '$ctx'. Use k3d-urumi or k3d-urumi-prod (kubectl config use-context ...)."
}

$image = 'curlimages/curl:8.22.0'
$inst = 'app.kubernetes.io/instance=urumi'
function Labels([string]$name) { "$inst,app.kubernetes.io/name=$name" }

# kube-router programs a NEW pod's rules a few seconds after it starts (observed 3 to 6 s on 2026-10-22): until then
# a pod is unrestricted for rows that should be blocked and cut off for rows that should be allowed. Each probe
# therefore sleeps -SettleSeconds before it curls.
# Each row: from, namespace, pod labels ('' = none), url, expected (blocked | any | <http code>), optional extra curl args
# A private address that IS reachable without any policy (the node's own IP; Traefik answers on 80), so the
# private-range 'except' is really tested. The 169.254.169.254 row alone would pass vacuously on k3d (no route).
$nodeJson = kubectl get nodes -o json
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not list the nodes.' }
$nodeIp = (($nodeJson | ConvertFrom-Json).items[0].status.addresses | Where-Object { $_.type -eq 'InternalIP' } | Select-Object -First 1).address
if (-not $nodeIp) { Stop-WithError 'Could not read the node InternalIP.' }
$matrix = @(
  @('default namespace',        'default', '',                       'http://mcp-woocommerce.mcp.svc:3001/mcp',        'blocked'),
  @('default namespace',        'default', '',                       'http://postgres.gateway.svc:5432',               'blocked'),
  @('default namespace',        'default', '',                       'http://mariadb.store.svc:3306',                  'blocked'),
  @('mcp-notes (mcp)',          'mcp',     (Labels 'mcp-notes'),     'http://wordpress.store.svc/wp-login.php',        'blocked'),
  @('mcp-notes (mcp)',          'mcp',     (Labels 'mcp-notes'),     'http://postgres.gateway.svc:5432',               'blocked'),
  @('mcp-notes (mcp)',          'mcp',     (Labels 'mcp-notes'),     'https://example.com',                            'blocked'),
  @('gateway (gateway)',        'gateway', (Labels 'gateway'),       'http://mcp-woocommerce.mcp.svc:3001/mcp',        '401', '-X POST -d {}'),
  @('gateway (gateway)',        'gateway', (Labels 'gateway'),       'https://api.groq.com',                           'any'),
  @('gateway (gateway)',        'gateway', (Labels 'gateway'),       'http://mariadb.store.svc:3306',                  'blocked'),
  @('gateway (gateway)',        'gateway', (Labels 'gateway'),       'http://169.254.169.254',                         'blocked'),
  @('gateway (gateway)',        'gateway', (Labels 'gateway'),       "http://$nodeIp",                                  'blocked'),
  @('mcp-woocommerce (mcp)',    'mcp',     (Labels 'mcp-woocommerce'), 'http://wordpress.store.svc/wp-login.php',      '200', '-H X-Forwarded-Proto:https'),  # with TLS on, WordPress redirects plain http (302) to https
  @('dashboard (gateway)',      'gateway', (Labels 'dashboard'),     'http://gateway.gateway.svc:3000/healthz',        'blocked')
)

# Runs kubectl with a hand-built command line: Windows PowerShell 5.1 mangles arguments that contain both
# spaces and double quotes (the --overrides JSON), so the process is started directly.
function Invoke-Kubectl([string]$ArgumentLine, [int]$TimeoutSeconds = 120) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command kubectl).Source
  $psi.Arguments = $ArgumentLine
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi)
  $errTask = $p.StandardError.ReadToEndAsync()
  $outTask = $p.StandardOutput.ReadToEndAsync()
  if (-not $p.WaitForExit($TimeoutSeconds * 1000)) {
    try { $p.Kill() } catch { }
    return 'TIMEOUT'
  }
  $p.WaitForExit()
  $outTask.Result + $errTask.Result
}
# Removes probe pods left behind by an interrupted or hung run (--rm only fires on a normal exit).
function Remove-ProbePods {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  kubectl delete pods -A -l urumi-np-probe=true --now --ignore-not-found 2>&1 | Out-Null
  $ErrorActionPreference = $prev
}
function Get-Overrides([string]$podName, [string]$shell) {
  $o = [ordered]@{ spec = [ordered]@{
      automountServiceAccountToken = $false
      securityContext = [ordered]@{ runAsNonRoot = $true; runAsUser = 100; runAsGroup = 101; seccompProfile = @{ type = 'RuntimeDefault' } }
      containers = @([ordered]@{
          name = $podName; image = $image; command = @('sh', '-c', $shell)
          securityContext = [ordered]@{ allowPrivilegeEscalation = $false; capabilities = @{ drop = @('ALL') }; runAsNonRoot = $true; runAsUser = 100 }
      })
  } }
  ($o | ConvertTo-Json -Depth 8 -Compress).Replace('"', '\"')
}

$rows = @(); $failed = 0; $n = 0
Remove-ProbePods
try {
foreach ($m in $matrix) {
  $n++
  $from, $ns, $labels, $url, $expected, $extra = $m
  $pod = "np-$n"
  $shell = "sleep $SettleSeconds; curl -s -o /dev/null -w code=%{http_code} -m 5 $extra $url; echo rc=`$?"
  $line = "run $pod -n $ns --rm -i --restart=Never --image=$image"
  $line += " --labels=urumi-np-probe=true"
  if ($labels) { $line += ",$labels" }
  $line += " `"--overrides=$(Get-Overrides $pod $shell)`""
  $timeout = $SettleSeconds + 90
  $out = Invoke-Kubectl $line $timeout
  if ($out -notmatch "rc=\d+") { Remove-ProbePods; Start-Sleep -Seconds 3; $out = Invoke-Kubectl $line $timeout }  # one retry if the pod itself failed to run
  $code = if ($out -match 'code=(\d+)') { $Matches[1] } else { '' }
  $rc = if ($out -match 'rc=(\d+)') { [int]$Matches[1] } else { -1 }
  $isBlocked = ($rc -in 7, 28) -and ($code -eq '000' -or $code -eq '')
  $actual = if ($rc -eq -1) { $(if ($out -eq 'TIMEOUT') { 'no result (probe timed out)' } else { 'no result (probe pod failed)' }) } elseif ($isBlocked) { "blocked (curl exit $rc)" } else { "reachable (HTTP $code, curl exit $rc)" }
  $ok = switch ($expected) {
    'blocked' { $isBlocked }
    'any'     { ($rc -ne -1) -and (-not $isBlocked) -and $code -ne '000' }
    default   { $code -eq $expected -and $rc -eq 0 }
  }
  if (-not $ok) { $failed++ }
  $exp = switch ($expected) { 'blocked' { 'blocked' } 'any' { 'reachable, any HTTP code' } default { "reachable, $expected" } }
  $rows += [pscustomobject]@{ From = $from; To = $url; Expected = $exp; Actual = $actual; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }) }
}
} finally { Remove-ProbePods }
$rows | Format-Table -AutoSize -Wrap | Out-String -Width 220 | Write-Host
if ($failed -gt 0) { Stop-WithError "$failed of $n probes did not behave as designed." }
Write-Host "NetworkPolicies behave as designed ($n probes)" -ForegroundColor Green
