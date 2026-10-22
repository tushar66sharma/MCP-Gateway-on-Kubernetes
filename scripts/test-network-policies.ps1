# Probes the NetworkPolicies from short-lived pods (curlimages/curl) in the CURRENT kube context.
# "Blocked" = curl exit code 7 (refused) or 28 (timeout) and no HTTP code. Prints a table and exits 1
# on any mismatch. Probe pods comply with Pod Security "restricted" (non-root, seccomp, no caps, no token).
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

# Each row: from, namespace, pod labels ('' = none), url, expected (blocked | any | <http code>), optional extra curl args
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
  @('mcp-woocommerce (mcp)',    'mcp',     (Labels 'mcp-woocommerce'), 'http://wordpress.store.svc/wp-login.php',      '200'),
  @('dashboard (gateway)',      'gateway', (Labels 'dashboard'),     'http://gateway.gateway.svc:3000/healthz',        'blocked')
)

# Runs kubectl with a hand-built command line: Windows PowerShell 5.1 mangles arguments that contain both
# spaces and double quotes (the --overrides JSON), so the process is started directly.
function Invoke-Kubectl([string]$ArgumentLine) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command kubectl).Source
  $psi.Arguments = $ArgumentLine
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi)
  $errTask = $p.StandardError.ReadToEndAsync()
  $out = $p.StandardOutput.ReadToEnd()
  $p.WaitForExit()
  $out + $errTask.Result
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
foreach ($m in $matrix) {
  $n++
  $from, $ns, $labels, $url, $expected, $extra = $m
  $pod = "np-$n"
  $shell = "curl -s -o /dev/null -w code=%{http_code} -m 5 $extra $url; echo rc=`$?"
  $line = "run $pod -n $ns --rm -i --restart=Never --image=$image"
  if ($labels) { $line += " --labels=$labels" }
  $line += " `"--overrides=$(Get-Overrides $pod $shell)`""
  $out = Invoke-Kubectl $line
  if ($out -notmatch "rc=\d+") { Start-Sleep -Seconds 3; $out = Invoke-Kubectl $line }  # one retry if the pod itself failed to run
  $code = if ($out -match 'code=(\d+)') { $Matches[1] } else { '' }
  $rc = if ($out -match 'rc=(\d+)') { [int]$Matches[1] } else { -1 }
  $isBlocked = ($rc -in 7, 28) -and ($code -eq '000' -or $code -eq '')
  $actual = if ($rc -eq -1) { 'no result (probe pod failed)' } elseif ($isBlocked) { "blocked (curl exit $rc)" } else { "reachable (HTTP $code, curl exit $rc)" }
  $ok = switch ($expected) {
    'blocked' { $isBlocked }
    'any'     { ($rc -ne -1) -and (-not $isBlocked) -and $code -ne '000' }
    default   { $code -eq $expected -and $rc -eq 0 }
  }
  if (-not $ok) { $failed++ }
  $exp = switch ($expected) { 'blocked' { 'blocked' } 'any' { 'reachable, any HTTP code' } default { "reachable, $expected" } }
  $rows += [pscustomobject]@{ From = $from; To = $url; Expected = $exp; Actual = $actual; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }) }
}
$rows | Format-Table -AutoSize -Wrap | Out-String -Width 220 | Write-Host
if ($failed -gt 0) { Stop-WithError "$failed of $n probes did not behave as designed." }
Write-Host "NetworkPolicies behave as designed ($n probes)" -ForegroundColor Green
