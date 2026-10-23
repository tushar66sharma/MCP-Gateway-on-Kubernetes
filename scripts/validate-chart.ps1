# Chart render and schema tests (no cluster needed). Task 5.6 extends this file.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-chart.ps1
#
# Compare-ToMainRender <label> <values file> [<ignored env var names>] (reusable, Tasks 5b.5 and 5b.6):
#   Renders the chart at main commit d57c8ae (git archive into a temp dir) and the working-tree chart with the
#   same values file, then requires the same set of (kind, namespace, name) objects and identical normalised
#   text for each. Normalisation drops: Secret data/stringData (generated at random), the value of every
#   checksum/* annotation (derived from random Secrets and from the ignored env vars), comment-only lines (incl.
#   "# Source:"), blank lines and trailing spaces, and the env entries named in the third argument (default: the gateway variables
#   added by Phase 5b: LLM_MAX_OUTPUT_TOKENS, CHAT_TOPIC_CHECK, CHAT_TOPIC_CHECK_MODEL,
#   CHAT_TOPIC_CHECK_TIMEOUT_MS, CHAT_DAILY_TOKEN_BUDGET). A later task that adds default-off settings of its
#   own extends that default list. Returns @{ Ok; Detail; Count; Store; Mcp; Network }.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$chart = Join-Path $root 'charts\urumi-platform'
$local = Join-Path $root 'deploy\values-local.yaml'
$prod = Join-Path $root 'deploy\values-prod.yaml'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('urumi-validate-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$script:fail = 0

function Report([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Write-Host "PASS  $name" } else { Write-Host "FAIL  $name $detail"; $script:fail++ }
}

# Runs helm with merged output, returns exit code and text (native stderr must not throw).
function Invoke-Helm([string[]]$helmArgs) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = & helm @helmArgs 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  return @{ Code = $code; Out = $out }
}

# A values override file; the content is written verbatim so hostile strings stay exact.
function Case-Lint([string]$name, [string]$yaml, [bool]$expectOk) {
  $f = Join-Path $tmp ([guid]::NewGuid().ToString('N') + '.yaml')
  [IO.File]::WriteAllText($f, $yaml)
  $r = Invoke-Helm @('lint', $chart, '-f', $local, '-f', $f)
  Report $name (($r.Code -eq 0) -eq $expectOk) "(helm lint exit $($r.Code))"
}

# --- Compare-ToMainRender: see the header ---------------------------------------------------------------------
$mainCommit = 'd57c8ae'
$script:mainChartDir = $null
function Get-MainChart {
  if ($script:mainChartDir) { return $script:mainChartDir }
  $dir = Join-Path $tmp 'main-chart'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $tar = Join-Path $tmp 'main-chart.tar'
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  Push-Location $root
  & git archive --format=tar -o $tar $mainCommit charts/urumi-platform 2>&1 | Out-Null
  $c1 = $LASTEXITCODE
  Pop-Location
  # Relative names: a Windows drive path (C:\...) is read as host:file by GNU tar.
  if ($c1 -eq 0) { Push-Location $tmp; & tar -xf main-chart.tar -C main-chart 2>&1 | Out-Null; $c1 = $LASTEXITCODE; Pop-Location }
  $ErrorActionPreference = $old
  if ($c1 -ne 0) { return $null }
  $script:mainChartDir = Join-Path $dir 'charts\urumi-platform'
  return $script:mainChartDir
}

function ConvertTo-NormalisedObjects([string]$rendered, [string[]]$ignoreEnv) {
  $map = @{}
  foreach ($doc in ($rendered -split '(?m)^---\s*$')) {
    $lines = @(($doc -split "`r?`n") | Where-Object { $_.Trim() -ne '' -and $_ -notmatch '^\s*#' } | ForEach-Object { $_.TrimEnd() })
    if (-not ($lines | Where-Object { $_ -match '^kind: ' })) { continue }
    $text = $lines -join "`n"
    $kind = if ($text -match '(?m)^kind: (\S+)') { $Matches[1] } else { '' }
    $name = if ($text -match '(?m)^  name: (\S+)') { $Matches[1] } else { '' }
    $ns = if ($text -match '(?m)^  namespace: (\S+)') { $Matches[1] } else { '' }
    if ($kind -eq 'Secret') {
      $kept = New-Object System.Collections.Generic.List[string]; $skip = $false
      foreach ($l in $lines) {
        if ($l -match '^(data|stringData):') { $skip = $true; $kept.Add($l); continue }
        if ($skip -and $l -match '^\s') { continue }
        $skip = $false; $kept.Add($l)
      }
      $text = $kept -join "`n"
    }
    $text = [regex]::Replace($text, '(?m)^(\s*checksum/[A-Za-z0-9.-]+): .*$', '$1: <checksum>')
    foreach ($e in $ignoreEnv) { $text = [regex]::Replace($text, '(?m)^\s+- name: ' + [regex]::Escape($e) + '\n\s+value: .*\n?', '') }
    $map["$kind|$ns|$name"] = $text.TrimEnd()
  }
  return $map
}

