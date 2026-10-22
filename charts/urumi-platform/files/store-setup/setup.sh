#!/bin/sh
# Idempotent store setup. Runs as a Helm post-install/post-upgrade hook Job.
# Every step checks current state first, so re-running it changes nothing.
set -eu

log() { echo "[store-setup] $(date -u +%H:%M:%S) $*"; }
fail() { echo "[store-setup] ERROR: $*" >&2; exit 1; }

WP="wp --path=/var/www/html"
. "$(dirname "$0")/lib.sh"

# Refuse an empty admin password before any WP-CLI call: an empty value would make the install
# prompt for (or generate) a password nobody knows.
[ -n "${ADMIN_PASSWORD:-}" ] || fail "ADMIN_PASSWORD is empty"

log "waiting for wp-config.php (written by the WordPress container on first start)"
i=0
until [ -f /var/www/html/wp-config.php ]; do
  i=$((i + 1)); [ "$i" -gt 60 ] && fail "wp-config.php did not appear within 300s"
  sleep 5
done

log "waiting for the database"
# Keep the last error (at most 5 lines) so a failure says why. WP-CLI database errors do not contain the password.
i=0
until db_err=$($WP db query "SELECT 1" 2>&1); do
  i=$((i + 1))
  if [ "$i" -gt "${DB_WAIT_TRIES:-60}" ]; then
    fail "database not reachable within $((i * ${DB_WAIT_SLEEP:-5}))s; last error: $(printf '%s\n' "$db_err" | tail -n 5)"
  fi
  sleep "${DB_WAIT_SLEEP:-5}"
done

if $WP core is-installed >/dev/null 2>&1; then
  log "WordPress already installed"
else
  log "installing WordPress"
  # The password goes in on stdin (--prompt), never as an argument, so it is not visible in the process
  # list. With piped input WP-CLI echoes the prompt and the equivalent command line (password included)
  # on stdout, so stdout is discarded; errors go to stderr and do not contain the password.
  printf '%s\n' "$ADMIN_PASSWORD" | $WP core install --url="$WP_URL" --title="$SITE_TITLE" \
    --admin_user="$ADMIN_USER" --admin_email="$ADMIN_EMAIL" --skip-email --prompt=admin_password >/dev/null
fi

# Keep the stored site address in step with the configured public URL (e.g. after a host change).
for opt in home siteurl; do
  current_url=$($WP option get "$opt")
  if [ "$current_url" != "$WP_URL" ]; then
    log "updating $opt: $current_url -> $WP_URL"
    $WP option update "$opt" "$WP_URL"
  fi
done

current_woo=""
if $WP plugin is-installed woocommerce >/dev/null 2>&1; then
  current_woo=$($WP plugin get woocommerce --field=version)
fi
# Install when WooCommerce is absent or older than WOO_VERSION; never downgrade a newer one.
woo_changed=false
case "$(woo_version_cmp "$current_woo" "$WOO_VERSION")" in
  older)
    log "installing WooCommerce $WOO_VERSION (found: ${current_woo:-none})"
    $WP plugin install woocommerce --version="$WOO_VERSION" --force
    woo_changed=true
    ;;
  newer)
    log "WooCommerce $current_woo is newer than $WOO_VERSION; not downgrading"
    ;;
esac
$WP plugin is-active woocommerce >/dev/null 2>&1 || $WP plugin activate woocommerce
# After an install or upgrade, run WooCommerce's database update now instead of waiting for an admin visit.
if [ "$woo_changed" = "true" ]; then
  log "running the WooCommerce database update"
  $WP wc update
fi

log "configuring store options"
$WP option update timezone_string "$STORE_TIMEZONE"
$WP option update woocommerce_currency "$STORE_CURRENCY"
$WP option update woocommerce_default_country "$STORE_COUNTRY"
# New stores start in "coming soon" mode, which hides the shop from visitors.
$WP option update woocommerce_coming_soon no
$WP option update woocommerce_store_pages_only no
# No shipping: every product can be checked out without configuring shipping zones.
$WP option update woocommerce_ship_to_countries disabled
$WP option update woocommerce_calc_taxes no
$WP option update woocommerce_enable_guest_checkout yes
# WooCommerce 11 tracks hidden onboarding task lists here (the old woocommerce_task_list_hidden option is gone).
$WP option update woocommerce_task_list_hidden_lists '["setup"]' --format=json
$WP option update woocommerce_onboarding_profile '{"skipped":true}' --format=json
$WP option update woocommerce_cod_settings \
  '{"enabled":"yes","title":"Cash on delivery","description":"Pay with cash upon delivery.","instructions":"Pay with cash upon delivery.","enable_for_methods":[],"enable_for_virtual":"yes"}' \
  --format=json

