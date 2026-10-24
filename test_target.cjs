/* 作用层级（RegionTarget）选择逻辑验证：
     1. 每种类型的合法层级列表 + 默认值与旧实现一致
     2. makePen / finishPen 按画笔锁定的层级产出草稿
     3. fade 强制前景层，画笔选了别的也无效
     4. 中途换层级不影响已在画的区域（锁定语义）
   用法：node test_target.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); }
};

const NO_SNAP = { enabled: false, step: 16 };
/** 屏幕像素 → 世界坐标（测试里恒等即可） */
const px = (n) => n;

console.log('\n=== 1. 每种类型的合法层级与默认值 ===');
/* 默认值必须与旧实现「碰撞→白层，其余→两者」完全一致，保证升级不改变导出 */
ok('碰撞层默认白层', A.TYPE_TARGETS.collision[0] === 'background');
ok('遮挡层默认两者', A.TYPE_TARGETS.occlusion[0] === 'both');
ok('调节层默认两者', A.TYPE_TARGETS.adjust[0] === 'both');
ok('最上层默认两者', A.TYPE_TARGETS.top[0] === 'both');
ok('淡化层默认前景层', A.TYPE_TARGETS.fade[0] === 'foreground');
ok('defaultTargetFor 与列表首项一致',
  ['top', 'collision', 'occlusion', 'adjust', 'fade']
    .every(t => A.defaultTargetFor(t) === A.TYPE_TARGETS[t][0]));

console.log('\n=== 2. 淡化区只有一项（面板上锁成只读 chip）===');
ok('淡化层只有前景层一个选项', A.TYPE_TARGETS.fade.length === 1);
ok('淡化层没有可选层级', A.hasTargetChoice('fade') === false);
ok('其余四类都有 >=2 个可选层级',
  ['top', 'collision', 'occlusion', 'adjust'].every(t => A.hasTargetChoice(t)));

console.log('\n=== 3. 面板列表里不会出现前景层（除 fade 外）===');
for (const t of ['top', 'collision', 'occlusion', 'adjust']) {
  ok(`${t} 的可选项不含前景层`, !A.TYPE_TARGETS[t].includes('foreground'));
}

console.log('\n=== 4. makePen 锁定画笔起始时的层级 ===');
const penObj = A.makePen('rect', { x: 0, y: 0 }, 'collision', 'objects', NO_SNAP);
ok('画笔记下开始时的目标', penObj.target === 'objects');
ok('画笔类型正确', penObj.type === 'collision');

console.log('\n=== 5. finishPen 产出草稿使用画笔上的层级 ===');
A.updatePen(penObj, { x: 200, y: 100 }, {
  canvas: { w: 1920, h: 1080 }, shift: false, alt: false, snap: NO_SNAP, px,
});
const r1 = A.finishPen(penObj, px);
ok('矩形草稿生成成功', r1.ok);
ok('草稿目标 = 画笔锁定的 objects', r1.draft.target === 'objects', r1.draft.target);
ok('草稿类型 = collision', r1.draft.type === 'collision');
ok('草稿形状 = rect', r1.draft.shape === 'rect');

/* 同样的起点与形状，只是层级不同 —— 结果必须跟着层级走 */
const penObj2 = A.makePen('rect', { x: 0, y: 0 }, 'collision', 'both', NO_SNAP);
A.updatePen(penObj2, { x: 200, y: 100 }, {
  canvas: { w: 1920, h: 1080 }, shift: false, alt: false, snap: NO_SNAP, px,
});
ok('换一个层级后草稿目标跟着变', A.finishPen(penObj2, px).draft.target === 'both');

console.log('\n=== 6. 旧默认行为不变：碰撞→白层 / 其余→两者 ===');
const legacy = [
  ['collision', 'background'],
  ['occlusion', 'both'],
  ['adjust', 'both'],
  ['top', 'both'],
];
for (const [type, want] of legacy) {
  const p = A.makePen('rect', { x: 10, y: 10 }, type, A.defaultTargetFor(type), NO_SNAP);
  A.updatePen(p, { x: 60, y: 60 }, {
    canvas: { w: 1920, h: 1080 }, shift: false, alt: false, snap: NO_SNAP, px,
  });
  const d = A.finishPen(p, px).draft;
  ok(`新建${type}默认目标仍为 ${want}`, d.target === want, d.target);
}

console.log('\n=== 7. fade 强制前景层：画笔选了别的也无效 ===');
const penFade = A.makePen('rect', { x: 0, y: 0 }, 'fade', 'both', NO_SNAP);
A.updatePen(penFade, { x: 120, y: 120 }, {
  canvas: { w: 1920, h: 1080 }, shift: false, alt: false, snap: NO_SNAP, px,
});
ok('淡化草稿目标被强制为 foreground',
  A.finishPen(penFade, px).draft.target === 'foreground');

/* addRegion 也要兜住：脏数据传 both 进来，落库仍是 foreground */
const proj = A.createProject();
const added = A.addRegion(proj, {
  name: '淡出', type: 'fade', target: 'both', shape: 'rect',
  points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
});
ok('addRegion 也把 fade 目标改成前景层', added.target === 'foreground');

