/* 测试运行器：依次跑所有 test_*.cjs，任一失败即整体失败。
   用法：node tests/run.cjs */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = fs
  .readdirSync(ROOT)
  .filter((f) => /^test_.*\.cjs$/.test(f))
  .sort();

let failed = 0;
for (const f of files) {
  process.stdout.write(`\n===== ${f} =====\n`);
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, f)], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout.write(out);
    const m = out.match(/(\d+) passed, (\d+) failed/);
    if (m && Number(m[2]) > 0) {
      failed++;
      console.log(`!! ${f}: ${m[2]} failed`);
    }
  } catch (e) {
    failed++;
    process.stdout.write(e.stdout || '');
    process.stderr.write(e.stderr || '');
    console.log(`!! ${f}: 退出码 ${e.status}`);
  }
}

console.log(`\n===== 汇总：${files.length} 个测试文件，${failed} 个失败 =====`);
process.exit(failed ? 1 : 0);
