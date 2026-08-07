# UI 追蹤（ui/ — mariadb-operator 管理面板）

> 產生日期：2026-08-05。記錄 `ui/` 這個 React + Express 小面板的現況、異動決策，以及尚未實作項目的規劃討論。
> 面板結構：`ui/src/App.jsx`（路由）+ `ui/src/components/Sidebar.jsx`（左側導覽）+ `ui/src/pages/*.jsx`（各頁）+ `ui/server.js`（Express API，包在同一個容器內用 `kubectl`/`helm` 操作叢集）。

## 視覺美化：用 agent 當「UI 美術家」、我當設計師互動執行（2026-08-07）

你要求開一個 agent 當 UI 美術家、我當設計師跟它互動修改 UI。流程：我先自己截了 Dashboard/Overview/Replication 三個現況畫面當「設計師審視現況」，抓出具體批評（不是憑空講「要更好看」）——整個 app 每個區塊都用同一種深色卡片＋細邊框，缺乏層次；橘色 `#f97316` 是唯一在做「這是重要/可互動」訊號的顏色；`crdSchemas.js` 裡每個 CRD 其實早就定義了自己的 `accent` 色（Database 藍、User 綠、Grant 紫、Backup 橘...），但幾乎沒被用到 CRD 分頁小圖示以外的地方；Config Health 清單裡失敗項目只靠圖示顏色差異提示，掃視不夠快。

**開 agent 的方式**：用 `isolation: worktree` 讓它在獨立的 git worktree 裡工作，不會動到我正在跑的 dev server / 正在測試的畫面。給它的 prompt 明確列出現有的色彩系統（每個 hex 值、既有的 class/style pattern）、上述五點批評、以及「這是純視覺 polish，不能動路由/資料邏輯/新增套件，改完要 `vite build` 過、不能新增超出既有基準線的 lint 問題、要截圖驗證」的限制——刻意不給它逐一像素級的指令，而是給批評+方向，讓它自己判斷怎麼執行，比較接近真的請一個美術家做事，不是我自己動手只是換個人打字。

**agent 的產出**（`Dashboard.jsx`/`Backups.jsx`/`InstanceDetail.jsx` 三個檔案）：
1. Dashboard/Backups 的統計卡片改成「抬升表面色」`#1a2028`（相對於全站標準的 `#161b22`）+ 左側 3px accent 色條 + 角落極淡的放射狀色暈，四張卡片依各自意義（Total Instances 藍、Running 綠、Total Replicas 橘、Namespaces 紫）變得一眼可辨，不再是四個一模一樣的灰盒子。
2. Config Health 清單：失敗的那一行現在整行帶琥珀色調底色＋左側 2px 色條＋文字加粗變亮，通過的行反而收斂成灰色文字——不用逐行讀就能一眼抓到問題在哪。
3. CRDs 分頁的 kind 選單（Databases/Users/Grants/...）：選中的分頁現在會亮成**那個 CRD 自己的** accent 色（User 綠、Grant 紫...），不是每個都亮橘色——這是「既有色彩系統幾乎沒被用到」這條批評最直接的落地案例，色彩本來就在 `crdSchemas.js` 裡定義好了，只是沒被接上。
4. 每個頁面標題旁加了一個比行內圖示（12-15px）明顯更大更粗的 20px 圖示徽章，給頁面一個視覺錨點。
5. `Backups.jsx` 的統計卡片同時支援 `tone`（danger/warn/ok 警示色）跟 `accent`（CRD 身份色）兩種著色依據，**tone 優先**——這樣「No schedule」這種警示數字還是會正確顯示警示色，不會被身份色蓋掉，語意判斷是對的，不是機械套用同一套規則。

**我（設計師）審查**：沒有直接信任 agent 的文字總結，實際打開它附的 before/after 截圖逐張看過，也讀了三個檔案的實際 diff（不是重新讀整份檔案，只看變更片段）確認程式碼品質——註解清楚交代「為什麼」而非「做了什麼」，跟這個 repo 一路以來的慣例一致；色彩選擇全部複用既有系統的值，沒有發明新顏色；`tone` 優先於 `accent` 這種語意判斷也做對了。滿意後才把三個檔案從它的 worktree複製回主要工作目錄。

**驗證**（在我自己的工作目錄，接真的 KIND 叢集資料，不只信任 agent 自己在 worktree 裡的驗證）：`vite build` 過；三個檔案的 eslint 輸出跟這次改動前的基準線逐項比對，沒有新增任何問題；headless Chrome 對著真實 `test1/test-db-1` 重新截圖，確認 Config Health 失敗行的視覺效果、CRDs 分頁的 accent 色切換都在真實資料下正確顯示，console 全程無錯誤。完成後刪除 agent 用過的 worktree 跟對應分支，不留殘留物。

## 視覺美化 Round 2：字級/圖示分級系統化 + 剩餘頁面補齊（2026-08-07）

你問「所有頁面都依照這樣來修改一遍，我覺得字體大小跟一些 icon 是否都有更好選擇？」——上一輪只動了 Dashboard/Backups/InstanceDetail 三個檔案，這輪要求擴散到全站，並且specifically 重新檢視字級跟圖示尺寸有沒有更好的規則，不是只憑感覺調。

**先自己做設計稽核，量化問題**（不是憑印象講「字太小」）：
- 全站 `text-xs`/`text-sm`/`text-base`/`text-lg`/`text-xl`/`text-2xl`/`text-3xl` 用量：`257 text-xs, 172 text-sm, 9 text-xl, 8 text-base, 4 text-2xl, 2 text-lg`——452 處裡 429 處（95%）擠在 xs/sm 兩級，頁面標題、區塊標題、內文全部同一個尺寸級距，區塊標題（如「Config Health」）跟內文的唯一差異只有 `font-semibold`，字級本身沒有拉開層次。
- 圖示 `size=` 用量：`4×10, 26×11, 21×12, 45×13, 43×14, 24×15, 9×16, 6×18, 1×19, 7×20, 6×24, 1×28, 1×32`——13 種不同像素值同時存在，沒有明確分級。

**定出的規則**（作為這輪套用的基準，不是每一處機械套用，允許有理由的例外）：
- 字級：頁面標題 `text-xl`→`text-2xl`；區塊標題（表格/卡片群組上方那種 `<h2>`）`text-sm font-semibold`→`text-base font-semibold`；內文/表單/說明文字維持 `text-sm`；密集資料（表格內文、badge、時間戳）維持 `text-xs` 不動——這個級距本來就適合表格密度。
- 圖示：頁面標題徽章 `20px`（沿用 round 1 已經定的值）；區塊標題圖示統一收斂到 `16px`（round 1 混用了 15/16，這輪統一）；行內/表格列圖示收斂到 `13px`；小型 badge/chip 內圖示收斂到 `11-12px`；空狀態大圖示自成一級，收斂到 `24px`（原本 28/32 的離群值往下收，不強迫變得跟行內圖示一樣小）。

**執行方式**：跟 round 1 一樣開 `isolation: worktree` 的 agent，這次 prompt 除了上面兩條規則，還列了尚未套用 round 1 視覺語言的頁面清單（Capacity/Switchover/Activity/Docs/Settings/CreateMariaDB/StandaloneCrdPage/HelmValues，以及 InstanceDetail 剩下的 Pods/Replication/Services/TLS/Events/Resilience 分頁），要求：區塊標題/圖示套規則、缺頁面標題徽章的頁面補上（顏色從既有調色盤挑一個跟該頁面既有主題色不衝突的，不能發明新 hex）、有「hero 統計列」的頁面（查出 `Capacity.jsx` 確實有）套用 round 1 同一套 raised-surface + accent 色條卡片樣式。

**agent 的產出跟我的判斷**（逐檔讀 diff 確認，不是只看它的文字總結）：
- 15 個檔案改動，全部乾淨對應上述規則，沒有夾帶功能/路由/資料邏輯改動。
- 頁面徽章顏色選得有道理：Capacity 用綠色（跟 Dashboard 藍、Backups 橘區隔開）；Switchover 用琥珀色（呼應這頁本來就在用的「switching」狀態色，不是隨便挑一個沒用過的顏色）；Activity 用紫色；Docs/Settings 兩個次要頁面刻意用中性灰徽章，不硬套一個強調色——這個判斷是對的，不是每頁都得五顏六色。
- Dashboard 的 hero 數字額外從 `text-2xl` 再拉到 `text-3xl`（這是全站唯一的「headline 數字」），agent 有先截圖確認沒有跟四欄網格擠壓才定案，不是盲目套用。
- 誠實回報了兩個發現：`HelmValues.jsx`、`StandaloneCrdPage.jsx` 這兩個頁面其實**沒有掛在 `App.jsx` 的路由裡**（呼應本文件更早之前「MaxScale/External DBs 移除」「Helm Values 移除」兩次決策——拿掉的是導覽入口，程式碼本來就還在），所以只做了輕量的字級/圖示收斂，沒有幫 `HelmValues.jsx` 加頁面徽章，因為那是個進不去的頁面，加了也沒意義。
- `CreateMariaDB.jsx`（New Instance 精靈）刻意沒加頁面標題徽章——這頁用的是 breadcrumb + 步驟指示器，agent 判斷硬塞一個徽章會跟步驟指示器搶視覺，只做了字級/圖示收斂，這個克制是對的。
- 圖示「選擇」（不只是尺寸）審查過一輪，結論是既有選擇（Gauge/Archive/ArrowRightLeft 等）都已經是合理的圖示，沒有做任何圖示替換。

**我的審查**：15 個檔案的 diff 全部逐一讀過（用 `diff` 對 worktree 版本跟主要工作目錄版本，不是重新整份重讀），改動都對應到上面定的規則，沒有夾帶跟本次任務無關的改動；也讀了 19 張截圖，確認實際畫面上字級層次確實比之前清楚（頁面標題跟區塊標題現在一眼可辨），色彩選擇沒有跳脫既有調色盤。

**驗證**（一樣在我自己的工作目錄重跑，不只信任 agent 在 worktree 裡的驗證）：`vite build` 過，零錯誤（唯一警告是既有的 chunk size 過大提示，跟這次改動無關）；`dist/` 本來就在 `.gitignore`，沒有殘留產物。完成後刪除 agent 用過的 worktree 跟對應分支。

## 資料密集頁面改成響應寬螢幕，表單/文字頁面維持原寬度（2026-08-07）

你發現每頁內容大小不會跟著視窗變大變寬——查了確認每一頁最外層容器都是同一套 `px-8 py-8 max-w-Nxl mx-auto` pattern（`Dashboard`/`Backups`/`Capacity`/`Activity` 是 `max-w-6xl`=1152px，`InstanceDetail`/`Switchover` 是 `max-w-5xl`=1024px），在一般筆電螢幕（1400px 左右）看不太出來，但截圖實測 2560px 寬螢幕後，`test-db-1` 的 Pods 分頁右邊真的空出超過一半畫面。

