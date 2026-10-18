#!/bin/sh
# Idempotent store setup. Runs as a Helm post-install/post-upgrade hook Job.
# Every step checks current state first, so re-running it changes nothing.
set -eu

log() { echo "[store-setup] $(date -u +%H:%M:%S) $*"; }
fail() { echo "[store-setup] ERROR: $*" >&2; exit 1; }

WP="wp --path=/var/www/html"

log "waiting for wp-config.php (written by the WordPress container on first start)"
i=0
until [ -f /var/www/html/wp-config.php ]; do
  i=$((i + 1)); [ "$i" -gt 60 ] && fail "wp-config.php did not appear within 300s"
  sleep 5
done

log "waiting for the database"
i=0
until $WP db query "SELECT 1" >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 60 ] && fail "database not reachable within 300s"
  sleep 5
done

if $WP core is-installed >/dev/null 2>&1; then
  log "WordPress already installed"
else
  log "installing WordPress"
  $WP core install --url="$WP_URL" --title="$SITE_TITLE" \
    --admin_user="$ADMIN_USER" --admin_password="$ADMIN_PASSWORD" \
    --admin_email="$ADMIN_EMAIL" --skip-email
fi

current_woo=""
if $WP plugin is-installed woocommerce >/dev/null 2>&1; then
  current_woo=$($WP plugin get woocommerce --field=version)
fi
if [ "$current_woo" != "$WOO_VERSION" ]; then
  log "installing WooCommerce $WOO_VERSION (found: ${current_woo:-none})"
  $WP plugin install woocommerce --version="$WOO_VERSION" --force
fi
$WP plugin is-active woocommerce >/dev/null 2>&1 || $WP plugin activate woocommerce

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
# reach the store can create accounts (and, with COD guest checkout, fake orders). A values toggle
# (storeSetup.customerRegistration, off or with anti-spam for production) is planned for Phase 5.
log "enabling customer accounts (register on My Account and at checkout; customers choose their own password because no mail server is configured)"
$WP option update woocommerce_enable_myaccount_registration yes
$WP option update woocommerce_enable_signup_and_login_from_checkout yes
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
log "ensuring the MCP key owner $MCP_KEY_OWNER (shop_manager)"
if $WP user get "$MCP_KEY_OWNER" >/dev/null 2>&1; then
  $WP user set-role "$MCP_KEY_OWNER" shop_manager
else
  $WP user create "$MCP_KEY_OWNER" "$MCP_KEY_OWNER@example.invalid" --role=shop_manager     --user_pass="$(head -c 32 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 32)" >/dev/null
  log "created user $MCP_KEY_OWNER"
fi

log "upserting the WooCommerce REST API key for the MCP server (owner: $MCP_KEY_OWNER)"
$WP eval-file /scripts/upsert-api-key.php

log "SETUP COMPLETE"
