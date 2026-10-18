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
- Namespaces, the standalone `wordpress-data` PVC **and the generated Secrets** (`store-db`, `store-admin`, `store-woo-api`) carry the annotation `helm.sh/resource-policy: keep`, so uninstalling the release leaves them and their data in place. Keeping the Secrets matters as much as keeping the volumes: MariaDB's data directory was initialised with the password in `store-db`; if the Secret were deleted and regenerated, the new password would no longer match the data on the volume and the database would reject WordPress.
- The MariaDB PVC (`data-mariadb-0`) is created by the StatefulSet's `volumeClaimTemplates`. Those PVCs are **not Helm-managed objects**, so Helm never deletes them and they need no annotation; Kubernetes also leaves them when the StatefulSet is deleted. Verified in Task 1.5: after `helm uninstall`, both PVCs stayed `Bound`.
- Generated secrets use the helper `urumi.generatedValue` (`templates/_helpers.tpl`), which resolves a value in this order: (1) a per-render **memo**, so two copies of one secret in the same render get the same value; (2) Helm's `lookup` of the existing Secret in the **canonical namespace** for that secret (so upgrades and reinstalls over kept Secrets reuse the stored value); (3) `randAlphaNum` on first install. Copies in other namespaces (the `mcp` copy of `store-woo-api` in Phase 2) must pass the same canonical namespace (`store`), otherwise each namespace would look up and generate independently and the copies would diverge. Production can instead reference pre-created Secrets through `secrets.existing.*`.

## Alternatives considered

- **Several charts or an umbrella chart with subcharts.** Rejected: the pieces share Secrets across namespaces (for example the WooCommerce API key is rendered into both `store` and `mcp`) and NetworkPolicies reference each other, so splitting forces version coordination and value duplication without any benefit at this size.
- **Creating the `store`, `mcp` and `gateway` namespaces with `--create-namespace` or by hand.** Rejected: those namespaces would not be part of the release, so the chart could not guarantee the labels and policies it needs. Note that the Decision's own command still uses `--create-namespace`, but only for the *release* namespace `urumi-system` (where Helm stores the release record); the three workload namespaces are chart-owned `Namespace` objects in `templates/namespaces.yaml`.
- **Plain manifests or Kustomize overlays.** Rejected: the assignment explicitly asks for Helm, and we need templating for generated secrets and per-environment values.

## Consequences/trade-offs

- One command installs and upgrades the whole platform, and `values-local.yaml` vs `values-prod.yaml` is the only environment switch.
- After `helm uninstall`, namespaces, PVCs and the generated Secrets remain and must be removed deliberately (data safety over tidiness): `kubectl delete ns store mcp gateway` deletes everything, including the data.
- **Reinstall over kept resources, tested in Task 1.5.** `helm uninstall urumi -n urumi-system` printed that the three Namespaces, `wordpress-data` and the three Secrets were kept; `data-mariadb-0` also stayed. A following `scripts\deploy.ps1` reported `STATUS: deployed` (revision 1 of a new release) with no adoption error, because Helm 4.3.1 can adopt objects that already carry the `meta.helm.sh/release-name=urumi` and `meta.helm.sh/release-namespace=urumi-system` annotations. The setup log then said `WordPress already installed` and `products already present (3); not seeding`, and `scripts\check-woo-api.ps1` still returned 200 with the same API key. Limits of that adoption: it works only with the **same release name and namespace**; a namespace created by hand (no Helm ownership annotations) is expected to make the first install fail with "exists and cannot be imported into the current release" (Helm's standard ownership check; this specific failure was not exercised). See [troubleshooting](../troubleshooting.md).
- A truly fresh install (`kubectl delete ns store mcp gateway`, then `scripts\deploy.ps1`) also works: the `local-path` PVs have reclaim policy `Delete`, so they disappear with their PVCs; new credentials are generated (the old Secrets were deleted with the namespace, so `lookup` finds nothing); the setup Job succeeds on its first attempt.
- The `store-setup` hook Job is not part of the release manifest, so `helm uninstall` leaves it (and its pod) behind. It is harmless; the next hook run deletes it first (`before-hook-creation`).
- Cross-namespace Secrets are rendered more than once from the same generated value, which needs care in the templates.
- Helm's `lookup` returns nothing under `helm template`, so rendered output shows fresh values; this affects render-only validation (see ADR-012).

## Revisit if

- A component needs an independent release cycle or a different owner.
- The platform grows beyond one cluster or one team.
