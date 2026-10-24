/* 专测点标记：增删改查、id 唯一、旧工程缺 marks 字段不报错。
   用法：node test_marks.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
                          else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); } };

console.log('\n=== A. 新建工程带空的 marks 数组 ===');
const project = A.createProject();
ok('createProject 有 marks 字段', Array.isArray(project.marks), 'marks=' + project.marks);
ok('初始 marks 为空', project.marks.length === 0, 'len=' + project.marks.length);

console.log('\n=== B. 增删改查 ===');
const m1 = A.addMark(project, 'teleport', 100, 200);
ok('新增标记返回对象', !!m1 && m1.kind === 'teleport', JSON.stringify(m1));
ok('新增标记进了工程', project.marks.length === 1, 'len=' + project.marks.length);
ok('标记 id 非空', typeof m1.id === 'string' && m1.id.length > 0, 'id=' + m1.id);
ok('标记坐标是脚底落点', m1.x === 100 && m1.y === 200, `x=${m1.x} y=${m1.y}`);
ok('默认朝向是正面 down', m1.facing === 'down', 'facing=' + m1.facing);

const m2 = A.addMark(project, 'monster', 300, 400);
ok('两个标记 id 不重复', m1.id !== m2.id, `${m1.id} vs ${m2.id}`);

ok('findMark 能找到', A.findMark(project, m1.id) === m1, 'not found');
ok('findMark 传 null 返回 undefined', A.findMark(project, null) === undefined, 'should be undefined');

ok('removeMark 删除成功', A.removeMark(project, m1.id) === true, 'remove failed');
ok('删除后剩一个', project.marks.length === 1, 'len=' + project.marks.length);
ok('removeMark 删不存在的返回 false', A.removeMark(project, 'nope') === false, 'should be false');

console.log('\n=== C. 改类型 / 朝向 / 名称 / 位置 ===');
ok('setMarkKind 成功', A.setMarkKind(project, m2.id, 'chest') === true, 'failed');
ok('类型已改成 chest', m2.kind === 'chest', 'kind=' + m2.kind);
ok('改成同一个类型返回 false', A.setMarkKind(project, m2.id, 'chest') === false, 'should be false');

ok('setMarkFacing 成功', A.setMarkFacing(project, m2.id, 'left') === true, 'failed');
ok('朝向已改成 left', m2.facing === 'left', 'facing=' + m2.facing);

ok('renameMark 成功', A.renameMark(project, m2.id, '宝箱甲') === true, 'failed');
ok('名称已改', m2.name === '宝箱甲', 'name=' + m2.name);

ok('moveMark 成功', A.moveMark(project, m2.id, 55, 66) === true, 'failed');
ok('位置已改', m2.x === 55 && m2.y === 66, `x=${m2.x} y=${m2.y}`);

console.log('\n=== D. 标签键值表 ===');
ok('setMarkTags 成功', A.setMarkTags(project, m2.id, { target_scene: 'town', cost: '0' }) === true, 'failed');
ok('标签写进去了', m2.tags.target_scene === 'town', JSON.stringify(m2.tags));
ok('标签行能读出来', A.markTagRows(m2).length === 2, 'rows=' + A.markTagRows(m2).length);

console.log('\n=== E. 旧工程没有 marks 字段时不报错 ===');
/* 旧存档结构：没有 marks 这一项 */
const oldStored = {
  name: 'old',
  canvas: { w: 800, h: 600 },
  layers: {
    background: { src: null, w: 0, h: 0, visible: true, locked: false, opacity: 1 },
    objects: { src: null, w: 0, h: 0, visible: true, locked: false, opacity: 1 },
    foreground: { src: null, w: 0, h: 0, visible: true, locked: false, opacity: 1 },
  },
  regions: [],
  seq: 0,
  char: { x: 10, y: 20, w: 36, h: 56, speed: 5, ghostAlpha: 0.35, anchorX: 0.5, anchorY: 1, boxW: 14, boxH: 8 },
};
let threw = false;
let restored = null;
try {
  restored = A.deserializeProject(oldStored, {});
} catch (e) {
  threw = true;
  console.log('    抛错原文: ' + e.message);
}
ok('旧工程读取不报错', !threw, 'threw');
ok('旧工程 marks 补空数组', restored && Array.isArray(restored.marks) && restored.marks.length === 0,
  'marks=' + (restored && restored.marks));