function Compare-ToMainRender([string]$label, [string]$valuesFile,
    [string[]]$ignoreEnv = @('LLM_MAX_OUTPUT_TOKENS', 'CHAT_TOPIC_CHECK', 'CHAT_TOPIC_CHECK_MODEL', 'CHAT_TOPIC_CHECK_TIMEOUT_MS', 'CHAT_DAILY_TOKEN_BUDGET')) {
  $res = @{ Ok = $false; Detail = ''; Count = 0; Store = 0; Mcp = 0; Network = 0 }
  $main = Get-MainChart
  if (-not $main) { $res.Detail = "could not extract the chart at $mainCommit (git archive/tar failed)"; return $res }
  $a = Invoke-Helm @('template', 'urumi', $main, '-n', 'urumi-system', '-f', $valuesFile)
  $b = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $valuesFile)
  if ($a.Code -ne 0 -or $b.Code -ne 0) { $res.Detail = "helm template failed (main $($a.Code), current $($b.Code)) $($a.Out) $($b.Out)"; return $res }
  $ma = ConvertTo-NormalisedObjects $a.Out $ignoreEnv
  $mb = ConvertTo-NormalisedObjects $b.Out $ignoreEnv
  $problems = New-Object System.Collections.Generic.List[string]
  foreach ($k in $ma.Keys) { if (-not $mb.ContainsKey($k)) { $problems.Add("missing now: $k") } }
  foreach ($k in $mb.Keys) { if (-not $ma.ContainsKey($k)) { $problems.Add("new object: $k") } }
  foreach ($k in $ma.Keys) {
    if ($mb.ContainsKey($k) -and $ma[$k] -ne $mb[$k]) {
      $problems.Add("differs: $k")
      $x = $ma[$k] -split "`n"; $y = $mb[$k] -split "`n"
      $d = Compare-Object $x $y | Select-Object -First 4 | ForEach-Object { "      $($_.SideIndicator) $($_.InputObject)" }
      foreach ($line in $d) { $problems.Add($line) }
    }
  }
  $res.Count = $mb.Count
  foreach ($k in $mb.Keys) {
    $parts = $k -split '\|'
    if ($parts[1] -eq 'store') { $res.Store++ }
    if ($parts[1] -eq 'mcp') { $res.Mcp++ }
    if ($parts[0] -eq 'NetworkPolicy') { $res.Network++ }
  }
  $res.Ok = ($problems.Count -eq 0) -and ($mb.Count -gt 0)
  $res.Detail = ($problems | Select-Object -First 20) -join "`n"
  return $res
}

Case-Lint 'storeHost with PHP injection is rejected' "global:`n  storeHost: `"x');evil('`"`n" $false
Case-Lint 'appHost with upper case is rejected' "global:`n  appHost: `"App.Example.com`"`n" $false
Case-Lint 'tls.enabled with publicScheme http is rejected' "global:`n  publicScheme: http`n  tls:`n    enabled: true`n" $false
Case-Lint 'empty storeSetup.timezone is rejected' "storeSetup:`n  timezone: `"`"`n" $false
Case-Lint 'timezone with a quote is rejected' "storeSetup:`n  timezone: `"UTC'; x`"`n" $false
Case-Lint 'non-boolean storeSetup.customerRegistration is rejected' "storeSetup:`n  customerRegistration: ""nope""`n" $false
Case-Lint 'unknown podSecurity.level is rejected' "podSecurity:`n  level: strict`n" $false
Case-Lint 'valid hostnames and timezone are accepted' "global:`n  storeHost: shop.example.com`n  appHost: app-1.example.com`nstoreSetup:`n  timezone: America/Argentina/Buenos_Aires`n" $true

foreach ($v in @($local, $prod)) {
  $r = Invoke-Helm @('lint', $chart, '-f', $v)
  Report "helm lint -f $(Split-Path -Leaf $v)" ($r.Code -eq 0) $r.Out
}

# Rendered output checks.
$r = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local)
Report 'helm template renders' ($r.Code -eq 0) $r.Out
$docs = $r.Out -split '(?m)^---\s*$'

foreach ($ns in 'store', 'mcp', 'gateway') {
  $d = $docs | Where-Object { $_ -match '(?m)^kind: Namespace' -and $_ -match "(?m)^  name: $ns\s*$" } | Select-Object -First 1
  $ok = $false
  if ($d) {
    $ok = $true
    foreach ($m in 'enforce', 'warn', 'audit') {
      if ($d -notmatch "pod-security\.kubernetes\.io/$m`: `"?restricted`"?") { $ok = $false }
      if ($d -notmatch "pod-security\.kubernetes\.io/$m-version`: `"?latest`"?") { $ok = $false }
    }
  }
  Report "namespace $ns has enforce/warn/audit restricted + -version latest" $ok
}

# Parse every emptyDir block in the rendered output: the block's direct children (lines indented deeper
# than the emptyDir key, up to the next line at the same or lower indent) must include a sizeLimit key.
$lines = $r.Out -split "`r?`n"
$total = 0; $bad = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -notmatch '^(\s*)emptyDir:(.*)$') { continue }
  $total++
  $indent = $Matches[1].Length
  $childIndent = -1; $hasLimit = $false
  for ($j = $i + 1; $j -lt $lines.Count; $j++) {
    $l = $lines[$j]
    if ($l.Trim() -eq '' -or $l.TrimStart().StartsWith('#')) { continue }
    $ind = $l.Length - $l.TrimStart().Length
    if ($ind -le $indent) { break }
    if ($childIndent -lt 0) { $childIndent = $ind }
    if ($ind -eq $childIndent -and $l.Trim() -match '^sizeLimit:\s*\S+') { $hasLimit = $true }
  }
  if (-not $hasLimit) { $bad += ($i + 1) }
}
Report "every emptyDir has a sizeLimit key directly under it ($total emptyDirs, $($bad.Count) without)" (($total -gt 0) -and ($bad.Count -eq 0))

# store-setup ConfigMap ships lib.sh; the toggle reaches the Job; the password is never an argument.
Report 'store-setup ConfigMap ships lib.sh' ($r.Out -match '(?m)^  lib\.sh: \|-')
Report 'customerRegistration true renders CUSTOMER_REGISTRATION true' ($r.Out -match 'name: CUSTOMER_REGISTRATION, value: "true"')
$r2 = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local, '--set', 'storeSetup.customerRegistration=false')
Report 'customerRegistration false renders CUSTOMER_REGISTRATION false' ($r2.Out -match 'name: CUSTOMER_REGISTRATION, value: "false"')
Report 'rendered setup script has no --admin_password= argument' ($r.Out -notmatch '--admin_password=')

