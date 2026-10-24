/* 白层参与「最上层 / 遮挡层」的切片验证（像素级）：
     1. top 区域作用在白层时，白层像素确实被提到最顶
     2. 紫区作用在白层时，紫区内的白层像素被提到角色上方
     3. 白层与黑层互不串层（target 精确匹配）
     4. 各段互不重叠（同一像素不会被画两次）
     5. 无 top / 无紫区时白层仍在角色下方（不回归）
   用法：node test_white_layer.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else    { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); }
};

/* ------------------------------------------------------------------ */
/* 最小 canvas 替身：够用来跑蒙版运算                                 */
/* ------------------------------------------------------------------ */
const W = 40, H = 40;

function fakeCanvas() {
  const c = { width: W, height: H, _data: new Uint8Array(W * H * 4) };
  c.getContext = function () {
    if (this._ctx) return this._ctx;
    const data = this._data;
    let comp = 'source-over';
    const ctx = {
      _alpha: 1,
      fillStyle: '#fff',
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
          for (let yy = Math.round(p.y); yy < Math.round(p.y + p.h); yy++) {
            for (let xx = Math.round(p.x); xx < Math.round(p.x + p.w); xx++) {
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              data[(yy * W + xx) * 4 + 3] = 255;
            }
          }
        }
      },
      drawImage(src, dx, dy, dw, dh) {
        const sw = dw === undefined ? W : dw;
        const sh = dh === undefined ? H : dh;
        const sdata = src.__data || src._data;
        if (!sdata) return;
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            const tx = Math.round((dx || 0) + x);
            const ty = Math.round((dy || 0) + y);
            if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
            const sa = sdata[(y * W + x) * 4 + 3];
            const ti = (ty * W + tx) * 4;
            const ta = data[ti + 3];
            if (comp === 'destination-in') {
              /* 源透明 → 目标必须清零（destination-in 的关键语义） */
              data[ti + 3] = Math.round((ta * sa) / 255);
              continue;
            }
            if (!sa) continue;
            if (comp === 'destination-out') {
              data[ti + 3] = Math.round((ta * (255 - sa)) / 255);
            } else {
              /* source-over：srcA = sa × globalAlpha，
                 结果 = ta + srcA×(1 − ta) */
              const srcA = sa * ctx._alpha;
              data[ti + 3] = Math.round((ta * 255 + srcA * (255 - ta)) / 255);
            }
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

/** 造一张「指定矩形不透明」的假图层 */
function makeLayer(rects) {
  const d = new Uint8Array(W * H * 4);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
      }
    }
  }
  return { __data: d, src: 'fake', naturalWidth: W, naturalHeight: H };
}

/** 统计某段里非透明像素的数量与包围盒 */
function stat(seg) {
  if (!seg) return { n: 0 };
  const d = seg.__data || seg._data;
  if (!d) return { n: -1 };
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 0) {
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { n, x0, y0, x1, y1 };
}

const rect = (id, type, target, x, y, w, h) => ({
  id, name: id, type, target, priority: 0, shape: 'rect',
  points: [{ x, y }, { x: x + w, y: y + h }], seq: 0,
});

function makeProject(regions, bgRects, obRects) {
  const p = A.createProject();
  p.canvas = { w: W, h: H };
  p.layers.background = { img: makeLayer(bgRects), w: W, h: H, visible: true, locked: false, opacity: 1 };
  p.layers.objects = { img: makeLayer(obRects || []), w: W, h: H, visible: true, locked: false, opacity: 1 };
  p.layers.foreground = { img: null, w: 0, h: 0, visible: true, locked: false, opacity: 1 };
  p.regions = regions;
  return p;
}

console.log('\n=== 1. top 区域作用在白层：白层像素被提到最顶 ===');
{
  const p = makeProject(
    [rect('t1', 'top', 'background', 0, 0, 10, 10)],
    [{ x: 0, y: 0, w: 10, h: 10 }],
    [{ x: 20, y: 20, w: 10, h: 10 }],
  );
  const s = A.layerSlices(p, 'background', null);
  ok('白层 top 段存在', !!s.top);
  ok('白层 top 段有像素（100）', stat(s.top).n === 100, 'n=' + stat(s.top).n);
  ok('白层 below 段不含 top 区域（不重复画）',
     stat(s.below).n === 0 || stat(s.below).x0 >= 10, JSON.stringify(stat(s.below)));
}

console.log('\n=== 2. top 区域作用在黑层时，白层不受影响 ===');
{
  const p = makeProject(
    [rect('t1', 'top', 'objects', 0, 0, 10, 10)],
    [{ x: 0, y: 0, w: 10, h: 10 }],
    [{ x: 0, y: 0, w: 10, h: 10 }],
  );
  const sb = A.layerSlices(p, 'background', null);
  const so = A.layerSlices(p, 'objects', null);
  ok('白层 top 段为空（target 不含 background）', !sb.top || stat(sb.top).n === 0);
  ok('黑层 top 段有像素（100）', stat(so.top).n === 100, 'n=' + stat(so.top).n);
  ok('白层 below 仍是完整白层', stat(sb.below).n === 100, 'n=' + stat(sb.below).n);
}

console.log('\n=== 3. 紫区作用在白层：紫区内的白层被提到角色上方 ===');
{
  const p = makeProject(
    [rect('o1', 'occlusion', 'background', 5, 5, 10, 10)],
    [{ x: 0, y: 0, w: 20, h: 20 }],
    [{ x: 30, y: 30, w: 5, h: 5 }],
  );
  const occ = p.regions[0];
  const s = A.layerSlices(p, 'background', occ);
  ok('白层 above 段存在', !!s.above);
  ok('白层 above 只含紫区内部（10x10=100 像素）',
     stat(s.above).n === 100, 'n=' + stat(s.above).n);
  ok('白层 above 的范围落在紫区内',
     stat(s.above).x0 === 5 && stat(s.above).y0 === 5, JSON.stringify(stat(s.above)));
  ok('白层 below 保留紫区外的内容（场景不缺块）',
     stat(s.below).n === 300, 'n=' + stat(s.below).n);
}

