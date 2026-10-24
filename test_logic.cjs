/* 验证几何与交互逻辑（手柄 / 矩形拖角 / 命中判定 / 优先级裁决 / 方向键微调）。
   逻辑全部来自 src/core/（纯 TypeScript，无 DOM 依赖）。
   用法：node test_logic.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

/* ---- 断言 ---- */
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/* ---- 一个纯 JS 的工程状态（相当于编辑器里的 project） ---- */
const project = A.createProject();
project.canvas = { w: 1920, h: 1080 };

const add = (data) =>
  A.addRegion(project, Object.assign({
    name: 'A', type: 'occlusion', target: 'both', shape: 'rect',
    points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
  }, data));

console.log('\n=== 1. 工具与常量 ===');
ok('存在选择 / 矩形 / 多边形 / 自由 / 删除 / 平移 6 种工具',
  ['select', 'rect', 'poly', 'free', 'erase', 'pan'].every(t => A.TOOLS[t]),
  Object.keys(A.TOOLS).join(','));
ok('五种区域类型齐全（top/collision/occlusion/adjust/fade）',
   A.TYPE_KEYS.length === 5 && A.TYPE_KEYS.every(t => !!A.TYPES[t]),
   A.TYPE_KEYS.join(','));
ok('五种类型都有唯一快捷键',
   new Set(A.TYPE_KEYS.map(t => A.TYPES[t].key)).size === 5,
   A.TYPE_KEYS.map(t => A.TYPES[t].key).join(','));
ok('五种类型都有唯一颜色',
   new Set(A.TYPE_KEYS.map(t => A.TYPES[t].color)).size === 5,
   A.TYPE_KEYS.map(t => A.TYPES[t].color).join(','));

console.log('\n=== 2. 矩形 4 个角都是手柄 ===');
const R = add({ name: 'R', points: [{ x: 100, y: 50 }, { x: 300, y: 200 }] });
const hs = A.handles(R);
ok('矩形返回 4 个手柄', hs.length === 4, 'len=' + hs.length);
ok('手柄 corner 齐全', ['tl', 'tr', 'br', 'bl'].every(c => hs.some(h => h.corner === c)),
  JSON.stringify(hs.map(h => h.corner)));
ok('左上手柄坐标正确', near(hs[0].x, 100) && near(hs[0].y, 50));
ok('右下手柄坐标正确', near(hs[2].x, 300) && near(hs[2].y, 200));

console.log('\n=== 3. 拖矩形四角 ===');
/* 拖右上角 (tr)：应交叉写 points[1].x 与 points[0].y */
A.applyHandle(R, hs[1], 400, 20, 1920, 1080);
ok('拖右上：右下.x 跟随 400', near(R.points[1].x, 400), 'got ' + R.points[1].x);
ok('拖右上：左上.y 跟随 20', near(R.points[0].y, 20), 'got ' + R.points[0].y);
ok('拖右上后仍是矩形', near(R.points[0].x, 100) && near(R.points[1].y, 200));

/* 拖过对边 → 应交换而不是翻转 */
A.applyHandle(R, { x: 0, y: 0, idx: 0, corner: 'tl' }, 600, 500, 1920, 1080);
ok('拖过对边后 x0<x1 仍成立', R.points[0].x < R.points[1].x,
  `${R.points[0].x} vs ${R.points[1].x}`);
ok('拖过对边后 y0<y1 仍成立', R.points[0].y < R.points[1].y,
  `${R.points[0].y} vs ${R.points[1].y}`);

console.log('\n=== 4. 多边形顶点 ===');
R.shape = 'poly';
R.points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
const phs = A.handles(R);
ok('多边形 3 个手柄', phs.length === 3, 'len=' + phs.length);
ok('多边形手柄无 corner', phs.every(h => h.corner === null));
ok('命中第 1 个顶点', A.handleAt({ x: 100, y: 0 }, R, 5) === 1);
A.applyHandle(R, phs[1], 150, 40, 1920, 1080);
ok('拖顶点只改该点', near(R.points[1].x, 150) && near(R.points[1].y, 40));
ok('相邻顶点未被牵连', near(R.points[0].x, 0) && near(R.points[2].x, 100));

console.log('\n=== 5. handleAnywhere 跨区域命中 ===');
project.regions = [];
const P1 = add({ name: 'P1', type: 'top', points: [{ x: 0, y: 0 }, { x: 40, y: 40 }] });
const P2 = add({ name: 'P2', type: 'top', points: [{ x: 500, y: 500 }, { x: 600, y: 600 }] });
const f = A.handleAnywhere({ x: 600, y: 600 }, project.regions, null, 9);
ok('未选中时也能命中别的区域的角', !!f, 'null');
ok('命中的是 P2', f && f.region.name === 'P2', f && f.region.name);
const f2 = A.handleAnywhere({ x: 0, y: 0 }, project.regions, P2.id, 9);
ok('选中区域优先命中', f2 && f2.region.id === P1.id, f2 && f2.region.name);

