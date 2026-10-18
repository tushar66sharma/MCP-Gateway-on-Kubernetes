{{/* Never render .Values with toYaml: during rendering .Values.__generated holds generated secrets. */}}
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

{{/* Pod template labels: selector labels + stable descriptive labels. No chart version, so chart
     version bumps do not restart pods. Args: dict root, name, component. */}}
{{- define "urumi.podLabels" -}}
{{ include "urumi.selectorLabels" (dict "root" .root "name" .name) }}
app.kubernetes.io/part-of: urumi-platform
app.kubernetes.io/component: {{ .component }}
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

{{/* Image reference for our own images. Args: dict root, repository, tag (optional). */}}
{{- define "urumi.image" -}}
{{- $g := .root.Values.global -}}
{{- /* An unquoted all-digit tag (e.g. git short SHA 1234567) arrives as a number, and plain toString
     would give "1.234567e+06", so integers go through int64 first. A leading zero cannot be recovered
     (YAML reads 0123456 as octal), so always quote tags; build-images.ps1 does. */ -}}
{{- $raw := default $g.imageTag .tag -}}
{{- $tag := toString $raw -}}
{{- if or (kindIs "float64" $raw) (kindIs "int64" $raw) (kindIs "int" $raw) -}}
{{- if or (lt (float64 $raw) 0.0) (gt (float64 $raw) 1e18) -}}
{{- fail (printf "image tag %v was read as a number YAML cannot keep exactly: quote it in the values file, e.g. imageTag: \"<tag>\"" $raw) -}}
{{- end -}}
{{- $tag = int64 $raw | toString -}}
{{- end -}}
{{- if $g.imageRegistry -}}
{{- printf "%s/%s:%s" $g.imageRegistry .repository $tag -}}
{{- else -}}
{{- printf "%s:%s" .repository $tag -}}
{{- end -}}
{{- end }}

{{/* Base URL WooCommerce signs OAuth1 requests against: the public store URL with scheme forced to http
     (in-cluster calls are never TLS; WooCommerce uses get_home_url(null, $path, 'http')). ADR-005. Args: root. */}}
{{- define "urumi.storeSigningBaseUrl" -}}
{{- $public := include "urumi.publicUrl" (dict "root" . "host" .Values.global.storeHost) -}}
{{- regexReplaceAll "^https?://" $public "http://" -}}
{{- end }}

{{/* data: block of the store-woo-api Secret. Used for BOTH the store and mcp copies so they always match
     (same canonical namespace, length and prefix). Args: root. */}}
{{- define "urumi.storeWooApiData" -}}
consumer-key: {{ include "urumi.generatedValue" (dict "root" . "namespace" .Values.namespaces.store "secret" "store-woo-api" "key" "consumer-key" "length" 40 "prefix" "ck_") | b64enc | quote }}
consumer-secret: {{ include "urumi.generatedValue" (dict "root" . "namespace" .Values.namespaces.store "secret" "store-woo-api" "key" "consumer-secret" "length" 40 "prefix" "cs_") | b64enc | quote }}
{{- end }}
