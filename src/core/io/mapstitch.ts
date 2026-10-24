import type { Point, Region, RegionShape, RegionTarget, RegionType } from '../../types/map'
import { TYPES } from '../constants'
import { readZip } from './zip'

/**
 * MapStitch（PixelworkMapStitch）工程导入。
 *
 * ── 注解兼容规则（必须保留） ──────────────────────────────
 *   旧 MapStitch 注解层的语义与新编辑器不同，因此导入时做如下映射：
 *     旧 occlusion（遮挡层） → 新 adjust（调节层）
 *     旧 adjust（调节层）    → 新 occlusion（遮挡层）
 *     旧 collision（碰撞层） → 新 collision（碰撞层）
 *     旧 top（最上层）       → 新 top（最上层）
 * ───────────────────────────────────────────────────────────
 */

/** 旧注解层名 → 新区域类型 */
export function mapStitchTypeToInternal(old: string): RegionType {
  switch (old) {
    case 'occlusion': return 'adjust'
    case 'adjust': return 'occlusion'
    case 'collision': return 'collision'
    case 'top': return 'top'
    default: return 'occlusion'
  }
}

/** 作用目标：MapStitch 的 map_layer → 编辑器的图层目标 */
export function mapStitchLayerToTarget(mapLayer: string | undefined): RegionTarget {
  if (mapLayer === 'object') return 'objects'
  if (mapLayer === 'surface') return 'background'
  return 'both'
}

/** MapStitch 形状 → 编辑器形状 */
function mapStitchShape(mode: string | undefined): RegionShape {
  if (mode === 'rectangle') return 'rect'
  return 'poly'
}

/** 矩形规整为「左上 / 右下」两点 */
function normalizePoints(shape: RegionShape, points: Point[]): Point[] {
  if (shape === 'rect') {
    if (points.length < 2) return []
    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    const x0 = Math.min(...xs), x1 = Math.max(...xs)
    const y0 = Math.min(...ys), y1 = Math.max(...ys)
    return [{ x: x0, y: y0 }, { x: x1, y: y1 }]
  }
  return points
}

/** MapStitch 注解 JSON → 区域列表 */
export function parseMapStitchAnnotations(json: any): { regions: Region[]; warnings: string[] } {
  const regions: Region[] = []
  const warnings: string[] = []
  const layers = Array.isArray(json?.layers) ? json.layers : []
  let seq = 0

  for (const layer of layers) {
    const oldType = String(layer?.id || '')
    const type = mapStitchTypeToInternal(oldType)
    if (!TYPES[type]) continue
    const shapes = Array.isArray(layer?.shapes) ? layer.shapes : []
    for (const shape of shapes) {
      const raw: Point[] = Array.isArray(shape?.points)
        ? shape.points.map((p: any) => ({ x: +p.x, y: +p.y }))
        : []
      const sShape = mapStitchShape(shape?.mode)
      const points = normalizePoints(sShape, raw)
      if (points.length < 2) continue
      regions.push({
        id: String(shape?.id || `ms_${seq}`),
        name: String(shape?.layer_label || layer?.label || TYPES[type].name),
        type,
        target: mapStitchLayerToTarget(shape?.map_layer),
        priority: 0,
        shape: sShape,
        points,
        seq: seq++,
      })
    }
    if (oldType && !['occlusion', 'adjust', 'collision', 'top'].includes(oldType)) {
      warnings.push(`未知注解层「${oldType}」已跳过`)
    }
  }
  return { regions, warnings }
}

/** MapStitch 导入结果 */
export interface MapStitchImportResult {
  canvas: { w: number; h: number } | null
  regions: Region[]
  /** 白层（场景）PNG 原始数据 */
  background: Uint8Array | null
  /** 黑层（物件）PNG 原始数据 */
  objects: Uint8Array | null
  /** 前景层（置顶）PNG 原始数据 —— 语义与本方案的 foreground 完全一致 */
  foreground: Uint8Array | null
  /** 被跳过的资源（导入器无法表达的层） */
  skipped: string[]
  warnings: string[]
}

function pickEntry(entries: Map<string, Uint8Array>, ...patterns: string[]): Uint8Array | null {
  for (const p of patterns) {
    for (const [name, data] of entries) {
      if (name.toLowerCase().endsWith(p.toLowerCase())) return data
    }
  }
  return null
}

function findAnnotations(entries: Map<string, Uint8Array>): { name: string; data: Uint8Array } | null {
  for (const [name, data] of entries) {
    if (name.toLowerCase().endsWith('_annotations.json')) return { name, data }
  }
  return null
}

function findGodotJson(entries: Map<string, Uint8Array>): any {
  for (const [name, data] of entries) {
    if (name.toLowerCase().endsWith('_godot.json')) {
      try {
        return JSON.parse(new TextDecoder().decode(data))
      } catch {
        return null
      }
    }
  }
  return null
}

/** 解析 MapStitch ZIP */
export async function importMapStitchZip(data: ArrayBuffer | Uint8Array): Promise<MapStitchImportResult> {
  const entries = await readZip(data)
  const warnings: string[] = []
  const skipped: string[] = []

  const ann = findAnnotations(entries)
  if (!ann) throw new Error('ZIP 中未找到 *_annotations.json（不是 MapStitch 导出包？）')

  let json: any
  try {
    json = JSON.parse(new TextDecoder().decode(ann.data))
  } catch (e) {
    throw new Error('annotations.json 解析失败：' + (e as Error).message)
  }

  const { regions, warnings: w } = parseMapStitchAnnotations(json)
  warnings.push(...w)

  const godot = findGodotJson(entries)
  const canvas = godot?.canvas ? { w: +godot.canvas.width, h: +godot.canvas.height } : null

  /* 三层模型：地表/整体 → 白层，物件 → 黑层，置顶 → 前景层 */
  const hasSurface = !!pickEntry(entries, 'images/surface/source.png')
  const hasOverall = !!pickEntry(entries, 'images/overall/source.png')
  const background = hasSurface
    ? pickEntry(entries, 'images/surface/source.png')
    : pickEntry(entries, 'images/overall/source.png')
  const objects = pickEntry(entries, 'images/object/source.png')
  /* MapStitch 的 top 层语义（永远画在角色之上）和本方案的 foreground 层完全一致，
     所以直接载入为前景层，不再跳过 —— 原来 36 个 top 注解对应的图片从此「直接可用」。 */
  const foreground = pickEntry(entries, 'images/top/source_top.png')

  if (!hasSurface && hasOverall) {
    warnings.push('未找到地表层图片，已改用整体层作为白层')
  }
  if (foreground) {
    warnings.push('已载入置顶层为前景层，可用青色淡化区控制淡出')
  }

  return {
    canvas,
    regions,
    background,
    objects,
    foreground,
    skipped,
    warnings,
  }
}
