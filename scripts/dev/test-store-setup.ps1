# Tests for charts/urumi-platform/files/store-setup (setup.sh and lib.sh) in a throwaway
# wordpress:cli container. No cluster access: the container has no kube config, only the mounted scripts.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev\test-store-setup.ps1
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dir = Join-Path $root 'charts\urumi-platform\files\store-setup'
$image = 'wordpress:cli-2.12.0-php8.3'
$script:fail = 0
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('urumi-store-setup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

function Report([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Write-Host "PASS  $name" } else { Write-Host "FAIL  $name $detail"; $script:fail++ }
}

# Runs a shell snippet in the container with the scripts mounted read-only at /s. Returns exit code and merged output.
function Invoke-Container([string]$snippet, [string[]]$extra = @()) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = & docker run --rm --user 0 -e HOME=/tmp -e WP_CLI_ALLOW_ROOT=1 -v "${dir}:/s:ro" @extra $image sh -c $snippet 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  return @{ Code = $code; Out = $out }
}

# Env for a setup.sh run that is valid except for what each case overrides.
$baseEnv = @('-e','WP_URL=http://x.test','-e','SITE_TITLE=T','-e','ADMIN_USER=admin','-e','ADMIN_EMAIL=a@example.com',
  '-e','WOO_VERSION=11.2.1','-e','MCP_KEY_OWNER=urumi-mcp','-e','SEED_PRODUCTS=false')

# 1. Empty ADMIN_PASSWORD fails before any WP-CLI call (there is no wp-config.php, so any wp call or wait would hang or differ).
$r = Invoke-Container 'sh /s/setup.sh' ($baseEnv + @('-e','ADMIN_PASSWORD='))
Report 'empty ADMIN_PASSWORD fails with the message' (($r.Code -ne 0) -and ($r.Out -match 'ADMIN_PASSWORD is empty')) "(exit $($r.Code))"
$r = Invoke-Container 'sh /s/setup.sh' $baseEnv
Report 'unset ADMIN_PASSWORD fails with the message' (($r.Code -ne 0) -and ($r.Out -match 'ADMIN_PASSWORD is empty')) "(exit $($r.Code))"

# 2. Version comparison helper.
function Cmp([string]$a, [string]$b) {
  $r = Invoke-Container ". /s/lib.sh; woo_version_cmp '$a' '$b'"
  return $r.Out.Trim()
}
Report 'version 11.2.1 vs 11.2.1 is equal' ((Cmp '11.2.1' '11.2.1') -eq 'equal') 
Report 'version 11.3.0 vs 11.2.1 is newer' ((Cmp '11.3.0' '11.2.1') -eq 'newer')
Report 'version 10.9.9 vs 11.2.1 is older' ((Cmp '10.9.9' '11.2.1') -eq 'older')
Report 'version none vs 11.2.1 is older' ((Cmp '' '11.2.1') -eq 'older')

# 3. DB wait loop: wrong host fails with the last error output and without the password.
$dbCase = @'
# Real WordPress files are needed, otherwise WP-CLI fails with a not-a-WordPress-installation error instead of a DB error.
php -d memory_limit=512M /usr/local/bin/wp core download --path=/var/www/html >/dev/null
cat > /var/www/html/wp-config.php <<'PHP'
<?php
define('DB_NAME','wp'); define('DB_USER','wpuser'); define('DB_PASSWORD','Dummy-Db-Pass-9f3k'); define('DB_HOST','127.0.0.1:1');
$table_prefix='wp_';
require_once ABSPATH . 'wp-settings.php';
PHP
sh /s/setup.sh
'@
$r = Invoke-Container $dbCase ($baseEnv + @('-e','ADMIN_PASSWORD=Dummy-Admin-Pass-7q2m','-e','DB_WAIT_TRIES=2','-e','DB_WAIT_SLEEP=1'))
Report 'wrong DB host fails with the last error' (($r.Code -ne 0) -and ($r.Out -match 'database not reachable') -and ($r.Out -match 'last error: .*(Error|ERROR|connect)') -and ($r.Out -notmatch 'YIKES')) "(exit $($r.Code))"
Report 'DB failure output has no password' (($r.Out -notmatch 'Dummy-Db-Pass') -and ($r.Out -notmatch 'Dummy-Admin-Pass')) 
$lines = ($r.Out -split "`n" | Where-Object { $_ -match '\S' }).Count
Report 'DB failure output stays short' ($lines -le 15) "($lines lines)"

