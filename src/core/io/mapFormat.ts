import type { ActorJson, MapJson, MapJsonRegion, MapProject, Mark, MarkFacing, MarkJson, MarkKind, Point, Region, RegionShape, RegionTarget, RegionType } from '../../types/map'
import { TYPES, DEFAULT_FADE_ALPHA, DEFAULT_FADE_PAD, MARK_KINDS } from '../constants'
import { rectOfRegion } from '../geometry'
import { legalTargetFor } from '../project'

/** 文件名安全化 */
export function safeName(s: string | undefined | null): string {
  return (s || 'map').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 64) || 'map'
}

/**
 * 角色判定参数（工程 → JSON）。
 *
 * 这是编辑器与运行器之间最关键的一条约定：
 * 运行器必须用 collision_box 做碰撞/遮挡判定，不能拿 sprite 去撞红区。
 */
export function actorToJson(project: MapProject): ActorJson {
  const c = project.char
  return {
    anchor: { x: +c.anchorX.toFixed(4), y: +c.anchorY.toFixed(4) },
    sprite: { width: c.w, height: c.h },
    collision_box: { width: c.boxW, height: c.boxH },
    ghost_alpha: +c.ghostAlpha.toFixed(3),
    collision_test: 'aabb-overlap',
    occlusion_test: 'foot-box-overlap',
  }
}

/** 工程 → Web 通用 map.json */
export function toMapJson(project: MapProject): MapJson {
  const entities: MarkJson[] = project.marks.map(m => {
    const out: MarkJson = {
      id: m.id,
      kind: m.kind,
      name: m.name || MARK_KINDS[m.kind].name,
      x: +m.x.toFixed(2),
      y: +m.y.toFixed(2),
      facing: m.facing || 'down',
    }
    if (m.boxW !== undefined) out.boxW = m.boxW
    if (m.boxH !== undefined) out.boxH = m.boxH
    if (m.tags && Object.keys(m.tags).length) out.tags = { ...m.tags }
    /* 巡逻路线只带路径点 —— 相邻两点之间由运行器寻路绕墙，
       展开成完整折线会让文件变大，且红区一改就过期。 */
    if (m.patrol && m.patrol.points.length >= 2) {
      out.patrol = {
        loop: m.patrol.loop,
        points: m.patrol.points.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })),
      }
    }
    return out
  })

  const regions: MapJsonRegion[] = project.regions.map((r, i) => {
    const b = rectOfRegion(r)
    const out: MapJsonRegion = {
      id: r.id,
      name: r.name || TYPES[r.type].name,
      type: r.type,
      type_name: TYPES[r.type].name,
      target: r.target,
      priority: r.priority,
      shape: r.shape,
      points: r.points.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })),
      bounds: {
        x: +b.x.toFixed(2),
        y: +b.y.toFixed(2),
        width: +b.w.toFixed(2),
        height: +b.h.toFixed(2),
      },
      order: i,
    }
    /* 三个 fade 字段只对 fade 区域输出，缺省值照样写出去（运行器不用猜） */
    if (r.type === 'fade') {
      out.fadeAlpha = numOr(r.fadeAlpha, DEFAULT_FADE_ALPHA)
      out.fadePad = numOr(r.fadePad, DEFAULT_FADE_PAD)
      out.clip = r.clip && r.clip.points.length >= 2
        ? { shape: r.clip.shape, points: r.clip.points.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })) }
        : null
    }
    return out
  })

  return {
    format: 'darkmansion-map',
    version: 4,
    name: safeName(project.name),
    canvas: { width: project.canvas.w, height: project.canvas.h },
    layers: [
      { id: 'background', name: '白层 · 场景', file: 'background.png', z_index: 0 },
      { id: 'objects', name: '黑层 · 物件', file: 'objects.png', z_index: 1 },
      { id: 'foreground', name: '前景层 · 淡出', file: 'foreground.png', z_index: 2 },
    ],
    /* 八步绘制顺序。没有 adjust / occlusion 区域时，
       objects_lower 自然全透明、character_ghost 不绘制，退化成原来的三段顺序。

       ⚠ 白层不再被固定在最底下：
         background_below 是白层留在角色下方的部分，
         background_above 是被紫区提到角色上方、成为遮挡物的白层片段。
         没有 target=background 的紫区时 background_above 为空，
         渲染结果与「白层恒在最底」完全一致（向后兼容）。 */
    render_order: [
      'background_below',
      'objects_lower',
      'character',
      'background_above',
      'objects_upper',
      'character_ghost',
      'foreground',
      'top',
    ],
    actor: actorToJson(project),
    rules: {
      priority_resolution: 'max-priority-wins',
      type_tiebreak: ['collision', 'adjust', 'occlusion', 'top'],
      collision_test: 'aabb-overlap',
      occlusion_test: 'foot-box-overlap',
      notes:
        '像素被多区域覆盖时取 priority 最大者；相同则按 type_tiebreak 后者胜。' +
        '角色判定只看脚底锚点 anchor 与 collision_box（以锚点为中心的小盒），' +
        '与 sprite 无关：脚底不与 collision 区域重叠即可通行。',
    },
    /* 白层 / 黑层怎么切成上下片 —— 运行器照这张表切即可 */
    layer_split: {
      background:
        '白层默认整层在角色下方（background_below）。' +
        '命中 target 覆盖白层的 occlusion 区域时，该紫区内部的白层像素' +
        '额外画到角色上方（background_above）成为遮挡物，' +
        '紫区外的白层仍留在下方，场景不缺块。' +
        'target=background 的 top 区域把白层片段提到最顶（top），' +
        '该片段不再出现在 background_below 里。',
      objects:
        '黑层默认整层在角色上方（objects_upper），' +
        'target 覆盖黑层的 adjust（黄色）区域在黑层上开洞，' +
        '洞内像素落到 objects_lower，角色在该范围内完整可见、不叠副本。' +
        'target=objects 的 top 区域把黑层片段提到最顶（top）。',
      top: 'top 段合并白层与黑层两层的 top 区域内容，位于 foreground 之上。',
      notes:
        '每层的 top / 遮挡片段只取该区域 target 指定的那一层，' +
        'target=both 时两层都取。同一像素只出现在一段里，不会被重复绘制。',
    },
    fade: {
      test: 'foot-box-overlap',
      default_alpha: DEFAULT_FADE_ALPHA,
      default_pad: DEFAULT_FADE_PAD,
      hysteresis: 'enter=expand(pad), exit=raw',
      composite: 'destination-out',
      clip_default: 'region-shape',
      notes: 'fadeAlpha 存的是保留的不透明度；destination-out 的 globalAlpha 需取 1 - fadeAlpha。',
    },
    regions,
    entities,
  }
}

