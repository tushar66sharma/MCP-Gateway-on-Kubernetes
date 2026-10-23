# ADR-017: Pod Security Admission at `restricted` on the app namespaces

## Status

Accepted. **Implemented in Phase 5, Task 5.4** (2026-10-22).

## Date

2026-10-22

## Context

Every workload already ran as non-root with seccomp `RuntimeDefault`, all capabilities dropped and privilege escalation off, but nothing stopped a future manifest (or a careless `kubectl run`) from creating a privileged or root pod in `store`, `mcp` or `gateway`. Kubernetes' built-in Pod Security Admission (PSA) enforces a Pod Security Standard per namespace from labels, with no extra component. The chart also interpolates `global.storeHost` and `global.appHost` into PHP that WordPress evaluates (`WORDPRESS_CONFIG_EXTRA`), so an unvalidated value could inject code.

## Decision

- The chart's `namespaces.yaml` labels the three namespaces `pod-security.kubernetes.io/enforce`, `warn` and `audit` with `podSecurity.level` (default `restricted`; schema enum `restricted | baseline | privileged`), each with `-version: latest`.
- Non-compliant workloads are fixed, not exempted: no namespace exemptions and no lowered level. Before enforcing, the server-side dry run `kubectl label --dry-run=server` must print no warnings.
- The values schema validates the inputs that reach PHP and the shell: hostnames must be lower-case RFC 1123 names (`^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?(\.[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?)*$` with `maxLength: 253`), the store time zone must match `^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$`, and `tls.enabled` requires `publicScheme: https`. `scripts/validate-chart.ps1` pins these rules.
- Related pod hardening in the same task: every `emptyDir` has a `sizeLimit`, sized per workload (16Mi for the Node pods, the nginx dashboard and the `run` socket dirs; 64Mi Postgres `/tmp`; 128Mi WordPress `/tmp`; 256Mi store-setup `/tmp`, because it downloads the 18 MB WooCommerce zip; 512Mi MariaDB `/tmp`, its tmpdir, because eviction would take the database down); WordPress sets `DISALLOW_FILE_MODS`; MariaDB sets `MARIADB_ROOT_HOST=localhost`; the WordPress liveness probe is a TCP check; the dashboard image uses `worker_processes 2;`.

## Alternatives considered

- **`baseline`.** Rejected: every workload already meets `restricted`, so the weaker level would only leave room for regressions.
- **A policy engine (Kyverno, Gatekeeper).** Rejected for now: another component to run on a small VPS ([ADR-012](ADR-012-deployment-target-k3s-vps.md)); PSA covers the need.
- **`warn` and `audit` only.** Rejected: they report but do not stop a bad pod.
- **A hostname pattern with a length lookahead (`^(?=.{1,253}$)...`).** Not usable: Helm validates schemas with Go's RE2 engine, which has no lookahead (`helm lint` fails with `invalid or unsupported Perl syntax`). The length bound is expressed with `maxLength: 253`, which is equivalent.

## Consequences/trade-offs

- Verified (2026-10-22, k3d, k3s v1.35.5): the dry run printed no warnings; after `up.ps1 -Redeploy` all pods were 1/1 and the namespaces showed the six labels; `kubectl run psa-test` was refused; the NetworkPolicy probe script, `check-gateway.ps1 -Write`, `check-dashboard.ps1`, `check-mcp-woocommerce.ps1` and `check-woo-api.ps1` passed.
- **Any new pod in these namespaces must comply**, including test pods; the error is `forbidden: violates PodSecurity` ([troubleshooting](../troubleshooting.md#forbidden-violates-podsecurity)).
- The namespaces are Helm-owned with `helm.sh/resource-policy: keep`, so changing `podSecurity.level` is applied by `helm upgrade` and survives `helm uninstall`.
- `DISALLOW_FILE_MODS` means plugins and themes change only through the store-setup Job and the image tag ([deployment](../deployment.md)).
- Not tested: a brand-new cluster installed under `restricted` (Task 5.8).

## Revisit if

- A workload needs a capability `restricted` forbids (for example a service mesh sidecar or a CSI driver).
- Kubernetes adds checks to `restricted:latest` that an existing pod fails (`warn` will show it).
