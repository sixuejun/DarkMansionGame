/* 验证 map.zip 能被 core/io/zip.ts + core/io/mapFormat.ts 正确解析。
   用法：node scripts/check-map.cjs */
const fs = require('fs');
const path = require('path');
const { load } = require('../tests/load.cjs');

const A = load('src/core/index.ts');
const zipBytes = fs.readFileSync(path.join(__dirname, '..', 'public', 'map.zip'));

(async () => {
  const files = await A.readZip(zipBytes);
  console.log('=== ZIP 内容 ===');
  for (const [name, data] of files) {
    console.log(`  ${name}  ${data.length} bytes`);
  }

  const mapEntry = [...files.entries()].find(([n]) => n.endsWith('map.json'));
  if (!mapEntry) throw new Error('zip 里找不到 map.json');
  const mapJson = JSON.parse(new TextDecoder().decode(mapEntry[1]));

  console.log('\n=== map.json 顶层 ===');
  console.log('  format   ', mapJson.format, 'version', mapJson.version);
  console.log('  canvas   ', JSON.stringify(mapJson.canvas));
  console.log('  actor    ', JSON.stringify(mapJson.actor));
  console.log('  regions  ', mapJson.regions.length);
  console.log('  entities ', mapJson.entities.length);
  console.log('  render_order:', (mapJson.render_order || []).join(' -> '));

  const regions = A.regionsFromMapJson(mapJson);
  const marks = A.marksFromMapJson(mapJson);
  console.log('\n=== 解析结果 ===');
  console.log('  区域', regions.length, '/ 实体', marks.length);

  const byType = {};
  for (const r of regions) byType[r.type + '/' + r.shape] = (byType[r.type + '/' + r.shape] || 0) + 1;
  console.log('  区域统计:', JSON.stringify(byType));

  const byKind = {};
  for (const m of marks) byKind[m.kind + ':' + m.name] = (byKind[m.kind + ':' + m.name] || 0) + 1;
  console.log('  实体统计:', JSON.stringify(byKind, null, 0));

  const spawn = marks.find((m) => m.kind === 'spawn');
  console.log('\n  出生点:', spawn ? `(${spawn.x}, ${spawn.y})` : '无');
})();
