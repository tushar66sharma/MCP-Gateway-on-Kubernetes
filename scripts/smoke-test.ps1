# One command that proves the whole platform: pods, the WooCommerce API and MCP server, the gateway, the dashboard,
# the NetworkPolicies, the invite-log rule and the dependency audit. Each step runs as its own PowerShell process;
# only its last output line is shown (the scripts never print secrets). Ends with a table and exit code 0 only if
# every step passed.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-test.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-test.ps1 -Quick   # skips the dashboard (browser + chat) and npm audit
# The dashboard step may spend one free-tier chat turn on the AI provider when it is configured.
[CmdletBinding()]
param([switch]$Quick)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ps = 'powershell'
$base = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File')
$results = @()

function Invoke-Step([string]$Name, [scriptblock]$Run, [switch]$Skip) {
  if ($Skip) { $script:results += [pscustomobject]@{ Step = $Name; Result = 'SKIPPED'; Seconds = 0; Detail = '-Quick' }; return }
  Write-Host "==> $Name" -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $detail = ''; $ok = $false
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $out = & $Run 2>&1 | ForEach-Object { "$_" }
    $ok = ($LASTEXITCODE -eq 0)
    $last = @($out | Where-Object { $_ -and $_.Trim() } | Select-Object -Last 1)
    if ($last.Count -gt 0) { $detail = $last[0].Trim() }
  } catch { $detail = $_.Exception.Message }
  $ErrorActionPreference = $prev
  $sw.Stop()
  if ($detail.Length -gt 110) { $detail = $detail.Substring(0, 107) + '...' }
  Write-Host ("    {0}  {1}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $detail)
  $script:results += [pscustomobject]@{ Step = $Name; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Seconds = [int]$sw.Elapsed.TotalSeconds; Detail = $detail }
}

Push-Location $root
try {
  Invoke-Step '1 pods ready' {
    kubectl wait --for=condition=Ready pod --all -n store --timeout=120s --field-selector=status.phase=Running
    if ($LASTEXITCODE -ne 0) { return }
    kubectl wait --for=condition=Ready pod --all -n mcp --timeout=120s
    if ($LASTEXITCODE -ne 0) { return }
    kubectl wait --for=condition=Ready pod --all -n gateway --timeout=120s
    if ($LASTEXITCODE -ne 0) { return }
    $bad = @(kubectl get pods -A --no-headers | Where-Object { $_ -notmatch 'Completed' -and $_ -notmatch '\s1/1\s|\s2/2\s' })
    if ($bad.Count -gt 0) { 'pods not fully ready:'; $bad; cmd /c exit 1 } else { 'all pods ready'; cmd /c exit 0 }
  }
  Invoke-Step '2 check-woo-api'           { & $ps @base scripts\check-woo-api.ps1 }
  Invoke-Step '3 check-mcp-woocommerce'   { & $ps @base scripts\check-mcp-woocommerce.ps1 }
  Invoke-Step '4 check-gateway -Write'    { & $ps @base scripts\check-gateway.ps1 -Write }
  Invoke-Step '5 check-dashboard'         { & $ps @base scripts\check-dashboard.ps1 } -Skip:$Quick
  Invoke-Step '6 test-network-policies'   { & $ps @base scripts\test-network-policies.ps1 }
  Invoke-Step '7 invite-log check'        { & $ps @base scripts\check-invite-log.ps1 }
  Invoke-Step '8 npm audit (high+)'       { npm audit --omit=dev --audit-level=high } -Skip:$Quick
} finally { Pop-Location }

Write-Host ''
$results | Format-Table Step, Result, Seconds, Detail -AutoSize -Wrap | Out-String -Width 200 | Write-Host
$failed = @($results | Where-Object { $_.Result -eq 'FAIL' }).Count
if ($failed -gt 0) { Write-Host "SMOKE TEST FAILED: $failed step(s) failed." -ForegroundColor Red; exit 1 }
Write-Host 'SMOKE TEST PASSED' -ForegroundColor Green
exit 0
