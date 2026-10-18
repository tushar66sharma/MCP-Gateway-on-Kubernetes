# ADR-012: Deployment target is k3s on a VPS, not Vercel/Render; validated by rendering only

## Status

Accepted

## Date

2026-10-18

## Context

CLAUDE.md section 6 asks us to design for free-tier hosting such as Vercel or Render. The assignment, however, requires that everything runs in Kubernetes and is deployable to a k3s VPS with the same Helm chart. Vercel and Render cannot host that: neither gives us a Kubernetes cluster, and the store needs stateful MariaDB and WordPress with persistent volumes, plus NetworkPolicies and a Helm release. The assignment requirement is the binding one, so the CLAUDE.md suggestion conflicts and is not followed.

The project owner currently has no VPS, so an actual production deployment is not possible.

## Decision

- The production target is **k3s on a single VPS**, installed from the same chart with `deploy/values-prod.yaml` (real DNS A records, optional cert-manager TLS, pre-created `existingSecret` names, pinned `ghcr.io` image tags, `secure` cookies).
- A free option for the owner is an always-free cloud VM such as **Oracle Cloud Always Free**. It requires card verification and may have no capacity available in a region, so it cannot be promised.
- Because no VPS is available, production is **documented and validated by rendering only**: `helm lint`, `helm template` and `kubeconform` on `values-prod.yaml`, optionally a second local k3d cluster. We do not claim a real deployment was performed.

## Alternatives considered

- **Vercel or Render for the whole stack.** Rejected: no Kubernetes, no suitable stateful workloads with volumes, and not what the assignment asks for.
- **Vercel/Render for the dashboard only, cluster for the rest.** Rejected: it would split the deployment, break "one Helm chart", and add CORS and cross-origin cookie complexity (the dashboard talks to `/api` on the same origin).
- **A managed Kubernetes service.** Rejected as the default: not free in general, and k3s on a VPS matches the local k3d setup (ADR-002).
- **Pretending validation equals deployment.** Rejected: the documentation must state exactly what was verified.

## Consequences/trade-offs

- Local and production share one chart and differ only by values; rendering catches schema and templating errors, but not real-cluster issues: DNS, TLS issuance, resource pressure, image pulls or kernel/NetworkPolicy behaviour on the VPS.
- The deployment guide (`docs/deployment.md`) is written for a beginner, but its VPS steps stay unexecuted and must be labelled as such. Free-tier limits of Oracle Cloud Always Free (and any alternative) must be re-verified from official documentation when a guide is written.
- If an always-free VM is obtained later, the documented steps can be run and corrected.
- The dashboard and MCP are not hosted on the free serverless platforms CLAUDE.md names; this deviation is intentional.

## Revisit if

- The owner gets a VPS (then deploy and record the actual results, superseding the "render-validated only" part).
- The assignment drops the Kubernetes/k3s requirement.
