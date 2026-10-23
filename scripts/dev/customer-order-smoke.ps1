<#
.SYNOPSIS
  End-to-end check: register a customer, place a COD order, see it under My Orders.

.DESCRIPTION
  1. Registers smoke+<timestamp>@example.com through the My Account form.
  2. Places a cash-on-delivery order via the WooCommerce Store API as that customer.
  3. Checks /my-account/orders/ links to the order (view-order/<id>/).
  Exit 0 on success, 1 with a clear message on failure.
  The script leaves a demo customer and order in the store (useful demo data).
  The random password is never printed; to log in as a customer, register your own account.

.PARAMETER BaseUrl
  Store URL (default http://store.localhost).

.PARAMETER ProductId
  Product to order (default: the first product the Store API lists). The script prints only the order id and the email, never the password.

.PARAMETER CheckGuestLinking
  Extra, informational: place a guest order, then register an account with the same
  email and report whether WooCommerce attached the order to the new account.
  Does not affect the exit code.
#>
param(
  [string]$BaseUrl = 'http://store.localhost',
  [switch]$CheckGuestLinking,
  [int]$ProductId = 0
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')

function Fail([string]$msg) {
  Write-Host "SMOKE FAILED: $msg" -ForegroundColor Red
  exit 1
}

function New-RandomPassword {
  $bytes = New-Object byte[] 24
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return 'Aa1!' + [Convert]::ToBase64String($bytes).Replace('/', '_').Replace('+', '-')
}

function Get-HeaderValue($response, [string]$name) {
  $v = $response.Headers[$name]
  if ($null -eq $v) { return $null }
  return [string]@($v)[0]
}

function Register-Customer($session, [string]$email, [string]$password) {
  $page = Invoke-WebRequest -UseBasicParsing -WebSession $session -Uri "$BaseUrl/my-account/"
  $m = [regex]::Match($page.Content, 'name="woocommerce-register-nonce"\s+value="([^"]+)"')
  if (-not $m.Success) {
    $m = [regex]::Match($page.Content, 'value="([^"]+)"[^>]*name="woocommerce-register-nonce"')
  }
  if (-not $m.Success) {
    throw "no woocommerce-register-nonce on $BaseUrl/my-account/ (is registration enabled? check woocommerce_enable_myaccount_registration)"
  }
  if ($page.Content -notmatch 'reg_password') {
    throw 'registration form has no password field (woocommerce_registration_generate_password should be "no")'
  }
  $form = @{
    email                       = $email
    password                    = $password
    'woocommerce-register-nonce' = $m.Groups[1].Value
    _wp_http_referer            = '/my-account/'
    register                    = 'Register'
  }
  $resp = Invoke-WebRequest -UseBasicParsing -WebSession $session -Uri "$BaseUrl/my-account/" -Method Post -Body $form
  if ($resp.Content -notmatch 'woocommerce-MyAccount-navigation') {
    $err = [regex]::Match($resp.Content, '(?s)woocommerce-error[^>]*>(.*?)</ul>')
    $detail = ''
    if ($err.Success) { $detail = ' Server said: ' + (($err.Groups[1].Value -replace '<[^>]+>', ' ') -replace '\s+', ' ').Trim() }
    throw "registration did not log the customer in.$detail"
  }
}

function Get-FirstProductId {
  $products = Invoke-RestMethod -UseBasicParsing -Uri "$BaseUrl/wp-json/wc/store/v1/products?per_page=1"
  $first = @($products)[0]
  if ($null -eq $first -or -not $first.id) { throw 'Store API returned no products' }
  return [int]$first.id
}

function New-CodOrder($session, [string]$email, [int]$productId) {
  $cart = Invoke-WebRequest -UseBasicParsing -WebSession $session -Uri "$BaseUrl/wp-json/wc/store/v1/cart"
  # Recent WooCommerce sends "Nonce"; older versions sent "X-WC-Store-API-Nonce".
  $nonce = Get-HeaderValue $cart 'Nonce'
  if (-not $nonce) { $nonce = Get-HeaderValue $cart 'X-WC-Store-API-Nonce' }
  if (-not $nonce) { throw 'Store API cart response has no Nonce header' }
  $headers = @{ Nonce = $nonce }

  $add = @{ id = $productId; quantity = 1 } | ConvertTo-Json -Compress
  try {
    Invoke-WebRequest -UseBasicParsing -WebSession $session -Uri "$BaseUrl/wp-json/wc/store/v1/cart/add-item" `
      -Method Post -Headers $headers -ContentType 'application/json' -Body $add | Out-Null
  } catch {
    throw "cart/add-item failed: $($_.Exception.Message)"
  }

  $addr = [ordered]@{
    first_name = 'Smoke'
    last_name  = 'Tester'
    address_1  = '1 Demo Street'
    city       = 'San Francisco'
    state      = 'CA'
    postcode   = '94105'
    country    = 'US'
    email      = $email
    phone      = '5555550100'
  }
  $body = [ordered]@{
    billing_address  = $addr
    shipping_address = $addr
    payment_method   = 'cod'
  } | ConvertTo-Json -Depth 5 -Compress

  try {
    $resp = Invoke-WebRequest -UseBasicParsing -WebSession $session -Uri "$BaseUrl/wp-json/wc/store/v1/checkout" `
      -Method Post -Headers $headers -ContentType 'application/json' -Body $body
  } catch {
    $detail = ''
    try {
      $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $detail = ' ' + $sr.ReadToEnd()
    } catch {}
    throw "checkout failed: $($_.Exception.Message)$detail"
  }
  $order = $resp.Content | ConvertFrom-Json
  if (-not $order.order_id) { throw 'checkout response has no order_id' }
  return [int]$order.order_id
}

$stamp = Get-Date -Format 'yyyyMMddHHmmss'

# --- Main check -----------------------------------------------------------
$email = "smoke+$stamp@example.com"
$password = New-RandomPassword
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

try {
  Write-Host "1/3 registering $email via My Account"
  Register-Customer $session $email $password

  Write-Host '2/3 placing a cash-on-delivery order through the Store API'
  if ($ProductId -gt 0) { $productId = $ProductId } else { $productId = Get-FirstProductId }
  $orderId = New-CodOrder $session $email $productId

  Write-Host "3/3 checking My Orders for order #$orderId"
  $orders = Invoke-WebRequest -UseBasicParsing -WebSession $session -Uri "$BaseUrl/my-account/orders/"
  if ($orders.Content -notmatch "view-order/$orderId/") {
    throw "order #$orderId is not listed at $BaseUrl/my-account/orders/"
  }
} catch {
  Fail $_.Exception.Message
}

Write-Host ''
Write-Host 'SMOKE PASSED' -ForegroundColor Green
Write-Host "  Customer email : $email"
Write-Host "  Order id       : $orderId"
Write-Host "  My Orders URL  : $BaseUrl/my-account/orders/"
Write-Host '  The password is random and not shown. To see My Orders yourself,'
Write-Host '  register your own account at /my-account/ and place an order.'

# --- Optional: guest order is linked to a later account with the same email ---
if ($CheckGuestLinking) {
  Write-Host ''
  Write-Host 'Guest-linking check (informational, does not change the exit code)'
  try {
    $gEmail = "smoke-guest+$stamp@example.com"
    $guest = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $gOrder = New-CodOrder $guest $gEmail (Get-FirstProductId)
    Write-Host "  guest order #$gOrder placed as $gEmail"
    $acct = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    Register-Customer $acct $gEmail (New-RandomPassword)
    $list = Invoke-WebRequest -UseBasicParsing -WebSession $acct -Uri "$BaseUrl/my-account/orders/"
    if ($list.Content -match "view-order/$gOrder/") {
      Write-Host "  RESULT: linked - guest order #$gOrder shows in the new account's My Orders"
    } else {
      Write-Host "  RESULT: not linked - guest order #$gOrder does not show in the new account's My Orders"
    }
  } catch {
    Write-Host "  guest-linking check could not run: $($_.Exception.Message)"
  }
}
exit 0
