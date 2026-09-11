# V5.3.1 獨立複核紀錄

## 2026-09-11 部署前安全檢查

目前狀態：本機功能測試通過，已完成依賴影響判讀及忽略規則驗證；實際私人關鍵字掃描與遠端 Actions 驗收仍待完成，未部署。

| 實跑指令 | 結果 | 結束碼 |
|---|---|---|
| `npm audit --omit=dev --json` | 0 項漏洞 | 0 |
| `npm audit --json` | 2 個受影響套件：1 中、1 高 | 1 |
| `npm ls vite esbuild react react-dom` | Vite 5.4.21 → esbuild 0.21.5；React／ReactDOM 18.3.1 | 0 |

Vite 為 devDependency，esbuild 由 Vite 引入。audit 所列公告涉及開發伺服器路徑存取、Windows 編輯器開啟端點及 esbuild serve 的 CORS：

- [Vite Windows deny 規則繞過](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)
- [Vite source map 路徑穿越](https://github.com/vitejs/vite/security/advisories/GHSA-4w7w-66w2-5vf9)
- [Windows launch-editor UNC 路徑](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)
- [esbuild serve CORS](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99)

影響判讀：部署工作流程僅上傳 `dist`（HTML、JS、CSS），前端入口不匯入 Vite／esbuild，也不在 Pages 啟動其伺服器。據此判斷，本次列出的伺服器漏洞沒有在此靜態網站執行的路徑，不單獨阻擋靜態部署；這不代表開發工具安全或所有漏洞均已排除。開發／預覽伺服器不應當作對外正式服務。未執行 audit fix，未升級套件；npm 提議的 Vite 8.3.0 屬主要版本變更，另行安排相容性評估。

忽略與日誌驗證（於隔離暫存 Git 目錄，使用合成資料）：

- `.privacy-denylist`、`playwright-report/`、`test-results/`、`blob-report/`、`screenshots/playwright-report/` 的 5 個測試路徑均被 `git check-ignore` 忽略。既有 `screenshots/` 規則也保留。
- 模擬本機關鍵字與環境變數關鍵字命中，兩者均回傳失敗碼 1，日誌只含關鍵字編號，不含合成關鍵字原文。此驗證不是實際私人資料掃描。
- 審閱 E2E：持股使用程式內虛構資料；檔案讀取只讀取測試本身產生的下載檔。HTML 報告與 trace 可能保存測試畫面及內容，故測試不可改用真實部位。
- 專案根目錄目前不存在 `.privacy-denylist`，未收到私人比對詞。CI 已從 `secrets.PRIVACY_DENYLIST` 讀取，但未查證遠端 Secret 是否設定。缺少關鍵字時目前程式僅警告，不能把掃描通過當成已完成私人資料驗收。
- 原工作目錄無 Git；暫存目錄的忽略規則驗證不代表原／遠端儲存庫沒有已追蹤的報告或私人檔案。

## 2026-09-11 本機 DEBUG

- 修正 Prompt 替換：使用者輸入的 `$&` 等替換符號與 `{{date}}` 等字串會原樣保留，不再二次展開。
- 修正因子加總：使用無原型字典，避免 `constructor`、`__proto__` 等因子名稱與物件內建屬性衝突。
- 修正 CSV 數字解析：拒絕 `1,2`、`12,34` 等錯誤千分位，避免匯入時悄悄改變數值；保留合法千分位、小數支援。
- 分析日期改用本機年月日，避免台灣時間凌晨顯示 UTC 前一天。
- 實跑：npm test 8/8、npm run typecheck、npm run build、npm run privacy-check 均通過；dist 已重新建置。
- 後續補測：正式 dist 由 Playwright 啟動本機預覽，以無介面 Edge 實跑瀏覽器測試 8/8 通過。測試資料皆為虛構。
  - CSV 匯入、總額與帳戶篩選；錯誤 CSV 被拒絕且保留原持股。
  - 因子編輯為 `constructor`、`__proto__` 後，曝險分別正確顯示 60%／40%。
  - 真實剪貼簿讀寫：Prompt 特殊字元保留，附加持股符合帳戶篩選。
  - 自動複製不可用時出現手動複製視窗。
  - 下載 CSV 後解析比較全部欄位，重新整理後再匯入，前導零與修改後因子保留。
  - 重新整理持股歸零、localStorage／sessionStorage 無資料，含持股 Prompt 被阻止複製。
  - 390px、320px：總覽、Prompt 庫與持股表沒有整頁水平溢出，持股表可水平捲動及編輯因子；另檢視 320px 截圖。
- 再次補強：Playwright 1.63.0，安裝專用 Chromium；`test:e2e`、`test:e2e:ui`、`test:e2e:headed` 已加入，保留 `test:browser`。
- Chromium E2E 11/11 通過（43.4 秒）：新增空持股初始狀態、股數／成本／價格修改後總額與損益及權重重算、拒絕負股數、1440px 桌面溢出檢查；所有案例檢查 Console error 與未捕捉例外。
- 完整流程實跑：npm ci → npm test（8/8）→ typecheck → build → privacy-check → test:e2e（11/11）通過。npm ci 的 audit 另回報 2 項依賴漏洞（1 中、1 高），本次未修復或獨立評估漏洞影響，不能視為依賴安全檢查通過。
- HTML 報告輸出到 `screenshots/playwright-report/`；失敗時保留截圖與 trace。成功案例不保留 trace。設定已加入 Actions：Chromium E2E 失敗阻止部署，測試報告與附件保留 7 天。
- 限制：窄螢幕測試使用桌面瀏覽器，未測手機實機或 iOS Safari；遠端 Actions 尚未實跑。本資料夾無 Git，且未設定私密關鍵字，隱私檢查僅涵蓋本機有限模式掃描。沒有推送或部署。

以下為原交付紀錄，保留歷史範圍與限制；本次補測結果以上方 2026-09-11 紀錄為準。

來源：使用者上傳的 V5、V5.3 附件與本次 V5.2 工作檔。未讀取遠端儲存庫。

## 確認
- V5.2 保留因子分類代號清單；已在 V5.3 移除。
- V5.2 把 email-addresses、locate-path 的 lockfile 版本從 5.0.0 誤改為 5.2.0；V5.3 已還原。
- V5.3 缺少 dist 時 privacy-check 仍通過；本版已阻擋並擴大 ZIP 工作目錄的文字掃描。
- Actions 本版加上 typecheck；deploy 腳本已移除，gh-pages 套件仍保留。
- README 撤下未查證的遠端狀態與預設刪庫步驟。noindex 不是存取權限。

## 實跑
- 依賴安裝成功；另外 npm ci --ignore-scripts --no-audit --no-fund 成功，確認鎖定檔可安裝。此額外檢查未執行套件安裝腳本。
- npm test：5/5。
- npm run typecheck：通過。
- Vite 正式建置：通過，32 modules。
- privacy-check：原附件 29 個名稱、帳戶與成本關鍵字未命中新版文字及 dist；關鍵字未寫入交付包。
- 反向驗證：缺少 dist、未追蹤 public 內寫死持股數值、代號陣列、Git 已追蹤 CSV 均回傳失敗。

## 限制
本次未做瀏覽器互動測試，也未獨立驗證他方的 18 項瀏覽器結果。未驗證遠端 commit 數、fork、星號、Wayback Machine 或目前線上內容。未推送、部署、刪除 repo 或改寫 Git 歷史。
檢查屬有限模式辨識，未涵蓋所有持股寫法、圖片／截圖內容、Git 歷史與外部快取。公開的一個股票代號不等於證明個人持有；本次移除原專屬清單是為降低不必要揭露。
