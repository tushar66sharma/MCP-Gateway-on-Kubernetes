// Known-answer tests for the OAuth1 signer. Run: node --test scripts/dev/
//
// The expected base string and signature were produced by an INDEPENDENT PHP implementation of
// WooCommerce's algorithm (WC_REST_Authentication::check_oauth_signature + normalize_parameters +
// join_with_equals_sign), run inside the WordPress pod:
//
//   kubectl -n store exec -i deploy/wordpress -c wordpress -- php < vector.php
//
// vector.php:
//   <?php
//   $secret = 'cs_dummysecret0000000000000000000000000000';
//   $params = array(
//     'per_page' => '5', 'search' => 'mug & cup', 'a0' => '1', 'a:b' => '2',
//     'orderby' => 'date', 'name' => "caf\xC3\xA9",
//     'oauth_consumer_key' => 'ck_dummykey00000000000000000000000000000',
//     'oauth_nonce' => 'abcdef0123456789abcdef0123456789',
//     'oauth_signature_method' => 'HMAC-SHA256',
//     'oauth_timestamp' => '1760000000',
//   );
//   uksort( $params, 'strcmp' );
//   $pairs = array();
//   foreach ( $params as $k => $v ) {
//     $pairs[] = rawurlencode( rawurlencode( $k ) . '=' . rawurlencode( $v ) );
//   }
//   $base = 'GET&' . rawurlencode( 'http://store.localhost/wp-json/wc/v3/products' ) . '&' . implode( '%26', $pairs );
//   echo $base, "\n", base64_encode( hash_hmac( 'sha256', $base, $secret . '&', true ) ), "\n";
//
// The key and secret are dummy values, not cluster secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOAuth1BaseString, signOAuth1Url } from './woo-oauth-check.mjs';

const consumerKey = 'ck_dummykey00000000000000000000000000000';
const consumerSecret = 'cs_dummysecret0000000000000000000000000000';
const nonce = 'abcdef0123456789abcdef0123456789';
const timestamp = 1760000000;
const signingBaseUrl = 'http://store.localhost';

const EXPECTED_BASE_STRING =
  'GET&http%3A%2F%2Fstore.localhost%2Fwp-json%2Fwc%2Fv3%2Fproducts&' +
  'a0%3D1%26a%253Ab%3D2%26name%3Dcaf%25C3%25A9%26' +
  'oauth_consumer_key%3Dck_dummykey00000000000000000000000000000%26' +
  'oauth_nonce%3Dabcdef0123456789abcdef0123456789%26oauth_signature_method%3DHMAC-SHA256%26' +
  'oauth_timestamp%3D1760000000%26orderby%3Ddate%26per_page%3D5%26search%3Dmug%2520%2526%2520cup';
const EXPECTED_SIGNATURE = 'lGODYY6tV/Ik3bMkgqOu1GcejVuxp2ku6Y/CJXxpaxk=';

// Sent to 127.0.0.1 but signed against the public URL, as the MCP server will do.
const requestUrl =
  'http://127.0.0.1:18088/wp-json/wc/v3/products?per_page=5&search=mug%20%26%20cup&a0=1&a%3Ab=2&orderby=date&name=caf%C3%A9';

test('base string matches the PHP reference (raw-key byte order, reserved chars, unicode)', () => {
  const { baseString } = buildOAuth1BaseString({ method: 'GET', requestUrl, signingBaseUrl, consumerKey, nonce, timestamp });
  assert.equal(baseString, EXPECTED_BASE_STRING);
});

test('signature matches the PHP reference', () => {
  const url = new URL(signOAuth1Url({ method: 'GET', requestUrl, signingBaseUrl, consumerKey, consumerSecret, nonce, timestamp }));
  assert.equal(url.searchParams.get('oauth_signature'), EXPECTED_SIGNATURE);
  assert.equal(url.origin, 'http://127.0.0.1:18088', 'request still goes to the target, not the signing base');
  assert.equal(url.searchParams.get('search'), 'mug & cup');
  assert.equal(url.searchParams.get('name'), 'café');
});

test('duplicate query keys are rejected', () => {
  assert.throws(
    () => signOAuth1Url({ method: 'GET', requestUrl: 'http://x/wp-json/wc/v3/products?id=1&id=2', signingBaseUrl, consumerKey, consumerSecret }),
    /duplicate query key "id"/,
  );
});

test('array-style, dotted and spaced keys are rejected', () => {
  for (const q of ['include[]=1', 'include%5B0%5D=1', 'a.b=1', 'a%20b=1']) {
    assert.throws(
      () => signOAuth1Url({ method: 'GET', requestUrl: `http://x/wp-json/wc/v3/products?${q}`, signingBaseUrl, consumerKey, consumerSecret }),
      /unsupported query key/,
      q,
    );
  }
});

test('comma-separated lists are supported', () => {
  const { baseString } = buildOAuth1BaseString({
    method: 'GET', requestUrl: 'http://x/wp-json/wc/v3/products?include=1,2', signingBaseUrl, consumerKey, nonce, timestamp,
  });
  assert.match(baseString, /include%3D1%252C2/);
});
