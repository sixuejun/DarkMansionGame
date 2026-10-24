/* 测试加载器：把 src/ 下的 TypeScript 核心模块用 esbuild 打包成 CommonJS，
   这样 node 可以直接 require，测试脚本无需浏览器环境。
   用法：const { load } = require('./tests/load.cjs');
        const core = load('src/core/index.ts'); */
const path = require('path');
const os = require('os');
const { buildSync } = require('esbuild');

const ROOT = path.join(__dirname, '..');

function load(entry) {
  const outfile = path.join(
    os.tmpdir(),
    'dark-editor-test-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.cjs',
  );
  buildSync({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    alias: { '@': path.join(ROOT, 'src') },
    external: ['vue'],
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  return require(outfile);
}

module.exports = { load, ROOT };
