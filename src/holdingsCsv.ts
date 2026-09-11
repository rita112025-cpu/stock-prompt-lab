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
