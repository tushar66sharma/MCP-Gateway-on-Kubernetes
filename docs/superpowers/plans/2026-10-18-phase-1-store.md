# Phase 1 — Store on Kubernetes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Helm chart, `charts/urumi-platform`, installs a working WooCommerce store into the k3d cluster with a single command. The store has persistent MariaDB and WordPress storage, a Traefik Ingress at `http://store.localhost`, Cash on Delivery enabled, seeded products, and a WooCommerce REST API key ready for the Phase 2 MCP server. That key is proven to work with OAuth 1.0a signing from outside the WordPress pod.

**Architecture:**
- Helm release `urumi` in namespace `urumi-system` owns three Namespaces (`store`, `mcp`, `gateway`). Phase 1 only populates `store`.
- Workloads:
  - MariaDB: a StatefulSet with a `volumeClaimTemplates` PVC, running as uid 999.
  - WordPress: a Deployment with its own PVC, running non-root as uid 33. Apache binds port 80 via the safe sysctl `net.ipv4.ip_unprivileged_port_start=0`.
  - Store setup: a Helm `post-install,post-upgrade` hook Job (`wordpress:cli`, uid 33) that installs and configures everything idempotently.
- Credentials are Helm-generated Secrets. They are reused across upgrades via `lookup`, memoised per render, and annotated `helm.sh/resource-policy: keep`.

**Tech Stack:** Helm 4.3.1, k3d 5.9.0 / k3s v1.35.5, Traefik (bundled), local-path StorageClass, `mariadb:11.8.9`, `wordpress:7.1.3-php8.3-apache`, `wordpress:cli-2.12.0-php8.3`, WooCommerce 11.2.1 (requires WordPress ≥ 7.0), Node 24 (local diagnostic script only), PowerShell 5.1.

**Master plan:** [`2026-10-18-mcp-gateway-implementation-plan.md`](2026-10-18-mcp-gateway-implementation-plan.md), Phase 1 and the "Carry-forward issues → Phase 1" items. Every carry-forward item is resolved by a task below (mapping at the end).

## Global Constraints

- **Branch:** `phase-1-store`, already created from the up-to-date `main`. Commit after every task, often several times. **Never push. No `Co-Authored-By` / Claude / AI attribution in commit messages.** Use conventional prefixes.
- **Root:** `C:\Users\Lenovo\Desktop\MCP Gateway on Kubernetes\MCP-Gateway-on-Kubernetes`. The path contains spaces, so always quote it.
- **Line endings:** LF everywhere except `*.ps1` (CRLF), per `.gitattributes`. Shell scripts that run inside containers must be LF.
- **Secrets:** never in source, values files or git. Generated values live only in cluster Secrets.
- **Release:** `helm upgrade --install urumi charts/urumi-platform -n urumi-system --create-namespace -f deploy/values-local.yaml --wait --timeout 10m`, always via `scripts/deploy.ps1`.
- **Namespaces:** `store`, `mcp`, `gateway`, owned by the chart and annotated `helm.sh/resource-policy: keep`.
- **Pinned images:** `mariadb:11.8.9`, `wordpress:7.1.3-php8.3-apache`, `wordpress:cli-2.12.0-php8.3`. WooCommerce `11.2.1`.
- **Hosts:** `store.localhost`, `app.localhost`. Ingress class `traefik`. Public URL = `{publicScheme}://{host}`, plus `:{publicPort}` only when the port isn't the scheme's default (80 for http, 443 for https).
- **Security context (this phase):**
  - Every pod: `runAsNonRoot: true`, explicit `runAsUser`/`runAsGroup`/`fsGroup`, `seccompProfile: RuntimeDefault`, `automountServiceAccountToken: false`.
  - Every container: `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`.
  - MariaDB: uid/gid 999. WordPress and the setup Job: uid/gid 33. WordPress also sets sysctl `net.ipv4.ip_unprivileged_port_start=0`.
  - `readOnlyRootFilesystem` is **not** required for MariaDB/WordPress/WP-CLI (they write to their image filesystems). Spec §8.5 is updated in Task 1.5.
- **Probes and resources:** every long-running container has readiness + liveness (plus a startupProbe for slow starters) and requests + limits. Jobs have resources but no probes.

| Workload | requests (cpu/mem) | limits (cpu/mem) |
|---|---|---|
| MariaDB | 100m / 256Mi | 500m / 512Mi |
| WordPress | 100m / 256Mi | 1 / 512Mi |
| store-setup Job | 100m / 256Mi | 1 / 768Mi |

- **Root npm scripts:** `npm test`/`npm run build` exit 1 ("No workspaces found") until Phase 2. **No Phase 1 verification may run them.**
- **Docs:** every task updates the docs it affects. Nothing is described as built or verified unless it was.

## File map

| File | Responsibility | Task |
|---|---|---|
| `charts/urumi-platform/Chart.yaml`, `.helmignore`, `values.yaml`, `values.schema.json` | Chart metadata, defaults, value validation | 1.1 (values grow in 1.2–1.4) |
| `charts/urumi-platform/templates/_helpers.tpl` | Labels, public URL, generated-secret, security-context helpers | 1.1 |
| `charts/urumi-platform/templates/namespaces.yaml` | The three chart-owned namespaces | 1.1 |
| `charts/urumi-platform/templates/NOTES.txt` | Post-install instructions (URLs, password retrieval) | 1.1, extended in 1.3 |
| `deploy/values-local.yaml`, `deploy/values-prod.yaml` | Environment overrides (prod is a stub until Phase 5) | 1.1 |
| `scripts/deploy.ps1` | Prerequisite checks + `helm upgrade --install … --wait` | 1.1 |
| `scripts/cluster-up.ps1`, `scripts/setup-hosts.ps1` | Prerequisite check; elevation feedback (carry-forward) | 1.1 |
| `charts/urumi-platform/templates/store/mariadb.yaml` | MariaDB Secret + headless Service + StatefulSet | 1.2 |
| `charts/urumi-platform/templates/store/wordpress.yaml` | WordPress PVC + Deployment + Service | 1.3 |
| `charts/urumi-platform/templates/store/store-secrets.yaml` | `store-admin`, `store-woo-api` Secrets | 1.3 |
| `charts/urumi-platform/templates/store/ingress.yaml` | `store.localhost` Ingress | 1.3 |
| `charts/urumi-platform/files/store-setup/setup.sh`, `upsert-api-key.php` | Idempotent WP-CLI setup logic | 1.4 |
| `charts/urumi-platform/templates/store/store-setup.yaml` | ConfigMap (scripts) + hook Job | 1.4 |
| `scripts/dev/woo-oauth-check.mjs`, `scripts/check-woo-api.ps1` | OAuth1-signed REST diagnostic (spike, reusable) | 1.4 |
| `docs/…` | workflows, deployment, troubleshooting, ADR/spec/plan corrections | 1.5 |

---

### Task 1.1: Chart skeleton, helpers, namespaces, values, deploy script

**Files:**
- Create: `charts/urumi-platform/Chart.yaml`, `charts/urumi-platform/.helmignore`, `charts/urumi-platform/values.yaml`, `charts/urumi-platform/values.schema.json`, `charts/urumi-platform/templates/_helpers.tpl`, `charts/urumi-platform/templates/namespaces.yaml`, `charts/urumi-platform/templates/NOTES.txt`, `deploy/values-local.yaml`, `deploy/values-prod.yaml`, `scripts/deploy.ps1`
- Modify: `scripts/cluster-up.ps1` (prerequisite check at top), `scripts/setup-hosts.ps1` (wait for the elevated run and report the result)

