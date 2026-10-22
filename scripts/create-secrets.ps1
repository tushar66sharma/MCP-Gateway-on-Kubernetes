# Pushes the LLM provider API keys from the git-ignored .env to the cluster as the Secret llm-api-keys,
# then restarts the gateway so it reads them.
#   powershell -ExecutionPolicy Bypass -File scripts\create-secrets.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\create-secrets.ps1 -NoRestart
#   powershell -ExecutionPolicy Bypass -File scripts\create-secrets.ps1 -EnvFile C:\path\to\.env -Namespace gateway -SecretName llm-api-keys
#   powershell -ExecutionPolicy Bypass -File scripts\create-secrets.ps1 -EnvFile scripts\dev\fixtures\parse-set.env -ParseOnly   # parser test: prints names and set/empty only
# Reads only GROQ_API_KEY and OPENROUTER_API_KEY. The keys never reach the command line, a temp file or the
# output: the Secret is built in memory and piped to kubectl, and only "set" / "empty" is printed.
[CmdletBinding()]
param(
  [string]$EnvFile = '',
  [string]$Namespace = 'gateway',
  [string]$SecretName = 'llm-api-keys',   # must match secrets.existing.llmApiKeys (the chart's "" means llm-api-keys)
  [switch]$NoRestart,
  [switch]$ParseOnly
)
$ErrorActionPreference = 'Stop'

function Stop-WithError([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

if (-not $ParseOnly -and -not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
  Stop-WithError "'kubectl' was not found on PATH. Install it (docs/run-guide.md) or open a NEW terminal so PATH refreshes."
}

$root = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) { $EnvFile = Join-Path $root '.env' }
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  Stop-WithError "$EnvFile not found. Copy .env.example to .env in the repository root, fill in GROQ_API_KEY (and optionally OPENROUTER_API_KEY), then run this again."
}

# KEY=value lines only; comments and every other variable are ignored. The last occurrence wins.
$wanted = @('GROQ_API_KEY', 'OPENROUTER_API_KEY')
$keys = @{}
foreach ($name in $wanted) { $keys[$name] = '' }
foreach ($line in (Get-Content -LiteralPath $EnvFile)) {
  if ($line -match '^\s*#') { continue }
  if ($line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
  $name = $Matches[1]
  if ($wanted -notcontains $name) { continue }
  $value = $Matches[2].Trim()
  if ($value -match '^"([^"]*)"' -or $value -match "^'([^']*)'") {
    # One pair of surrounding quotes is removed; whatever follows the closing quote (such as a comment) is ignored.
    $value = $Matches[1].Trim()
  }
  else {
    # An unquoted value ends at an inline comment: a space or tab followed by "#" (or a value that is only "#...").
    $value = ($value -replace '(^|[ \t])#.*$', '').Trim()
  }
  $keys[$name] = $value
}

foreach ($name in $wanted) {
  $state = if ($keys[$name]) { 'set' } else { 'empty' }
  Write-Host "${name}: $state"
}
if ($ParseOnly) { exit 0 }
if (-not $keys['GROQ_API_KEY'] -and -not $keys['OPENROUTER_API_KEY']) {
  Stop-WithError "Both GROQ_API_KEY and OPENROUTER_API_KEY are empty in $EnvFile. Add at least one key (see .env.example); nothing was changed."
}

cmd /c "kubectl get namespace $Namespace >nul 2>&1"
if ($LASTEXITCODE -ne 0) { Stop-WithError "Namespace '$Namespace' not found. Is the platform deployed (scripts\up.ps1)?" }

# Both keys are always written, an empty one as "", so a key removed from .env is cleared in the cluster
# too (the gateway treats "" as not configured). Server-side apply keeps no last-applied-configuration
# annotation, which with client-side apply would hold the keys in plain text.
$secret = [ordered]@{
  apiVersion = 'v1'
  kind       = 'Secret'
  type       = 'Opaque'
  metadata   = [ordered]@{
    name      = $SecretName
    namespace = $Namespace
    labels    = [ordered]@{
      'app.kubernetes.io/name'       = $SecretName
      'app.kubernetes.io/part-of'    = 'urumi-platform'
      'app.kubernetes.io/managed-by' = 'create-secrets.ps1'
    }
  }
  stringData = [ordered]@{
    GROQ_API_KEY       = [string]$keys['GROQ_API_KEY']
    OPENROUTER_API_KEY = [string]$keys['OPENROUTER_API_KEY']
  }
}
$json = $secret | ConvertTo-Json -Depth 5 -Compress
$keys = $null; $secret = $null

# Windows PowerShell pipes text to native programs in $OutputEncoding (ASCII by default): use UTF-8 without BOM.
$prevEncoding = $OutputEncoding
$applyOk = $false
try {
  $OutputEncoding = New-Object System.Text.UTF8Encoding $false
  $ErrorActionPreference = 'Continue'
  $json | kubectl apply --server-side --field-manager=create-secrets --force-conflicts -f -
  $applyOk = ($LASTEXITCODE -eq 0)
}
finally {
  $ErrorActionPreference = 'Stop'
  $OutputEncoding = $prevEncoding
  $json = $null
}
if (-not $applyOk) { Stop-WithError "kubectl apply of Secret $Namespace/$SecretName failed (see above)." }
Write-Host "Secret $Namespace/$SecretName is up to date."

if ($NoRestart) {
  Write-Host "Skipped the gateway restart (-NoRestart). The gateway reads the keys at start: kubectl -n $Namespace rollout restart deploy/gateway"
  exit 0
}
cmd /c "kubectl -n $Namespace get deployment gateway >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Deployment $Namespace/gateway not found; the keys are used once the gateway is deployed (scripts\up.ps1)." -ForegroundColor Yellow
  exit 0
}
kubectl -n $Namespace rollout restart deployment/gateway
if ($LASTEXITCODE -ne 0) { Stop-WithError 'kubectl rollout restart deployment/gateway failed.' }
kubectl -n $Namespace rollout status deployment/gateway --timeout=180s
if ($LASTEXITCODE -ne 0) { Stop-WithError "The gateway did not become ready. Check: kubectl -n $Namespace get pods ; kubectl -n $Namespace logs deploy/gateway" }
Write-Host "Gateway restarted. Check the model line (provider and model only, never a key): kubectl -n $Namespace logs deploy/gateway | Select-String 'llm configured'" -ForegroundColor Green
