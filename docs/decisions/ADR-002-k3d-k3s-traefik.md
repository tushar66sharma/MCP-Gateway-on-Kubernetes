# ADR-002: k3d locally, k3s in production, Traefik ingress

## Status

Accepted

## Date

2026-10-18

## Context

The assignment requires a local Kubernetes cluster and a deployment path to a VPS using the same Helm chart, with ingress giving stable URLs and a documented local-domain approach. The development machine runs Windows with Docker Desktop (WSL2), 12 CPUs and 15 GB RAM, so the local cluster must be light. We also need an ingress controller, and the widely used `ingress-nginx` is being retired upstream.

## Decision

- **Local:** k3d (5.9.0 installed in Phase 0), which runs k3s (v1.35.5) nodes inside Docker. The Phase 0 cluster is up.
- **Production-like:** k3s installed directly on a single VPS.
- **Ingress:** Traefik, which is bundled with both k3s and k3d. Local and production therefore use the same ingress class and differ only by values files.
- **Local hostnames:** `store.localhost` and `app.localhost`. Browsers resolve `*.localhost` to loopback automatically; Windows/Node-based MCP clients need hosts-file entries, which `scripts/setup-hosts.ps1` adds. k3d maps host port 80 to the cluster load balancer (fallback: 8081, because 8080 is already taken on the dev machine).
- **Production DNS:** real A records pointing at the VPS IP, with optional TLS through cert-manager and Let's Encrypt.

## Alternatives considered

- **ingress-nginx.** Avoided because it is being retired upstream, and it would be an extra component to install on both clusters.
- **kind or minikube locally.** Not chosen: they do not run the same distribution as k3s in production. k3d gives the same k3s, Traefik, `local-path` StorageClass and NetworkPolicy controller locally and on the VPS, which is what makes "only values files differ" credible.
- **Full upstream Kubernetes (kubeadm) on the VPS.** Heavier to install and run on a small single-node machine for no benefit to this project.

## Consequences/trade-offs

- Dev/prod parity for ingress, storage and NetworkPolicy enforcement (k3s uses its embedded kube-router controller); this is still to be verified by the NetworkPolicy checks in a later phase.
- We depend on what k3s bundles; if we need features Traefik lacks, we would be adding a controller ourselves.
- `*.localhost` removes the need for hosts edits in browsers only; non-browser MCP clients still need the hosts file.
- Port 80 may be busy, so URLs can carry `:8081`, which also affects `PUBLIC_APP_URL`.

## Revisit if

- k3s stops bundling Traefik, or Traefik loses support for the Ingress features we use.
- Production moves to a managed Kubernetes service where the ingress class is not Traefik.