# --- Final review I1: WordPress scheduled work runs from a CronJob, not from loopback requests to the public URL ---
$cron = $docs | Where-Object { $_ -match '(?m)^kind: CronJob' -and $_ -match '(?m)^  name: wp-cron\s*$' -and $_ -match '(?m)^  namespace: store\s*$' } | Select-Object -First 1
Report 'CronJob wp-cron renders in store (schedule */5, Forbid, deadlines, history limits, backoffLimit 0)' ([bool]($cron -and
    $cron -match 'schedule: "\*/5 \* \* \* \*"' -and $cron -match 'concurrencyPolicy: Forbid' -and $cron -match 'startingDeadlineSeconds: 120' -and
    $cron -match 'successfulJobsHistoryLimit: 1' -and $cron -match 'failedJobsHistoryLimit: 3' -and $cron -match 'activeDeadlineSeconds: 240' -and
    $cron -match 'backoffLimit: 0'))
Report 'wp-cron runs restricted as uid 33 (runAsNonRoot, seccomp RuntimeDefault, no escalation, drop ALL)' ([bool]($cron -and
    $cron -match 'runAsNonRoot: true' -and $cron -match 'runAsUser: 33' -and $cron -match 'type: RuntimeDefault' -and
    $cron -match 'allowPrivilegeEscalation: false' -and $cron -match 'drop: \["ALL"\]' -and $cron -match 'automountServiceAccountToken: false'))
Report 'wp-cron runs "wp --path=/var/www/html cron event run --due-now" from the store-setup image on the WordPress PVC' ([bool]($cron -and
    $cron -match 'image: wordpress:cli-' -and $cron -match '(?m)^\s+exec wp --path=/var/www/html cron event run --due-now\r?$' -and
    $cron -match 'claimName: wordpress-data' -and $cron -match 'app\.kubernetes\.io/name: wp-cron'))
# A new pod can start before kube-router admits its IP to MariaDB (observed 2026-10-23: refused in the first second).
Report 'wp-cron waits for the database (bounded) before running events' ([bool]($cron -and
    $cron -match 'until err=\$\(wp --path=/var/www/html db query "SELECT 1"' -and $cron -match '-ge 30 \]' -and $cron -match 'exit 1'))
$wp = $docs | Where-Object { $_ -match '(?m)^kind: Deployment' -and $_ -match '(?m)^  name: wordpress\s*$' } | Select-Object -First 1
Report 'WordPress sets DISABLE_WP_CRON (no wp-cron.php loopback on page loads)' ([bool]($wp -and $wp -match "define\('DISABLE_WP_CRON', true\);"))
$np = $docs | Where-Object { $_ -match '(?m)^kind: NetworkPolicy' -and $_ -match '(?m)^  name: wp-cron\s*$' } | Select-Object -First 1
Report 'NetworkPolicy wp-cron: egress only (MariaDB 3306 + internet), no ingress' ([bool]($np -and $np -match 'policyTypes: \[Egress\]' -and
    $np -match 'port: 3306' -and $np -match 'cidr: 0\.0\.0\.0/0' -and $np -notmatch '(?m)^  ingress:'))
$mdb = $docs | Where-Object { $_ -match '(?m)^kind: NetworkPolicy' -and $_ -match '(?m)^  name: mariadb\s*$' } | Select-Object -First 1
Report 'MariaDB policy admits wp-cron' ([bool]($mdb -and $mdb -match 'app\.kubernetes\.io/name: wp-cron'))
$rc = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local, '--set', 'wordpress.cron.enabled=false')
Report 'wordpress.cron.enabled=false renders no CronJob, no wp-cron policy and leaves WP-Cron on' (($rc.Code -eq 0) -and ($rc.Out -match '(?m)^kind: Deployment') -and
  ($rc.Out -notmatch '(?m)^kind: CronJob') -and ($rc.Out -notmatch '(?m)^  name: wp-cron\s*$') -and ($rc.Out -notmatch 'DISABLE_WP_CRON')) $rc.Out
Case-Lint 'empty wordpress.cron.schedule is rejected' "wordpress:`n  cron:`n    schedule: `"`"`n" $false
Case-Lint 'non-boolean wordpress.cron.enabled is rejected' "wordpress:`n  cron:`n    enabled: `"yes`"`n" $false

# --- Task 5.6: TLS redirect and HSTS middlewares (rendered only when TLS is on) -------------------------------
$rp = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $prod)
Report 'prod values render' ($rp.Code -eq 0) $rp.Out
$prodDocs = $rp.Out -split '(?m)^---\s*$'
foreach ($ns in 'store', 'gateway') {
  foreach ($mw in 'redirect-https', 'hsts') {
    $d = $prodDocs | Where-Object { $_ -match '(?m)^kind: Middleware' -and $_ -match "(?m)^  name: $mw\s*$" -and $_ -match "(?m)^  namespace: $ns\s*$" }
    Report "prod renders Middleware $mw in namespace $ns" ([bool]$d)
  }
  $ing = $prodDocs | Where-Object { $_ -match '(?m)^kind: Ingress' -and $_ -match "(?m)^  namespace: $ns\s*$" } | Select-Object -First 1
  Report "prod Ingress in $ns carries the router.middlewares annotation" ([bool]($ing -and $ing -match "router\.middlewares: .?$ns-redirect-https@kubernetescrd,$ns-hsts@kubernetescrd.?"))
}
$hsts = $prodDocs | Where-Object { $_ -match '(?m)^kind: Middleware' -and $_ -match '(?m)^  name: hsts\s*$' } | Select-Object -First 1
Report 'HSTS is 31536000 s without includeSubdomains' ([bool]($hsts -and $hsts -match 'stsSeconds: 31536000' -and $hsts -match 'stsIncludeSubdomains: false'))
$redir = $prodDocs | Where-Object { $_ -match '(?m)^kind: Middleware' -and $_ -match '(?m)^  name: redirect-https\s*$' } | Select-Object -First 1
Report 'redirect-https is a permanent redirectScheme to https' ([bool]($redir -and $redir -match 'scheme: https' -and $redir -match 'permanent: true'))
$rpt = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $prod, '--set', 'global.publicPort=8443')
Report 'redirect-https keeps a non-default public port (port: "8443")' ($rpt.Out -match '(?m)^    port: "8443"\r?$')
Report 'redirect-https has no port at the default 443' ($redir -notmatch '(?m)^    port:')
Report 'local values render no Middleware and no router.middlewares annotation' (($r.Out -notmatch '(?m)^kind: Middleware') -and ($r.Out -notmatch 'router\.middlewares'))
Report 'prod values use customerRegistration false' ($rp.Out -match 'name: CUSTOMER_REGISTRATION, value: "false"')

