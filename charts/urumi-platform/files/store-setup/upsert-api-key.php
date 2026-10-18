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
$owner_login     = getenv( 'MCP_KEY_OWNER' );
$owner           = $owner_login ? get_user_by( 'login', $owner_login ) : false;

if ( ! $consumer_key || ! $consumer_secret ) {
	WP_CLI::error( 'WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET are not set.' );
}
if ( ! $owner ) {
	WP_CLI::error( 'MCP key owner not found: ' . $owner_login );
}
if ( ! user_can( $owner, 'manage_woocommerce' ) ) {
	WP_CLI::error( 'MCP key owner lacks the manage_woocommerce capability: ' . $owner_login );
}
if ( '1' !== get_user_meta( $owner->ID, 'urumi_managed_key_owner', true ) ) {
	WP_CLI::error( 'MCP key owner ' . $owner_login . ' was not created by store setup (missing urumi_managed_key_owner marker); refusing to own the API key.' );
}
if ( ! function_exists( 'wc_api_hash' ) ) {
	WP_CLI::error( 'WooCommerce is not active (wc_api_hash missing).' );
}

$table       = $wpdb->prefix . 'woocommerce_api_keys';
$description = 'urumi-mcp (managed by Helm; do not edit)';

$truncated = substr( $consumer_key, -7 );
$row       = array(
	'user_id'         => $owner->ID,
	'permissions'     => 'read_write',
	'consumer_key'    => wc_api_hash( $consumer_key ),
	'consumer_secret' => $consumer_secret,
	'truncated_key'   => $truncated,
);

// Update in place so key_id is stable across upgrades (no delete + insert of the surviving row).
$ids = $wpdb->get_col( $wpdb->prepare( "SELECT key_id FROM {$table} WHERE description = %s ORDER BY key_id ASC", $description ) );
if ( $ids ) {
	$keep = (int) array_shift( $ids );
	foreach ( $ids as $extra ) { // legacy duplicates
		if ( false === $wpdb->delete( $table, array( 'key_id' => (int) $extra ) ) ) {
			WP_CLI::error( 'Failed to delete duplicate API key row: ' . $wpdb->last_error );
		}
	}
	$ok = false !== $wpdb->update( $table, $row, array( 'key_id' => $keep ) );
} else {
	$ok = (bool) $wpdb->insert( $table, $row + array( 'description' => $description ) );
}
if ( ! $ok ) {
	WP_CLI::error( 'Failed to upsert API key: ' . $wpdb->last_error );
}
WP_CLI::success( 'WooCommerce REST API key upserted (...' . $truncated . ') for ' . $owner_login . '.' );
