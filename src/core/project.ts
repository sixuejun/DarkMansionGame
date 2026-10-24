import type { LayerState, MapProject, Point, Region, RegionShape, RegionType } from '../types/map'
import { DEFAULT_CANVAS, DEFAULT_CHAR, DEFAULT_FADE_ALPHA, DEFAULT_FADE_PAD, TYPE_TARGETS, defaultTargetFor } from './constants'
import { clamp, translateRegion, uid } from './geometry'
import type { RegionDraft } from './drawing'

/** 创建一个空图层 */
export function createLayer(): LayerState {
  return { img: null, w: 0, h: 0, visible: true, locked: false, opacity: 1 }
}

/**
 * 把任意目标纠正为该类型的合法层级。
 *
 * 唯一的兜底入口：绘制草稿、导入的旧数据、外部 JSON 都走这里，
 * 保证区域入库时 target 与 type 一定匹配（淡化→前景层是强约束）。
 */
export function legalTargetFor(type: RegionType, target: Region['target']): Region['target'] {
  const legal = TYPE_TARGETS[type]
  if (legal.includes(target)) return target
  return defaultTargetFor(type)
}

/** 创建一个空白工程 */
export function createProject(): MapProject {
  return {
    name: 'map',
    canvas: { ...DEFAULT_CANVAS },
    layers: {
      background: createLayer(),
      objects: createLayer(),
      foreground: createLayer(),
    },
    regions: [],
    marks: [],
    seq: 0,
    char: { ...DEFAULT_CHAR },
  }
}

/** 新增区域（草稿 → 正式区域），返回落地的区域 */
export function addRegion(project: MapProject, draft: RegionDraft): Region {
  const r: Region = {
    id: uid(),
    name: draft.name,
    type: draft.type,
    /* 目标必须是该类型合法的层级：淡化固定前景层，其余按合法列表纠正，
       避免外部数据 / 旧存档带进「调节层作用于白层」这种导出即错的组合。 */
    target: legalTargetFor(draft.type, draft.target),
    priority: 0,
    shape: draft.shape,
    points: draft.points.map(p => ({ x: p.x, y: p.y })),
    seq: project.seq++,
  }
  if (draft.type === 'fade') {
    r.fadeAlpha = DEFAULT_FADE_ALPHA
    r.fadePad = DEFAULT_FADE_PAD
    r.clip = null
  }
  project.regions.push(r)
  return r
}

/** 按 id 找区域 */
export function findRegion(project: MapProject, id: string | null): Region | undefined {
  if (!id) return undefined
  return project.regions.find(r => r.id === id)
}

/** 删除区域 */
export function removeRegion(project: MapProject, id: string): boolean {
  const i = project.regions.findIndex(r => r.id === id)
  if (i < 0) return false
  project.regions.splice(i, 1)
  return true
}

/** 修改区域类型 */
export function setRegionType(project: MapProject, id: string, type: RegionType): boolean {
  const r = findRegion(project, id)
  if (!r || r.type === type) return false
  r.type = type
  if (type === 'fade') {
    /* 淡化区固定作用于前景层，并补齐三个 fade 字段 */
    r.target = 'foreground'
    if (!Number.isFinite(Number(r.fadeAlpha))) r.fadeAlpha = DEFAULT_FADE_ALPHA
    if (!Number.isFinite(Number(r.fadePad))) r.fadePad = DEFAULT_FADE_PAD
    if (r.clip === undefined) r.clip = null
  } else if (!TYPE_TARGETS[type].includes(r.target)) {
    /* 换类型后旧目标可能不再合法（如调节层不能用白层、淡化留下的前景层）。
       拉回该类型的默认值，而不是留在非法组合上。 */
    r.target = defaultTargetFor(type)
  }
  return true
}

/** 修改保留不透明度（fade 专用） */
export function setFadeAlpha(project: MapProject, id: string, alpha: number): boolean {
  const r = findRegion(project, id)
  if (!r) return false
  r.fadeAlpha = clamp(Number(alpha) || 0, 0, 1)
  return true
}

/** 修改触发迟滞边距（fade 专用，仅矩形生效） */
export function setFadePad(project: MapProject, id: string, pad: number): boolean {
  const r = findRegion(project, id)
  if (!r) return false
  r.fadePad = clamp(Math.round(Number(pad) || 0), 0, 64)
  return true
}

/** 把当前选区形状复制为精确淡出边界；传 null 表示取消 clip */
export function setFadeClip(
  project: MapProject,
  id: string,
  clip: { shape: RegionShape; points: Point[] } | null,
): boolean {
  const r = findRegion(project, id)
  if (!r) return false
  r.clip = clip
    ? { shape: clip.shape, points: clip.points.map(p => ({ x: p.x, y: p.y })) }
    : null
  return true
}

/** 方向键微移：step 为每次移动的像素数 */
export function nudgeRegion(project: MapProject, id: string, dx: number, dy: number, step = 1): boolean {
  const r = findRegion(project, id)
  if (!r) return false
  translateRegion(r, dx * step, dy * step, project.canvas.w, project.canvas.h)
  return true
}

/** 修改优先级 */
export function setRegionPriority(project: MapProject, id: string, priority: number): boolean {
  const r = findRegion(project, id)
  if (!r) return false
  r.priority = Math.trunc(priority) || 0
  return true
}

/** 修改作用目标（拒绝该类型不支持的层级，避免产生导出即错的数据） */
export function setRegionTarget(project: MapProject, id: string, target: Region['target']): boolean {
  const r = findRegion(project, id)
  if (!r || r.target === target) return false
  /* 淡化区只认前景层；其余类型按各自的合法列表 */
  const legal = TYPE_TARGETS[r.type]
  if (!legal.includes(target)) return false
  r.target = target
  return true
}

/** 重命名 */
export function renameRegion(project: MapProject, id: string, name: string): boolean {
  const r = findRegion(project, id)
  if (!r) return false
  r.name = name
  return true
}

/** 调整画布尺寸 */
export function setCanvasSize(project: MapProject, w: number, h: number): void {
  project.canvas.w = clamp(Math.round(w) || DEFAULT_CANVAS.w, 16, 8192)
  project.canvas.h = clamp(Math.round(h) || DEFAULT_CANVAS.h, 16, 8192)
}
