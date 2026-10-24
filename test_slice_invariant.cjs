/* 真实浏览器渲染验证（用 Playwright 无关的方式：直接跑 node + canvas 替身）
   这一支只验证核心切片逻辑的「像素守恒」性质，已由 test_white_layer.cjs 覆盖。
   这里补一条：验证「同一像素不会被画两次」这条不变量在各种组合下都成立。 */
const { load } = require('./tests/load.cjs');
const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); }
};

const W = 60, H = 60;

/* ---- canvas 替身 ---- */
function fakeCanvas() {
  const c = { width: W, height: H, _data: new Uint8Array(W * H * 4) };
  c.getContext = function () {
    if (this._ctx) return this._ctx;
    const data = this._data;
    let comp = 'source-over';
    const ctx = {
      _alpha: 1, fillStyle: '#fff',
      get globalAlpha() { return ctx._alpha; },
      set globalAlpha(v) { ctx._alpha = v; },
      get globalCompositeOperation() { return comp; },
      set globalCompositeOperation(v) { comp = v; },
      beginPath() { ctx._path = []; },
      moveTo() {}, lineTo() {}, closePath() {},
      rect(x, y, w, h) { (ctx._path = ctx._path || []).push({ op: 'r', x, y, w, h }); },
      fill() {
        if (ctx.fillStyle !== '#fff') return;
        for (const p of ctx._path || []) {
          if (p.op !== 'r') continue;
          for (let yy = Math.round(p.y); yy < Math.round(p.y + p.h); yy++)
            for (let xx = Math.round(p.x); xx < Math.round(p.x + p.w); xx++) {
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              data[(yy * W + xx) * 4 + 3] = 255;
            }
        }
      },
      drawImage(src, dx, dy, dw, dh) {
        const sw = dw === undefined ? W : dw, sh = dh === undefined ? H : dh;
        const sdata = src.__data || src._data;
        if (!sdata) return;
        for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
          const tx = Math.round((dx || 0) + x), ty = Math.round((dy || 0) + y);
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          const sa = sdata[(y * W + x) * 4 + 3];
          const ti = (ty * W + tx) * 4, ta = data[ti + 3];
          if (comp === 'destination-in') { data[ti + 3] = Math.round((ta * sa) / 255); continue; }
          if (!sa) continue;
          if (comp === 'destination-out') data[ti + 3] = Math.round((ta * (255 - sa)) / 255);
          else {
            const srcA = sa * ctx._alpha;
            data[ti + 3] = Math.round((ta * 255 + srcA * (255 - ta)) / 255);
          }
        }
      },
    };
    this._ctx = ctx;
    return ctx;
  };
  Object.defineProperty(c, '__data', { get() { return this._data; } });
  return c;
}
global.document = { createElement: () => fakeCanvas() };

const mkLayer = (rects) => {
  const d = new Uint8Array(W * H * 4);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = (y * W + x) * 4; d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
  }
  return { __data: d, src: 'fake' };
};
const rect = (id, type, target, x, y, w, h) => ({
  id, name: id, type, target, priority: 0, shape: 'rect',
  points: [{ x, y }, { x: x + w, y: y + h }], seq: 0,
});
function project(regions) {
  const p = A.createProject();
  p.canvas = { w: W, h: H };
  p.layers.background = { img: mkLayer([{ x: 0, y: 0, w: 40, h: 40 }]), w: W, h: H, visible: true, locked: false, opacity: 1 };
  p.layers.objects = { img: mkLayer([{ x: 0, y: 0, w: 40, h: 40 }]), w: W, h: H, visible: true, locked: false, opacity: 1 };
  p.layers.foreground = { img: null, w: 0, h: 0, visible: true, locked: false, opacity: 1 };
  p.regions = regions;
  return p;
}
/** 把各段按「绘制顺序」叠起来，看最终每个像素被画了几次 */
function countCoverage(slices) {
  /* 用一张单独的 canvas 按顺序叠画，统计最终不透明像素数；
     同时统计各段之和，与最终结果比较 —— 相等说明没有重叠也没有丢失。 */
  const order = ['below', 'above', 'top'];
  const segs = order.map(k => slices[k]).filter(Boolean);
  const sum = segs.reduce((acc, s) => {
    const d = s.__data || s._data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return acc + n;
  }, 0);

  const cv = fakeCanvas();
  const ctx = cv.getContext('2d');
  for (const s of segs) ctx.drawImage(s, 0, 0, W, H);
  let drawn = 0;
  for (let i = 3; i < cv._data.length; i += 4) if (cv._data[i] > 0) drawn++;
  return { sum, drawn };
}

console.log('\n=== 各组合下「像素守恒」检查（各段之和 == 叠画后的结果）===');
const cases = [
  { name: '无任何区域', regions: [], occ: null },
  { name: '仅 top(白层)', regions: [rect('t', 'top', 'background', 5, 5, 10, 10)], occ: null },
  { name: '仅 top(黑层)', regions: [rect('t', 'top', 'objects', 5, 5, 10, 10)], occ: null },
  { name: '仅紫区(白层)', regions: [rect('o', 'occlusion', 'background', 10, 10, 10, 10)], occ: 'o' },
  { name: '仅紫区(黑层)', regions: [rect('o', 'occlusion', 'objects', 10, 10, 10, 10)], occ: 'o' },
  { name: '紫区(两者)', regions: [rect('o', 'occlusion', 'both', 10, 10, 10, 10)], occ: 'o' },
  { name: '仅黄区(黑层)', regions: [rect('a', 'adjust', 'objects', 10, 10, 10, 10)], occ: null },
  {
    name: 'top + 紫区 + 黄区 全都有',
    regions: [
      rect('t', 'top', 'background', 0, 0, 8, 8),
      rect('o', 'occlusion', 'both', 10, 10, 12, 12),
      rect('a', 'adjust', 'objects', 20, 20, 8, 8),
    ],
    occ: 'o',
  },
  {
    name: 'top(两者) + 紫区(两者)',
    regions: [
      rect('t', 'top', 'both', 0, 0, 6, 6),
      rect('o', 'occlusion', 'both', 10, 10, 12, 12),
    ],
    occ: 'o',
  },
];

for (const layer of ['background', 'objects']) {
  for (const c of cases) {
    const p = project(c.regions);
    const active = c.occ ? p.regions.find(r => r.id === c.occ) : null;
    const s = A.layerSlices(p, layer, active);
    const { sum, drawn } = countCoverage(s);
    ok(`[${layer}] ${c.name}: 各段之和 == 叠画结果（无重叠、无丢失）`,
       sum === drawn, `sum=${sum} drawn=${drawn}`);
  }
}

console.log('\n=== 白层在「有紫区」时确实有一部分被提到角色上方 ===');
{
  const p = project([rect('o', 'occlusion', 'background', 10, 10, 12, 12)]);
  const s = A.layerSlices(p, 'background', p.regions[0]);
  const above = s.above;
  const d = above.__data || above._data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  ok('白层 above 段非空（白层能当遮挡物了）', n > 0, 'n=' + n);
  ok('白层 above 段正好是紫区大小（12x12=144）', n === 144, 'n=' + n);
}

console.log('\n=== 白层在「无紫区」时没有 above 段（保持默认在角色下方）===');
{
  const p = project([]);
  const s = A.layerSlices(p, 'background', null);
  ok('白层 above 为 null', !s.above);
  ok('白层 below 非空', !!(s.below && (s.below.__data || s.below._data)));
}

console.log('\n--- ' + pass + ' passed, ' + fail + ' failed ---');
process.exit(fail ? 1 : 0);
