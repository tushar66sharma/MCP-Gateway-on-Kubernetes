<?php
/**
 * Creates (or replaces) the WooCommerce REST API key used by the MCP server.
 * The key/secret come from the store-woo-api Kubernetes Secret, so the cluster
 * (not WordPress) is the source of truth and the value is stable across upgrades.
 * WooCommerce stores the consumer key hashed (wc_api_hash) and the secret in plain text.
 */
global $wpdb;

$consumer_key    = getenv( 'WOO_CONSUMER_KEY' );
$consumer_secret = getenv( 'WOO_CONSUMER_SECRET' );
$admin           = get_user_by( 'login', getenv( 'ADMIN_USER' ) );

if ( ! $consumer_key || ! $consumer_secret ) {
	WP_CLI::error( 'WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET are not set.' );
}
if ( ! $admin ) {
	WP_CLI::error( 'Admin user not found: ' . getenv( 'ADMIN_USER' ) );
}
if ( ! function_exists( 'wc_api_hash' ) ) {
	WP_CLI::error( 'WooCommerce is not active (wc_api_hash missing).' );
}

$table       = $wpdb->prefix . 'woocommerce_api_keys';
$description = 'urumi-mcp (managed by Helm; do not edit)';

$wpdb->delete( $table, array( 'description' => $description ) );
$inserted = $wpdb->insert(
	$table,
	array(
		'user_id'         => $admin->ID,
		'description'     => $description,
		'permissions'     => 'read_write',
		'consumer_key'    => wc_api_hash( $consumer_key ),
		'consumer_secret' => $consumer_secret,
		'truncated_key'   => substr( $consumer_key, -7 ),
	)
);
if ( ! $inserted ) {
	WP_CLI::error( 'Failed to insert API key: ' . $wpdb->last_error );
}
WP_CLI::success( 'WooCommerce REST API key upserted (…' . substr( $consumer_key, -7 ) . ').' );
