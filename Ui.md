# UI 追蹤（ui/ — mariadb-operator 管理面板）

> 產生日期：2026-08-05。記錄 `ui/` 這個 React + Express 小面板的現況、異動決策，以及尚未實作項目的規劃討論。
> 面板結構：`ui/src/App.jsx`（路由）+ `ui/src/components/Sidebar.jsx`（左側導覽）+ `ui/src/pages/*.jsx`（各頁）+ `ui/server.js`（Express API，包在同一個容器內用 `kubectl`/`helm` 操作叢集）。

## New Instance 精靈：Storage Class 改成動態抓叢集清單 + 可自由輸入（2026-08-05）

你想用自己實際的 NetApp SAN storage class（`netapp-san-ssd-dc1`/`dc2`/`dc3`），並問「如果 replica 為 3 就各一個，如果是其他就可以靈活調整」——也就是想要「每個 replica 綁不同 StorageClass（依 DC 分散）」。

**先查證這件事本身能不能做到**：用 `kubectl explain` 查了 `MariaDB` CRD 的 storage 欄位（`spec.storage.storageClassName`、`spec.storage.volumeClaimTemplate`），這些欄位的語意跟 K8s StatefulSet 的 `volumeClaimTemplate` 一致——**同一份 template 套用到每一個 replica 的 PVC，沒有「第幾個 replica 用哪個 StorageClass」這種原生欄位**。這是 StatefulSet/mariadb-operator 本身的限制，不是這個 UI 沒做而已，所以「每個 replica 各自指定 StorageClass」這件事透過這張表單是做不到的。

真正能做到「replica 落在正確 DC」效果的方式，是 K8s 原生的組合技：一個 **topology-aware 的 StorageClass**（`volumeBindingMode: WaitForFirstConsumer` + `allowedTopologies`，讓 PVC 綁定時才依 Pod 排程位置決定要在哪個 DC 建 volume）配合 MariaDB CRD 已有的 `spec.topologySpreadConstraints`，把 replica 分散排到不同 DC 的 node 上。這是叢集/CSI driver 層的設定，不是這張表單能表達的欄位，所以沒有硬做成「看起來能選但實際上做不到」的 UI。

**這次實際做的**：既然精確的「per-replica 指定」做不到，把原本卡死的問題（Storage Class 欄位是寫死的三個選項 `standard`/`csi-hostpath-sc`/`managed-premium`，跟你實際叢集的 storage class 完全對不上）解決掉，讓欄位變得靈活：

- `server.js` 新增 `GET /api/storageclasses`：用 `kubectl get storageclass -o json` 抓叢集上實際存在的 StorageClass（cluster-scoped，不分 namespace），回傳名稱、是否為 default、provisioner。
- `CreateMariaDB.jsx` 的 Storage 步驟把原本寫死選項的 `<Select>` 換成 `<input list="...">` + `<datalist>` 組合：抓到的 StorageClass 會列成建議選項（is-default 的會標註 `(default)`），但輸入框仍然是自由文字，你可以直接打 `netapp-san-ssd-dc1` 這種叢集上有、但 UI 抓取當下可能沒列出來的名稱。
- 當 replicas > 1 時，欄位下方會顯示一段說明卡片，講清楚「這一個 StorageClass 會套用到全部 N 個 replica」以及正確的 DC 分散做法（上面查證的那段），避免你以為選了就會自動分散。

**驗證**：重啟 API server 後 `curl /api/storageclasses` 正常回傳（KIND 叢集上目前只有 `standard`，標記為 default）；用 headless Chrome 走完 Basics → Topology（選 Replication，3 replicas）→ Storage，截圖確認：datalist 正確列出 `standard (default)`、輸入框可以自由打字接受任意值、replicas>1 時的說明卡片正確顯示且文字含 DC 分散建議。沒有 console 錯誤。

## New Instance 精靈：Topology 選項換成 lucide-react 圖示（2026-08-05）

你說「galera 我記得有 icon」——查了一下，Topology 三個選項（Standalone/Replication/Galera Cluster）原本用的是純 Unicode 符號（`○`/`⇌`/`◉`），跟這個面板其他地方（Overview、Pods 等）統一用 `lucide-react` 圖示元件的風格不一致。確認你要的是換成正規圖示（不是 MariaDB/Galera 官方商標 logo）之後，換掉了：

- Standalone → `Server`
- Replication → `GitBranch`（分支圖示，貼近「primary + replicas」的概念）
- Galera Cluster → `Network`（網狀節點圖示，貼近「multi-primary write anywhere」的概念）

