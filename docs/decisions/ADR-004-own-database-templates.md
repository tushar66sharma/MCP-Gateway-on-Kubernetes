# ADR-004: Own MariaDB/Postgres templates instead of Bitnami charts

## Status

Accepted

## Date

2026-10-18

## Context

The platform needs two databases: MariaDB for WordPress/WooCommerce and Postgres for the gateway. Both need persistent storage, secrets, probes, resource limits and NetworkPolicy coverage, all inside our single chart (ADR-003). Bitnami charts were the usual shortcut for this, but Bitnami reduced its free container catalog in 2025, so depending on them for a project that must stay free and reproducible is a risk.

## Decision

We write our own small templates inside `charts/urumi-platform`:

- **MariaDB:** a `StatefulSet` (1 replica) using the official `mariadb:11.8.9` LTS image, a PVC from `volumeClaimTemplates`, passwords from Secret `store-db`, and probes using the image's `healthcheck.sh`. **Runs as non-root uid/gid 999** (the image's built-in `mysql` user).
- **WordPress:** a `Deployment` (1 replica, `Recreate`) using the official `wordpress:7.1.3-php8.3-apache` image, with a PVC at `/var/www/html`. **Runs as non-root uid/gid 33 (`www-data`)** with the pod sysctl `net.ipv4.ip_unprivileged_port_start=0` and a `copy-wordpress` initContainer (details below).
- **Postgres:** a `StatefulSet` with a PVC for the gateway, probed with `pg_isready` **(planned, Phase 3)**.

Resource requests/limits, security contexts and NetworkPolicies are set directly in these templates, like every other workload. The security contexts follow [spec §8.5](../superpowers/specs/2026-10-18-mcp-gateway-design.md): `runAsNonRoot`, explicit uid/gid/fsGroup, `seccompProfile: RuntimeDefault`, `allowPrivilegeEscalation: false`, all capabilities dropped.

### How the official images run as non-root (built and verified in Phase 1)

The original draft of this ADR assumed both images need root and listed that as a hardening exception. Phase 1 disproved that for the store:

- **Port 80 without root.** Apache's default port is 80, and binding a port below 1024 normally needs root or `NET_BIND_SERVICE`. Kubernetes allows the namespaced "safe" sysctl `net.ipv4.ip_unprivileged_port_start`; setting it to `0` on the WordPress pod lets uid 33 bind port 80 with no capabilities.
- **The `copy-wordpress` initContainer.** The official image's entrypoint copies `/usr/src/wordpress` onto `/var/www/html` with `tar`, which also `chmod`s the target directory. On a fresh PVC the volume root is owned by root, so a non-root user cannot `chmod` it and the container crashes on first start. The initContainer (same image, uid 33) copies the files first with `cp -R` (which never changes the root directory's mode). The entrypoint then sees `index.php`, skips its own copy, and still writes `wp-config.php`. It does nothing on later starts (`WordPress files present`). Verified on a truly fresh volume: the WordPress pod had 0 restarts.
- **`WP_HOME`/`WP_SITEURL` via `WORDPRESS_CONFIG_EXTRA`.** The image's `wp-config.php` contains `if ($configExtra = getenv_docker('WORDPRESS_CONFIG_EXTRA', '')) { eval($configExtra); }`, so the value is read from the pod environment at every start, not baked into the file when it was first generated. Changing `global.publicPort` and redeploying therefore updates the constants without touching the volume (verified by reading `wp-config.php` in the running pod).
- **The setup Job** uses the Alpine-based `wordpress:cli-2.12.0-php8.3` image (its `www-data` is uid 82) but runs as uid/gid 33 so it can read and write the volume the Debian WordPress image populated.
- `readOnlyRootFilesystem` is not required for MariaDB, WordPress or WP-CLI; `/tmp` and `/run/mysqld` are `emptyDir`s.

## Alternatives considered

- **Bitnami MariaDB / PostgreSQL / WordPress charts as subcharts.** Rejected: Bitnami's reduced free catalog makes the images and chart long-term availability uncertain; the charts also bring many options we do not need and own a values layout that would sit awkwardly inside one chart.
- **Database operators.** Not chosen: they add controllers and CRDs to a small single-node cluster, and the assignment does not need replication or failover.
- **A managed database outside the cluster.** Not chosen: the assignment wants the store running in Kubernetes with persistent storage, and the same chart must work locally with no cloud account.

## Consequences/trade-offs

- We control every field (probes, limits, securityContext, labels for NetworkPolicy selectors) and use only official upstream images.
- We take on maintenance Bitnami would otherwise do: image tag bumps, upgrade notes, and any initialisation logic.
- No built-in replication, backup or HA. One replica with a PVC is a documented limitation, appropriate for the demo scale.
- Both store images run as non-root; there is no root exception for the store. The cost is the extra moving parts above (sysctl, initContainer) that must be kept working across image upgrades. NetworkPolicies (Phase 5) are defense in depth, not a compensation.
- The MariaDB and WordPress templates exist and are verified (`charts/urumi-platform/templates/store/mariadb.yaml`, `wordpress.yaml`). The Postgres template is built in Phase 3.
- `volumeClaimTemplates` are immutable: changing `mariadb.storage` after the first install makes `helm upgrade` fail with a forbidden StatefulSet update. Set the size before the first install (see [troubleshooting](../troubleshooting.md)).
- The WordPress liveness probe uses `/wp-login.php`, which needs the database. A database outage longer than about 2 minutes (6 failures x 20 s) restarts WordPress. Accepted trade-off: the restart is harmless and recovers on its own.

## Revisit if

- We need HA, automated backups or point-in-time recovery (then evaluate an operator or a managed database).
- The upstream official images change their startup or healthcheck contract (for example, if the WordPress entrypoint stops copying files when `index.php` already exists, the `copy-wordpress` initContainer must be revisited).
