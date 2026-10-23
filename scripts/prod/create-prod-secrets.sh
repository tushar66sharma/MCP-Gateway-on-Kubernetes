#!/usr/bin/env bash
# Creates the namespaces and every Secret that deploy/values-prod.yaml names, with generated values.
# Runs on the VPS and from Git Bash (kubectl and openssl on PATH). Safe to run again: an existing Secret
# is kept (never overwritten, never rotated). No value is ever printed or put on a command line.
#
#   scripts/prod/create-prod-secrets.sh admin@yourdomain.com
#
# The email becomes the first gateway admin login. When run in a terminal it also asks for the optional
# LLM provider keys (typed input is hidden; press Enter to skip a key).
set -euo pipefail

RELEASE=urumi
RELEASE_NS=urumi-system
STORE_NS=store
MCP_NS=mcp
GATEWAY_NS=gateway

usage() {
  echo "Usage: $0 <gateway-admin-email>" >&2
  echo "Creates namespaces store, mcp, gateway and their Secrets for deploy/values-prod.yaml." >&2
}

if [ "$#" -ne 1 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 2; fi
ADMIN_EMAIL=$1
case $ADMIN_EMAIL in
  *[[:space:]]*|*[!-A-Za-z0-9.@_+]*|@*|*@|*@*@*) echo "ERROR: '$ADMIN_EMAIL' is not a usable email address." >&2; exit 2 ;;
  *@*.*) ;;
  *) echo "ERROR: '$ADMIN_EMAIL' is not a usable email address." >&2; exit 2 ;;
esac

for tool in kubectl openssl base64; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: '$tool' was not found on PATH." >&2; exit 1; }
done

CONTEXT=$(kubectl config current-context 2>/dev/null) || { echo "ERROR: no current kube context." >&2; exit 1; }
if [ "$CONTEXT" = "k3d-urumi" ]; then
  echo "ERROR: refusing to run against the local development cluster (context k3d-urumi)." >&2
  echo "Production Secrets would clash with the generated local ones. Switch context first." >&2
  exit 1
fi
echo "Kube context: $CONTEXT"

b64() { printf '%s' "$1" | base64 | tr -d '\r\n'; }
rand_hex() { openssl rand -hex "$1" | tr -d '\r\n'; }

# generate <kind> prints a new value. hex:N = N hex characters (N even); b64key = base64 of 32 random bytes
# (the gateway's encryption key); ck / cs = WooCommerce API key and secret (prefix + 40 hex = 43 characters).
generate() {
  case $1 in
    hex:*) rand_hex $(($(printf '%s' "${1#hex:}") / 2)) ;;
    b64key) openssl rand -base64 32 | tr -d '\r\n' ;;
    ck) printf 'ck_%s' "$(rand_hex 20)" ;;
    cs) printf 'cs_%s' "$(rand_hex 20)" ;;
    *) echo "ERROR: unknown generator '$1'" >&2; return 1 ;;
  esac
}

ensure_namespace() {
  local ns=$1
  if kubectl get namespace "$ns" >/dev/null 2>&1; then
    echo "namespace $ns: kept"
  else
    kubectl create namespace "$ns" >/dev/null
    echo "namespace $ns: created"
  fi
  # Helm refuses to adopt a namespace without its ownership metadata. Re-applied every run (harmless).
  kubectl label namespace "$ns" app.kubernetes.io/managed-by=Helm --overwrite >/dev/null
  kubectl annotate namespace "$ns" "meta.helm.sh/release-name=$RELEASE" "meta.helm.sh/release-namespace=$RELEASE_NS" --overwrite >/dev/null
}

secret_exists() { kubectl -n "$1" get secret "$2" >/dev/null 2>&1; }