**Interfaces (produces, used by every later template):**
- `include "urumi.labels" (dict "root" $ "name" "<name>" "component" "<component>")`
- `include "urumi.selectorLabels" (dict "root" $ "name" "<name>")`
- `include "urumi.publicUrl" (dict "root" $ "host" <host>)` → e.g. `http://store.localhost`
- `include "urumi.generatedValue" (dict "root" $ "namespace" <canonical ns> "secret" <name> "key" <key> "length" <n> "prefix" <optional>)` → plaintext value (callers pipe to `b64enc`). Copies of one secret in different namespaces **must pass the same canonical `namespace`**, so they get the same value.
- `include "urumi.podSecurityContext" (dict "uid" <n> "gid" <n>)`, `include "urumi.containerSecurityContext" .`
- `scripts/deploy.ps1 [-ValuesFile deploy/values-local.yaml] [-Timeout 10m]`

- [ ] **Step 1: Write `charts/urumi-platform/Chart.yaml`**

```yaml
apiVersion: v2
name: urumi-platform
description: WooCommerce store plus a team MCP gateway, deployed as one release.
type: application
version: 0.1.0
appVersion: "0.1.0"
```

- [ ] **Step 2: Write `charts/urumi-platform/.helmignore`**

```
.DS_Store
.git/
*.swp
*.bak
*.tmp
*.orig
```

- [ ] **Step 3: Write `charts/urumi-platform/values.yaml`** (Phase 1 keys only; later phases append)

```yaml
# Default values. Environment-specific overrides live in deploy/values-*.yaml.
# Never put secrets in any values file: credentials are generated into Kubernetes
# Secrets by the chart, or supplied as pre-created Secrets via secrets.existing.*.

global:
  storeHost: store.localhost
  appHost: app.localhost
  publicScheme: http          # http locally; https in production
  publicPort: 80              # host port users browse on; omitted from URLs when it is the scheme default
  ingressClassName: traefik
  storageClass: ""            # "" = cluster default (local-path on k3s/k3d)
  imagePullPolicy: IfNotPresent
  tls:
    enabled: false
    clusterIssuer: ""         # cert-manager ClusterIssuer name (production)
    secretNamePrefix: urumi-tls

namespaces:
  store: store
  mcp: mcp
  gateway: gateway

# Pre-created Secrets (production). Empty = the chart generates them.
secrets:
  existing:
    storeDb: ""       # keys: root-password, password
    storeAdmin: ""    # keys: password
    storeWooApi: ""   # keys: consumer-key, consumer-secret
```

- [ ] **Step 4: Write `charts/urumi-platform/values.schema.json`** (validates the keys typos would break; open to later additions)

```json
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["global", "namespaces"],
  "properties": {
    "global": {
      "type": "object",
      "required": ["storeHost", "appHost", "publicScheme", "publicPort", "ingressClassName"],
      "properties": {
        "storeHost": { "type": "string", "minLength": 1 },
        "appHost": { "type": "string", "minLength": 1 },
        "publicScheme": { "type": "string", "enum": ["http", "https"] },
        "publicPort": { "type": "integer", "minimum": 1, "maximum": 65535 },
        "ingressClassName": { "type": "string", "minLength": 1 },
        "storageClass": { "type": "string" },
        "imagePullPolicy": { "type": "string", "enum": ["Always", "IfNotPresent", "Never"] },
        "tls": {
          "type": "object",
          "properties": {
            "enabled": { "type": "boolean" },
            "clusterIssuer": { "type": "string" },
            "secretNamePrefix": { "type": "string" }
          }
        }
      }
    },
    "namespaces": {
      "type": "object",
      "required": ["store", "mcp", "gateway"],
      "properties": {
        "store": { "type": "string", "pattern": "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" },
        "mcp": { "type": "string", "pattern": "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" },
        "gateway": { "type": "string", "pattern": "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" }
      }
    }
  }
}
```

- [ ] **Step 5: Write `charts/urumi-platform/templates/_helpers.tpl`**

```
{{/* Common labels. Args: dict root, name, component. */}}
{{- define "urumi.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/part-of: urumi-platform
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* Selector labels (immutable once deployed). Args: dict root, name. */}}
{{- define "urumi.selectorLabels" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/name: {{ .name }}
{{- end }}

{{/*
Public URL for a host. Args: dict root, host.
The port is appended only when it is not the default for the scheme.
*/}}
{{- define "urumi.publicUrl" -}}
{{- $g := .root.Values.global -}}
{{- $port := int $g.publicPort -}}
{{- if or (and (eq $g.publicScheme "http") (eq $port 80)) (and (eq $g.publicScheme "https") (eq $port 443)) -}}
{{- printf "%s://%s" $g.publicScheme .host -}}
{{- else -}}
{{- printf "%s://%s:%d" $g.publicScheme .host $port -}}
{{- end -}}
{{- end }}

{{/*
Stable generated secret value (plaintext; pipe to b64enc).
Args: dict root, namespace (CANONICAL namespace for this secret), secret, key, length, prefix (optional).
Resolution order:
  1. memoised value from earlier in this render, so copies of one secret in several
     namespaces get the SAME value (each copy passes the same canonical namespace);
  2. the value already stored in the cluster (lookup), so upgrades never rotate credentials;
  3. a new random value.
Note: lookup returns nothing under `helm template` / `--dry-run`, so rendered output then
shows fresh random values; real installs and upgrades reuse stored ones.
*/}}
{{- define "urumi.generatedValue" -}}
{{- $root := .root -}}
{{- if not (hasKey $root.Values "__generated") -}}
{{- $_ := set $root.Values "__generated" (dict) -}}
{{- end -}}
{{- $memo := get $root.Values "__generated" -}}
{{- $memoKey := printf "%s/%s/%s" .namespace .secret .key -}}
{{- if hasKey $memo $memoKey -}}
{{- get $memo $memoKey -}}
{{- else -}}
{{- $value := "" -}}
{{- $existing := lookup "v1" "Secret" .namespace .secret -}}
{{- if and $existing (hasKey $existing "data") (hasKey $existing.data .key) -}}
{{- $value = index $existing.data .key | b64dec -}}
{{- else -}}
{{- $value = printf "%s%s" (default "" .prefix) (randAlphaNum (int .length)) -}}
{{- end -}}
{{- $_ := set $memo $memoKey $value -}}
{{- $value -}}
{{- end -}}
{{- end }}

{{/* Pod-level security context. Args: dict uid, gid. */}}
{{- define "urumi.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .gid }}
fsGroup: {{ .gid }}
fsGroupChangePolicy: OnRootMismatch
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{/* Container-level security context shared by every container. */}}
{{- define "urumi.containerSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop: ["ALL"]
{{- end }}
```

- [ ] **Step 6: Write `charts/urumi-platform/templates/namespaces.yaml`**

```yaml
{{- range $key, $ns := .Values.namespaces }}
---
apiVersion: v1
kind: Namespace
metadata:
  name: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" $ns "component" "namespace") | nindent 4 }}
  annotations:
    # Survive `helm uninstall` so store data (PVCs, Secrets) is never deleted by accident.
    helm.sh/resource-policy: keep
{{- end }}
```

- [ ] **Step 7: Write `charts/urumi-platform/templates/NOTES.txt`** (Task 1.3 adds the store section)

```
Release {{ .Release.Name }} (chart {{ .Chart.Name }}-{{ .Chart.Version }}) is deployed in namespace {{ .Release.Namespace }}.

Namespaces: {{ .Values.namespaces.store }}, {{ .Values.namespaces.mcp }}, {{ .Values.namespaces.gateway }}
```

- [ ] **Step 8: Write `deploy/values-local.yaml`**

```yaml
# Local k3d environment. Only differences from charts/urumi-platform/values.yaml belong here.
# Never put secrets in this file.
global:
  storeHost: store.localhost
  appHost: app.localhost
  publicScheme: http
  publicPort: 80        # change to 8081 if host port 80 is taken (also change deploy/k3d-config.yaml)
```

- [ ] **Step 9: Write `deploy/values-prod.yaml`** (a stub; Phase 5 completes it)

