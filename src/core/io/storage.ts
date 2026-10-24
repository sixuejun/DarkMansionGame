import type { CharState, LayerId, LayerState, MapProject, Mark, PatrolRoute, Point, Region } from '../../types/map'
import { clamp } from '../geometry'
import { STORAGE_KEY, DEFAULT_CHAR, FOOT_BOX_MIN, FOOT_BOX_MAX } from '../constants'

/**
 * localStorage 自动存档结构。
 *
 * 重要：`layers.*.src` 只保存 **dataURL**（如 data:image/png;base64,...）。
 * 绝不能存 blob: URL —— loadImageFromBytes 在图片解码成功后就会 revoke 掉它，
 * 存下来的是一条已经失效的死链接，重开页面时解码必失败，
 * restoreLocal 随即走 catch → clearLocal()，整张地图连同区域一起被抹掉。
 * 这就是「改着改着突然崩溃 / 清空」的真凶。
 */
/** 单层的可序列化结构（只存 dataURL，见 persistentSrc 的说明） */
export interface StoredLayer {
  src: string | null
  w: number
  h: number
  visible: boolean
  locked: boolean
  opacity: number
}

export interface StoredProject {
  name: string
  canvas: { w: number; h: number }
  layers: {
    background: StoredLayer
    objects: StoredLayer
    foreground: StoredLayer
  }
  regions: Region[]
  /** 点标记。旧存档没有这个字段 → 读回时补空数组，不报错 */
  marks?: Mark[]
  seq: number
  char: {
    x: number; y: number; w: number; h: number; speed: number
    ghostAlpha: number; anchorX: number; anchorY: number
    /** 脚底碰撞箱尺寸（判定用） */
    boxW: number; boxH: number
  }
}

/**
 * 工程 → 可序列化结构。
 *
 * includeImages=false（自动存档默认）时**不带图片**：
 * 三张 PNG 转 dataURL 后体积远超 localStorage 5MB 配额，
 * 带图保存必然抛 QuotaExceededError，而且每次写入都要把整张图重新编码一次。
 * 图片只在用户主动点「保存工程」时才随 .json 一起落盘。
 */
export function serializeProject(project: MapProject, includeImages = false): StoredProject {
  const pick = (id: LayerId) => {
    const L = project.layers[id]
    return {
      /* 只保留 dataURL；blob:/http: 一律视为不可持久化 */
      src: includeImages && L.img ? persistentSrc(L.img) : null,
      w: L.w,
      h: L.h,
      visible: L.visible,
      locked: L.locked,
      opacity: L.opacity,
    }
  }
  return {
    name: project.name,
    canvas: { ...project.canvas },
    layers: {
      background: pick('background'),
      objects: pick('objects'),
      foreground: pick('foreground'),
    },
    regions: project.regions.map(r => ({ ...r, points: r.points.map(p => ({ ...p })) })),
    marks: project.marks.map(m => ({
      ...m,
      tags: m.tags ? { ...m.tags } : undefined,
      patrol: m.patrol
        ? { loop: m.patrol.loop, points: m.patrol.points.map(p => ({ ...p })) }
        : undefined,
    })),
    seq: project.seq,
    char: normalizeChar(project.char),
  }
}

/**
 * 取一个可以长期保存的图片地址。
 *
 * 只有 dataURL 能进存档：blob: 会在解码完成后被 revoke，
 * 重新加载页面时必然失效。返回 null 表示「这张图不该被持久化」。
 */
export function persistentSrc(img: HTMLImageElement | null): string | null {
  if (!img) return null
  const src = img.src || ''
  if (src.startsWith('data:')) return src
  /* blob: / http: / file: 都不能用于跨会话恢复 */
  return null
}

/**
 * 读取一条巡逻路线。
 *
 * 存档里没有 patrol 字段 → 没有巡逻（返回 undefined）。
 * 路径点不足两个 → 没有意义，也当作没有巡逻。
 */
function readPatrol(raw: any): PatrolRoute | undefined {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.points)) return undefined
  const points = raw.points
    .filter((p: any) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    .map((p: any) => ({ x: +p.x, y: +p.y }))
  if (points.length < 2) return undefined
  return { points, loop: raw.loop !== false }
}

