# Local Environment Setup Log

What was installed, why, and how to start, stop and reset the local cluster. Companion to [01-kubernetes-primer.md](01-kubernetes-primer.md).

## Machine

Windows 11 Home, 15 GB RAM, PowerShell 5.1 and Git Bash, Docker Desktop on the WSL2 backend.

## Tools and versions

| Tool | Version | Purpose |
|---|---|---|
| Docker Desktop | 4.85.0 | Runs the Docker Engine on WSL2; k3d runs the whole cluster as Docker containers |
| Docker Engine | 29.6.2 | The engine inside Docker Desktop (what `docker --version` reports) |
| k3d | v5.9.0 | Creates/manages k3s clusters inside Docker |
| k3s (via k3d default image) | v1.35.5-k3s1 (`rancher/k3s:v1.35.5-k3s1`) | Lightweight certified Kubernetes distribution |
| kubectl | v1.36.1 | Command-line client for the Kubernetes API |
| Helm | v4.3.1 | Package manager; installs our single chart |
| WSL | 2.6.2.0 | Linux VM that Docker Desktop uses |

`helm` and `k3d` were installed with `winget`. winget updates the PATH for new terminals only, so an already-open terminal needs a restart (or a PATH refresh) before it can find them.

k3s bundles these by default, so nothing extra was installed: **Traefik** (Ingress controller), **local-path-provisioner** (default StorageClass), **CoreDNS**, **metrics-server**, and the **kube-router** NetworkPolicy controller.

## WSL2 memory cap (`C:\Users\Lenovo\.wslconfig`)

```ini
[wsl2]
memory=9GB
processors=8
swap=4GB
```

Why: without a cap, the WSL2 VM can grow to take about half of RAM or more and rarely gives it back. The machine has 15 GB; Windows, the editor, and the browser need roughly 5-6 GB, so Docker/k3d is limited to 9 GB. The cluster (Traefik, CoreDNS and the other k3s defaults, plus since Phase 1 WordPress and MariaDB; **(planned)** Postgres, the gateway and the MCP servers) must fit in that, which is why every project container has CPU/memory requests and limits (the store's are in the chart; later containers will follow the same rule). `swap=4GB` gives a safety valve against OOM kills at the cost of speed. Changes take effect after `wsl --shutdown` and a Docker Desktop restart. The `.wslconfig` file was written in Task 0.1; Docker Desktop's own settings were not changed.

## Cluster definition

`deploy/k3d-config.yaml`: cluster `urumi`, one server node, zero agents, host ports 80 and 443 mapped to the k3d load balancer. The kube context is `k3d-urumi`.

### Port 8080 conflict

k3d's documentation commonly maps `8080:80`. On this machine host port **8080 is already in use by another process**, so we map the standard ports **80 and 443** instead (both were free). Benefits: URLs have no port (`http://store.localhost`), which also matches how production will look. If port 80 is ever taken, `cluster-up.ps1` fails right away at `k3d cluster create` with a clear error and a non-zero exit code (PowerShell 5.1 does not throw on failing native commands, so the script checks each exit code explicitly); free the port or change the left-hand side of `port: 80:80` to the fallback **8081** (matching [ADR-002](../decisions/ADR-002-k3d-k3s-traefik.md) and spec section 8.3), and then include the port in every URL (for example `http://app.localhost:8081`). 8080 is not used as the fallback because it is already taken on this machine.

## Hosts file (`scripts/setup-hosts.ps1`)

Adds this line to `C:\Windows\System32\drivers\etc\hosts`:

```
127.0.0.1 store.localhost app.localhost hello.localhost
```

Why: browsers and `curl` resolve any `*.localhost` name to loopback by themselves (RFC 6761), so the hosts file is not needed for them. But **Node.js-based MCP clients use the operating system resolver**, and on this machine `node -e "require('dns').lookup('zzz-not-in-hosts.localhost', ...)"` returns `ENOTFOUND`, while a name listed in the hosts file (`hello.localhost`) resolves to `127.0.0.1`. So the hosts entry is required for those clients, and it makes every client behave the same. Editing the hosts file requires administrator rights, so the script re-launches itself elevated (a UAC prompt appears) and only appends the line if it is not already there, so it is safe to run repeatedly. If you change or add Ingress hostnames, add them to this script's line too.

## Daily use

| Goal | Command |
|---|---|
| First time / start after reboot | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cluster-up.ps1` (idempotent: creates the cluster if missing, otherwise starts it, then waits for the node and Traefik) |
| Pause, keeping all data | `k3d cluster stop urumi` |
| Resume | `scripts\cluster-up.ps1` again (or `k3d cluster start urumi`) |
| Wipe everything and start over | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cluster-down.ps1`, then `cluster-up.ps1` |

**`cluster-down.ps1` runs `k3d cluster delete urumi`, which deletes ALL cluster data**: databases, volumes, Secrets, everything deployed. Use `k3d cluster stop` when you only want to free RAM.

Note on timing: k3s installs Traefik asynchronously by running a Helm Job, so right after the node is Ready the `traefik` Deployment may not exist yet. `cluster-up.ps1` polls (up to 300 s) until it appears, then waits for its rollout. Every `k3d`/`kubectl` step is followed by an exit-code check, so a failure (for example a busy port 80) stops the script immediately with an `ERROR:` message and exit code 1 instead of continuing.

## Verification performed

`k3d cluster list`:

```
NAME    SERVERS   AGENTS   LOADBALANCER
urumi   1/1       0/0      true
```

`kubectl get nodes`:

```
NAME                 STATUS   ROLES           AGE    VERSION
k3d-urumi-server-0   Ready    control-plane   112s   v1.35.5+k3s1
```

`kubectl get pods -A`:

```
NAMESPACE     NAME                                      READY   STATUS      RESTARTS   AGE
kube-system   coredns-8db54c48d-j2hcw                   1/1     Running     0          107s
kube-system   helm-install-traefik-clw6q                0/1     Completed   1          104s
kube-system   helm-install-traefik-crd-c4bpm            0/1     Completed   0          104s
kube-system   local-path-provisioner-5d9d9885bc-lrmkj   1/1     Running     0          107s
kube-system   metrics-server-786d997795-5bbfz           1/1     Running     0          107s
kube-system   svclb-traefik-1283def8-hbh7q              2/2     Running     0          73s
kube-system   traefik-9bcdbbd9-tlfmr                    1/1     Running     0          73s
```

Reading it: `helm-install-traefik*` are one-shot Jobs (`Completed` is success; the `1` restart means the first attempt failed and was retried successfully) that installed Traefik. `svclb-traefik` is k3s's tiny pod that makes Traefik's LoadBalancer Service reachable on the node's ports 80/443.

Other facts: default StorageClass `local-path` (`rancher.io/local-path`, `WaitForFirstConsumer`), IngressClass `traefik`.

Hello-world: applying `deploy/examples/hello.yaml` and running `curl.exe -s http://hello.localhost` returned the `traefik/whoami` output (`Hostname: hello-56cc6b98c-...`, `X-Forwarded-For`, `X-Forwarded-Host: hello.localhost`, `X-Forwarded-Server: traefik-...`), proving the full path described in the primer. The example was then deleted with `kubectl delete -f deploy/examples/hello.yaml`. Image `traefik/whoami:v1.10` was confirmed to exist.

A second run of `cluster-up.ps1` on the existing cluster succeeded (it took the `k3d cluster start` branch), confirming idempotency.