```yaml
# Production-like k3s VPS environment — STUB, completed in Phase 5 (see docs/deployment.md).
# Never put secrets in this file: create the Secrets named below with kubectl first.
global:
  storeHost: store.example.com
  appHost: app.example.com
  publicScheme: https
  publicPort: 443
  tls:
    enabled: true
    clusterIssuer: letsencrypt-prod
secrets:
  existing:
    storeDb: store-db            # must exist in namespace "store"
    storeAdmin: store-admin      # must exist in namespace "store"
    storeWooApi: store-woo-api   # must exist in "store" (and in "mcp" from Phase 2)
```

- [ ] **Step 10: Write `scripts/deploy.ps1`**

```powershell
# Installs or upgrades the whole platform with Helm. Safe to run repeatedly.
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -ValuesFile deploy\values-prod.yaml
[CmdletBinding()]
param(
  [string]$ValuesFile = 'deploy/values-local.yaml',
  [string]$Timeout = '10m'
)
$ErrorActionPreference = 'Stop'

function Stop-WithError([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

foreach ($tool in 'helm', 'kubectl') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Stop-WithError "'$tool' was not found on PATH. Install it (docs/learning/00-setup-log.md) or open a NEW terminal so PATH refreshes."
  }
}

$root = Split-Path -Parent $PSScriptRoot
$chart = Join-Path $root 'charts/urumi-platform'
$valuesPath = if ([System.IO.Path]::IsPathRooted($ValuesFile)) { $ValuesFile } else { Join-Path $root $ValuesFile }
if (-not (Test-Path $valuesPath)) { Stop-WithError "Values file not found: $valuesPath" }

$context = kubectl config current-context
if ($LASTEXITCODE -ne 0) { Stop-WithError 'No current kube context. Run scripts\cluster-up.ps1 first.' }
if ($valuesPath -like '*values-local.yaml' -and $context -ne 'k3d-urumi') {
  Stop-WithError "Refusing to deploy local values to context '$context'. Run: kubectl config use-context k3d-urumi"
}

Write-Host "Deploying release 'urumi' to context '$context' with $valuesPath (timeout $Timeout)..."
helm upgrade --install urumi $chart --namespace urumi-system --create-namespace -f $valuesPath --wait --timeout $Timeout
if ($LASTEXITCODE -ne 0) {
  Stop-WithError 'helm upgrade --install failed. Diagnose with: kubectl get pods -A ; kubectl -n store logs job/store-setup ; see docs/troubleshooting.md'
}
helm status urumi --namespace urumi-system
```

- [ ] **Step 11: Modify `scripts/cluster-up.ps1`.** Insert directly after the `Stop-WithError` function (before `$root = …`):

```powershell
foreach ($tool in 'k3d', 'kubectl') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Stop-WithError "'$tool' was not found on PATH. Install it (docs/learning/00-setup-log.md) or open a NEW terminal so PATH refreshes."
  }
}
```

- [ ] **Step 12: Modify `scripts/setup-hosts.ps1`.**
  - The elevated child must be waited for, and the parent re-checks and reports the result.
  - Keep `$hosts` and `$line` (lines 3–4) unchanged.

  Replace lines 5–10 with:

```powershell
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  if (Select-String -Path $hosts -SimpleMatch $line -Quiet) { Write-Host 'hosts entries already present.'; return }
  Write-Host 'Requesting administrator rights (accept the UAC prompt)...'
  try {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  } catch {
    Write-Host "ERROR: elevation was cancelled or failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
  if (Select-String -Path $hosts -SimpleMatch $line -Quiet) { Write-Host 'hosts entries present.'; exit 0 }
  Write-Host "ERROR: hosts entries were not added. Add this line manually to $hosts : $line" -ForegroundColor Red
  exit 1
}
if (-not (Select-String -Path $hosts -SimpleMatch $line -Quiet)) { Add-Content -Path $hosts -Value "`r`n$line" }
Write-Host 'hosts entries present.'
```

- [ ] **Step 13: Lint and render**

Run (PowerShell, repo root):
```powershell
helm lint charts/urumi-platform -f deploy/values-local.yaml
helm lint charts/urumi-platform -f deploy/values-prod.yaml
helm template urumi charts/urumi-platform -n urumi-system -f deploy/values-local.yaml | Select-String '^kind:'
```
Expected: both lints report `1 chart(s) linted, 0 chart(s) failed`; the template output shows exactly three `kind: Namespace`.

Negative schema check: `helm lint charts/urumi-platform --set global.publicScheme=ftp` must FAIL and mention `publicScheme`.

- [ ] **Step 14: Deploy and verify**

Run: `powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1`
Expected: `STATUS: deployed`. Then:
```powershell
kubectl get ns store mcp gateway --show-labels
kubectl get ns store -o jsonpath='{.metadata.annotations.helm\.sh/resource-policy}'
```
Expected: three namespaces with `app.kubernetes.io/part-of=urumi-platform`; the annotation prints `keep`.

Run `scripts\deploy.ps1` a second time. It must succeed (idempotent) and show `REVISION: 2`. Run `scripts\cluster-up.ps1`; it must still succeed. Run `scripts\setup-hosts.ps1`; it must print `hosts entries already present.` without a UAC prompt.

- [ ] **Step 15: Commit**

```bash
git add charts/urumi-platform deploy/values-local.yaml deploy/values-prod.yaml scripts/deploy.ps1
git commit -m "feat(helm): add platform chart skeleton with helpers, namespaces and values files"
git add scripts/cluster-up.ps1 scripts/setup-hosts.ps1
git commit -m "fix(scripts): check prerequisites and report hosts-file elevation result"
```

---

### Task 1.2: MariaDB StatefulSet (non-root, persistent)

**Files:**
- Modify: `charts/urumi-platform/values.yaml` (append a `mariadb:` block)
- Create: `charts/urumi-platform/templates/store/mariadb.yaml`

**Interfaces:**
- Consumes: the helpers from Task 1.1.
- Produces:
  - Secret `store-db` (ns `store`, keys `root-password`, `password`), unless `secrets.existing.storeDb` is set; name via `default "store-db" .Values.secrets.existing.storeDb`.
  - Headless Service `mariadb` → DNS `mariadb.store.svc.cluster.local:3306`.
  - Database `wordpress`, user `wordpress`.

- [ ] **Step 1: Append to `values.yaml`**

```yaml
mariadb:
  image: mariadb:11.8.9
  database: wordpress
  user: wordpress
  storage: 2Gi
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits: { cpu: 500m, memory: 512Mi }
```

- [ ] **Step 2: Write `templates/store/mariadb.yaml`**

