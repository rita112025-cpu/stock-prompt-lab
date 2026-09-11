export type ImportedHolding = { code: string; name: string; shares: number; costAvg: number; price: number; account: string; factor: string };

// 隱私：這個檔案與 App.tsx 都會打包進公開網站，不得寫入任何真實帳戶名稱或個股代號清單。
export const DEFAULT_ACCOUNT = '未分類';
export const UNCLASSIFIED_FACTOR = '未分類';

/** CSV 沒有「因子」欄時的中性預設：台股 00 開頭代號多為 ETF，其餘一律未分類。 */
export function defaultFactor(code: string): string {
  return /^00\d/.test(code) ? 'ETF' : UNCLASSIFIED_FACTOR;
}

export function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function encodeCsv(rows: (string | number)[][]): string {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function parseHoldingsCsv(text: string, defaultAccount = DEFAULT_ACCOUNT): ImportedHolding[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (c !== ',') {
        rows.push(row); row = [];
        if (c === '\r' && source[i + 1] === '\n') i++;
      }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error('CSV 引號格式不正確。');
      cell += c;
    }
  }
  if (quoted) throw new Error('CSV 引號未結束。');
  row.push(cell); rows.push(row);
  const headerIndex = rows.findIndex(r => r.some(v => v.trim()));
  if (headerIndex < 0) throw new Error('CSV 沒有資料。');
  const aliases: Record<string, string[]> = {
    code: ['code', '代號', '股票代號'], name: ['name', '名稱', '股票名稱'],
    shares: ['shares', '股數', '持有股數'], costAvg: ['costavg', '成本均價', '平均成本', '成本'],
    price: ['price', '現價', '股價'], account: ['account', '帳戶'], factor: ['factor', '因子', '產業', '類別'],
  };
  const headers = rows[headerIndex].map(v => v.trim().toLowerCase());
  const index = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, headers.findIndex(h => names.includes(h))]));
  for (const key of ['code', 'name', 'shares', 'costAvg', 'price']) {
    if (index[key] < 0) throw new Error(`缺少必要欄位：${aliases[key][1]}（${key}）。`);
  }
  const result: ImportedHolding[] = [];
  rows.slice(headerIndex + 1).forEach((r, offset) => {
    if (r.every(v => !v.trim())) return;
    const get = (key: string) => (r[index[key]] ?? '').trim();
    // Downloads from earlier versions end in a totals row with empty identity fields.
    if ((!get('code') && !get('name') && !get('shares')) || ['總計', '合計'].includes(get('code'))) return;
    const line = headerIndex + offset + 2;
    if (r.length !== headers.length) throw new Error(`第 ${line} 列欄位數不符。`);
    if (!get('code') || !get('name')) throw new Error(`第 ${line} 列缺少代號或名稱。`);
    const number = (key: string) => {
      const raw = get(key);
      const value = raw.replace(/,/g, '');
      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(value))) throw new Error(`第 ${line} 列的${aliases[key][1]}必須是非負數字，千分位須每三位一組。`);
      return Number(value);
    };
    result.push({ code: get('code'), name: get('name'), shares: number('shares'), costAvg: number('costAvg'), price: number('price'), account: get('account') || defaultAccount, factor: get('factor') || defaultFactor(get('code')) });
  });
  if (!result.length) throw new Error('沒有可匯入的持股。');
  return result;
}

export function decodeCsv(buffer: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('big5', { fatal: true }).decode(buffer); }
}

// 匯入規則：CSV 視為各帳戶「目前的完整持股」，不是逐筆交易紀錄。
export type ImportMode = 'add' | 'replace';
export type FactorChange = { account: string; code: string; from: string; to: string };
export type ImportPlan<T extends ImportedHolding> = { kept: T[]; added: ImportedHolding[]; errors: string[]; notes: string[]; accounts: string[]; dropped: T[]; factorChanges: FactorChange[] };

const holdingKey = (h: { account: string; code: string }) => `${h.account}\u0000${h.code}`;
const stripLeadingZeros = (code: string) => code.replace(/^0+(?=\d)/, '');

/** 檔案內同帳戶同代號的多列先合併：股數相加，成本按股數加權，其餘欄位取最後一列。 */
export function mergeDuplicateRows(rows: ImportedHolding[]): { rows: ImportedHolding[]; notes: string[] } {
  const merged = new Map<string, ImportedHolding>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = holdingKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const previous = merged.get(key);
    if (!previous) { merged.set(key, { ...row }); continue; }
    const total = previous.shares + row.shares;
    const weighted = total > 0 ? (previous.shares * previous.costAvg + row.shares * row.costAvg) / total : row.costAvg;
    merged.set(key, { ...row, shares: total, costAvg: weighted });
  }
  const notes = [...counts].filter(([, n]) => n > 1).map(([key, n]) => {
    const h = merged.get(key)!;
    return `${h.account} ${h.code} 在檔案中有 ${n} 列，已合併為 ${h.shares} 股，成本按股數加權。`;
  });
  return { rows: [...merged.values()], notes };
}

/**
 * replace：只清空檔案中出現的帳戶，再放入檔案內容；其他帳戶不動。
 * add：只允許新增尚未存在的「帳戶＋代號」，有重複就整批阻止。
 * 有錯誤時不做任何變更（kept 為原持股、added 為空）。
 */
export function planImport<T extends ImportedHolding>(existing: T[], incoming: ImportedHolding[], mode: ImportMode): ImportPlan<T> {
  const errors: string[] = [];
  const missing = incoming.filter(r => !r.account.trim()).length;
  if (missing) errors.push(`有 ${missing} 列沒有帳戶，請先指定帳戶。`);
  const { rows, notes } = mergeDuplicateRows(incoming);
  for (const row of rows) {
    const twin = existing.find(h => h.account === row.account && h.code !== row.code && stripLeadingZeros(h.code) === stripLeadingZeros(row.code));
    if (twin) errors.push(`${row.account} 的代號「${row.code}」和現有的「${twin.code}」只差開頭的 0，可能被 Excel 刪掉了前導 0。請修正 CSV 後再匯入。`);
  }
  if (mode === 'add') {
    const existingKeys = new Set(existing.map(holdingKey));
    const conflicts = rows.filter(r => existingKeys.has(holdingKey(r)));
    if (conflicts.length) errors.push(`已有相同帳戶與代號的持股：${conflicts.map(r => `${r.account} ${r.code}`).join('、')}。更新既有部位請改用「取代」。`);
  }
  const accounts = [...new Set(rows.map(r => r.account))];
  if (errors.length) return { kept: existing, added: [], errors, notes, accounts, dropped: [], factorChanges: [] };
  if (mode === 'add') return { kept: existing, added: rows, errors, notes, accounts, dropped: [], factorChanges: [] };
  const csvByKey = new Map(rows.map(r => [holdingKey(r), r]));
  const replaced = existing.filter(h => accounts.includes(h.account));
  const dropped = replaced.filter(h => !csvByKey.has(holdingKey(h)));
  const factorChanges = replaced.flatMap(h => {
    const next = csvByKey.get(holdingKey(h));
    return next && next.factor !== h.factor ? [{ account: h.account, code: h.code, from: h.factor, to: next.factor }] : [];
  });
  return { kept: existing.filter(h => !accounts.includes(h.account)), added: rows, errors, notes, accounts, dropped, factorChanges };
}