console.log('\n=== 8. 多边形 / 自由绘制同样带层级 ===');
const poly = A.makePen('poly', { x: 0, y: 0 }, 'top', 'objects', NO_SNAP);
A.addPolyPoint(poly, { x: 100, y: 0 }, { w: 1920, h: 1080 }, NO_SNAP, px);
A.addPolyPoint(poly, { x: 100, y: 100 }, { w: 1920, h: 1080 }, NO_SNAP, px);
A.addPolyPoint(poly, { x: 0, y: 100 }, { w: 1920, h: 1080 }, NO_SNAP, px);
const pd = A.finishPen(poly, px).draft;
ok('多边形草稿目标 = objects', pd.target === 'objects', pd.target);
ok('多边形草稿形状 = poly', pd.shape === 'poly');
ok('多边形 3 个顶点', pd.points.length === 3);

const free = A.makePen('free', { x: 0, y: 0 }, 'adjust', 'objects', NO_SNAP);
free.raw = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }];
free.pts = A.simplify(free.raw, 3);
const fd = A.finishPen(free, px).draft;
ok('自由绘制草稿目标 = objects', fd.target === 'objects', fd.target);
ok('自由绘制草稿形状 = poly', fd.shape === 'poly');

console.log('\n=== 9. 草稿目标能原样落库 ===');
const proj2 = A.createProject();
const reg = A.addRegion(proj2, {
  name: '柱子', type: 'top', target: 'objects', shape: 'rect',
  points: [{ x: 0, y: 0 }, { x: 40, y: 40 }],
});
ok('目标原样保存', reg.target === 'objects');
ok('导出 map.json 保留目标',
  A.toMapJson(proj2).regions[0].target === 'objects');

console.log('\n=== 10. setRegionType 换类型后的目标合法性 ===');
/* 碰撞（background）→ 淡化：应强制前景层 */
A.setRegionType(proj2, reg.id, 'fade');
ok('换成淡化后目标自动变前景层', reg.target === 'foreground', reg.target);
/* 淡化 → 调节：「前景层」不再合法，应回到两者 */
A.setRegionType(proj2, reg.id, 'adjust');
ok('从淡化改回调节后不再残留前景层', reg.target === 'both', reg.target);
/* 目标必须落在该类型的合法集合内 */
ok('最终目标对当前类型合法',
  A.TYPE_TARGETS[reg.type].includes(reg.target),
  `${reg.type}/${reg.target}`);

console.log('\n=== 11. setRegionType：白层 → 调节层（白层非法）===');
const proj3 = A.createProject();
const onWhite = A.addRegion(proj3, {
  name: '碰撞', type: 'collision', target: 'background', shape: 'rect',
  points: [{ x: 0, y: 0 }, { x: 30, y: 30 }],
});
A.setRegionType(proj3, onWhite.id, 'adjust');
ok('白层不是调节层的合法目标，应被拉回默认',
  onWhite.target === 'both', onWhite.target);
ok('换类型后目标合法',
  A.TYPE_TARGETS.adjust.includes(onWhite.target), onWhite.target);

console.log('\n=== 12. setRegionTarget 拒绝非法层级 ===');
const proj4 = A.createProject();
const adjust = A.addRegion(proj4, {
  name: '黄', type: 'adjust', target: 'objects', shape: 'rect',
  points: [{ x: 0, y: 0 }, { x: 30, y: 30 }],
});
ok('调节层改成白层被拒绝', A.setRegionTarget(proj4, adjust.id, 'background') === false);
ok('目标未被改动', adjust.target === 'objects', adjust.target);
ok('调节层改成两者被接受', A.setRegionTarget(proj4, adjust.id, 'both') === true);
ok('目标已更新', adjust.target === 'both', adjust.target);

const fadeReg = A.addRegion(proj4, {
  name: '青', type: 'fade', target: 'foreground', shape: 'rect',
  points: [{ x: 40, y: 40 }, { x: 60, y: 60 }],
});
ok('淡化区改成白层被拒绝', A.setRegionTarget(proj4, fadeReg.id, 'background') === false);
ok('淡化区目标仍是前景层', fadeReg.target === 'foreground', fadeReg.target);

console.log('\n=== 13. 每条路径产出的区域目标都合法 ===');
/* 遍历「所有类型 × 所有目标」组合，确认 addRegion + setRegionType 之后仍合法 */
let illegal = [];
for (const type of ['top', 'collision', 'occlusion', 'adjust', 'fade']) {
  for (const tgt of ['background', 'objects', 'both', 'foreground']) {
    const p = A.createProject();
    const r = A.addRegion(p, {
      name: 'x', type, target: tgt, shape: 'rect',
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    });
    if (!A.TYPE_TARGETS[type].includes(r.target)) illegal.push(`add ${type}/${tgt} -> ${r.target}`);
    /* 再随机换成另一个类型 */
    const other = type === 'fade' ? 'collision' : 'fade';
    A.setRegionType(p, r.id, other);
    if (!A.TYPE_TARGETS[other].includes(r.target)) illegal.push(`swap -> ${other}/${r.target}`);
  }
}
ok('所有类型×目标组合都产出合法结果', illegal.length === 0, illegal.join(' | '));

console.log('\n--- ' + pass + ' passed, ' + fail + ' failed ---');
process.exit(fail ? 1 : 0);