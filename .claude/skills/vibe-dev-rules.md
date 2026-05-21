# vibe-dev-rules

12 條開發規範 + Top 4 違反熱點。

**自動觸發時機**：commit / push / refactor / 新增 API 欄位前。

---

## 12 條開發規範

### API / CRD
1. **新欄位加 `// +optional` 與 kubebuilder marker**：非必填欄位必須標 `// +optional`，否則 webhook validation 會擋。
2. **Immutable 欄位用 `webhook:"inmutable"` 或 `webhook:"inmutableinit"`**：已建立的 instance 不應能改的欄位（如 storage class、bootstrap source）要加 marker，webhook 會自動攔截。
3. **改完 `api/v1alpha1/` 必跑 `make gen`**：DeepCopy、CRD YAML、RBAC marker 全靠 controller-gen 產生。

### Controller
4. **Reconcile 邏輯拆成 `reconcilePhase`**：每個獨立步驟包成 `reconcilePhaseMariaDB{Name, Reconcile}`，不要把所有邏輯塞進單一函式。
5. **Resource 建構走 `pkg/builder/`**：不要在 controller 裡直接建 k8s object，統一走 `Builder` struct。
6. **Status condition 用 `pkg/condition/`**：不要手刻 `metav1.Condition`，用現有的 `condition.Ready`、`condition.GaleraReady` 等 helper。
7. **跨資源 Secret/ConfigMap 解析走 `pkg/refresolver/`**：從 CRD spec 拿 SecretKeySelector 值要走 RefResolver，不要直接 `client.Get`。

### 測試
8. **Unit test 用 Ginkgo + Gomega**：`Describe` / `It` / `Expect`，測試檔放在與被測檔同 package。
9. **Integration test 加 Label**：`Label("basic")` 給核心路徑，`Label("flaky")` + `FlakeAttempts(3)` 給非確定性測試。
10. **Webhook test 不需 live cluster**：`internal/webhook/` 的測試跑在 envtest，不需啟動 KIND。

### Git / CI
11. **不直接 commit 進 `main`**：所有變更走 PR，branch 名稱用 `feature/`、`fix/`、`release/` 前綴。
12. **Commit message 用 Conventional Commits**：`feat(replication): ...`、`fix(galera): ...`，第一行 ≤72 字。

---

## Top 4 違反熱點

| 熱點 | 症狀 | 解法 |
|---|---|---|
| 忘記 `make gen` | CI `artifacts` job 失敗，diff 有 generated 檔變動 | 改完 `api/` 立刻 `make gen` 並 commit |
| Reconcile 函式過長 | `gocyclo` lint 報 complexity > 22 | 拆 `reconcilePhase` 或抽 sub-reconciler |
| 直接在 controller 建 k8s object | Builder 測試無法覆蓋到，邏輯分散 | 移到 `pkg/builder/` 對應的 `_builder.go` |
| Branch 沒加 `feature/fix/release` 前綴 | CI integration test 只跑 `test-int-basic`，漏掉完整測試 | rename branch 加前綴再 push |