console.log('\n=== 4. 紫区作用在黑层时，白层不参与遮挡 ===');
{
  const p = makeProject(
    [rect('o1', 'occlusion', 'objects', 5, 5, 10, 10)],
    [{ x: 0, y: 0, w: 20, h: 20 }],
    [{ x: 0, y: 0, w: 20, h: 20 }],
  );
  const occ = p.regions[0];
  const sb = A.layerSlices(p, 'background', occ);
  ok('白层 above 为空（紫区只作用黑层）', !sb.above || stat(sb.above).n === 0);
  ok('白层 below 仍是完整白层', stat(sb.below).n === 400, 'n=' + stat(sb.below).n);
}

console.log('\n=== 5. 没有紫区 / 没有 top 时，白层仍在角色下方（不回归） ===');
{
  const p = makeProject([], [{ x: 0, y: 0, w: 20, h: 20 }], []);
  const s = A.layerSlices(p, 'background', null);
  ok('白层 above 为空', !s.above || stat(s.above).n === 0);
  ok('白层 below 是完整白层', stat(s.below).n === 400, 'n=' + stat(s.below).n);
  ok('白层 top 为空', !s.top || stat(s.top).n === 0);
}

console.log('\n=== 6. 黑层行为不变：紫区内无黄区时黑层仍完整遮挡 ===');
{
  const p = makeProject(
    [rect('o1', 'occlusion', 'both', 0, 0, 20, 20)],
    [], [{ x: 0, y: 0, w: 20, h: 20 }],
  );
  const s = A.layerSlices(p, 'objects', p.regions[0]);
  ok('黑层 below 为空（无黄区 → 不开洞）', stat(s.below).n === 0, 'n=' + stat(s.below).n);
  ok('黑层 above = 完整黑层', stat(s.above).n === 400, 'n=' + stat(s.above).n);
}

console.log('\n=== 7. 黑层黄区开洞仍然有效 ===');
{
  const p = makeProject(
    [rect('a1', 'adjust', 'objects', 5, 5, 10, 10)],
    [], [{ x: 0, y: 0, w: 20, h: 20 }],
  );
  const s = A.layerSlices(p, 'objects', null);
  ok('黑层 below = 黄区内像素（100）', stat(s.below).n === 100, 'n=' + stat(s.below).n);
  ok('黑层 above = 黄区外像素（300）', stat(s.above).n === 300, 'n=' + stat(s.above).n);
}

console.log('\n=== 8. top + 紫区同时存在时，白层各段互不重叠 ===');
{
  const p = makeProject(
    [
      rect('t1', 'top', 'background', 0, 0, 5, 5),
      rect('o1', 'occlusion', 'background', 10, 10, 10, 10),
    ],
    [{ x: 0, y: 0, w: 20, h: 20 }],
    [],
  );
  const occ = p.regions[1];
  const s = A.layerSlices(p, 'background', occ);
  const topN = stat(s.top).n;
  const aboveN = stat(s.above).n;
  const belowN = stat(s.below).n;
  ok('top 段 = 25 像素', topN === 25, 'n=' + topN);
  ok('above 段 = 100 像素（紫区内部，不含 top 区）', aboveN === 100, 'n=' + aboveN);
  ok('below 段 = 275 像素（400 − 25 top − 100 紫区）', belowN === 275, 'n=' + belowN);
  ok('三段加起来 = 原始白层像素数（不重复、不丢失）',
     topN + aboveN + belowN === 400, `${topN}+${aboveN}+${belowN}`);
}

console.log('\n=== 9. target=both 的紫区对两层都生效 ===');
{
  const p = makeProject(
    [rect('o1', 'occlusion', 'both', 5, 5, 10, 10)],
    [{ x: 0, y: 0, w: 20, h: 20 }],
    [{ x: 0, y: 0, w: 20, h: 20 }],
  );
  const occ = p.regions[0];
  const sb = A.layerSlices(p, 'background', occ);
  const so = A.layerSlices(p, 'objects', occ);
  ok('白层 above = 紫区内像素', stat(sb.above).n === 100, 'n=' + stat(sb.above).n);
  ok('黑层 above = 完整黑层（黑层由黄区控制，不受紫区影响）',
     stat(so.above).n === 400, 'n=' + stat(so.above).n);
}

console.log('\n=== 10. buildTopObjects 合并白层 + 黑层的 top 段 ===');
{
  const p = makeProject(
    [
      rect('t1', 'top', 'background', 0, 0, 10, 10),
      rect('t2', 'top', 'objects', 20, 20, 10, 10),
    ],
    [{ x: 0, y: 0, w: 10, h: 10 }],
    [{ x: 20, y: 20, w: 10, h: 10 }],
  );
  const top = A.buildTopObjects(p);
  ok('合并后的最上层存在', !!top);
  ok('合并后的最上层含两层像素（200）', stat(top).n === 200, 'n=' + stat(top).n);
  ok('最上层范围横跨白层与黑层两块',
     stat(top).x0 === 0 && stat(top).x1 === 29, JSON.stringify(stat(top)));
}

console.log('\n--- ' + pass + ' passed, ' + fail + ' failed ---');
process.exit(fail ? 1 : 0);