```yaml
{{- $ns := .Values.namespaces.store -}}
{{- $dbSecret := default "store-db" .Values.secrets.existing.storeDb -}}
{{- if not .Values.secrets.existing.storeDb }}
apiVersion: v1
kind: Secret
metadata:
  name: store-db
  namespace: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" "mariadb" "component" "database") | nindent 4 }}
  annotations:
    # Kept on uninstall: the data volume outlives the release and must keep matching passwords.
    helm.sh/resource-policy: keep
type: Opaque
data:
  root-password: {{ include "urumi.generatedValue" (dict "root" $ "namespace" $ns "secret" "store-db" "key" "root-password" "length" 32) | b64enc | quote }}
  password: {{ include "urumi.generatedValue" (dict "root" $ "namespace" $ns "secret" "store-db" "key" "password" "length" 32) | b64enc | quote }}
{{- end }}
---
# Headless Service: gives the StatefulSet pod a stable DNS name (mariadb.store.svc.cluster.local).
apiVersion: v1
kind: Service
metadata:
  name: mariadb
  namespace: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" "mariadb" "component" "database") | nindent 4 }}
spec:
  clusterIP: None
  selector:
    {{- include "urumi.selectorLabels" (dict "root" $ "name" "mariadb") | nindent 4 }}
  ports:
    - name: mysql
      port: 3306
      targetPort: mysql
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mariadb
  namespace: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" "mariadb" "component" "database") | nindent 4 }}
spec:
  serviceName: mariadb
  replicas: 1
  selector:
    matchLabels:
      {{- include "urumi.selectorLabels" (dict "root" $ "name" "mariadb") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "urumi.labels" (dict "root" $ "name" "mariadb" "component" "database") | nindent 8 }}
    spec:
      automountServiceAccountToken: false
      securityContext:
        # The official image supports running as its built-in mysql user (uid 999).
        {{- include "urumi.podSecurityContext" (dict "uid" 999 "gid" 999) | nindent 8 }}
      containers:
        - name: mariadb
          image: {{ .Values.mariadb.image }}
          imagePullPolicy: {{ .Values.global.imagePullPolicy }}
          securityContext:
            {{- include "urumi.containerSecurityContext" . | nindent 12 }}
          env:
            - name: MARIADB_ROOT_PASSWORD
              valueFrom: { secretKeyRef: { name: {{ $dbSecret }}, key: root-password } }
            - name: MARIADB_DATABASE
              value: {{ .Values.mariadb.database | quote }}
            - name: MARIADB_USER
              value: {{ .Values.mariadb.user | quote }}
            - name: MARIADB_PASSWORD
              valueFrom: { secretKeyRef: { name: {{ $dbSecret }}, key: password } }
          ports:
            - name: mysql
              containerPort: 3306
          startupProbe:
            exec: { command: ["healthcheck.sh", "--connect", "--innodb_initialized"] }
            periodSeconds: 5
            timeoutSeconds: 5
            failureThreshold: 60
          readinessProbe:
            exec: { command: ["healthcheck.sh", "--connect", "--innodb_initialized"] }
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          livenessProbe:
            exec: { command: ["healthcheck.sh", "--connect"] }
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 6
          resources:
            {{- toYaml .Values.mariadb.resources | nindent 12 }}
          volumeMounts:
            - name: data
              mountPath: /var/lib/mysql
            - name: run
              mountPath: /run/mysqld
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: run
          emptyDir: {}
        - name: tmp
          emptyDir: {}
  # PVCs created from volumeClaimTemplates are not Helm-managed objects: they survive
  # `helm uninstall` without any annotation and are deleted only manually.
  volumeClaimTemplates:
    - metadata:
        name: data
        labels:
          {{- include "urumi.selectorLabels" (dict "root" $ "name" "mariadb") | nindent 10 }}
      spec:
        accessModes: ["ReadWriteOnce"]
        {{- with .Values.global.storageClass }}
        storageClassName: {{ . }}
        {{- end }}
        resources:
          requests:
            storage: {{ .Values.mariadb.storage }}
```

- [ ] **Step 3: Lint and render.** `helm lint charts/urumi-platform -f deploy/values-local.yaml` gives 0 failed. `helm template … | Select-String 'kind: StatefulSet'` gives 1 match.

- [ ] **Step 4: Deploy and verify that it runs**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
kubectl -n store get sts,pod,pvc,svc
kubectl -n store get pod mariadb-0 -o jsonpath='{.spec.securityContext.runAsUser}'
```
Expected: `mariadb-0` `1/1 Running`; PVC `data-mariadb-0` `Bound`; Service `mariadb` with `CLUSTER-IP None`; runAsUser prints `999`.

**If** the pod crash-loops with a permissions error on `/var/lib/mysql` or `/run/mysqld`, capture `kubectl -n store logs mariadb-0`. Then report DONE_WITH_CONCERNS with the log; do **not** switch to root without the controller's approval.

- [ ] **Step 5: Verify that the data persists across a pod deletion.** Write a marker row, delete the pod, and read it back:

```powershell
$pw = kubectl -n store get secret store-db -o jsonpath='{.data.root-password}'
$pw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($pw))
kubectl -n store exec mariadb-0 -- mariadb -uroot "-p$pw" -e "CREATE TABLE IF NOT EXISTS wordpress.persist_check (id INT PRIMARY KEY); REPLACE INTO wordpress.persist_check VALUES (1);"
kubectl -n store delete pod mariadb-0
kubectl -n store wait --for=condition=Ready pod/mariadb-0 --timeout=180s
kubectl -n store exec mariadb-0 -- mariadb -uroot "-p$pw" -e "SELECT id FROM wordpress.persist_check; DROP TABLE wordpress.persist_check;"
```
Expected: the final command prints `id` / `1`.

- [ ] **Step 6: Verify that the password stays stable across upgrades.** Record `kubectl -n store get secret store-db -o jsonpath='{.data.password}'`, run `scripts\deploy.ps1` again, and read it again. The two values must be identical.

- [ ] **Step 7: Commit**

```bash
git add charts/urumi-platform/values.yaml charts/urumi-platform/templates/store/mariadb.yaml
git commit -m "feat(helm): add non-root MariaDB StatefulSet with persistent volume and probes"
```

---

### Task 1.3: WordPress Deployment, store Secrets and Ingress

**Files:**
- Modify: `charts/urumi-platform/values.yaml` (append a `wordpress:` block), `charts/urumi-platform/templates/NOTES.txt`
- Create: `charts/urumi-platform/templates/store/store-secrets.yaml`, `charts/urumi-platform/templates/store/wordpress.yaml`, `charts/urumi-platform/templates/store/ingress.yaml`

**Interfaces:**
- Consumes: Secret `store-db` and Service `mariadb` (Task 1.2).
- Produces:
  - Secret `store-admin` (key `password`).
  - Secret `store-woo-api` (keys `consumer-key` = `ck_` + 40 chars, `consumer-secret` = `cs_` + 40 chars). Its canonical namespace is `store`; Phase 2 renders a copy into `mcp` with the same canonical namespace.
  - PVC `wordpress-data`.
  - Service `wordpress` → `wordpress.store.svc.cluster.local:80`.
  - Ingress host `{{ .Values.global.storeHost }}`.
  - WordPress home URL = `include "urumi.publicUrl" (dict "root" $ "host" .Values.global.storeHost)`.

- [ ] **Step 1: Append to `values.yaml`**

```yaml
wordpress:
  image: wordpress:7.1.3-php8.3-apache
  tablePrefix: wp_
  storage: 2Gi
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits: { cpu: "1", memory: 512Mi }
```

- [ ] **Step 2: Write `templates/store/store-secrets.yaml`**

```yaml
{{- $ns := .Values.namespaces.store -}}
{{- if not .Values.secrets.existing.storeAdmin }}
apiVersion: v1
kind: Secret
metadata:
  name: store-admin
  namespace: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" "wordpress" "component" "store") | nindent 4 }}
  annotations:
    helm.sh/resource-policy: keep
type: Opaque
data:
  password: {{ include "urumi.generatedValue" (dict "root" $ "namespace" $ns "secret" "store-admin" "key" "password" "length" 24) | b64enc | quote }}
{{- end }}
{{- if not .Values.secrets.existing.storeWooApi }}
---
# WooCommerce REST API key used by the WooCommerce MCP server (Phase 2).
# Canonical namespace: store. Phase 2 renders a copy into the mcp namespace by calling
# urumi.generatedValue with the SAME canonical namespace, so both copies match.
apiVersion: v1
kind: Secret
metadata:
  name: store-woo-api
  namespace: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" "wordpress" "component" "store") | nindent 4 }}
  annotations:
    helm.sh/resource-policy: keep
type: Opaque
data:
  consumer-key: {{ include "urumi.generatedValue" (dict "root" $ "namespace" $ns "secret" "store-woo-api" "key" "consumer-key" "length" 40 "prefix" "ck_") | b64enc | quote }}
  consumer-secret: {{ include "urumi.generatedValue" (dict "root" $ "namespace" $ns "secret" "store-woo-api" "key" "consumer-secret" "length" 40 "prefix" "cs_") | b64enc | quote }}
{{- end }}
```

- [ ] **Step 3: Write `templates/store/wordpress.yaml`**

```yaml
{{- $ns := .Values.namespaces.store -}}
{{- $dbSecret := default "store-db" .Values.secrets.existing.storeDb -}}
{{- $storeUrl := include "urumi.publicUrl" (dict "root" $ "host" .Values.global.storeHost) -}}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: wordpress-data
  namespace: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" "wordpress" "component" "store") | nindent 4 }}
  annotations:
    # A standalone PVC IS Helm-managed, so it needs "keep" to survive `helm uninstall`.
    helm.sh/resource-policy: keep