# DEMO-STORE SETTING: open registration has no email verification and no CAPTCHA, so anyone who can
# reach the store can create accounts (and, with COD guest checkout, fake orders). The values toggle
# storeSetup.customerRegistration (CUSTOMER_REGISTRATION here) defaults to true for the local demo;
# production sets it to false. There is no CAPTCHA, so registration stays off wherever the store is public.
if [ "${CUSTOMER_REGISTRATION:-true}" = "true" ]; then
  log "enabling customer accounts (register on My Account and at checkout; customers choose their own password because no mail server is configured)"
  registration=yes
else
  log "customer registration is disabled (storeSetup.customerRegistration=false)"
  registration=no
fi
$WP option update woocommerce_enable_myaccount_registration "$registration"
$WP option update woocommerce_enable_signup_and_login_from_checkout "$registration"
$WP option update woocommerce_enable_checkout_login_reminder yes
$WP option update woocommerce_registration_generate_username yes
$WP option update woocommerce_registration_generate_password no

log "ensuring shop/cart/checkout/my-account pages exist"
$WP wc tool run install_pages --user="$ADMIN_USER" >/dev/null || log "install_pages tool unavailable; relying on WooCommerce activation"

log "enabling pretty permalinks (needed for /wp-json/ REST paths)"
$WP rewrite structure '/%postname%/' --hard
$WP rewrite flush --hard

if [ "$SEED_PRODUCTS" = "true" ]; then
  count=$($WP wc product list --user="$ADMIN_USER" --format=count)
  if [ "$count" = "0" ]; then
    log "seeding sample products"
    $WP wc product create --user="$ADMIN_USER" --name="Urumi Coffee Mug" --regular_price="12.50" --status=publish --description="Ceramic mug, 350 ml." >/dev/null
    $WP wc product create --user="$ADMIN_USER" --name="Urumi T-Shirt" --regular_price="19.99" --status=publish --description="Cotton t-shirt." >/dev/null
    $WP wc product create --user="$ADMIN_USER" --name="Urumi Sticker Pack" --regular_price="4.00" --status=publish --description="Five vinyl stickers." >/dev/null
  else
    log "products already present ($count); not seeding"
  fi
fi

# Least privilege: the MCP key is owned by a dedicated shop_manager, not the admin. Nobody logs in
# as this user (random password, never printed); it only owns the API key.
# SECURITY: customer registration is open and WooCommerce derives usernames from the email local part,
# so anyone can register as urumi-mcp@<anything> and get the login "urumi-mcp". We therefore only
# (re)grant shop_manager to an account that THIS script created (marked with user meta), never to an
# account that merely has the same login.
: "${MCP_KEY_OWNER:?MCP_KEY_OWNER must be set}"
log "ensuring the MCP key owner $MCP_KEY_OWNER (shop_manager)"
if $WP user get "$MCP_KEY_OWNER" >/dev/null 2>&1; then
  marker=$($WP user meta get "$MCP_KEY_OWNER" urumi_managed_key_owner 2>/dev/null || true)
  if [ "$marker" != "1" ]; then
    fail "user '$MCP_KEY_OWNER' exists but was not created by store setup (missing urumi_managed_key_owner marker); refusing to grant shop_manager. Rename/delete that user, or if it is legitimately yours add the marker: wp user meta update $MCP_KEY_OWNER urumi_managed_key_owner 1"
  fi
  $WP user set-role "$MCP_KEY_OWNER" shop_manager
else
  # No --user_pass (it would sit in the process arguments): WP-CLI generates a random password and
  # prints it on stdout, which goes to /dev/null so it is never shown or logged.
  $WP user create "$MCP_KEY_OWNER" "$MCP_KEY_OWNER@example.invalid" --role=shop_manager >/dev/null
  $WP user meta update "$MCP_KEY_OWNER" urumi_managed_key_owner 1 >/dev/null
  log "created user $MCP_KEY_OWNER"
fi

log "upserting the WooCommerce REST API key for the MCP server (owner: $MCP_KEY_OWNER)"
$WP eval-file /scripts/upsert-api-key.php

log "SETUP COMPLETE"
