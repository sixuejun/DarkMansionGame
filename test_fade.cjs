/* 前景淡化（fade）纯逻辑验证：
     1. globalAlpha 换算（fadeAlpha 是「保留多少」，destination-out 要取 1 − fadeAlpha）
     2. 迟滞（进入用外扩框、退出用原始框）
     3. clip 形状选择
     4. 多边形 fadePad 恒为 0
     用法：node test_fade.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else    { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); }
};

const rectFade = (over = {}) => ({
  id: 'f1', name: '门洞屋檐', type: 'fade', target: 'foreground',
  priority: 0, shape: 'rect',
  points: [{ x: 600, y: 300 }, { x: 760, y: 520 }],
  seq: 0, ...over,
});

console.log('\n=== 1. TYPES / TYPE_KEYS / TYPE_RANK ===');
ok('TYPES.fade 名称为「前景淡化区」', A.TYPES.fade.name === '前景淡化区');
ok('TYPES.fade 颜色为青色 #22d3ee', A.TYPES.fade.color === '#22d3ee');
ok('TYPES.fade 快捷键为 5', A.TYPES.fade.key === '5');
ok('TYPE_KEYS 含 fade 且排在末位', A.TYPE_KEYS.length === 5 && A.TYPE_KEYS[4] === 'fade',
   JSON.stringify(A.TYPE_KEYS));
ok('TYPE_RANK.fade 存在且大于 top', A.TYPE_RANK.fade > A.TYPE_RANK.top);
ok('TARGETS.foreground === 「前景层」', A.TARGETS.foreground === '前景层');

console.log('\n=== 2. destination-out 的 globalAlpha 换算（最容易写反的一段）===');
/* destination-out: αr = αd × (1 − αs)。方案表： */
const table = [
  /* fadeAlpha(保留), 期望 globalAlpha */
  [0, 1],
  [0.15, 0.85],
  [1, 0],
];
for (const [fa, want] of table) {
  const got = A.cutAlphaOf(rectFade({ fadeAlpha: fa }));
  ok(`fadeAlpha=${fa} → globalAlpha=${want}`, Math.abs(got - want) < 1e-9, `got=${got}`);
}
ok('缺省 fadeAlpha → 0（完全消失）', A.fadeAlphaOf(rectFade()) === 0);
ok('缺省 fadeAlpha → globalAlpha = 1', Math.abs(A.cutAlphaOf(rectFade()) - 1) < 1e-9);
ok('脏数据 fadeAlpha=5 被钳到 1', A.fadeAlphaOf(rectFade({ fadeAlpha: 5 })) === 1);
ok('脏数据 fadeAlpha=-2 被钳到 0', A.fadeAlphaOf(rectFade({ fadeAlpha: -2 })) === 0);

console.log('\n=== 3. clip 形状选择 ===');
ok('未设 clip 时用 points', A.fadeShapeOf(rectFade()).points.length === 2);
const clipShape = {
  shape: 'poly',
  points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }],
};
ok('设了 clip 后用 clip 的点', A.fadeShapeOf(rectFade({ clip: clipShape })).points.length === 3);
ok('设了 clip 后形状也换成 clip.shape', A.fadeShapeOf(rectFade({ clip: clipShape })).shape === 'poly');
ok('clip 点数不足时回退到 points', A.fadeShapeOf(rectFade({ clip: { shape: 'rect', points: [{x:0,y:0}] } })).points.length === 2);
ok('clip=null 时用 points', A.fadeShapeOf(rectFade({ clip: null })).points.length === 2);

console.log('\n=== 4. fadePad：矩形有默认值，多边形恒为 0 ===');
ok('矩形缺省 fadePad = 4', A.fadePadOf(rectFade()) === 4);
ok('矩形自定义 fadePad = 12', A.fadePadOf(rectFade({ fadePad: 12 })) === 12);
ok('多边形 fadePad 恒为 0（不做多边形偏移）',
   A.fadePadOf(rectFade({ shape: 'poly', fadePad: 12 })) === 0);
