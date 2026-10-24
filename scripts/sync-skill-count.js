#!/usr/bin/env node
/**
 * Sync the skill counts shown in index.html and README.md.
 *
 * A skill is a non-hidden folder under the skills directory that contains a
 * SKILL.md. A skill is "manual" when its frontmatter sets
 * `disable-model-invocation: true`.
 *
 * Numbers are written only between marker pairs, e.g.
 *   <!-- skill-count:total -->42<!-- /skill-count:total -->
 *   <!-- skill-count:manual -->3<!-- /skill-count:manual -->
 * A file without its markers aborts the run before anything is written.
 *
 * Usage:
 *   node scripts/sync-skill-count.js [--dry-run] [--repo <dir>] [--skills <dir>]
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const TARGET_FILES = ['index.html', 'README.md'];
const COUNT_KEYS = ['total', 'manual'];

function parseArgs(argv) {
  const options = {
    dryRun: false,
    repo: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    skills: path.join(os.homedir(), '.claude', 'skills'),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };

    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--repo') options.repo = path.resolve(readValue());
    else if (arg === '--skills') options.skills = path.resolve(readValue());
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function isManual(skillMd) {
  const frontmatter = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return Boolean(frontmatter) && /^disable-model-invocation:\s*true\s*$/m.test(frontmatter[1]);
}

function collectSkills(skillsDir) {
  const skills = [];

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;

    const dir = path.join(skillsDir, entry.name);
    let isDirectory = false;
    try {
      // statSync follows symlinks, so linked skill folders are counted too.
      isDirectory = fs.statSync(dir).isDirectory();
    } catch {
      continue; // broken link
    }
    if (!isDirectory) continue;

    const skillFile = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    skills.push({ name: entry.name, manual: isManual(fs.readFileSync(skillFile, 'utf8')) });
  }

  return skills;
}

function countSkills(skillsDir) {
  const skills = collectSkills(skillsDir);
  return {
    total: skills.length,
    manual: skills.filter((skill) => skill.manual).length,
  };
}

function replaceCount(text, key, value, file) {
  const pattern = new RegExp(`(<!-- skill-count:${key} -->)[\\s\\S]*?(<!-- /skill-count:${key} -->)`, 'g');
  let matches = 0;

  const updated = text.replace(pattern, (_, open, close) => {
    matches += 1;
    return `${open}${value}${close}`;
  });

  if (matches === 0) throw new Error(`${file}: missing marker pair for "${key}"`);
  return updated;
}

function buildDiff(file, before, after) {
  // Replacements only change text inside a line, so line indexes line up.
  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);
  const out = [`--- a/${file}`, `+++ b/${file}`];

  for (let i = 0; i < oldLines.length; i += 1) {
    if (oldLines[i] === newLines[i]) continue;
    out.push(`@@ line ${i + 1} @@`);
    out.push(`-${oldLines[i]}`);
    out.push(`+${newLines[i]}`);
  }

  return out.join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const counts = countSkills(options.skills);
  console.log(`Skills in ${options.skills}: ${counts.total} total, ${counts.manual} manual`);

  const changes = [];
  for (const file of TARGET_FILES) {
    const fullPath = path.join(options.repo, file);
    const before = fs.readFileSync(fullPath, 'utf8');
    let after = before;
    for (const key of COUNT_KEYS) {
      after = replaceCount(after, key, counts[key], file);
    }
    if (after !== before) changes.push({ file, fullPath, before, after });
  }

  if (changes.length === 0) {
    console.log('Counts already up to date. Nothing to change.');
    return;
  }

  for (const change of changes) {
    console.log(buildDiff(change.file, change.before, change.after));
  }

  if (options.dryRun) {
    console.log('\nDry run: no files written.');
    return;
  }

  for (const change of changes) {
    fs.writeFileSync(change.fullPath, change.after, 'utf8');
    console.log(`Updated ${change.file}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`sync-skill-count: ${error.message}`);
  process.exitCode = 1;
}