console.log('\n=== 6. 命中判定 ===');
ok('矩形区域命中内部点', A.regionAt({ x: 10, y: 10 }, project.regions).id === P1.id);
ok('矩形区域不命中外部点', A.regionAt({ x: 100, y: 100 }, project.regions) === null);
const poly = add({
  name: 'Poly', type: 'occlusion', shape: 'poly',
  points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
});
ok('多边形命中内部点', A.regionAt({ x: 50, y: 50 }, project.regions).id === poly.id);
ok('多边形不命中外部点', A.regionAt({ x: 150, y: 50 }, project.regions) === null);
ok('regionHitRect 命中', A.regionHitRect(poly, { x: 10, y: 10, w: 10, h: 10 }));
ok('regionHitRect 不命中', !A.regionHitRect(poly, { x: 200, y: 200, w: 10, h: 10 }));
ok('vertexAt 命中第 2 个顶点', A.vertexAt({ x: 100, y: 0 }, poly, 5) === 1);
ok('edgeAt 命中第 0 条边', A.edgeAt({ x: 50, y: 0 }, poly, 5) === 0);

console.log('\n=== 7. 优先级裁决 ===');
project.regions = [];
add({ name: 'c', type: 'collision', target: 'background', priority: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
add({ name: 't', type: 'top', target: 'objects', priority: 5, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
const sorted = A.sortByPriority(project.regions);
ok('高优先级排最后（后绘制/后生效）', sorted[sorted.length - 1].name === 't',
  sorted.map(r => r.name).join(','));

/* 同优先级 → 按类型裁决：最上层 > 遮挡层 > 调节层 > 碰撞层 */
project.regions = [];
add({ name: 'c', type: 'collision', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
add({ name: 'a', type: 'adjust', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
add({ name: 'o', type: 'occlusion', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
add({ name: 't', type: 'top', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
const sorted2 = A.sortByPriority(project.regions);
ok('同优先级按类型裁决：top 最先生效',
  sorted2.map(r => r.name).join(',') === 'c,a,o,t', sorted2.map(r => r.name).join(','));

console.log('\n=== 8. 方向键微移 nudgeRegion ===');
project.regions = [];
const N = add({ name: 'N', points: [{ x: 100, y: 100 }, { x: 200, y: 200 }] });
A.nudgeRegion(project, N.id, 1, 0, 1);
ok('右移 1px', near(N.points[0].x, 101) && near(N.points[1].x, 201),
  JSON.stringify(N.points));
A.nudgeRegion(project, N.id, 0, -1, 1);
ok('上移 1px', near(N.points[0].y, 99), 'y=' + N.points[0].y);
A.nudgeRegion(project, N.id, -1, 0, 1);
ok('左移 1px', near(N.points[0].x, 100), 'x=' + N.points[0].x);
A.nudgeRegion(project, N.id, 0, 1, 1);
ok('下移 1px', near(N.points[0].y, 100), 'y=' + N.points[0].y);

/* Shift = 10px */
A.nudgeRegion(project, N.id, 1, 0, 10);
ok('Shift+右移 = 10px', near(N.points[0].x, 110), 'x=' + N.points[0].x);

/* 越界钳制 */
N.points = [{ x: 5, y: 5 }, { x: 20, y: 20 }];
A.nudgeRegion(project, N.id, -1, 0, 1);
ok('不越出画布左边界', N.points[0].x >= 0, 'x=' + N.points[0].x);

console.log('\n=== 9. 矩形绘制约束 constrainRect ===');
const c1 = A.constrainRect({ x: 0, y: 0 }, { x: 10, y: 20 }, false, false);
ok('普通拖拽：宽高取绝对值', c1.w === 10 && c1.h === 20, JSON.stringify(c1));
const c2 = A.constrainRect({ x: 0, y: 0 }, { x: 10, y: 20 }, true, false);
ok('Shift：正方形', c2.w === c2.h && c2.w === 20, JSON.stringify(c2));
const c3 = A.constrainRect({ x: 0, y: 0 }, { x: 10, y: 20 }, false, true);
ok('Alt：中心向外', c3.w === 20 && c3.h === 40 && c3.x === -10, JSON.stringify(c3));

console.log('\n=== 10. 自由绘制抽稀 simplify ===');
const line = [];
for (let i = 0; i <= 100; i++) line.push({ x: i, y: 0 });
const simplified = A.simplify(line, 3);
ok('共线轨迹被抽稀到 2 个点', simplified.length === 2, 'len=' + simplified.length);
ok('抽稀保留首尾', near(simplified[0].x, 0) && near(simplified[1].x, 100));

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