ok('fadePad 脏数据 -5 被钳到 0', A.fadePadOf(rectFade({ fadePad: -5 })) === 0);

console.log('\n=== 5. expandBounds ===');
const eb = A.expandBounds({ x: 10, y: 20, w: 100, h: 50 }, 4);
ok('外扩 4：x/y 各退 4', eb.x === 6 && eb.y === 16);
ok('外扩 4：w/h 各加 8', eb.w === 108 && eb.h === 58, JSON.stringify(eb));
const eb0 = A.expandBounds({ x: 10, y: 20, w: 100, h: 50 }, 0);
ok('pad=0 原样返回', eb0.x === 10 && eb0.y === 20 && eb0.w === 100 && eb0.h === 50);

console.log('\n=== 6. 触发判定用「外扩 fadePad 的框」 ===');
function mkProj(regions, cx, cy) {
  return {
    name: 't', canvas: { w: 1536, h: 1024 },
    layers: { background: {}, objects: {}, foreground: {} },
    regions, seq: 0,
    char: { x: cx, y: cy, w: 36, h: 56, speed: 5,
            ghostAlpha: 0.35, anchorX: 0.5, anchorY: 1, boxW: 14, boxH: 8 },
  };
}
/* 框 x∈[600,760]，pad=40 → 判定用外扩框 x∈[560,800]。
   脚底碰撞箱 14 宽，以锚点为中心：锚点 590 → 盒 [583,597]。 */

A.resetFadeState();
/* 盒 [583,597] 与原框 [600,760] 不重叠，但落在外扩框 [560,800] 内 */
let proj = mkProj([rectFade({ fadePad: 40 })], 590, 400);
ok('踩到外扩框就已命中（此时脚底还没碰到原框）',
   A.updateFadeTargets(proj).length === 1);

/* 继续往外走，直到离开外扩框才退出 */
proj.char.x = 550                       /* 盒 [543,557]，已在外扩框 560 之外 */
ok('走出外扩框后退出淡化', A.updateFadeTargets(proj).length === 0);
ok('activeFade 已清空', A.activeFade.size === 0, `size=${A.activeFade.size}`);

A.resetFadeState();
/* 默认 pad=4：原框 x∈[600,760] → 外扩 [596,764] */
proj = mkProj([rectFade()], 593, 400);   /* 盒 [586,600] */
ok('默认 pad=4 时，正好停在原框外 7px 也命中（判定确实用了外扩框）',
   A.updateFadeTargets(proj).length === 1);

console.log('\n=== 7. 角色站在框边界上，前景不闪烁 ===');
/* 关键：判定用的是外扩框，制作者实际画的框边界落在带子内部，
   所以「站在框边上」是一个离阈值很远的位置，状态不会来回翻。 */
A.resetFadeState();
for (const standX of [593, 594, 596, 600, 610, 655, 700]) {
  const p = mkProj([rectFade()], standX, 400)
  A.resetFadeState()
  let flips = 0
  let prev = A.updateFadeTargets(p).length > 0
  for (let i = 0; i < 100; i++) {
    const now = A.updateFadeTargets(p).length > 0
    if (now !== prev) flips++
    prev = now
  }
  ok(`锚点 x=${standX} 处反复判定 100 次，0 次翻转`, flips === 0, `flips=${flips}`);
}
/* 走到外扩框边缘以外则保持不命中，同样稳定 */
A.resetFadeState();
const far = mkProj([rectFade()], 400, 400)
let farFlips = 0
let farPrev = A.updateFadeTargets(far).length > 0
for (let i = 0; i < 100; i++) {
  const now = A.updateFadeTargets(far).length > 0
  if (now !== farPrev) farFlips++
  farPrev = now
}
ok('框外远处反复判定 100 次，0 次翻转', farFlips === 0, `flips=${farFlips}`);

