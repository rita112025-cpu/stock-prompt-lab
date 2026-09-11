import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { DEFAULT_ACCOUNT, decodeCsv, defaultFactor, encodeCsv, parseHoldingsCsv, type ImportedHolding } from './holdingsCsv';
import { fillPrompt, localDate } from './promptUtils';

type Settings = {
  market: string;
  ticker: string;
  horizon: string;
  risk: string;
  cost: string;
  shares: string;
  date: string;
  constraint: string;
};

type Holding = {
  id: string;
  account: string;
  code: string;
  name: string;
  shares: number;
  costAvg: number;
  price: number;
  factor: string;
};

type PromptItem = {
  id: number;
  cat: string;
  title: string;
  tags: string[];
  desc: string;
  prompt: string;
};

const categories = ["全部","個股研究","持股管理","籌碼","交易判斷","事件分析","比較","晨報"];

// 隱私：GitHub Pages 網站一律公開，這裡寫入的任何資料（持股、代號清單、帳戶名、金額）
// 都會出現在打包後的 JS。持股只能於執行期由使用者匯入 CSV，保留在本分頁記憶體。
// `npm run privacy-check` 會在 CI 擋下寫死的持股數值與代號清單。
const INITIAL_HOLDINGS: Holding[] = [];

const promptsData: PromptItem[] = [
{
id:1,cat:"個股研究",title:"單一股票完整分析",tags:["基本面","估值","風險"],
desc:"核心持股或建倉前的完整研究，強制查證與區分確認/推論。",
prompt:`你是一位重視證據與可驗證性的資深投資分析師。

請完整分析 {{market}} 標的：{{ticker}}
分析日期：{{date}}
投資週期：{{horizon}}
風險屬性：{{risk}}
持有成本：{{cost}}
持有股數：{{shares}}
其他限制：{{constraint}}

【資料規則】
1. 涉及最新股價、營收、財報、法說、政策、法人觀點時，先查最新資料。
2. 優先官方來源：交易所、公司IR、財報、法說會、主管機關公告。
3. 非官方來源僅可補充，必須標明。
4. 無法取得或無法確認的資訊標示「無法驗證」。
5. 不得捏造法人目標價、未公布EPS、未公開訂單、資金流或市場份額。
6. 明確區分【確認】【推論】【情境假設】。

【分析結構】
一、公司定位與商業模式
二、最新營運 (近3年營收獲利、近4季EPS/毛利率、近3月營收YoY/MoM)
三、財務品質 (FCF、ROE/ROIC、淨現金、應收存貨、CapEx)
四、估值 (PE/Forward PEG/PB/EV/EBITDA/歷史區間/同業)
五、催化劑 (未來3-12個月可驗證)
六、風險 (5項最重要風險+監控指標)
七、投資結論 (核心優勢3-5、核心風險3-5、最關鍵變數、失效條件、偏多/中性/偏空)
`
},
{
id:2,cat:"個股研究",title:"今日個股快篩 / 盤後更新",tags:["盤後","快速","催化"],
desc:"快速看今天這檔到底發生什麼，不做新聞堆砌。",
prompt:`請分析 {{market}} 標的 {{ticker}} 今日盤後狀況。
分析日期：{{date}}
投資週期：{{horizon}}

【要求】
1. 先查最新收盤價、漲跌幅、成交量與重要公告。
2. 找出今天真正影響股價的1–3個核心因素。
3. 分開處理：【確認】可驗證事實 / 【推論】市場解讀
4. 若找不到明確催化劑，直接寫「目前無法確認單一主因」。

【輸出】A.今日摘要 B.價格與量能 C.最新公司/產業消息 D.技術位置 E.漲跌是否有基本面支持 F.下日監控3變數 G.一句話結論
`
},
{
id:3,cat:"持股管理",title:"持股組合健檢 (含目前持股自動帶入)",tags:["權重","風險","集中度"],
desc:"檢查整體部位，自動附加目前篩選的持股表與總覽。",
prompt:`請對我的投資組合做完整健檢。

市場：{{market}}
分析日期：{{date}}
投資週期：{{horizon}}
風險屬性：{{risk}}
帳戶與持股筆數：以附加的目前持股表為準

我會提供持股表，至少包含：
代號、名稱、股數、成本、現價、市值、損益%、配置%。

【分析要求】
1. 計算每檔權重 = 市值/總市值
2. 計算前3/前5/前10大持股集中度
3. 判斷同因子曝險：AI Server/半導體CapEx/記憶體/ASIC/先進封裝/散熱/IC設計/生技/ETF
4. 找出看似分散、實際高度相關的部位
5. 區分【確認】與【推論】
6. 不替我決定買賣

特別注意：
- 以提供的表格計算筆數、前三大與集中度，不沿用舊持倉結論
- 資料為手動輸入，價格日期須另行查證；分析日期不等於行情日期
- 未提供持股時請標示資訊不足，不得自行補入部位
- 所有金額須為同一幣別；未換算不得合計跨幣別資產
- 損益僅按成本均價與現價估算，未另計交易費用、股息及已實現損益

【輸出】
- 組合總市值/總成本/總損益/損益%
- 前十大權重
- 集中度
- 因子曝險
- 同步回撤風險
- ETF是否真的分散
- 若單一因子修正10%/20%，哪些同時受影響
- 最需要監控的5個變數
`
},
{
id:4,cat:"籌碼",title:"TDCC 大戶籌碼週增減",tags:["TDCC","集保","趨勢"],
desc:"同一檔跟自己歷史比，不亂做跨股比較。",
prompt:`請分析 {{ticker}} 的 TDCC 集保戶股權分散資料。分析日期：{{date}}
我會提供至少2期資料。

【核心規則】
1. 以「同一檔自身歷史」比較為主
2. 不得直接以不同股票的100張以上比例判定好壞
3. 沒有前一期時只能說「建立基準」
4. 區分【確認】與【推論】

【輸出】A.40張以上週增減 B.100張以上週增減 C.400/1000張趨勢 D.連續2-4週趨勢 E.股價與籌碼是否同向 F.異常型態 G.結論偏多/中性/偏空與證據強度
`
},
{
id:5,cat:"交易判斷",title:"加碼 / 續抱 / 減碼判斷",tags:["部位","風控","條件"],
desc:"把基本面、估值、技術與籌碼放在同一框架。",
prompt:`請評估 {{market}} 標的 {{ticker}} 目前更接近「加碼、續抱、減碼、等待」哪一種。

分析日期：{{date}}
投資週期：{{horizon}}
風險屬性：{{risk}}
我的成本：{{cost}}
持有股數：{{shares}}
其他限制：{{constraint}}

【判斷框架】1.基本面 2.估值 3.技術 4.籌碼(可驗證) 5.催化劑 6.風險
【輸出】-【確認】目前已知 -【推論】較可能情境 -四種狀態各自成立條件 -觸發條件與失效條件 -不替我執行交易
`
},
{
id:6,cat:"事件分析",title:"財報 / 營收 / 法說事件分析",tags:["財報","法說","營收"],
desc:"適合營收公告、財報公布、法說後快速拆解。",
prompt:`請分析 {{ticker}} 最新一次財報/月營收/法說會事件。分析日期：{{date}}

【資料優先】1.公司IR/MOPS 2.法說簡報 3.主管機關 4.再補充法人
【輸出】A.事件摘要 B.營收/EPS/毛利率 vs 預期 C.guidance變化 D.市場關注點是否被解答 E.對估值影響 F.下季監控變數 G.一句話結論(優於/符合/不如預期)
`
},
{
id:7,cat:"比較",title:"同業 / 同因子比較",tags:["同業","因子","比較"],
desc:"同一因子下誰更值得持有。",
prompt:`請比較以下標的：{{ticker}} 與同業或同因子標的。分析日期：{{date}}

【要求】1.同因子定義 2.營運指標對比 3.估值對比 4.風險對比 5.誰的成長更可驗證 6.綜合排序與理由
`
},
{
id:8,cat:"晨報",title:"每日晨報 / 盤前整理",tags:["晨報","監控","清單"],
desc:"開盤前快速掃描重要資訊。",
prompt:`請幫我整理 {{date}} 盤前晨報。市場：{{market}} 關注：{{ticker}}

【輸出】1.美股/台股大盤重點 2.已提供持股的相關新聞（未提供則標示資訊不足） 3.今日重要經濟數據/法說/除息 4.最值得監控的3檔 5.風險提醒
`
},
];