spec:
  accessModes: ["ReadWriteOnce"]
  {{- with .Values.global.storageClass }}
  storageClassName: {{ . }}
  {{- end }}
  resources:
    requests:
      storage: {{ .Values.wordpress.storage }}
---
apiVersion: v1
kind: Service
metadata:
  name: wordpress
  namespace: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" "wordpress" "component" "store") | nindent 4 }}
spec:
  selector:
    {{- include "urumi.selectorLabels" (dict "root" $ "name" "wordpress") | nindent 4 }}
  ports:
    - name: http
      port: 80
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wordpress
  namespace: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" "wordpress" "component" "store") | nindent 4 }}
spec:
  replicas: 1
  # ReadWriteOnce volume: the old pod must stop before the new one mounts it.
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "urumi.selectorLabels" (dict "root" $ "name" "wordpress") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "urumi.labels" (dict "root" $ "name" "wordpress" "component" "store") | nindent 8 }}
    spec:
      automountServiceAccountToken: false
      securityContext:
        # Run as www-data (uid 33) instead of root. Binding port 80 as non-root is allowed by
        # this namespaced "safe" sysctl, so no capabilities are needed.
        {{- include "urumi.podSecurityContext" (dict "uid" 33 "gid" 33) | nindent 8 }}
        sysctls:
          - name: net.ipv4.ip_unprivileged_port_start
            value: "0"
      containers:
        - name: wordpress
          image: {{ .Values.wordpress.image }}
          imagePullPolicy: {{ .Values.global.imagePullPolicy }}
          securityContext:
            {{- include "urumi.containerSecurityContext" . | nindent 12 }}
          env:
            - name: WORDPRESS_DB_HOST
              value: "mariadb.{{ $ns }}.svc.cluster.local:3306"
            - name: WORDPRESS_DB_NAME
              value: {{ .Values.mariadb.database | quote }}
            - name: WORDPRESS_DB_USER
              value: {{ .Values.mariadb.user | quote }}
            - name: WORDPRESS_DB_PASSWORD
              valueFrom: { secretKeyRef: { name: {{ $dbSecret }}, key: password } }
            - name: WORDPRESS_TABLE_PREFIX
              value: {{ .Values.wordpress.tablePrefix | quote }}
            - name: WORDPRESS_CONFIG_EXTRA
              value: |
                define('WP_HOME', '{{ $storeUrl }}');
                define('WP_SITEURL', '{{ $storeUrl }}');
                define('DISALLOW_FILE_EDIT', true);
                define('FS_METHOD', 'direct');
          ports:
            - name: http
              containerPort: 80
          # wp-login.php exercises PHP + the database; before installation it answers 302 (success).
          startupProbe:
            httpGet: { path: /wp-login.php, port: http }
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 30
          readinessProbe:
            httpGet: { path: /wp-login.php, port: http }
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet: { path: /wp-login.php, port: http }
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 6
          resources:
            {{- toYaml .Values.wordpress.resources | nindent 12 }}
          volumeMounts:
            - name: data
              mountPath: /var/www/html
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: wordpress-data
        - name: tmp
          emptyDir: {}