# --- Final review C1: cert-manager's HTTP-01 solver pods are admitted through default-deny (TLS + issuer only) ---
function Get-SolverPolicy([string[]]$docList, [string]$ns) {
  return $docList | Where-Object { $_ -match '(?m)^kind: NetworkPolicy' -and $_ -match '(?m)^  name: acme-http01-solver\s*$' -and $_ -match "(?m)^  namespace: $ns\s*$" } | Select-Object -First 1
}
foreach ($ns in 'store', 'gateway') {
  $d = Get-SolverPolicy $prodDocs $ns
  $ok = [bool]($d -and $d -match 'acme\.cert-manager\.io/http01-solver: "true"' -and $d -match 'policyTypes: \[Ingress\]' -and
    $d -match 'kubernetes\.io/metadata\.name: kube-system' -and $d -match 'app\.kubernetes\.io/name: traefik' -and $d -match 'protocol: TCP, port: 8089')
  Report "prod renders NetworkPolicy acme-http01-solver in $ns (solver label, from Traefik, TCP 8089)" $ok
}
Report 'local values render no acme-http01-solver policy' ($r.Out -notmatch 'acme-http01-solver')
$rs = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $prod, '--set', 'gateway.enabled=false')
$rsDocs = $rs.Out -split '(?m)^---\s*$'
Report 'prod with gateway.enabled=false renders the solver policy in store only' ([bool]((Get-SolverPolicy $rsDocs 'store') -and -not (Get-SolverPolicy $rsDocs 'gateway')))
$rs = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $prod, '--set', 'global.tls.clusterIssuer=')
Report 'prod without a clusterIssuer renders no solver policy' (($rs.Code -eq 0) -and ($rs.Out -notmatch 'acme-http01-solver')) $rs.Out
$rs = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $prod, '--set', 'networkPolicies.enabled=false')
Report 'prod with networkPolicies.enabled=false renders no solver policy' (($rs.Code -eq 0) -and ($rs.Out -notmatch 'acme-http01-solver')) $rs.Out

# --- Task 5b.3: chat guardrail settings reach the gateway as env vars; ranges are enforced by the schema ------
function Test-EnvVar([string]$text, [string]$name, [string]$value) {
  return [bool]($text -match ('(?m)^\s+- name: ' + [regex]::Escape($name) + '\r?\n\s+value: "' + [regex]::Escape($value) + '"'))
}
foreach ($pair in @(@('LLM_MAX_OUTPUT_TOKENS', '1024'), @('CHAT_TOPIC_CHECK', 'true'), @('CHAT_TOPIC_CHECK_MODEL', ''), @('CHAT_TOPIC_CHECK_TIMEOUT_MS', '5000'), @('CHAT_DAILY_TOKEN_BUDGET', '50000'))) {
  Report "gateway env $($pair[0]) defaults to '$($pair[1])'" (Test-EnvVar $r.Out $pair[0] $pair[1])
}
$rg = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local, '--set', 'gateway.chat.dailyTokenBudget=1000', '--set', 'gateway.chat.topicCheck=false', '--set', 'gateway.llm.maxOutputTokens=2048', '--set', 'gateway.chat.topicCheckModel=openai/gpt-oss-20b', '--set', 'gateway.chat.topicCheckTimeoutMs=3000')
Report 'guardrail values are passed through to the gateway env' (($rg.Code -eq 0) -and (Test-EnvVar $rg.Out 'CHAT_DAILY_TOKEN_BUDGET' '1000') -and (Test-EnvVar $rg.Out 'CHAT_TOPIC_CHECK' 'false') -and
  (Test-EnvVar $rg.Out 'LLM_MAX_OUTPUT_TOKENS' '2048') -and (Test-EnvVar $rg.Out 'CHAT_TOPIC_CHECK_MODEL' 'openai/gpt-oss-20b') -and (Test-EnvVar $rg.Out 'CHAT_TOPIC_CHECK_TIMEOUT_MS' '3000')) $rg.Out
$rg = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local, '--set', 'gateway.chat.dailyTokenBudget=0')
Report 'dailyTokenBudget 0 (unlimited) renders as "0"' (($rg.Code -eq 0) -and (Test-EnvVar $rg.Out 'CHAT_DAILY_TOKEN_BUDGET' '0'))
Case-Lint 'negative dailyTokenBudget is rejected' "gateway:`n  chat:`n    dailyTokenBudget: -1`n" $false
Case-Lint 'dailyTokenBudget over 10000000 is rejected' "gateway:`n  chat:`n    dailyTokenBudget: 10000001`n" $false
Case-Lint 'maxOutputTokens under 256 is rejected' "gateway:`n  llm:`n    maxOutputTokens: 255`n" $false
Case-Lint 'maxOutputTokens over 4096 is rejected' "gateway:`n  llm:`n    maxOutputTokens: 4097`n" $false
Case-Lint 'topicCheckTimeoutMs under 1000 is rejected' "gateway:`n  chat:`n    topicCheckTimeoutMs: 999`n" $false
Case-Lint 'non-boolean topicCheck is rejected' "gateway:`n  chat:`n    topicCheck: `"maybe`"`n" $false
Case-Lint 'topicCheckModel with a space is rejected' "gateway:`n  chat:`n    topicCheckModel: `"a b`"`n" $false
Case-Lint 'budget 0, topic check off and a model are accepted' "gateway:`n  chat:`n    dailyTokenBudget: 0`n    topicCheck: false`n    topicCheckModel: openai/gpt-oss-20b`n" $true

