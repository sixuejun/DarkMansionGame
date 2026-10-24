/**
 * P0 移植脚本：把地图编辑器的 core/ 与类型定义搬到游戏仓库。
 *
 * 关键点：编辑器 core/ 是纯逻辑层（零 vue / 零 pinia 依赖），
 * 因此可以近乎逐字移植 —— 只需把 `@/types/map` 改成相对路径。
 * 保留逐字移植（而不是重写）是为了让编辑器的 14 个测试能直接复用，
 * 从而证明「移植后行为未变」。
 */
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/31705/Desktop/Dark馆地图编辑器/src';
const DST = 'C:/Users/31705/Desktop/DarkMansionGame/src';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(path.join(SRC, 'core')).concat([path.join(SRC, 'types', 'map.ts')]);

let copied = 0;
for (const f of files) {
  const rel = path.relative(SRC, f).split(path.sep).join('/');
  const dst = path.join(DST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });

  let s = fs.readFileSync(f, 'utf8');

  // `@/types/map` -> 相对路径
  const relImport = path
    .relative(path.posix.dirname(rel), 'types/map')
    .split(path.sep)
    .join('/');
  const spec = relImport.startsWith('.') ? relImport : './' + relImport;
  s = s.split("from '@/types/map'").join(`from '${spec}'`);

  fs.writeFileSync(dst, s, 'utf8');
  copied++;
}

console.log(`移植 ${copied} 个文件 -> ${DST}`);