**判斷**：沒有把所有頁面的寬度限制整個拿掉，分兩類處理——

- **表格/資料密集頁面**（Dashboard、InstanceDetail、Backups、Capacity、Activity、Switchover、StandaloneCrdPage）：`max-w-6xl`/`max-w-5xl` 全部改成 `max-w-[1800px]`，這類頁面內容主要是表格/卡片，越寬越好用，尤其這幾輪加了不少新欄位（Services 的 Endpoints、Pods 的 Logs 按鈕、Permissions 矩陣）。
- **文字/表單類頁面維持原樣不動**：`Docs.jsx`（連結卡片索引，`max-w-6xl` 對這種內容已經夠用）、`Settings.jsx`（`max-w-2xl` 表單）、`CreateMariaDB.jsx`（`max-w-3xl` 精靈表單）、`HelmValues.jsx`（本來就已從導覽移除，不動）——這幾類東西拉滿版反而更難讀/難填，窄一點、置中對齊才好掃視。

`max-w-[1800px]` 而不是完全拿掉上限（無限滿版），是留一個保守的安全帽——避免在真的極端寬螢幕（3440px/5120px 那種 ultrawide）上，表格被拉到誇張寬、欄位之間留一堆詭異的空隙，1800px 已經比原本寬 50%+，多數螢幕下已經算是「填滿可用空間」的效果。

**驗證**：Playwright 開一個真的 2560px 寬視窗（不是只改 CSS 數字就假設有效），改之前 Pods 分頁表格右邊有大片空白，改之後表格正確撐開填滿大部分寬度、欄位間距變寬更好讀；同一支腳本切到 Settings 頁面截圖確認表單維持原本窄版置中、沒有被誤改；另外用 1400px 一般視窗尺寸重新截圖 Dashboard，確認沒有因為這次改動在正常尺寸下跑版（`max-w-[1800px]` 比一般視窗的可用寬度還寬，所以效果等於維持原樣，純粹是在寬螢幕才會有感）。全程 console 無錯誤。

## 側欄改成可拖曳調整寬度 + Backups 分頁改名成 Backups/Restores（2026-08-07）

### 側欄拖曳調整寬度

你問側欄寬度能不能左右調整——原本 `Sidebar.jsx` 只有 collapsed（64px）/ expanded（224px）兩個寫死的狀態，沒有拖曳功能。加了一個 6px 寬的拖曳把手（`aside` 右邊緣，`cursor: col-resize`），只在展開狀態才會出現（收合狀態是固定的純圖示模式，沒有東西好調）。寬度限制在 180～360px（`MIN_WIDTH`/`MAX_WIDTH`），拖出範圍會夾住不會無限變寬/變窄。

**技術細節**：寬度存在獨立的 localStorage key（`mariadb-ui:sidebar-width`），刻意不跟 `src/lib/settings.js` 共用——那個模組的 `getSettings()`/`setSettings()` 每次呼叫都會把整包設定 JSON 序列化一次，適合表單那種偶爾存檔的場景，但拖曳過程中如果每個 `pointermove` 都呼叫一次會很浪費；而且側欄寬度本質上是版面配置狀態，不是 Settings 頁面上會有欄位可以填的「使用者偏好」。只在放開滑鼠（`pointerup`）當下寫入一次，拖曳中只更新 React state 跟畫面。**過程中修掉一個自己寫出來的 bug**：一開始 `onUp` 裡直接讀 closure 裡的 `width` 變數來存檔，因為 `onUp` 是在 `dragging` 這個 effect 觸發時才建立、只綁定 `[dragging]` 這個依賴，所以它 closure 住的 `width` 其實是**拖曳開始那一刻**的舊值，不是放開滑鼠當下的最新寬度——會存到錯的數字。改用一個 `widthRef`，在每次 `pointermove` 時同步更新，`onUp` 改成讀這個 ref 而不是讀 state 變數，避免 stale closure。順便做了拖曳期間鎖定整個 `document.body` 的 cursor/`userSelect`（不只是 6px 把手本身）的標準拖曳把手處理——滑鼠移動太快脫離把手範圍時，避免選取到旁邊的導覽文字。

**驗證**：用 Playwright 模擬真的 `mouse.down` → `mouse.move` → `mouse.up` 拖曳流程（不是只檢查程式碼邏輯）：初始寬度 224px，拖曳 100px 後量到 324px（完全吻合）；重新整理頁面後寬度依然是 324px（確認 localStorage 真的有存到、有讀回來）；刻意拖超過上限 500px，最後量到剛好夾在 360px（`MAX_WIDTH`），沒有無限增長。截圖確認展開變寬後，Logo/導覽項目/Connected 卡片都正常跟著縮放，沒有跑版，全程 console 無錯誤。

**追加修正**：你回報拖曳把手的滑鼠游標圖示顯示成上下箭頭，不是左右——查了確認 CSS `cursor` 屬性真的是 `col-resize`（`getComputedStyle` 查出來就是這個值，不是我寫錯），問題出在這個環境是跑在 **KasmVNC 遠端桌面**裡：`col-resize` 這種 CSS 游標關鍵字要靠作業系統提供對應的實際游標點陣圖，遠端桌面/X11 的游標主題常常不完整，好幾種不同的 resize 關鍵字（`col-resize`/`ew-resize`/`ns-resize`...）可能因為缺圖示而全部 fallback 成同一種通用圖案，剛好就是看起來像上下箭頭那種——這是環境限制，不是我能修 OS 游標主題的問題。**繞過方式**：改用自畫的 SVG 當游標圖片（`cursor: url("data:image/svg+xml,...") 9 9, col-resize`，`col-resize` 留著當 fallback），不再依賴系統提供的點陣圖，視覺上保證一定是正確的水平雙箭頭。驗證時把這個 SVG 單獨用 `<img>` 放大渲染出來確認形狀真的是清楚的 ↔（不是只信任程式碼裡的 path 座標數學算得對），同時用 Playwright 確認 hover 在把手上跟拖曳中 `document.body` 的 `getComputedStyle(...).cursor` 都正確解析成這個 data URI，不是原本的純關鍵字。

### Backups 分頁改名

你指出左側「Backups」這個名字跟頁面實際涵蓋的範圍（Backups + Restores + PITR）對不太上。側欄 `nav` 陣列跟頁面自己的 `<h1>` 都改成「Backups/Restores」，兩處保持一致（沒有只改一邊）。截圖確認展開/收合兩種側欄狀態、以及頁面標題三處都正常顯示，沒有因為字變長而被裁切或換行。

## Pod Logs 檢視器 + Services 分頁補上 Endpoint 健康狀態（2026-08-07）

問你「還有沒有甚麼功能可以新增的」，這次沒有查業界也沒有查自己的資料，純粹回顧這幾輪對話裡我們自己撞過的牆，挑出兩個都做了。

### 1. Services 分頁補上 Endpoint 健康狀態（小、直接對應到今天的真實困惑）

就是你稍早問的「`test-db-1-secondary` 這怎沒有 endpoint」那個問題——當時查出來是 operator 自己手動管理 EndpointSlice（selector-less Service），`kubectl get endpoints`（legacy API）查不到很正常，要查 `EndpointSlice`。這次直接把這個資訊做進畫面：`server.js` 的 `/services` route 現在同時抓 `kubectl get endpointslices -n <namespace> -o json`，用 `kubernetes.io/service-name` label 對應回每個 Service，算出 `endpointsReady`/`endpointsTotal`；`ServicesTab` 新增「Endpoints」欄，顯示「N/M ready」，全數 ready 綠色、部分 ready 黃色、全數不 ready 但有預期數量紅色、完全沒有預期端點（灰色，例如新建但還沒有任何 pod 註冊上去的情況，跟「本來該有卻掛光了」是不同語意，用顏色區分開）。

**驗證**：對著真的 `test1/test-db-1` 打 API，`test-db-1-secondary` 正確回 `endpointsTotal: 2, endpointsReady: 2`，跟稍早手動 `kubectl get endpointslice` 查到的兩個 replica pod 完全對得上；headless Chrome 截圖確認 Services 分頁五個 service 全部正確顯示各自的 ready 數（`test-db-1-primary` 1/1、`test-db-1-secondary` 2/2、`test-db-1-internal`/`test-db-1` 3/3、`test-db-1-metrics` 1/1），無 console 錯誤。

### 2. Pod Logs 檢視器（大，但是這類工具最基本的期待功能）

之前這個 UI 完全看不到 container log——不管是這次 debug metrics 問題還是查 replication 狀態，都是我直接 `kubectl exec`/`kubectl logs`，這個 UI 完全幫不上忙。

**做法**：`server.js` 新增 `GET /api/instances/:namespace/:name/pods/:podName/logs?container=&tailLines=`，沿用 chaos delete-pod 那支路由已經在用的防呆機制——先查 `app.kubernetes.io/instance=<name>` 這個 label selector 底下真的有哪些 pod，`podName` 不在清單裡直接拒絕，不接受任意 pod 名稱；`tailLines` 上限鎖 2000（這是「現在是什麼狀況」的即時檢視，不是完整歷史匯出的工具，也避免一次撈太多把回應撐爆），用 `kubectl logs ... --tail --timestamps` 抓。前端在 Pods 分頁每一列加「Logs」按鈕，跳出的 `LogsModal` 用 pod 自己的 `containers` 陣列動態產生 container 分頁（`mariadb`/`agent`，PMM 有開的話還會多一個 `pmm-client`，不用額外打 API 就知道有哪些 container，因為 Pods 分頁本來就已經抓過這個資料了）+ 可調整的 tail 行數（100/200/500/1000/2000）+ 手動 Refresh。**刻意不做成自動輪詢/即時 tail**——這是「現在 log 說了什麼」，不是 live tail，而且每幾秒重抓幾百行 log、放著開很久也不值得這個成本。

**驗證**：直接對真的 API 打，確認 `test-db-1-0` 的 `mariadb`/`agent` 兩個 container 都能正確抓到 log（`agent` 是結構化 JSON log，`mariadb` 是一般文字 log，都正確原樣顯示）；刻意用一個不屬於這個 instance 的假 pod 名稱打同一支 API，確認正確回 400「... is not a pod of instance ...」，防呆機制有效。headless Chrome 截圖確認：Pods 分頁每列都有「Logs」按鈕；開啟後預設分頁（這個 pod 剛好是 `agent` 排在容器清單第一個）正確顯示即時的 log 內容並自動捲到底部；切到「mariadb」分頁後，內容整個換成完全不同的 mariadb server log（甚至剛好完整記錄了這次對話期間真的發生過的一次 primary 切換的 semi-sync/CHANGE MASTER 過程），證明分頁切換真的在打不同 container，不是顯示同一份資料；全程 console error/pageerror 都是空的。

