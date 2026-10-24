/* 验证「合并键按区域隔离 + 撤销后闪高亮」。
   逻辑来自 src/core/editing.ts + src/core/history.ts。
   用法：node test_undo_granularity.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else    { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); }
};

const project = A.createProject();
project.canvas = { w: 1920, h: 1080 };

const history = new A.History({
  getSnapshot: () => ({ regions: project.regions, seq: project.seq }),
  applySnapshot: (snap) => {
    project.regions = snap.regions.map(r => ({
      ...r, points: r.points.map(p => ({ x: p.x, y: p.y })),
    }));
    project.seq = snap.seq;
  },
});

function addR(name, x0, y0, x1, y1) {
  const tx = history.beginOp();
  A.addRegion(project, {
    name, type: 'occlusion', target: 'both', shape: 'rect',
    points: [{ x: x0, y: y0 }, { x: x1, y: y1 }],
  });
  history.commitOp(tx, '新增 ' + name);
}

/* ───────── 1. 初始：空工程 + 两个区域 ───────── */
history.reset('初始');
addR('A', 100, 100, 200, 200);
addR('B', 300, 300, 400, 400);
const A_id = project.regions[0].id;
const B_id = project.regions[1].id;
const ax = () => project.regions[0].points[0].x;
const bx = () => project.regions[1].points[0].x;

console.log('\n=== 1. 历史基线 ===');
ok('空 → +A → +B：past 长度 = 3（初始 + 两步新增）',
   history.past.length === 3, `past=${history.past.length}`);

/* ───────── 2. 合并键按区域隔离 ───────── */
console.log('\n=== 2. 合并键按区域隔离（连按不跨区域） ===');
const pastBefore = history.past.length;
A.moveRegionStep(history, project, A_id, 1, 0);
A.moveRegionStep(history, project, A_id, 1, 0);
A.moveRegionStep(history, project, A_id, 1, 0);
ok('连按 3 次只在 A 上：合并 → 只 +1 步',
   history.past.length === pastBefore + 1, `past ${pastBefore} -> ${history.past.length}`);
ok('A.x = 103', ax() === 103, `A.x=${ax()}`);

A.moveRegionStep(history, project, B_id, 1, 0);
ok('切到 B 再按：merge key 不同 → 新增 1 步',
   history.past.length === pastBefore + 2, `past=${history.past.length}`);
ok('B.x = 301', bx() === 301, `B.x=${bx()}`);

/* ───────── 3. 撤销：单步回退 ───────── */
console.log('\n=== 3. 撤销：B 一步退回；A 仍在 +3 ===');
const undoB = history.undo();
ok('undo 返回描述', !!undoB && /移动/.test(undoB.label), 'label=' + (undoB && undoB.label));
ok('撤销 1 步 → B 回到 300', bx() === 300, `B.x=${bx()}`);
ok('撤销 1 步 → A 仍在 103（A 的一步还没退）',
   ax() === 103, `A.x=${ax()}`);

const undoA = history.undo();
ok('再撤销 1 步 → A 回到 100', ax() === 100, `A.x=${ax()}`);
ok('再撤销后 B 仍是 300（不受波及）', bx() === 300, `B.x=${bx()}`);
ok('flashAffected 指向退步最大的 A',
   A.flashAffected(undoA.before.regions, undoA.after.regions) === A_id);

/* ───────── 4. 闪高亮：仅指向真正变化的区域 ───────── */
console.log('\n=== 4. flashAffected 闪高亮目标 ===');
ok('撤销 B 时 flash 指向 B',
   A.flashAffected(undoB.before.regions, undoB.after.regions) === B_id);

/* ───────── 5. 重做 + 新操作清空 redo ───────── */
console.log('\n=== 5. redo 与新建操作清空 redo ===');
const pastLen = history.past.length;
history.redo();
history.redo();
ok('两次 redo 后 past 长度恢复', history.past.length === pastLen + 2);
ok('redo 后 B 回到 301', bx() === 301, `B.x=${bx()}`);
ok('redo 后 A 回到 103', ax() === 103, `A.x=${ax()}`);

A.moveRegionStep(history, project, A_id, 1, 0);
ok('新建操作后 future 栈清空', history.future.length === 0, `future=${history.future.length}`);

/* ───────── 6. 删除 + 撤销恢复 + 闪指向被恢复对象 ───────── */
console.log('\n=== 6. 撤销删除 → 闪指向被恢复对象 ===');
const delTx = history.beginOp();
A.removeRegion(project, B_id);
history.commitOp(delTx, '删除 B');
ok('删除 B 后只剩 A', project.regions.length === 1, `n=${project.regions.length}`);
ok('删除后 future 清空', history.future.length === 0);

const undoDel = history.undo();
ok('撤销删除 → B 回来了', project.regions.some(r => r.id === B_id));
ok('撤销删除时 flash 指向恢复出来的 B',
   A.flashAffected(undoDel.before.regions, undoDel.after.regions) === B_id);

/* ───────── 7. Shift 加速也走同一合并键 ───────── */
console.log('\n=== 7. Shift + 方向键 同样合并 ===');
history.reset('shift');
addR('S', 0, 0, 10, 10);
const sId = project.regions[0].id;
const p1 = history.past.length;
A.moveRegionStep(history, project, sId, 10, 0);
A.moveRegionStep(history, project, sId, 10, 0);
A.moveRegionStep(history, project, sId, 10, 0);
ok('Shift + 方向键 3 次合并 → 只新增 1 步',
   history.past.length === p1 + 1, `past ${p1} -> ${history.past.length}`);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
