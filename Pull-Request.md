# Pull Request 追蹤（arthurking87/mariadb-operator fork）

> 產生日期：2026-07-02。所有 PR 的 base 分支均為 `release`。
> CI 欄位為產生當下的快照；處理進度請看最下方的「處理順序」。

## 2026-08-11 更新：PR #93 Integration tests 失敗根因調查（非本 PR 造成的回歸）

`fix/issue-10-leader-election`（PR #93）補完 `b40c8d47` 那筆 regression test 後 CI 曾一度全綠，這次重跑 `Integration tests` job 連續兩次都失敗（`gh run rerun 31367933643 --failed` 觸發），都卡在同一個 spec：

```
MariaDB replication restore from backup
  should restore database [It] from volume snapshot
  internal/controller/mariadb_controller_replication_test.go:360
[FAILED] Timed out after 300.001s.
```

**排查過程**：兩次重跑失敗的 log 模式一模一樣——`mariadb-repl-0` 反覆執行 `Configuring primary`（一次約 60-80 次、大致每秒一次），全程無任何 error log，最終才推進到 `Configuring replica`，但仍趕不上整體 300 秒（`testHighTimeout`，`internal/controller/utils_test.go:40`）的 `Eventually` 視窗。逐行讀 code 排除了「reconcile 邏輯壞掉」的懷疑：

- `pkg/controller/replication/controller.go:239-252`：`ConfigurePrimary` 本身冪等、每次呼叫都成功，之所以被反覆呼叫，是因為 `internal/controller/mariadb_controller_status.go:154,166-167` 規定 pod 要 `client.HasConnectedReplicas(ctx)` 回傳 true 才會被標記 role=`Primary`，標記之前 `shouldSkipPrimaryReconciliation` 每輪都回 false，屬設計上的正常輪詢（症狀，非病因）。
- 真正的瓶頸是 primary pod 從 VolumeSnapshot 還原後,replica 的複製連線遲遲沒有真的接上。比對同一個 `DescribeTable` 裡另一個「from physical backup」（S3/`mariabackup`）Entry 從未踩到這個問題，差異在於 `internal/controller/physicalbackup_controller_snapshot.go:292-293` 拍 VolumeSnapshot 前只下了 `LockTablesWithReadLock`，沒有強制把 InnoDB buffer pool 的 dirty page flush 到磁碟——還原出來的 volume 等同「被強制關機」狀態，mysqld 第一次啟動要跑 InnoDB crash recovery（重放 redo log）才能開始接受連線，耗時本來就會依快照當下未落盤的異動量浮動；`mariabackup` 那條路徑因為備份後有 `--prepare` 步驟預先套用 redo log，還原出來的資料目錄不需要 crash recovery，所以穩定得多。

**結論**：這是一個真實存在、目前偶爾會撞上 `testHighTimeout=300s` 固定時間窗的效能特性（VolumeSnapshot 備份沒有強制 flush），**跟這個 PR 改的 leader election 參數完全無關**——PR #93 的 diff 只動了 `cmd/controller/main.go`/`cert_controller.go`，integration test suite 是直接在測試進程裡建 manager 跑 reconciler，不走 `cmd/controller/main.go` 的 `rootCmd`，兩者路徑不相交。不是這個 PR 造成的回歸，但目前會間歇性擋住它的 CI。

**尚待決定**（超出本 PR 範圍，記錄供後續參考）：
1. 幫 `internal/controller/mariadb_controller_replication_test.go:382` 這個 `Entry("from volume snapshot", ...)` 標 `flaky`（比照旁邊已有 `FlakeAttempts` 的其他 spec），讓 PR #93 先過。
2. 更根本的修法：`physicalbackup_controller_snapshot.go` 在 `LockTablesWithReadLock` 之後、真正觸發 VolumeSnapshot 之前，補一段強制 dirty page flush（或等待 checkpoint age 收斂）的邏輯，讓 VolumeSnapshot 還原也能跳過 crash recovery——這是一個獨立的 issue/PR，不在這次調查範圍內動手。

## 2026-08-05 更新（二）：10 個缺測試的 fix PR 已全數補上單元測試並推送

