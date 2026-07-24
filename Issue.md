# Issue 追蹤（arthurking87/mariadb-operator fork）

> 產生日期：2026-07-03。只列尚未處理完的 issue（39 個，全部 OPEN）。
> 已關閉的 issue 不列入（含已確認不需修正、修法錯誤被打回、epic 拆分等）。
> A 類 15 個已針對現有程式碼逐一查證（2026-07-03），詳見下方分析。

## 2026-07-22 更新

- **#15 已關閉（2026-07-13，非本次會話）**：PR #95 範圍（`slaveNetTimeout`/`relayLogPurge`/`heartbeatInterval`/`delaySeconds` 全部開放設定）被判定維護面過大，關閉不合併；改開更收斂的 **#97** 作為後續。
- **#97 已查證並開出 PR**：[**#100**](https://github.com/arthurking87/mariadb-operator/pull/100)。三個 knob 逐一對照現況程式碼查證後全部屬實：`server_id` 沒有退路強制計算（對照 `GtidDomainID` 已有 nil-means-server-default 模式）、semi-sync 的 master/slave enabled 綁在一起無法拆開、`innodb_flush_log_at_trx_commit` 完全沒有對應欄位。新增 `AutoServerID`/`SemiSyncMasterEnabled`/`InnodbFlushLogAtTrxCommit` 三個可選欄位，兩個布林 knob 在 CRD 預設值、env var 送出邏輯、`PodEnvironment` getter 三層都刻意預設為 `true`，確保任何一層 defaulting 漏掉時還是退回目前行為（不會靜默弱化 durability 或搞丟 server_id）。現有測試全數不動、輸出逐位元組相同,新增測試涵蓋兩個 knob 關閉時的情境。
- **#23 已關閉（本次會話）**：對應 PR #91（`RevisionHistoryLimit`）評估後認為只是新增一個目前沒有明確需求的可選欄位、並非修復實際錯誤，且 issue 裡 annotation 那部分的訴求本來就查無實據，決定不合併、留言記錄後關閉 issue 與 PR。
- **#64 對應的 PR #65 已完成實機驗證**：在 KIND 叢集（namespace `test1`）上實際部署此分支、建立 3-replica replication 叢集，用「複寫落後到不可能追上」（`PURGE BINARY LOGS` 造成 `Slave_IO_Errno 1236`）的情境觸發 switchover，確認：明確設定 `switchoverTimeout: 30s` 時約 34.7s 後自動中止並回復；不設定時預設值確實是 60s，且約 62s 後自動中止並回復；兩次原 primary 都維持可寫入、無卡死。詳細測試報告已貼在 [PR #65 留言](https://github.com/arthurking87/mariadb-operator/pull/65#issuecomment-5041458537)。這顆信心度大幅提升，建議在 B 類優先合併。
- **#46 已開出 PR**：[**#99**](https://github.com/arthurking87/mariadb-operator/pull/99)。範圍如 A-6 分析所述，鎖定 `mariadb_controller_status.go` 的 `reconcileStatus`／`setUpdatedCondition` 呼叫端，區分 `NotFound`（維持原本沿用零值 `sts` 的行為）跟其他 API 錯誤（現在會 return error 讓該次 reconcile 被 requeue，不再靜默把暫時性錯誤誤判成 `Ready=False`）。新增的單元測試（fake client + `interceptor.Funcs` 模擬非 NotFound 的 Get 失敗）已驗證過：拿掉修法會 FAIL，加回來會 PASS。`go build`／`go vet`／`golangci-lint`／`gofmt` 全部過（本機無 go 工具鏈，改用 golang:1.26.3-alpine3.23 docker image 驗證）。
- 下方 A-1／A-2／B 等區塊的表格內容維持 07-03 當天的原始分析紀錄（含已經過時的部分），未逐條改寫；請以本更新區塊 + 表格旁的即時註記為準。

## 2026-07-24 更新

