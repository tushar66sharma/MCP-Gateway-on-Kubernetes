# ADR-004: Own MariaDB/Postgres templates instead of Bitnami charts

## Status

Accepted

## Date

2026-10-18

## Context

The platform needs two databases: MariaDB for WordPress/WooCommerce and Postgres for the gateway. Both need persistent storage, secrets, probes, resource limits and NetworkPolicy coverage, all inside our single chart (ADR-003). Bitnami charts were the usual shortcut for this, but Bitnami reduced its free container catalog in 2025, so depending on them for a project that must stay free and reproducible is a risk.

## Decision

We write our own small templates inside `charts/urumi-platform`:

- **MariaDB:** a `StatefulSet` (1 replica) using the official `mariadb` LTS image, a PVC from `volumeClaimTemplates`, passwords from Secret `store-db`, and probes using the image's `healthcheck.sh`.
- **WordPress:** a `Deployment` (1 replica, `Recreate`) using the official `wordpress` image, with a PVC at `/var/www/html`.
- **Postgres:** a `StatefulSet` with a PVC for the gateway, probed with `pg_isready`.

Resource requests/limits, security contexts and NetworkPolicies are set directly in these templates, like every other workload.

## Alternatives considered

- **Bitnami MariaDB / PostgreSQL / WordPress charts as subcharts.** Rejected: Bitnami's reduced free catalog makes the images and chart long-term availability uncertain; the charts also bring many options we do not need and own a values layout that would sit awkwardly inside one chart.
- **Database operators.** Not chosen: they add controllers and CRDs to a small single-node cluster, and the assignment does not need replication or failover.
- **A managed database outside the cluster.** Not chosen: the assignment wants the store running in Kubernetes with persistent storage, and the same chart must work locally with no cloud account.

## Consequences/trade-offs

- We control every field (probes, limits, securityContext, labels for NetworkPolicy selectors) and use only official upstream images.
- We take on maintenance Bitnami would otherwise do: image tag bumps, upgrade notes, and any initialisation logic.
- No built-in replication, backup or HA. One replica with a PVC is a documented limitation, appropriate for the demo scale.
- WordPress and MariaDB official images need root at startup; this is a documented hardening exception mitigated by NetworkPolicy (see the spec's security section).
- None of these templates exist yet; they are built in later phases.

## Revisit if

- We need HA, automated backups or point-in-time recovery (then evaluate an operator or a managed database).
- The upstream official images change their startup or healthcheck contract.