# --- Task 5b.5: external WooCommerce store (ADR-019) and an optional in-cluster store -------------------------------
# Default-render check: every object rendered with the default store/mcp settings must equal main's render.
$mainCmp = Compare-ToMainRender 'values-local' $local
Report "default render unchanged vs main $mainCommit, values-local ($($mainCmp.Count) objects: $($mainCmp.Store) in store ns, $($mainCmp.Mcp) in mcp ns, $($mainCmp.Network) NetworkPolicies)" $mainCmp.Ok $mainCmp.Detail
$mainCmpProd = Compare-ToMainRender 'values-prod' $prod
Report "default render unchanged vs main $mainCommit, values-prod ($($mainCmpProd.Count) objects)" $mainCmpProd.Ok $mainCmpProd.Detail
Report 'default render has no WOO_AUTH_MODE and keeps WOO_SIGNING_BASE_URL' (($r.Out -notmatch 'WOO_AUTH_MODE') -and ($r.Out -match 'name: WOO_SIGNING_BASE_URL'))

$extSets = @('--set', 'mcpWoocommerce.externalStore.url=https://shop.example.com', '--set', 'mcpWoocommerce.externalStore.existingSecret=my-woo-key', '--set', 'mcpWoocommerce.externalStore.extraEgressCIDRs={10.1.2.0/24}')
$re = Invoke-Helm (@('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local) + $extSets)
Report 'external store values render' ($re.Code -eq 0) $re.Out
$reDocs = $re.Out -split '(?m)^---\s*$'
$reDep = $reDocs | Where-Object { $_ -match '(?m)^kind: Deployment' -and $_ -match '(?m)^  name: mcp-woocommerce\s*$' } | Select-Object -First 1
Report 'external store: mcp-woocommerce gets WOO_BASE_URL, WOO_AUTH_MODE basic and the key from the named Secret, no signing URL' ([bool]($reDep -and
    (Test-EnvVar $reDep 'WOO_BASE_URL' 'https://shop.example.com') -and (Test-EnvVar $reDep 'WOO_AUTH_MODE' 'basic') -and
    ($reDep -match 'name: WOO_CONSUMER_KEY\r?\n\s+valueFrom:\r?\n\s+secretKeyRef: \{ name: my-woo-key, key: consumer-key \}') -and
    ($reDep -match 'name: WOO_CONSUMER_SECRET\r?\n\s+valueFrom:\r?\n\s+secretKeyRef: \{ name: my-woo-key, key: consumer-secret \}') -and
    ($reDep -notmatch 'WOO_SIGNING_BASE_URL') -and ($reDep -notmatch 'store-woo-api') -and ($reDep -notmatch 'wordpress\.store')))
$reNp = $reDocs | Where-Object { $_ -match '(?m)^kind: NetworkPolicy' -and $_ -match '(?m)^  name: mcp-woocommerce\s*$' } | Select-Object -First 1
Report 'external store: mcp-woocommerce egress is the internet rule (443, 80, private ranges excluded) plus the extra CIDR on 443, no WordPress rule' ([bool]($reNp -and
    $reNp -match 'cidr: 0\.0\.0\.0/0' -and $reNp -match '- 10\.0\.0\.0/8' -and $reNp -match '- 169\.254\.0\.0/16' -and $reNp -match 'port: 443' -and $reNp -match 'port: 80 ' -and
    $reNp -match 'cidr: "10\.1\.2\.0/24"' -and $reNp -notmatch 'name: wordpress' -and $reNp -notmatch 'metadata\.name: store'))
Report 'external URL with store.enabled=true renders no store-woo-api Secret in mcp (cannot clash with a pre-created one)' (($re.Code -eq 0) -and -not ($reDocs | Where-Object { $_ -match '(?m)^kind: Secret' -and $_ -match '(?m)^  name: store-woo-api\s*$' -and $_ -match '(?m)^  namespace: mcp\s*$' }))
Report 'default render still has the store-woo-api Secret in mcp and store' (@($docs | Where-Object { $_ -match '(?m)^kind: Secret' -and $_ -match '(?m)^  name: store-woo-api\s*$' }).Count -eq 2)
Report 'external store with the in-cluster store still on keeps the store rendered' (($re.Out -match '(?m)^kind: Deployment') -and ($re.Out -match '(?m)^  name: wordpress\s*$'))

$eo = Invoke-Helm (@('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local, '--set', 'store.enabled=false') + $extSets)
Report 'external store with store.enabled=false renders' ($eo.Code -eq 0) $eo.Out
$eoDocs = $eo.Out -split '(?m)^---\s*$'
$storeKinds = @($eoDocs | Where-Object { $_ -match '(?m)^  namespace: store\s*$' } | ForEach-Object { if ($_ -match '(?m)^kind: (\S+)') { $Matches[1] } })
Report 'store.enabled=false: nothing is rendered in the store namespace (no workloads, Secrets, Ingress, policies)' (($eo.Code -eq 0) -and ($storeKinds.Count -eq 0)) ($storeKinds -join ',')
Report 'store.enabled=false: no store Namespace, wordpress/mariadb/store-setup/wp-cron or store-woo-api' (($eo.Code -eq 0) -and
    -not ($eoDocs | Where-Object { $_ -match '(?m)^kind: Namespace' -and $_ -match '(?m)^  name: store\s*$' }) -and
    ($eo.Out -notmatch '(?m)^  name: (wordpress|mariadb|store-setup|wp-cron|store-woo-api|store-db|store-admin)\s*$'))
Report 'store.enabled=false: the mcp and gateway namespaces and their default-deny are still rendered' (($eo.Code -eq 0) -and
    ($eoDocs | Where-Object { $_ -match '(?m)^kind: Namespace' -and $_ -match '(?m)^  name: mcp\s*$' }) -and ($eoDocs | Where-Object { $_ -match '(?m)^kind: Namespace' -and $_ -match '(?m)^  name: gateway\s*$' }) -and
    ($eoDocs | Where-Object { $_ -match '(?m)^kind: NetworkPolicy' -and $_ -match '(?m)^  name: default-deny-all\s*$' -and $_ -match '(?m)^  namespace: mcp\s*$' }))
$eop = Invoke-Helm (@('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $prod, '--set', 'store.enabled=false') + $extSets)
$eopStore = @($eop.Out -split '(?m)^---\s*$' | Where-Object { $_ -match '(?m)^  namespace: store\s*$' })
Report 'prod values with store.enabled=false: nothing in the store namespace (no store Ingress, Middlewares or solver policy)' (($eop.Code -eq 0) -and ($eopStore.Count -eq 0)) $eop.Out

function Case-Set([string]$name, [string[]]$sets, [bool]$expectOk, [string]$mustSay = '') {
  $x = Invoke-Helm (@('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local) + $sets)
  $ok = (($x.Code -eq 0) -eq $expectOk)
  if (-not $expectOk -and $mustSay) { $ok = $ok -and ($x.Out -match $mustSay) }
  Report $name $ok "(helm template exit $($x.Code)) $($x.Out)"
}
$okUrl = 'mcpWoocommerce.externalStore.url=https://shop.example.com'
$okSecret = 'mcpWoocommerce.externalStore.existingSecret=my-woo-key'
Case-Set 'external store: an http:// URL is rejected' @('--set', 'mcpWoocommerce.externalStore.url=http://shop.example.com', '--set', $okSecret) $false 'externalStore'
Case-Set 'external store: a URL with user info is rejected' @('--set', 'mcpWoocommerce.externalStore.url=https://ck_user@shop.example.com', '--set', $okSecret) $false 'externalStore'
Case-Set 'external store: a URL with user:password is rejected' @('--set', 'mcpWoocommerce.externalStore.url=https://ck:cs@shop.example.com', '--set', $okSecret) $false 'externalStore'
Case-Set 'external store: a URL without existingSecret is rejected by the template' @('--set', $okUrl) $false 'existingSecret is required'
Case-Set 'store.enabled=false without an external URL is rejected' @('--set', 'store.enabled=false') $false 'url'
Case-Set 'store.enabled=false without a URL is fine when mcpWoocommerce is disabled' @('--set', 'store.enabled=false', '--set', 'mcpWoocommerce.enabled=false') $true
Case-Set 'external store: extraEgressCIDRs must be IPv4 CIDRs' @('--set', $okUrl, '--set', $okSecret, '--set', 'mcpWoocommerce.externalStore.extraEgressCIDRs={not-a-cidr}') $false 'extraEgressCIDRs'
Case-Set 'external store: a /33 CIDR is rejected' @('--set', $okUrl, '--set', $okSecret, '--set', 'mcpWoocommerce.externalStore.extraEgressCIDRs={10.0.0.0/33}') $false 'extraEgressCIDRs'
Case-Set 'external store: an https URL with a path and a Secret name is accepted' @('--set', 'mcpWoocommerce.externalStore.url=https://shop.example.com/blog', '--set', $okSecret) $true
Case-Set 'non-boolean store.enabled is rejected' @('--set-string', 'store.enabled=yes') $false 'store'

# --- Task 5b.6: gateway.internalUpstreams (in-cluster MCP servers; ADR-016 addendum) ---------------------------
function Write-Values([string]$yaml) {
  $f = Join-Path $tmp ([guid]::NewGuid().ToString('N') + '.yaml')
  [IO.File]::WriteAllText($f, $yaml)
  return $f
}
function Get-SsrfValue([string]$text) {
  if ($text -match '(?m)^\s+- name: SSRF_ALLOWED_INTERNAL_HOSTS\r?\n\s+value: "([^"]*)"') { return $Matches[1] }
  return $null
}
function Get-NetpolDocs([string]$text) {
  return @($text -split '(?m)^---\s*$' | Where-Object { $_ -match '(?m)^kind: NetworkPolicy' })
}
$emptyVals = Write-Values "gateway:`n  internalUpstreams: []`n"
$cmpEmpty = Compare-ToMainRender 'internalUpstreams-empty' $emptyVals
Report "internalUpstreams: [] renders exactly main $mainCommit's objects ($($cmpEmpty.Count) objects, $($cmpEmpty.Network) NetworkPolicies)" $cmpEmpty.Ok $cmpEmpty.Detail
Report 'default SSRF_ALLOWED_INTERNAL_HOSTS is *.mcp.svc.cluster.local only' ((Get-SsrfValue $r.Out) -eq '*.mcp.svc.cluster.local')
$defNetpols = (Get-NetpolDocs $r.Out).Count

$mcpVals = Write-Values "gateway:`n  internalUpstreams:`n    - namespace: mcp`n      port: 3010`n      podLabels:`n        app.kubernetes.io/name: mcp-extra`n"
$ri = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local, '-f', $mcpVals)
Report 'internalUpstreams entry in mcp renders' ($ri.Code -eq 0) $ri.Out
$riNp = Get-NetpolDocs $ri.Out
$riGw = $riNp | Where-Object { $_ -match '(?m)^  name: gateway\s*$' } | Select-Object -First 1
Report 'entry in mcp: gateway egress rule to namespace mcp, pod label mcp-extra, TCP 3010' ([bool]($riGw -and
    $riGw -match '(?s)kubernetes\.io/metadata\.name: mcp\s+podSelector:\s+matchLabels:\s+app\.kubernetes\.io/name: mcp-extra\s+ports:\s+- \{ protocol: TCP, port: 3010 \}'))
$riIng = $riNp | Where-Object { $_ -match '(?m)^  name: mcp-internal-upstream-0\s*$' -and $_ -match '(?m)^  namespace: mcp\s*$' } | Select-Object -First 1
Report 'entry in mcp: Ingress policy in mcp selects the pod labels, from the gateway pods only, TCP 3010' ([bool]($riIng -and
    $riIng -match 'policyTypes: \[Ingress\]' -and $riIng -match '(?s)spec:\s+podSelector:\s+matchLabels:\s+app\.kubernetes\.io/name: mcp-extra\s+policyTypes' -and
    $riIng -match 'kubernetes\.io/metadata\.name: gateway' -and $riIng -match 'app\.kubernetes\.io/name: gateway' -and
    $riIng -match 'protocol: TCP, port: 3010' -and $riIng -notmatch '(?m)^  egress:'))
Report 'entry in mcp: SSRF value stays *.mcp.svc.cluster.local (one entry)' ((Get-SsrfValue $ri.Out) -eq '*.mcp.svc.cluster.local')
Report 'entry in mcp: exactly one NetworkPolicy is added' ((Get-NetpolDocs $ri.Out).Count -eq ($defNetpols + 1))

$toolsVals = Write-Values "gateway:`n  internalUpstreams:`n    - namespace: tools-test`n      port: 3010`n"
$rt = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local, '-f', $toolsVals)
Report 'internalUpstreams entry in tools-test renders' ($rt.Code -eq 0) $rt.Out
$rtNp = Get-NetpolDocs $rt.Out
$rtGw = $rtNp | Where-Object { $_ -match '(?m)^  name: gateway\s*$' } | Select-Object -First 1
Report 'entry in tools-test: gateway egress to namespace tools-test on TCP 3010 (no pod selector without podLabels)' ([bool]($rtGw -and
    $rtGw -match '(?s)- namespaceSelector:\s+matchLabels:\s+kubernetes\.io/metadata\.name: tools-test\s+ports:\s+- \{ protocol: TCP, port: 3010 \}'))
Report 'entry in tools-test: SSRF value adds *.tools-test.svc.cluster.local' ((Get-SsrfValue $rt.Out) -eq '*.mcp.svc.cluster.local,*.tools-test.svc.cluster.local')
Report 'entry in tools-test: no new NetworkPolicy and nothing rendered in tools-test' (($rtNp.Count -eq $defNetpols) -and ($rt.Out -notmatch '(?m)^  namespace: tools-test\s*$'))

$dupVals = Write-Values "gateway:`n  internalUpstreams:`n    - namespace: tools-test`n      port: 3010`n    - namespace: tools-test`n      port: 3011`n    - namespace: mcp`n      port: 3012`n"
$rd = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local, '-f', $dupVals)
Report 'duplicate namespaces give one SSRF entry each (mcp default first, tools-test once)' (($rd.Code -eq 0) -and ((Get-SsrfValue $rd.Out) -eq '*.mcp.svc.cluster.local,*.tools-test.svc.cluster.local')) $rd.Out
$rdGw = (Get-NetpolDocs $rd.Out) | Where-Object { $_ -match '(?m)^  name: gateway\s*$' } | Select-Object -First 1
Report 'duplicate namespaces: one egress rule per entry (ports 3010, 3011, 3012)' ([bool]($rdGw -and $rdGw -match 'port: 3010 ' -and $rdGw -match 'port: 3011 ' -and $rdGw -match 'port: 3012 '))
Report 'duplicate namespaces: exactly one NetworkPolicy is added (for the mcp entry only)' ((Get-NetpolDocs $rd.Out).Count -eq ($defNetpols + 1)) "(default $defNetpols, got $((Get-NetpolDocs $rd.Out).Count))"

$mcpAllVals = Write-Values "gateway:`n  internalUpstreams:`n    - namespace: mcp`n      port: 3013`n"
$ra = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $local, '-f', $mcpAllVals)
Report 'internalUpstreams entry in mcp without podLabels renders' ($ra.Code -eq 0) $ra.Out
$raNp = Get-NetpolDocs $ra.Out
$raIng = $raNp | Where-Object { $_ -match '(?m)^  name: mcp-internal-upstream-0\s*$' -and $_ -match '(?m)^  namespace: mcp\s*$' } | Select-Object -First 1
Report 'entry in mcp without podLabels: Ingress policy selects every pod in mcp (podSelector: {}), from the gateway pods only, TCP 3013' ([bool]($raIng -and
    $raIng -match '(?s)spec:\s+podSelector: \{\}\s+policyTypes: \[Ingress\]' -and $raIng -match 'kubernetes\.io/metadata\.name: gateway' -and
    $raIng -match 'app\.kubernetes\.io/name: gateway' -and $raIng -match 'protocol: TCP, port: 3013'))
$raGw = $raNp | Where-Object { $_ -match '(?m)^  name: gateway\s*$' } | Select-Object -First 1
Report 'entry in mcp without podLabels: gateway egress to namespace mcp on TCP 3013 with no pod selector' ([bool]($raGw -and
    $raGw -match '(?s)- namespaceSelector:\s+matchLabels:\s+kubernetes\.io/metadata\.name: mcp\s+ports:\s+- \{ protocol: TCP, port: 3013 \}'))
Report 'entry in mcp without podLabels: exactly one NetworkPolicy is added' ($raNp.Count -eq ($defNetpols + 1))
foreach ($sys in 'kube-system', 'kube-public', 'kube-node-lease') {
  Case-Lint "internalUpstreams namespace $sys is rejected" "gateway:`n  internalUpstreams:`n    - namespace: $sys`n      port: 3010`n" $false
}
Case-Set 'internalUpstreams entry in the gateway namespace is rejected by the template' @('--set', 'gateway.internalUpstreams[0].namespace=gateway', '--set', 'gateway.internalUpstreams[0].port=3010') $false 'is the gateway namespace'
Case-Set 'internalUpstreams follows a renamed gateway namespace' @('--set', 'namespaces.gateway=gw-test', '--set', 'gateway.internalUpstreams[0].namespace=gw-test', '--set', 'gateway.internalUpstreams[0].port=3010') $false 'is the gateway namespace'
Case-Lint 'internalUpstreams port 0 is rejected' "gateway:`n  internalUpstreams:`n    - namespace: tools`n      port: 0`n" $false
Case-Lint 'internalUpstreams port 65536 is rejected' "gateway:`n  internalUpstreams:`n    - namespace: tools`n      port: 65536`n" $false
Case-Lint 'internalUpstreams namespace Bad_NS is rejected' "gateway:`n  internalUpstreams:`n    - namespace: `"Bad_NS`"`n      port: 3010`n" $false
Case-Lint 'internalUpstreams entry without a port is rejected' "gateway:`n  internalUpstreams:`n    - namespace: tools`n" $false
Case-Lint 'internalUpstreams podLabels with a non-string value is rejected' "gateway:`n  internalUpstreams:`n    - namespace: tools`n      port: 3010`n      podLabels:`n        app: 5`n" $false
Case-Lint 'internalUpstreams unknown entry key is rejected' "gateway:`n  internalUpstreams:`n    - namespace: tools`n      port: 3010`n      host: x`n" $false
Case-Lint 'a valid internalUpstreams entry with podLabels is accepted' "gateway:`n  internalUpstreams:`n    - namespace: tools`n      port: 3010`n      podLabels:`n        app: x`n" $true

# --- Task 5.6: deploy.ps1 guards, run against a throw-away kubeconfig so no real cluster is touched -----------
function Invoke-DeployGuard([string]$contextName, [string]$valuesFile) {
  $kc = Join-Path $tmp ('kc-' + [guid]::NewGuid().ToString('N') + '.yaml')
  $yaml = "apiVersion: v1`nkind: Config`nclusters:`n- name: fake`n  cluster:`n    server: https://127.0.0.1:1`nusers:`n- name: fake`n  user:`n    token: fake`ncontexts:`n- name: $contextName`n  context:`n    cluster: fake`n    user: fake`ncurrent-context: $contextName`n"
  [IO.File]::WriteAllText($kc, $yaml)
  $old = $env:KUBECONFIG; $env:KUBECONFIG = $kc
  try {
    $o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'deploy.ps1') -ValuesFile $valuesFile 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $o }
  }
  finally { $env:KUBECONFIG = $old }
}
$g = Invoke-DeployGuard 'k3d-urumi' 'deploy\values-prod.yaml'
Report 'deploy.ps1 refuses values-prod on context k3d-urumi' (($g.Code -eq 1) -and ($g.Out -match 'Refusing to deploy')) $g.Out
$g = Invoke-DeployGuard 'some-vps' 'deploy\values-local.yaml'
Report 'deploy.ps1 refuses values-local on another context' (($g.Code -eq 1) -and ($g.Out -match 'Refusing to deploy')) $g.Out

# --- Task 5.6: create-secrets.ps1 .env parser (fixtures hold fake values only; output is names + set/empty) ---
function Invoke-ParseOnly([string]$fixture) {
  $f = Join-Path $PSScriptRoot "dev\fixtures\$fixture"
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'create-secrets.ps1') -EnvFile $f -ParseOnly 2>&1 | Out-String
  return @{ Code = $LASTEXITCODE; Out = $o }
}
$cases = @(
  @('parse-set.env', 'GROQ_API_KEY: set', 'OPENROUTER_API_KEY: set'),
  @('parse-empty.env', 'GROQ_API_KEY: empty', 'OPENROUTER_API_KEY: empty'),
  @('parse-quoted-empty.env', 'GROQ_API_KEY: empty', 'OPENROUTER_API_KEY: empty'),
  @('parse-tab-comment.env', 'GROQ_API_KEY: set', 'OPENROUTER_API_KEY: empty')
)
foreach ($c in $cases) {
  $p = Invoke-ParseOnly $c[0]
  Report "create-secrets.ps1 -ParseOnly $($c[0])" (($p.Code -eq 0) -and ($p.Out -match [regex]::Escape($c[1])) -and ($p.Out -match [regex]::Escape($c[2]))) $p.Out
}
$p = Invoke-ParseOnly 'parse-set.env'
Report 'create-secrets.ps1 -ParseOnly never prints a value' (($p.Out -notmatch 'fake-groq-value') -and ($p.Out -notmatch 'not a comment'))

# --- Task 5.6: kubeconform over the rendered manifests (CRDs such as Middleware are skipped, not validated) ----
function Test-Kubeconform([string]$label, [string]$valuesFile) {
  $t = Invoke-Helm @('template', 'urumi', $chart, '-n', 'urumi-system', '-f', $valuesFile)
  if ($t.Code -ne 0) { Report "kubeconform $label" $false 'helm template failed'; return }
  $old = $ErrorActionPreference; $oldEnc = $OutputEncoding
  $ErrorActionPreference = 'Continue'; $OutputEncoding = New-Object System.Text.UTF8Encoding $false
  $kc = $t.Out | & docker run --rm -i ghcr.io/yannh/kubeconform:v0.8.0 -strict -summary -ignore-missing-schemas -kubernetes-version 1.35.0 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old; $OutputEncoding = $oldEnc
  $line = ($kc -split "`r?`n" | Where-Object { $_ -match '^Summary:' } | Select-Object -First 1)
  Report "kubeconform $label ($line)" (($code -eq 0) -and $line -and ($line -match 'Invalid: 0, Errors: 0')) $kc
}
if (Get-Command docker -ErrorAction SilentlyContinue) {
  Test-Kubeconform 'values-local' $local
  Test-Kubeconform 'values-prod' $prod
}
else { Write-Host 'SKIP  kubeconform (docker not found)' -ForegroundColor Yellow }

# --- Task 5.6: placeholders left in the production values are a warning, not a failure --------------------------
$prodText = Get-Content -LiteralPath $prod -Raw
$left = @()
if ($prodText -match '(?m)^\s*[A-Za-z]+:\s*\S*CHANGE-ME') { $left += 'CHANGE-ME' }
if ($prodText -match '(?m)^\s*(storeHost|appHost):\s*\S*example\.com') { $left += 'example.com hostnames' }
if ($left.Count -gt 0) { Write-Host "WARN  deploy/values-prod.yaml still holds placeholders ($($left -join ', ')): edit them before a real install" -ForegroundColor Yellow }
else { Write-Host 'PASS  deploy/values-prod.yaml holds no placeholders' }

Remove-Item -Recurse -Force $tmp
if ($script:fail -gt 0) { Write-Host "`n$($script:fail) check(s) FAILED"; exit 1 }
Write-Host "`nAll checks passed"
exit 0