# 3b. A failing version comparison must stop the Job, not be treated as "equal". A stub wp (mounted from a temp dir, because PowerShell 5.1 mangles quotes in native arguments) answers everything
# except eval (the comparison), which fails; WooCommerce 10.0.0 is "installed", so a masked failure would skip the upgrade silently.
$stubDir = Join-Path $tmp 'stub'
New-Item -ItemType Directory -Path $stubDir | Out-Null
[IO.File]::WriteAllText((Join-Path $stubDir 'wp'), "#!/bin/sh`ncase `$* in`n  *option*get*) echo `$WP_URL ;;`n  *plugin*get*) echo 10.0.0 ;;`n  *eval*) echo stub-eval-failed >&2; exit 1 ;;`n  *) exit 0 ;;`nesac`n")
$stubCase = 'touch /var/www/html/wp-config.php; PATH=/stub:$PATH sh /s/setup.sh'
$r = Invoke-Container $stubCase ($baseEnv + @('-e','ADMIN_PASSWORD=Dummy-Admin-Pass-7q2m','-v',"${stubDir}:/stub:ro"))
Report 'a failing version comparison stops setup with a message' (($r.Code -ne 0) -and ($r.Out -match 'could not compare WooCommerce versions') -and ($r.Out -notmatch 'SETUP COMPLETE')) "(exit $($r.Code))"

# 3c. WooCommerce's database update runs on every setup, also when the plugin is already at WOO_VERSION, so an update
# interrupted by a failed earlier run is finished by the next one ("wp wc update" is idempotent). The stub logs every call.
$stub2Dir = Join-Path $tmp 'stub2'
New-Item -ItemType Directory -Path $stub2Dir | Out-Null
[IO.File]::WriteAllText((Join-Path $stub2Dir 'wp'), "#!/bin/sh`necho `"`$*`" >> /tmp/wp-calls`ncase `$* in`n  *option*get*) echo `$WP_URL ;;`n  *plugin*get*) echo 11.2.1 ;;`n  *user*meta*get*) echo 1 ;;`n  *eval*) echo 0 ;;`n  *) exit 0 ;;`nesac`n")
$r = Invoke-Container 'touch /var/www/html/wp-config.php; PATH=/stub2:$PATH sh /s/setup.sh; echo EXIT=$?; echo CALLS; cat /tmp/wp-calls' ($baseEnv + @('-e','ADMIN_PASSWORD=Dummy-Admin-Pass-7q2m','-e','STORE_TIMEZONE=UTC','-e','STORE_CURRENCY=USD','-e','STORE_COUNTRY=US:CA','-v',"${stub2Dir}:/stub2:ro"))
$calls = ($r.Out -split 'CALLS', 2)[-1]
Report 'wp wc update runs when WooCommerce is already at WOO_VERSION' (($r.Out -match 'EXIT=0') -and ($r.Out -match 'SETUP COMPLETE') -and
  ($r.Out -match 'already at 11\.2\.1') -and ($calls -match '(?m)wc update\s*$')) $r.Out

# 4. Static: the password is never an argument.
$src = Get-Content (Join-Path $dir 'setup.sh') -Raw
Report 'setup.sh has no --admin_password= argument' ($src -notmatch '--admin_password=')
Report 'setup.sh passes the password on stdin' ($src -match 'printf ''%s\\n'' "\$ADMIN_PASSWORD" \|')

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Write-Host ''
if ($script:fail -eq 0) { Write-Host 'All store-setup tests passed.'; exit 0 } else { Write-Host "$script:fail store-setup test(s) FAILED."; exit 1 }