圖示外層加了一個跟卡片選中狀態連動的色塊（選中時橘色、未選中時灰色），跟旁邊的選取圓點用同一套配色邏輯，不是另外引入新顏色。用 headless Chrome 截圖確認過三個選項圖示正常顯示、選中狀態的色塊切換正確，沒有 console 錯誤。

## New Instance 精靈：Topology 加上同步模式標籤（2026-08-05）

延續 HA 標籤的討論，你想再加兩個標籤：Replication 標「semi sync」，Galera 標「full sync」。查證後 Galera 的正確說法是 **virtually synchronous**（虛擬同步／certification-based replication），不是嚴格的「full sync」——差異在於：certification 通過後發起端就會回 commit 成功給 client，但這時其他節點不一定已經把資料實際套用到儲存引擎，是背景的 applier thread 非同步套用的；真正的「全同步」要等所有節點都真的寫完才回應。跟你確認過後改用「Virtually Sync」這個講法，跟 MariaDB/Galera 官方文件用詞一致。

**做了什麼**：`TOPOLOGY_OPTIONS` 的 `tags` 陣列再加一個項目——Replication 多了 **Semi Sync**（藍色），Galera 多了 **Virtually Sync**（同樣藍色，跟 Recommended 的橘色、HA 的綠色區分成第三種顏色，語意上是不同維度的資訊，不是排名）。順便把 Galera Cluster 選項本來的描述文字「Synchronous multi-primary write anywhere」也改成「**Virtually synchronous** multi-primary write anywhere」，跟新標籤用詞一致。

用 headless Chrome 截圖確認過：Replication 那排同時顯示 Recommended / High Availability / Semi Sync 三個標籤、Galera 顯示 High Availability / Virtually Sync 兩個，一行內都放得下，沒有跑版或 console 錯誤。

## New Instance 精靈：Topology 標籤加上 HA、Replication 也要有（2026-08-05）

延續上一項的討論——Replication（3 replicas + Auto Failover）本來就是 HA，但畫面上一直只有 Galera 標了「High Availability」，等於暗示 Replication 不算 HA，容易讓人誤會。你要求把 HA 標籤改顏色、Replication 跟 Galera 都要有。

**做了什麼**：`TOPOLOGY_OPTIONS` 從單一 `tag` 欄位改成 `tags` 陣列（可以同時掛多個標籤），Replication 現在同時顯示 **Recommended**（橘色，沿用原本顏色）+ **HA**（新的綠色 `#3fb950`，跟 Recommended 用不同顏色區分開，語意上也比較搭「穩定可靠」）；Galera 標籤從原本較長的「High Availability」文字改短成「HA」，一樣是綠色；Standalone 維持沒有標籤。用 headless Chrome 截圖確認過顯示正常、沒有 console 錯誤。

## New Instance 精靈：Replication/Galera 不該能選 1 個 Replica（2026-08-05）

你問「Replication 這邊還有 1 個 Replicas，那這跟 standalone 有差別嗎？」——查了 operator 自己的 admission webhook（`internal/webhook/v1alpha1/mariadb_webhook.go:104-109`），這其實是一個真的 bug，不是「差別不大」而已：

```go
if mariadb.IsHAEnabled() && mariadb.Spec.Replicas <= 1 {
    return field.Invalid(..., "Multiple replicas must be specified when 'spec.replication' or 'spec.galera' are configured")
}
```

Topology 選 Replication/Galera 但 Replicas 選 1，這個組合會被 operator 直接拒絕（webhook 擋在 admission 階段），送出去就是報錯，不是什麼有效但沒意義的設定。UI 之前卻讓你點得到「1」這個按鈕。

**修法**：非 Standalone 的 Replicas 選項從 `[1,2,3,5,7]` 拿掉「1」，只留 `[2,3,5,7]`；`validate()` 在 Topology 步驟也加了一個對應檢查當防呆（理論上選不到 1 就不會觸發，但保留給以防萬一）。Standalone 那邊本來就不會顯示 Replicas 選擇器（永遠鎖定 1 個），沒有對應問題。

順便回答你另一個問題：Replication + 3 replicas（預設值）+ Auto Failover 本來就是 HA——1 primary + 2 replica，primary 掛了自動 failover，這也是為什麼它被標「Recommended」。Galera 標「High Availability」是另一種模式（同步多主，每個節點都能寫），不代表 Replication 不算 HA。