## Config Health 補上「TLS 憑證快過期」檢查（2026-08-07）

問你「還有沒有可以自己想的功能」，這次沒有再查業界，純粹盤點這個 UI 自己已經有的資料裡有沒有沒被用到的檢查點。找到一個：`TLS encryption enabled` 這項現在只看有沒有開，不看憑證還剩多久到期——但 `/api/instances/:namespace/:name` 回傳的 `status.tls`（`serverCert`/`clientCert` 各自的 `notAfter`）其實**早就在**回傳資料裡了，TLS 分頁本身也已經用同一份資料在畫「Xd until expiry」，Config Health 只是沒去用。工程量很小、不用改後端：純前端新增一項檢查。

**做法**：`HealthChecklist` 取 `detail.tls.serverCert`/`clientCert` 兩者裡**比較早到期**的那個（兩個都影響得了連線，取最緊迫的），沿用 `TLSTab` 既有的「30 天內算緊急」門檻（`daysLeft < 30` 標紅，跟 TLS 分頁本身的紅色門檻一致，不是另外發明一套標準）。這項檢查**只在 TLS 有開的時候才會出現**在清單裡（`...(detail.tlsEnabled && tlsDaysLeft != null ? [...] : [])`）——TLS 沒開的話「TLS encryption enabled」那項本身就已經標紅了，沒必要對同一個根因再顯示第二個紅色項目，所以分數分母會依 TLS 有沒有開而變（6 或 7），這是刻意的。

**驗證**：先用真的 KIND 叢集上的 `test-db-1`（cert-manager 簽發、還有 90 天效期）確認畫面正常顯示「TLS certificate not expiring within 30 days」綠勾、分數變成 6/7（原本 6 項變 7 項）。負向路徑沒辦法用真憑證測（沒辦法叫 cert-manager 簽一張快過期的證書），改用 Playwright 攔截 `/api/instances/test1/test-db-1` 這支 API 的 response、把 `notAfter` 竄改成「10 天後」跟「5 天前」兩種情境重新截圖：10 天後那次正確顯示紅叉＋「Expires in 9 day(s)...」（`Math.floor` 因為時分秒差異少算一天，符合預期）；5 天前那次正確顯示紅叉＋「Certificate expired 6 day(s) ago — TLS connections may already be failing.」，兩種文案分支都對。這次順便新增的 `Date.now()` 直接呼叫（算天數用）會多一個 `react-hooks/purity` lint error，但 `TLSTab` 元件裡本來就有一模一樣的寫法（同一類 pre-existing 問題的第二個實例），跟著現有慣例沒有另外處理。

## Activity 頁新增「UI Actions」分頁：本地操作紀錄（2026-08-07）

你要我做完「Config Health 看真的 exporter 狀態」之後，再重新比一次業界同類工具。查證結果（WebSearch + `gh` 查真的 repo，不是憑印象）：Percona Everest 改名 OpenEverest、轉獨立開源專案，最近版本是 PostgreSQL 18.1 支援 + NodePort 網路選項，沒有新的管理面向功能；CloudNativePG 依然沒有官方 web console，唯一查到的「CNPG GUI」是個 2 顆星的個人 hobby 專案，訊號太弱不列入參考；Vitess VTAdmin 沒查到新的 schema 相關功能——上次的結論都還站得住。唯一有意思的新發現是查到之前沒比較過的 **KubeBlocks**，它的 `OpsRequest` API 把每個管理操作都做成可追蹤、可 rollback 的物件，但那是 operator 核心 CRD 設計，不是 UI 層能抄的東西，超出這個專案範圍。

**真正促成這次動工的，是那個 2 星 hobby 專案功能列表裡順手看到的「audit logs」，剛好對上 `Ui.md` 自己記錄過的真實案例**——「New Instance 精靈：密碼確認 + Backup S3/VolumeSnapshot 支援」那次的插曲裡，`test1/my-mariadb-1` 這個 instance 消失了，查了半天才確認是有人在 UI 上按了 Delete，因為 `DELETE /api/instances/:namespace/:name` 這條路徑完全不會留下任何紀錄（`kubectl` 這邊的 operator finalizer log 只在 operator 自己觸發刪除時才有）。這個 UI 目前能做的破壞性操作已經不只刪 instance——chaos delete-pod、restore drill、switchover、CRD create/delete 都是——完全沒有本地紀錄可查。

**做法**：`server.js` 加一個全域 middleware，攔截所有非 `GET` 的 request，在 `res.on('finish')` 時記一筆：時間、方法、路徑、根據路由 pattern 產生的人話摘要（例如 `DELETE /api/instances/test1/x` → `"Deleted instance test1/x"`）、HTTP 狀態碼、成功與否。這個 UI 沒有登入/身份系統，所以記不到「誰做的」，只能記「做了什麼、什麼時候」——但光是這樣，「`my-mariadb-1` 到底是不是我自己刪的」這種問題就能秒查，不用再花時間排除各種可能性。摘要產生邏輯（`describeAction()`）列舉了目前已知的每個 mutating route（deploy/delete instance、chaos drill、restore drill、switchover、image/storage/replicas/resources 等 PATCH、CRD create/delete、helm upgrade），沒列到的新路由會 fallback 成 `"METHOD /path"`，不會整條漏掉不記。

存放方式：記憶體裡存最新 200 筆的 ring buffer，同時盡量寫進 `/tmp/mariadb-ui-actions.jsonl`（append-only JSON Lines）——這個 API server 沒有 HMR，改完程式碼常常要手動重啟（`Ui.md` 自己也記過這個限制），所以額外做了「啟動時讀檔案回填記憶體」，這樣重啟不會把最近的紀錄整個歸零。新增 `GET /api/activity/log` 回傳最新在前的清單。

前端把原本的 Activity 頁拆成兩個分頁（沿用 `CrdsPanel`/`InstanceDetail`已經在用的 pill 樣式切換）：「Cluster Events」是原本內容（`kubectl get events`，operator 自己動到什麼東西），「UI Actions」是這次新增的（誰透過**這個 UI**動了什麼）——兩者故意分開顯示，不合併成一個表格，因為資料來源、代表的意義完全不同，混在一起容易誤會成同一件事。

**驗證**：對著真的 API 打了一次 create database + delete database，確認 `/api/activity/log` 正確依序記下兩筆、摘要文字正確（`Created database "actiontest" in test1` / `Deleted database "actiontest" from test1`）；重啟 `node server.js`（模擬開發時常見的手動重啟）後確認這兩筆紀錄還在，證明檔案回填有效；headless Chrome 截圖確認「UI Actions」分頁正確顯示這兩筆（綠色勾勾、HTTP 方法、正確時間），切回「Cluster Events」分頁功能完全沒受影響（正好還顯示著上一個功能驗證時 scale 掉又scale回來的 `test-db-1-metrics` 事件，證明底層邏輯沒被這次重構動到），全程 console error/pageerror 都是空的。

## Config Health 的「Monitoring connected」改成看真的 exporter 有沒有跑起來，不是只看 spec 開關（2026-08-07）

這不是規劃出來的功能，是我們在你自己的叢集上debug「metrics 都開了怎麼沒有 pod」這個問題時，親手發現的一個真實 UI 缺陷：`test-db-1`/`test-db-2` 的 `spec.metrics.enabled` 是 `true`，但因為叢集裡沒裝 Prometheus Operator 的 `ServiceMonitor` CRD，operator 的 `reconcileMetrics()`（`internal/controller/mariadb_controller_metrics.go:35-44`）一開始檢查 CRD 存不存在，不存在就直接 `return`，連建 exporter Deployment 那步都不會跑到——只留一個容易被忽略的 Warning Event。而 Overview 分頁的 Config Health 卡片，「Monitoring connected」這項當時只檢查 `detail.pmmEnabled || detail.metricsEnabled`，也就是只看「有沒有勾選開啟」，不是「有沒有真的跑起來」，所以畫面上照樣是綠色勾勾，完全看不出問題。

**修法**：
- 後端 `/api/instances/:namespace/:name` 新增 `metricsReady` 欄位（新 helper `isMetricsExporterReady()`）：`spec.metrics.enabled` 為真時才去查 `kubectl get deployment <name>-metrics`，看 `status.readyReplicas >= 1`，不存在或沒 ready 都算 `false`。
- 前端 Config Health 的 check 改成 `ok: detail.pmmEnabled || detail.metricsReady`（PMM 那半維持原本看 spec 是否有 sidecar，這次沒去動 PMM 那條路徑），沒過的時候依情況顯示不同的「為什麼」文字：完全沒開 monitoring 顯示原本的文字；有開但沒真的跑起來，顯示「Metrics is enabled in spec, but the exporter Pod isn't actually running — check the Events tab (a missing ServiceMonitor CRD is the usual cause).」，直接把根因線索寫在畫面上，不用自己再去猜。

**驗證**：先確認 `test-db-1` 裝好 CRD、exporter 真的 Running 之後，API 正確回 `metricsReady: true`，Config Health 是 6/6 全綠。接著為了測負向路徑，暫停 operator（`kubectl scale deployment mariadb-operator -n test1 --replicas=0`，避免它把我手動改的狀態立刻改回來——這個 Deployment 是 operator 宣告式管理的，第一次沒暫停 operator 直接 `kubectl scale test-db-1-metrics --replicas=0` 就被自動改回 `1/1` 了，這步驟本身也算是意外驗證了 operator 自己的 reconcile 很快、很可靠），再把 `test-db-1-metrics` 手動 scale 到 0，這時 API 正確回 `metricsReady: false`，headless Chrome 截圖確認 Config Health 分數掉到 4/6、顯示紅叉跟上面那段新文字，其餘（Backup schedule/HA/TLS）不受影響。驗證完恢復 operator，它在幾秒內就把 `test-db-1-metrics` 自動 scale 回 `1/1`，Config Health 也自動變回綠色——全程沒有留下需要手動清理的東西。

## User/Grant 權限矩陣 + Schema 一致性檢查（2026-08-07）

延續「業界同類工具功能落差分析」那次列出的優先清單，前兩名（PMM 深連結、Backup/Restore 排程頁）都做完了，這次挑第 3、4 名一起做。

### 1. User/Grant 權限矩陣（InstanceDetail → CRDs → 新增「Permissions」次分頁）

