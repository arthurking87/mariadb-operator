# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Build
```bash
make build                  # Build binary to bin/mariadb-operator
make docker-build           # Build Docker image
make docker-dev             # Build and load image into KIND cluster
```

### Generate (run before committing)
```bash
make gen                    # Generate CRDs, RBAC, DeepCopy, Helm chart, docs, examples
make manifests              # Generate CRDs/RBAC/webhook manifests only
make code                   # Generate DeepCopy methods only
```

### Lint
```bash
make lint                   # Run golangci-lint
```

### Tests
```bash
make test                   # Unit tests (api/, pkg/, internal/helmtest/, internal/webhook/)
make test-int               # Integration tests (requires KIND cluster + make install + make net)
make test-int-basic         # Integration tests with label 'basic' only (faster)
make test-api               # API unit tests only
make test-pkg               # pkg unit tests only
make test-webhook           # Webhook unit tests only
make test-helm              # Helm unit tests only
```

To run a specific test by name, pass `--focus` via `TEST_ARGS`:
```bash
make TEST_ARGS="--focus='should default'" test-int
```

### Local Development
```bash
make cluster                # Create KIND cluster
make install                # Install CRDs and dependencies
make net                    # Set up network (MetalLB for LoadBalancer IPs)
make run                    # Run controller from host (requires cluster + install + net)
```

### Dependencies
```bash
make install-prometheus     # Install Prometheus Operator
make install-cert-manager   # Install cert-manager
make install-minio          # Install MinIO (needed for backup integration tests)
make install-azurite        # Install Azure Blob storage emulator
```

### UI (Management Dashboard)

The `ui/` directory contains a React + Vite frontend with an Express backend for managing MariaDB instances via the operator.

**Prerequisites:** Node.js ≥ 18, a running KIND cluster (`make cluster`), and the operator installed (`make install`).

```bash
make ui-install             # Install npm dependencies (run once after cloning)
make ui-dev                 # Start both API server (port 3001) and Vite dev server (port 5173)
make ui-stop                # Stop the background API server
```

Or use the bundled script directly:
```bash
cd ui && ./start.sh         # Equivalent to make ui-dev
```

Open `http://localhost:5173` in your browser.

**API server logs** are written to `/tmp/mariadb-ui-server.log`.

The backend calls `kubectl` and `helm` from the host machine, so the cluster must be reachable (`kubectl get nodes` works) before starting the UI.

### PMM Server (Percona Monitoring and Management)

PMM server can be installed via the Percona Helm chart repo (not vendored in this repo):

```bash
helm repo add percona https://percona.github.io/percona-helm-charts/
helm repo update percona
helm install pmm-server percona/pmm --namespace <namespace>
```

Defaults use a `NodePort` Service (`monitoring-service`) and the cluster's default StorageClass for the `pmm-storage` PVC — no extra `--set` flags needed on a KIND cluster with a default StorageClass.

Get the URL and admin password after install:
```bash
export NODE_PORT=$(kubectl get --namespace <namespace> -o jsonpath="{.spec.ports[0].nodePort}" services monitoring-service)
export NODE_IP=$(kubectl get nodes -o jsonpath="{.items[0].status.addresses[0].address}")
echo https://$NODE_IP:$NODE_PORT

export ADMIN_PASS=$(kubectl get secret pmm-secret --namespace <namespace> -o jsonpath='{.data.PMM_ADMIN_PASSWORD}' | base64 --decode)
```

## Contributing workflow

### Branch model