用 headless Chrome 確認過：Topology 選 Replication 後 Replicas 按鈕列顯示 `2/3/5/7`，預設選中 3，沒有 console 錯誤。

## New Instance 精靈：初始資料庫/帳號 + Metrics 監控帳號（2026-08-05）

你問「metrics 應該也要加密碼欄位吧？還有印象中有個 `mariadb` 帳號的密碼」——查了 `kubectl explain mariadb.spec`，確認 `MariaDB` CRD 原生就支援兩組帳號設定，但精靈跟表單都沒有暴露出來：

- **`spec.username`/`spec.database`/`spec.passwordSecretKeyRef`**：初始資料庫 + 一個對它有 ALL PRIVILEGES 的非 root 帳號，operator 在第一次開機時建立（就是你說的「mariadb 這組帳號」，範例文件裡常設成 `username: mariadb, database: mariadb`）。
- **`spec.metrics.username`/`spec.metrics.passwordSecretKeyRef`**：mysqld-exporter 用來連線的監控帳號。這兩個欄位不填的話 operator 會自動產生一組（先前在 CRDs 分頁看到的 `xxx-metrics` 使用者就是這樣來的），填了就用指定的帳密。

**加了什麼**：Security 步驟新增兩個區塊——
1. 「Initial database & user」（選填）：Database name 留空就跳過整個區塊；一旦填了資料庫名稱，Username + Password + Confirm Password 就變成必填（用跟 Root/Replication 密碼一樣的二次確認機制）。
2. Metrics 開關打開後，多出「Username (optional)」+ Password/Confirm（留空 = 讓 operator 自動管理；填了 Username 才要求密碼）。

Review 步驟也加了對應的摘要列，YAML 預覽（client 端 `buildYAML`）跟實際送出建立用的 server 端 `buildYAML`/`buildSecret` 都同步更新——密碼一樣塞進同一個 Secret（`initial-password`/`metrics-password` 這兩個新 key），跟 root/repl 密碼共用同一份 Secret 物件的既有慣例一致，不是分開建。

**驗證**：實測整趟精靈（填 Database `myapp` + User `myapp`、Metrics 開啟並指定 `metrics_user`），部署成功後 `kubectl get -o yaml` 確認 `spec.username`/`spec.database`/`spec.metrics.username` 都正確寫入，且 operator 真的據此建出了 `initial-user-test-user`（對 `myapp` 資料庫有 ALL PRIVILEGES 的 Grant）跟 `initial-user-test-metrics`（用我們指定的 `metrics_user`，不是自動產生的名字）這兩個 User/Grant CR，Secret 裡三把密碼（root/initial/metrics）都在。測試完的 instance 已經刪除。

## New Instance 精靈：密碼確認 + Backup S3/VolumeSnapshot 支援（2026-08-05）

你回報兩個問題：

**1. Security 步驟密碼沒有二次確認**：`rootPassword`/`replPassword` 各加一個「Confirm」欄位（`rootPasswordConfirm`/`replPasswordConfirm`），`validate()` 在 step 3 檢查兩者是否相符，不符會在 Confirm 欄位下方顯示「Passwords do not match」並擋住 Continue。用 headless Chrome 實測過：故意打不同的密碼，畫面正確擋下並顯示錯誤；改成一致後才能繼續。

**2. Backup 只能用 PVC，沒有 S3(MinIO)／VolumeSnapshot 選項**：
- **New Instance 精靈的 Backup 步驟**：新增「Storage destination」選單（PersistentVolumeClaim / S3），選 S3 後會展開 Endpoint / Bucket / Region / Prefix / Access Key ID / Secret Access Key / Use TLS 欄位，跟 MinIO 或任何 S3-compatible 服務相容。畫面上有註記：VolumeSnapshot 備份要用 `PhysicalBackup` CRD，這個要在 instance 建好之後去 CRDs 分頁另外設定（精靈流程一次只建立 `Backup`，不是 `PhysicalBackup`，`Backup` 這個 CRD 本身不支援 VolumeSnapshot）。
- **CRDs 分頁的 Backup 表單**：一樣加了 S3 選項（+ 選填的 cron 排程欄位）。
- **CRDs 分頁的 Physical Backup 表單**：加了 S3 **跟** VolumeSnapshot 兩個選項（`PhysicalBackup` CRD 本身就支援 `persistentVolumeClaim`/`s3`/`volumeSnapshot`/`azureBlob` 四種 storage backend，這次做了前三種，Azure Blob 沒做）。

