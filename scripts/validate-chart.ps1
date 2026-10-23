# Chart render and schema tests (no cluster needed). Task 5.6 extends this file.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-chart.ps1
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
