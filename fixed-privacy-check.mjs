#!/usr/bin/env node
// 隱私檢查：GitHub repo 與 GitHub Pages 都是公開的，任何寫進原始碼或打包檔的持股都會外洩。
// 修正版 V5.3.2：排除 dist / node_modules / build 產物，只掃原始碼與 git 追蹤檔
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';

const problems = [];
if (!existsSync('dist/index.html')) {
  console.warn('提示：缺少 dist/index.html，請先執行 npm run build 再檢查完整打包產物。');
}
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.css', '.md', '.json', '.yml', '.yaml', '.txt']);
const DATA_FILE = /(\.(csv|tsv|xlsx?|ods)$)|(^|\/)holdings_/i;
const SELF = ['scripts', 'privacy-check.mjs'].join('/');

// 這些目錄完全不掃 - 是打包產物或依賴
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vite', '.sites-runtime', 'private', 'screenshots', 'coverage', '.turbo', '.next']);

let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
} catch {
  console.warn('注意：目前不在 Git 工作目錄，未檢查 Git 已追蹤檔案或歷史。');
}

for (const file of tracked) {
  if (DATA_FILE.test(file)) problems.push(`git 追蹤了持股資料檔：${file}（請 git rm --cached 並加入 .gitignore）`);
  if (file.startsWith('dist/') || file.startsWith('build/')) problems.push(`git 不該追蹤打包檔：${file}（請加入 .gitignore）`);
}

const walk = dir => !existsSync(dir) ? [] : readdirSync(dir).flatMap(name => {
  if (IGNORED_DIRS.has(name) || name.startsWith('.env') || name === '.privacy-denylist') return [];
  const path = join(dir, name);
  try {
    return statSync(path).isDirectory() ? walk(path) : [path.split(sep).join('/')];
  } catch { return []; }
});

const files = [...new Set([...tracked, ...walk('.')])]
  .filter(f => existsSync(f) && TEXT_EXT.has(extname(f).toLowerCase()))
  .filter(f => !f.startsWith('node_modules/') && !f.startsWith('dist/') && !f.startsWith('build/'))
  .filter(f => !f.endsWith('package-lock.json') && f !== SELF && !f.includes('/dist/') && !f.includes('/build/'));

const HARDCODED_NUMBER = /\b(shares|costAvg)\s*:\s*-?\d/;
const TICKER_ARRAY = /\[\s*(["'`])\d{4,6}[A-Z]?\1\s*(,\s*(["'`])\d{4,6}[A-Z]?\3\s*)+\]/;

const rawDenylist = [process.env.PRIVACY_DENYLIST ?? '', existsSync('.privacy-denylist') ? readFileSync('.privacy-denylist', 'utf8') : '']
  .join('\n').split(/[\n,，]/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));

// 過濾太短的關鍵字，避免 "2330" 這種在 CSS hex 或版本號中誤判 - 但保留警告
const denylist = [];
const tooShort = [];
for (const w of rawDenylist) {
  if (w.length < 4) tooShort.push(w);
  else denylist.push(w);
}
if (tooShort.length) {
  console.warn(`注意：.privacy-denylist 有 ${tooShort.length} 個太短的關鍵字（<4字元）已被忽略避免誤判：${tooShort.slice(0,5).join(', ')}${tooShort.length>5?'...':''}`);
  console.warn('建議只放：真實姓名全名、完整帳戶名稱、完整持股名稱、特殊股數如 3123股、完整成本如 成本123.45、私人檔名');
}

if (!denylist.length) console.warn('注意：未設定私密關鍵字，只能檢查有限的程式模式；通過不代表沒有個資。');
console.warn('本檢查不涵蓋 Git 歷史、圖片內容、遠端快取或第三方副本。');

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const isTest = /\.test\.[cm]?[jt]sx?$/.test(file);
  if (!isTest) {
    const n = HARDCODED_NUMBER.exec(text);
    if (n) problems.push(`疑似寫死持股數值：${file}:${lineOf(text, n.index)}`);
    const t = TICKER_ARRAY.exec(text);
    if (t) problems.push(`疑似寫死股票代號清單：${file}:${lineOf(text, t.index)}`);
  }
  denylist.forEach((word, i) => {
    // 使用區分大小寫的精確包含，但忽略 node 產物已排除
    const at = text.indexOf(word);
    if (at >= 0) {
      // 在測試檔中允許假資料，但真實關鍵字仍擋
      problems.push(`出現私密關鍵字 #${rawDenylist.indexOf(word)+1}：${file}:${lineOf(text, at)}`);
    }
  });
}

if (problems.length) {
  console.error(`✖ 隱私檢查失敗（${problems.length} 項）：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✔ 隱私檢查通過：掃描 ${files.length} 個檔案，git 追蹤 ${tracked.length} 個檔案，私密關鍵字 ${denylist.length} 個（原始 ${rawDenylist.length} 個）。`);