**工程細節**：`CreateResourceModal.jsx` 的表單引擎加了 `showIf` 機制（欄位可以宣告一個函式，依其他欄位目前的值決定要不要顯示/驗證/建 Secret），這樣同一個 schema 可以有「選了 S3 才出現」的一組欄位，而不用整組另外複製一份表單。同時修掉一個順便發現的既有 bug：原本一個 schema 如果有兩個以上的 password 欄位，`ctx.secretName` 只會記住最後一個建立的 Secret 名字（單一變數被覆寫），現在改成 `ctx.secretNames`（依欄位 key 分別記錄），`connection` schema 原本依賴舊行為的 `buildSpec` 也一併修正。

**驗證時抓到並修掉的 2 個真的 bug**（不是我自己測試腳本的問題，是先前建這批 CRD 表單時就存在的錯誤，這次認真跑過 `kubectl apply` 才發現）：
1. **Secret 名稱含大寫字母，K8s 拒絕**：S3 的兩個密碼欄位 key 是 `s3AccessKeyId`/`s3SecretAccessKey`（camelCase），自動產生的 Secret 名稱是 `<資源名>-s3AccessKeyId`，但 K8s 物件名稱規定只能小寫——送出時被 API 擋下「The Secret ... is invalid」。修法：`formUtils.js` 加了 `slugify()`，Secret 命名一律先轉成 kebab-case（`s3-access-key-id`），順便也幫「資源名稱」欄位加了格式驗證（只能小寫英數字加 `-`），避免類似問題在其他欄位重演。
2. **Physical Backup 的 Target 選單選項完全是錯的**：原本寫的是 `['Auto', 'Primary', 'Replica']`，但 `PhysicalBackup` CRD 實際只接受 `Replica`/`PreferReplica`——這是最初做 CRD 資源管理那次就記錯的欄位值，一直沒被抓到，因為當時的驗證只有點開表單、沒有真的送出建立。這次比對 `kubectl explain physicalbackup.spec.target` 修正選項跟預設值，並順便重新核對了 schema 裡其他所有 `select` 欄位（`storageType`、`compression`）對照 `kubectl explain`，其餘都正確。

兩個問題都各自建了實際資源驗證過（`crd-s3-backup` 指向 S3、`crd-vs-physicalbackup` 用 VolumeSnapshot），`kubectl get -o yaml` 確認產生的 spec 完全正確，Secret 也確實用小寫命名建出來了。

**過程中的插曲——`my-mariadb-1` 消失了**：驗證到一半發現先前一直在用的示範 instance `test1/my-mariadb-1`（連同底下的 `dmdb-1`/`umdb-1`/`gmdb-1`/`conn-1` 示範資料）從叢集裡不見了。查過 operator log 沒找到正常刪除的 finalizer 紀錄、也排除了 node 資源壓力，一度以為原因不明——**後來確認是使用者自己在 UI 按了 Delete instance**。這也解釋了為什麼 operator log 沒留下痕跡：那個 log 只會在 operator 自己的 finalizer 邏輯觸發時才出現，UI 直接呼叫 `DELETE /api/instances/:namespace/:name` 是另一條路徑，不會留下那種紀錄，不是系統異常。已經另外建了一個乾淨的 `test1/verify-mdb` 測試 instance 完成這次驗證，驗證完沒有刪除，可以直接拿來用或自己清掉。

## 左側導覽欄現況

| 項目 | icon | 對應頁面 | 狀態 |
|---|---|---|---|
| Instances | `LayoutDashboard` | `pages/Dashboard.jsx` | ✅ 已實作——列出所有 MariaDB CR、狀態/複本數統計、篩選、搜尋、建立新實例（`CreateMariaDB.jsx`）、點進去看詳情（`InstanceDetail.jsx`），詳情頁裡現在還有一個「CRDs」分頁管理 9 種資源，見下方「CRD 資源管理」 |
| ~~MaxScale~~ | ~~`Route`~~ | ~~`pages/StandaloneCrdPage.jsx`~~ | 🚫 **2026-08-05 已從導覽移除**，見下方「MaxScale / External DBs 移除」 |
| ~~External DBs~~ | ~~`Globe`~~ | ~~`pages/StandaloneCrdPage.jsx`~~ | 🚫 **2026-08-05 已從導覽移除**，見下方「MaxScale / External DBs 移除」 |
| ~~Helm Values~~ | ~~`SlidersHorizontal`~~ | ~~`pages/HelmValues.jsx`~~ | 🚫 **2026-08-05 已從導覽移除**，見下方「Helm Values 移除」 |
| Activity | `Activity` | `pages/Activity.jsx` | ✅ **2026-08-05 已實作**，見下方「Activity / Docs / Settings 實作紀錄」 |
| Docs | `BookOpen` | `pages/Docs.jsx` | ✅ **2026-08-05 已實作（輕量版）** |
| Settings | `Settings` | `pages/Settings.jsx` | ✅ **2026-08-05 已實作** |

