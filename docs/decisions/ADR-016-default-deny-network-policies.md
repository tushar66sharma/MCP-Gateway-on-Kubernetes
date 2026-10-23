# ADR-016: Default-deny NetworkPolicies with one explicit allow rule per flow

## Status

Accepted. **Implemented in Phase 5, Task 5.3** (2026-10-22).

## Date

2026-10-22

## Context

Until Phase 4 every pod could connect to every other pod and to the whole internet. `mcp-woocommerce` was reachable from any namespace (protected only by its bearer token), Postgres and MariaDB from any pod, and a compromised or tricked pod could reach node addresses and the cloud metadata address `169.254.169.254`. The platform should still work exactly as before, and the policies must not silently break kubelet probes, DNS, the `store-setup` Job's download, or wp-admin (which makes outbound update checks). k3s ships an embedded NetworkPolicy controller (kube-router), and the local k3d cluster has it enabled.

## Decision

- **Default-deny ingress and egress** (`podSelector: {}`) in each of the namespaces `store`, `mcp` and `gateway`, then one allow policy per flow listed in [security.md, section 15](../security.md#15-networkpolicies-phase-5). A flow without a rule is denied.
- **DNS** to pods labelled `k8s-app=kube-dns` in `kube-system`, UDP and TCP 53, for every pod in the three namespaces.
- **"Internet" egress** (`gateway`, `wordpress`, `store-setup`) is an `ipBlock` of `0.0.0.0/0` **except** `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10` and `127.0.0.0/8`, on ports 443 and 80. In-cluster destinations are reachable only through explicit pod and namespace selectors.
- **Selectors:** Traefik by namespace `kube-system` plus `app.kubernetes.io/name=traefik`; namespaces by `kubernetes.io/metadata.name`; pods by the chart's `app.kubernetes.io/instance` and `app.kubernetes.io/name`; the `store-setup` Job by its own name label.
- **cert-manager HTTP-01 solver** (added in the Phase 5 final review): cert-manager starts its temporary solver pod (`acme.cert-manager.io/http01-solver: "true"`, port 8089) in the Ingress's own namespace, where default-deny would drop Traefik's request and no Let's Encrypt certificate could ever be issued. Policy `acme-http01-solver` (`templates/network/acme-solver.yaml`) admits Traefik to those pods on TCP 8089 in `store`, and in `gateway` when the gateway is enabled. It renders only with `global.tls.enabled` and a `global.tls.clusterIssuer`. The solver needs no egress beyond DNS.
- **wp-cron Jobs** (added in the Phase 5 final review, [ADR-018](ADR-018-wordpress-cron-via-cronjob.md)): egress to MariaDB 3306 and the internet rule; MariaDB admits them.
- Rendered only when `networkPolicies.enabled` (default `true`; schema-validated). Templates live in `charts/urumi-platform/templates/network/`.
- **Tested by a probe script**, `scripts/test-network-policies.ps1`, which runs restricted-Pod-Security-compliant `curlimages/curl:8.22.0` pods with the labels of the pod they impersonate and asserts 13 allowed and blocked flows (blocked = curl exit 7 or 28 with no HTTP code; 12 when first written, the 13th added in the production rehearsal). It refuses any kube context except `k3d-urumi` and `k3d-urumi-prod`.

## Alternatives considered

- **A CNI with richer policy (Cilium, Calico).** Rejected for now: it replaces k3s's default networking, adds a component to run on a single small VPS ([ADR-012](ADR-012-deployment-target-k3s-vps.md)), and nothing here needs L7 or FQDN rules. FQDN-based egress would be tighter than "any public IP on 443" and is the main thing given up.
- **No egress policy, ingress only.** Rejected: egress is what stops a compromised pod from reaching the metadata address, other namespaces and arbitrary hosts. Ingress-only would leave the SSRF-style exposure open.
- **Allow all of `0.0.0.0/0` for the internet rules.** Rejected: it would include pod, service, node and metadata addresses, defeating the in-cluster selectors.
- **Namespace-wide allow rules (any pod in `mcp` may talk to `store`).** Rejected: the matrix is per pod so that, for example, `mcp-notes` cannot reach WordPress.

## Consequences/trade-offs

- Verified (2026-10-22, k3d, k3s v1.35.5): the probe script failed before the policies existed (8 of 12 rows) and passes after (12 of 12; a 13th probe, mcp-woocommerce to WordPress with `X-Forwarded-Proto: https`, was added in the production rehearsal, so the script now runs 13 probes); all pods 1/1 with no restarts, the four check scripts passed, one chat turn reached the LLM, wp-admin and wp-login answered in about 0.06 to 1.1 s, and the `store-setup` Job completed (27 to 35 s) under the policies.
- **New pods are briefly unprotected.** kube-router programs a new pod's rules a few seconds after it starts (3 to 6 s observed); in that window blocked flows are open and allowed flows are cut. Probes in the script therefore wait 10 s before connecting. This is a property of the controller; a CNI that enforces at pod start would remove it.
- **Public-IP egress is broad:** the gateway and WordPress can reach any public host on 80 and 443. The gateway's SSRF guard remains the second layer for admin-added URLs.
- A new in-cluster flow needs a new rule, or it fails with "connection refused" ([troubleshooting](../troubleshooting.md#a-pod-cannot-reach-x-after-phase-5)).
- Hairpin traffic to a node's own public IP (a pod using the public store URL on a VPS) is translated to the Traefik pod IP and dropped by the private-range exclusion (expected; not tested on a VPS). WordPress's scheduled work therefore no longer uses it: it runs from the `wp-cron` CronJob ([ADR-018](ADR-018-wordpress-cron-via-cronjob.md)).
- **The solver policy, verified 2026-10-23 on the local cluster** (a real Let's Encrypt issuance is expected; not tested): the store policy, rendered from the production values and applied by hand, was combined with a stand-in solver pod (`agnhost netexec` on 8089, label `acme.cert-manager.io/http01-solver=true`) and a curl pod in `kube-system` labelled `app.kubernetes.io/name=traefik`. Without the policy the curl was blocked (exit 7). With it the answer was `200`, while an unlabelled `kube-system` pod stayed blocked. After deleting the policy it was blocked again, and after re-applying it was `200` again. All hand-made objects were then deleted. cert-manager v1.21.2's solver pod is already `restricted`-compliant (`runAsNonRoot`, seccomp `RuntimeDefault`, no privilege escalation, drop ALL; `pkg/issuer/acme/http/pod.go`).

## Revisit if

- The cluster moves to a CNI that supports FQDN policies (restrict LLM and external MCP egress to named hosts).
- Another controller or workload is added to the three namespaces (it needs its own allow rules).
- The new-pod enforcement delay matters (for example before running untrusted workloads).

## Addendum (Phase 5b): `gateway.internalUpstreams`

The matrix above allows the gateway to reach only the three built-in MCP servers on 3001-3003, and the SSRF guard accepts only `*.mcp.svc.cluster.local`. An admin who runs another MCP server in the cluster therefore got either `400 SSRF_REJECTED` (other namespace) or an `unreachable` server (`connection refused`, namespace `mcp`). Decision (Task 5b.6): a chart list, empty by default, one entry per server (`namespace`, `port`, optional `podLabels`).

- **What an entry opens, and only that:** the namespace in the gateway's SSRF allow-list (`*.<namespace>.svc.cluster.local`, comma-joined, unique namespaces), a gateway egress rule to that namespace (narrowed to the pods matching `podLabels` when given) on that TCP port, and, when the namespace is the chart's `mcp` namespace, an ingress policy there from the gateway pods on that port.
- **What it does not do:** it does not edit policies in other namespaces (the chart does not own them; the docs tell the operator to admit the gateway there), it does not open a port range, and it does not touch the internet rule or the private-range exclusion. The SSRF guard still refuses loopback and link-local addresses.
- **Why a chart value and not a runtime setting:** the egress policy and the allow-list must change together, and both are deploy-time security boundaries; a dashboard switch would let a stolen admin session widen the network.
- **Default:** `[]`, and the rendered objects are identical to the release before Phase 5b (asserted by `scripts\validate-chart.ps1`).
- **Verified 2026-10-23** on the local cluster with `scripts\dev\test-internal-upstream.ps1`: refused or unreachable before, `connected` with 4 tools after, policy count 16 -> 17 -> 16. Details: [security, section 15](../security.md#15-networkpolicies-phase-5); use: [deployment.md](../deployment.md#registering-mcp-servers-that-run-inside-the-cluster).
