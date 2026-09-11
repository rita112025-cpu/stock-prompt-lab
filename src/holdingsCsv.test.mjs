import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCsv, parseHoldingsCsv, decodeCsv, mergeDuplicateRows, planImport } from './holdingsCsv.ts';
import { fillPrompt, localDate } from './promptUtils.ts';

// 測試資料一律使用虛構代號與數字，不得使用真實持股。

const header = ['code', 'name', 'shares', 'costAvg', 'price', 'account'];
test('prompt values remain literal and are substituted only once', () => {
  assert.equal(fillPrompt('{{ticker}} / {{date}} / {{cost}}', {
    ticker: '$& {{date}}', date: 'test-date', cost: ' ',
  }), '$& {{date}} / test-date / 未提供');
  assert.equal(fillPrompt('{{constructor}}', {}), '{{constructor}}');
});

test('analysis date uses local calendar date', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Taipei';
    assert.equal(localDate(new Date('2026-09-10T17:00:00Z')), '2026-09-11');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('malformed thousands separators fail instead of changing the quantity', () => {
  for (const value of ['1,2', ',123', '123,', '12,34', '1,,234', '1,234.5,6']) {
    assert.throws(() => parseHoldingsCsv(encodeCsv([header, ['9999', '測試', value, 1, 2, '未分類']])));
  }
  assert.equal(parseHoldingsCsv(encodeCsv([header, ['9999', '測試', '1,234.56', 1, 2, '未分類']]))[0].shares, 1234.56);
});
test('Excel UTF-8 BOM and quoted Chinese fields round trip with leading zeros', () => {
  const csv = encodeCsv([header, ['0001', '測試,"基金"\n01', 10, 100, 120, '未分類']]);
  assert.deepEqual([...new TextEncoder().encode(csv).slice(0, 3)], [239,187,191]);
  assert.ok(csv.includes('\r\n'));
  assert.deepEqual(parseHoldingsCsv(decodeCsv(new TextEncoder().encode(csv).buffer)), [{code:'0001',name:'測試,"基金"\n01',shares:10,costAvg:100,price:120,account:'未分類',factor:'ETF'}]);
});
test('Chinese headers, thousands separators, optional account and legacy totals', () => {
  const csv = encodeCsv([['代號','名稱','股數','成本均價','現價'], ['00002','測試高息','1,234',10,12],['','',' ',100,200]]);
  assert.equal(parseHoldingsCsv(csv)[0].shares, 1234);
  assert.equal(parseHoldingsCsv(csv)[0].account, '未分類');
  assert.equal(parseHoldingsCsv(csv, '')[0].account, '');
});
test('invalid input fails atomically', () => {
  for (const text of ['', 'code,name\n9999,測試股', encodeCsv([header,['9999','測試股','oops',1,2,'未分類']]), encodeCsv([header,['9999','測試股',1,-1,2,'未分類']]), 'code,name,shares,costAvg,price\n9999,"未結束,1,2,3']) assert.throws(()=>parseHoldingsCsv(text));
});
test('Big5 decoding', () => {
  assert.equal(decodeCsv(Uint8Array.from([0xa4,0xa4,0xa4,0xe5]).buffer), '中文');
});
test('optional 因子 column; neutral default when absent', () => {
  const rows = parseHoldingsCsv(encodeCsv([['代號','名稱','股數','成本均價','現價','因子'], ['9998','測試甲',10,100,110,'AI/半導體'], ['9997','測試乙',10,100,90,'']]));
  assert.equal(rows[0].factor, 'AI/半導體');
  assert.equal(rows[1].factor, '未分類');
  assert.equal(parseHoldingsCsv(encodeCsv([['code','name','shares','costAvg','price'], ['00003','測試ETF',1,1,1]]))[0].factor, 'ETF');
});

const lot = (account, code, qty, cost, price = cost) => ({ account, code, name: '測試', shares: qty, costAvg: cost, price, factor: '未分類' });
const existing = [lot('帳戶甲', '0001', 1000, 50, 60), lot('帳戶甲', '9998', 2000, 30), lot('帳戶乙', '0001', 500, 55)];

test('replace clears only the accounts present in the file', () => {
  const plan = planImport(existing, [lot('帳戶甲', '0001', 1500, 54, 62)], 'replace');
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.accounts, ['帳戶甲']);
  assert.deepEqual(plan.kept, [existing[2]]);
  assert.deepEqual(plan.added, [lot('帳戶甲', '0001', 1500, 54, 62)]);
  assert.deepEqual(plan.dropped, [existing[1]]);
  assert.deepEqual(plan.factorChanges, []);
  const withFactor = planImport(existing, [{ ...lot('帳戶甲', '0001', 1500, 54, 62), factor: '測試因子' }], 'replace');
  assert.deepEqual(withFactor.factorChanges, [{ account: '帳戶甲', code: '0001', from: '未分類', to: '測試因子' }]);
  assert.deepEqual(planImport(existing, [lot('帳戶丙', '9997', 1, 1)], 'add').dropped, []);
});

test('rows repeated inside the file merge with share-weighted cost', () => {
  const { rows, notes } = mergeDuplicateRows([lot('帳戶甲', '9996', 100, 40, 45), lot('帳戶甲', '9996', 200, 43, 46)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shares, 300);
  assert.equal(rows[0].costAvg, 42);
  assert.equal(rows[0].price, 46);
  assert.equal(notes.length, 1);
  assert.equal(mergeDuplicateRows([lot('帳戶甲', '9996', 100, 40), lot('帳戶乙', '9996', 200, 43)]).rows.length, 2);
});

test('add only accepts new account and code pairs and blocks duplicates entirely', () => {
  const blocked = planImport(existing, [lot('帳戶甲', '0001', 500, 62), lot('帳戶甲', '9997', 10, 80)], 'add');
  assert.equal(blocked.errors.length, 1);
  assert.match(blocked.errors[0], /帳戶甲 0001/);
  assert.deepEqual(blocked.added, []);
  assert.equal(blocked.kept, existing);
  const allowed = planImport(existing, [lot('帳戶乙', '9997', 10, 80)], 'add');
  assert.deepEqual(allowed.errors, []);
  assert.equal(allowed.kept, existing);
  assert.equal(allowed.added.length, 1);
});

test('rows without an account are blocked until one is chosen', () => {
  for (const mode of ['add', 'replace']) {
    const plan = planImport(existing, [lot('', '9997', 10, 80)], mode);
    assert.match(plan.errors.join(''), /沒有帳戶/);
    assert.deepEqual(plan.added, []);
  }
});

test('codes that differ only by leading zeros are blocked instead of guessed', () => {
  for (const mode of ['add', 'replace']) {
    const plan = planImport(existing, [lot('帳戶甲', '1', 1500, 54)], mode);
    assert.match(plan.errors.join(''), /前導 0/);
    assert.deepEqual(plan.added, []);
    assert.equal(plan.kept, existing);
  }
  assert.deepEqual(planImport(existing, [lot('帳戶丙', '1', 1, 1)], 'add').errors.filter(e => /前導 0/.test(e)), []);
});
