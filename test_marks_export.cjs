/* 专测点标记的导出：toMapJson 输出 entities；marksFromMapJson 能读回；往返一致。
   用法：node test_marks_export.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
                          else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); } };

console.log('\n=== A. toMapJson 输出 entities 段 ===');
const project = A.createProject();
project.name = 'honmaru_01';
A.addMark(project, 'teleport', 320, 480);
A.addMark(project, 'monster', 100, 200);
A.addMark(project, 'chest', 640, 300);

const json = A.toMapJson(project);
ok('map.json 有 entities 段', Array.isArray(json.entities), 'entities=' + json.entities);
ok('entities 有 3 条', json.entities.length === 3, 'len=' + (json.entities || []).length);
ok('format 正确', json.format === 'darkmansion-map', 'format=' + json.format);
ok('version 已升到 4', json.version === 4, 'version=' + json.version);

const e0 = json.entities[0];
ok('entity 有 id', typeof e0.id === 'string' && e0.id.length > 0, 'id=' + e0.id);
ok('entity 有 kind', e0.kind === 'teleport', 'kind=' + e0.kind);
ok('entity 有 name', typeof e0.name === 'string' && e0.name.length > 0, 'name=' + e0.name);
ok('entity 有 x / y', e0.x === 320 && e0.y === 480, `x=${e0.x} y=${e0.y}`);
ok('entity 有 facing', e0.facing === 'down', 'facing=' + e0.facing);
ok('facing 是字符串而非数字', typeof e0.facing === 'string', 'type=' + typeof e0.facing);

console.log('\n=== B. facing 四种值都能正确导出 ===');
const facings = ['down', 'up', 'left', 'right'];
let facingOk = true;
for (const f of facings) {
  const p = A.createProject();
  const m = A.addMark(p, 'npc', 10, 10);
  A.setMarkFacing(p, m.id, f);
  const j = A.toMapJson(p);
  if (j.entities[0].facing !== f || typeof j.entities[0].facing !== 'string') facingOk = false;
}
ok('down/up/left/right 都导出成字符串', facingOk, 'facing mismatch');

console.log('\n=== C. 标签与脚底盒的导出 ===');
const p3 = A.createProject();
const m3 = A.addMark(p3, 'teleport', 5, 6);
A.setMarkTags(p3, m3.id, { target_scene: 'town', cost: '0' });
m3.boxW = 20;
m3.boxH = 12;
const j3 = A.toMapJson(p3);
ok('tags 原样导出', j3.entities[0].tags.target_scene === 'town', JSON.stringify(j3.entities[0].tags));
ok('boxW 导出', j3.entities[0].boxW === 20, 'boxW=' + j3.entities[0].boxW);
ok('boxH 导出', j3.entities[0].boxH === 12, 'boxH=' + j3.entities[0].boxH);

console.log('\n=== D. marksFromMapJson 能读回 ===');
const back = A.marksFromMapJson(JSON.parse(JSON.stringify(json)));
ok('读回 3 条', back.length === 3, 'len=' + back.length);
ok('id 一致', back[0].id === e0.id, `${back[0].id} vs ${e0.id}`);
ok('kind 一致', back[0].kind === 'teleport', 'kind=' + back[0].kind);
ok('坐标一致', back[0].x === 320 && back[0].y === 480, `x=${back[0].x} y=${back[0].y}`);
ok('facing 一致', back[0].facing === 'down', 'facing=' + back[0].facing);

console.log('\n=== E. 往返一致（工程 → json → 工程）===');
const p5 = A.createProject();
A.addMark(p5, 'monster', 111, 222);
A.addMark(p5, 'npc', 333, 444);
const m5 = p5.marks[1];
A.setMarkFacing(p5, m5.id, 'up');
A.setMarkTags(p5, m5.id, { npc_id: 'shop_keeper' });
const rt = A.marksFromMapJson(A.toMapJson(p5));
ok('往返后条数一致', rt.length === 2, 'len=' + rt.length);
ok('往返后 id 一致', rt[0].id === p5.marks[0].id, 'id mismatch');
ok('往返后朝向一致', rt[1].facing === 'up', 'facing=' + rt[1].facing);
ok('往返后标签一致', rt[1].tags.npc_id === 'shop_keeper', JSON.stringify(rt[1].tags));

console.log('\n=== F. 没有 entities 段的旧 map.json 不报错 ===');
const oldMap = { format: 'darkmansion-map', version: 2, name: 'old', regions: [] };
const oldMarks = A.marksFromMapJson(oldMap);
ok('旧 map.json 读出空数组', Array.isArray(oldMarks) && oldMarks.length === 0, 'len=' + oldMarks.length);

console.log('\n=== G. 非法数据被纠正，不崩溃 ===');
const bad = A.marksFromMapJson({
  entities: [
    { id: 'a', kind: '不存在的类型', name: 'x', x: 1, y: 2, facing: '乱写' },
    { id: 'b', kind: 'chest', name: 'y', x: '不是数字', y: 2 },
    { kind: 'npc', name: 'z', x: 5, y: 6 },
    null,
  ],
});
ok('非法 kind 落到 custom', bad[0].kind === 'custom', 'kind=' + bad[0].kind);
ok('非法 facing 落到 down', bad[0].facing === 'down', 'facing=' + bad[0].facing);
ok('坐标不是数字的被丢弃', bad.length === 2, 'len=' + bad.length);
ok('缺 id 的补一个', typeof bad[1].id === 'string' && bad[1].id.length > 0, 'id=' + bad[1].id);

console.log('\n=== H. tags 里的数值统一存成字符串 ===');
const numTags = A.marksFromMapJson({
  entities: [{ id: 't', kind: 'chest', name: 't', x: 1, y: 1, tags: { drop: 42, chance: 0.5 } }],
});
ok('数值标签转成字符串', numTags[0].tags.drop === '42', JSON.stringify(numTags[0].tags));
ok('小数标签转成字符串', numTags[0].tags.chance === '0.5', JSON.stringify(numTags[0].tags));

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