**做法**：沒有動原本的 Users/Grants 兩個 CRD 分頁（純加法，原本的 CRUD 能力保留），在 `CrdsPanel` 裡多加一個「Permissions」次分頁（`Grid3x3` icon），渲染新元件 `components/crd/PermissionsMatrix.jsx`，不是走既有的泛用 `ResourceTab`。矩陣是 User（列）× Database（欄，第一欄固定是 `* (all)`）；每個 cell 顯示**精確比對** `username`+`database` 的 Grant CR 的權限徽章（`ALL PRIVILEGES` 特別標紅、其餘權限藍色小徽章），不把 `*` 通配的權限灌進其他欄位裡混著顯示——避免搞不清楚一個權限到底是從哪張 Grant CR 來的。點任何 cell 會跳出詳情視窗：列出這個 cell 底下所有 Grant（含 table/host/grant option 資訊，可個別刪除），底部一個「Add Grant」按鈕會帶 `prefill` 開既有的 `CreateResourceModal`（複用 Backups 頁「Restore」按鈕已經驗證過的 prefill 機制）。

**列/欄範圍刻意做成「CR + Grant 參照」的聯集**，不是只看 User/Database CR 列表——像 `root`（沒有對應 User CR，是 MariaDB 內建帳號）或是 operator 自己管理的 `mariadb.sys`/`<instance>-mariadb-sys@localhost` 這種系統帳號的 Grant，都是靠 Grant CR 本身反查出來的，不會因為沒有 User CR 就被矩陣忽略。沒有對應 User CR 的列會標一行「no User CR」提示。後端完全沒改，直接用既有的 `GET /api/crd/:kind?namespace=&ref=&refField=mariaDbRef`（user/grant/database 三支）。

### 2. Schema 一致性檢查（Replication 分頁新卡片，Replication 跟 Galera 都有）

**做法**：`Replication`/`Galera` 拓樸的 Topology 圖下方新增一張「Schema Consistency」卡片，按「Check now」才觸發（不像其他卡片自動每 10 秒刷新——每個 pod 都要一次 `kubectl exec` 來回，跟這個 UI 其他讀 k8s API 的成本完全不是同個量級，硬接自動刷新只會拖慢整頁）。

**後端**新增 `GET /api/instances/:namespace/:name/schema-check`：
1. 讀 MariaDB CR 的 `spec.rootPasswordSecretKeyRef`，用新加的 `getSecretValue()` helper（`kubectl get secret -o jsonpath` + base64 解碼）拿到 root 密碼——這是這支 API 第一次需要「反查一把密碼的明文」，之前所有密碼相關程式碼都只是單向寫入 Secret，沒有讀回來用過。
2. 對每個 `Running` 的 pod 平行下兩支 `kubectl exec ... -c mariadb -- mariadb -uroot -p<pw> -N -B -e "..."`：一支 `SELECT VERSION()`，一支結構指紋查詢——對 `information_schema.columns`（排除 `mysql`/`information_schema`/`performance_schema`/`sys` 系統 schema）依 `table_schema, table_name` 分組、把每個 table 的欄位名稱+型別串成簽章字串，再全部 `GROUP_CONCAT` 排序後取 `MD5`。**只比對表結構，不比對資料**——兩個 pod 的 schema 一模一樣就會算出同一個 hash，不管 table 裡的 row 內容差多少。
3. 用陣列裡的第一個成功回應的 pod 當「reference」，其餘 pod 逐一比對 hash/version 是否相符，回傳 `schemaConsistent`/`versionConsistent` 兩個布林值。

**前端**表格列出每個 pod 的 version/table 數/hash 前 12 碼（hover 看完整值），跟 reference pod 不同的欄位標紅（schema hash）或黃（version），整體用兩個大徽章（綠勾/紅叉）先給結論，不用逐行自己比對。

**驗證**（對著真的 KIND 叢集跑，不是只看程式碼）：建了一個 2 replica 的 Replication instance（`test1/perm-test`），先建了 `shopdb`/`reportsdb` 兩個 Database、一個 `appuser`（對 `shopdb` 有 SELECT/INSERT/UPDATE、對 `reportsdb` 只有 SELECT）、一個 `root` 的 `* (all)` ALL PRIVILEGES grant——headless Chrome 截圖確認矩陣正確顯示這些真實資料，而且自動多列出了兩個我沒手動建的系統帳號（`mariadb.sys`、`<instance>-mariadb-sys@localhost`）的既有 grant，證明「CR + Grant 參照聯集」這個邏輯在真實資料上真的有作用，不是只有我自己建的資料才顯示得出來；點開 cell 詳情視窗、Add Grant 按鈕都正常運作，全程監聽 console error/pageerror 都是空的。

Schema Consistency 卡片做了正反兩面驗證，不只測 happy path：先在兩個 pod 都沒有使用者 schema 的狀態下點「Check now」，兩邊都是 0 張表、hash 都是空值（`MD5(NULL)`，畫面正確顯示 `—` 不是假 hash），「Schema consistent」「Version consistent」都是綠色——這是正常情境。接著故意 `STOP SLAVE SQL_THREAD` 暫停 replica 的 SQL 執行緒，在 primary 建一個新 database+table（因為 replica 的 SQL 執行緒被停了，這個異動不會套用到 replica，確認過 replica 上 `SHOW DATABASES LIKE 'driftdb'` 真的查不到），再點一次「Check now」——畫面正確顯示「Schema DIVERGED」（紅色），primary 那列變成 1 張表、有真的 hash 值，replica 那列還是 0 張表、`—`，兩個 pod 的 hash 值也確實不同。驗證完 `START SLAVE SQL_THREAD` 恢復複製、確認 replica 追上資料，`perm-test` instance 跟相關 Secret 都已刪除。

**已知取捨**：root 密碼在這支 API 執行期間會短暫出現在 `kubectl exec` 的 argv 裡（`-p<password>`）——跟這個程式庫既有的風險假設一致（`buildSecret()`/`restore-drill` 那條路徑本來就是把明文密碼放進本機執行的 `kubectl`/`helm` command line），沒有另外做 `MYSQL_PWD` 環境變數這類進一步收斂，如果之後要重新檢視這個 UI 的密碼處理慣例，這裡也該一併看。

延續上一輪「業界功能落差分析」的討論，你要求依照分析結果實作 Backup/Restore 排程頁，之後又追加一個小需求：Instances 頁面加上有沒有排程備份的欄位。

### 1. Backups 頁面（新側欄項目，Archive 圖示）

跟你確認過現有 Backup/Restore 相關 UI 只有三處都不是「排程頁」：New Instance 精靈的 Backup 步驟（只在建立當下能設定，建完就沒了）、CRDs 分頁的泛用表單（看不到實際跑過幾次、成功了沒）、Resilience 分頁的 Restore Drill（定位是測試用，會建一個拋棄式的 `<instance>-drill`）。這次做的是補上「跨 instance 總覽 + 真正的還原流程」這塊空白。

**架構決策**：沒有另外寫一套 CRD schema，直接複用既有的 `crdSchemas.js`/`CreateResourceModal`/`formUtils.js` 這套泛用引擎（`backup`/`restore`/`physicalbackup`/`pointintimerecovery` 這幾個 schema 本來就齊全，包含 `buildSpec`、欄位定義、`ref-select` 邏輯）。真正要動的只有：

1. **`server.js` 的 `GET /api/crd/:kind`**：`namespace` 從必填改成選填——不帶就用 `kubectl get <kind> -A` 列出所有 namespace，其餘既有的 CRDs 分頁（`ResourceTab.jsx` 一律帶 namespace）完全不受影響，純加法。
2. **`CreateResourceModal.jsx`** 加了 `prefill`/`title` 兩個選填 prop（預設不傳等於原本行為），讓 Backups 頁的「Restore」按鈕可以直接把 `backupRef`/`name` 帶進表單，不用使用者自己重新選一次備份。

**頁面內容**：4 張統計卡（Backups 總數／沒排程的 instance 數／需要注意的失敗數／Restore job 數）+ 3 張表：
- **Backups**：合併 `Backup` + `PhysicalBackup`，秀 instance/名稱/類型/存放位置/排程/狀態/建立時間；`Backup` 類型的列有「Restore」按鈕（`PhysicalBackup` 沒有，因為它的還原路徑是 PITR，另一套流程）；右上角選一個 instance 就能建新 Backup。
- **Restores**：所有 `Restore` CR 的執行歷史（唯讀 + 可刪除）。
- **Point-in-Time Recovery**：唯讀列表，因為 `PointInTimeRecoverySpec` 本身沒有 `mariaDbRef`，只有 `physicalBackupRef`，所以「這個 PITR 屬於哪個 instance」是額外拿 physicalbackups 清單反查回來的（比對 `physicalBackupRef.name`）。

**沒做的，刻意跳過**：Percona Everest 那種「用備份長出一個全新 instance」——查了 `Restore` CRD 的 spec（`mariaDbRef` 是必填），確認它的語意是還原進一個**已存在**的 instance，不是建新的；「建新 instance」要走 `bootstrapFrom.backupRef`，這條路 Resilience 分頁的 Restore Drill 已經在用（測試用途，固定拋棄式命名）。要做成正式功能等於要重用 New Instance 精靈整套輸入（名稱、replicas、storage、image 版本…），範圍明顯是另一個獨立功能，這次沒做。PITR 的「New」也先跳過，因為現在叢集裡沒有接 S3/Azure 的 PhysicalBackup 可以實測這條路徑。

**驗證時抓到並修掉一個 bug**：Status 欄位一開始只認字面 `'Ready'`/`'Complete'` 這兩個字才顯示綠色勾勾，但實測 `test1/pmm-verify-backup-1` 這個真的 Backup CR，`kubectl` 顯示的 condition reason 其實是 `JobComplete`（查了 `pkg/condition/complete.go`，operator 對已完成的 Job 一律用 `ConditionReasonJobComplete = "JobComplete"` 這個 reason，不是單純的 `"Complete"`），導致明明成功的備份被畫成灰色時鐘圖示而不是綠色勾勾。改成直接看 condition 的 `status === 'True'` 判斷成功與否，不比對 reason 文字。

**驗證**：`npx vite build` 過、`node --check server.js` 過；無頭 Chrome 截圖確認真實資料正確載入（`test1/pmm-verify` 的一次性備份、2 個沒排程的 instance 正確列出並可點擊跳轉到詳情頁）；用暫時把 `restoreTarget` 的 state 預設值改成一筆真實資料再截圖的方式，確認 Restore 彈窗的標題／預填名稱／預選備份三者都正確帶入（截圖後改回 `null`）。

### 2. Dashboard 加上「有沒有排程備份」欄位