另外側欄本身在 2026-08-05 新增了可收合功能（`Sidebar.jsx` 內部 `collapsed` state + 底部 Collapse/Expand 按鈕），跟這次盤點無關，純 UI 排版功能。

## CRD 資源管理（2026-08-05）

叢集裡 `k8s.mariadb.com` 群組總共 12 個 CRD，扣掉本來就有的 `MariaDB`，把剩下全部 11 個都做進 UI 了：`Database`、`User`、`Grant`、`Backup`、`Restore`、`PhysicalBackup`、`PointInTimeRecovery`、`SqlJob`、`Connection`、`MaxScale`、`ExternalMariaDB`。

**架構決策**：沒有寫 11 份獨立的頁面/API，而是做了一個共用引擎，因為這些本質上都是同一種東西（一個 k8s custom resource，欄位不同而已）：

- **後端**（`ui/server.js`）：`CRD_REGISTRY` 白名單 + 4 個共用 route：
  - `GET /api/crd/:kind?namespace=&ref=&refField=` — 列出某個 kind 的所有資源，`ref`/`refField` 用來過濾出屬於特定 MariaDB instance 的資源（例如只看某個 instance 底下的 Backup）
  - `POST /api/crd/:kind` — 建立，YAML 透過 stdin 餵給 `kubectl apply -f -`（不是字串插值進 shell command）
  - `DELETE /api/crd/:kind/:namespace/:name`
  - `POST /api/secrets` — 建 Secret，給 User/SqlJob/Connection/ExternalMariaDB 的密碼欄位用
  
  這批新 route 特地全部改用 `execFile`（argv 陣列，不經過 shell）而不是既有程式碼慣用的 `exec`（字串插值），因為新增的 11 個 kind 裡有 `SqlJob.spec.sql` 這種會含換行、分號、引號的自由文字欄位，字串插值進 shell command 風險太高；既有的 MariaDB CRUD route 沒有動，維持原樣。

- **前端**：`ui/src/lib/crdSchemas.js` 是唯一的事實來源——每個 CRD 一個宣告式 schema（欄位定義、list 欄位、icon），共用元件 `components/crd/ResourceTab.jsx`（清單+建立按鈕+刪除確認）跟 `components/crd/CreateResourceModal.jsx`（依 schema 動態產生表單，處理密碼欄位→建 Secret→CR 參照 Secret 的完整流程、以及「從現有的其他資源選一個」的下拉選單，例如 Restore 要選 Backup）。之後要再加新 CRD，理論上只要在 `crdSchemas.js` 加一筆設定，不用寫新頁面。

**掛載位置**：
- `Database`/`User`/`Grant`/`Backup`/`Restore`/`PhysicalBackup`/`PointInTimeRecovery`/`SqlJob`/`Connection` 這 9 個都跟著某個 MariaDB instance 走，收在 `InstanceDetail.jsx` 的「CRDs」分頁裡（見下方「InstanceDetail 分頁列改成兩層導覽」）。
- `MaxScale`/`ExternalMariaDB` 原本是不跟單一 instance 綁定、做成側欄兩個獨立頁面（`StandaloneCrdPage.jsx`），**這兩個 2026-08-05 稍後已從導覽移除**，見下方「MaxScale / External DBs 移除」。

**驗證**：用 headless Chrome 實際跑過完整流程，不只是點開頁面而已——在真的叢集上對著 `test1/my-mariadb-1` 這個 instance 建立了 `Database`（`dmdb-1`）、`User`（`umdb-1`，含密碼建 Secret）、`Grant`（`gmdb-1`，multiselect 權限）、`Backup`（`backup-1`，真的觸發了 backup job 並跑完成功）、`Connection`（`conn-1`），並確認 Restore 的下拉選單真的抓到剛建立的 `backup-1` 當選項（ref-select 機制）。每一步都額外用 `kubectl get` 或 `kubectl exec` 對照真實叢集狀態，不只信任 UI 畫面——全部 `READY: True` / `STATUS: Created`，證明不只是建出一個 K8s object，operator 真的把它 reconcile 到底層 MariaDB 裡了。

