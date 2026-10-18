# ADR-003: One Helm chart owning three namespaces, `resource-policy: keep`

## Status

Accepted

## Date

2026-10-18

## Context

The platform has three trust zones: `store` (WordPress, MariaDB, setup Job), `mcp` (the three MCP servers) and `gateway` (gateway, dashboard, Postgres). Separate namespaces let NetworkPolicies and Secrets follow those zones. The assignment wants everything installed with one Helm chart, with environments differing only by values. The store holds data (database, uploads) that an accidental `helm uninstall` must not destroy.

## Decision

- A single chart, `charts/urumi-platform` (chart `apiVersion: v2`, so it installs with Helm 4 and Helm 3.x), is installed as **one release** in `urumi-system`:
  `helm upgrade --install urumi charts/urumi-platform -n urumi-system --create-namespace -f deploy/values-local.yaml`
- The chart itself creates and owns the namespaces `store`, `mcp` and `gateway` (`templates/namespaces.yaml`).
- Namespaces and PVCs carry the annotation `helm.sh/resource-policy: keep`, so uninstalling the release leaves them and their data in place.
- Generated secrets use Helm's `lookup` to reuse existing values on upgrade (`randAlphaNum` only on first install). Production can instead reference pre-created Secrets through `existingSecret`.

## Alternatives considered

- **Several charts or an umbrella chart with subcharts.** Rejected: the pieces share Secrets across namespaces (for example the WooCommerce API key is rendered into both `store` and `mcp`) and NetworkPolicies reference each other, so splitting forces version coordination and value duplication without any benefit at this size.
- **Creating namespaces with `--create-namespace` or by hand.** Rejected: the namespaces would not be part of the release, so the chart could not guarantee the labels and policies it needs.
- **Plain manifests or Kustomize overlays.** Rejected: the assignment explicitly asks for Helm, and we need templating for generated secrets and per-environment values.

## Consequences/trade-offs

- One command installs and upgrades the whole platform, and `values-local.yaml` vs `values-prod.yaml` is the only environment switch.
- After `helm uninstall`, namespaces and PVCs remain and must be removed deliberately (data safety over tidiness). Reinstalling over leftover kept resources has to be tested once the chart exists.
- Cross-namespace Secrets are rendered more than once from the same generated value, which needs care in the templates.
- Helm's `lookup` returns nothing under `helm template`, so rendered output shows fresh values; this affects render-only validation (see ADR-012).

## Revisit if

- A component needs an independent release cycle or a different owner.
- The platform grows beyond one cluster or one team.