`server.js` 的 `GET /api/instances` 併發多打兩支 `kubectl get backups -A` / `kubectl get physicalbackups -A`，算出每個 instance 有沒有任一個 Backup/PhysicalBackup CR 帶 `spec.schedule.cron`，回傳新欄位 `hasScheduledBackup`。刻意做成「任一支 kubectl 失敗就整批降級成 `null`（畫面顯示 `—`）」，而不是讓失敗直接讓整個 `/api/instances` 噴 500——這支 API 是 Dashboard 的核心資料來源，備份清單抓不到不該連累整個 Instances 頁面掛掉。

`Dashboard.jsx` 表格新增「Backup」欄，跟 Backups 頁同一套配色：綠色勾勾「Scheduled」/ 橘色警示「No schedule」/ 灰色 `—`（未知）。

**驗證**：`curl /api/instances` 確認欄位正確回傳（`test1` 底下兩個 instance 一開始都是 `false`）；截圖確認畫面正確顯示「No schedule」；手動建一個帶 `cron: "0 3 * * *"` 的 Backup CR 指到 `test-db-1` 後重新整理，確認該列正確變成綠色「Scheduled」、另一列維持橘色「No schedule」，兩種狀態視覺上都驗證過，測試用的 Backup CR 事後已刪除。

## Switchover 頁面兩個修正：Refresh 按鈕被文字卡住、補上 10 秒自動刷新（2026-08-06）

### 1. Header 的 Refresh 按鈕被說明文字擠到中間

你回報「Switchover 這邊有個 Refresh 被文字卡住」。查了 `Switchover.jsx` 的 Header：`flex justify-between` 排列標題文字跟 Refresh 按鈕，但左側文字容器沒有 `min-w-0`/`flex-1`——flex item 預設 `min-width: auto`，意思是它不會縮小到低於內容自然寬度，而說明文字裡有 `<code>spec.replication.primary.podIndex</code>` 這種不可斷行的長字串，撐大了容器的最小寬度，換行時直接蓋到 Refresh 按鈕上。用無頭 Chrome 在 900px 寬度截圖重現：文字換行到第二行時「Refresh」三個字直接插進 `spec.galera.primary.podIndex` 後面的句子中間。

**修法**：左側容器加 `min-w-0 flex-1 pr-6` 讓它能正確收縮換行，段落加 `break-words` 防極端情況溢出，容器對齊從 `items-center` 改成 `items-start`（配合按鈕 `mt-0.5`），讓文字變三行時按鈕仍穩定停在右上角，不會被擠到文字中間。

**驗證**：無頭 Chrome 在 900px/1280px 兩種寬度分別截圖比對修正前後——修正前按鈕確實卡在段落中間，修正後三行文字正常換行、按鈕穩定停在右上角。

### 2. 缺少跟其他頁面一致的每 10 秒自動刷新

你問「Switchover 這邊有個 Refresh 怎沒有每 10 秒更新的動作了？」——查了才發現 `Switchover.jsx` 從建立以來就沒接過 `useAutoRefresh` 這個 hook，只有手動 Refresh 按鈕，Dashboard/Activity/Capacity 三個頁面都有的倒數環（`CountdownRing`）這裡完全沒做。

**修法**：接上 `useAutoRefresh` + `CountdownRing`，Header 右上角改成跟其他頁一樣的樣式（倒數秒數 + 可暫停）。**關鍵細節**：不能像其他頁那樣單純整批 overwrite 資料——這頁有使用者正在操作的狀態（勾選框、下拉選的目標 pod、`pollRow` 正在輪詢中的 `switching` 狀態），如果每 10 秒直接整批換新資料，會把使用者剛勾好還沒按「Run」的選項清空、也會把正在進行中的 switchover 狀態閃回 `Idle`，跟輪詢邏輯打架。改成合併策略：新資料抓回來後用 `key` 比對舊 rows，非進行中的 row 才套用新資料，`switching` 中的 row 完全保留舊狀態，`selected`/`target` 兩個使用者輸入的欄位一律保留。

**驗證**：無頭 Chrome 間隔幾秒各截一張圖，確認倒數環從 10s 正確倒數到 7s，資料照常載入且沒有把畫面清空重來。

## 業界同類工具功能落差分析：Percona Everest / CloudNativePG / Vitess VTAdmin / phpMyAdmin・pgAdmin（2026-08-06）

你問「還有沒有可以加到 UI 內的，幫我找找看業界」，第一輪先憑既有知識粗略列了幾個方向；你要求「再重新對照一次」，所以這輪改成實際查證每個工具目前真正提供的功能（WebSearch + WebFetch 官方文件），不是憑印象猜。同時比對這個 UI 現有頁面（Dashboard/Capacity/Switchover/Activity/InstanceDetail 的 pods/replication/services/tls/crds/events/resilience 分頁）跟 operator 已有但 UI 完全沒碰過的 CRD（`backup`、`restore`、`physicalbackup`、`pointintimerecovery`、`user`、`grant`、`sqljob`、`maxscale`）。

### 逐一查證結果

