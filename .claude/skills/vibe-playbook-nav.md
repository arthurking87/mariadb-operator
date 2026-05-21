# vibe-playbook-nav

任務 → 程式碼位置路由。

**自動觸發時機**：涉及 K8s operator 開發、CRD、replication、Galera、backup、Helm chart、E2E 測試時。

---

## 任務路由表

### 新增 / 修改 CRD API
| 步驟 | 位置 |
|---|---|
| 定義 Spec/Status struct | `api/v1alpha1/<resource>_types.go` |
| 新增 label/annotation key 常數 | `api/v1alpha1/<resource>_keys.go` |
| Index（controller 用的 field index） | `api/v1alpha1/<resource>_indexes.go` |
| Defaulting / Validation webhook | `internal/webhook/v1alpha1/<resource>_webhook.go` |
| 產生 CRD + DeepCopy | `make gen` |

### 修改 Reconcile 邏輯
| 資源 | 主 controller 檔 |
|---|---|
| MariaDB | `internal/controller/mariadb_controller.go` + `mariadb_controller_*.go` |
| Backup / Restore | `internal/controller/backup_controller.go` / `restore_controller.go` |
| MaxScale | `internal/controller/maxscale_controller.go` + `maxscale_controller_*.go` |
| PhysicalBackup | `internal/controller/physicalbackup_controller.go` |
| SQL resources (User/Grant/Database/SQLJob) | `internal/controller/{user,grant,database,sqljob}_controller.go` |

### 修改 Kubernetes Resource 建構
| 資源類型 | Builder 檔 |
|---|---|
| StatefulSet | `pkg/builder/statefulset_builder.go` |
| Service / Endpoints | `pkg/builder/service_builder.go` / `endpoints_builder.go` |
| Pod / Container | `pkg/builder/pod_builder.go` / `container_builder.go` |
| Secret / ConfigMap | `pkg/builder/secret_builder.go` / `configmap_builder.go` |
| Deployment | `pkg/builder/deployment_builder.go` |
| Batch (Job) | `pkg/builder/batch_builder.go` |
| RBAC | `pkg/builder/rbac_builder.go` |
| TLS Certificate | `pkg/builder/certificate_builder.go` |

### HA 機制
| 功能 | 位置 |
|---|---|
| Async Replication（設定/failover/switchover） | `pkg/controller/replication/` |
| Galera（recovery/SST/init） | `pkg/controller/galera/` |
| Agent HTTP server（pod 內 sidecar） | `pkg/agent/` → `cmd/agent/` |
| Init container（pod 啟動初始化） | `cmd/init/` |

### Backup / PITR
| 功能 | 位置 |
|---|---|
| Logical backup（mysqldump/S3/Azure） | `pkg/backup/` → `cmd/backup/` |
| Physical backup（Volume Snapshot / Mariabackup） | `internal/controller/physicalbackup_controller*.go` |
| PITR（binlog replay） | `cmd/pitr/` + `pkg/binlog/` |

### Helm Chart
| 任務 | 位置 |
|---|---|
| Operator chart values / templates | `deploy/charts/mariadb-operator/` |
| CRDs-only chart | `deploy/charts/mariadb-operator-crds/` |
| Cluster chart（MariaDB instance） | `deploy/charts/mariadb-cluster/` |
| 更新 chart 後重新產生 | `make helm-crds`（dev build）/ `make gen`（release） |

### 測試
| 測試類型 | 位置 | 需要 cluster？ |
|---|---|---|
| API unit test | `api/v1alpha1/*_test.go` | 否 |
| Builder unit test | `pkg/builder/*_test.go` | 否 |
| Webhook unit test | `internal/webhook/v1alpha1/*_test.go` | 否（envtest）|
| Helm unit test | `internal/helmtest/` | 否（envtest）|
| Controller integration test | `internal/controller/*_test.go` | **是**（KIND）|

### E2E / 手動驗證
```bash
make cluster          # KIND cluster
make install          # CRDs + config + StorageClass
make install-minio    # backup test 用
make install-cert-manager  # TLS test 用
make net              # MetalLB（LoadBalancer IP）
make run              # 本機跑 controller
```
