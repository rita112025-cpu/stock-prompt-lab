# 股市 Prompt 工作台 V5.3.1

8 組研究 Prompt、CSV 持股匯入、帳戶篩選、市值／損益／權重計算。

## 使用方式
1. 進入「持股表」，點「匯入持股 CSV」。
2. 預覽後選「取代」或「加入」。CSV 視為各帳戶目前的完整持股：取代只會清空並更新檔案中出現的帳戶，其他帳戶不變；加入只能新增尚未存在的「帳戶＋代號」，遇到重複會整批阻止。檔案內同帳戶同代號的多列會先合併，成本按股數加權。
3. 編輯股數、成本均價、現價後，總覽會同步計算。
4. 複製組合健檢 Prompt 時，會附上目前帳戶篩選的持股與總額。
5. 離開或重新整理前下載 CSV 備份；本站僅將資料保留於本次開啟的記憶體，不會自動上傳或永久保存。

CSV 必填欄位：代號、名稱、股數、成本均價、現價；帳戶、因子可省略。缺少帳戶欄時，匯入預覽會要求指定帳戶，不會依目前篩選自動帶入；因子未填時 00 開頭代號視為 ETF，其餘為「未分類」，也可在持股表直接修改。支援 UTF-8 與 Big5。代號請以文字欄位保存，避免 Excel 刪掉前導 0；代號和現有持股、或和同一檔案內同帳戶的其他代號只差開頭的 0 時，整批匯入會被阻止。
所有金額須使用同一幣別。價格為使用者輸入，分析日期不等於行情日期。損益按股數與均價估算，未另計手續費、稅、股息及已實現損益。因子分類以 CSV 或手動輸入為準，網站不內建任何個股對照表，也未計算 ETF 穿透曝險。
複製後貼至其他 AI 服務的資料，會由接收服務處理，請自行確認貼上的資訊範圍。

## 本機執行（Windows／macOS／Linux）
先安裝 Node.js 24（含 npm），再於專案資料夾開啟終端機：

```bash
npm ci
npx playwright install chromium
npm test
npm run typecheck
npm run build
npm run privacy-check
npm run test:e2e
npm run dev
```

依終端機顯示的本機網址開啟網站。正式建置的預覽可執行 `npm run preview`，路徑為 `/stock-prompt-lab/`。
若 npm ci 失敗，先確認能連線 npm 套件來源；不要拿舊 dist 當作修正版部署。

### 瀏覽器回歸測試

測試使用虛構資料，對正式建置的本機預覽執行 CSV 匯入、股數／成本／價格／因子編輯重算、帳戶篩選、Prompt 剪貼簿與手動複製、下載重匯、空持股、重新整理清空、桌面及 320px／390px 版面檢查。每項測試都檢查 Console error 與未捕捉的 JavaScript 例外。首次執行先安裝 Chromium；測試前先執行 `npm run build`：

```bash
npx playwright install chromium
npm run test:e2e
```