# ensure_secret <name> "<ns> [<ns>...]" <key>=<spec> ...
# spec is a generator kind (see generate) or lit:<text>. A key that already exists in ANY listed namespace is
# reused, so the copies in the namespaces stay byte-identical; otherwise one value is generated and written to
# every namespace that lacks the Secret. A Secret that already exists is kept untouched.
ensure_secret() {
  local name=$1 namespaces=$2
  shift 2
  local missing=() ns
  for ns in $namespaces; do
    if secret_exists "$ns" "$name"; then echo "secret $ns/$name: kept"; else missing+=("$ns"); fi
  done
  [ "${#missing[@]}" -eq 0 ] && return 0

  local data="" pair key spec value b64v src
  for pair in "$@"; do
    key=${pair%%=*}
    spec=${pair#*=}
    b64v=""
    for src in $namespaces; do
      if secret_exists "$src" "$name"; then
        b64v=$(kubectl -n "$src" get secret "$name" -o "jsonpath={.data.$key}" 2>/dev/null || true)
        [ -n "$b64v" ] && break
      fi
    done
    if [ -z "$b64v" ]; then
      case $spec in
        lit:*) value=${spec#lit:} ;;
        *) value=$(generate "$spec") ;;
      esac
      b64v=$(b64 "$value")
    fi
    # Quoted, so YAML always reads the base64 text as a string (an all-digit value would otherwise be a number).
    data="$data  $key: \"$b64v\""$'\n'
  done
  value=""

  for ns in "${missing[@]}"; do
    # The manifest goes to kubectl on stdin, so no value appears in the process list.
    printf 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: %s\n  namespace: %s\n  labels:\n    app.kubernetes.io/name: %s\n    app.kubernetes.io/part-of: urumi-platform\n    app.kubernetes.io/managed-by: create-prod-secrets\ntype: Opaque\ndata:\n%s' \
      "$name" "$ns" "$name" "$data" | kubectl create -f - >/dev/null
    echo "secret $ns/$name: created"
  done
  data=""
}

echo "--- namespaces"
ensure_namespace "$STORE_NS"
ensure_namespace "$MCP_NS"
ensure_namespace "$GATEWAY_NS"

echo "--- secrets"
ensure_secret store-db "$STORE_NS" root-password=hex:32 password=hex:32
ensure_secret store-admin "$STORE_NS" password=hex:24
ensure_secret store-woo-api "$STORE_NS $MCP_NS" consumer-key=ck consumer-secret=cs
ensure_secret mcp-woocommerce-token "$MCP_NS $GATEWAY_NS" token=hex:48
ensure_secret mcp-notes-token "$MCP_NS $GATEWAY_NS" token=hex:48
ensure_secret mcp-utilities-key "$MCP_NS $GATEWAY_NS" key=hex:48
ensure_secret gateway-secrets "$GATEWAY_NS" postgres-password=hex:32 encryption-key=b64key internal-token-secret=hex:48
ensure_secret gateway-bootstrap "$GATEWAY_NS" "email=lit:$ADMIN_EMAIL" password=hex:20

# Optional LLM keys: asked only in a terminal, typed input is not echoed. Without any key chat stays off.
if secret_exists "$GATEWAY_NS" llm-api-keys; then
  echo "secret $GATEWAY_NS/llm-api-keys: kept"
elif [ -t 0 ]; then
  GROQ_KEY=""; OPENROUTER_KEY=""
  read -rsp "Groq API key (Enter to skip; hidden): " GROQ_KEY || true; echo
  read -rsp "OpenRouter API key (Enter to skip; hidden): " OPENROUTER_KEY || true; echo
  if [ -n "$GROQ_KEY$OPENROUTER_KEY" ]; then
    printf 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: llm-api-keys\n  namespace: %s\n  labels:\n    app.kubernetes.io/name: llm-api-keys\n    app.kubernetes.io/part-of: urumi-platform\n    app.kubernetes.io/managed-by: create-prod-secrets\ntype: Opaque\ndata:\n  GROQ_API_KEY: "%s"\n  OPENROUTER_API_KEY: "%s"\n' \
      "$GATEWAY_NS" "$(b64 "$GROQ_KEY")" "$(b64 "$OPENROUTER_KEY")" | kubectl create -f - >/dev/null
    echo "secret $GATEWAY_NS/llm-api-keys: created"
  else
    echo "secret $GATEWAY_NS/llm-api-keys: skipped (no key given; chat stays disabled)"
  fi
  GROQ_KEY=""; OPENROUTER_KEY=""
else
  echo "secret $GATEWAY_NS/llm-api-keys: skipped (not a terminal; chat stays disabled)"
fi

cat <<'MSG'

--- Done. Nothing secret was printed. To read a password later (run on this machine):
  WordPress admin (user: admin):
    kubectl -n store get secret store-admin -o jsonpath='{.data.password}' | base64 -d; echo
  MariaDB root:
    kubectl -n store get secret store-db -o jsonpath='{.data.root-password}' | base64 -d; echo
  Gateway dashboard admin (login: the email you passed):
    kubectl -n gateway get secret gateway-bootstrap -o jsonpath='{.data.password}' | base64 -d; echo
Next: helm upgrade --install urumi charts/urumi-platform -n urumi-system --create-namespace -f deploy/values-prod.yaml
MSG
