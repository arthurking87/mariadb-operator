# PMM 追蹤（Percona Monitoring and Management 相關筆記）

> 產生日期：2026-08-11。記錄跟 PMM（Percona Monitoring and Management）用法、架構相關的討論，供之後接續參考，不是正式文件。

## PMM Server 安裝與存取方式（2026-08-11）

PMM Server 不 vendor 在這個 repo 裡，透過 Percona 官方 Helm repo 安裝：

```bash
helm repo add percona https://percona.github.io/percona-helm-charts/
helm repo update percona
helm install pmm-server percona/pmm --namespace <namespace>
```

預設用 `NodePort` Service（`monitoring-service`）+ cluster 的預設 StorageClass 掛 `pmm-storage` PVC——在 KIND cluster 上如果有預設 StorageClass，不需要額外 `--set` 參數。

取得存取網址與 admin 密碼：

```bash
export NODE_PORT=$(kubectl get --namespace <namespace> -o jsonpath="{.spec.ports[0].nodePort}" services monitoring-service)
export NODE_IP=$(kubectl get nodes -o jsonpath="{.items[0].status.addresses[0].address}")
echo https://$NODE_IP:$NODE_PORT

export ADMIN_PASS=$(kubectl get secret pmm-secret --namespace <namespace> -o jsonpath='{.data.PMM_ADMIN_PASSWORD}' | base64 --decode)
```

這個 repo 的 UI（`ui/src/pages/CreateMariaDB.jsx`）另外做了「Percona PMM Monitoring」這個 New Instance 精靈步驟，會在 MariaDB pod 裡加一個 `pmm-client` sidecar 去註冊到既有的 PMM Server（連 query analytics/dashboards），前提是 PMM Server 已經在叢集可達的地方跑起來——這個開關**只接 agent，不會幫你部署 PMM Server 本身**。

## 討論：Advisor 是否一定要 pmm-agent 放在 pod 內當 sidecar（2026-08-11）

問題：PMM 的 Advisor 功能，是不是一定要把 pmm-agent 部署成跟 DB 同一個 pod 的 sidecar？

**結論：不是必要條件。**

Advisor 是跑在 **PMM Server** 端的排程檢查機制，透過已註冊的 service 執行 SQL 查詢（讀 `performance_schema`、`information_schema`、變數設定等）。它依賴的是「pmm-agent 有沒有一條通往該 DB 的可用連線」，不是 agent 放在哪個 pod。

三種常見放法，Advisor 都能用：

| 方式 | 說明 | Advisor 可用性 |
|---|---|---|
| Sidecar（這個 repo UI 目前的做法） | pmm-agent 跟 mariadb 同 pod，走 `127.0.0.1:3306` | 可用 |
| Remote instance | PMM Server 直接註冊一個外部可達的 MySQL/MariaDB endpoint，不需要在目標旁邊部署 agent | 可用，只要網路連得到、權限夠 |
| 集中式 pmm-client（DaemonSet 或獨立 Deployment） | 一個 pmm-agent 透過網路連到多個 DB 實例 | 可用 |

**Sidecar 是 Kubernetes 環境下建議、但非強制的模式**，原因跟 `ui/src/pages/CreateMariaDB.jsx:509-511` 的既有註解一致：走 localhost 連線可以只開本地帳號權限（`SELECT, PROCESS, REPLICATION CLIENT, RELOAD`），不用把 DB port 對外曝露，省去額外 Service/NetworkPolicy 設定。改用 remote 註冊方式的話，DB port 要網路可達，且帳號要能接受遠端連線（`'%'` 或特定 CIDR 的 grant），權限清單則相同。

所以 Advisor 只認「service 是否已註冊且 agent 連得到」，跟 agent 是不是 sidecar 無關；sidecar 只是這個專案為了簡化憑證與網路曝露面而選的部署模式。

## 實作：在 test-db-1 上用 Remote instance 註冊（不加 sidecar）（2026-08-11）

你明確表示不想用 sidecar 方式，所以改走上面表格裡的「Remote instance」路線——不改 `test-db-1` 這個 MariaDB CR 的任何欄位、不觸發 rolling restart，純粹讓 **PMM Server 自己**（它內建一個 agent_id 固定叫 `pmm-server` 的 pmm-agent，每套 PMM Server 都自帶，用途就是做這種 agentless 遠端註冊）透過網路直接連到 `test-db-1-primary.test1.svc.cluster.local:3306`。

**帳號**：一開始查了要不要另外建 `pmm`@`%` 專用帳號，後來確認 `test-db-1` 的 `root` 帳號 operator 預設就是 `root@'%'`（不是綁 `localhost`），本來就連得到，你選擇直接用 root 省掉建帳號那步——取捨是 root 密碼會存進 PMM Server 的 Inventory DB，權限遠超過監控實際需要的 `SELECT/PROCESS/REPLICATION CLIENT/RELOAD`，但這是純測試叢集，可接受。

**UI 路徑更正**：一開始我憑記憶講成 PMM 2 時代的「PMM Configuration → Add Instance」，你指出實際是 PMM 3 的「**PMM Inventory → Services → Add Service → 選 service type**」——你的說法才對，PMM 3 把這塊導覽重新整理過了。不管走哪個選單標籤，底層都是同一個 Inventory API，欄位一樣是 Hostname/Port/Username/Password/Service name/Query Source（選 Performance Schema，Remote 模式下 Slow Log 抓不到檔案不能選）。