/* 从框外一路走进外扩框，途中只发生 1 次进入，不来回翻 */
A.resetFadeState();
const walkIn = mkProj([rectFade()], 500, 400)
let inTransitions = 0
let inLast = A.updateFadeTargets(walkIn).length > 0
for (let x = 500; x <= 760; x += 1) {
  walkIn.char.x = x
  const now = A.updateFadeTargets(walkIn).length > 0
  if (now !== inLast) inTransitions++
  inLast = now
}
ok('从 x=500 走到 760（始终没出外扩框）只发生 1 次进入', inTransitions === 1, `transitions=${inTransitions}`);
ok('走到 760 时仍处于淡化中', inLast === true);

/* 继续走到 800，此时已走出外扩框 → 第 2 次翻转是退出，不是抖动 */
A.resetFadeState();
const walk = mkProj([rectFade()], 500, 400)
let transitions = 0
let last = A.updateFadeTargets(walk).length > 0
for (let x = 500; x <= 800; x += 1) {
  walk.char.x = x
  const now = A.updateFadeTargets(walk).length > 0
  if (now !== last) transitions++
  last = now
}
ok('从左到右走 300px 恰好 2 次翻转（进一次 + 出一次，无抖动）',
   transitions === 2, `transitions=${transitions}`);

console.log('\n=== 8. 迟滞状态清理：区域被删后不留残影 ===');
A.resetFadeState();
const p2 = mkProj([rectFade()], 650, 400)
ok('先命中一次', A.updateFadeTargets(p2).length === 1)
ok('activeFade 里有 1 个 id', A.activeFade.size === 1)
p2.regions = []                       /* 模拟区域被删除 */
ok('区域删掉后不再命中', A.updateFadeTargets(p2).length === 0)
ok('activeFade 被清空（不残留状态）', A.activeFade.size === 0, `size=${A.activeFade.size}`);

console.log('\n=== 9. 多区域同时命中，互不影响 ===');
A.resetFadeState();
const two = [
  rectFade({ id: 'fa' }),
  rectFade({ id: 'fb', points: [{ x: 700, y: 300 }, { x: 900, y: 520 }], fadeAlpha: 0.2 }),
  { ...rectFade({ id: 'fc' }), type: 'occlusion', target: 'objects' },   /* 非 fade，不参与 */
];
/* 锚点 x=730 同时落在 fa[600,760] 与 fb[700,900] 内 */
const p3 = mkProj(two, 730, 400)
const hit3 = A.updateFadeTargets(p3)
ok('同时命中两个淡化区', hit3.length === 2, `len=${hit3.length}`)
ok('两个区各自的 fadeAlpha 保持独立（0 与 0.2）',
   A.fadeAlphaOf(hit3.find(r => r.id === 'fa')) === 0 &&
   A.fadeAlphaOf(hit3.find(r => r.id === 'fb')) === 0.2)
ok('非 fade 区域（occlusion）不进入淡化列表',
   !hit3.some(r => r.id === 'fc'))

console.log('\n=== 10. fadeRegions 只挑 fade ===');
ok('fadeRegions 返回 2 个', A.fadeRegions(p3).length === 2)
ok('fadeRegions 全部 type==="fade"', A.fadeRegions(p3).every(r => r.type === 'fade'))

console.log('\n=== 11. createProject / addRegion 的默认值 ===');
const fresh = A.createProject()
ok('新工程三层齐备',
   !!fresh.layers.background && !!fresh.layers.objects && !!fresh.layers.foreground)
const added = A.addRegion(fresh, {
  name: '淡出区', type: 'fade', target: 'both', shape: 'rect',
  points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
})
ok('fade 区域 target 被强制为 foreground', added.target === 'foreground', added.target)
ok('fade 区域 fadeAlpha 默认 0', added.fadeAlpha === 0)
ok('fade 区域 fadePad 默认 4', added.fadePad === 4)
ok('fade 区域 clip 默认 null', added.clip === null)

console.log('\n--- ' + pass + ' passed, ' + fail + ' failed ---');
process.exit(fail ? 1 : 0);