- **#13、#16、#19、#27、#37、#47 已全數關閉（本次會話）**：查證後判斷都不需要修改，逐一留言記錄關閉理由後關閉。
  - **#13**（多 CRD group 重構）：屬於需要 ADR 的架構決策，評估後判斷目前不需要，關閉不採用。
  - **#16**（predicate trim 物件名稱後綴）：確認是真的缺口，但沒有現成呼叫點會用到，貿然加上去只會變成 dead code，關閉不處理。
  - **#19**（webhook 加 REPLICATION MASTER ADMIN）：查證「webhook 會擋掉此權限」的前提不成立（`grant_webhook.go` 對 Privileges 無白名單檢查），目前也沒有明確需求要擴大 operator 複寫帳號權限集合，關閉不處理。
  - **#27**（replica=1 多餘連線）：查無實據，關閉；已留言請回報者之後若能提供重現方式可重開。
  - **#37**（排程 stop return 邏輯錯誤）：對應功能只存在未合併分支 `fix/issue-38-schedule-check`，main 上不適用，關閉；等 #38 併入 main 後如問題仍在再重開。
  - **#47**（switchover/1+N metrics 錯誤）：`pkg/metrics/` 在 main 上不存在，只存在未合併的 PR #49 分支，關閉；PR #49 合併時會一併檢視。
- 至此，原本列在 A 類「尚未處理」的 15 個 issue 已全部有結論：#8/#10/#11/#46 有對應 PR（#92/#93/#94/#99）、#15→#97→#100 有 PR、#14/#17/#21/#23 已關閉、#13/#16/#19/#27/#37/#47（本次）已關閉。A 類已清空，只剩下方 B 類 24 個「有 PR 待合併」的 issue 需要追蹤。

## 摘要

| 分類 | 數量 |
|------|-----|
| A. 尚未處理（無任何對應 PR） | 15（已查證，見下方細分） |
| B. 已處理，PR 待合併（open issue + 有對應 PR，但 PR 尚未 merge） | 24 |

---

## A. 尚未處理 — 查證結果（沒有任何 PR 對應）

這些 issue 目前是 OPEN，且在所有 PR 的 body/title 裡都找不到任何引用，**完全沒人動過**。
逐一對照現況程式碼查證後，依結論分成四組：

| 分組 | 數量 | 意思 |
|------|-----|------|
| A-1 確認是真的問題，值得直接推進 PR | 6 | #8, #10, #11, #15（部分）, #16, #23（部分） |
| A-2 已被現有程式碼解決/多餘，建議關閉或改寫 issue | 4 | #14, #17, #19, #21 |
| A-3 查無實據，建議先跟回報者要重現步驟 | 1 | #27 |
| A-4 對應的功能目前根本不存在於 main（只活在未合併分支），現階段不適用 | 2 | #37, #47 |
| A-5 需要架構決策、不是普通 PR | 1 | #13 |
| A-6 部分屬實，範圍比原描述窄 | 1 | #46 |

> 注意：這 15 個 issue 的內文都引用了一批 commit hash（例如 `47c3cea`、`5db02cb` 等），經查證（比照 #44 的調查結論）這些 hash 對應不到這個 repo 的實際 commit，是從無關的內部清單帶過來的，**不能當作判斷依據**。以下分析全部基於直接讀現況程式碼。

### A-1. 確認是真的問題，值得直接推進 PR

> **狀態更新（2026-07-03）**：#8、#10、#11、#15、#23 已從 `release` 開分支修好並開出 PR（見下方各項），全部 `make lint`/`make test`（34 suites）通過。#16 依你的決定先跳過，維持未處理狀態。

| Issue | PR |
|---|---|
| #8 | [#92](https://github.com/arthurking87/mariadb-operator/pull/92) |
| #10 | [#93](https://github.com/arthurking87/mariadb-operator/pull/93) |
| #11 | [#94](https://github.com/arthurking87/mariadb-operator/pull/94) |
| #15 | ~~[#95](https://github.com/arthurking87/mariadb-operator/pull/95)~~ — **已關閉不合併（2026-07-13）**，範圍過大；後續改開 [#97](https://github.com/arthurking87/mariadb-operator/issues/97)（尚未查證） |
| #16 | 暫緩（無現成呼叫點，避免產生 dead code） |
| #23 | ~~[#91](https://github.com/arthurking87/mariadb-operator/pull/91)~~ — **issue 與 PR 皆已關閉（2026-07-22）**，判定為非必要的新增欄位，非修復實際錯誤 |

