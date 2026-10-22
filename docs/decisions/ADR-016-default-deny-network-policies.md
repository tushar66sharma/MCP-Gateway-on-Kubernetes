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
- Rendered only when `networkPolicies.enabled` (default `true`; schema-validated). Templates live in `charts/urumi-platform/templates/network/`.
- **Tested by a probe script**, `scripts/test-network-policies.ps1`, which runs restricted-Pod-Security-compliant `curlimages/curl:8.22.0` pods with the labels of the pod they impersonate and asserts 12 allowed and blocked flows (blocked = curl exit 7 or 28 with no HTTP code). It refuses any kube context except `k3d-urumi` and `k3d-urumi-prod`.

## Alternatives considered

- **A CNI with richer policy (Cilium, Calico).** Rejected for now: it replaces k3s's default networking, adds a component to run on a single small VPS ([ADR-012](ADR-012-deployment-target-k3s-vps.md)), and nothing here needs L7 or FQDN rules. FQDN-based egress would be tighter than "any public IP on 443" and is the main thing given up.
- **No egress policy, ingress only.** Rejected: egress is what stops a compromised pod from reaching the metadata address, other namespaces and arbitrary hosts. Ingress-only would leave the SSRF-style exposure open.
- **Allow all of `0.0.0.0/0` for the internet rules.** Rejected: it would include pod, service, node and metadata addresses, defeating the in-cluster selectors.
- **Namespace-wide allow rules (any pod in `mcp` may talk to `store`).** Rejected: the matrix is per pod so that, for example, `mcp-notes` cannot reach WordPress.

## Consequences/trade-offs

- Verified (2026-10-22, k3d, k3s v1.35.5): the probe script failed before the policies existed (8 of 12 rows) and passes after (12 of 12); all pods 1/1 with no restarts, the four check scripts passed, one chat turn reached the LLM, wp-admin and wp-login answered in about 0.06 to 1.1 s, and the `store-setup` Job completed (27 to 35 s) under the policies.
- **New pods are briefly unprotected.** kube-router programs a new pod's rules a few seconds after it starts (3 to 6 s observed); in that window blocked flows are open and allowed flows are cut. Probes in the script therefore wait 10 s before connecting. This is a property of the controller; a CNI that enforces at pod start would remove it.
- **Public-IP egress is broad:** the gateway and WordPress can reach any public host on 80 and 443. The gateway's SSRF guard remains the second layer for admin-added URLs.
- A new in-cluster flow needs a new rule, or it fails with "connection refused" ([troubleshooting](../troubleshooting.md#a-pod-cannot-reach-x-after-phase-5)).
- Hairpin traffic to a node's own public IP (a pod using the public store URL on a VPS) is covered by the internet rule only if that IP is public; not tested.

## Revisit if

- The cluster moves to a CNI that supports FQDN policies (restrict LLM and external MCP egress to named hosts).
- Another controller or workload is added to the three namespaces (it needs its own allow rules).
- The new-pod enforcement delay matters (for example before running untrusted workloads).
