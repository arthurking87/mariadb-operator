# Pull Request 追蹤（arthurking87/mariadb-operator fork）

> 產生日期：2026-07-02。所有 PR 的 base 分支均為 `release`。
> CI 欄位為產生當下的快照；處理進度請看最下方的「處理順序」。

## OPEN PR 一覽

| # | 標題 | +/- | 檔案數 | CI | Mergeable |
|---|------|-----|-------|-----|-----------|
| [90](https://github.com/arthurking87/mariadb-operator/pull/90) | feat(update): bypass annotation 解除卡住的 rolling update | +11/-0 | 2 | ✅ PASS | ✅ |
| [89](https://github.com/arthurking87/mariadb-operator/pull/89) | fix(replication): 刪除 NotReady primary Pod 強制斷線重連 | +8/-0 | 1 | ✅ PASS | ✅ |
| [88](https://github.com/arthurking87/mariadb-operator/pull/88) | fix(replication): 無 failover 候選時退回目前 primary | +14/-1 | 2 | ✅ PASS | ✅ |
| [87](https://github.com/arthurking87/mariadb-operator/pull/87) | fix(replication): switchover 失敗時回滾 primary lock/read-only | +37/-0 | 1 | ✅ PASS | ✅ |
| [86](https://github.com/arthurking87/mariadb-operator/pull/86) | feat(predicate): 過濾事件 metrics + mariadbReplRegex helper | +104/-10 | 3 | ✅ PASS | ✅ |
| [85](https://github.com/arthurking87/mariadb-operator/pull/85) | docs(endpoints): 回答 #73（secondary-svc 不移除 not-ready endpoints） | +5/-0 | 1 | ✅ PASS | ✅ |
| [84](https://github.com/arthurking87/mariadb-operator/pull/84) | feat(replication): ResetMaster 改為 opt-in | 0/0 | 0 | ✅ PASS | ✅ |
| [83](https://github.com/arthurking87/mariadb-operator/pull/83) | feat(sql): 新增 ResetReplica（現代 RESET REPLICA 語法） | +20/-0 | 1 | ✅ PASS | ✅ |
| [82](https://github.com/arthurking87/mariadb-operator/pull/82) | feat(sql): SQL 操作加 ping check + context timeout | +74/-12 | 1 | ✅ PASS | ✅ |
| [71](https://github.com/arthurking87/mariadb-operator/pull/71) | fix(#38): leader-only 排程健康檢查 | +422/-1 | 5 | ✅ PASS | ✅ |
| [70](https://github.com/arthurking87/mariadb-operator/pull/70) | fix(#31): GrantOption 應在 Revoke 前填入 | +3/-3 | 1 | ✅ PASS | ✅ |
| [69](https://github.com/arthurking87/mariadb-operator/pull/69) | fix(#34): 非密碼變更也要 reconcile User | +4/-1 | 1 | ✅ PASS | ✅ |
| [68](https://github.com/arthurking87/mariadb-operator/pull/68) | fix(#28): configurePrimaryReplica 重置多叢集 slave 連線 | +9/-0 | 1 | ✅ PASS | ✅ |
| [67](https://github.com/arthurking87/mariadb-operator/pull/67) | fix(#66): LeaderElectionID 可設定避免 Lease 衝突 | +24/-3 | 6 | ⚠️ PENDING/MIXED | ✅ |
| [65](https://github.com/arthurking87/mariadb-operator/pull/65) | fix(#64): SwitchoverTimeout 中止卡死的 switchover/failover | +125/-0 | 12 | ⚠️ PENDING/MIXED | ✅ |
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
| 3 | #65 | CI PENDING/MIXED，且改動面較大（12 檔） | ✅ 虛驚：僅 release job SKIPPED（正常），其餘全綠 |
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

## 已關閉（參考）

#81（stop setting server_id）、#60（SQL clientset defer close）、#58（primary service patch）、#55（NewClientWithMariaDB guards）、#53（nil row.Close() guard）、#51（pod_replication nil guard）— 均為 CLOSED。