**驗證**（打 PMM Server 的 Inventory API 直接查，不只信任 UI 畫面）：
```bash
curl -sk -u admin:"$ADMIN_PASS" https://<NODE_IP>:<NODE_PORT>/v1/inventory/services
curl -sk -u admin:"$ADMIN_PASS" https://<NODE_IP>:<NODE_PORT>/v1/inventory/agents
```
確認 `test-db`（service_name）成功掛進 `mysql` 清單，`address: test-db-1-primary.test1.svc.cluster.local`；底下 `mysqld_exporter`（抓 299 張表 metrics）跟 `qan_mysql_perfschema_agent`（Query Analytics）兩個 agent 都是 `AGENT_STATUS_RUNNING`，`username: root`。

## 模擬真實使用者操作，驗證 Advisor/QAN 真的有東西可看（2026-08-11）

你問能不能故意操作 DB（建 database/table、寫 SQL）模擬使用者行為，讓 Advisor/QAN 有真實資料可分析，不是空的 service。查了 `test-db-1` 當時只有系統 schema，是張乾淨的白紙，直接動手：

**建的東西**（`shop_demo` schema，SQL 存在 `/tmp/.../scratchpad/pmm_demo_seed.sql`）：
- `customers`（500 筆）、`orders`（1500 筆，`customer_id` 有索引）——正常寫法對照組。
- `visitor_log`（3000 筆）——**刻意不設 PRIMARY KEY**，常見 Advisor/Skeema 類 linter 會抓的反模式。
- `legacy_notes`（一開始只 3 筆）——**刻意用 MyISAM engine + 舊版 utf8（不是 utf8mb4）**，另一個常見反模式。
- 額外跑了幾條刻意低效的查詢：`LIKE '%checkout%'`（leading wildcard，不可能走索引）、`orders.status` 無索引欄位的 `COUNT(*)`、`customers JOIN orders GROUP BY ... ORDER BY 計算欄位 LIMIT`（會逼 MariaDB 建暫存表排序）。

**Advisor 實際抓到的兩個 finding，逐一解讀**：
- `mysql_performance_temp_ondisk_table_high`（Error）——**真訊號**。對應到那條 `GROUP BY`+`ORDER BY total_spent`（算出來的欄位，不可能有索引）的查詢，MariaDB 只能先建暫存表排序，資料量超過 `tmp_table_size`/`max_heap_table_size`（這個 cluster 沒調過，用預設值）就會降級成硬碟上的 Aria/MyISAM 暫存表，比記憶體內慢一個量級。>11% 查詢比例觸發這個 Error 級別是合理的，不是誤報。
- `mysql_indexes_larger`（Warning，`shop_demo.legacy_notes`）——**當下是假訊號**。3 筆極短資料的實際 data size 遠小於 InnoDB/MyISAM 的最小分頁配置（一頁至少 16KB），PK 索引本身也至少佔一頁，所以「index > data」在資料量小到這種程度時幾乎必然成立，跟索引設計好壞無關；這條 check 只有在真正有大量資料的表上才有參考價值。

**驗證假設**：追加灌了 5,000 筆較長內容（每筆約 500 bytes）進 `legacy_notes`，`information_schema.tables` 查出來 `data_length` 從遠小於 `index_length` 反轉成 **2.04 MB data vs 0.05 MB index**，證實剛剛的假設——index 大小幾乎不隨資料內容變化（就是一個 auto_increment PK），data 大小才會隨真實資料量成長。重新跑一次 Advisor check 後，`mysql_indexes_larger` 這條應該會消失，交叉驗證了它先前只是「表太小」的量測假象，不是真的設計缺陷。

## 討論：正式環境（PMM Server 3.2.0）出現「pmm-agent with ID pmm-server is not currently connected」（2026-08-11，進行中）

你回報在**另一套（非這個 KIND 測試叢集）真實環境**、PMM Server 版本 3.2.0，透過 UI 的 PMM Inventory/Services 加 MySQL service 時，跳出這個錯誤。你一開始的理解是「pmm-server pod 連不到你填的目標 hostname（例如 `test-db-1-primary.test1.svc.cluster.local`）」——這個理解**不對**，已經在對話裡澄清：

這條錯誤講的是 **①pmm-agent（內嵌在 PMM Server 容器裡，agent_id 固定叫 `pmm-server`）↔ pmm-managed（PMM Server 的控制平面）之間的內部 gRPC 連線**，不是 **②pmm-agent → 你填的目標 MySQL** 那條監控連線。①是容器/pod 內部走 localhost 的連線，只要①斷著，UI 在新增任何 service 的前置檢查就會擋下來、報同一句話，跟你填的 hostname/port/帳密完全無關，即使②那條路真的連得到也一樣會被擋。如果是②斷了，PMM 會給完全不同的錯誤（`dial tcp ...: connection refused` 之類），不會提到「pmm-agent ... is not currently connected」。

**可疑方向排序**（尚未確認,等你的 log）：
1. 版本差異——這裡驗證通的是 PMM Server 3.9.0，你的正式環境是 3.2.0，PMM3 系列早期版本這類內嵌 agent 自連穩定性問題不算罕見，值得查 changelog。
2. 內嵌 `pmm-agent` process 本身掛了/沒起來——`supervisorctl status` 看是否 `RUNNING`。
3. PMM Server 容器資源不足被 OOM/反覆重啟，導致內嵌 agent 連上又斷。
4. PVC/資料卷重用造成 inventory DB 裡的 agent 紀錄跟目前 runtime 對不上（例如舊 volume 沿用到新版本/新容器）。

**下一步**：你說要貼 `supervisorctl status` 輸出跟 `pmm-agent.log` 內容過來，這輪對話還沒貼，待收到後再往下查。
