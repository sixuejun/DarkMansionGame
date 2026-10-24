import type { Bounds, Handle, Point, Region } from '../types/map'
import { TYPE_RANK } from './constants'

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)

let idCounter = 0
/** 生成唯一 id（不依赖 crypto，测试环境可用） */
export const uid = (): string => 'r' + Date.now().toString(36) + (idCounter++).toString(36)

/** 区域的外接矩形 */
export function rectOfRegion(r: Region): Bounds {
  if (r.shape === 'rect') {
    const a = r.points[0]
    const b = r.points[1]
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    }
  }
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9
  for (const p of r.points) {
    x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y)
    x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** 射线法：点是否在多边形内 */
export function pointInPoly(px: number, py: number, pts: Point[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** 线段是否相交 */
export function segHit(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** 区域是否与矩形相交（用于角色碰撞/遮挡判定） */
export function regionHitRect(r: Region, rect: Bounds): boolean {
  if (r.shape === 'rect') {
    const b = rectOfRegion(r)
    return !(rect.x + rect.w <= b.x || rect.x >= b.x + b.w ||
             rect.y + rect.h <= b.y || rect.y >= b.y + b.h)
  }
  const p = r.points
  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ]
  for (const c of corners) if (pointInPoly(c.x, c.y, p)) return true
  for (const v of p) {
    if (v.x >= rect.x && v.x <= rect.x + rect.w && v.y >= rect.y && v.y <= rect.y + rect.h) return true
  }
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length]
    for (let k = 0; k < 4; k++) {
      if (segHit(a, b, corners[k], corners[(k + 1) % 4])) return true
    }
  }
  return false
}

/** 点到线段的距离 */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Ramer–Douglas–Peucker：自由绘制后抽稀顶点，避免上千个点 */
export function simplify(pts: Point[], eps: number): Point[] {
  if (pts.length < 3) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number]
    if (b <= a + 1) continue
    let maxD = -1, at = -1
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i].x, pts[i].y, pts[a].x, pts[a].y, pts[b].x, pts[b].y)
      if (d > maxD) { maxD = d; at = i }
    }
    if (maxD > eps && at >= 0) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** 区域排序：低优先级先绘制，高优先级覆盖 —— 结果与绘制顺序无关 */
export function sortByPriority(list: Region[]): Region[] {
  return list.slice().sort((a, b) =>
    (a.priority - b.priority) ||
    (TYPE_RANK[a.type] - TYPE_RANK[b.type]) ||
    (a.seq - b.seq),
  )
}

/** 可拖拽「手柄」列表。
 *  多边形：每个顶点一个手柄，idx 即顶点序号，corner 为 null。
 *  矩形：只存了两个点，但视觉上四角都要能拖，所以返回 4 个手柄。 */
export function handles(r: Region | null | undefined): Handle[] {
  if (!r) return []
  if (r.shape === 'rect' && r.points.length >= 2) {
    const a = r.points[0], b = r.points[1]
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x)
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
    return [
      { x: x0, y: y0, idx: 0, corner: 'tl' },
      { x: x1, y: y0, idx: 1, corner: 'tr' },
      { x: x1, y: y1, idx: 1, corner: 'br' },
      { x: x0, y: y1, idx: 0, corner: 'bl' },
    ]
  }
  return r.points.map((p, i) => ({ x: p.x, y: p.y, idx: i, corner: null }))
}

/** 把手柄拖到 (nx,ny)。矩形需交叉写回两个存储点并防止翻转。 */
export function applyHandle(
  r: Region,
  h: Handle,
  nx: number,
  ny: number,
  canvasW: number,
  canvasH: number,
): void {
  if (!h.corner) {
    r.points[h.idx] = { x: nx, y: ny }
    return
  }
  const a = r.points[0], b = r.points[1]
  let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y
  if (h.corner === 'tl') { x0 = nx; y0 = ny }
  else if (h.corner === 'tr') { x1 = nx; y0 = ny }
  else if (h.corner === 'br') { x1 = nx; y1 = ny }
  else if (h.corner === 'bl') { x0 = nx; y1 = ny }
  /* 拖过对边时交换，让矩形跟着鼠标走而不是翻转 */
  if (x0 > x1) { const t = x0; x0 = x1; x1 = t }
  if (y0 > y1) { const t = y0; y0 = y1; y1 = t }
  r.points[0] = { x: clamp(x0, 0, canvasW), y: clamp(y0, 0, canvasH) }
  r.points[1] = { x: clamp(x1, 0, canvasW), y: clamp(y1, 0, canvasH) }
}