Windows 已安裝 Edge 時，也可以在 PowerShell 直接使用：

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e
```

`test:browser` 保留為同義指令；`npm run test:e2e:ui` 開啟測試 UI，`npm run test:e2e:headed` 顯示瀏覽器。若要從 Edge 切回預設 Chromium，在 PowerShell 執行 `Remove-Item Env:PLAYWRIGHT_CHANNEL -ErrorAction SilentlyContinue`。

測試會自行啟停 `127.0.0.1:4173` 預覽。失敗截圖及操作軌跡存放在 `screenshots/browser-tests/`，HTML 報告位於 `screenshots/playwright-report/`，均已被 Git 忽略。可執行 `npx playwright show-report screenshots/playwright-report` 開啟報告。窄螢幕檢查不等同手機實機或 iOS Safari 測試。

Actions 已設定安裝 Chromium 並執行 E2E，失敗時不部署；報告與測試附件保留 7 天。設定參照 [Playwright 官方 CI 說明](https://playwright.dev/docs/ci-intro)。本機驗證不代表遠端 Actions 已實跑通過。

## 隱私守則（必讀）
公開儲存庫中的檔案、歷史版本與已發布的前端 JS 都應按公開資料處理；不要依賴 noindex 保密，它不是存取權限。
- 原始碼、README、測試、打包檔都**不得**出現真實持股、代號清單、帳戶名稱、成本或金額。測試請用虛構代號（例：0001、9999）。
- 持股備份 CSV／Excel 放在專案資料夾以外；`.gitignore` 已排除 `*.csv`、`*.xlsx`、`holdings_*` 等，但已被追蹤的檔案仍須 `git rm --cached`。
- 只用 GitHub Actions 部署（已移除 `npm run deploy` 腳本；gh-pages 套件仍保留於依賴中，避免繞過 CI 檢查把 dist 推進公開分支）。
- `npm run privacy-check`（CI 也會跑，未通過不部署）會擋：被追蹤的資料檔、寫死的 `shares`／`costAvg` 數值、股票代號陣列、自訂私密關鍵字。
  - 本機：在專案根目錄建立 `.privacy-denylist`（已 gitignore），一行一個帳戶名稱或股票名稱。
  - CI：repo Settings → Secrets and variables → Actions 新增 `PRIVACY_DENYLIST`（逗號分隔）。紀錄只會顯示「第幾個關鍵字」。
  - 建議放中文名稱而不是純數字代號，純數字容易和打包檔中的其他數字誤判。

## 舊資料與更新
本次未查證遠端 commit 數量、fork／star、線上版本或網頁存檔；不把其他回報當成已驗證事實。
更新前，將私人 CSV 備份在儲存庫外，從目前追蹤檔案中移除私人資料。先執行 `npm ci`、`npm test`、`npm run typecheck`、`npm run build`、`npm run privacy-check`，全部成功後再提交部署。
此版不會自動刪除儲存庫、改寫歷史或推送部署。若舊資料曾經公開，單純覆蓋新檔案不會移除歷史；應另行確認舊分支、部署、執行紀錄與附件，再決定如何清理。
刪除並重建儲存庫是破壞性操作，不列為預設更新步驟；即使刪除，也不能保證他人副本或快取消失。

## 修正內容
### V5.3.1
- 移除「因子分類」中寫死的持股代號清單（V5.2 打包檔仍可還原完整持股代號）；改為 CSV「因子」欄或表格內手動輸入，CSV 下載／匯入保留因子。
- 預設關注標的改為空白；空白欄位在 Prompt 中顯示「未提供」。
- 測試資料改用虛構代號與數字（V5.2 仍使用真實持有代號及相同股數）。
- 修正 package-lock.json 中 email-addresses、locate-path 版本號被誤改為 5.2.0 的問題。
- 新增 `npm run privacy-check` 與 CI 檢查（先跑測試，未通過不部署）；`.gitignore` 補上 Excel、holdings_*、截圖資料夾與 `.privacy-denylist`。
- 移除 `npm run deploy`（gh-pages）；網頁加上 `noindex`；頁尾移除「截圖」字樣。

### V5.2
- 移除程式與文件中的預設個人持股、帳戶、成本與固定總額。
- 帳戶、筆數、總額改由目前篩選資料生成；移除固定前三大與產業結論。
- 無持股時阻止複製含持股的 Prompt；清空持股需確認，並重設帳戶篩選。
- 統一版本標示；修正 README 自動保存的錯誤說明。
- 移除外部字體載入；私人 CSV 加入忽略規則（已追蹤的檔案仍須另行移除）。
- 空組合總權重顯示 0%；編輯拒絕負數與非有限值。

本工具不自行取得行情，也不執行交易。

## V5.3.1 複核補正
- 缺少 dist/index.html 時隱私檢查失敗；未設定關鍵字、缺少 Git 工作目錄時清楚提示限制。
- ZIP 工作目錄也會掃描其他文字檔與 public 文字資產；不讀 node_modules、.git、私人資料夾和密鑰檔。
- Actions 加入型別檢查。原模式檢查仍不是完整個資辨識，不保證抓到所有寫法或圖片中的資料。
- 刪除未查證的遠端狀態與預設刪庫指示。noindex 不是保密措施。
