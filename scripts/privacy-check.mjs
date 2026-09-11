#!/usr/bin/env node
// 修正版 V5.3.3：只用換行切 denylist，金額有逗號也不會被切碎
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';

const problems = [];
const TEXT_EXT = new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.html','.css','.md','.json','.yml','.yaml','.txt']);
const DATA_FILE = /(\.(csv|tsv|xlsx?|ods)$)|(^|\/)holdings_/i;
const SELF = ['scripts','privacy-check.mjs'].join('/');
const IGNORED_DIRS = new Set(['node_modules','.git','dist','build','.vite','.sites-runtime','private','screenshots','coverage','.turbo','.next']);

let tracked = [];
try { tracked = execFileSync('git',['ls-files','-z'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean); } catch { console.warn('注意：目前不在 Git 工作目錄，未檢查 Git 已追蹤檔案或歷史。'); }

for (const file of tracked) {
  if (DATA_FILE.test(file)) problems.push(`git 追蹤了持股資料檔：${file}`);
  if (file.startsWith('dist/')||file.startsWith('build/')) problems.push(`git 不該追蹤打包檔：${file}`);
}
const walk = dir => !existsSync(dir) ? [] : readdirSync(dir).flatMap(name => {
  if (IGNORED_DIRS.has(name) || name.startsWith('.env') || name === '.privacy-denylist') return [];
  const p = join(dir, name);
  try { return statSync(p).isDirectory() ? walk(p) : [p.split(sep).join('/')]; } catch { return []; }
});
const files = [...new Set([...tracked, ...walk('.')])].filter(f=>existsSync(f)&&TEXT_EXT.has(extname(f).toLowerCase())).filter(f=>!f.startsWith('dist/')&&!f.includes('/dist/')&&f!==SELF&&!f.endsWith('FIX-APPLIED.md'));

const HARDCODED_NUMBER = /\b(shares|costAvg)\s*:\s*-?\d/;
const TICKER_ARRAY = /\[\s*(["'`])\d{4,6}[A-Z]?\1\s*(,\s*(["'`])\d{4,6}[A-Z]?\3\s*)+\]/;

// 只用換行切，保留逗號金額完整
const rawContent = [process.env.PRIVACY_DENYLIST ?? '', existsSync('.privacy-denylist') ? readFileSync('.privacy-denylist','utf8') : ''].join('\n');
const rawDenylist = rawContent.split(/\r?\n/).map(s=>s.trim()).filter(s=>s && !s.startsWith('#'));

const denylist = [];
const tooShort = [];
for (const w of rawDenylist) {
  if (w.length < 4) tooShort.push(w);
  else denylist.push(w);
}
if (tooShort.length) {
  console.warn(`注意：.privacy-denylist 有 ${tooShort.length} 個太短的關鍵字（<4字元）已被忽略：${tooShort.slice(0,5).join(', ')}`);
}
if (!denylist.length) console.warn('注意：未設定私密關鍵字，只能檢查有限的程式模式；通過不代表沒有個資。');
console.warn('本檢查不涵蓋 Git 歷史、圖片內容、遠端快取或第三方副本。');

const lineOf = (t,i)=>t.slice(0,i).split('\n').length;
for (const file of files) {
  let text; try { text = readFileSync(file,'utf8'); } catch { continue; }
  if (!/\.test\./.test(file) && !file.endsWith('.md')) {
    const n=HARDCODED_NUMBER.exec(text); if(n) problems.push(`疑似寫死持股數值：${file}:${lineOf(text,n.index)}`);
    const tt=TICKER_ARRAY.exec(text); if(tt) problems.push(`疑似寫死股票代號清單：${file}:${lineOf(text,tt.index)}`);
  }
  denylist.forEach((word,i)=>{
    if (text.indexOf(word)>=0) problems.push(`出現私密關鍵字 #${i+1}：${file}:${lineOf(text,text.indexOf(word))}`);
  });
}
if(problems.length){ console.error(`✖ 隱私檢查失敗（${problems.length} 項）：`); problems.forEach(p=>console.error('  - '+p)); process.exit(1); }
console.log(`✔ 隱私檢查通過：掃描 ${files.length} 個檔案，git 追蹤 ${tracked.length} 個檔案，私密關鍵字 ${denylist.length} 個（原始 ${rawDenylist.length} 個）。`);
