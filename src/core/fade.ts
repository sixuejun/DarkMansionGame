import type { Bounds, MapProject, Region, RegionShape, Point } from '../types/map'
import { DEFAULT_FADE_ALPHA, DEFAULT_FADE_PAD, FADE_ALPHA_MAX, FADE_ALPHA_MIN, FADE_PAD_MAX, FADE_PAD_MIN } from './constants'
import { clamp, rectOfRegion, regionHitRect, tracePath } from './geometry'
import { createOffscreen, footBox } from './preview'

/**
 * 前景淡化（fade）：角色走进某个触发框时，把前景层对应像素整体降到指定不透明度。
 *
 * 三条与既有机制无关的硬规则：
 *   1. 角色不降层、不出现副本。淡化只改前景层的 alpha，黑层上下片行为完全不变。
 *   2. 框是触发框，不是抠图轮廓 —— 框应该比前景图里的物件画得大一圈。
 *      框里没画图的地方是透明像素，淡化它们等于什么都没做。
 *   3. 判定只看角色脚底碰撞箱（boxW × boxH），与立绘外框无关，
 *      也与黑层切片（黄色区域）毫无关系。
 */

/** 淡化专用的区域视图：clip 不是 Region，用一个最小形状结构喂给 tracePath */
export interface FadeShape {
  shape: RegionShape
  points: Point[]
}

export type FadeRegion = Region

/* ------------------------------------------------------------------ */
/* 属性读写                                                             */
/* ------------------------------------------------------------------ */

/** 读保留不透明度，缺省 0（完全消失），脏数据钳到 0~1 */
export function fadeAlphaOf(r: Region): number {
  const v = Number(r.fadeAlpha)
  if (!Number.isFinite(v)) return DEFAULT_FADE_ALPHA
  return clamp(v, FADE_ALPHA_MIN, FADE_ALPHA_MAX)
}

/** 读触发边距，缺省 4。fadePad 只对矩形生效，多边形恒为 0 */
export function fadePadOf(r: Region): number {
  if (r.shape !== 'rect') return 0
  const v = Number(r.fadePad)
  if (!Number.isFinite(v)) return DEFAULT_FADE_PAD
  return clamp(v, FADE_PAD_MIN, FADE_PAD_MAX)
}

/** 实际参与淡化的形状：clip 优先，缺省用 points */
export function fadeShapeOf(r: Region): FadeShape {
  if (r.clip && r.clip.points.length >= 2) {
    return { shape: r.clip.shape, points: r.clip.points }
  }
  return { shape: r.shape, points: r.points }
}

/**
 * 淡出用的 globalAlpha —— 注意这里是 1 − fadeAlpha，不是 fadeAlpha。
 *
 * destination-out 的公式是 αr = αd × (1 − αs)，
 * 而 fadeAlpha 存的是「保留多少」。验算：
 *   fadeAlpha=0   → globalAlpha=1    → αd × 0   = 0   （完全消失）
 *   fadeAlpha=0.15→ globalAlpha=0.85 → αd × 0.15       （留 15% 轮廓）
 *   fadeAlpha=1   → globalAlpha=0    → αd             （等于不淡化）
 */
export function cutAlphaOf(r: Region): number {
  return 1 - fadeAlphaOf(r)
}

/** 工程里所有淡化区域 */
export function fadeRegions(project: MapProject): Region[] {
  return project.regions.filter(r => r.type === 'fade')
}

/** 框向外扩张 pad 后的包围盒（pad=0 时返回原框） */
export function expandBounds(b: Bounds, pad: number): Bounds {
  if (pad <= 0) return b
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }
}

/** 用「外扩后的包围盒」造一个临时 rect 区域，用于迟滞进入判定 */
function paddedAsRect(r: Region, pad: number): Region {
  const b = expandBounds(rectOfRegion(r), pad)
  return {
    ...r,
    shape: 'rect',
    points: [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }],
  }
}

/* ------------------------------------------------------------------ */
/* 迟滞触发                                                            */
/* ------------------------------------------------------------------ */

/**
 * 当前处于淡化状态的区域 id 集合。
 * 在帧间持久化（不进工程数据），只有角色跨越框边界时才会变。
 */
export const activeFade = new Set<string>()

/**
 * 每帧调用：更新迟滞状态，返回当前应淡化的区域。
 *
 * 迟滞规则（防边界抖动）：
 *   - 进入判定用「框向外扩张 fadePad」后的形状 → 提前进入；
 *   - 退出判定用「原始框」        → 延后退出。
 * 于是离开要比进入多走 fadePad 像素，形成滞回带，角色站在框边缘时前景不会疯狂闪烁。
 */
export function updateFadeTargets(project: MapProject): Region[] {
  const foot = footBox(project)
  const list: Region[] = []

  for (const r of project.regions) {
    if (r.type !== 'fade') continue
    const pad = fadePadOf(r)

    if (regionHitRect(pad > 0 ? paddedAsRect(r, pad) : r, foot)) {
      activeFade.add(r.id)
    } else if (activeFade.has(r.id) && !regionHitRect(r, foot)) {
      /* 退出要完全走出原始框 */
      activeFade.delete(r.id)
    }
    if (activeFade.has(r.id)) list.push(r)
  }

  /* 清理已删除区域 / 已改成别的类型的区域残留状态 */
  const live = new Set<string>()
  for (const r of list) live.add(r.id)
  for (const id of [...activeFade]) {
    if (!live.has(id)) activeFade.delete(id)
  }
  return list
}