**過程中抓到並修掉的問題**：
1. **Status 欄位顯示 `[object Object]`**——`ResourceTab.jsx` 一開始沒有欄位是 `status` 時的預設 render function，5 個 schema（Database/User/Grant/Connection/ExternalMariaDB）沒特別指定 render，就把整個 `status.conditions` 物件硬轉成字串顯示。修法：`status` 欄位沒指定 render 時預設套用 `statusFromConditions`，順手把另外 6 個 schema 裡重複寫的 `render: statusFromConditions` 也清掉。
2. **SqlJob 建立後一直 crash-loop**——實測用一個沒填 `database` 欄位的 `CREATE TABLE` 語句建了個 SqlJob，operator 端報 `ERROR 1046: No database selected`。這不是 UI 的 bug（`database` 欄位在 CRD schema 裡本來就是選填），是操作上的真實限制——大多數 SQL 語句沒有 `USE`/完整限定表名的話就是需要指定 database。把欄位說明文字改清楚（`Required unless your SQL fully-qualifies table names or starts with its own USE statement`），並刪掉那個測試用的失敗 SqlJob，避免它一直重試佔著 pod。

**目前留在 `test1` 叢集裡的測試資料**（都是照著你原本訊息裡的例子命名，可以直接當範例用，也可以自己刪掉重建）：`dmdb-1`（Database）、`umdb-1`（User）、`gmdb-1`（Grant）、`backup-1`（Backup，已成功完成）、`conn-1`（Connection）。

## New Instance 精靈支援排程備份（2026-08-05）

`Backup`/`PhysicalBackup` 這兩個 CRD 本身就支援 `spec.schedule.cron`（operator 會據此在底層建一個真正的 K8s CronJob，語法完全是標準 cron），不是只能一次性備份。做了兩件事：

1. **既有的 Backup／Physical Backup 建立表單**（`InstanceDetail.jsx` 分頁）加了一個選填的「Recurring schedule (cron)」欄位——留空就是原本的一次性備份，填了就會建立排程備份。
2. **New Instance 精靈**（`CreateMariaDB.jsx`）新增第 5 步「Backup」，可以在建立 MariaDB 的同時，順便把第一個排程備份也設好：
   - 一個 Toggle 開關（預設關閉，不影響原本沒有備份需求的人）
   - Schedule 下拉選單提供三個常見預設（Every 6 hours / Daily at 03:00 / Weekly Sunday 03:00）+ Custom（跳出 cron 文字框自己填，有基本的 5 欄位格式驗證）
   - Backup storage size / Compression，跟獨立的 Backup 表單欄位一致
   - Review 步驟會列出「Scheduled backup: `<cron>` (`<size>`)」這一行，部署結果視窗也會多一行「Scheduled Backup "xxx-backup" applied (`<cron>`)」

**實作方式**：沒有把這個塞進 MariaDB 的 spec（`MariaDB` CRD本身沒有內建 backup 欄位）——`/api/deploy` 在 MariaDB CR 部署成功後，若 `backupEnabled` 為真，額外用同一個 `buildCRYAML` helper（CRD 管理那批功能已經寫好的）建一個 `<name>-backup` 的獨立 `Backup` CR，`mariaDbRef` 指回剛建立的 instance。跟直接在 Backups 分頁手動建的排程備份是完全一樣的機制，只是精靈幫你在建 instance 的同一個流程裡順便做掉。

**驗證**：實際跑過整個精靈（Basics → Topology(Standalone) → Storage → Security → **Backup(啟用, Weekly)** → Review → Deploy），部署結果視窗正確顯示 4 個完成步驟，`kubectl get backup` 確認 CR 的 `spec.schedule.cron` 是 `0 3 * * 0`，且 `kubectl get cronjob` 證實 operator 真的在底層建出了排程正確的 CronJob（`SCHEDULE: 0 3 * * 0`）。測試用的 instance 驗證完就刪掉了，沒有留在叢集裡。

## InstanceDetail 分頁列改成兩層導覽（2026-08-05）

上面「CRD 資源管理」那次把 9 個 CRD 分頁全部攤平加進 `InstanceDetail.jsx` 頂層分頁列，加上原本的 5 個（Overview/Pods/Replication/Services/TLS）跟 Events，總共 15 個分頁塞在一排，超寬需要橫向捲動，你回報「太長了往右拉也不太方便」。