```

- [ ] **Step 4: Write `templates/store/ingress.yaml`**

```yaml
{{- $ns := .Values.namespaces.store -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: store
  namespace: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" "wordpress" "component" "store") | nindent 4 }}
  {{- if and .Values.global.tls.enabled .Values.global.tls.clusterIssuer }}
  annotations:
    cert-manager.io/cluster-issuer: {{ .Values.global.tls.clusterIssuer }}
  {{- end }}
spec:
  ingressClassName: {{ .Values.global.ingressClassName }}
  {{- if .Values.global.tls.enabled }}
  tls:
    - hosts: [{{ .Values.global.storeHost | quote }}]
      secretName: {{ printf "%s-store" .Values.global.tls.secretNamePrefix }}
  {{- end }}
  rules:
    - host: {{ .Values.global.storeHost | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: wordpress
                port:
                  name: http
```

- [ ] **Step 5: Extend `NOTES.txt`.** Append:

```
Storefront:  {{ include "urumi.publicUrl" (dict "root" $ "host" .Values.global.storeHost) }}
Store admin: {{ include "urumi.publicUrl" (dict "root" $ "host" .Values.global.storeHost) }}/wp-admin   (user: {{ (.Values.storeSetup | default dict).adminUser | default "admin" }})

Admin password (PowerShell):
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((kubectl -n {{ .Values.namespaces.store }} get secret {{ default "store-admin" .Values.secrets.existing.storeAdmin }} -o jsonpath='{.data.password}')))

Store setup log:
  kubectl -n {{ .Values.namespaces.store }} logs job/store-setup
```

(`.Values.storeSetup` is added in Task 1.4. The `(… | default dict)` guard keeps this task renderable before then.)

- [ ] **Step 6: Lint, render, deploy**

```powershell
helm lint charts/urumi-platform -f deploy/values-local.yaml
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
kubectl -n store get deploy,pod,pvc,svc,ingress
kubectl -n store get pod -l app.kubernetes.io/name=wordpress -o jsonpath='{.items[0].spec.securityContext.runAsUser}'
curl.exe -s -o NUL -w "%{http_code}`n" http://store.localhost/wp-admin/install.php
```
Expected:
- The WordPress pod is `1/1 Running`.
- PVC `wordpress-data` is `Bound`.
- The Ingress `store` has host `store.localhost`.
- runAsUser prints `33`.
- The curl prints `200` (the install page, since WordPress isn't installed until Task 1.4).

**If** Apache fails to bind port 80 or WordPress can't write `/var/www/html`, capture the logs and report DONE_WITH_CONCERNS. The approved fallback is to run as root (uid 0) with `capabilities.add: [NET_BIND_SERVICE, SETUID, SETGID, CHOWN, DAC_OVERRIDE, FOWNER]` and no sysctl, which is a documented exception. Use it only with the controller's approval.

- [ ] **Step 7: Verify that the Secrets stay stable across upgrades.** Record the `store-woo-api` `consumer-key` and the `store-admin` `password`, redeploy, and confirm both are unchanged.

- [ ] **Step 8: Commit**

```bash
git add charts/urumi-platform
git commit -m "feat(helm): add non-root WordPress deployment, store secrets and store ingress"
```

---

### Task 1.4: Store setup Job (WP-CLI hook), OAuth1 REST check, hook-ordering verification

**Files:**
- Modify: `charts/urumi-platform/values.yaml` (append a `storeSetup:` block)
- Create: `charts/urumi-platform/files/store-setup/setup.sh`, `charts/urumi-platform/files/store-setup/upsert-api-key.php`, `charts/urumi-platform/templates/store/store-setup.yaml`, `scripts/dev/woo-oauth-check.mjs`, `scripts/check-woo-api.ps1`
- Modify: `docs/decisions/ADR-005-woocommerce-rest-oauth1.md` (exact filename: see `docs/decisions/`), finalising it with the spike result

**Interfaces:**
- Consumes: Secrets `store-db`, `store-admin`, `store-woo-api`; PVC `wordpress-data`; Services `mariadb`, `wordpress`.
- Produces for Phase 2:
  - A working WooCommerce REST v3 API at `http://wordpress.store.svc.cluster.local/wp-json/wc/v3/`. It is authenticated by OAuth 1.0a (HMAC-SHA256) whose **signature base URL** is `http://<storeHost>[:port]` + path (always `http`, because in-cluster requests are not TLS, and WooCommerce rebuilds the base URL from `get_home_url()`, not from the Host header).
  - `scripts/dev/woo-oauth-check.mjs` exports `signOAuth1Url({ method, requestUrl, signingBaseUrl, consumerKey, consumerSecret, nonce?, timestamp? })` → a full URL string with oauth params. It's a reference implementation for Phase 2's `signOAuth1`.

- [ ] **Step 1: Append to `values.yaml`**

```yaml
storeSetup:
  enabled: true
  image: wordpress:cli-2.12.0-php8.3
  woocommerceVersion: "11.2.1"
  siteTitle: Urumi Demo Store
  adminUser: admin
  adminEmail: admin@example.com
  currency: USD
  country: "US:CA"
  timezone: Asia/Kolkata
  seedProducts: true
  # Must be shorter than deploy.ps1's --timeout (10m) so a stuck Job fails the release with a clear reason.
  activeDeadlineSeconds: 480
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits: { cpu: "1", memory: 768Mi }
```

- [ ] **Step 2: Write `files/store-setup/setup.sh`** (LF line endings; POSIX sh, because the image is Alpine)

```sh
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
$WP option update woocommerce_task_list_hidden yes
$WP option update woocommerce_onboarding_profile '{"skipped":true}' --format=json
$WP option update woocommerce_cod_settings \
  '{"enabled":"yes","title":"Cash on delivery","description":"Pay with cash upon delivery.","instructions":"Pay with cash upon delivery.","enable_for_methods":[],"enable_for_virtual":"yes"}' \
  --format=json

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

log "upserting the WooCommerce REST API key for the MCP server"
$WP eval-file /scripts/upsert-api-key.php

log "SETUP COMPLETE"
```

**If** a WP-CLI step fails with `Allowed memory size … exhausted`, change `WP=` to `WP="php -d memory_limit=512M $(command -v wp) --path=/var/www/html"`, and record this in the report.

- [ ] **Step 3: Write `files/store-setup/upsert-api-key.php`**

```php
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
```

- [ ] **Step 4: Write `templates/store/store-setup.yaml`**

```yaml
{{- if .Values.storeSetup.enabled }}
{{- $ns := .Values.namespaces.store -}}
{{- $dbSecret := default "store-db" .Values.secrets.existing.storeDb -}}
{{- $adminSecret := default "store-admin" .Values.secrets.existing.storeAdmin -}}
{{- $wooSecret := default "store-woo-api" .Values.secrets.existing.storeWooApi -}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: store-setup-scripts
  namespace: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" "store-setup" "component" "store") | nindent 4 }}
data:
  setup.sh: |-
    {{- .Files.Get "files/store-setup/setup.sh" | nindent 4 }}
  upsert-api-key.php: |-
    {{- .Files.Get "files/store-setup/upsert-api-key.php" | nindent 4 }}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: store-setup
  namespace: {{ $ns }}
  labels:
    {{- include "urumi.labels" (dict "root" $ "name" "store-setup" "component" "store") | nindent 4 }}
  annotations:
    # Runs after install/upgrade. With --wait, Helm starts it only after the release's
    # workloads are Ready. The previous Job is deleted right before a new one is created,
    # so its logs stay readable until the next deploy.
    helm.sh/hook: post-install,post-upgrade
    helm.sh/hook-weight: "0"
    helm.sh/hook-delete-policy: before-hook-creation
spec:
  backoffLimit: 3
  activeDeadlineSeconds: {{ .Values.storeSetup.activeDeadlineSeconds }}
  template:
    metadata:
      labels:
        {{- include "urumi.labels" (dict "root" $ "name" "store-setup" "component" "store") | nindent 8 }}
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext:
        # wordpress:cli is Alpine (www-data = uid 82) but the volume is owned by the
        # Debian WordPress image's www-data (uid 33), so run as 33.
        {{- include "urumi.podSecurityContext" (dict "uid" 33 "gid" 33) | nindent 8 }}
      affinity:
        # The WordPress volume is ReadWriteOnce: schedule next to the WordPress pod.
        podAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  {{- include "urumi.selectorLabels" (dict "root" $ "name" "wordpress") | nindent 18 }}
              topologyKey: kubernetes.io/hostname
      containers:
        - name: setup
          image: {{ .Values.storeSetup.image }}
          imagePullPolicy: {{ .Values.global.imagePullPolicy }}
          command: ["sh", "/scripts/setup.sh"]
          workingDir: /var/www/html
          securityContext:
            {{- include "urumi.containerSecurityContext" . | nindent 12 }}
          env:
            - { name: HOME, value: /tmp }
            - { name: WP_CLI_CACHE_DIR, value: /tmp/wp-cli-cache }
            - name: WORDPRESS_DB_HOST
              value: "mariadb.{{ $ns }}.svc.cluster.local:3306"
            - name: WORDPRESS_DB_NAME
              value: {{ .Values.mariadb.database | quote }}
            - name: WORDPRESS_DB_USER
              value: {{ .Values.mariadb.user | quote }}
            - name: WORDPRESS_DB_PASSWORD
              valueFrom: { secretKeyRef: { name: {{ $dbSecret }}, key: password } }
            - name: WORDPRESS_TABLE_PREFIX
              value: {{ .Values.wordpress.tablePrefix | quote }}
            - name: WP_URL
              value: {{ include "urumi.publicUrl" (dict "root" $ "host" .Values.global.storeHost) | quote }}
            - { name: SITE_TITLE, value: {{ .Values.storeSetup.siteTitle | quote }} }
            - { name: ADMIN_USER, value: {{ .Values.storeSetup.adminUser | quote }} }
            - { name: ADMIN_EMAIL, value: {{ .Values.storeSetup.adminEmail | quote }} }
            - name: ADMIN_PASSWORD
              valueFrom: { secretKeyRef: { name: {{ $adminSecret }}, key: password } }
            - { name: WOO_VERSION, value: {{ .Values.storeSetup.woocommerceVersion | quote }} }
            - { name: STORE_CURRENCY, value: {{ .Values.storeSetup.currency | quote }} }
            - { name: STORE_COUNTRY, value: {{ .Values.storeSetup.country | quote }} }
            - { name: STORE_TIMEZONE, value: {{ .Values.storeSetup.timezone | quote }} }
            - { name: SEED_PRODUCTS, value: {{ .Values.storeSetup.seedProducts | quote }} }
            - name: WOO_CONSUMER_KEY
              valueFrom: { secretKeyRef: { name: {{ $wooSecret }}, key: consumer-key } }
            - name: WOO_CONSUMER_SECRET
              valueFrom: { secretKeyRef: { name: {{ $wooSecret }}, key: consumer-secret } }
          resources:
            {{- toYaml .Values.storeSetup.resources | nindent 12 }}
          volumeMounts:
            - { name: data, mountPath: /var/www/html }
            - { name: scripts, mountPath: /scripts, readOnly: true }
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: wordpress-data
        - name: scripts
          configMap:
            name: store-setup-scripts
        - name: tmp
          emptyDir: {}
{{- end }}
```

The `wp-config.php` written by the WordPress image reads DB settings from `WORDPRESS_DB_*` environment variables at runtime. That's why the Job gets the same variables.

- [ ] **Step 5: Lint, then deploy and watch the hook run**

```powershell
helm lint charts/urumi-platform -f deploy/values-local.yaml
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
kubectl -n store get jobs,pods
kubectl -n store logs job/store-setup
```
Expected:
- The deploy succeeds (Helm waited for the Job).
- The Job shows `Complete 1/1`.
- The log ends with `[store-setup] … SETUP COMPLETE`.
- The log shows WooCommerce 11.2.1 installed and three products seeded.

- [ ] **Step 6: Verify the storefront over HTTP**

```powershell
curl.exe -s http://store.localhost/shop/ | Select-String -Pattern 'Urumi Coffee Mug' -Quiet
curl.exe -s -o NUL -w "%{http_code}`n" http://store.localhost/checkout/
curl.exe -s http://store.localhost/wp-json/wc/store/v1/products | Select-String -Pattern 'Urumi T-Shirt' -Quiet
```
Expected: `True`, `200`, `True`. The last call is the public Store API: no auth, and it proves REST routing works.

- [ ] **Step 7: Verify idempotency.** Run `scripts\deploy.ps1` again. Then check:
  - The new `store-setup` log says `WordPress already installed` and `products already present (3); not seeding`, and ends with `SETUP COMPLETE`.
  - The product count is still 3 (count the `"id":` entries in `curl.exe -s http://store.localhost/wp-json/wc/store/v1/products`).

- [ ] **Step 8: Write `scripts/dev/woo-oauth-check.mjs`.** This is a dependency-free Node 24 reference signer and checker, following WooCommerce's `check_oauth_signature`: params are percent-encoded with RFC 3986, sorted by key, joined, then encoded again; the base string is `METHOD&enc(baseUri)&enc(params)`; HMAC key = `consumer_secret + '&'`.

```js
// OAuth 1.0a (one-legged, HMAC-SHA256) signer + checker for the WooCommerce REST API.
// WooCommerce verifies the signature against get_home_url() — the PUBLIC store URL with
// scheme http when the request is not TLS — not against the URL the request was sent to.
// Usage: node scripts/dev/woo-oauth-check.mjs --target http://127.0.0.1:8088 --sign-base http://store.localhost
//        (consumer key/secret come from env WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET)
import { createHmac, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const enc = (s) =>
  encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function signOAuth1Url({ method, requestUrl, signingBaseUrl, consumerKey, consumerSecret, nonce, timestamp }) {
  const target = new URL(requestUrl);
  const signingUrl = new URL(target.pathname, signingBaseUrl); // same path, public host
  const params = {};
  for (const [k, v] of target.searchParams) params[k] = v;
  Object.assign(params, {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
  });
  const normalized = Object.keys(params)
    .map((k) => [enc(k), enc(params[k])])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const baseString = [method.toUpperCase(), enc(signingUrl.origin + signingUrl.pathname), enc(normalized)].join('&');
  const signature = createHmac('sha256', `${consumerSecret}&`).update(baseString).digest('base64');
  const out = new URL(target.origin + target.pathname);
  for (const [k, v] of Object.entries(params)) out.searchParams.set(k, v);
  out.searchParams.set('oauth_signature', signature);
  return out.toString();
}

async function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const target = arg('--target');
  const signBase = arg('--sign-base');
  const { WOO_CONSUMER_KEY: ck, WOO_CONSUMER_SECRET: cs } = process.env;
  if (!target || !signBase || !ck || !cs) {
    console.error('usage: WOO_CONSUMER_KEY=.. WOO_CONSUMER_SECRET=.. node woo-oauth-check.mjs --target <url> --sign-base <url>');
    process.exit(2);
  }
  const path = '/wp-json/wc/v3/products?per_page=5';
  const attempts = [
    ['signed with PUBLIC store URL (expected: 200)', signBase],
    ['signed with the TARGET URL (expected: 401 invalid signature)', target],
  ];
  let ok = true;
  for (const [label, base] of attempts) {
    const url = signOAuth1Url({ method: 'GET', requestUrl: target + path, signingBaseUrl: base, consumerKey: ck, consumerSecret: cs });
    const res = await fetch(url);
    const body = await res.text();
    console.log(`${label}: HTTP ${res.status} ${body.slice(0, 160).replace(/\s+/g, ' ')}`);
    if (base === signBase && res.status !== 200) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 9: Write `scripts/check-woo-api.ps1`.** It reads the key from the cluster, port-forwards the in-cluster Service, and runs the checker. The request goes to `127.0.0.1` but is signed with the public URL, which is exactly the situation the MCP server will be in.

```powershell
# Proves the WooCommerce REST API key works with OAuth1 signing from outside the WordPress pod.
$ErrorActionPreference = 'Stop'
function Stop-WithError([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }
foreach ($tool in 'kubectl', 'node') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-WithError "'$tool' not found on PATH." }
}
$root = Split-Path -Parent $PSScriptRoot
function Get-SecretValue([string]$Name, [string]$Key) {
  $b64 = kubectl -n store get secret $Name -o "jsonpath={.data.$Key}"
  if ($LASTEXITCODE -ne 0 -or -not $b64) { Stop-WithError "Could not read secret $Name/$Key. Is the store deployed?" }
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
}
$env:WOO_CONSUMER_KEY = Get-SecretValue 'store-woo-api' 'consumer-key'
$env:WOO_CONSUMER_SECRET = Get-SecretValue 'store-woo-api' 'consumer-secret'
$storeHost = kubectl -n store get ingress store -o 'jsonpath={.spec.rules[0].host}'
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Ingress store not found.' }

$port = 18088
$pf = Start-Process kubectl -ArgumentList "-n store port-forward svc/wordpress ${port}:80" -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 3
  node (Join-Path $root 'scripts/dev/woo-oauth-check.mjs') --target "http://127.0.0.1:$port" --sign-base "http://$storeHost"
  $code = $LASTEXITCODE
} finally {
  Stop-Process -Id $pf.Id -Force -ErrorAction SilentlyContinue
  Remove-Item Env:WOO_CONSUMER_KEY, Env:WOO_CONSUMER_SECRET -ErrorAction SilentlyContinue
}
if ($code -ne 0) { Stop-WithError 'Signed request with the public store URL did not return 200. See docs/troubleshooting.md.' }
Write-Host 'WooCommerce REST API key works (OAuth1, signed with the public store URL).'
```

(The signing base is the public store URL with its scheme replaced by `http`; when `publicPort` isn't the default, WP_HOME carries the port and `--sign-base` must include it. Note this limitation in the script comment and in the docs; local default 80 doesn't need it.)

- [ ] **Step 10: Run the spike**

Run: `powershell -ExecutionPolicy Bypass -File scripts\check-woo-api.ps1`
Expected:
- The public-URL attempt returns `HTTP 200 [{"id":…` (product JSON).
- The target-URL attempt returns `HTTP 401 {"code":"woocommerce_rest_authentication_error","message":"Invalid signature - provided signature does not match."…` (or similar).
- The script prints the success line.

**If** the public-URL attempt also fails, capture both outputs and report DONE_WITH_CONCERNS. The documented fallback (application passwords) needs controller approval.

- [ ] **Step 11: Verify the hook ordering on Helm 4.3.1.** From the Step 5 deploy, compare timestamps:

```powershell
kubectl -n store get pod -l app.kubernetes.io/name=wordpress -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].lastTransitionTime}'
kubectl -n store get job store-setup -o jsonpath='{.status.startTime}'
```
Record both. The expectation is that the Job starts after WordPress became Ready (on the first install; on upgrades WordPress may already have been Ready). Record the observation in the report. It's documented in Task 1.5.

- [ ] **Step 12: Finalise ADR-005.**
  - Set Status to **Accepted (2026-10-18, Phase 1 spike)**.
  - Record what was verified: OAuth1 HMAC-SHA256 works against the in-cluster Service when the signature base URL is the public store URL with `http`, and signing with the request URL fails with 401.
  - Record why: WooCommerce's `check_oauth_signature` rebuilds the base URI with `get_home_url(null, $path, is_ssl() ? 'https' : 'http')`.
  - Record the consequence for Phase 2: `WooClient` gets a separate `signingBaseUrl`.
  - Record the non-default-port note.

- [ ] **Step 13: Commit**

```bash
git add charts/urumi-platform
git commit -m "feat(store): automate WordPress/WooCommerce install, COD and REST key via WP-CLI hook job"
git add scripts/dev/woo-oauth-check.mjs scripts/check-woo-api.ps1
git commit -m "feat(scripts): add OAuth1-signed WooCommerce REST API check"
git add docs/decisions
git commit -m "docs: accept ADR-005 after verifying OAuth1 signing against the public store URL"
```

---

### Task 1.5: Lifecycle verification and Phase 1 documentation

**Files:**
- Create: `docs/workflows.md`, `docs/deployment.md`, `docs/troubleshooting.md`
- Modify:
  - `docs/decisions/ADR-003-*.md`: keep on Secrets; `volumeClaimTemplates` PVCs aren't Helm-managed; memoised canonical-namespace secret generation.
  - `docs/decisions/ADR-004-*.md`: MariaDB non-root 999, WordPress non-root 33 via sysctl; cite spec §8.5.
  - `docs/superpowers/specs/2026-10-18-mcp-gateway-design.md`: §5.1 (non-root, no shipping, coming-soon off, signing URL), §5.2 (signing base URL), §8.4 (canonical namespace, keep), §8.5 (security contexts), §13 (OAuth risk resolved).
  - `docs/superpowers/plans/2026-10-18-mcp-gateway-implementation-plan.md`: Global Constraints security-context line; tick the Phase 1 carry-forward checkboxes that are resolved.
  - `docs/architecture.md`: status banner and the store component status → built in Phase 1.
  - `docs/learning/01-kubernetes-primer.md`: step 6 (Traefik routes to the Service's endpoints directly, not through the ClusterIP); store-related "(planned)" markers → now real, with the exact commands.
  - `docs/README.md`: the status column.

**Interfaces:** none (docs and verification only).

- [ ] **Step 1: Uninstall/reinstall lifecycle test.** This proves the `keep` design: data and credentials survive, and the reinstall adopts the kept objects.

```powershell
helm uninstall urumi -n urumi-system
kubectl get ns store
kubectl -n store get secret store-db,store-admin,store-woo-api
kubectl -n store get pvc
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
kubectl -n store logs job/store-setup
powershell -ExecutionPolicy Bypass -File scripts\check-woo-api.ps1
```
Expected:
- After uninstall: namespace `store` still exists, all three Secrets still exist, and PVCs `data-mariadb-0` and `wordpress-data` are still `Bound`. The Deployment and StatefulSet are gone.
- Reinstall: `STATUS: deployed`, and the setup log says `WordPress already installed` and `products already present`.
- The REST check passes.

**If** reinstall fails with an ownership/adoption error on a kept object, capture it and report DONE_WITH_CONCERNS (don't delete data to work around it).

- [ ] **Step 2: Write `docs/workflows.md`.** Start with a status note (only the store workflows exist as of Phase 1). Cover:
  - **"Store install (helm → hook Job)":**
    - A Mermaid sequence diagram: deploy.ps1 → Helm → API server → MariaDB/WordPress Ready → post-install hook Job → WP-CLI steps → SETUP COMPLETE.
    - The decision points: already installed? WooCommerce version matches? products exist?
    - The failure table: what fails, how it's detected, what the user sees.
  - **"Shopper checkout (COD)":**
    - A Mermaid sequence diagram: browser → Traefik → WordPress → MariaDB, then the order appears in wp-admin.
    - Failure behavior.
  - **"WooCommerce REST access (OAuth1)":**
    - A sequence diagram showing the signing base URL vs the target URL.
    - Why it's that way.
  - **Each workflow** gets the CLAUDE.md §4 failure/recovery items: retries (Job `backoffLimit: 3`), timeouts (`activeDeadlineSeconds: 480` < Helm `10m`), duplicates prevented by idempotent checks, and logs (`kubectl -n store logs job/store-setup`).

- [ ] **Step 3: Write `docs/deployment.md`.** The "Local (k3d)" section is beginner-sequential:
  1. `cluster-up.ps1`
  2. `setup-hosts.ps1`
  3. `deploy.ps1`
  4. Expected output.
  5. Get the admin password (PowerShell one-liner).
  6. Open the URLs.
  7. Upgrade (`deploy.ps1` again).
  8. Roll back (`helm history urumi -n urumi-system`, `helm rollback urumi <rev> -n urumi-system --wait`).
  9. Uninstall: what's kept, and how to delete data for real: `kubectl delete ns store mcp gateway` (**destroys all data**).
  10. Port 8081 alternative: `publicPort` + k3d config.

  Add a "Production (k3s VPS)" heading marked **(planned — Phase 5)**, with one line pointing at `deploy/values-prod.yaml`.

- [ ] **Step 4: Write `docs/troubleshooting.md`.** Each entry has a symptom, the diagnosis command, and the fix:
  - port 80 in use
  - `helm`/`k3d` not found (new terminal or PATH)
  - "Refusing to deploy local values to context …"
  - PVC `Pending`
  - MariaDB `CrashLoopBackOff` (permissions / leftover data with a different password: explain the `keep` Secret relationship)
  - WordPress `0/1` startup probe failing
  - `store-setup` Job failed (`kubectl -n store logs job/store-setup`, `kubectl -n store describe job store-setup`; WooCommerce download needs internet; memory limit)
  - Helm `--wait` timeout
  - storefront shows "coming soon"
  - checkout says no payment/shipping methods
  - `check-woo-api.ps1` gives 401 (signing base URL, clock skew > 15 min)
  - `store.localhost` not resolving in Node tools (run `setup-hosts.ps1`)

- [ ] **Step 5: Apply the ADR/spec/plan/architecture/primer/README updates** listed under Files. Every change must describe what was **actually built and verified** in Tasks 1.1–1.4, including the Task 1.4 Step 11 hook-ordering observation. Tick the resolved Phase 1 carry-forward checkboxes in the master plan, with a short "→ Task 1.x" pointer.

- [ ] **Step 6: Link check.** Run a scripted check that every relative Markdown link in `docs/` and `README.md` resolves, and include its output in the report.

- [ ] **Step 7: Commit**

```bash
git add docs/workflows.md docs/deployment.md docs/troubleshooting.md
git commit -m "docs: document store workflows, local deployment and troubleshooting"
git add docs
git commit -m "docs: align spec, ADRs, plan and primer with the built store chart"
```

---

## Phase 1 exit check (the user runs it; listed again in the final summary)
1. `kubectl -n store get pods,pvc,ingress`: mariadb-0 and wordpress Running; both PVCs Bound; ingress `store.localhost`.
2. Open `http://store.localhost`, add a product to the cart, check out with **Cash on delivery** as a guest.
3. Log into `http://store.localhost/wp-admin` (user `admin`; password from the NOTES one-liner) → WooCommerce → Orders: the order is listed.
4. `kubectl -n store delete pod -l app.kubernetes.io/name=wordpress` and `kubectl -n store delete pod mariadb-0`. After both are Running again, the order is still there.
5. `scripts\check-woo-api.ps1` prints the success line.

## Carry-forward mapping (master plan → this plan)

| Carry-forward Phase 1 item | Resolved in |
|---|---|
| Cross-namespace generated Secrets diverge | 1.1 `urumi.generatedValue` (memo + canonical lookup); used in 1.2–1.3; Phase 2 reuses it for the `mcp` copy |
| `keep` on Secrets, not just PVCs | 1.2/1.3 annotations; 1.5 lifecycle test; ADR-003 update |
| Security contexts break WordPress/MariaDB | 1.2 (MariaDB uid 999), 1.3 (WordPress uid 33 + sysctl), 1.4 (Job uid 33, waits for wp-config.php); spec §8.5 + ADR-004 in 1.5 |
| `--wait` + hooks on Helm 4.3.1; Job deadline < timeout | 1.4 Step 11 observation; `activeDeadlineSeconds: 480` |
| OAuth1 signing URL | 1.4 Steps 8–12 (spike + ADR-005) |
| 8081 / `publicPort` | 1.1 `global.publicPort` + `urumi.publicUrl` |
| `setup-hosts.ps1` feedback; prerequisite checks | 1.1 Steps 10–12 |
| No `npm test` in Phase 1 | Global Constraints |

## Self-review
- **Spec coverage:** §5.1 store resources → 1.2–1.4; Ingress → 1.3; Secrets §8.4 (store part) → 1.2–1.3; §8.5 probes/resources/security → 1.2–1.4; §8.2 storage → 1.2–1.3; the local domain approach → 1.1 and 1.5 docs.
- **Interface consistency:**
  - Secret key names `root-password`, `password`, `consumer-key`, `consumer-secret` are used identically in 1.2, 1.3 and 1.4 and in the `values-prod.yaml` comments.
  - Helper names are identical across tasks.
  - `wordpress.store.svc.cluster.local` and `mariadb.store.svc.cluster.local` are consistent.
- **No placeholders:** each fallback is an explicit, controller-approved branch, not a TODO.
