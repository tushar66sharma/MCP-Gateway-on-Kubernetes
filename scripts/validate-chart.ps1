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

Remove-Item -Recurse -Force $tmp
if ($script:fail -gt 0) { Write-Host "`n$($script:fail) check(s) FAILED"; exit 1 }
Write-Host "`nAll checks passed"
exit 0