針對上一節盤點出的 10 個沒有測試的 `fix(...)` PR，逐一在對應的 PR branch 上補了一個（或兩個）針對該修法的 regression test，並直接 commit + push 更新到對應的 open PR。每個都遵守同樣的驗證流程：**先暫時還原掉修法本身，確認新測試會 FAIL；再還原修法，確認 PASS**，證明測試真的有打到那個 bug，而不只是能編譯。全部在 Docker（`golang:1.26.3-alpine3.23`，因為這台機器沒裝本機 Go）跑過 `gofmt`/`go vet`/`go build`/`go test`，且都乾淨。

| # | Branch | 新測試 | Commit |
|---|--------|--------|--------|
| [93](https://github.com/arthurking87/mariadb-operator/pull/93) | fix/issue-10-leader-election | `TestLeaderElectionReadyzCheck`（`cmd/controller/main_test.go`） | `b40c8d47` |
| [89](https://github.com/arthurking87/mariadb-operator/pull/89) | fix/issue-7-9-delete-notready-primary | `promoteReplica_DeleteBeforePatch` / `_HappyPath`（`internal/controller/pod_replication_controller_promote_test.go`）；為了可測，把 `ReconcilePodNotReady` 尾段（Delete + patch）抽成 `promoteReplica` 方法，純搬移無行為變更 | `b0c55976` |
| [70](https://github.com/arthurking87/mariadb-operator/pull/70) | fix/issue-31-flush-privileges | `TestGrantOptionRevokeOrdering`（`internal/controller/grant_controller_regression_test.go`） | `46d17e77` |
| [69](https://github.com/arthurking87/mariadb-operator/pull/69) | fix/issue-34-max-user-connections | `TestReconcileAppliesMaxUserConnectionsWithoutPassword`（`internal/controller/user_controller_maxconns_test.go`） | `44d3aab7` |
| [68](https://github.com/arthurking87/mariadb-operator/pull/68) | fix/issue-28-reset-all-slaves | `TestConfigurePrimaryReplicaResetsMultiClusterConnection`（`pkg/controller/replication/topology_multicluster_test.go`） | `51e8379e` |
| [67](https://github.com/arthurking87/mariadb-operator/pull/67) | fix/issue-66-leader-election-id | `TestLeaderElectionIDFlag_*` / `TestCertControllerLeaderElectionIDFlag_*`（`cmd/controller/main_flags_test.go`） | `5b0dc35e` |
| [63](https://github.com/arthurking87/mariadb-operator/pull/63) | fix/issue-24-switchover-bugs | `TestConfigurePrimary_DisablesReadOnlyAfterGtidSlavePosNoValueForDomainError`（`pkg/controller/replication/topology_configure_primary_test.go`）— 只覆蓋三個子修法中最獨立的 READ_ONLY fallthrough 那個 | `e4836e20` |
| [62](https://github.com/arthurking87/mariadb-operator/pull/62) | fix/issue-32-wait-for-mariadb | `TestPollWithMariaDB_NotFoundKeepsPolling`（`pkg/wait/wait_test.go`） | `ef423442` |
| [59](https://github.com/arthurking87/mariadb-operator/pull/59) | fix/issue-41-statefulset-update-ordering | `TestReconcileUpdatesWaitsForReadyStatusAfterReplicaUpdate` / `_RequeuesImmediatelyWhenReady`（`internal/controller/mariadb_controller_update_test.go`） | `6c6f1653` |
| [56](https://github.com/arthurking87/mariadb-operator/pull/56) | fix/issue-39-gtid-fetch | `TestParseGtidWithDomainId` + `TestSystemVariable_ScanErrorIsPropagated`（`pkg/replication/gtid_test.go` / `pkg/sql/systemvariable_test.go`） | `b2f86d42` |

值得記錄的幾個發現：
- **#89 / #70 / #69 / #68 / #63 需要小幅度的「可測性」production code 改動**，不只是加測試檔：#89 把 `ReconcilePodNotReady` 尾段抽成 `promoteReplica`（純搬移，行為不變，因為原函式前半段會嘗試連線真實 MariaDB 找 failover candidate，sandbox 裡連不到，測試沒法走到 Delete/patch 那段）；#70/#69/#68/#63 這四個都在呼叫具體型別 `*sql.Client`（`pkg/sql`），而 `Client.db` 是 unexported，所以四個 branch 上都各自加了同一個小 bridge constructor `pkg/sql/testsupport.go`（`NewClientFromDB(db *sql.DB) *Client`），讓測試可以用假的 `database/sql/driver` 注入取代真連線。因為 10 個 branch 彼此獨立（都是各自從 `release` 分岔的孤兒分支），這個 bridge 檔在這 4 個 branch 上各存在一份，不會互相同步。
- **#56 的 GTID trim 那部分修法其實是純 cosmetic no-op**：負責測試的 agent 手動推導並實測驗證了 revert 掉那段修法後，輸出完全沒有差異（只有 log 等級從 Info 變 Error），因此沒有勉強做假的 fail/pass 對照，而是誠實記錄下來、改成一般性覆蓋測試；`SystemVariable` scan 錯誤那部分則是真的 regression，有正常的 fail/pass 驗證。
- 全部 10 個 push 完後用 `gh pr view --json files,additions` 重新核對過，diff 都確實變大且包含對應的 `_test.go`，不是只是 commit 訊息寫了測試但檔案沒真的推上去。

## 2026-08-05 更新（一）：fix PR 單元測試盤點

- 重新抓取 https://github.com/arthurking87/mariadb-operator/pulls，目前共 30 個 OPEN PR（新增了先前表格漏列的 [#49](https://github.com/arthurking87/mariadb-operator/pull/49) feat(metrics)）。逐一用 `gh pr view <#> --json files` 取得今天的實際變更檔案清單，比對標題為 `fix(...)` 的 PR 是否有新增/修改任何 `_test.go`。
- 部分 PR 自 07-22 快照後有新 commit push 上去，diff 規模已變（例如 #87 +37/-0 → +497/-17、#65 +125/-0 → +552/-2、#54 +39/-24 → +464/-24、#61 +198/-20 → +345/-20、#57 +20/-4 → +317/-4、#88 +14/-1 → +368/-2），代表這些 PR 後來很可能補上了測試或做了其他修改；本次判斷一律以**今天的實際檔案清單**為準，不沿用 07-02 的舊數字。
- **22 個 `fix(...)` PR 中，10 個完全沒有新增/修改任何 `_test.go`**（依 PR 號排序）：

| # | 標題 | 只改了這些檔案（無測試） |
|---|------|------|
| [93](https://github.com/arthurking87/mariadb-operator/pull/93) | fix(#10): 調整 leader election lease 時序 + readyz check | `cmd/controller/cert_controller.go`, `cmd/controller/main.go` |
| [89](https://github.com/arthurking87/mariadb-operator/pull/89) | fix(replication): 刪除 NotReady primary Pod 強制斷線重連 | `internal/controller/pod_replication_controller.go` |
| [70](https://github.com/arthurking87/mariadb-operator/pull/70) | fix(#31): GrantOption 應在 Revoke 前填入 | `internal/controller/grant_controller.go` |
| [69](https://github.com/arthurking87/mariadb-operator/pull/69) | fix(#34): 非密碼變更也要 reconcile User | `internal/controller/user_controller.go` |
| [68](https://github.com/arthurking87/mariadb-operator/pull/68) | fix(#28): configurePrimaryReplica 重置多叢集 slave 連線 | `pkg/controller/replication/topology.go` |
| [67](https://github.com/arthurking87/mariadb-operator/pull/67) | fix(#66): LeaderElectionID 可設定避免 Lease 衝突 | `cmd/controller/cert_controller.go`, `cmd/controller/main.go`, helm chart 檔（values/README/deployment） |
| [63](https://github.com/arthurking87/mariadb-operator/pull/63) | fix(#24): 修 switchover READ_ONLY 狀態、條件檢查、多餘 sleep | `pkg/controller/replication/switchover.go`, `pkg/controller/replication/topology.go` |
| [62](https://github.com/arthurking87/mariadb-operator/pull/62) | fix(#32): 修 waitForMariaDB timeout 與迴圈條件 | `pkg/wait/wait.go` |
| [59](https://github.com/arthurking87/mariadb-operator/pull/59) | fix(#41): StatefulSet rolling update 強制 replica 先於 primary | `internal/controller/mariadb_controller_update.go` |
| [56](https://github.com/arthurking87/mariadb-operator/pull/56) | fix(#39): GTID fetch 傳遞 SystemVariable scan 錯誤 | `pkg/replication/gtid.go`, `pkg/sql/sql.go` |

- 其餘 12 個 `fix(...)` PR 都有對應測試異動：#99（`mariadb_controller_status_test.go`）、#94（`container_builder_test.go`）、#92（`controller_test.go`）、#88（`pod_replication_controller_sentinel_test.go` + `failover_test.go`）、#87（`switchover_rollback_test.go` + `lockedsession_test.go`）、#71（`check_test.go`）、#65（`mariadb_types_test.go` + `switchover_test.go`）、#61（`user_controller_error_propagation_test.go`）、#57（`pod_replication_controller_test.go`）、#54（`multicluster_test.go` + `replication_test.go` + 2 個 `pkg/sql` test）、#52（`sql_test.go`）、#50（`metrics_test.go`）。
- 非 `fix` 類 PR 附帶參考：`feat` 裡 [#90](https://github.com/arthurking87/mariadb-operator/pull/90)（bypass annotation）與 [#82](https://github.com/arthurking87/mariadb-operator/pull/82)（SQL ping/timeout）同樣沒有測試；#100/#86/#83/#49 則都有補測試；#98（CodeRabbit 設定）、#85（純文件）性質上不需要測試。
- 交叉對照「處理順序」表中既有的逐行審查紀錄：#59 已被判定為 no-op、建議直接關閉（本來就不必補測試）；其餘 9 個（#93/#89/#70/#69/#68/#67/#63/#62/#56）當初的審查重點放在邏輯正確性，**完全沒提到測試缺口**，屬本次新發現，建議在合併前優先要求補上對應的 unit test（尤其 #63/#67/#89 屬於複寫/leader-election 這種難以只靠 code review 抓到邊界情況的邏輯）。

## 2026-07-22 更新

- 本次更新為止**沒有任何 PR 真正 merge**（`gh pr list --state merged` 為空），下面所有「處理順序」的審查結論都還沒被實際套用到 `release`。
- 原表只涵蓋 07-02 當天存在的 24 個 PR（#49~#90）。07-03 之後由 `Issue.md` A-1 分析衍生出的 **#91~#95** 當時還不存在，現已補進表格；另有一個與 issue 修復無關的維運性 PR **#98**（CodeRabbit 設定）獨立列出。
- **#91（對應 #23）已關閉不合併**：評估後認為只是新增一個沒有明確需求的可選欄位，issue 裡 annotation 那部分訴求也查無實據，記錄後關閉 issue + PR。
- **#95（對應 #15）已關閉不合併（2026-07-13，非本次會話）**：範圍（開放 4 個 replication 變數）被判定維護面過大；後續改開更收斂的 #97，現已開出 [PR #100](https://github.com/arthurking87/mariadb-operator/pull/100)。
- **#65（對應 #64）已完成 KIND 實機驗證**：部署到測試叢集、用「複寫落後到不可能追上」（`PURGE BINARY LOGS`）情境觸發 switchover，確認明確設定 30s 與預設 60s 兩種情況下都會在時限後自動中止並回復 primary、原 primary 維持可寫入。這是目前 25 個 OPEN PR 裡**唯一有實機驗證**、非僅程式碼審查的一個，建議提升到優先合併順位。詳細報告見 [PR #65 留言](https://github.com/arthurking87/mariadb-operator/pull/65#issuecomment-5041458537)。
- #92/#93/#94（對應 #8/#10/#11）目前**只有 CI 通過，尚未做過本檔案風格的逐行程式碼審查**，處理優先順序上應視同「未審查」。
- **新增 [#99](https://github.com/arthurking87/mariadb-operator/pull/99)（對應 #46）**：`reconcileStatus` 區分 StatefulSet `Get` 的 `NotFound` 跟其他 API 錯誤，避免暫時性錯誤把健康叢集誤判成 `Ready=False`。已用 fake client + `interceptor.Funcs` 寫單元測試驗證（拿掉修法會 FAIL），`go build`/`go vet`/`golangci-lint`/`gofmt` 均過。剛開出，CI 結果待確認。
- **新增 [#100](https://github.com/arthurking87/mariadb-operator/pull/100)（對應 #97）**：新增 `autoServerId`/`semiSyncMasterEnabled`/`innodbFlushLogAtTrxCommit` 三個可選欄位。兩個布林 knob 在 CRD 預設值、env var 送出、`PodEnvironment` getter 三層都刻意預設 `true`（保留現有行為，避免任一層漏掉 defaulting 就靜默弱化 durability 或搞丟 server_id）。現有 `config_test.go`/`container_builder_test.go`/`mariadb_types_test.go` 全數不動且輸出逐位元組相同，另外新增測試覆蓋兩個 knob 關閉的情境。用 docker `golang:1.26.3-alpine3.23` 跑過 `go build`/`go vet`/`golangci-lint`/`gofmt`，並用 `setup-envtest` 抓 kubebuilder 二進位跑了 `api/v1alpha1`/`pkg/builder`/`pkg/controller/replication` 三個套件的完整 envtest 測試(全過)，也重新產生了 CRD/deepcopy/helm CRDs/docs(`deploy/charts/mariadb-operator-crds/templates/crds.yaml` 774KB，在 900KB 限制內)。

## OPEN PR 一覽

| # | 標題 | +/- | 檔案數 | CI | Mergeable |
|---|------|-----|-------|-----|-----------|
| [100](https://github.com/arthurking87/mariadb-operator/pull/100) | feat(#97): 新增 autoServerId/semiSyncMasterEnabled/innodbFlushLogAtTrxCommit | +416/-39 | 12 | ⏳ 剛開出待確認 | ✅ |
| [99](https://github.com/arthurking87/mariadb-operator/pull/99) | fix(#46): 區分 reconcileStatus 的 NotFound 與暫時性 API 錯誤 | +115/-4 | 2 | ⏳ 剛開出待確認 | ✅ |
| [98](https://github.com/arthurking87/mariadb-operator/pull/98) | chore: 啟用 CodeRabbit 自動 review（非 issue 修復，維運性變更） | +3/-0 | 1 | ✅ PASS | ✅ |
| [94](https://github.com/arthurking87/mariadb-operator/pull/94) | fix(#11): 預設 preStop hook + 明確 TerminationGracePeriodSeconds | +98/-6 | 7 | ✅ PASS | ✅ |
| [93](https://github.com/arthurking87/mariadb-operator/pull/93) | fix(#10): 調整 leader election lease 時序 + 新增 readyz check | +50/-7 | 2 | ⚠️ Integration tests 間歇性逾時（與本 PR 無關，見 2026-08-11 章節） | ✅ |
| [92](https://github.com/arthurking87/mariadb-operator/pull/92) | fix(#8): spec 變更但角色未變時也要 reapply replication config | +193/-2 | 7 | ✅ PASS | ✅ |
| [90](https://github.com/arthurking87/mariadb-operator/pull/90) | feat(update): bypass annotation 解除卡住的 rolling update | +11/-0 | 2 | ✅ PASS | ✅ |
| [89](https://github.com/arthurking87/mariadb-operator/pull/89) | fix(replication): 刪除 NotReady primary Pod 強制斷線重連 | +8/-0 | 1 | ✅ PASS | ✅ |
| [88](https://github.com/arthurking87/mariadb-operator/pull/88) | fix(replication): 無 failover 候選時退回目前 primary | +14/-1 | 2 | ✅ PASS | ✅ |
| [87](https://github.com/arthurking87/mariadb-operator/pull/87) | fix(replication): switchover 失敗時回滾 primary lock/read-only | +37/-0 | 1 | ✅ PASS | ✅ |
| [86](https://github.com/arthurking87/mariadb-operator/pull/86) | feat(predicate): 過濾事件 metrics + mariadbReplRegex helper | +104/-10 | 3 | ✅ PASS | ✅ |
| [85](https://github.com/arthurking87/mariadb-operator/pull/85) | docs(endpoints): 回答 #73（secondary-svc 不移除 not-ready endpoints） | +5/-0 | 1 | ✅ PASS | ✅ |
| [83](https://github.com/arthurking87/mariadb-operator/pull/83) | feat(sql): 新增 ResetReplica（現代 RESET REPLICA 語法） | +20/-0 | 1 | ✅ PASS | ✅ |
| [82](https://github.com/arthurking87/mariadb-operator/pull/82) | feat(sql): SQL 操作加 ping check + context timeout | +74/-12 | 1 | ✅ PASS | ✅ |
| [71](https://github.com/arthurking87/mariadb-operator/pull/71) | fix(#38): leader-only 排程健康檢查 | +422/-1 | 5 | ✅ PASS | ✅ |
| [70](https://github.com/arthurking87/mariadb-operator/pull/70) | fix(#31): GrantOption 應在 Revoke 前填入 | +3/-3 | 1 | ✅ PASS | ✅ |
| [69](https://github.com/arthurking87/mariadb-operator/pull/69) | fix(#34): 非密碼變更也要 reconcile User | +4/-1 | 1 | ✅ PASS | ✅ |
| [68](https://github.com/arthurking87/mariadb-operator/pull/68) | fix(#28): configurePrimaryReplica 重置多叢集 slave 連線 | +9/-0 | 1 | ✅ PASS | ✅ |
| [67](https://github.com/arthurking87/mariadb-operator/pull/67) | fix(#66): LeaderElectionID 可設定避免 Lease 衝突 | +24/-3 | 6 | ⚠️ PENDING/MIXED | ✅ |
| [65](https://github.com/arthurking87/mariadb-operator/pull/65) | fix(#64): SwitchoverTimeout 中止卡死的 switchover/failover ✅ 2026-07-22 KIND 實測驗證通過 | +125/-0 | 12 | ✅ PASS（僅 release job SKIPPED，正常） | ✅ |
| [63](https://github.com/arthurking87/mariadb-operator/pull/63) | fix(#24): 修 switchover READ_ONLY 狀態、條件檢查、多餘 sleep | +7/-12 | 2 | ✅ PASS | ✅ |
| [62](https://github.com/arthurking87/mariadb-operator/pull/62) | fix(#32): 修 waitForMariaDB timeout 與迴圈條件 | +4/-3 | 1 | ✅ PASS | ✅ |
| [61](https://github.com/arthurking87/mariadb-operator/pull/61) | fix(#48): 修 database/grant/user controller 狀態回報與錯誤傳遞 | +198/-20 | 7 | ✅ PASS | ✅ |
| [59](https://github.com/arthurking87/mariadb-operator/pull/59) | fix(#41): StatefulSet rolling update 強制 replica 先於 primary | +3/-0 | 1 | ✅ PASS | ✅ |
| [57](https://github.com/arthurking87/mariadb-operator/pull/57) | fix(#33): 確保 replica pod 註冊到 secondary-svc endpoint | +20/-4 | 3 | ✅ PASS | ✅ |
| [56](https://github.com/arthurking87/mariadb-operator/pull/56) | fix(#39): GTID fetch 傳遞 SystemVariable scan 錯誤 | +5/-5 | 2 | ✅ PASS | ✅ |
| [54](https://github.com/arthurking87/mariadb-operator/pull/54) | fix(#40): 命名叢集內複寫 channel 並修正 channel-aware 操作 | +39/-24 | 9 | ✅ PASS | ✅ |

## 處理順序

依「異常先處理 → 安全性 → 大型變更 → 小型 fix」排序：

| 順序 | PR | 理由 | 狀態 |
|------|----|------|------|
| 1 | #84 | diff 為空（0/0），需先確認分支是否失效或已被 base 涵蓋 | ✅ 已查明：最後一個 commit 在 KIND 驗證後 revert 了整個改動，淨 diff 為零，為 no-op → **建議關閉** |
| 2 | #67 | CI PENDING/MIXED，需查明測試狀態 | ✅ 虛驚：僅 release job SKIPPED（正常），其餘全綠 |
| 3 | #65 | CI PENDING/MIXED，且改動面較大（12 檔） | ✅ 虛驚：僅 release job SKIPPED（正常），其餘全綠。**2026-07-22 追加**：已在 KIND 實機部署驗證，`switchoverTimeout` 功能本身（含預設值 60s）行為正確，詳見 [PR 留言](https://github.com/arthurking87/mariadb-operator/pull/65#issuecomment-5041458537)。⚠️ 注意：驗證是在此分支單獨部署下進行的，與 #87/#63 的合併順序衝突（見第 11 項）尚未解決，實際合併前仍需先處理衝突群（**#50 已於 2026-08-05 關閉，不再是衝突群的一員**） |
| 4 | ~~#52~~ | SQL injection 修復，安全性優先 | ✅ 已審查：2 個發現（DropDatabase 驗證會卡死 finalizer；建議改用反引號跳脫而非白名單驗證），詳見審查紀錄。**2026-08-05：已關閉**，見下方「已關閉」章節 |
| 5 | ~~#50~~ | +443 行大型變更（新 pkg/metrics） | ✅ 已審查：1 個語義問題（metrics 計的是 attempt 不是 switchover）+ 測試瘦身建議。**2026-08-05：已關閉**，見下方「已關閉」章節——release 上的 `d5dd5468`（fix #47）已經修掉這裡抓到的同一個問題 |
| 6 | #71 | +422 行大型變更（排程健康檢查） | ✅ 已審查：3 個實質問題（error label cardinality 爆炸、無 per-tick timeout、reset/scrape race）+ 5 個次要點，已留言 |
| 7 | #61 | +198 行，跨 7 檔的 controller 錯誤處理 | ✅ 已審查：錯誤傳遞修正本身正確；但 2/3 diff 是與標題無關的 pkg/password backport（= 上游 #1790+#1792，逐位元組相同），建議拆 PR 或改描述 |
| 8 | #86 | +104 行 metrics feature | ✅ 已審查：metric 缺 per-watch 維度（偏離 #74 目的）、委派誤記 attribution、regex 應改 strings.Contains、helper 是 dead code，已留言 |
| 9 | #82 | SQL ping/timeout，行為面影響廣 | ✅ 已審查：ping 是連線池 TOCTOU、Query 沒拿到 timeout（與描述矛盾）、10s 上限恐砍 FTWRL，已留言。（原本記錄「與 #52 衝突需先合 #52」已失效——**#52 已於 2026-08-05 關閉**） |
| 10 | #54 | 跨 9 檔的 channel 命名重構 | ✅ 已審查：嚴重——無既有叢集遷移路徑（舊未命名 channel 遺留運轉、新 primary 可能雙軌複寫）；RESET SLAVE ALL 語義描述有誤，已留言 |
| 11 | #87 | switchover 回滾邏輯 | ✅ 已審查：高——後段 phase 失敗時 rollback 造成雙寫 split-brain；UnlockTables 連線池問題；與 #63/#65 全面衝突（#50 已關閉，不再算入），已留言 |
| 12 | #88 | failover fallback | ✅ 已審查：高——return nil 後無 requeue 且 watch 有過濾，failover 恐永久停擺；且連暫時性 API 錯誤一起吞，建議 sentinel error + RequeueAfter，已留言 |
| 13 | #89 | 刪除 NotReady primary Pod | ✅ 已審查：中——pod 重建後可能在 switchover 完成前重新接收寫入；delete 失敗的 retry 是死路；建議加 UID precondition，已留言 |
| 14 | #90 | bypass annotation | ✅ 已審查：高——waitForReadyStatus 擋在 annotation 檢查之前，壞 PVC 情境下逃生口無效，已留言 |
| 15 | #63 | switchover 狀態修正 | ✅ LGTM：三處修正皆正確（READ_ONLY fall-through 是真 bug 修復）；描述與 diff 不符需更新；建議在衝突群中優先合併 |
| 16 | #57 | secondary-svc endpoint | ✅ 方向正確：建議補整合測試、確認被丟棄的 ctrl.Result 語義 |
| 17 | #83 | ResetReplica 新語法 | ✅ 已審查：no-op guard 對命名 channel 的 1617 不成立（與 #54 合流會踩到）；零呼叫端的重複 API 建議一次遷移或不加 |
| 18 | #68 | 多叢集 slave 重置 | ✅ LGTM：與 sibling 模式一致；與 #54 衝突，建議先合本 PR |
| 19 | #70 | GrantOption 順序 | ✅ LGTM：GrantOption 是 inmutable，邊界情況安全 |
| 20 | #69 | User reconcile 條件 | ✅ LGTM：無密碼帳號的 spec 變更終於會生效 |
| 21 | #62 | waitForMariaDB timeout | ✅ 已審查：false-success 修正正確；建議 NotFound 用 sentinel 立即中止而非重試到超時 |
| 22 | #56 | GTID scan 錯誤傳遞 | ✅ LGTM：吞錯與迴圈變數污染兩處都對 |
| 23 | #59 | StatefulSet 更新順序 | ✅ 已審查：實質 no-op（頂部 waitForReadyStatus 已提供同樣門檻），建議關閉或重新定位 #41 根因 |
| 24 | #85 | 純文件 | ✅ LGTM：調查結論正確，註解位置恰當 |

## KIND 實測驗證（2026-07-02）

四個高風險發現全部在 KIND（v1.35.0）上實測**確認成立**，詳細重現步驟已回貼到各 PR：

| PR | 驗證結果 | 關鍵證據 |
|----|---------|---------|
| #52 | ✅ CONFIRMED（**PR 已於 2026-08-05 關閉，不會被合併**，此列僅存留實測紀錄） | \`my.db\` 在 MariaDB 合法但被 operator 拒絕；模擬升級後刪除 CR → finalizer 卡死 75s+ 無限循環。補充：finalizer 在 reconcile 成功後才加，所以只有**升級前既有**資源會卡死（更隱蔽） |
| #90 | ✅ CONFIRMED | 壞 PVC pod CrashLoop → 觸發更新 → 加 annotation 後 3 分鐘：三個 pod 全停舊 revision、150 次 waitForReadyStatus、**0 次** annotation 檢查執行 |
| #88 | ✅ CONFIRMED | 無候選事件觸發一次後，replica 恢復候選資格 4 分鐘內 **0 次重試**；對照組（release 舊碼）同狀態 2.5 分鐘重試 15 次 |
| #54 | ✅ CONFIRMED（模式修正） | 升級後 operator 永久 wedge：\`Error 1934: Connection 'mariadb-operator' conflicts with existing connection ''\` 無限循環，CR Ready=True→False。非預測的雙軌複寫——MariaDB 直接拒絕同 master 第二條 channel，故障大聲但升級即癱瘓 |
| #65 | ✅ CONFIRMED（2026-07-22，功能正確） | 3-replica 叢集上用 `PURGE BINARY LOGS` 製造不可恢復的複寫落後，觸發 switchover：明確設 30s → 34.7s 後自動中止回復；不設值（預設 60s）→ 1m1.99s 後自動中止回復。兩次原 primary 皆維持可寫入、無卡死。與前三項不同：這是**驗證功能正確**，不是抓到 bug |

## 已關閉（參考）

#81（stop setting server_id）、#60（SQL clientset defer close）、#58（primary service patch）、#55（NewClientWithMariaDB guards）、#53（nil row.Close() guard）、#51（pod_replication nil guard）、#84（diff 為零的 no-op）— 均為 CLOSED，未 merge。

**2026-07-22 新增關閉：**
- **#91**（對應 #23，RevisionHistoryLimit）：評估後認為只是新增沒有明確需求的可選欄位，非修復實際錯誤，記錄後關閉。
- **#95**（對應 #15，2026-07-13 關閉，非本次會話）：開放 4 個 replication 變數的範圍被判定維護面過大，關閉不合併；改開更收斂的 #97（尚無對應 PR）。

**2026-08-05 新增關閉：**
- **#52**（對應 #29，`fix(#29): replace SQL string interpolation with parameterized queries`）：關閉原因跟 #50 不同——不是被 release 取代，而是**方向本身被質疑**。這個 PR 在 2026-08-04 出現了兩組新 review：(1) CodeRabbit 自動 review（因 #98 開啟）指出 `validateIdentifier` 的白名單 regex 會擋掉合法名稱如 `my.db`，建議改用反引號跳脫而非白名單——跟這份文件自己 KIND 實測抓到的 finalizer 卡死 bug 是同一個根因；(2) GitHub 使用者 `rophy`（Rophy Tsai）留言質疑這個修法是否真的必要，指出 upstream mariadb-operator/mariadb-operator 對同類回報（#1722）判定 **NOT_PLANNED**（建立 CR 本身需要 RBAC 權限，CRD 輸入視為可信任），且目前實作只涵蓋 5 個插值點、`CreateUser`/`Grant`/`ChangeWsrepSSTAuth` 仍未處理，涵蓋範圍與 PR 標題不符。採納 rophy 的建議直接關閉，不再修正繼續推進；關閉時已在 PR 上留言說明理由。
- **#50**（對應 #35，`fix(#35): create pkg/metrics package to resolve compilation error`）：與 `release` 產生 merge conflict，查明原因後發現不是「兩邊都要保留」的那種衝突——`release` 早在 `141cff5d`/`431446ac` 就已經合併了跟這個 PR 完全相同的 `pkg/metrics` + switchover 計時邏輯，之後又多了一個 `d5dd5468`（fix #47），修掉了這份文件先前審查 #50 時就抓到的同一個語義問題（原本每次 reconcile retry 都用 `time.Now()` 當 switchover 起點，重試 N 次就會把同一次 switchover 誤算成 N 次；`d5dd5468` 改成用 `PrimarySwitched` condition 的 `LastTransitionTime` 當起點，只在真正終止失敗/成功時才記一次），並加上 `DeleteSwitchoverMetrics`（CR 刪除時清殘留 series）與對應測試。逐檔 diff 確認 release 版是 #50 的嚴格超集（每一行 #50 有的 release 都有，只多不少），故直接關閉，不 resolve conflict（resolve 等於拿舊的、有 bug 的版本蓋掉已修好的版本，沒有意義）。關閉時已在 PR 上留言說明。

> 註：`gh pr list --state merged` 目前為空——包含上表所有「LGTM」「已審查」的 PR 在內，**沒有任何一個真正 merge 進 release**，處理順序表的審查結論仍待實際套用。