**改法**：9 個 CRD 分頁收進單一個頂層分頁，裡面用一排次分頁（pill 樣式的按鈕列，`CrdsPanel` 元件）切換 Databases/Users/Grants/Backups/Restores/Physical Backups/PITR/SQL Jobs/Connections，預設開著第一個（Databases）。頂層分頁列從 15 個變成 7 個（Overview/Pods/Replication/Services/TLS/**CRDs**/Events），一行就放得下，不用捲動；次分頁列本身也還是照 `INSTANCE_CRD_TABS` 陣列動態產生，加新 CRD 一樣只要改 `crdSchemas.js`，不用碰這個檔案。

原本頂層分頁列的 `overflow-x-auto` 也一併拿掉了（不再需要，順便把可能的橫向捲動殘留行為清掉）。

**命名微調**：這個新分頁最初取名「Resources」，但你指出 Overview 分頁裡本來就有一張「Resources」卡片（顯示 CPU/Memory request-limit），兩個 Resources 意思完全不同，容易搞混。改名叫「**CRDs**」——你自己一開始提出這整批功能需求時，就是用「CRDs」這個詞在講這件事，直接沿用，不會再跟 Overview 的 Resources 卡片撞名。程式碼裡對應把 `ResourcesPanel` 元件也改名成 `CrdsPanel`，內部 tab id 從 `'resources'` 改成 `'crds'`。

用 headless Chrome 驗證過：頂層 7 個分頁一行顯示（含改名後的「CRDs」）、點進去次分頁列出現且預設在 Databases、切到 Grants 正確顯示 3 筆資料（含之前建的 `gmdb-1`），沒有 console 錯誤。

## MaxScale / External DBs 移除（2026-08-05）

這兩個是「CRD 資源管理」那次做的 11 個 CRD 裡，唯二不掛在某個 MariaDB instance 底下、獨立放在側欄的（`MaxScale`、`ExternalMariaDB`）。你確認目前不需要提供這兩個功能，所以拿掉了。

**做了什麼**（跟 Helm Values 移除同一套處理方式——只拆導覽入口，不刪程式碼）：
- `ui/src/components/Sidebar.jsx`：`nav` 陣列移除 `maxscale`/`externalmariadb` 這兩個項目。
- `ui/src/App.jsx`：移除對應的 `StandaloneCrdPage` render 分支跟現在用不到的 import（`StandaloneCrdPage`、`CRD_SCHEMAS`）。

**沒有動的**：`ui/src/pages/StandaloneCrdPage.jsx` 本體、`crdSchemas.js` 裡的 `maxscale`/`externalmariadb` schema、後端通用的 `/api/crd/:kind` 系列 route 都還在——這兩個 schema 本來就是靠同一套通用引擎驅動，之後要重新開放的話，把上面兩處 nav/route 加回去就好，不用重寫。

用 headless Chrome 截圖確認過：側欄剩 Instances / Activity / Docs / Settings 四項，沒有殘留的空白分頁或 console 錯誤。

## Helm Values 移除（2026-08-05）

**原因**：這個頁面對應 `server.js` 的 `POST /api/helm/upgrade`，實作是直接執行：

```js
exec(`helm upgrade ${HELM_RELEASE_NAME} ${HELM_CHART_PATH} -n ${HELM_RELEASE_NAMESPACE} -f -`, ...)
```

也就是**點一下畫面上的按鈕，就會對正在跑的 mariadb-operator 本尊下 `helm upgrade`**——會直接改到 operator 自己的 Deployment/RBAC/replica 數/資源限制等，而且檢查過 `HelmValues.jsx` 前端，**送出前沒有任何 `confirm()` 或二次確認的 UI 流程**。這種「UI 直接動到 operator 自己」的動作影響面大、不易復原（helm upgrade 失敗可能卡在 pending-upgrade 狀態），在還沒確定要不要開放之前先從導覽拿掉，避免誤觸。

**做了什麼**：
- `ui/src/components/Sidebar.jsx`：`nav` 陣列移除 `{ id: 'helm', ... }` 項目。
- `ui/src/App.jsx`：移除 `import HelmValues` 跟 `{page === 'helm' && <HelmValues />}` 這個 render 分支。

**沒有動的**：
- `ui/src/pages/HelmValues.jsx` 本體、`server.js` 的 `/api/helm/values`（GET，唯讀）跟 `/api/helm/upgrade`（POST，會寫）都還在，只是前端沒有入口可以點進去了。要重新開放的話把上面兩處 nav/route 加回來即可，程式碼都還在。