- **Never commit directly to `main`**. All changes go through a pull request.
- Use a **fork-and-PR** workflow: fork the repo, work on a branch in your fork, open a PR to `mariadb-operator/mariadb-operator`.
- Branch names follow the pattern `<type>/<short-description>`, e.g. `feature/galera-tls`, `fix/replication-failover`, `release/v26.7.0`. Lowercase letters and hyphens only.
- The recognised type prefixes are **`feature`**, **`fix`**, and **`release`** — the CI explicitly detects these to decide test scope (see below).

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
```
<type>(<optional scope>): <short imperative summary>
```
Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`. Keep the first line under ~72 characters.

### CI requirements (all must pass before merging)

The CI pipeline (`.github/workflows/ci.yml`) runs these jobs on every PR:

| Job | What it checks |
|-----|---------------|
| `lint` | `golangci-lint` — same as `make lint` |
| `typos` | Spell-check on `api/`, `cmd/`, `internal/`, `pkg/` via `typos` |
| `build` | `make build` + `make docker-build` |
| `unit-test` | `make test` (unit + webhook + helm tests) |
| `integration-test` | `make test-int-basic` for most PRs; full `make test-int` for `feature/*`, `fix/*`, `release/*` branches and direct pushes to `main` |
| `artifacts` | `make gen` + diff check — fails if generated files are stale |
| `crd-size` | CRD bundle must stay under 900 KB |

**The `artifacts` job is the most common reason for CI failures.** Always run `make gen` after touching `api/v1alpha1/` and commit the results.

### Before opening a PR checklist

1. `make gen` — regenerate if you touched `api/v1alpha1/`
2. `make lint` — fix any lint errors
3. `make test` — all unit tests pass
4. Spell-check passes (CI uses `typos` against source files)
5. PR title follows Conventional Commits format
6. Reference the related GitHub issue with `Fixes #<number>` or `Closes #<number>` in the PR description

## Architecture

This is a Kubernetes operator for MariaDB built with [kubebuilder](https://book.kubebuilder.io/) / controller-runtime. It ships as a **single binary** (`cmd/controller/`) with multiple subcommands: `controller`, `webhook`, `cert-controller`, `init`, `agent`, `backup`, and `pitr`.

### Package layout

**`api/v1alpha1/`** — CRD type definitions. Each resource has a `_types.go` file (spec/status structs with kubebuilder markers) and a `_keys.go` file (label/annotation key constants). The `zz_generated.deepcopy.go` file is generated — do not edit it.

**`internal/controller/`** — Top-level reconcilers, one per CRD kind (e.g. `mariadb_controller.go`, `backup_controller.go`, `maxscale_controller.go`). The MariaDB controller is split across several files: `mariadb_controller_init.go`, `mariadb_controller_replication_*.go`, `mariadb_controller_galera*.go`, `mariadb_controller_tls.go`, etc. All controller tests use [Ginkgo](https://onsi.github.io/ginkgo/) + [Gomega](https://onsi.github.io/gomega/) with `envtest` for unit tests or a live KIND cluster for integration tests.

**`internal/webhook/v1alpha1/`** — Validating/defaulting webhooks for each CRD. Webhook tests run under `envtest` (no live cluster needed).

**`internal/helmtest/`** — Helm chart unit tests using Ginkgo (no cluster needed).

**`pkg/builder/`** — The `Builder` struct and its methods construct Kubernetes resources (StatefulSet, Service, ConfigMap, Secret, etc.) from CRD specs. All resource construction lives here; controllers call builder methods rather than constructing resources directly.

**`pkg/controller/`** — Sub-reconcilers consumed by `internal/controller/`. Each sub-directory handles a specific concern: `galera/` (Galera clustering), `replication/` (async replication), `secret/`, `service/`, `statefulset/`, `deployment/`, `configmap/`, `pvc/`, `rbac/`, `auth/`, `certificate/`, `endpoints/`, `servicemonitor/`, `sql/`, `batch/`.

**`pkg/agent/`** — An HTTP server that runs as a sidecar or init container inside MariaDB pods. It exposes APIs for Galera SST configuration, replication setup, and cluster state management. The agent code is invoked via the `agent` subcommand (`cmd/agent/`).

**`pkg/condition/`** — Helpers to set standard Kubernetes status conditions on CRDs (Ready, Initialized, GaleraReady, etc.).

**`pkg/refresolver/`** — Resolves cross-resource references from CRD spec fields (e.g. SecretKeySelector, ConfigMapKeySelector) into actual values.

**`cmd/backup/`** and **`cmd/pitr/`** — CLI subcommands for running backup/restore and point-in-time recovery jobs (these run inside Kubernetes Jobs, not as a long-running controller).

**`cmd/init/`** — Init container subcommand for MariaDB pod initialization (Galera SST prep, config generation).

**`deploy/charts/`** — Helm charts: `mariadb-operator` (the operator itself), `mariadb-operator-crds` (CRDs only), `mariadb-cluster` (example cluster).

### Reconciliation pattern

Controllers compose multiple `reconcilePhase` structs, each with a name and a reconcile function. `MariaDBReconciler` holds references to all sub-reconcilers from `pkg/controller/` and delegates to them during the main `Reconcile` loop. Status conditions are updated via `pkg/condition/` and patched at the end of reconciliation.

### Code generation

After modifying any file in `api/v1alpha1/` (types, markers, or validation), always run `make gen` to regenerate CRDs, RBAC rules, DeepCopy implementations, and Helm chart templates. CI enforces this — commits will fail if generated files are out of sync.

### Test labels

Integration tests are tagged with Ginkgo labels:
- `basic` — core reconciliation tests; run with `make test-int-basic`
- `flaky` — tests marked with `FlakeAttempts(3)` for inherently non-deterministic behaviour

## Skill 體系

Vibe 專案內建 **三個本地 skills**（`.claude/skills/`），在對應情境自動觸發：

- **`vibe-workflow`** — session 起手式、7 個常見陷阱、標準開發工作流（session 開始或遇到 FUSE / docker / port-forward 類問題時自動觸發）
- **`vibe-dev-rules`** — 12 條開發規範 + Top 4 違反熱點（commit / push / refactor 前自動觸發）
- **`vibe-playbook-nav`** — 任務→Playbook 章節路由（涉及 K8s / docker / release / conf.d / benchmark / E2E 時自動觸發）

環境層 skills（`docx` / `pptx` / `xlsx` / `pdf` / `engineering:*` / `data:*` / `design:*` / `marketing:*` 等）**Claude 可自主判斷使用**，不需逐次徵詢：

- **預設行為**：判斷任務符合 skill 定義時直接讀 SKILL.md 並執行
- **告知方式**：使用前單行說明（例：「跑 `engineering:debug` 的 reproduce 步驟」）
- **多 skill 組合**：一個任務常需多 skill 協作，自主串接
- **新工具發現**：發現該裝但沒裝的 skill，用 `mcp__plugins__search_plugins` / `mcp__mcp-registry__search_mcp_registry` 主動尋找 + 建議