/** 指定区域内命中第几个手柄（-1 表示没命中） */
export function handleAt(p: Point, r: Region | null | undefined, tol: number): number {
  if (!r) return -1
  const hs = handles(r)
  for (let i = 0; i < hs.length; i++) {
    if (Math.abs(hs[i].x - p.x) <= tol && Math.abs(hs[i].y - p.y) <= tol) return i
  }
  return -1
}

/** 全画布找手柄：选中区域优先，其次是优先级最高的其它区域。 */
export function handleAnywhere(
  p: Point,
  regions: Region[],
  selId: string | null,
  tol: number,
): { region: Region; hi: number } | null {
  const sel = regions.find(r => r.id === selId)
  if (sel) {
    const hi = handleAt(p, sel, tol)
    if (hi >= 0) return { region: sel, hi }
  }
  for (const r of sortByPriority(regions).reverse()) {
    if (r.id === selId) continue
    const hi = handleAt(p, r, tol)
    if (hi >= 0) return { region: r, hi }
  }
  return null
}

/** 命中多边形的第几条边（-1 表示没命中） */
export function edgeAt(p: Point, r: Region | null | undefined, tol: number): number {
  if (!r || r.shape !== 'poly') return -1
  for (let i = 0; i < r.points.length; i++) {
    const a = r.points[i], b = r.points[(i + 1) % r.points.length]
    if (distToSegment(p.x, p.y, a.x, a.y, b.x, b.y) <= tol) return i
  }
  return -1
}

/** 真实顶点命中（只认存储的点）。 */
export function vertexAt(p: Point, r: Region | null | undefined, tol: number): number {
  if (!r) return -1
  for (let i = 0; i < r.points.length; i++) {
    const q = r.points[i]
    if (Math.abs(q.x - p.x) <= tol && Math.abs(q.y - p.y) <= tol) return i
  }
  return -1
}

/** 命中的区域（从上往下找，即后创建的优先） */
export function regionAt(p: Point, regions: Region[]): Region | null {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i]
    if (r.shape === 'rect') {
      const b = rectOfRegion(r)
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return r
    } else if (pointInPoly(p.x, p.y, r.points)) {
      return r
    }
  }
  return null
}

/** 绘制矩形时的实时尺寸（Shift 正方形 / Alt 中心向外） */
export function constrainRect(a: Point, c: Point, shift: boolean, alt: boolean): Bounds {
  if (alt) {
    const dx = c.x - a.x, dy = c.y - a.y
    return {
      x: a.x - Math.abs(dx),
      y: a.y - Math.abs(dy),
      w: Math.abs(dx) * 2,
      h: Math.abs(dy) * 2,
    }
  }
  let x2 = c.x, y2 = c.y
  let dx = x2 - a.x, dy = y2 - a.y
  if (shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    x2 = a.x + (dx < 0 ? -m : m)
    y2 = a.y + (dy < 0 ? -m : m)
    dx = x2 - a.x; dy = y2 - a.y
  }
  return { x: Math.min(a.x, x2), y: Math.min(a.y, y2), w: Math.abs(dx), h: Math.abs(dy) }
}

/** 整体平移区域（保持形状不变形） */
export function translateRegion(r: Region, dx: number, dy: number, canvasW: number, canvasH: number): void {
  for (const q of r.points) {
    q.x = clamp(q.x + dx, 0, canvasW)
    q.y = clamp(q.y + dy, 0, canvasH)
  }
}

/** 把形状路径写进任意 2D 上下文（Canvas / OffscreenCanvas 通用） */
export function tracePath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  r: Region,
): void {
  const b = rectOfRegion(r)
  ctx.beginPath()
  if (r.shape === 'rect') {
    ctx.rect(b.x, b.y, b.w, b.h)
    return
  }
  ctx.moveTo(r.points[0].x, r.points[0].y)
  for (let i = 1; i < r.points.length; i++) ctx.lineTo(r.points[i].x, r.points[i].y)
  ctx.closePath()
}
