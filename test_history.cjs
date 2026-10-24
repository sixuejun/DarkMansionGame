/* 专测撤销/重做。逻辑来自 src/core/history.ts（History 类）。
   用法：node test_history.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
                          else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); } };
const names = () => project.regions.map(r => r.name).join(',');

/* ---- 工程状态 + 撤销栈 ---- */
const project = A.createProject();
project.canvas = { w: 1920, h: 1080 };

const history = new A.History({
  getSnapshot: () => ({ regions: project.regions, seq: project.seq }),
  applySnapshot: (snap) => {
    project.regions = snap.regions;
    project.seq = snap.seq;
  },
});

function addRegion(data) {
  return A.addRegion(project, Object.assign({
    name: 'X', type: 'occlusion', target: 'both', shape: 'rect',
    points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }],
  }, data));
}

/* 造 3 步历史：0 → A → A,B → A,B,C */
function build3() {
  project.regions = []; project.seq = 0;
  history.reset('初始', history.snapshot());
  for (const n of ['A', 'B', 'C']) {
    const tx = history.beginOp();
    addRegion({ name: n });
    history.commitOp(tx, '新增 ' + n);
  }
}

console.log('\n=== A. 撤销后「重做」按钮必须变亮 ===');
build3();
ok('起点：撤销可用、重做不可用', history.canUndo === true && history.canRedo === false,
  `canUndo=${history.canUndo} canRedo=${history.canRedo}`);
history.undo();
ok('撤销一次后 重做按钮应可用', history.canRedo === true,
  'canRedo=' + history.canRedo);
history.redo();
ok('重做一次后 撤销按钮仍可用', history.canUndo === true, 'canUndo=' + history.canUndo);

console.log('\n=== B. 撤销到底时按钮应变灰 ===');
/* build3 产生 4 条历史：[初始, A, A+B, A+B+C] */
build3();
history.undo(); history.undo();                       /* 剩 2 条，还能再撤一步 → 撤销应仍亮 */
ok('撤销 2 次后仍有 1 步可撤，按钮保持可用', history.canUndo === true,
  'canUndo=' + history.canUndo);
ok('撤销 2 次后处于 A', names() === 'A', 'got "' + names() + '"');
history.undo();                                     /* 剩 1 条，撤到底 → 应变灰 */
ok('撤到底后 撤销应禁用', history.canUndo === false,
  '撤销按钮仍亮着 → 点了没反应');
ok('撤到底后重做按钮亮起', history.canRedo === true, 'canRedo=' + history.canRedo);
history.undo();   /* 已到底，会被 guard 拦下 */
ok('到底后再点撤销不崩且状态不变', names() === '', 'got "' + names() + '"');

console.log('\n=== C. 重做必须逐级回到目标状态 ===');
build3();
history.undo(); history.undo();
ok('撤销两次 → 只剩 A', names() === 'A', 'got "' + names() + '"');
history.redo();
ok('重做一次 → A,B', names() === 'A,B', 'got "' + names() + '"');
history.redo();
ok('重做两次 → A,B,C', names() === 'A,B,C', 'got "' + names() + '"');

console.log('\n=== D. 重做到底后「撤销」必须退回上一级 ===');
build3();
history.undo(); history.undo(); history.redo(); history.redo();
ok('当前在 A,B,C', names() === 'A,B,C', 'got "' + names() + '"');
history.undo();
ok('撤销应回到 A,B（而不是 A）', names() === 'A,B', 'got "' + names() + '"');

console.log('\n=== E. 反复 undo/redo 不得让历史栈错乱 ===');
build3();
for (let i = 0; i < 3; i++) { history.undo(); history.redo(); }
ok('3 轮 undo→redo 后仍在 A,B,C', names() === 'A,B,C', 'got "' + names() + '"');
const depth0 = history.past.length;
history.undo();
ok('此时撤销一次 → A,B', names() === 'A,B', 'got "' + names() + '"');
history.redo();
history.redo();
ok('再重做两次仍回到 A,B,C', names() === 'A,B,C', 'got "' + names() + '"');
ok('历史栈深度未被 redo 撑大', history.past.length === depth0,
  `${depth0} -> ${history.past.length}`);

console.log('\n=== F. 撤销后新建操作应清空重做栈 ===');
build3();
history.undo();
ok('撤销后重做栈非空', history.future.length > 0, 'future=' + history.future.length);
const tx = history.beginOp();
addRegion({ name: 'Z', points: [{ x: 0, y: 0 }, { x: 9, y: 9 }] });
history.commitOp(tx, '新增 Z');
ok('新操作后重做栈被清空', history.future.length === 0, 'future=' + history.future.length);
ok('重做按钮随之变灰', history.canRedo === false, 'canRedo=' + history.canRedo);

console.log('\n=== G. 撤销删除操作 ===');
build3();
const txD = history.beginOp();
A.removeRegion(project, project.regions[2].id);
history.commitOp(txD, '删除区域');
ok('删除后剩 A,B', names() === 'A,B', 'got "' + names() + '"');
history.undo();
ok('撤销删除 → A,B,C 回来了', names() === 'A,B,C', 'got "' + names() + '"');

console.log('\n=== H. 删除后不可再撤销到更早状态（栈底）===');
build3();
history.undo(); history.undo(); history.undo();   /* 回到空 */
ok('三次撤销回到空', names() === '', 'got "' + names() + '"');
ok('此时撤销按钮禁用', history.canUndo === false, 'canUndo=' + history.canUndo);

console.log('\n=== I. 合并键按区域隔离（方向键连按不跨区域）===');
project.regions = [];
project.seq = 0;
history.reset('初始', history.snapshot());
addRegion({ name: 'A', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
addRegion({ name: 'B', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });

/* 模拟方向键移动 A 两次 → 合并为一步 */
const tx1 = history.beginOp();
project.regions[0].points[0].x += 1;
history.commitOp(tx1, '移动区域', 'nudge:' + project.regions[0].id);
const tx2 = history.beginOp();
project.regions[0].points[0].x += 1;
history.commitOp(tx2, '移动区域', 'nudge:' + project.regions[0].id);
ok('连按方向键在 A 上 → 合并为 1 步', history.past.length === 2,
  'past.len=' + history.past.length);

/* 切到 B 再移动 → 必须是独立的一步（不吞掉 A 的步） */
const tx3 = history.beginOp();
project.regions[1].points[0].x += 1;
history.commitOp(tx3, '移动区域', 'nudge:' + project.regions[1].id);
ok('切到 B 再移动 → 产生新步骤', history.past.length === 3,
  'past.len=' + history.past.length);

/* 撤销一次 → 只回退 B 的那一步，A 保持 */
history.undo();
ok('撤销一次 → past 有 2 步（初始+A）', history.past.length === 2,
  'len=' + history.past.length);
ok('撤销一次 → A 位置 x=2', project.regions[0].points[0].x === 2,
  'A.x=' + project.regions[0].points[0].x);

/* 再撤销一次 → 回到初始空状态 */
history.undo();
ok('再撤销一次 → past 只有初始', history.past.length === 1,
  'len=' + history.past.length);
ok('再撤销一次 → S.regions 回到空', project.regions.length === 0,
  'len=' + project.regions.length);

/* 重做一次 → 回到 A(x=2) */
history.redo();
ok('重做一次 → A(x=2)', project.regions[0].points[0].x === 2,
  'A.x=' + project.regions[0].points[0].x);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
