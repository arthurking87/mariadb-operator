# vibe-workflow

Session 起手式、常見陷阱、標準開發工作流。

**自動觸發時機**：session 開始、遇到 cluster / docker / port-forward / image pull 類問題時。

---

## Session 起手式（每次進入專案先跑）

```bash
# 1. 確認 KIND cluster 狀態
kubectl get nodes

# 2. 確認 operator 運作中
kubectl get deploy mariadb-operator -n test1

# 3. 確認 CRDs 已安裝
kubectl get crd | grep mariadb

# 4. 確認 local bin tools
ls bin/   # helm, kind, kubectl, ginkgo, controller-gen, setup-envtest
```

---

## 7 個常見陷阱

1. **image tag 用 dev 版本**
   - `VERSION=26.6.0-dev` 的 image 不存在於公開 registry
   - Helm 安裝時不要 `--set image.tag=$(make version)`，讓 chart 用 `appVersion`（目前 26.3.0）

2. **Helm chart dependency 未打包**
   - `deploy/charts/mariadb-operator/charts/` 目錄不存在時 install 會失敗
   - 先跑 `helm dependency update deploy/charts/mariadb-operator`

3. **Standalone 升 Replication 忘記開 binary log**
   - 原始 standalone 部署沒有 `log_bin`，直接加 `replication.enabled: true` 會讓 replica IO thread 無法啟動
   - 同時 patch `myCnf` 加上 `binlog_format=row` + `log_bin`
   - 因更新順序是 `ReplicasFirstPrimaryLast`，需手動刪 primary pod 打破循環

4. **make gen 忘記跑**
   - 改了 `api/v1alpha1/` 任何檔案後必須 `make gen`
   - CI 的 `artifacts` job 會 diff 檢查，沒跑就直接擋 PR

5. **integration test 需要 live cluster**
   - `make test` 用 envtest，不需 cluster
   - `make test-int` 需要先 `make cluster && make install && make net`
   - `make install-minio` 給 backup 相關的 integration test 用

6. **Replication 與 Galera 的 agent sidecar 版本**
   - Operator chart `appVersion` 決定 agent/init-container image tag
   - 自己 build 的 image 要先 `make docker-dev`（build + kind load）再升 Helm

7. **CRD 超過 900 KB**
   - `make crd-size` 檢查，超過會擋 CI
   - 新增大型 API 欄位時要留意

---

## 標準開發工作流

```
feature branch
    │
    ├─ 1. 修改 api/v1alpha1/  → make gen
    ├─ 2. 修改 pkg/builder/   → 實作 resource 建構邏輯
    ├─ 3. 修改 internal/controller/  → 實作 reconcile 邏輯
    ├─ 4. make lint
    ├─ 5. make test
    ├─ 6. make cluster && make install && make net
    ├─ 7. make run  （本機跑 controller 連 KIND cluster）
    └─ 8. PR → CI 全綠 → merge
```
