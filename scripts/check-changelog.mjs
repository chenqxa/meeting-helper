#!/usr/bin/env node
// 校验 Obsidian 变更记录是否符合《变更记录契约》
// 用法：node scripts/check-changelog.mjs <file.md | dir>
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_KEYS = ['date', 'type', 'status', 'project', 'area', 'risk', 'files', 'rollback', 'tags'];
const ALLOWED_H2 = ['结论', '原因', '影响与风险', '验证与回滚', '关联'];
const FORBIDDEN = ['TL;DR', '详细变更', '影响范围', '我的复盘', '代码涉及', '一句话总结'];
const WARN_CHARS = 600;
const FAIL_CHARS = 800;

function collectFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(target, f));
}

function checkFile(file) {
  const errors = [];
  const warns = [];
  const raw = fs.readFileSync(file, 'utf8');

  // frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    errors.push('缺少 YAML frontmatter');
  } else {
    const fm = fmMatch[1];
    for (const k of REQUIRED_KEYS) {
      if (!new RegExp(`^${k}\\s*:`, 'm').test(fm)) errors.push(`frontmatter 缺少字段：${k}`);
    }
  }

  const body = raw.replace(/^---\n[\s\S]*?\n---/, '');

  // 二级标题
  const h2 = [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map(m => m[1].trim());
  if (h2.length > 5) errors.push(`二级标题数量 ${h2.length} > 5`);
  for (const h of h2) {
    if (!ALLOWED_H2.includes(h)) errors.push(`不允许的二级标题：${h}`);
  }
  for (const a of ALLOWED_H2) {
    if (!h2.includes(a)) warns.push(`缺少二级标题：${a}`);
  }

  // 字数（中文字符）
  const cn = (body.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cn > FAIL_CHARS) errors.push(`中文字数 ${cn} > ${FAIL_CHARS}（硬上限）`);
  else if (cn > WARN_CHARS) warns.push(`中文字数 ${cn} > ${WARN_CHARS}（建议上限）`);

  // 禁用词
  for (const w of FORBIDDEN) {
    if (body.includes(w)) errors.push(`出现禁用词：${w}`);
  }

  // emoji 装饰
  if (/\p{Extended_Pictographic}/u.test(body)) errors.push('正文出现 emoji（禁止装饰性 emoji）');

  // 已完成里混入未确认
  const statusDone = /^status\s*:\s*done/m.test(fmMatch ? fmMatch[1] : '');
  if (statusDone && /待确认|未上线|待上线/.test(body)) errors.push('status=done 却含"待确认/未上线/待上线"');

  return { errors, warns, cn, h2 };
}

const target = process.argv[2];
if (!target) {
  console.error('用法：node scripts/check-changelog.mjs <file.md | dir>');
  process.exit(2);
}

let ok = true;
for (const file of collectFiles(target)) {
  const { errors, warns, cn, h2 } = checkFile(file);
  const rel = path.relative(process.cwd(), file);
  if (errors.length === 0) {
    console.log(`PASS  ${rel}  (中文${cn}字, H2×${h2.length})`);
  } else {
    ok = false;
    console.log(`FAIL  ${rel}`);
    for (const e of errors) console.log(`  - ${e}`);
  }
  for (const w of warns) console.log(`  ~ ${w}`);
}

process.exit(ok ? 0 : 1);