function numOr(v: unknown, d: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

/** 矩形区域的标准两点表示 */
function regPoints(
  shape: RegionShape,
  points: Point[],
  bounds?: { x: number; y: number; width: number; height: number },
): Point[] {
  if (shape === 'rect') {
    if (bounds && (!points || points.length < 2)) {
      return [
        { x: +bounds.x, y: +bounds.y },
        { x: +(bounds.x + bounds.width), y: +(bounds.y + bounds.height) },
      ]
    }
    const a = points[0]
    const z = points[points.length - 1]
    return [
      { x: Math.min(a.x, z.x), y: Math.min(a.y, z.y) },
      { x: Math.max(a.x, z.x), y: Math.max(a.y, z.y) },
    ]
  }
  return points
}

/** map.json 的单条区域 → 内部 Region */
export function regionFromJson(r: Record<string, any>, index: number): Region | null {
  const rawPts: Point[] = Array.isArray(r.points)
    ? r.points.map((p: any) => ({ x: +p.x, y: +p.y }))
    : []
  const shape: RegionShape =
    r.shape === 'rect' ? 'rect' : r.shape === 'poly' || r.shape === 'polygon' ? 'poly' : 'rect'
  const points = regPoints(shape, rawPts, r.bounds)
  if (points.length < 2) return null
  const type: RegionType = TYPES[r.type as RegionType] ? (r.type as RegionType) : 'occlusion'
  const target: RegionTarget =
    r.target === 'background' || r.target === 'objects' || r.target === 'both' || r.target === 'foreground'
      ? r.target
      : 'both'
  const out: Region = {
    id: r.id || `r_import_${index}`,
    name: r.name || TYPES[type].name || '区域',
    type,
    /* 外部数据写了非法目标也一律纠正（淡化固定前景层），
       避免旧工程 / 第三方数据把「调节层作用于白层」带进来。 */
    target: legalTargetFor(type, target),
    priority: +r.priority || 0,
    shape,
    points,
    seq: index,
  }
  /* 旧数据没有这三个字段时补默认值，避免旧工程打开后行为不可预期 */
  if (type === 'fade') {
    out.fadeAlpha = numOr(r.fadeAlpha, DEFAULT_FADE_ALPHA)
    out.fadePad = numOr(r.fadePad, DEFAULT_FADE_PAD)
    out.clip = readClip(r.clip)
  }
  return out
}

/** clip 读取：点数不足视为未设置 */
function readClip(raw: any): Region['clip'] {
  if (!raw || !Array.isArray(raw.points)) return null
  const pts: Point[] = raw.points
    .filter((p: any) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    .map((p: any) => ({ x: +p.x, y: +p.y }))
  if (pts.length < 2) return null
  const shape: RegionShape = raw.shape === 'rect' ? 'rect' : 'poly'
  return { shape, points: shape === 'rect' ? regPoints('rect', pts) : pts }
}

/** map.json → 区域列表 */
export function regionsFromMapJson(mapJson: Record<string, any>): Region[] {
  const list: Region[] = []
  const arr = Array.isArray(mapJson.regions) ? mapJson.regions : []
  arr.forEach((r: any, i: number) => {
    const reg = regionFromJson(r, i)
    if (reg) list.push(reg)
  })
  return list
}

/** map.json 的单条 entities → 内部 Mark */
export function markFromJson(m: Record<string, any>, index: number): Mark | null {
  if (!m || typeof m !== 'object') return null
  const x = Number(m.x)
  const y = Number(m.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const kind: MarkKind = MARK_KINDS[m.kind as MarkKind] ? (m.kind as MarkKind) : 'custom'
  const facing: MarkFacing =
    m.facing === 'up' || m.facing === 'left' || m.facing === 'right' ? m.facing : 'down'
  const out: Mark = {
    id: m.id || `m_import_${index}`,
    kind,
    name: m.name || MARK_KINDS[kind].name,
    x: +x,
    y: +y,
    facing,
  }
  if (Number.isFinite(Number(m.boxW))) out.boxW = +m.boxW
  if (Number.isFinite(Number(m.boxH))) out.boxH = +m.boxH
  /* 标签值统一存成字符串；非对象的 tags 直接忽略 */
  if (m.tags && typeof m.tags === 'object' && !Array.isArray(m.tags)) {
    const tags: Record<string, string> = {}
    for (const k of Object.keys(m.tags)) tags[k] = String(m.tags[k])
    if (Object.keys(tags).length) out.tags = tags
  }
  /* 巡逻路线：路径点不足两个就没有巡逻的意义，忽略 */
  if (m.patrol && typeof m.patrol === 'object' && Array.isArray(m.patrol.points)) {
    const pts = m.patrol.points
      .filter((p: any) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
      .map((p: any) => ({ x: +p.x, y: +p.y }))
    if (pts.length >= 2) out.patrol = { points: pts, loop: m.patrol.loop !== false }
  }
  return out
}

/** map.json → 标记列表（没有 entities 段就是空数组，不报错） */
export function marksFromMapJson(mapJson: Record<string, any>): Mark[] {
  const list: Mark[] = []
  const arr = Array.isArray(mapJson.entities) ? mapJson.entities : []
  arr.forEach((m: any, i: number) => {
    const mk = markFromJson(m, i)
    if (mk) list.push(mk)
  })
  return list
}

/** map.json 里的画布尺寸 */
export function canvasFromMapJson(mapJson: Record<string, any>): { w: number; h: number } | null {
  if (!mapJson.canvas) return null
  return {
    w: +mapJson.canvas.width || 0,
    h: +mapJson.canvas.height || 0,
  }
}