/** 清空迟滞状态（切项目 / 导入 / 强制预览关闭时用） */
export function resetFadeState(): void {
  activeFade.clear()
}

/* ------------------------------------------------------------------ */
/* Canvas 构建                                                          */
/* ------------------------------------------------------------------ */

/** clip 不是 Region，造一个零成本临时对象给 tracePath 用 */
function traceShape(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, s: FadeShape): void {
  tracePath(ctx, { shape: s.shape, points: s.points } as Region)
}

/** 参与缓存签名的形状（把顶点一起算进去） */
function shapeSignature(s: FadeShape): string {
  if (!s.points.length) return '-'
  return s.shape + ':' + s.points.length + ':' + s.points.map(p => `${p.x},${p.y}`).join(',')
}

/**
 * 参与缓存键的触发集合。
 *
 * 用「触发集合的 id + 淡化强度 + 实际淡出边界」而不是角色坐标：
 * 内容只有在角色跨越框边界时才变，中间连续移动不会变。
 *
 * ⚠ 边界必须把「区域自身形状」也算进去（clip 缺省时 fadeShapeOf 返回的就是 points），
 * 否则拖动淡化框的几何变了、命中集合却没变，缓存会命中一张过期画面。
 */
function fadeSignature(list: Region[]): string {
  return list
    .map(r => `${r.id}:${fadeAlphaOf(r)}:${shapeSignature(fadeShapeOf(r))}`)
    .join(',')
}

interface FadeCacheEntry {
  key: string
  canvas: HTMLCanvasElement | null
}

let fadeCache: FadeCacheEntry | null = null

/** 清除前景淡化缓存（换图 / 改区域几何 / fadeAlpha / clip 时调用） */
export function invalidateFadeCache(): void {
  fadeCache = null
}

/**
 * 构建带淡化的前景层（带缓存）。
 *
 * 命中即直接复用离屏画布：内容只有在角色跨越框边界时才变，
 * 中间连续移动不会触发重建，因此 20 个淡化区来回走一整段路也只重建一次。
 */
export function buildFadedForeground(
  project: MapProject,
  triggered: Region[],
): HTMLCanvasElement | null {
  const fg = project.layers.foreground
  if (!fg || !fg.img) return null

  const key = [
    fg.img.src || 'img',
    project.canvas.w, project.canvas.h,
    fadeSignature(triggered),
  ].join('|')

  if (fadeCache && fadeCache.key === key) return fadeCache.canvas

  const cv = createOffscreen(project.canvas.w, project.canvas.h)
  const ctx = cv.getContext('2d')
  if (!ctx) {
    fadeCache = { key, canvas: null }
    return null
  }

  ctx.drawImage(fg.img, 0, 0, project.canvas.w, project.canvas.h)
  if (triggered.length) {
    /* destination-out：把已画像素按 alpha 削掉 */
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = '#fff'
    for (const r of triggered) {
      ctx.globalAlpha = cutAlphaOf(r)
      traceShape(ctx, fadeShapeOf(r))
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  fadeCache = { key, canvas: cv }
  return cv
}

/** 缓存键（供 MapCanvas 的 :key 用，保证淡化结果变化时 Konva 重绘） */
export function fadeCacheKey(triggered: Region[]): string {
  return fadeSignature(triggered)
}

/* ------------------------------------------------------------------ */
/* 空框诊断                                                            */
/* ------------------------------------------------------------------ */

/**
 * 判断一个淡化区里到底有没有前景美术。
 *
 * 「保留不透明度」调多少都没用的情况几乎都是这个原因：
 * 框画在了 foreground.png 上没有画东西的地方，
 * 或者框的位置和实际美术错开了（画的是黑层 / 白层的物件）。
 * 框里是透明像素 → destination-out 削的是空气 → 画面纹丝不动。
 *
 * 返回 0~1 的「美术覆盖率」。0 = 框里完全是空的。
 * 需要读像素，所以只在选中一个淡化区时调用，不在每帧跑。
 */
export function fadeArtCoverage(r: Region, fg: HTMLImageElement | null): number {
  if (!fg || !fg.naturalWidth) return -1
  const s = fadeShapeOf(r)
  if (!s.points.length) return 0

  /* 取形状的包围盒 */
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of s.points) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  const bx = Math.max(0, Math.floor(x0))
  const by = Math.max(0, Math.floor(y0))
  const bw = Math.min(fg.naturalWidth, Math.ceil(x1)) - bx
  const bh = Math.min(fg.naturalHeight, Math.ceil(y1)) - by
  if (bw <= 0 || bh <= 0) return 0

  const cv = document.createElement('canvas')
  cv.width = bw
  cv.height = bh
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return -1
  ctx.drawImage(fg, bx, by, bw, bh, 0, 0, bw, bh)

  const data = ctx.getImageData(0, 0, bw, bh).data
  let opaque = 0
  const total = bw * bh
  for (let i = 3; i < data.length; i += 4) {
    /* alpha > 8 就算「有东西」：抗锯齿边缘也算，不能漏判 */
    if (data[i] > 8) opaque++
  }
  return opaque / total
}