console.log('\n=== F. 序列化带上 marks ===');
const p2 = A.createProject();
A.addMark(p2, 'spawn', 10, 20);
const ser = A.serializeProject(p2, false);
ok('序列化结果有 marks', Array.isArray(ser.marks) && ser.marks.length === 1, JSON.stringify(ser.marks));
ok('序列化的标记内容正确', ser.marks[0].kind === 'spawn' && ser.marks[0].x === 10, JSON.stringify(ser.marks[0]));

console.log('\n=== G. 撤销 / 重做对标记有效（且不污染历史）===');
/* 这一段测的是一个真实的坑：
   撤销时把快照的数组直接挂成当前状态，之后再删除标记就等于
   就地删在历史记录上 → 撤销删除时标记回不来。 */
const hp = A.createProject();
const history = new A.History({
  getSnapshot: () => ({ regions: hp.regions, marks: hp.marks, seq: hp.seq }),
  applySnapshot: (snap) => {
    hp.regions = snap.regions;
    hp.marks = snap.marks || [];
    hp.seq = snap.seq;
  },
});

const ma = A.addMark(hp, 'teleport', 100, 200);
const mb = A.addMark(hp, 'monster', 300, 400);
history.reset('初始', history.snapshot());
ok('初始有 2 个标记', hp.marks.length === 2, 'len=' + hp.marks.length);

/* 改标签 + 移动，各记一步 */
let tx = history.beginOp();
A.setMarkTags(hp, ma.id, { target_scene: 'town' });
history.commitOp(tx, '修改标签');
tx = history.beginOp();
A.moveMark(hp, mb.id, 350, 450);
history.commitOp(tx, '移动标记');

/* 删除标记 → 撤销 → 必须原样回来 */
tx = history.beginOp();
A.removeMark(hp, ma.id);
history.commitOp(tx, '删除标记');
ok('删除生效', hp.marks.length === 1, 'len=' + hp.marks.length);
history.undo();
ok('撤销删除后标记回来了', hp.marks.length === 2, 'len=' + hp.marks.length);
ok('回来的标记 id 一致', hp.marks.some(m => m.id === ma.id), JSON.stringify(hp.marks.map(m => m.id)));
ok('回来的标记标签还在', (hp.marks.find(m => m.id === ma.id) || {}).tags?.target_scene === 'town',
  JSON.stringify((hp.marks.find(m => m.id === ma.id) || {}).tags));
ok('撤销删除后位置没变', hp.marks.find(m => m.id === mb.id)?.x === 350, 'x=' + (hp.marks.find(m => m.id === mb.id) || {}).x);

/* 再撤销两步：标签、位置都要回原样 */
history.undo();
ok('撤销移动后位置复原', hp.marks.find(m => m.id === mb.id)?.x === 300, 'x=' + (hp.marks.find(m => m.id === mb.id) || {}).x);
history.undo();
ok('撤销标签后标签没了', hp.marks.find(m => m.id === ma.id)?.tags === undefined,
  JSON.stringify(hp.marks.find(m => m.id === ma.id)?.tags));

/* 重做回去 */
history.redo();
ok('重做后标签回来了', hp.marks.find(m => m.id === ma.id)?.tags?.target_scene === 'town',
  JSON.stringify(hp.marks.find(m => m.id === ma.id)?.tags));

console.log('\n=== H. 连续删两个标记，两个都能撤销回来 ===');
const hp2 = A.createProject();
const h2 = new A.History({
  getSnapshot: () => ({ regions: hp2.regions, marks: hp2.marks, seq: hp2.seq }),
  applySnapshot: (snap) => {
    hp2.regions = snap.regions;
    hp2.marks = snap.marks || [];
    hp2.seq = snap.seq;
  },
});
A.addMark(hp2, 'chest', 10, 10);
A.addMark(hp2, 'chest', 20, 20);
A.addMark(hp2, 'npc', 30, 30);
h2.reset('初始', h2.snapshot());
for (const id of hp2.marks.map(m => m.id)) {
  const t = h2.beginOp();
  A.removeMark(hp2, id);
  h2.commitOp(t, '删除标记');
}
ok('三个都删掉了', hp2.marks.length === 0, 'len=' + hp2.marks.length);
h2.undo();
ok('撤销一次回来一个', hp2.marks.length === 1, 'len=' + hp2.marks.length);
h2.undo();
ok('撤销两次回来两个', hp2.marks.length === 2, 'len=' + hp2.marks.length);
h2.undo();
ok('撤销三次全部回来', hp2.marks.length === 3, 'len=' + hp2.marks.length);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