**之後若要重新開放，建議至少加上**：
1. 送出前的二次確認 modal（列出這次 diff 會改哪些欄位，不要只是一個 submit 按鈕）。
2. 是否要做成「唯讀檢視 + 產生指令讓人手動跑」而不是 UI 直接執行 `helm upgrade`，把最後一步的執行權留在人手上。
3. `/api/helm/upgrade` 目前完全沒有輸入驗證/白名單，任何 `req.body` 都會被轉成 YAML 塞進 `helm upgrade -f -`，等於是把整份 values.yaml 開放給前端任意覆寫——重新開放前這塊也該一併收斂。

## Activity / Docs / Settings 實作紀錄（2026-08-05）

三個都照原本的提案實作了，全部唯讀或純前端 state，沒有動到任何會寫入 operator/叢集設定的東西。用 headless Chrome 實際點過三個頁面（含 Settings 的 Save → reload → Instances 套用預設 namespace 這條完整路徑）截圖驗證過，畫面正常、Console 無錯誤。

### Activity — `pages/Activity.jsx` + `server.js: GET /api/events`

新增的 `/api/events` 邏輯：先 `kubectl get mariadb -A` 拿到目前所有 instance 的 `{name, namespace}`，再 `kubectl get events -A`，用跟既有單一 instance 版一樣的「`involvedObject.name` 以 instance name 開頭」規則做過濾，只是套用到每一個已知 instance、跨所有 namespace，取最近 50 筆。純 `GET`，不寫入任何東西。

前端沿用 `EventsTab`（`InstanceDetail.jsx`）的表格視覺風格，多加了 Namespace 欄位；上方有 Namespace / Type（Normal/Warning）兩個篩選下拉，跟 `Dashboard` 一樣接了 `useAutoRefresh` + `CountdownRing` 做自動刷新（間隔吃 `Settings` 頁存的 `refreshInterval`）。

目前叢集裡沒有任何 MariaDB instance，所以畫面是「No recent events.」的空狀態——這是預期行為，不是 bug。

### Docs — `pages/Docs.jsx`（輕量版）

純靜態連結卡片，四個分類（Getting started / Topology / Operations / Connectivity & security），共 18 個連結，全部指到 `https://github.com/arthurking87/mariadb-operator/blob/main/docs/<file>`，`target="_blank"` 開新分頁。沒有加後端 API，也沒有加 `react-markdown` 依賴——如果之後要做「站內直接 render markdown」的進階版，需要另外評估加這個套件。

### Settings — `pages/Settings.jsx` + `src/lib/settings.js` + `server.js: GET /api/connection`

- `src/lib/settings.js`：`getSettings()`/`setSettings()`/`resetSettings()`，存在 `localStorage` 的 `mariadb-ui:settings` key，目前兩個欄位：`refreshInterval`（秒，預設 10）、`defaultNamespace`（預設空字串）。
- `Settings.jsx` 上半部是這兩個欄位的表單 + Save / Reset to defaults；下半部是唯讀的「Connection」卡片，打新增的 `GET /api/connection`（回傳 `kubectl config current-context` + server 端的 `HELM_RELEASE_NAME`/`HELM_RELEASE_NAMESPACE`），方便確認這個 UI 到底連到哪個 release/叢集。
- 實際把設定接回去用了，不是純裝飾：`Dashboard.jsx` 的 `useAutoRefresh(fetchInstances)` 改成 `useAutoRefresh(fetchInstances, getSettings().refreshInterval)`，`filterNamespace` 的初始值改成 `getSettings().defaultNamespace`；`Activity.jsx` 的自動刷新間隔也吃同一個設定。改動只在頁面載入時讀一次（不是即時反應式），存檔後**下次打開該頁面才生效**，Settings 頁面上有寫這句提示。
- 刻意沒做的：主題切換（提案裡就說工程量大，先不做）；沒有把 operator 的 replica 數/資源限制等塞進來——維持跟 Helm Values 的切割。

## 待決事項

1. Docs 要不要之後升級成進階版（站內 render markdown）？需要新增 `react-markdown` 依賴，目前先維持純連結版本。
2. Helm Values 之後重新開放的時間點跟條件（例如：先加二次確認 modal + 輸入驗證，才考慮重新掛回導覽欄）。
3. `ui/server.js` 目前是手動重啟 API server 才會載入到新 route（`node server.js` 沒有像 Vite 一樣的 HMR）——這次開發時就因為忘記重啟而讓新頁面短暫 404 過。之後如果要常態開發後端，可以考慮加 `nodemon`（目前 `package.json` 沒有這個 devDependency）。