**Percona Everest**（定位最像——同樣是「操作 K8s DB CRD 的網頁 GUI」）：查了官方 [Features 頁](https://openeverest.io/documentation/1.12.0/features.html) 跟 [Restore backups](https://docs.percona.com/everest/backups_and_restore/RestoreBackup.html) 文件，確認有：Scheduled Backups 頁面（排程建立/檢視/刪除）、PITR 一鍵還原精靈、「用備份建立一個全新的 instance」（不只是還原回原本那個）、RBAC + IdP 群組整合 + SSO、PMM 監控整合入口。

**CloudNativePG**：查了 [operator capability levels](https://cloudnative-pg.io/docs/1.25/operator_capability_levels/) 跟官方 [Grafana dashboards repo](https://github.com/cloudnative-pg/grafana-dashboards)，確認它**沒有**自建網頁管理台——走 `cnpg` kubectl plugin + 標準化 Grafana dashboard 這條路，監控完全外包給 Grafana。這點反而是這個 UI 現有的 Capacity/Activity 頁比 CNPG 生態做得更完整（他們沒有自己的網頁面板可比）。值得參考的是它「宣告式管理 Postgres 設定/extension」的概念。

**Vitess VTAdmin**：查了 [VTAdmin 文件](https://vitess.io/docs/24.0/concepts/vtadmin/) 跟 [Schema Tracking](https://vitess.io/docs/15.0/reference/features/schema-tracking/)，確認除了 reparenting（對應這裡的 Switchover）之外，還有 Schema 頁：驗證 schema/version 跨節點一致性、重建 keyspace graph。這個 UI 的 `database` CRD 目前完全沒有對應的 schema 瀏覽器或一致性檢查。

**phpMyAdmin / pgAdmin**：查了 [pgAdmin User Interface 文件](https://www.pgadmin.org/docs/pgadmin4/development/user_interface.html) 跟 [phpMyAdmin 功能說明](https://www.geeksforgeeks.org/php/basics-of-phpmyadmin/)，確認兩者核心賣點是：Query console + EXPLAIN 執行計畫、圖形化 User/Grant 權限管理、Schema/table 瀏覽器（欄位/索引/外鍵）、CSV/SQL 匯入匯出。這個 UI 有 `user`/`grant` CRD 但完全沒有對應頁面，只能透過泛用的 CrdsPanel 硬改 YAML。

**額外查證**：Zalando [postgres-operator-ui](https://opensource.zalando.com/postgres-operator/docs/operator-ui.html)（另一個「輕量網頁面板包 K8s DB operator」的同類產品）確認有「用備份 clone 出一個新 cluster」跟送出前的 manifest 預覽面板；Percona PMM 的 [Query Analytics](https://docs.percona.com/percona-monitoring-and-management/3/discover-pmm/features.html) 文件確認 QAN dashboard 是靠 slow query log/performance schema 做「按 Load 排名找出最重的查詢 + EXPLAIN」，工程量遠大於這個 UI 其他頁面，且這個 UI 已經有 PMM sidecar 整合（見上面「整合 Percona PMM Monitoring」章節），重疊功能沒必要重做一套。

### 結論：按「跟現有程式碼距離」排序的建議清單

1. ~~PMM 深連結收尾~~ ✅ **2026-08-06 已完成**，見上面「對著真的 PMM Server 驗證後...」章節。
2. ~~Backup/Restore 排程頁~~ ✅ **2026-08-06 已完成**，見上面「新增 Backups 頁面」章節。
3. ~~User/Grant 管理頁~~ ✅ **2026-08-07 已完成**（做成矩陣視圖，不是取代原本的 CrdsPanel，兩者並存），見上面「User/Grant 權限矩陣 + Schema 一致性檢查」章節。
4. ~~Schema 一致性檢查~~ ✅ **2026-08-07 已完成**（放進 Replication 分頁，不是 Switchover 頁——跟 Topology 圖同一頁比較合理），見上面「User/Grant 權限矩陣 + Schema 一致性檢查」章節。
5. Query console / EXPLAIN——工程量最大（要處理 SQL 執行、連線池、安全性），先不建議做，PMM 的 QAN 已經涵蓋這塊。**目前清單裡唯一還沒做、也不建議做的一項。**

## 移除 Capacity 成本估算、新增 Switchover 頁面、精靈支援批次建立、PMM 深連結、版本落後提醒（2026-08-06）

延續上一輪功能討論，這次做了 5 件事：

### 1. 移除 Capacity 頁面的成本估算

你的理由：硬體/雲端價格一直在變，這個估算沒有實際意義。拿掉了 `Capacity.jsx` 的「Estimated monthly cost」卡片、per-namespace 的 `~$X/mo` 顯示，以及 `Settings.jsx`/`src/lib/settings.js` 裡對應的三個費率欄位（`pricePerCpuCoreMonth`/`pricePerGbMemoryMonth`/`pricePerGbStorageMonth`）。Capacity 頁面回到只顯示「請求了多少資源」，不試圖換算成錢。

### 2. Switchover 頁面（新側欄項目，支援批次）

你問「這會建議多一個左側導覽欄位嗎？我會想有辦法一次設定多組要 switchover」——查證後確認 mariadb-operator 真的有官方支援的手動 switchover 機制：`spec.replication.primary.podIndex` / `spec.galera.primary.podIndex`（`kubectl explain` 的說明就寫「The user may change this field to perform a manual switchover」）。改這個欄位會觸發 operator 自己一套完整的 graceful 交接流程（lock primary with read lock → set read_only → 等 replica 追上 → promote，`pkg/controller/replication/switchover.go`），**不是**直接砍 primary pod 逼它失聯的 chaos 手法——這正是你要的「有計劃」而不是「意外測試」。

批次操作天生就跨多個 instance，塞進單一 instance 的 Resilience 分頁不合理，所以做成獨立的側欄頁面（`Switchover.jsx`，`ArrowRightLeft` 圖示）：
- 列出叢集裡所有 Replication/Galera instance（Standalone 沒有 primary 概念，不會出現），秀出目前 primary、一個選要切到哪個 replica 的下拉選單。
- 每列可以勾選、也有單獨的「Switch」按鈕；上方「Run N switchovers」一次觸發所有勾選的（PATCH 呼叫依序送出，但送出後各自獨立 poll 進度，不互相卡住）。
- 後端只加一支 `PATCH /api/instances/:namespace/:name/switchover`（body `{ podIndex }`），依 instance 是 Replication 還是 Galera 決定要 patch 哪個欄位；判斷是否完成看 `PrimarySwitched` 這個 condition 翻 True、且 `status.currentPrimary` 真的變成目標 pod。

**驗證**：直接對 `test1/test-db-1`（3 replicas）打這支 API 兩次，實測 primary 從 `test-db-1-2` 切到 `test-db-1-1`——這個真實的 replication 叢集，`PrimarySwitched` condition 在切換過程中會先變 `False`（正在切）再變回 `True`（切完），跟前端 poll 邏輯（要求兩個條件同時成立）完全對得上，不是憑空猜的狀態機。

### 3. New Instance 精靈支援一次建立多組（做了，之後又拿掉）

你要求把「Clone Instance」延伸成「一次建立多組」，做法是 Basics 步驟加「Number of instances」欄位（1-10），數量 >1 時 Name 欄位變成「Name prefix」+ 即時預覽生成的名字，`deploy()` 依序呼叫既有的 `/api/deploy` N 次，`ResultModal` 加 `bulk` 模式逐一列出每個 instance 成功/失敗。實際看到畫面後你的回饋是「感覺不是我要的」，整個功能連同 `instanceCount` 欄位、`deployOne`/bulk 分支、`ResultModal` 的 bulk 顯示都已經還原掉——精靈回到只能一次建一個 instance。回想這次的教訓：這是這批功能裡唯一一個先做完整個功能才發現方向不對的,值得記一筆:「一次建立多組」這個需求本身可能更適合日後用「Clone Instance」單獨解決（複製單一 instance 的 spec 到精靈當預填值,一次還是只建一個),而不是在精靈裡加一個「數量」欄位去批次跑——後者做出來之後感覺更像是在單一表單裡硬塞一個迴圈,不是自然的操作流程。

### 4. PMM 深連結

Overview 分頁的 Features 卡片，PMM 有開的話會多一行「Percona PMM」，顯示 PMM Server 位址。**刻意沒有做成一個可以直接點的連結**——`PMM_AGENT_SERVER_ADDRESS` 是叢集內部的 DNS（例如 `monitoring-service.monitoring.svc.cluster.local:443`），瀏覽器本來就連不到，直接塞一個 `<a href>` 只會是一個點了沒反應/轉圈圈的假連結。改成偵測是不是符合 `<service>.<namespace>.svc.cluster.local` 這個 K8s 內部 DNS 格式，是的話直接生成、附上複製按鈕的 `kubectl port-forward -n <namespace> svc/<service> 8443:<port>` 指令，並提示「port-forward 完開 `https://localhost:8443` 搜尋這個 instance 的名字」——沒有假裝有一條直接可點的路，誠實反映「瀏覽器連不到叢集內部」這個限制。後端 `/api/instances/:namespace/:name` 順便多回傳一個 `pmmServerAddress` 欄位（從 `spec.sidecarContainers` 裡的 `PMM_AGENT_SERVER_ADDRESS` env 抓出來）。

### 5. 版本落後提醒（可在 Settings 設定）

你問「這邊看版本能否在 setting 設定」——Settings 頁新增「Latest known MariaDB version」文字欄位（預設 `11.8.5`，跟精靈的預設版本一致），**不接任何 registry API 去查真的最新版本**，純粹是你自己維護的一個目標值。Config Health 檢查清單多一項第 6 項「Up to date (target: x.x.x)」，拿 instance 目前的 image tag 版本號跟這個設定值做**數字逐段比較**（不是字串比較——字串比較會把 `"11.10.0"` 排在 `"11.8.5"` 前面，數字結果相反，所以特地寫了 `isVersionBehind()` 拆成 `.` 分段轉數字比對）。

### 討論但先不做：簡易即時指標圖（#6）

你想要的「簡易即時指標圖」在這個架構下有個實際限制：`ui/server.js` 是跑在你的host機器上用 `kubectl`/`helm` 操作叢集，不是跑在叢集裡面的 pod，沒辦法直接打 ClusterIP 連到 mysqld-exporter 的 `/metrics`，只能靠 `kubectl exec` 進某個 pod 裡下指令抓，這樣每次刷新大概要 1-2 秒，做不到真正意義上的「即時」。跟你確認過後，決定先不做，之後有需要再回來討論怎麼做（可能方向：輕量版每 5-10 秒 exec 抓幾個關鍵數字疊成折線圖；或者只在已經接 PMM 的 instance 上直接連去 PMM 自己存好的歷史數據，不用另外做一套抓取邏輯）。

## 五個新功能：Resilience 分頁（Pod Failover Drill + Restore Drill）、Config Health、Topology 圖、Capacity 頁面（2026-08-06）

你說「這 UI 還是很空」，丟了一個你自己的點子（delete pod 測 switchover）問還有什麼建議。討論後你選了全部 5 個一起做：

1. **Pod Failover Drill**（Resilience 分頁）
2. **Backup Restore Drill**（同一個 Resilience 分頁）
3. **Config Health 檢查清單**（Overview 分頁最上方）
4. **Replication/Galera Topology 視覺化圖**（Replication 分頁）
5. **Capacity 頁面**（新側欄項目，跨 namespace 彙總資源用量）

### 1. Pod Failover Drill

Instance 詳情頁新增「Resilience」分頁（火焰圖示）。選一個 pod（預設選目前 primary）、點 Delete，跳出「打字輸入 pod 名稱才能確認」的 modal（跟 Dashboard 刪除 instance 用同一套防呆機制），送出後打 `POST /api/instances/:ns/:name/chaos/delete-pod`（後端會先核對這個 pod 名稱真的屬於這個 instance 的 StatefulSet，不接受任意 pod 名稱）。刪除後前端每 2 秒 poll 一次 pods/instance detail/events，即時把 phase 變化、primary 是否重新指派、相關 event 訊息疊成一個時間軸，直到 pod 恢復 Ready（且如果剛好刪的是 primary，還要等 primary 重新穩定）或 90 秒逾時。

**驗證**：直接對 `pmm-verify`（standalone）打這個 API 刪掉 `pmm-verify-0`，實測 StatefulSet 在 36 秒內重建、變回 `2/2 Running`（新 pod，`creationTimestamp` 有更新，不是原地重啟）。畫面上用 headless Chrome 確認 modal 的「打字才能確認」防呆正常、Cancel 不會真的送出任何請求（`kubectl get pods` 核對過程中 pod 完全沒被動到）。

### 2. Backup Restore Drill

同一個 Resilience 分頁下方，列出這個 instance 的所有 Backup（複用既有的 `GET /api/crd/backup?namespace=&ref=&refField=mariaDbRef`），選一個、Run drill，會在**同一個 namespace**建一個名字固定叫 `<instance>-drill` 的全新 MariaDB instance，`spec.bootstrapFrom.backupRef` 指向選的那個 Backup（`bootstrapFrom` 沒有跨 namespace 欄位，所以只能同 namespace）。這是真的證明備份能不能用的唯一方法——不是檢查 Backup CR 的 Complete 狀態而已，是真的整套還原、跑起來、Ready 了才算數。

**過程中抓到並修掉的 2 個真的 bug**（都是靠實測 `bootstrapFrom` 才發現，光看 YAML 生成邏輯完全看不出來）：

1. **Root 密碼驗證失敗**：第一版幫 drill instance 隨機生一組全新的 root 密碼。實測後 drill pod 一直 `CrashLoopBackOff`，log 顯示 `Access denied for user 'root'@'localhost'`。查了 Backup 的邏輯備份（`pkg/command/backup.go:569` 預設 `--all-databases`，含 `mysql.global_priv`）+ 用 debug pod 掛上備份 PVC 直接讀 `.sql` 內容，確認 dump 裡真的含 root 的密碼 hash（用 Python 算 `SHA1(SHA1(password))` 比對過，字元完全吻合）。關鍵是：`bootstrapFrom` 還原出來的 pod 完全沒有跑 operator 平常「首次開機用 Secret 設定 root 密碼」那段初始化邏輯（log 直接從空白跳到 `ready for connections`，中間毫無 init 訊息）——datadir 是在這個 container 啟動前就已經被還原好的。也就是說**還原後 root 的實際密碼是備份當下來源 instance 的密碼，不是幫 drill instance 新產生的那組**。修法：拿掉隨機產生密碼那段，改成直接複用**來源 instance 自己的** `spec.rootPasswordSecretKeyRef`（同一個 namespace，同一把 Secret，不用另外建）。
2. **重新 Run drill 會悄悄吃到上一次的舊資料**：修完密碼問題後，中途因為除錯需要反覆刪除重建 `<instance>-drill`，結果密碼問題明明修好了，卻還是連續失敗好幾次——後來才發現 `kubectl delete mariadb <name>-drill`（沿用既有的通用刪除 instance API）**不會刪掉 StatefulSet 的 PVC**（這是刻意的行為，保護真的 instance 的資料不會被誤刪，Dashboard 刪除 instance 的 modal 上就寫著這句話）。但對 drill instance 來說，這個「保護」反而是個坑：PVC 名字固定（`storage-<name>-drill-0`），第二次 Run drill 會沿用同一個 PVC，等於沒有真的重新還原,只是把「舊資料」誤判成「新的還原結果」。修法：新增一支專門給 drill 用的 `DELETE /api/instances/:namespace/:name/restore-drill`，刪 MariaDB CR 之後**額外用 label selector 把對應的 PVC 也刪掉**（`app.kubernetes.io/instance=<name>-drill`），跟通用的 instance 刪除 API 分開，因為兩者「該不該留 PVC」的正確答案本來就不一樣——真的 instance 要護資料，drill instance 本質是拋棄式的，留著 PVC 反而是風險，不是保護。前端 `RestoreDrill` 元件的 Cleanup 按鈕已經改打新的這支 API。

**驗證**：`pmm-verify` 建一個真的 Backup（PVC 存儲），修好上面兩個 bug 之後跑 drill，`pmm-verify-drill` 在約 48 秒內變成 `Running`；`kubectl exec` 進去用來源密碼登入成功、`SHOW DATABASES` 看得到 `mysql`/`sys` 等完整 schema、`mysql.user` 表裡看得到從來源 instance 還原回來的 `pmm` 監控帳號——確認不只是「Ready 燈號變綠」,是真的還原了完整可用的資料庫。之後又完整測了一次「刪除 drill → 重新 Run drill」的循環，確認新的 PVC 清理邏輯生效、`storage-<name>-drill-0` 這個 PVC 真的被清掉,第二次還原是乾淨的。測試用的 Backup CR 跟 PVC 事後都清掉了,`test1` 留了一個乾淨的 `pmm-verify-backup-1`（Backup，PVC 存儲）當範例,可以直接在 UI 上試這個功能。

### 3. Config Health 檢查清單

Overview 分頁最上方新增一張卡片，5 項檢查：Resource requests/limits 有沒有設、TLS 有沒有開、有沒有排程備份（查有沒有任一個 Backup 的 `spec.schedule.cron` 有值）、是不是 HA topology（Replication/Galera 且 replicas>1）、有沒有接 monitoring（PMM 或 metrics 任一個）。每項通過/沒通過都有小圖示，沒通過的項目下面會有一行「為什麼在意這件事」的說明（不是只有紅叉，要讓人知道為什麼要修）。右上角一個「x/5」的分數徽章，全過是綠色、過一半以上黃色、不到一半紅色。

### 4. Topology 視覺化圖

Replication 分頁：原本只有純表格，現在最上面加一張圖——Primary 卡片在左邊（皇冠圖示），用 SVG 畫的箭頭指向右邊每個 Replica 卡片，箭頭顏色/實線虛線反映 IO/SQL thread 是否正常（綠色實線 = 正常、紅色虛線 = 有問題），旁邊列 lag 秒數。Galera 的話原本這個分頁會顯示「No replication data available」（因為 `status.replication` 這個欄位是 Replication 專屬,Galera 沒有），現在改成抓 pods API 畫一個環狀圖（用三角函數算每個 pod 在圓周上的座標），primary 用橘色標出來、其他 member 用一般顏色,並附註「Galera 沒有透過 MariaDB CR 的 status 暴露每個節點的即時 wsrep 狀態（cluster size/local state），這張圖只呈現目前拿得到的資訊——實體 pod 成員關係跟目前的 primary」,沒有假裝有更細的資料。

`server.js` 的 `/pods` API 順便修正了一個小地方：pod 的 `role` 欄位原本只有 Replication 拿得到（來自 `status.replication.roles`）,Galera 會全部顯示 `Unknown`。改成 Galera 情況下 fallback 成「跟 `status.currentPrimary` 比對」來判斷 Primary/Member,這樣 Galera 環狀圖才有辦法正確標出哪個是 primary。

### 5. Capacity 頁面

新的側欄項目（Gauge 圖示）。後端 `GET /api/capacity`：抓全叢集所有 MariaDB instance 的 `spec.resources`/`spec.storage`,乘上 replica 數,依 namespace 分組加總。頁面上是 4 張總覽卡片（Instances/CPU/Memory/Storage,都是 requested,不是 limit,也不是即時用量）+ 每個 namespace 的長條圖（用容易讀的橫向 bar,不是花俏的圖表）+ 每個 instance 的明細表（點一列直接跳轉到那個 instance 的詳情頁）。

**刻意不做的**：沒有接 `kubectl top nodes`（這個 KIND 叢集沒裝 metrics-server,`kubectl top nodes` 直接回 `error: Metrics API not available`）,所以頁面上方特別註明這是「你請求了多少」而不是「實際用了多少」,避免誤會成即時監控。真的要看即時使用率,還是要去 PMM。

### 共同的驗證方式

5 個功能全部先跑過 `npx vite build`（乾淨無錯誤,沒有殘留在 repo 裡,build 完就刪 `dist/`）,再丟一個 headless Chrome（Playwright）背景 agent 逐一點過畫面截圖確認、監聽 console error。Resilience 分頁的兩個 drill 因為都是真的會動到叢集的操作,agent 只驗證「modal 開得起來、Cancel 能乾淨關掉、沒有誤送出請求」,實際「按下確認鍵」的完整流程（刪 pod、真的建 drill instance）改成我自己直接對後端 API 手動測,原因就是上面寫的那兩個 bug——都是靠這樣正經跑一次真實流程才抓到的,只看 YAML/程式碼邏輯看不出來。

## New Instance 精靈：Metrics 帳密固定為 `metrics`/`metrics`（2026-08-06）

你要求把 Security 步驟裡 Metrics 開關打開後的監控帳密固定成 `metrics`/`metrics`，理由是這個帳號權限很小（operator 內建的 metrics grants，唯讀、不碰 schema），共用一組低權限密碼沒有實質風險。

**做了什麼**：`ui/src/pages/CreateMariaDB.jsx` 的 Metrics 開關 `onChange` 改成同時把 `metricsUsername`/`metricsPassword`/`metricsPasswordConfirm` 這三個欄位固定寫成 `'metrics'`（關閉時清空回 `''`）；原本開啟後才出現的 Username/Password/Confirm Password 三個輸入框整個拿掉，改成一行說明文字：「Monitoring user credentials are fixed to `metrics` / `metrics`」+ 理由。`buildYAML`／送出建立用的邏輯完全沒動——本來就是讀 `form.metricsUsername`/`form.metricsPassword`，固定值一樣照原本路徑存進 `<name>-metrics-password` 這把 Secret 的機制走。

**驗證**：用 headless Chrome（Playwright）實測整個開關切換——關閉時 Security 步驟只有 5 個輸入框（root/replication 密碼 + database name，沒有任何 Metrics 相關欄位）；打開後欄位數不變，只多出那行固定帳密的說明文字，沒有新的輸入框；關掉後說明文字消失，卡片收回。全程監聽 console error/pageerror，沒有任何 JS 錯誤（尤其是改成同時呼叫三次 `update()` 那個寫法，確認不會有 `setForm is not defined` 這類 ReferenceError——`StepSecurity` 這個 function component 本來就只吃 `form`/`update`/`errors` 三個 props，沒有 `setForm`，一開始寫成直接呼叫 `setForm(f => ...)` 會直接炸掉，改成呼叫三次 `update(key, val)` 才對）。

## New Instance 精靈：整合 Percona PMM Monitoring（2026-08-05）

你問「知道 Percona Monitoring and Management 嗎？有辦法將裡面監控與這 UI 結合嗎？」

**先查證可行性**：mariadb-operator 本身沒有原生的 PMM 整合，但 `MariaDB` CRD 有 `spec.sidecarContainers`（`api/v1alpha1/mariadb_types.go:542-545`）——可以塞任意 Container 進 Pod，不需要改 operator 原始碼。搭配 `spec.volumes`（`mariadb_types.go:569`，支援 `emptyDir`）可以給這個 sidecar 一塊可寫入的空間。這條路徑走得通，所以按你的指示直接做了，不是先回報「不行」。

叢集裡目前沒有 PMM Server（`kubectl get pods/svc -A | grep pmm` 都是空的），所以這個功能只做「幫你的 MariaDB instance 接上已存在的 PMM Server」這一段，不包含部署 PMM Server 本身。

**做了什麼**：New Instance 精靈的 Security 步驟、Metrics 卡片下方新增一張「Percona PMM Monitoring」卡片，開關打開後填：
- PMM Server 位址（host:port）
- PMM Server 帳密（存進 `<name>-pmm-server` Secret）
- Skip TLS verification（PMM Server 常見自簽憑證）
- PMM Client image（預設 `percona/pmm-client:3`，可手動改成 `:2` 對應 PMM Server 是 v2 的情況）
- Database 監控帳密（存進 `<name>-pmm-db` Secret；這個 MySQL 使用者需要 `SELECT, PROCESS, REPLICATION CLIENT, RELOAD` 等權限，這張表單不會自動建立這個使用者，要用這個面板的 Users/Grants CRD 分頁另外建）

送出後會在 `spec` 裡加上：
```yaml
volumes:
  - name: pmm-client-storage
    emptyDir: {}
sidecarContainers:
  - name: pmm-client
    image: percona/pmm-client:3
    volumeMounts:
      - name: pmm-client-storage
        mountPath: /usr/local/percona/pmm/config
    env:
      - name: PMM_AGENT_SERVER_ADDRESS / USERNAME / PASSWORD / INSECURE_TLS
      - name: PMM_AGENT_CONFIG_FILE
      - name: PMM_AGENT_SETUP / SETUP_FORCE / SIDECAR
      - name: PMM_DB_USERNAME / PMM_DB_PASSWORD
      - name: PMM_AGENT_PRERUN_SCRIPT   # pmm-admin add mysql --host=127.0.0.1 --port=3306 ...
```

**過程中修正了兩個自己犯的錯**，都是靠實際部署到 KIND 叢集才抓出來的，光看 YAML 生成邏輯看不出來：

1. 第一版直接照網路上零散的 PMM Docker 環境變數（`PMM_AGENT_SETUP_NODE_TYPE=container`、`PMM_AGENT_SETUP_SERVICE_NAME` 等）拼，部署後 `pmm-client` container 直接 `CrashLoopBackOff`——查了 log 才發現那組變數是「pmm-client 自己當一個 standalone container/node」的模式，不是「sidecar 掛在別的 DB container 旁邊」的模式。用 WebFetch 查了 Percona 官方文件（[Install PMM Client on Kubernetes](https://docs.percona.com/percona-monitoring-and-management/3/install-pmm/install-pmm-client/kubernetes.html)）裡完整的 sidecar YAML 範例後重寫：關鍵是要有 `PMM_AGENT_SIDECAR=1`（讓 entrypoint 保持重試而不是跑一次就退出）+ `PMM_AGENT_CONFIG_FILE` + `PMM_AGENT_PRERUN_SCRIPT` 裡呼叫 `pmm-admin add mysql`（而不是 `PMM_AGENT_SETUP_*` 那組變數）。
2. 修正後第一次還是 crash，log 顯示 `Failed to load configuration: ... permission denied`——`pmm-client` 需要一個可寫入的設定目錄。加了 `emptyDir` 掛到 `/usr/local/percona/pmm`（整個安裝根目錄）後又壞掉，變成 `exec: "pmm-agent-entrypoint": no such file or directory`——emptyDir 掛在那層會整個蓋掉 image 內建的二進位檔（K8s volume mount 的常見坑）。改成只掛 `/usr/local/percona/pmm/config` 這一層之後才穩定跑起來。

**驗證**：在 `test1` namespace 實際部署過兩次（一次用手刻 YAML 測 sidecar 修正過程、一次直接打 `/api/deploy`——跟 UI 走的是同一條路徑）。兩次都確認 `mariadb`、`pmm-client` 兩個 container 都進入穩定 `Running`（不是一次性 exit），`pmm-client` log 顯示設定檔讀取成功、正確從 Secret 解析出 `PMM_AGENT_SERVER_ADDRESS` 並嘗試對外註冊，最後卡在「`dial tcp: lookup pmm-server.monitoring.svc.cluster.local: no such host`」——這是預期的（叢集裡沒有真的 PMM Server，這只是驗證用的假地址），代表整條線路是通的，接上真的 PMM Server 位址就能運作。測試資源事後都清掉了。用 headless Chrome 走過精靈填表 + Review 步驟的 YAML 預覽，畫面跟生成的 YAML 都正常、無 console 錯誤。

**已知限制**：PMM Client 的設定檔用 `emptyDir`（非持久化），Pod 重啟會遺失、需要重新註冊——`pmm-admin add mysql` 本身冪等，重新註冊不會出錯，只是每次重啟都會重跑一次。之後如果想做成真正持久化，需要另外在精靈裡加一個 PVC size 欄位（目前為了先把核心功能做完沒加，可以之後再補）。

### PMM 使用方式（怎麼在 UI 上接一個 instance 到 PMM Server）

**前提**：手上要有一個已經在跑、且這個 K8s 叢集能連得到的 PMM Server（這個功能不部署 PMM Server，只負責把 MariaDB instance 接上去）。

1. **開 New Instance 精靈**，一路填到 **Security** 步驟，在 Metrics 卡片下方會看到「Percona PMM Monitoring」卡片，打開開關。
2. 填 **PMM Server address**：`host:port` 格式，例如 `pmm-server.monitoring.svc.cluster.local:443`（同叢集內的 Service）或外部位址。
3. 填 **PMM Server username/password**（+ Confirm password 二次確認）——這是登入 PMM Server 本身的帳密，不是資料庫帳密。會存進 `<instance名稱>-pmm-server` 這個 Secret。
4. **Skip TLS verification**：PMM Server 常見自簽憑證，預設打開；如果 PMM Server 有正式憑證可以關掉。
5. **PMM Client image**：預設 `percona/pmm-client:3`，要跟 PMM Server 的大版本對齊——PMM Server 是 v2 的話要手動改成 `percona/pmm-client:2`。
6. 填 **Database monitoring user**（username/password + Confirm）——pmm-agent 會用這組帳密以 `127.0.0.1:3306` 本機連線去監控這個 MariaDB。**這組帳號 UI 不會自動建立**，必須自己先用同一個 instance 的 CRDs 分頁 → Users/Grants，建一個有 `SELECT, PROCESS, REPLICATION CLIENT, RELOAD` 權限的使用者（確切權限清單依 MariaDB 版本可能略有差異，可對照 Percona PMM 官方文件），帳密要跟這裡填的一致。密碼存進 `<instance名稱>-pmm-db` 這個 Secret。
7. 走完 Review 步驟確認 YAML 預覽裡有 `pmm-client` sidecar 跟對應的 `emptyDir` volume，送出部署。
8. 部署後可以 `kubectl get pods -n <namespace> <instance>-0` 確認 pod 裡有 `mariadb` 跟 `pmm-client` 兩個 container 都是 `Running`；`kubectl logs -n <namespace> <instance>-0 -c pmm-client` 可以看到 `pmm-admin add mysql` 的註冊結果——連線失敗多半是 PMM Server 位址錯、帳密錯，或監控用的資料庫使用者權限不夠/密碼跟這裡填的對不上。
9. 註冊成功後，到 PMM Server 的 Web UI（不是這個 mariadb-operator UI）就能看到這個 instance 出現在 Inventory / Query Analytics 裡。

**實際範例**——`test1/pmm-verify` 這個驗證用 instance，精靈欄位當時填的值：

| 精靈欄位 | 填的值 |
|---|---|
| PMM Server address | `monitoring-service.monitoring.svc.cluster.local:443`（PMM Server 裝在 `monitoring` namespace，跨 namespace 要用 `<service>.<namespace>.svc.cluster.local` 這個完整格式，同 namespace 才能只寫 `<service>`） |
| PMM Server username | `admin` |
| PMM Server password | 裝 PMM Server（`helm install pmm ...`）當時設定的那組 admin 密碼 |
| Skip TLS verification | 開（PMM Server 用自簽憑證） |
| PMM Client image | `percona/pmm-client:3`（維持預設值，因為裝的 PMM Server 也是 v3） |
| Database monitoring username | `pmm` |
| Database monitoring password | 另外隨機產生一組，跟 PMM Server 密碼分開 |

填完送出部署後，額外去 CRDs 分頁的 Users/Grants 幫 `pmm`（`host: 127.0.0.1`）這個帳號建了 `SELECT, PROCESS, REPLICATION CLIENT, RELOAD` 權限——這步精靈本身不會做，前面步驟 6 已經說明過。

**要調整既有設定**（換 PMM Server 位址、換監控密碼等）：目前精靈只在「建立」流程有這張卡片，沒有做「已存在的 instance 事後修改 PMM 設定」的介面——要改的話得直接編輯該 instance 的 `spec.sidecarContainers`/`spec.volumes`（`kubectl edit mariadb <name>`）或改對應的 `-pmm-server`/`-pmm-db` Secret 後重啟 pod 讓新設定生效。

### 對著真的 PMM Server 驗證後，抓到並修掉一個嚴重 bug：`pmm-client` 對真實 PMM Server 一律 permission denied（2026-08-06）

先前那次驗證（上面「驗證」那段）叢集裡沒有真的 PMM Server，所以只確認到 `pmm-client` 能正確解析 Secret、嘗試對外連線，卡在 DNS 解析失敗就結束了——**沒有真的跑到 agent 啟動那一步**。這次先用 Percona 官方 Helm chart（`percona/pmm`）把一個真正的 PMM Server 部署到這個 KIND 叢集的 `monitoring` namespace 驗證，才發現這個功能上線以來其實一直是壞的：

```
level=info msg="Two-way communication channel to Agents Service established..." component=client
level=error msg="Failed to start Agent: mkdir /usr/local/percona/pmm/tmp: permission denied." component=supervisor
```

跟 PMM Server 的連線本身是通的（gRPC channel 建立成功），但 agent 起不來，`node_exporter`/`mysqld_exporter`/QAN 全部無法啟動——等於**這個 sidecar 部署了但完全沒有在收集任何監控數據**，而且不會有任何看起來像失敗的訊號（container 是 `Running` 不是 `CrashLoopBackOff`），非常容易被忽略。

**根因**：`kubectl explain mariadb.spec.sidecarContainers` 可以看到這個欄位背後是精簡過的 Container 型別，**沒有 `securityContext` 子欄位**——sidecar container 沒有辦法覆寫自己的 uid/gid，只能整個繼承 Pod 層級的 `securityContext`。而這個 operator 在使用者沒有自己填 `spec.podSecurityContext` 時（`pkg/builder/securitycontext_builder.go:61-66`），預設會把整個 Pod（含所有 sidecar）的 `runAsUser`/`runAsGroup`/`fsGroup` 全部釘死成 MariaDB 自己的 mysql uid（`999`）。用 `kubectl exec ... -- id` 進 `pmm-client` container 檢查，實際套用的是 `uid=999`，但 `percona/pmm-client:3` 這個 image 裡 `/usr/local/percona/pmm/` 整個目錄樹是照它自己內建的 `pmm-agent` 使用者（`uid=1002, gid=1002`）建置的（`ls -la` 顯示 owner 是 `pmm-agent:pmm-agent`）——999 既不是 owner 也不在 group 裡，只剩 other 權限（`r-x`，沒有 `w`），所以 agent 連自己要用的 `tmp` 子目錄都建不出來。

**修法**：`spec.sidecarContainers` 雖然不能單獨設 uid，但 MariaDB CRD 另外有一組 `spec.podSecurityContext`（Pod 層級）跟 `spec.securityContext`（**只套用在 mariadb 主 container**，`pkg/builder/container_builder.go:355`，會覆寫 Pod 層級預設值）。所以做法是「反過來」：把 Pod 層級預設值改成 pmm-agent 要的 `1002`，再用只對 mariadb container 生效的 `securityContext` 把它重新釘回 `999`——sidecar 沒有自己的覆寫欄位，就吃到 Pod 層級的 `1002`，mariadb container 則因為有自己的覆寫而繼續用正確的 `999`：

```yaml
spec:
  podSecurityContext:
    runAsNonRoot: true
    runAsUser: 1002
    runAsGroup: 1002
    fsGroup: 1002
  securityContext:
    runAsUser: 999
    runAsGroup: 999
```

`server.js` 的 `buildYAML`（實際送出用）跟 `CreateMariaDB.jsx` 的 client 端 `buildYAML`（Review 步驟的 YAML 預覽）都已經同步加上這段——只在 `form.pmmEnabled` 為真時附加，不影響沒開 PMM 的既有部署。

**驗證**：先在既有的 `test1/pmm-verify` instance 上手動 `kubectl patch` 套用這組 securityContext，確認 `pmm-client` log 從 `permission denied` 變成三個 agent（`node_exporter`/`mysqld_exporter`/`qan_mysql_perfschema_agent`）全部 `AGENT_STATUS_RUNNING`；接著建立資料庫監控帳號（`User`/`Grant` CR，`pmm`@`127.0.0.1`，`SELECT, PROCESS, REPLICATION CLIENT, RELOAD`）後，用 PMM Server 的 `/v1/inventory/services` API 確認 `pmm-verify` 真的出現在 `mysql` 服務清單裡——不只是連線通,是整條「MariaDB → pmm-client → PMM Server → Inventory」的鏈路都跑通了。改完 `server.js`/`CreateMariaDB.jsx` 後，重啟 API server、**重新用修好的程式碼建一個全新的 `test1/pmm-verify2` instance**（沒有手動 patch 任何東西），確認兩個 container 直接 `Running`、`pmm-client` log 沒有再出現 `permission denied`，證明修的是精靈本身、不是我手動修好一個特例而已。驗證完 `pmm-verify2` 已刪除；`pmm-verify`（第一個、已在 PMM Server 上看得到數據）跟 `monitoring` namespace 的 PMM Server 都保留著，方便直接在 PMM Server UI（`kubectl port-forward -n monitoring svc/monitoring-service 8443:443`，帳密見上面「PMM 使用方式」段落）裡看實際數據。

**已知殘留限制**：`1002` 這個 uid 是照 `percona/pmm-client:3` 這個 tag 實測出來的,如果手動把 PMM Client image 換成 `:2`（PMM Server 是 v2 的情況),沒有重新驗證過 `:2` 這個 image 內建的使用者 uid 是否也是 `1002`——理論上 Percona 兩個大版本的 image 使用者設計可能不同,換版本時如果又出現同樣的 `permission denied`,要重新用 `kubectl exec ... -- id` 對照 image 實際的 uid/gid 調整這兩段 securityContext。

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