function formatNumber(n:number){
  return n.toLocaleString('zh-TW');
}
function fmtMoney(n:number){
  return n.toLocaleString('zh-TW',{minimumFractionDigits:0, maximumFractionDigits:0});
}
function fmtWan(n:number){
  if(Math.abs(n)>=10000) return (n/10000).toFixed(2)+'萬';
  return fmtMoney(n);
}

export default function AppV5(){
  const [settings, setSettings] = useState<Settings>({
    market: "台股",
    ticker: "",
    horizon: "6-12個月",
    risk: "積極型 (接受20%回撤)",
    cost: "",
    shares: "",
    date: localDate(),
    constraint: "所有持股金額須使用同一幣別；行情日期請另行查證",
  });

  const [holdings, setHoldings] = useState<Holding[]>(INITIAL_HOLDINGS);
  const importInput = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<ImportedHolding[] | null>(null);
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  async function importFile(file?: File) {
    if (!file) return;
    setImportError(''); setImportRows(null); setImportBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('檔案請小於 5 MB。');
      setImportRows(parseHoldingsCsv(decodeCsv(await file.arrayBuffer()), accountFilter === '全部' ? DEFAULT_ACCOUNT : accountFilter));
    } catch (error) { setImportError(error instanceof Error ? error.message : '無法讀取 CSV。'); }
    finally { setImportBusy(false); }
  }

  function applyImport(replace: boolean) {
    if (!importRows) return;
    const added = importRows.map(h => ({ ...h, id: crypto.randomUUID() }));
    setHoldings(previous => replace ? added : [...previous, ...added]);
    setAccountFilter('全部'); setTab('portfolio'); setImportRows(null);
    showToast(`已匯入 ${added.length} 筆持股`);
  }
  const [activeCat, setActiveCat] = useState("全部");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"dashboard"|"portfolio"|"prompts">("dashboard");
  const [accountFilter, setAccountFilter] = useState<string>("全部");

  // Robust copy system
  const [toast, setToast] = useState("");
  const [copyModal, setCopyModal] = useState({open:false, text:'', label:''});
  const toastTimer = useRef<number | null>(null);
  const modalTextareaRef = useRef<HTMLTextAreaElement>(null);

  const showToast = useCallback((msg:string)=>{
    setToast(msg);
    if(toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(()=>setToast(''), 2200) as unknown as number;
  },[]);

  const robustCopy = useCallback(async (text:string, label?:string)=>{
    const cleanLabel = label || '內容';
    // Attempt 1: clipboard API
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        showToast(cleanLabel + ' 已複製 ✓');
        return;
      }
    } catch(e) {}
    // Attempt 2: execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly','');
      ta.style.position='fixed';
      ta.style.left='-9999px';
      ta.style.top='0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, 999999);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        showToast(cleanLabel + ' 已複製 ✓');
        return;
      }
    } catch(e) {}
    // Attempt 3 - Modal fallback
    setCopyModal({open:true, text, label:cleanLabel});
  },[showToast]);

  // Modal autofocus effect
  useEffect(()=>{
    if(copyModal.open){
      setTimeout(()=>{
        if(modalTextareaRef.current){
          modalTextareaRef.current.focus();
          modalTextareaRef.current.select();
        }
      }, 80);
    }
  },[copyModal.open]);

  // Computed holdings
  const computed = useMemo(()=>{
    const filtered = holdings.filter(h => accountFilter==="全部" || h.account===accountFilter);
    const rows = filtered.map(h=>{
      const costTotal = h.shares * h.costAvg;
      const asset = h.shares * h.price;
      const pl = (h.price - h.costAvg) * h.shares;
      const plPct = h.costAvg ? ((h.price - h.costAvg)/h.costAvg*100) : 0;
      return {...h, costTotal, asset, pl, plPct};
    });
    const totalCost = rows.reduce((s,r)=>s+r.costTotal,0);
    const totalAsset = rows.reduce((s,r)=>s+r.asset,0);
    const totalPL = rows.reduce((s,r)=>s+r.pl,0);
    const totalPLPct = totalCost ? totalPL/totalCost*100 : 0;
    const withWeight = rows.map(r=>({...r, weight: totalAsset? r.asset/totalAsset*100 :0}))
      .sort((a,b)=>b.asset-a.asset);
    return {rows:withWeight, totalCost, totalAsset, totalPL, totalPLPct};
  },[holdings, accountFilter]);

  const top8 = useMemo(()=> computed.rows.slice(0,8), [computed.rows]);

  // Factor exposure simple
  const factorGroups = useMemo(()=>{
    const map: Record<string, number> = Object.create(null);
    computed.rows.forEach(r=>{
      // 不內建任何個股對照表；因子來自 CSV「因子」欄或持股表手動輸入。
      const f = r.factor.trim() || defaultFactor(r.code);
      map[f]=(map[f]||0)+r.asset;
    });
    return Object.entries(map).map(([label, asset])=>({label, asset, pct: computed.totalAsset? asset/computed.totalAsset*100:0})).sort((a,b)=>b.asset-a.asset);
  },[computed]);

  function fillTemplate(tmpl:string){
    return fillPrompt(tmpl, settings);
  }

  function buildHoldingsTableText(rows: typeof computed.rows){
    const header = `代號\t名稱\t股數\t成本均價\t現價\t成本總額\t市值\t損益\t損益%\t權重%\t帳戶\t因子`;
    const lines = rows.map(r=>{
      return `${r.code}\t${r.name}\t${r.shares}\t${r.costAvg}\t${r.price}\t${fmtMoney(r.costTotal)}\t${fmtMoney(r.asset)}\t${fmtMoney(r.pl)}\t${r.plPct.toFixed(2)}%\t${r.weight.toFixed(2)}%\t${r.account}\t${r.factor}`;
    });
    const summary = `\n總計\t${rows.length}筆\t\t\t\t${fmtMoney(computed.totalCost)}\t${fmtMoney(computed.totalAsset)}\t${fmtMoney(computed.totalPL)}\t${computed.totalPLPct.toFixed(2)}%\t${computed.totalAsset ? 100 : 0}%\t${accountFilter}\t`;
    return [header, ...lines, summary].join("\n");
  }

  function buildHoldingsTextForPrompt(isMarkdown=false){
    const rows = computed.rows;
    if(!isMarkdown){
      return buildHoldingsTableText(rows);
    }
    // markdown style
    let md = `| 代號 | 名稱 | 股數 | 成本 | 現價 | 市值 | 損益 | 損益% | 權重 | 帳戶 | 因子 |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
    rows.forEach(r=>{
      md+=`| ${r.code} | ${r.name} | ${r.shares} | ${r.costAvg} | ${r.price} | ${fmtMoney(r.asset)} | ${fmtMoney(r.pl)} | ${r.plPct.toFixed(2)}% | ${r.weight.toFixed(2)}% | ${r.account} | ${r.factor} |\n`;
    });
    md+=`\n**總成本 ${fmtMoney(computed.totalCost)} / 總市值 ${fmtMoney(computed.totalAsset)} / 總損益 ${fmtMoney(computed.totalPL)} (${computed.totalPLPct.toFixed(2)}%)**\n`;
    return md;
  }

  const filteredPrompts = useMemo(()=>{
    return promptsData.filter(p=>{
      const catOk = activeCat==="全部" || p.cat===activeCat;
      const q = search.trim().toLowerCase();
      const searchOk = !q || p.title.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q) || p.tags.some(t=>t.toLowerCase().includes(q));
      return catOk && searchOk;
    });
  },[activeCat, search]);

  const updateHolding = (id:string, field: 'shares'|'costAvg'|'price', value:number)=>{
    if (!Number.isFinite(value) || value < 0) return;
    setHoldings(prev=>prev.map(h=> h.id===id ? {...h, [field]: value} : h));
  };
  const updateFactor = (id:string, factor:string)=>{
    setHoldings(prev=>prev.map(h=> h.id===id ? {...h, factor} : h));
  };

  const handleExportCSV = useCallback(()=>{
    const rows = computed.rows;
    const csvHeader = ['code','name','shares','costAvg','price','costTotal','asset','pl','plPct','weight','account','factor'];
    const csvRows = rows.map(r=> [r.code,r.name,r.shares,r.costAvg,r.price,r.costTotal,r.asset,r.pl,r.plPct.toFixed(2),r.weight.toFixed(2),r.account,r.factor]);
    const summary = ['', '', '', '', '', computed.totalCost, computed.totalAsset, computed.totalPL, computed.totalPLPct.toFixed(2), computed.totalAsset ? 100 : 0, accountFilter, ''];
    const csv = encodeCsv([csvHeader, ...csvRows, summary]);
    // try download
    try{
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href=url;
      a.download=`holdings_${accountFilter}_${settings.date}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(()=>URL.revokeObjectURL(url), 1000);
      showToast("CSV 已下載 ✓");
    }catch{
      robustCopy(csv, "CSV 持股表");
    }
  },[computed, accountFilter, settings.date, robustCopy, showToast]);

  const copyPrompt = useCallback(async (id:number, forceWithHoldings=false)=>{
    const item = promptsData.find(p=>p.id===id);
    if(!item) return;
    let filled = fillTemplate(item.prompt);
    const isPortfolio = item.id===3;
    if(isPortfolio || forceWithHoldings){
      if (!computed.rows.length) { showToast("請先匯入持股 CSV，再複製含持股的 Prompt。"); return; }
      const table = buildHoldingsTextForPrompt(false);
      filled = filled + "\n\n【目前持股表 - "+computed.rows.length+"筆 - 分析日期 "+settings.date+"】\n帳戶篩選: "+accountFilter+"\n"+table+"\n\n總成本 "+fmtMoney(computed.totalCost)+" / 總市值 "+fmtMoney(computed.totalAsset)+" / 總損益 "+fmtMoney(computed.totalPL)+" ("+computed.totalPLPct.toFixed(2)+"%)\n";
    }
    await robustCopy(filled, item.title);
  },[settings, computed, accountFilter, robustCopy]);

  return (
    <div className="min-h-screen bg-[#0e1218] text-[#e6e9ef] font-[system-ui,-apple-system,'Noto Sans TC','PingFang TC',sans-serif]">
      <style>{`
        .mono{font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
        *{scrollbar-width:thin; scrollbar-color:#27303d transparent}
        ::-webkit-scrollbar{width:8px;height:8px}
        ::-webkit-scrollbar-thumb{background:#27303d;border-radius:10px}
        input[type=number]::-webkit-inner-spin-button{opacity:0.6}
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-[#0e1218]/90 border-b border-[#1e2632]">
        <div className="max-w-[1360px] mx-auto px-[24px] max-[560px]:px-[16px] py-[14px] flex flex-wrap gap-[12px] items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 max-[560px]:flex-wrap">
            <div className="w-[36px] h-[36px] rounded-[11px] bg-[#f7b731] grid place-items-center text-[#111] font-black text-[16px] shrink-0">5.3</div>
            <div className="min-w-0">
              <h1 className="m-0 text-[24px] font-black leading-tight tracking-tight">股市 Prompt 工作台 V5.3.1 - 本機持股匯入</h1>
              <div className="text-[16px] text-[#8fa0b7] leading-[1.4] mt-[2px]">{accountFilter}帳戶 {computed.rows.length}檔 • 總市值 {fmtWan(computed.totalAsset)} • {settings.date} • 非即時行情</div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {[
              {k:"dashboard",label:"總覽"},
              {k:"portfolio",label:"持股表"},
              {k:"prompts",label:"Prompt庫"},
            ].map(t=>(
              <button key={t.k} onClick={()=>{ setTab(t.k as any); showToast(`${t.label} 已切換 ✓`); }} className={`min-h-[40px] px-4 rounded-[12px] text-[18px] font-bold border transition ${tab===t.k ? "bg-[#f7b731] border-[#f7b731] text-[#111]" : "bg-[#171c24] border-[#27303d] text-[#8fa0b7] hover:text-[#e6e9ef]"}`}>{t.label}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-[1360px] mx-auto px-[24px] max-[560px]:px-[16px] py-[20px] flex flex-col gap-[20px]">
        <input ref={importInput} type="file" accept=".csv,text/csv" aria-label="選擇持股 CSV" className="hidden" onChange={e=>{ void importFile(e.target.files?.[0]); e.target.value = ''; }} />
        {importError && <div role="alert" className="rounded-[12px] border border-red-400 p-4 text-red-300">匯入失敗：{importError} 原持股未變更。</div>}
        {importRows && <section aria-label="持股匯入預覽" className="rounded-[18px] border border-[#f7b731] bg-[#131a23] p-6 space-y-3">
          <h2 className="text-xl font-bold">匯入預覽：{importRows.length} 筆持股</h2>
          <p>加入會保留原持股（重複項目也會加入）；取代會替換所有帳戶的持股。</p>
          <div className="max-h-60 overflow-auto"><table className="w-full text-left"><thead><tr>{['代號','名稱','股數','成本均價','現價','帳戶','因子'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{importRows.map((r,i)=><tr key={i}>{[r.code,r.name,r.shares,r.costAvg,r.price,r.account,r.factor].map((v,j)=><td key={j} className="p-2">{v}</td>)}</tr>)}</tbody></table></div>
          <div className="flex flex-wrap gap-3">
            <button onClick={()=>applyImport(false)} className="min-h-[40px] px-4 rounded-xl bg-[#f7b731] text-black font-bold">加入現有持股</button>
            <button onClick={()=>applyImport(true)} className="min-h-[40px] px-4 rounded-xl border border-[#f7b731]">取代全部持股</button>
            <button onClick={()=>setImportRows(null)} className="min-h-[40px] px-4 rounded-xl border border-[#27303d]">取消</button>
          </div>
        </section>}
        {/* Global settings */}
        <section className="rounded-[18px] border border-[#1e2632] bg-[#131a23] p-[24px] flex flex-col gap-[16px]">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <h2 className="text-[18px] font-black tracking-wide">全域變數 • 用於填充 {"{{ticker}}"} 等占位符</h2>
            <div className="flex gap-2 flex-wrap">
              <button onClick={()=>robustCopy(buildHoldingsTextForPrompt(false), '持股表')} className="min-h-[40px] px-4 rounded-[12px] bg-[#1a2330] border border-[#27303d] text-[16px] font-bold text-[#d0d8e3] hover:border-[#3d4a5a]">複製持股表給 Prompt #3</button>
              <button onClick={()=>robustCopy(computed.rows.map(r=>`${r.code} ${r.name}`).join(", "), '目前持股代號')} className="min-h-[40px] px-4 rounded-[12px] bg-[#211d09] border border-[#f7b731]/30 text-[16px] font-bold text-[#f7b731]">複製目前持股代號</button>
              <button disabled={importBusy} onClick={()=>importInput.current?.click()} className="min-h-[40px] px-4 rounded-[12px] bg-[#1a2330] border border-[#27303d] text-[16px] font-bold disabled:opacity-50">{importBusy ? "讀取中…" : "匯入持股 CSV"}</button>
              <button onClick={handleExportCSV} className="min-h-[40px] px-4 rounded-[12px] bg-[#171c24] border border-[#27303d] text-[16px] font-bold text-[#8fa0b7]">CSV 下載 / 複製</button>
            </div>
          </div>
          <div className="grid grid-cols-4 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1 gap-[12px]">
            {[
              {k:"market",label:"市場 market"},
              {k:"ticker",label:"關注標的 ticker", placeholder:"例：代號 名稱"},
              {k:"horizon",label:"投資週期 horizon"},
              {k:"risk",label:"風險屬性 risk"},
              {k:"cost",label:"持有成本 cost", placeholder:"未提供"},
              {k:"shares",label:"持有股數 shares", placeholder:"未提供"},
              {k:"date",label:"分析日期 date"},
              {k:"constraint",label:"其他限制 constraint"},
            ].map(f=>(
              <label key={f.k} className="flex flex-col gap-[6px] min-w-0">
                <span className="text-[16px] font-bold text-[#8fa0b7] tracking-wide">{f.label}</span>
                <input value={(settings as any)[f.k]} placeholder={"placeholder" in f ? f.placeholder : undefined} onChange={e=>setSettings(s=>({...s, [f.k]: e.target.value}))} className="min-h-[40px] placeholder:text-[#4b5767] rounded-[11px] bg-[#0b0f15] border border-[#27303d] px-3 text-[18px] text-[#e6e9ef] outline-none focus:border-[#f7b731]/60 w-full" />
              </label>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-[16px] text-[#6e7b8d]">帳戶篩選:</span>
            {Array.from(new Set(['全部', ...holdings.map(h=>h.account)])).map(acc=>(
              <button key={acc} onClick={()=>setAccountFilter(acc)} className={`min-h-[36px] px-3 rounded-full text-[16px] font-bold border ${accountFilter===acc ? "bg-[#f7b731] border-[#f7b731] text-[#111]" : "bg-[#0b0f15] border-[#27303d] text-[#8fa0b7]"}`}>{acc}</button>
            ))}
            <span className="text-[16px] text-[#6e7b8d] ml-2">共 {computed.rows.length} 檔 • 依帳戶篩選持股</span>
          </div>
        </section>

        {tab==="dashboard" && (
          <>
            {/* Summary cards */}
            <section className="grid grid-cols-4 max-[1000px]:grid-cols-2 max-[560px]:grid-cols-1 gap-[20px]">
              {[
                {label:"總成本", value: fmtMoney(computed.totalCost), sub: `${computed.rows.length}檔 • ${accountFilter}`},
                {label:"總市值", value: fmtMoney(computed.totalAsset), sub: `${fmtWan(computed.totalAsset)} • 現價計算`},
                {label:"總損益", value: (computed.totalPL>=0?"+":"")+fmtMoney(computed.totalPL), sub: `${computed.totalPLPct.toFixed(2)}%`, accent: computed.totalPL>=0},
                {label:"集中度 Top3", value: `${computed.rows.slice(0,3).reduce((s,r)=>s+r.weight,0).toFixed(1)}%`, sub: computed.rows.slice(0,3).map(r=>r.code).join(" / ")},
              ].map(card=>(
                <div key={card.label} className="rounded-[18px] border border-[#1e2632] bg-[#131a23] p-[24px] flex flex-col gap-[8px] min-w-0">
                  <div className="text-[16px] font-black tracking-widest text-[#8fa0b7]">{card.label}</div>
                  <div className={`text-[30px] font-black leading-tight truncate ${card.label==="總損益" ? (card.accent ? "text-[#4ade80]" : "text-[#fb7185]") : "text-[#f4f7fb]"}`}>{card.value}</div>
                  <div className="text-[16px] text-[#6e7b8d] leading-[1.4]">{card.sub}</div>
                </div>
              ))}
            </section>

            {/* Top holdings bar */}
            <section className="rounded-[18px] border border-[#1e2632] bg-[#131a23] p-[24px]">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-[16px]">
                <h3 className="text-[18px] font-black">Top 8 持股權重 • 按市值排序</h3>
                <button onClick={()=>robustCopy(buildHoldingsTableText(computed.rows), 'Top8 持股')} className="min-h-[36px] px-3 rounded-[11px] bg-[#171c24] border border-[#27303d] text-[16px] font-bold text-[#8fa0b7]">複製持</button>
              </div>
              <div className="flex flex-col gap-[10px]">
                {top8.map(r=>{
                  const isPos = r.pl>=0;
                  return (
                    <div key={r.id} className="flex items-center gap-3 min-w-0 max-[560px]:flex-wrap">
                      <div className="w-[104px] shrink-0 text-[16px] font-bold text-[#d0d8e3] truncate">{r.code} {r.name.slice(0,4)}</div>
                      <div className="flex-1 max-[560px]:basis-[calc(100%-120px)] h-[10px] rounded-full bg-[#0b0f15] border border-[#1e2632] overflow-hidden min-w-0">
                        <div className="h-full bg-[#f7b731] rounded-full transition-all" style={{width: `${r.weight}%`}} />
                      </div>
                      <div className="w-[54px] text-right text-[16px] font-bold text-[#8fa0b7] shrink-0">{r.weight.toFixed(1)}%</div>
                      <div className="w-[88px] text-right text-[16px] font-bold mono shrink-0">{fmtMoney(r.asset)}</div>
                      <div className={`w-[72px] text-right text-[16px] font-bold mono shrink-0 ${isPos ? "text-[#4ade80]" : "text-[#fb7185]"}`}>{isPos?"+":""}{r.plPct.toFixed(2)}%</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-[16px] grid grid-cols-3 max-[560px]:grid-cols-1 gap-[12px]">
                {factorGroups.map(f=>(
                  <div key={f.label} className="rounded-[12px] bg-[#0b0f15] border border-[#1e2632] p-[14px] flex justify-between items-center">
                    <span className="text-[16px] font-bold text-[#8fa0b7]">{f.label}</span>
                    <span className="text-[16px] font-black">{f.pct.toFixed(1)}% • {fmtWan(f.asset)}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {!holdings.length && <p className="p-4 rounded-xl bg-[#131a23] text-[#8fa0b7]">尚未匯入持股。請到「持股表」選擇「匯入持股 CSV」；本站不內建個人部位。</p>}

        {tab==="portfolio" && (
          <section className="rounded-[18px] border border-[#1e2632] bg-[#131a23] p-[24px] flex flex-col gap-[16px]">
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <h3 className="text-[22px] font-black">{accountFilter}持股表 • 可編輯 (即時重算市值/損益/權重)</h3>
              <div className="flex gap-2 flex-wrap">
                <button onClick={()=>robustCopy(buildHoldingsTableText(computed.rows), '持股表')} className="min-h-[40px] px-4 rounded-[12px] bg-[#f7b731] text-[#111] text-[18px] font-black">複製持股表給 Prompt #3</button>
                <button onClick={()=>robustCopy(buildHoldingsTextForPrompt(true), 'Markdown持股表')} className="min-h-[40px] px-4 rounded-[12px] bg-[#1a2330] border border-[#27303d] text-[16px] font-bold">複製 Markdown 表</button>
                <button disabled={importBusy} onClick={()=>importInput.current?.click()} className="min-h-[40px] px-4 rounded-[12px] bg-[#1a2330] border border-[#27303d] text-[16px] font-bold disabled:opacity-50">{importBusy ? "讀取中…" : "匯入持股 CSV"}</button>
              <button onClick={handleExportCSV} className="min-h-[40px] px-4 rounded-[12px] bg-[#171c24] border border-[#27303d] text-[16px] font-bold text-[#8fa0b7]">CSV 下載</button>
                <button onClick={()=>{if (!window.confirm("清空所有帳戶持股？請先下載 CSV 備份。")) return; setHoldings([]); setAccountFilter("全部"); showToast("已清空持股");}} className="min-h-[40px] px-4 rounded-[12px] bg-[#0b0f15] border border-[#27303d] text-[16px] font-bold text-[#8fa0b7]">清空持股</button>
              </div>
            </div>

            <p className="text-[16px] text-[#8fa0b7]">匯入 CSV 必填：代號、名稱、股數、成本均價、現價；帳戶、因子可省略（因子未填時 00 開頭視為 ETF，其餘未分類，可在表格內直接修改）。支援本站下載的英文欄名、UTF-8 與 Big5。股數以股為單位。持股僅保留於本次開啟，重新整理或關閉即清除，請下載備份。匯入資料不會由本站自動上傳；複製後貼至其他服務會交由該服務處理。Excel 可能移除代號前導 0，請以文字欄位匯入。</p>
            <div className="rounded-[14px] border border-[#1e2632] bg-[#0b0f15] overflow-x-auto">
              <div className="min-w-[1392px]">
                <div className="grid grid-cols-[90px_130px_110px_130px_130px_120px_120px_100px_90px_110px_130px] gap-0 text-[16px] font-black tracking-wide text-[#8fa0b7] px-[16px] py-[12px] border-b border-[#1e2632] bg-[#10161f]">
                  <div>代號</div><div>名稱</div><div>股數</div><div>成本均價</div><div>現價</div><div>市值</div><div>損益</div><div>損益%</div><div>權重</div><div>帳戶</div><div>因子</div>
                </div>
                {computed.rows.map(r=>{
                  const isPos = r.pl>=0;
                  return (
                    <div key={r.id} className="grid grid-cols-[90px_130px_110px_130px_130px_120px_120px_100px_90px_110px_130px] gap-0 items-center px-[16px] py-[10px] border-b border-[#141c27] hover:bg-[#131a23] text-[16px]">
                      <div className="font-bold text-[#e6e9ef]">{r.code}</div>
                      <div className="truncate pr-2 text-[#d0d8e3]">{r.name}</div>
                      <div><input type="number" value={r.shares} onChange={e=>updateHolding(r.id,'shares', Number(e.target.value)||0)} className="w-[96px] min-h-[40px] rounded-[8px] bg-[#0e1218] border border-[#27303d] px-2 text-[16px] mono outline-none focus:border-[#f7b731]/50" /></div>
                      <div><input type="number" step="0.01" value={r.costAvg} onChange={e=>updateHolding(r.id,'costAvg', Number(e.target.value)||0)} className="w-[116px] min-h-[40px] rounded-[8px] bg-[#0e1218] border border-[#27303d] px-2 text-[16px] mono outline-none focus:border-[#f7b731]/50" /></div>
                      <div><input type="number" step="0.01" value={r.price} onChange={e=>updateHolding(r.id,'price', Number(e.target.value)||0)} className="w-[116px] min-h-[40px] rounded-[8px] bg-[#0e1218] border border-[#27303d] px-2 text-[16px] mono outline-none focus:border-[#f7b731]/50" /></div>
                      <div className="mono font-bold">{fmtMoney(r.asset)}</div>
                      <div className={`mono font-bold ${isPos ? "text-[#4ade80]" : "text-[#fb7185]"}`}>{isPos?"+":""}{fmtMoney(r.pl)}</div>
                      <div className={`mono font-bold ${isPos ? "text-[#4ade80]" : "text-[#fb7185]"}`}>{r.plPct.toFixed(2)}%</div>
                      <div className="mono text-[#8fa0b7]">{r.weight.toFixed(2)}%</div>
                      <div className="text-[16px] text-[#6e7b8d] truncate pr-2">{r.account}</div>
                      <div><input value={r.factor} aria-label={`${r.code} 因子`} placeholder="未分類" onChange={e=>updateFactor(r.id, e.target.value)} className="w-[116px] min-h-[40px] rounded-[8px] bg-[#0e1218] border border-[#27303d] px-2 text-[16px] outline-none focus:border-[#f7b731]/50 placeholder:text-[#4b5767]" /></div>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[90px_130px_110px_130px_130px_120px_120px_100px_90px_110px_130px] gap-0 px-[16px] py-[14px] bg-[#111722] text-[16px] font-black">
                  <div>總計</div><div>{computed.rows.length}檔</div><div>-</div><div>-</div><div>-</div><div className="mono">{fmtMoney(computed.totalAsset)}</div><div className={`mono ${computed.totalPL>=0 ? "text-[#4ade80]" : "text-[#fb7185]"}`}>{fmtMoney(computed.totalPL)}</div><div className={`mono ${computed.totalPLPct>=0 ? "text-[#4ade80]" : "text-[#fb7185]"}`}>{computed.totalPLPct.toFixed(2)}%</div><div>{computed.totalAsset ? 100 : 0}%</div><div>{accountFilter}</div><div>-</div>
                </div>
              </div>
            </div>
            <div className="text-[16px] text-[#6e7b8d] leading-[1.6]">可直接編輯 股數 / 成本均價 / 現價，資產 = 股數×現價，損益 = (現價-成本均價)×股數，損益% = (現價-成本均價)/成本均價，權重 = 市值/總市值。預設不含持股。所有金額須使用同一幣別；損益未另計手續費、稅、股息與已實現損益。</div>
          </section>
        )}

        {(tab==="dashboard" || tab==="prompts") && (
          <section className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <h2 className="text-[24px] font-black">Prompt Library • V5.3.1</h2>
              <div className="flex gap-2 flex-wrap items-center">
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋標題/標籤/描述..." className="min-h-[40px] w-[220px] max-[560px]:w-full rounded-[12px] bg-[#131a23] border border-[#27303d] px-3 text-[18px] outline-none focus:border-[#f7b731]/50" />
                <span className="text-[16px] text-[#6e7b8d]">顯示 {filteredPrompts.length}/{promptsData.length}</span>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {categories.map(c=>(
                <button key={c} onClick={()=>{ setActiveCat(c); showToast(`分類：${c}`); }} className={`min-h-[40px] px-4 rounded-full text-[16px] font-bold border transition ${activeCat===c ? "bg-[#f7b731] border-[#f7b731] text-[#111]" : "bg-[#131a23] border-[#27303d] text-[#8fa0b7] hover:text-[#e6e9ef]"}`}>{c}</button>
              ))}
            </div>

            <div className="grid grid-cols-2 max-[900px]:grid-cols-1 gap-[20px]">
              {filteredPrompts.map(p=>{
                const filled = fillTemplate(p.prompt);
                const isPortfolioCard = p.id===3;
                return (
                  <article key={p.id} className={`rounded-[18px] border bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] flex flex-col overflow-hidden group p-[24px] gap-[12px] ${isPortfolioCard ? "border-[#f7b731]/40" : "border-[#1e2632]"}`}>
                    <div className="flex justify-between gap-3 items-start max-[560px]:flex-col">
                      <div className="flex gap-3 items-start min-w-0">
                        <div className={`w-[36px] h-[36px] rounded-[11px] grid place-items-center text-[16px] font-black shrink-0 ${isPortfolioCard ? "bg-[#f7b731] text-[#111]" : "bg-white text-[#111]"}`}>{String(p.id).padStart(2,"0")}</div>
                        <div className="min-w-0">
                          <h3 className="m-0 text-[22px] font-bold leading-tight flex flex-wrap gap-2 items-center">{p.title} {isPortfolioCard && <span className="text-[14px] bg-[#f7b731]/20 border border-[#f7b731]/40 text-[#f7b731] px-2 py-0.5 rounded-full">已含 {computed.rows.length} 檔 • {fmtWan(computed.totalAsset)} • {accountFilter}</span>}</h3>
                          <div className="flex gap-1.5 flex-wrap mt-[8px]">
                            {p.tags.map(t=> <span key={t} className="border border-[#27303d] bg-[#171c24] text-[#8fa0b7] px-[8px] py-[3px] rounded-full text-[14px] font-bold">{t}</span>)}
                            <span className="border border-[#27303d] bg-[#11151c] text-[#5b697b] px-[8px] py-[3px] rounded-full text-[14px]">{p.cat}</span>
                          </div>
                        </div>
                      </div>
                      <button onClick={()=>copyPrompt(p.id)} className="shrink-0 min-h-[40px] bg-[#f7b731] border border-[#f7b731] text-[#111] rounded-[12px] px-4 font-black text-[18px] hover:brightness-110 active:scale-[0.98]">{isPortfolioCard ? "複製 Prompt" : "複製 Prompt"}</button>
                    </div>
                    <div className="text-[#9da9b9] text-[16px] leading-[1.6]">{p.desc}</div>
                    {isPortfolioCard && (
                      <div className="rounded-[12px] bg-[#1a1f0a] border border-[#f7b731]/20 p-[14px] text-[16px] leading-[1.6] text-[#d8c9a0] mono whitespace-pre-wrap break-words max-h-[160px] overflow-auto">
                        <div className="font-black text-[#f7b731] mb-1 text-[16px]">將自動附加 ({accountFilter} • {settings.date})：</div>
                        {buildHoldingsTextForPrompt(false).slice(0,900)}{buildHoldingsTextForPrompt(false).length>900 ? "\n... (完整複製後可見)" : ""}
                      </div>
                    )}
                    <pre className="bg-[#080b10] border border-[#1e2632] rounded-[14px] p-[14px] whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-[1.65] font-mono text-[20px] text-[#d7dfeb] max-h-[320px] overflow-auto">{filled}</pre>
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={()=>copyPrompt(p.id)} className="min-h-[40px] border border-[#27303d] bg-[#171c24] rounded-[12px] px-4 font-bold text-[16px] text-[#d0d8e3] hover:border-[#3d4a5a]">複製 Prompt</button>
                      {isPortfolioCard && <button onClick={()=>copyPrompt(p.id,true)} className="min-h-[40px] border border-[#f7b731]/30 bg-[#211d09] rounded-[12px] px-4 font-bold text-[16px] text-[#f7b731]">強制附加持股表</button>}
                      <button onClick={()=>robustCopy(buildHoldingsTableText(computed.rows), '持股表')} className="min-h-[40px] border border-[#27303d] bg-[#11151c] rounded-[12px] px-4 font-bold text-[16px] text-[#93a0b2]">複製持股表給 Prompt #3</button>
                      <button onClick={()=>robustCopy(computed.rows.map(r=>r.code).join(", "), '目前持股代號')} className="min-h-[40px] border border-[#27303d] bg-[#11151c] rounded-[12px] px-4 font-bold text-[16px] text-[#93a0b2]">複製目前持股</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-[#1e2632] text-[#6f7c90] text-[16px] py-[20px] mt-[24px]">
        <div className="max-w-[1360px] mx-auto px-[24px] leading-[1.7]">
          <div>現價為使用者輸入，非即時，總市值 {fmtMoney(computed.totalAsset)} ({fmtWan(computed.totalAsset)}) 僅供組合健檢參考 • 本工具只負責建立分析指令，不自行取得市場資料；實際分析仍應核對資料日期與來源。本內容不構成投資建議。</div>
          <div className="mt-1 mono text-[#3a475a]">V5.3.1 • {accountFilter} {computed.rows.length}筆 • 總成本 {fmtMoney(computed.totalCost)} • 總市值 {fmtMoney(computed.totalAsset)} • 損益 {fmtMoney(computed.totalPL)} ({computed.totalPLPct.toFixed(2)}%) • 價格由使用者輸入，非即時行情</div>
        </div>
      </footer>

      {/* Toast */}
      <div className={`fixed left-1/2 bottom-[28px] -translate-x-1/2 max-w-[90vw] text-center bg-white text-[#111] rounded-full px-[20px] py-[12px] text-[18px] font-black shadow-[0_18px_50px_rgba(0,0,0,0.5)] transition-all duration-200 z-[99] ${toast ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-4 pointer-events-none"}`} role="status" aria-live="polite">
        {toast || "ready"}
      </div>

      {/* Robust Copy Modal - V5 fix */}
      {copyModal.open && (
        <div className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm grid place-items-center p-4">
          <div className="w-full max-w-[680px] rounded-[18px] border border-[#27303d] bg-[#131a23] p-[24px] shadow-[0_24px_80px_rgba(0,0,0,0.7)] flex flex-col gap-[14px]">
            <div className="flex items-center justify-between">
              <h3 className="text-[22px] font-black">手動複製 • {copyModal.label} • V5.3.1</h3>
              <button onClick={()=>setCopyModal({open:false,text:'',label:''})} className="w-[36px] h-[36px] rounded-full bg-[#1e2632] border border-[#27303d] grid place-items-center text-[#8fa0b7]">✕</button>
            </div>
            <div className="text-[16px] text-[#8fa0b7] leading-[1.6]">
              瀏覽器在 iframe / 非安全環境下阻擋了自動複製，已改為手動模式。下方文字已自動全選，按 <b className="text-[#e6e9ef]">Ctrl+C / ⌘+C</b> 複製即可。此視窗已解決先前「複製失敗無回饋」問題，所有按鈕都會顯示 Toast 或此視窗，不會靜默失敗。
            </div>
            <textarea
              ref={modalTextareaRef}
              readOnly
              value={copyModal.text}
              onFocus={e=>e.currentTarget.select()}
              className="w-full h-[360px] rounded-[12px] border border-[#27303d] bg-[#080b10] p-[14px] mono text-[16px] leading-[1.6] text-[#d7dfeb] outline-none focus:border-[#f7b731]/50 resize-none"
            />
            <div className="flex gap-2 justify-end flex-wrap">
              <button onClick={()=>setCopyModal({open:false,text:'',label:''})} className="min-h-[40px] px-5 rounded-[12px] border border-[#27303d] bg-[#171c24] text-[18px] font-bold text-[#8fa0b7]">關閉</button>
              <button onClick={()=>{
                try{
                  if(modalTextareaRef.current){
                    modalTextareaRef.current.select();
                    modalTextareaRef.current.setSelectionRange(0, 999999);
                    const ok = document.execCommand('copy');
                    if(ok){
                      showToast(copyModal.label + ' 已複製 ✓');
                      setCopyModal({open:false,text:'',label:''});
                    } else {
                      showToast('請用 Ctrl+C 手動複製');
                    }
                  }
                }catch{
                  showToast('請用 Ctrl+C 手動複製');
                }
              }} className="min-h-[40px] px-6 rounded-[12px] bg-[#f7b731] text-[#111] text-[18px] font-black">全選複製</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
