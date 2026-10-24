import type { PenState, Point, RegionTarget, RegionType } from '../types/map'
import { TYPES } from './constants'
import { clamp, constrainRect, simplify } from './geometry'

/** 吸附配置 */
export interface SnapConfig {
  enabled: boolean
  step: number
}

/** 绘制完成后待落地的区域草稿 */
export interface RegionDraft {
  name: string
  type: RegionType
  target: RegionTarget
  shape: 'rect' | 'poly'
  points: Point[]
}

/** 吸附到网格 */
export function snapPoint(p: Point, cfg: SnapConfig): Point {
  if (!cfg.enabled) return p
  const s = Math.max(1, cfg.step)
  return { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s }
}

/** 新建一次绘制 */
export function makePen(
  kind: PenState['kind'],
  p: Point,
  type: RegionType,
  target: RegionTarget,
  cfg: SnapConfig,
): PenState {
  const pt = snapPoint(p, cfg)
  return {
    kind,
    type,
    target,
    start: pt,
    cur: pt,
    pts: kind === 'poly' ? [] : [pt],
    raw: kind === 'free' ? [pt] : null,
    preview: null,
  }
}

/** 屏幕像素 → 世界坐标的换算函数 */
export type PxFn = (n: number) => number

/** 绘制过程中移动鼠标 */
export function updatePen(
  pen: PenState,
  p: Point,
  opts: { canvas: { w: number; h: number }; shift: boolean; alt: boolean; snap: SnapConfig; px: PxFn },
): void {
  const { canvas, shift, alt, snap, px } = opts
  if (pen.kind === 'rect') {
    pen.cur = snapPoint({ x: clamp(p.x, 0, canvas.w), y: clamp(p.y, 0, canvas.h) }, snap)
    pen.preview = constrainRect(pen.start, pen.cur, shift, alt)
  } else if (pen.kind === 'free') {
    pen.cur = p
    const raw = pen.raw || (pen.raw = [])
    const last = raw[raw.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= px(2.2)) {
      raw.push({ x: p.x, y: p.y })
      pen.pts = simplify(raw, px(3))
    }
  } else {
    pen.cur = p
  }
}

/** 多边形：单击加点；点到起点则闭合 */
export function addPolyPoint(
  pen: PenState,
  p: Point,
  canvas: { w: number; h: number },
  snap: SnapConfig,
  px: PxFn,
): 'closed' | 'added' {
  const tol = px(13)
  if (pen.pts.length >= 3 && Math.hypot(p.x - pen.pts[0].x, p.y - pen.pts[0].y) < tol) {
    return 'closed'
  }
  const q = snapPoint({ x: clamp(p.x, 0, canvas.w), y: clamp(p.y, 0, canvas.h) }, snap)
  const last = pen.pts[pen.pts.length - 1]
  /* 连续两次点击位置几乎相同（双击）时替换而不是新增，避免产生退化尖角 */
  if (last && Math.hypot(q.x - last.x, q.y - last.y) < px(6)) pen.pts[pen.pts.length - 1] = q
  else pen.pts.push(q)
  pen.cur = q
  return 'added'
}

/** 撤销多边形的上一个点；返回是否还可以继续撤销 */
export function popPolyPoint(pen: PenState): boolean {
  if (pen.pts.length > 1) {
    pen.pts.pop()
    return true
  }
  return false
}

/** 结束绘制，产出区域草稿 */
export function finishPen(pen: PenState, px: PxFn): { ok: boolean; draft?: RegionDraft; error?: string } {
  /* 作用层级在按下鼠标那一刻就已固定（见 makePen）；
     淡化区永远作用于前景层，其余类型用画笔上记录的层级。 */
  const target: RegionTarget = pen.type === 'fade' ? 'foreground' : pen.target
  const name = TYPES[pen.type].name

  if (pen.kind === 'rect') {
    const r = pen.preview
    if (!r || r.w < px(4) || r.h < px(4)) return { ok: false }
    return {
      ok: true,
      draft: {
        name,
        type: pen.type,
        target,
        shape: 'rect',
        points: [
          { x: r.x, y: r.y },
          { x: r.x + r.w, y: r.y + r.h },
        ],
      },
    }
  }

  if (pen.kind === 'poly') {
    if (pen.pts.length < 3) return { ok: false, error: '至少需要 3 个顶点' }
    return {
      ok: true,
      draft: {
        name,
        type: pen.type,
        target,
        shape: 'poly',
        points: pen.pts.map(p => ({ x: p.x, y: p.y })),
      },
    }
  }

  /* 自由绘制 */
  const raw = pen.raw || []
  if (raw.length < 3) return { ok: false }
  const pts = simplify(raw, px(3))
  if (pts.length < 3) return { ok: false, error: '轨迹太短，已忽略' }
  return {
    ok: true,
    draft: {
      name,
      type: pen.type,
      target,
      shape: 'poly',
      points: pts.map(p => ({ x: p.x, y: p.y })),
    },
  }
}
