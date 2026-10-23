# The invite-log check (Phase 4 open item): an invite link is a bearer secret, so the dashboard's nginx access log
# must never hold it. Requests /invite/<random>?q=<random2> and counts how often the random values appear in
# `kubectl -n gateway logs deploy/dashboard`; the expected count is 0. A positive control (the redacted
# `/invite/:token` line is in the log) proves the request really reached the dashboard and was logged.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-invite-log.ps1
# -ExpectMatches exists only so the check can be shown to fail on a deliberately wrong expectation.
[CmdletBinding()]
param([string]$Base = 'http://app.localhost', [int]$ExpectMatches = 0)
$ErrorActionPreference = 'Stop'
function Stop-WithError([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) { Stop-WithError "'kubectl' not found on PATH." }

$token = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
$query = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
$status = curl.exe -s -o NUL -m 10 -w '%{http_code}' "$Base/invite/${token}?q=$query"
if ($LASTEXITCODE -ne 0) { Stop-WithError "Could not request $Base/invite/<random> (curl exit $LASTEXITCODE)." }
if ($status -ne '200') { Stop-WithError "The invite page answered HTTP $status, expected 200 (the dashboard serves the SPA for /invite/*)." }
Start-Sleep -Seconds 2

$log = kubectl -n gateway logs deploy/dashboard --since=5m
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not read the dashboard log (kubectl -n gateway logs deploy/dashboard).' }
$lines = @($log)
$leaks = @($lines | Where-Object { $_ -like "*$token*" -or $_ -like "*$query*" }).Count
$control = @($lines | Where-Object { $_ -like '*"GET /invite/:token"*' }).Count
if ($control -lt 1) { Stop-WithError 'Positive control failed: no "GET /invite/:token" line in the dashboard log, so the request was not logged and 0 matches would prove nothing.' }
if ($leaks -ne $ExpectMatches) { Stop-WithError "The dashboard log holds the random invite value $leaks time(s); expected $ExpectMatches." }
Write-Host "Invite-log check passed: 0 matches for the random invite value; the request is logged as /invite/:token ($control line(s))." -ForegroundColor Green
exit 0
