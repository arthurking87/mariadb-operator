# Pull Request 追蹤（arthurking87/mariadb-operator fork）

> 產生日期：2026-07-02。所有 PR 的 base 分支均為 `release`。
> CI 欄位為產生當下的快照；處理進度請看最下方的「處理順序」。

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
| [93](https://github.com/arthurking87/mariadb-operator/pull/93) | fix(#10): 調整 leader election lease 時序 + 新增 readyz check | +50/-7 | 2 | ✅ PASS | ✅ |
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
| [52](https://github.com/arthurking87/mariadb-operator/pull/52) | fix(#29): SQL 字串拼接改為參數化查詢（安全性） | +65/-6 | 2 | ✅ PASS | ✅ |
| [50](https://github.com/arthurking87/mariadb-operator/pull/50) | fix(#35): 新增 pkg/metrics 解決編譯錯誤 | +443/-4 | 3 | ✅ PASS | ✅ |

## 處理順序

依「異常先處理 → 安全性 → 大型變更 → 小型 fix」排序：

| 順序 | PR | 理由 | 狀態 |
|------|----|------|------|
| 1 | #84 | diff 為空（0/0），需先確認分支是否失效或已被 base 涵蓋 | ✅ 已查明：最後一個 commit 在 KIND 驗證後 revert 了整個改動，淨 diff 為零，為 no-op → **建議關閉** |
| 2 | #67 | CI PENDING/MIXED，需查明測試狀態 | ✅ 虛驚：僅 release job SKIPPED（正常），其餘全綠 |
| 3 | #65 | CI PENDING/MIXED，且改動面較大（12 檔） | ✅ 虛驚：僅 release job SKIPPED（正常），其餘全綠。**2026-07-22 追加**：已在 KIND 實機部署驗證，`switchoverTimeout` 功能本身（含預設值 60s）行為正確，詳見 [PR 留言](https://github.com/arthurking87/mariadb-operator/pull/65#issuecomment-5041458537)。⚠️ 注意：驗證是在此分支單獨部署下進行的，**與 #87/#63/#50 的合併順序衝突（見第 11 項）尚未解決**，實際合併前仍需先處理衝突群 |
| 4 | #52 | SQL injection 修復，安全性優先 | ✅ 已審查：2 個發現（DropDatabase 驗證會卡死 finalizer；建議改用反引號跳脫而非白名單驗證），詳見審查紀錄 |
| 5 | #50 | +443 行大型變更（新 pkg/metrics） | ✅ 已審查：1 個語義問題（metrics 計的是 attempt 不是 switchover）+ 測試瘦身建議 |
| 6 | #71 | +422 行大型變更（排程健康檢查） | ✅ 已審查：3 個實質問題（error label cardinality 爆炸、無 per-tick timeout、reset/scrape race）+ 5 個次要點，已留言 |
| 7 | #61 | +198 行，跨 7 檔的 controller 錯誤處理 | ✅ 已審查：錯誤傳遞修正本身正確；但 2/3 diff 是與標題無關的 pkg/password backport（= 上游 #1790+#1792，逐位元組相同），建議拆 PR 或改描述 |
| 8 | #86 | +104 行 metrics feature | ✅ 已審查：metric 缺 per-watch 維度（偏離 #74 目的）、委派誤記 attribution、regex 應改 strings.Contains、helper 是 dead code，已留言 |
| 9 | #82 | SQL ping/timeout，行為面影響廣 | ✅ 已審查：ping 是連線池 TOCTOU、Query 沒拿到 timeout（與描述矛盾）、10s 上限恐砍 FTWRL、與 #52 衝突需先合 #52，已留言 |
| 10 | #54 | 跨 9 檔的 channel 命名重構 | ✅ 已審查：嚴重——無既有叢集遷移路徑（舊未命名 channel 遺留運轉、新 primary 可能雙軌複寫）；RESET SLAVE ALL 語義描述有誤，已留言 |
| 11 | #87 | switchover 回滾邏輯 | ✅ 已審查：高——後段 phase 失敗時 rollback 造成雙寫 split-brain；UnlockTables 連線池問題；與 #50/#63/#65 全面衝突，已留言 |
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
| #52 | ✅ CONFIRMED | \`my.db\` 在 MariaDB 合法但被 operator 拒絕；模擬升級後刪除 CR → finalizer 卡死 75s+ 無限循環。補充：finalizer 在 reconcile 成功後才加，所以只有**升級前既有**資源會卡死（更隱蔽） |
| #90 | ✅ CONFIRMED | 壞 PVC pod CrashLoop → 觸發更新 → 加 annotation 後 3 分鐘：三個 pod 全停舊 revision、150 次 waitForReadyStatus、**0 次** annotation 檢查執行 |
| #88 | ✅ CONFIRMED | 無候選事件觸發一次後，replica 恢復候選資格 4 分鐘內 **0 次重試**；對照組（release 舊碼）同狀態 2.5 分鐘重試 15 次 |
| #54 | ✅ CONFIRMED（模式修正） | 升級後 operator 永久 wedge：\`Error 1934: Connection 'mariadb-operator' conflicts with existing connection ''\` 無限循環，CR Ready=True→False。非預測的雙軌複寫——MariaDB 直接拒絕同 master 第二條 channel，故障大聲但升級即癱瘓 |
| #65 | ✅ CONFIRMED（2026-07-22，功能正確） | 3-replica 叢集上用 `PURGE BINARY LOGS` 製造不可恢復的複寫落後，觸發 switchover：明確設 30s → 34.7s 後自動中止回復；不設值（預設 60s）→ 1m1.99s 後自動中止回復。兩次原 primary 皆維持可寫入、無卡死。與前三項不同：這是**驗證功能正確**，不是抓到 bug |

## 已關閉（參考）

#81（stop setting server_id）、#60（SQL clientset defer close）、#58（primary service patch）、#55（NewClientWithMariaDB guards）、#53（nil row.Close() guard）、#51（pod_replication nil guard）、#84（diff 為零的 no-op）— 均為 CLOSED，未 merge。

**2026-07-22 新增關閉：**
- **#91**（對應 #23，RevisionHistoryLimit）：評估後認為只是新增沒有明確需求的可選欄位，非修復實際錯誤，記錄後關閉。
- **#95**（對應 #15，2026-07-13 關閉，非本次會話）：開放 4 個 replication 變數的範圍被判定維護面過大，關閉不合併；改開更收斂的 #97（尚無對應 PR）。

> 註：`gh pr list --state merged` 目前為空——包含上表所有「LGTM」「已審查」的 PR 在內，**沒有任何一個真正 merge 進 release**，處理順序表的審查結論仍待實際套用。