/** 可序列化结构 → 工程（图片需要外部注入 Image 元素） */
export function deserializeProject(
  data: StoredProject,
  images: { background?: HTMLImageElement | null; objects?: HTMLImageElement | null; foreground?: HTMLImageElement | null },
): MapProject {
  const regions: Region[] = (Array.isArray(data.regions) ? data.regions : []).map((r, i) => ({
    ...r,
    points: (r.points || []).map((p: Point) => ({ x: +p.x, y: +p.y })),
    seq: i,
  }))
  /* 旧存档没有 marks 字段 → 补空数组，不报错 */
  const marks: Mark[] = (Array.isArray(data.marks) ? data.marks : []).map(m => ({
    ...m,
    x: +m.x || 0,
    y: +m.y || 0,
    facing: m.facing || 'down',
    tags: m.tags ? { ...m.tags } : undefined,
    patrol: readPatrol(m.patrol),
  }))
  const layer = (raw: StoredLayer | undefined, img: HTMLImageElement | null): LayerState => ({
    img,
    w: raw?.w || 0,
    h: raw?.h || 0,
    visible: raw?.visible !== false,
    locked: !!raw?.locked,
    opacity: typeof raw?.opacity === 'number' ? raw.opacity : 1,
  })
  return {
    name: data.name || 'map',
    canvas: {
      w: +data.canvas?.w || 1920,
      h: +data.canvas?.h || 1080,
    },
    layers: {
      background: layer(data.layers?.background, images.background ?? null),
      objects: layer(data.layers?.objects, images.objects ?? null),
      /* 旧工程没有 foreground 字段 → 自动补一个空层，不报错 */
      foreground: layer(data.layers?.foreground, images.foreground ?? null),
    },
    regions,
    marks,
    seq: data.seq || regions.length,
    char: normalizeChar(data.char),
  }
}

/**
 * 角色参数归一化。
 * 旧存档没有 boxW / boxH（也没有合法范围）时回落到默认值，
 * 避免脏数据把碰撞箱变成 0 或负数导致角色永远卡住。
 */
export function normalizeChar(raw: Partial<CharState> | null | undefined): CharState {
  const c = { ...DEFAULT_CHAR, ...(raw || {}) }
  const num = (v: unknown, d: number): number => {
    const n = Number(v)
    return Number.isFinite(n) ? n : d
  }
  return {
    x: num(c.x, DEFAULT_CHAR.x),
    y: num(c.y, DEFAULT_CHAR.y),
    w: clamp(num(c.w, DEFAULT_CHAR.w), 8, 400),
    h: clamp(num(c.h, DEFAULT_CHAR.h), 8, 400),
    speed: clamp(num(c.speed, DEFAULT_CHAR.speed), 1, 40),
    ghostAlpha: clamp(num(c.ghostAlpha, DEFAULT_CHAR.ghostAlpha), 0.05, 1),
    anchorX: clamp(num(c.anchorX, DEFAULT_CHAR.anchorX), 0, 1),
    anchorY: clamp(num(c.anchorY, DEFAULT_CHAR.anchorY), 0, 1),
    boxW: clamp(num(c.boxW, DEFAULT_CHAR.boxW), FOOT_BOX_MIN, FOOT_BOX_MAX),
    boxH: clamp(num(c.boxH, DEFAULT_CHAR.boxH), FOOT_BOX_MIN, FOOT_BOX_MAX),
  }
}

/**
 * 写入浏览器本地存档（自动存档：不含图片）。
 *
 * 返回是否真的写成功了。失败时**不清空**已有存档 ——
 * 旧版在这里静默 catch，叠加上「图片 dataURL 撑爆配额」，
 * 结果是每次编辑都悄悄保存失败，用户直到关页面才发现东西全没了。
 */
export function saveLocal(project: MapProject): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeProject(project, false)))
    return true
  } catch (e) {
    console.warn('[存档] localStorage 写入失败，已保留上一份存档：', e)
    return false
  }
}

/** 读取浏览器本地存档（原始 JSON，图片需另行解码） */
export function readLocal(): StoredProject | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredProject
  } catch {
    return null
  }
}

/** 清除浏览器本地存档 */
export function clearLocal(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** 把 dataURL 解码成 Image */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('图片解码失败'))
    img.src = src
  })
}