**[#8](https://github.com/arthurking87/mariadb-operator/issues/8) — Sync primary/replica config on every reconcile, not only on switchover**
`pkg/controller/replication/controller.go:255-260` 的 `ReconcileReplicationInPod` 只要 `Status.Replication.Roles[pod]` 已經是 `Replica`/`Primary`，就會直接跳過 `ConfigureReplica`/`ConfigurePrimary`，而這個角色判斷完全來自即時 DB 狀態（`mariadb_controller_status.go:138-169`），跟 `spec.replication` 有沒有變更無關。結論：使用者改了 `connectionRetrySeconds`、`syncTimeout`、`gtid` 等欄位，但角色沒變時，改動會被靜默忽略，要等下一次 switchover/pod 重建才生效。
建議：在 `ReconcileReplicationInPod` 的 gate 旁邊加一個 spec-hash（或 generation）比對，spec 有變就強制重跑 `ConfigurePrimary`/`ConfigureReplica`，不要只看角色。

**[#10](https://github.com/arthurking87/mariadb-operator/issues/10) — Improve leader election ID, ping checks, and lease logic**
`cmd/controller/main.go:220-221` 的 `LeaderElectionID` 目前仍是寫死字串 `"mariadb-operator.mariadb.com"`（`cert_controller.go:77-78` 同樣寫死），沒有 flag/env 可調；`ctrl.Options` 完全沒設定 `LeaseDuration`/`RenewDeadline`/`RetryPeriod`/`LeaderElectionReleaseOnCancel`，全部吃 client-go 預設值；目前唯一的健康檢查（`healthz.Ping`/`readyz.Ping`，main.go:573,577）是通用 boilerplate，跟 leader election 是否持有 lease 完全無關。
（有一個未合併分支 `fix/issue-66-leader-election-id` 已經在處理 ID 可設定化，但還沒進到目前 HEAD。）
建議：補上 `--leader-election-id` flag（依 Helm release name 預設避免同 namespace 多實例衝突）、明確設定 lease 參數、加一個真正檢查 leader lease 健康度的 healthz check。

**[#11](https://github.com/arthurking87/mariadb-operator/issues/11) — Optimize lifecycle hooks and preStop to reduce switchover downtime**
`api/v1alpha1/mariadb_types.go:582-585` 有 `TerminationGracePeriodSeconds` 欄位，但 `SetDefaults`（同檔 589-596）從未給它預設值，不設就吃 k8s 內建的 30 秒。`Lifecycle`/`PreStop` 是完全被動的使用者自訂欄位（`container_builder.go:375-376`），**operator 本身不會自動注入任何 preStop 腳本**。已解決的 #6（`spec.maintenance.drainConnections`）是要手動切維護模式才會跑的 reconcile-loop 機制，跟這裡要的「pod 終止時自動 drain」是不同機制，不算重複。
建議：`SetDefaults` 給 `TerminationGracePeriodSeconds` 一個明確預設值；在使用者沒設定 `Lifecycle` 時，由 builder 合成一個預設 `PreStop` hook（可重用 `drain_connections.go` 現有的 kill-connection 邏輯），使用者自訂時仍保留覆蓋能力。

**[#15](https://github.com/arthurking87/mariadb-operator/issues/15) — Add configurable variables for replication setup（部分屬實）**
`SyncTimeout`、`ConnectionRetrySeconds`、`Gtid`、`GtidStrictMode`、`GtidDomainID`、`SemiSyncEnabled/AckTimeout/WaitPoint`、`SyncBinlog`、`ServerIDStartIndex` 這些其實**已經**在 CRD 裡且會渲染進 my.cnf——issue 描述的情境沒有想像中嚴重。但確認缺少：`slave_net_timeout`、`relay_log_purge`、`MASTER_HEARTBEAT_PERIOD`/`MASTER_DELAY`（`pkg/sql/sql.go:1086-1122` 的 `ChangeMaster` 目前不支援這幾個）。
建議：PR 範圍只鎖定這幾個真的缺的變數，不要重複造已存在的欄位。

**[#16](https://github.com/arthurking87/mariadb-operator/issues/16) — Predicate improvement — trim object name suffixes**
`pkg/predicate/predicate.go`（共 66 行，全讀過）目前只有基於 annotation/label 的過濾（`PredicateWithAnnotations`、`PredicateWithLabel` 等），**完全沒有任何物件名稱比對/trim 邏輯**，也沒有 regex。這是真的、未實作的功能請求，不是誤會。
建議：只在真的需要把 Pod/Service/ConfigMap 名稱對回所屬 MariaDB CR 名稱的地方加一個 `trimKnownSuffix` helper，用獨立 predicate 包起來，不要改到現有 4 個呼叫點的行為。

**[#23](https://github.com/arthurking87/mariadb-operator/issues/23) — Fix StatefulSet RevisionHistoryLimit and annotations（部分屬實）**
`pkg/builder/statefulset_builder.go` 的 MariaDB/MaxScale StatefulSet 建構（106-118, 158-168 行）**完全沒有設定** `RevisionHistoryLimit`，會吃 k8s API 預設值 10，且不開放給 CRD 設定（對照 `certificate_builder.go:118` 有明確設 `ptr.To(int32(10))`）。但 annotation 部分查無實據：`getUpdateAnnotations`（`mariadb_controller_update.go:107-116`）用的是 config 內容的 deterministic hash，是刻意設計、非亂數/時間戳，沒找到會觸發 spurious rollout 的證據。
建議：只在 `statefulset_builder.go` 明確設定 `RevisionHistoryLimit`（可選擇是否開放 CRD 設定），不要動 annotation 機制。

### A-2. 已被現有程式碼解決/多餘，建議關閉或改寫成更明確的新 issue

> **狀態更新（2026-07-03）**：分析留言已貼上，#14、#17、#21 已直接關閉（not planned）；#19 依討論結果留言但不關閉，因為可能藏著「operator 自己的複寫帳號要不要加 REPLICATION MASTER ADMIN」的獨立需求，待你確認。

**[#14](https://github.com/arthurking87/mariadb-operator/issues/14) — Add database grants for metrics and query-exporter accounts — 已關閉**
`internal/controller/mariadb_controller_metrics.go:22-116` 已經完整實作：自動建立 metrics 使用者並 GRANT `SELECT, PROCESS, REPLICATION CLIENT, REPLICA MONITOR, SLAVE MONITOR ON *.*`，涵蓋典型 mysqld_exporter 需求。issue 要的東西已經存在，且這個 repo 沒有獨立的「query-exporter」帳號概念。
建議：直接關閉；若真正要的是「額外的、範圍更小的 SELECT 授權」或不同用途的 exporter 帳號，應該開一個更具體的新 issue。

**[#17](https://github.com/arthurking87/mariadb-operator/issues/17) — MariaDB manual maintenance mode (Hangout) — 已關閉**
`spec.maintenance`（`api/v1alpha1/mariadb_types.go:606-626`）已經有 `Enabled`、`Cordon`、`DrainConnections`、`ReadOnly`，且有專屬的 `MaintenanceReconciler` 跟 `ConditionReasonMaintenance`/`ConditionReasonCordoned` condition reason，範圍比 issue 要求的還完整，同時官方文件註解就寫明「maintenance 不影響正常 reconcile」（跟 `spec.suspend` 的全停不同）。
建議：直接關閉。如果還想要的話，唯一可討論的加強是把 `ConditionReasonMaintenance` 升級成獨立的 `ConditionType`，但不是必要的。

**[#19](https://github.com/arthurking87/mariadb-operator/issues/19) — Webhook improvements — add REPLICATION MASTER ADMIN privilege — 留言待確認，未關閉**
`internal/webhook/v1alpha1/grant_webhook.go:33-71` 對 `Privileges` 完全沒有白名單/enum 檢查，任何字串（包含 `REPLICATION MASTER ADMIN`）都能直接通過並送進 `GRANT`。所以「webhook 會擋掉這個權限」的前提不成立。真正可能缺的是：operator 自己內部管理的複寫使用者（`pkg/controller/replication/user_sql.go:18`，目前只要求 `REPLICATION REPLICA`）如果需要 master-admin 端的操作權限，才需要加。
建議：改寫成更精準的 issue（如果需要的話），鎖定 `user_sql.go` 裡 operator 自己複寫帳號的權限集合，而不是動 webhook 驗證。

**[#21](https://github.com/arthurking87/mariadb-operator/issues/21) — Add next-primary selection strategy validation — 已關閉**
`internal/webhook/v1alpha1/mariadb_webhook.go:182-211` 的 `validateReplication` 已經會在 admission time 檢查 `spec.replication.primary.podIndex` 是否超出 `spec.replicas` 範圍，超出會直接回傳 `field.Invalid`，不是要等到 runtime 才爆炸。
建議：直接關閉，或改寫成更小範圍的加強（例如：`podIndex` 等於目前 primary 時給個 warning，而不是靜默 no-op）。

### A-3. 查無實據，建議先跟回報者要重現步驟

**[#27](https://github.com/arthurking87/mariadb-operator/issues/27) — Extra connection created when replication enabled with replica=1**
檢查了 `replicationPodIndexes`、`waitForReplicaSync`、`connectReplicasToNewPrimary`、`FailoverHandler.findCandidates` 等所有跟 replica 迴圈相關的路徑，`replicas=1` 時這些迴圈都正確地不會多跑一次；所有 SQL client 建立都經過 `sql.ClientSet`（cache-by-index + `Close()`）或有明確的 `defer client.Close()`。找不到任何符合「多餘連線且沒清理」描述的程式碼路徑。
建議：先跟原始回報者要重現方式（例如連線數 metrics、reconcile 前後的 `SHOW PROCESSLIST` 比對），不要先假設 bug 存在就動工。

### A-4. 對應功能目前不存在於 main（只在未合併分支），現階段不適用

**[#37](https://github.com/arthurking87/mariadb-operator/issues/37) — Schedule stop return logic error**
目前檢出的 `main` 完全沒有任何排程/cron 健康檢查元件；相關程式碼只存在一個未合併分支 `fix/issue-38-schedule-check`（`pkg/scheduledcheck/`），而且就算看那個分支，`Runnable.Start` 的 `defer ticker.Stop()` + `select{ctx.Done(): return nil}` 寫法本身也是對的，沒有「提早 return 跳過 cleanup」的問題。
建議：目前不需要動作；等 #38 相關功能真的合併進 main 後再重新檢視。

**[#47](https://github.com/arthurking87/mariadb-operator/issues/47) — Metrics errors — switchover metrics, 1+N metrics, reset metrics**
`pkg/metrics/` 整個目錄在目前 main 上不存在，issue 描述的 switchover metrics 功能（含它描述的雙重計數 bug）只存在於未合併分支（`fix/issue-3-switchover-metrics`／PR #49 系列），且該分支上其實已經有對應的修正 commit（`d5dd5468 fix(#47): stop double-counting switchover metrics and clean up on delete`），修法看起來是對的（用 `PrimarySwitched` condition 的 `LastTransitionTime` 當穩定起點、加上刪除時的 metrics 清理）。
建議：目前不需要單獨動作；等 PR #49 合併時，記得一併帶入它自己的修正 commit，不要只合未修好的中間版本。

### A-5. 需要架構決策，不是普通 PR

**[#13](https://github.com/arthurking87/mariadb-operator/issues/13) — Refactor to support multiple independent CRD groups with separate controllers**
現況：12 種 CRD 全部在同一個 API group（`k8s.mariadb.com`），單一 binary、單一 `manager.Manager`、單一 leader election lock、單一 webhook server/cert，且有大量共用的 reconciler（`secretReconciler`、`rbacReconciler` 等）跨 MariaDB/MaxScale/SqlJob 共用。真的要做「多個獨立 CRD 群組 + 各自 controller」牽涉 API group 拆分（破壞性變更、需要既有 CRD 遷移路徑）、多 manager/多 leader-election/多 webhook cert 的維運複雜度、以及重新決定共用 reconciler 的歸屬。
建議：不要當一般 PR 處理，先寫 ADR/設計文件；如果真的要做，第一步建議先把最獨立的 Backup 家族（Backup/PhysicalBackup/Restore/PointInTimeRecovery）拆出來做原型驗證，而不是一次動全部。

### A-6. 部分屬實，範圍比原描述窄

**[#46](https://github.com/arthurking87/mariadb-operator/issues/46) — Missing edge case handling in reconciliation**
這個 issue 描述很籠統，多數猜測的邊界情況（nil pointer on `CurrentPrimaryPodIndex`、finalizer race、StatefulSet/Pod 數量不一致）逐一查證後都已經有適當的保護，查無實據。但找到一個具體、可驗證的真實缺口：`mariadb_controller_status.go:34-37` 的 `reconcileStatus` 在 `Get` StatefulSet 失敗時，只是把 error `log` 掉，沒有用 `apierrors.IsNotFound` 區分「還沒建立」跟「API 暫時性錯誤」，之後還是直接拿零值的 `sts` 去算 `status.Replicas` 跟餵給 `SetReadyWithMariaDB`——在叢集已經正常運作、只是一次性 API 抖動/informer cache 延遲的情況下，會把健康的叢集誤判成 `Ready=False`（`StatefulSetNotReady`）。`setUpdatedCondition` 的呼叫端（同檔 93 行）也有類似的「只 log 不處理」問題。
建議：PR 範圍鎖定在這兩處——區分 `NotFound`（沿用零值 `sts` 是刻意的，用在還沒建立的階段）跟其他 API 錯誤（應該 return error 讓這個 phase 被 requeue 重試），不要嘗試處理「所有邊界情況」這種籠統範圍。
**狀態更新（2026-07-22）**：已依建議範圍開出 [PR #99](https://github.com/arthurking87/mariadb-operator/pull/99)，OPEN、待審查/合併。

---

## B. 已處理，PR 待合併（issue 仍 OPEN，但已有 PR 在處理）

這些 PR 全部尚未 merge（`state=OPEN`，`mergedAt=null`），只是「有人已經寫了修法」，還沒真正進 `release` 分支：

| Issue # | 標題 | 對應 PR |
|---|------|---------|
| [3](https://github.com/arthurking87/mariadb-operator/issues/3) | Prometheus metrics 系統 | [#49](https://github.com/arthurking87/mariadb-operator/pull/49) |
| [7](https://github.com/arthurking87/mariadb-operator/issues/7) | 異常 crash 後清理 primary pod/連線 | [#89](https://github.com/arthurking87/mariadb-operator/pull/89) |
| [9](https://github.com/arthurking87/mariadb-operator/issues/9) | 刪除 unready primary pod 觸發重建 | [#89](https://github.com/arthurking87/mariadb-operator/pull/89) |
| [24](https://github.com/arthurking87/mariadb-operator/issues/24) | switchover 錯誤處理/READ_ONLY/sleep | [#63](https://github.com/arthurking87/mariadb-operator/pull/63) |
| [28](https://github.com/arthurking87/mariadb-operator/issues/28) | SQL ResetAllSlaves 邏輯錯誤 | [#68](https://github.com/arthurking87/mariadb-operator/pull/68) |
| [29](https://github.com/arthurking87/mariadb-operator/issues/29) | SQL injection | [#52](https://github.com/arthurking87/mariadb-operator/pull/52) |
| [31](https://github.com/arthurking87/mariadb-operator/issues/31) | Flush privileges 順序錯誤 | [#70](https://github.com/arthurking87/mariadb-operator/pull/70) |
| [32](https://github.com/arthurking87/mariadb-operator/issues/32) | waitForMariaDB 邏輯錯誤 | [#62](https://github.com/arthurking87/mariadb-operator/pull/62) |
| [33](https://github.com/arthurking87/mariadb-operator/issues/33) | pod 無法加入 secondary-svc endpoint | [#57](https://github.com/arthurking87/mariadb-operator/pull/57) |
| [34](https://github.com/arthurking87/mariadb-operator/issues/34) | max user connection 未正確套用 | [#69](https://github.com/arthurking87/mariadb-operator/pull/69) |
| [35](https://github.com/arthurking87/mariadb-operator/issues/35) | Golang 編譯錯誤 | [#50](https://github.com/arthurking87/mariadb-operator/pull/50) |
| [38](https://github.com/arthurking87/mariadb-operator/issues/38) | 多 domain ID 排程查詢失敗 | [#71](https://github.com/arthurking87/mariadb-operator/pull/71) |
| [39](https://github.com/arthurking87/mariadb-operator/issues/39) | GTID fetch 回傳錯誤值 | [#56](https://github.com/arthurking87/mariadb-operator/pull/56) |
| [40](https://github.com/arthurking87/mariadb-operator/issues/40) | replication channel 命名缺失 | [#54](https://github.com/arthurking87/mariadb-operator/pull/54) |
| [41](https://github.com/arthurking87/mariadb-operator/issues/41) | StatefulSet 並行更新狀態不一致 | [#59](https://github.com/arthurking87/mariadb-operator/pull/59) |
| [42](https://github.com/arthurking87/mariadb-operator/issues/42) | 卡住 reconciliation 的 bypass pod 機制 | [#90](https://github.com/arthurking87/mariadb-operator/pull/90) |
| [48](https://github.com/arthurking87/mariadb-operator/issues/48) | database/grant/user controller 通用修正 | [#61](https://github.com/arthurking87/mariadb-operator/pull/61) |
| [64](https://github.com/arthurking87/mariadb-operator/issues/64) | switchover 無 timeout/circuit breaker | [#65](https://github.com/arthurking87/mariadb-operator/pull/65) ✅ 2026-07-22 已在 KIND 實機驗證通過（見上方更新區塊），信心度高 |
| [66](https://github.com/arthurking87/mariadb-operator/issues/66) | LeaderElectionID 寫死導致 Lease 衝突 | [#67](https://github.com/arthurking87/mariadb-operator/pull/67) |
| [73](https://github.com/arthurking87/mariadb-operator/issues/73) | secondary-svc 是否移除 not-ready endpoint | [#85](https://github.com/arthurking87/mariadb-operator/pull/85)（純文件澄清，非 bug） |
| [74](https://github.com/arthurking87/mariadb-operator/issues/74) | predicate.go 過濾事件 metrics | [#86](https://github.com/arthurking87/mariadb-operator/pull/86) |
| [76](https://github.com/arthurking87/mariadb-operator/issues/76) | 移除 ResetReplica/ResetSlavePos | [#83](https://github.com/arthurking87/mariadb-operator/pull/83) |
| [78](https://github.com/arthurking87/mariadb-operator/issues/78) | SQL ping + context timeout | [#82](https://github.com/arthurking87/mariadb-operator/pull/82) |
| [79](https://github.com/arthurking87/mariadb-operator/issues/79) | ReconcilePodNotReady 補強 | [#88](https://github.com/arthurking87/mariadb-operator/pull/88) |
| [80](https://github.com/arthurking87/mariadb-operator/issues/80) | switchover waitSync 是否卡住 | [#87](https://github.com/arthurking87/mariadb-operator/pull/87) |

> ⚠️ 這 24 個 PR 中有相當多 **本身帶有實質 bug**（例如 #54/#87/#88/#89/#90/#65/#82/#71/#61/#86/#52 都在 code review 或 KIND 實測中被抓到問題），所以「有 PR」不等於「issue 真的解決了」，仍需照 `Pull-Request.md` 的審查結論修正後才能合併。

---

## 建議優先處理順序

1. **A-1 的 6 個（#8, #10, #11, #15, #16, #23）**：查證後確認是真的缺口，且範圍都已經收斂到具體檔案/函式，可以直接開 PR。**（更新：#15、#23 已雙雙關閉不採用，見上方 2026-07-22 更新；實際只剩 #8/#10/#11 走完 PR、#16 暫緩）**
2. **A-6 的 #46**：範圍已收斂到 `mariadb_controller_status.go:34-37` 一處，順手可以跟 A-1 一起處理。
3. **A-2 的 4 個（#14, #17, #19, #21）**：建議直接關閉或改寫成更精準的新 issue，不要再排進開發排程。
4. **A-3 的 #27**：先跟回報者要重現步驟，不要盲目動工。
5. **A-4 的 #37、#47**：現階段不用管，等對應的未合併分支（#38 排程功能、#3/PR #49 metrics 功能）真的併進 main 後再重新評估。
6. **A-5 的 #13**：先寫 ADR，不要直接開 PR。
7. **B 類 24 個**：不是「沒處理」，而是「處理中但品質有問題」——請對照 `Pull-Request.md` 的審查結論逐一修正後才合併，不要照現狀直接合。
