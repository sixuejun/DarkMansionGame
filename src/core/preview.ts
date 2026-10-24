import type { Bounds, MapProject, Point, Region } from '../types/map'
import { clamp, rectOfRegion, regionHitRect, sortByPriority, tracePath } from './geometry'
import { DEFAULT_CHAR } from './constants'

/**
 * 脚底碰撞箱。
 *
 * 判定原则（开发文档第四章补充）：角色能否通行只看这个盒子，
 * 与立绘外框 char.w/char.h 完全无关。密集红区里只要脚底盒子不重叠就能走过去。
 */
export function footBox(project: MapProject): Bounds {
  const c = project.char
  const w = Math.max(1, c.boxW || DEFAULT_CHAR.boxW)
  const h = Math.max(1, c.boxH || DEFAULT_CHAR.boxH)
  return { x: c.x - w / 2, y: c.y - h / 2, w, h }
}

/** 立绘外框（仅用于显示 / 命中拖拽，不参与碰撞） */
export function charRect(project: MapProject): Bounds {
  const c = project.char
  return { x: c.x - c.w * c.anchorX, y: c.y - c.h * c.anchorY, w: c.w, h: c.h }
}

/** 脚底锚点（世界坐标） */
export function footPoint(project: MapProject): Point {
  return { x: project.char.x, y: project.char.y }
}

/**
 * 判断角色遮挡状态。
 * 只用角色脚底锚点（boxW×boxH 的小盒）判断是否进入紫色遮挡区域。
 *
 * 紫色区域只决定角色是否降层，不携带任何外观参数：
 * 正常角色始终完整、不透明地绘制，副本透明度是全局预览参数。
 *
 * ⚠ 命中哪个紫色区会影响**哪一层被切到角色上方**（见 layerSlices），
 *   所以 winner 必须返回具体区域，不能只返回一个布尔值。
 */
export function charState(project: MapProject): {
  rect: Bounds
  foot: Bounds
  winner: Region | null
  occluded: boolean
} {
  const rect = charRect(project)
  const foot = footBox(project)
  let winner: Region | null = null

  // 用角色脚底碰撞箱判定是否进入紫色遮挡区域（不按整个立绘）
  for (const r of sortByPriority(project.regions)) {
    if (r.type !== 'occlusion') continue
    if (regionHitRect(r, foot)) {
      winner = r
      break
    }
  }

  return { rect, foot, winner, occluded: !!winner }
}

/**
 * 脚底碰撞箱当前与哪些红区重叠（返回命中的区域）。
 *
 * 两个用途：
 * 1. 区分「位置本来就非法」（脚底踩在红区里）和「移动后非法」；
 * 2. 判定某个方向是否被红区挡住 —— 重叠列表非空即被挡。
 *
 * ⚠ 这是「站不站得住 / 走不走得通」的**唯一真相**。
 *   导航模块（core/nav.ts）必须复用本函数，绝不允许自己再写一套判定，
 *   否则会出现「编辑器说这条路能走、游戏里走不通」。
 *   运行器也必须复用同一份实现（见开发文档「运行器复用约定」）。
 */
export function overlappingRegions(project: MapProject, x: number, y: number): Region[] {
  const bw = Math.max(1, project.char.boxW || DEFAULT_CHAR.boxW)
  const bh = Math.max(1, project.char.boxH || DEFAULT_CHAR.boxH)
  const rect: Bounds = { x: x - bw / 2, y: y - bh / 2, w: bw, h: bh }
  const hits: Region[] = []
  for (const reg of project.regions) {
    if (reg.type !== 'collision') continue
    if (regionHitRect(reg, rect)) hits.push(reg)
  }
  return hits
}

/** 脚底碰撞箱在 (x, y) 处的矩形 */
function footRectAt(project: MapProject, x: number, y: number): Bounds {
  const bw = Math.max(1, project.char.boxW || DEFAULT_CHAR.boxW)
  const bh = Math.max(1, project.char.boxH || DEFAULT_CHAR.boxH)
  return { x: x - bw / 2, y: y - bh / 2, w: bw, h: bh }
}

/**
 * 脚底碰撞箱要完全脱离某个红区，还差多少像素（四方向取最小值）。
 *
 * 即「最小平移距离」的简化版：按包围盒计算。
 * 角色完全陷在红区内部时，这个值就是它还需要挪多远才能出来。
 */
function exitDistance(rect: Bounds, reg: Region): number {
  const b = rectOfRegion(reg)
  const up = (rect.y + rect.h) - b.y
  const down = (b.y + b.h) - rect.y
  const left = (rect.x + rect.w) - b.x
  const right = (b.x + b.w) - rect.x
  return Math.max(0, Math.min(up, down, left, right))
}

/**
 * 脱困判定：当前踩在红区里时，某个候选位置是否算「在往外走」。
 *
 * 规则（同时满足才允许移动）：
 * 1. 候选位置完全不压任何红区 → 直接放行（已经脱困）；
 * 2. 候选位置压到的红区必须是当前就压着的那些（不能顺手钻进新的红区）；
 * 3. 对每一个仍然压着的红区，脚底盒到「完全脱离它」的距离必须严格变小。
 *
 * 这样既保证了「从合法位置绝对进不去红区」，
 * 又让陷在红区里的角色能一步一步蹭出来，而不会在墙里越走越深。
 */
function canEscape(
  curOverlaps: Region[],
  curRect: Bounds,
  candOverlaps: Region[],
  candRect: Bounds,
): boolean {
  if (!candOverlaps.length) return true
  for (const cand of candOverlaps) {
    const cur = curOverlaps.find(r => r.id === cand.id)
    if (!cur) return false
    if (exitDistance(candRect, cand) >= exitDistance(curRect, cur)) return false
  }
  return true
}

/**
 * 角色是否已经「踩在红区里」（脚底碰撞箱与红区有重叠）。
 *
 * 这是一个非法起点，常见于：画红区时把角色圈了进去、
 * 导入的碰撞箱正好压住角色、或把碰撞箱调大后角色被红区吞掉。
 */
export function footInsideCollision(project: MapProject): boolean {
  return overlappingRegions(project, project.char.x, project.char.y).length > 0
}

/**
 * 尝试移动角色：脚底碰撞箱被红区阻挡或越界时返回 false。
 *
 * 关键：这里检查的是 footBox 而不是立绘外框。
 * 旧实现拿整个立绘矩形去撞红区，导致密集小碰撞箱的场景里角色一步都走不动。
 *
 * 四个容易踩的坑，这里一并处理掉：
 *
 * 1. **单步跳跃**：一帧走 5px，若前方 3px 处有墙，整步都会被否掉，
 *    角色会「贴着墙抖」却再也前进不了。这里把位移拆成 ≤1px 的子步逐步推进。
 * 2. **卡在缝里**：角色被挤进两框之间的窄缝时，两侧都会挡住整步。
 *    拆轴处理 + 子步推进后，仍能沿缝走出剩余的几像素余量。
 * 3. **斜向卡死**：同时给 x 和 y 时，两轴互相否决导致原地不动。
 *    因此 x / y 分开判定，能走哪轴走哪轴（即沿墙滑动）。
 * 4. **踩在红区里彻底卡死**：这是「密集碰撞区里角色一步都走不掉」的真凶。
 *    起点已经压在红区上时，**任何**目标位置都仍然压在红区上，
 *    于是每一步都被否决 → 角色被永久锁死，四面八方都出不来。
 *    修法：处于非法起点时，允许移动到「更靠近脱离红区」的位置，
 *    让角色能一步步蹭出去，同时绝不允许它钻进新红区或往墙里越走越深。
 *    注意：从合法位置出发时，规则不变 —— 红区绝对进不去。
 */
export function tryMoveChar(project: MapProject, dx: number, dy: number): boolean {
  const MAX_SUB = 1

  /* 先把可能越界的锚点拉回合法范围。
     画布尺寸被改小、或碰撞箱被调大时，角色可能已经处于越界位置；
     若不先归位，后续每个子步都会被越界判定挡住，角色就彻底动不了了。 */
  clampChar(project)

  /* 越界单独判断：越界位置没有「往里蹭」的余地，一律非法。 */
  const outOfBounds = (x: number, y: number): boolean => {
    const bw = Math.max(1, project.char.boxW || DEFAULT_CHAR.boxW)
    const bh = Math.max(1, project.char.boxH || DEFAULT_CHAR.boxH)
    return x - bw / 2 < 0 || y - bh / 2 < 0 ||
           x + bw / 2 > project.canvas.w || y + bh / 2 > project.canvas.h
  }

  /* 每个子步都重新读取「当前踩在哪些红区里」。
     关键：不能只在函数入口算一次。
     脱困过程中一旦完全离开红区，下一个子步必须立刻切回严格判定；
     否则会继续用宽松的脱困规则一路往墙里走（实测能穿进墙内 100px 以上）。 */
  const moveAxis = (axis: 'x' | 'y'): boolean => {
    const d = axis === 'x' ? dx : dy
    if (!d) return false
    const steps = Math.max(1, Math.ceil(Math.abs(d) / MAX_SUB))
    const inc = d / steps
    let moved = false
    for (let i = 0; i < steps; i++) {
      const nx = axis === 'x' ? project.char.x + inc : project.char.x
      const ny = axis === 'y' ? project.char.y + inc : project.char.y
      if (outOfBounds(nx, ny)) break

      const curOverlaps = overlappingRegions(project, project.char.x, project.char.y)
      const candOverlaps = overlappingRegions(project, nx, ny)

      if (curOverlaps.length > 0) {
        /* 脱困模式：只允许「更靠近脱离红区」的方向。规则见 canEscape()：
           不能钻进新红区，且必须离当前踩着的红区更近。 */
        if (!canEscape(
          curOverlaps, footRectAt(project, project.char.x, project.char.y),
          candOverlaps, footRectAt(project, nx, ny),
        )) break
      } else if (candOverlaps.length > 0) {
        /* 起点合法：红区一步都进不去 */
        break
      }

      project.char.x = nx
      project.char.y = ny
      moved = true
    }
    return moved
  }

  const movedX = moveAxis('x')
  const movedY = moveAxis('y')
  return movedX || movedY
}

/** 脚底碰撞箱当前命中的第一个碰撞层区域（只用于调试配色 / 提示） */
export function collisionAtFoot(project: MapProject): Region | null {
  const foot = footBox(project)
  for (const reg of project.regions) {
    if (reg.type !== 'collision') continue
    if (regionHitRect(reg, foot)) return reg
  }
  return null
}

/**
 * 黄色调节区域（adjust）：用于定义角色身体哪些部分可以正常显示（不透明）。
 * 同时也用于生成黑层上下片。
 */
export function adjustRegions(project: MapProject): Region[] {
  return project.regions.filter(r => r.type === 'adjust' && (r.target === 'objects' || r.target === 'both'))
}

/**
 * 紫色遮挡区域（occlusion）：触发角色进入遮挡状态。
 * 角色脚底进入后，开始双重绘制模式。
 */
export function occlusionRegions(project: MapProject): Region[] {
  return project.regions.filter(r => r.type === 'occlusion')
}

/** 参与区域切片的两张图片层（前景层永远压在角色之上，不参与切片） */
export type SliceLayer = 'background' | 'objects'

/**
 * 区域的作用目标是否覆盖某一层。
 *
 * `both` 覆盖两层；`foreground` 不覆盖任何一张（前景层有自己的淡化机制）。
 * 这是「白层也能被裁剪到最上层 / 变成遮挡物」的数据基础。
 */
export function targetCovers(target: Region['target'], layer: SliceLayer): boolean {
  return target === 'both' || target === layer
}

/**
 * 绿色最上层区域（top）：始终显示在角色前方。
 *
 * ⚠ target 语义（这里曾经是三个 bug 的根源）：
 *   - `background` = 白层片段提到角色上方
 *   - `objects`    = 黑层片段提到角色上方
 *   - `both`       = 两层都提
 * 之前这里只认 objects / both，把 `background` 直接过滤掉了，
 * 于是「白层设成最上层」会走到 tops.length === 0 的早退分支，
 * 整个最上层一个像素都不画 —— 看起来就是「设了也没反应」。
 */
export function topRegions(project: MapProject): Region[] {
  return project.regions.filter(r => r.type === 'top' && r.target !== 'foreground')
}

/** 某层是否参与 top 区域（绿色最上层） */
export function topAppliesTo(target: Region['target'], layer: SliceLayer): boolean {
  return targetCovers(target, layer)
}

/**
 * 某层在遮挡状态下的「遮挡区」：紫色区域中 target 覆盖该层的那些。
 *
 * 这些区域里的该层像素会画到角色**上方**（成为遮挡物），
 * 区域外的该层像素留在角色**下方**。
 */
export function occlusionCovers(project: MapProject, layer: SliceLayer): Region[] {
  return project.regions.filter(r => r.type === 'occlusion' && targetCovers(r.target, layer))
}

/** 某层的「洞」：黄色区域。在前片上开洞，洞内该层像素落到角色下方，角色完整可见。 */
export function holeRegions(project: MapProject, layer: SliceLayer): Region[] {
  return project.regions.filter(r => r.type === 'adjust' && targetCovers(r.target, layer))
}

/** 某层参与 top 区域（提到最顶）的那几个区域 */
export function topRegionsFor(project: MapProject, layer: SliceLayer): Region[] {
  return topRegions(project).filter(r => targetCovers(r.target, layer))
}

/**
 * 某层当前生效的紫色遮挡区。
 *
 * 返回 null 表示「这个紫色区不作用于这一层」——
 * 比如紫色区只作用在白层时，黑层不参与这次的遮挡切分。
 */
export function activeOcclusionFor(
  layer: SliceLayer,
  active: Region | null,
): Region | null {
  if (!active) return null
  if (active.type !== 'occlusion') return null
  return targetCovers(active.target, layer) ? active : null
}

/* ------------------------------------------------------------------ */
/* 绿色最上层缓存                                                      */
/* ------------------------------------------------------------------ */

interface TopCacheEntry {
  key: string
  canvas: HTMLCanvasElement | null
}

let topCache: TopCacheEntry | null = null

/** 清除绿色最上层缓存（改区域 / 换图时调用） */
export function invalidateTopCache(): void {
  topCache = null
}

/* ------------------------------------------------------------------ */
/* 分层切片                                                            */
/* ------------------------------------------------------------------ */

/**
 * 一层在当前状态下的四段切片。
 *
 * ## 为什么白层也要能切
 *
 * 「白层永远在最底下」是个错误的设计假设。
 * 实际场景里，场景图（白层）上同样会有需要挡住角色的东西 —— 屋檐、树冠、门框；
 * 如果这些东西只能画在黑层上，两张 PNG 的分工就被固化了，
 * 「最上层 / 遮挡层可以作用在白层上」这个选项也就成了摆设。
 *
 * 所以白层与黑层共用同一套切片机制，区别只在**默认谁在角色上方**：
 *   - 黑层：默认在角色上方（进入紫色区后按黄色区域开洞）
 *   - 白层：默认在角色下方（要挡住角色必须显式用 top 区或紫色区提上来）
 *
 * 四段的含义：
 *   full  —— 该层的完整内容（扣掉被 top 挑走的部分）
 *   below —— 画在角色下方
 *   above —— 画在角色上方，成为遮挡物
 *   top   —— 画在最顶（绿色最上层阶段，位于前景层之上）
 */
export interface LayerSlices {
  /** 完整内容（已扣掉 top 区域）。没有 top 区域时直接复用原图，不额外占内存 */
  full: HTMLCanvasElement | HTMLImageElement | null
  below: HTMLCanvasElement | HTMLImageElement | null
  above: HTMLCanvasElement | HTMLImageElement | null
  top: HTMLCanvasElement | HTMLImageElement | null
}

/** 若干区域合并成的蒙版（白色 = 在区域内） */
function maskFromRegions(w: number, h: number, regions: Region[]): HTMLCanvasElement {
  const cv = createOffscreen(w, h)
  const ctx = cv.getContext('2d')
  if (!ctx) return cv
  ctx.fillStyle = '#fff'
  for (const r of regions) {
    tracePath(ctx, r)
    ctx.fill()
  }
  return cv
}

/** 蒙版相减：a 去掉 b 覆盖的部分 */
function subtractMask(w: number, h: number, a: HTMLCanvasElement, b: HTMLCanvasElement): HTMLCanvasElement {
  const cv = createOffscreen(w, h)
  const ctx = cv.getContext('2d')
  if (!ctx) return cv
  ctx.drawImage(a, 0, 0)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.drawImage(b, 0, 0)
  return cv
}

/** 图层像素与蒙版求交（只保留蒙版内的像素） */
function layerIntersect(
  src: CanvasImageSource, w: number, h: number, mask: HTMLCanvasElement,
): HTMLCanvasElement {
  const cv = createOffscreen(w, h)
  const ctx = cv.getContext('2d')
  if (!ctx) return cv
  ctx.drawImage(src, 0, 0, w, h)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(mask, 0, 0)
  return cv
}

/** 图层像素减去蒙版（去掉蒙版内的像素） */
function layerSubtract(
  src: CanvasImageSource, w: number, h: number, mask: HTMLCanvasElement,
): HTMLCanvasElement {
  const cv = createOffscreen(w, h)
  const ctx = cv.getContext('2d')
  if (!ctx) return cv
  ctx.drawImage(src, 0, 0, w, h)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.drawImage(mask, 0, 0)
  return cv
}

/** 参与缓存签名的区域快照（几何 + target 都要，target 变了取像的层就变了） */
function regionSignature(regions: Region[]): string {
  const parts: string[] = []
  for (const r of regions) {
    parts.push(r.id, r.target, r.shape, String(r.points.length))
    for (const p of r.points) parts.push(p.x.toFixed(2) + ',' + p.y.toFixed(2))
  }
  return parts.join(';')
}

/** 创建一块与画布同尺寸的离屏画布 */
export function createOffscreen(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/**
 * 生成某层「黄色区域合并蒙版」。
 * 将所有对该层生效的黄色调节区域（adjust）合并为一个白色蒙版画布。
 *
 * 关键：即使没有任何黄色区域，也必须返回一张「全透明」的画布，
 * 而不能返回 null —— 否则下片/上片会被整体跳过，
 * 造成「紫色区域内没有黄色区域时该层整个消失」。
 * 全透明蒙版经 destination-in 得出全透明下片（正确），
 * 经 destination-out 得出完整层（正是期望结果）。
 */
export function buildAdjustMask(project: MapProject, layer: SliceLayer = 'objects'): HTMLCanvasElement {
  const adjusts = holeRegions(project, layer)
  const cv = createOffscreen(project.canvas.w, project.canvas.h)
  const ctx = cv.getContext('2d')
  if (!ctx) return cv

  ctx.fillStyle = '#fff'
  for (const r of adjusts) {
    tracePath(ctx, r)
    ctx.fill()
  }

  return cv
}

/**
 * 切片缓存：某层的切片只在「相关区域 / 该层图片 / 画布尺寸」变化时才重新生成。
 *
 * 之前 buildObjectsLower / buildObjectsUpper 在 Vue 的 computed 里被逐帧调用，
 * 角色每移动一帧就要重新切两张全尺寸画布 —— 这是移动卡顿的主要来源。
 * 这里按签名缓存，命中则直接复用。
 *
 * ⚠ 缓存按层分开存：白层和黑层各有一份，
 * 交替调用两个层时不能共用同一个槽位（否则每次都判定为未命中，缓存形同虚设）。
 */
interface SliceCacheEntry {
  key: string
  slices: LayerSlices
}

const sliceCaches: Record<SliceLayer, SliceCacheEntry | null> = {
  background: null,
  objects: null,
}

/** 清除切片缓存（导入 / 换图 / 区域数据变化时调用） */
export function invalidateSliceCache(): void {
  sliceCaches.background = null
  sliceCaches.objects = null
}

/**
 * 某层在当前遮挡状态下的完整切片（带缓存）。
 *
 * ## 切片规则
 *
 * 一层的像素被切成四段：
 *
 * | 段 | 画在哪 | 内容 |
 * | -- | ------ | ---- |
 * | full  | —— | 该层扣掉 top 区域后的完整内容 |
 * | below | 角色**下方** | 白层：整层；黑层：黄色区域内的部分 |
 * | above | 角色**上方** | 白层：紫区内的部分；黑层：黄色区域外的部分 |
 * | top   | 最顶（前景层之上） | 绿色最上层区域内的部分 |
 *
 * ## 白层与黑层的区别
 *
 * 两层走的是**同一套机制**，但「谁默认在角色上方」不同：
 *
 * - **黑层**：进入紫色区后默认整层在角色上方（黄色区开洞让角色露出来）。
 * - **白层**：默认整层在角色**下方**。这是场景图的常规形态 ——
 *   地面、墙壁本来就在角色身后。
 *
 * ## 白层怎么变成遮挡物
 *
 * 命中一个 `target` 覆盖白层的紫色区时，该紫区**内部**的白层像素
 * 会额外画到角色上方，成为遮挡物；紫区之外的白层照旧留在角色下方。
 *
 * 紫区内部的白层**同时**保留在下方那一份 ——
 * 场景不能因为角色挡住了就缺一块（否则地上会露出一个洞）。
 *
 * 这就是「白层不再是永远在最底下」的落地方式，
 * 同时也保证「最上层 / 遮挡层可以作用在白层上」不是摆设。
 */
export function layerSlices(
  project: MapProject,
  layer: SliceLayer,
  active: Region | null,
): LayerSlices {
  const L = project.layers[layer]
  const occ = activeOcclusionFor(layer, active)
  const tops = topRegionsFor(project, layer)
  const holes = holeRegions(project, layer)

  const key = [
    layer,
    L.img ? L.img.src || 'img' : 'none',
    L.w, L.h,
    project.canvas.w, project.canvas.h,
    regionSignature(holes),
    regionSignature(tops),
    /* 只有白层的切片依赖当前命中的紫区，黑层不受影响 ——
       不把它算进签名，就能在不同紫区之间移动时复用黑层缓存。 */
    layer === 'background' && occ ? regionSignature([occ]) : 'none',
  ].join('|')

  const cached = sliceCaches[layer]
  if (cached && cached.key === key) return cached.slices

  const slices = buildLayerSlices(project, layer, occ, tops, holes)
  sliceCaches[layer] = { key, slices }
  return slices
}

/**
 * 真正做切片的实现（无缓存）。
 *
 * 关键点：
 * 1. `top` 区域优先：被 top 挑走的像素**不在** below/above 里出现，
 *    否则同一块像素会在下面留一份、上面又叠一份，角色被挡两次。
 * 2. 黄色区（adjust）在黑层上开洞：洞内像素落到 below，角色完整可见。
 * 3. 白层被紫色区「提」到角色上方：紫区内的白层像素额外画一份在上面。
 */
function buildLayerSlices(
  project: MapProject,
  layer: SliceLayer,
  occ: Region | null,
  tops: Region[],
  holes: Region[],
): LayerSlices {
  const L = project.layers[layer]
  const W = project.canvas.w
  const H = project.canvas.h
  if (!L.img) return { full: null, below: null, above: null, top: null }

  /* 1. top 区域：这些像素要被提到最顶，先从这一层里挖掉 */
  const topMask = maskFromRegions(W, H, tops)

  /* 2. 当前命中的紫区（只对白层有意义） */
  const occMask = occ ? maskFromRegions(W, H, [occ]) : null

  /* 3. 黄区：黑层在黄区内开洞 */
  const holeMask = maskFromRegions(W, H, holes)

  /* 4. 完整内容：扣掉 top 区域 */
  const full = tops.length ? layerSubtract(L.img, W, H, topMask) : L.img

  /* 5. top 段 */
  const top = tops.length ? layerIntersect(L.img, W, H, topMask) : null

  let below: HTMLCanvasElement | HTMLImageElement | null
  let above: HTMLCanvasElement | HTMLImageElement | null

  if (layer === 'background') {
    /* 白层：默认整层在角色下方 */
    if (occMask) {
      /* 紫区内部的白层提到角色上方成为遮挡物。
         紫区外的白层留在下方（下面那份要把紫区挖掉，
         否则同一块像素会在下面留一份、上面又叠一份，角色被挡两次，
         而且图层透明度 < 1 时还会叠出更亮的一块）。 */
      const occInterior = tops.length ? subtractMask(W, H, occMask, topMask) : occMask
      above = layerIntersect(L.img, W, H, occInterior)
      below = layerSubtract(full, W, H, occInterior)
    } else {
      below = full
      above = null
    }
  } else {
    /* 黑层：
       - below = 黄区内的像素（角色完整可见）
       - above = 整层 − 黄区（物件盖住角色）
       没有黄区时 below 全透明、above = 整层 —— 这正是
       「紫色区域内没有黄色区域时黑层仍完整遮挡角色」的实现。 */
    const holeNoTop = tops.length ? subtractMask(W, H, holeMask, topMask) : holeMask
    below = layerIntersect(L.img, W, H, holeNoTop)
    above = layerSubtract(full, W, H, holeNoTop)
  }

  return { full, below, above, top }
}

/** 黑层上下片（带缓存）—— 保持旧签名，内部改走 layerSlices。 */
export function objectsSlices(project: MapProject): {
  lower: HTMLCanvasElement | HTMLImageElement | null
  upper: HTMLCanvasElement | HTMLImageElement | null
} {
  const s = layerSlices(project, 'objects', null)
  return { lower: s.below, upper: s.above }
}

/** 生成某层下片（lower）—— 兼容旧调用。 */
export function buildLayerLower(project: MapProject, layer: SliceLayer): HTMLCanvasElement | HTMLImageElement | null {
  return layerSlices(project, layer, null).below
}

/**
 * 生成某层上片（upper）—— 兼容旧调用。
 */
export function buildLayerUpper(project: MapProject, layer: SliceLayer): HTMLCanvasElement | HTMLImageElement | null {
  return layerSlices(project, layer, null).above
}

/** 生成黑层下片（objects_lower）—— 兼容旧调用。 */
export function buildObjectsLower(project: MapProject): HTMLCanvasElement | HTMLImageElement | null {
  return buildLayerLower(project, 'objects')
}

/** 生成黑层上片（objects_upper）—— 兼容旧调用。 */
export function buildObjectsUpper(project: MapProject): HTMLCanvasElement | HTMLImageElement | null {
  return buildLayerUpper(project, 'objects')
}

/**
 * 生成绿色最上层图片：所有 top 区域内的像素（按 target 分别取两层再叠加）。
 * 始终显示在角色前方，不受遮挡状态影响。
 *
 * ⚠ 关键：top 区域可以作用于**白层**（background）。
 *   所以这里必须按 target 分别处理两层：
 *     target=background → 取白层像素
 *     target=objects    → 取黑层像素
 *     target=both       → 两层都取
 *   之前这里硬编码 `project.layers.objects.img`，
 *   于是「白层设成最上层」永远取不到白层的美术 —— 设计上等于没用。
 *
 * 缓存：top 区域很少改，按签名缓存避免每帧重切两张全尺寸画布。
 */
export function buildTopObjects(project: MapProject): HTMLCanvasElement | null {
  const ob = project.layers.objects
  const bg = project.layers.background
  if (!ob.img && !bg.img) return null

  const tops = topRegions(project)
  if (!tops.length) return null

  const key = [
    bg.img ? bg.img.src || 'img' : 'none',
    ob.img ? ob.img.src || 'img' : 'none',
    bg.opacity, ob.opacity,
    project.canvas.w, project.canvas.h,
    regionSignature(tops),
  ].join('|')
  if (topCache && topCache.key === key) return topCache.canvas

  const cv = createOffscreen(project.canvas.w, project.canvas.h)
  const ctx = cv.getContext('2d')
  if (!ctx) return null

  /* 按层分别取像再叠加：一个 top 区域只取它 target 指定的那层。
     每层用各自的蒙版（只含作用到该层的区域），避免 target 串层。

     ⚠ 合成时必须带上各层自己的 opacity：
       白层和黑层的透明度是独立设置的，
       若在合成后再统一套一个 opacity 就会算错。
       这里把透明度烘进合成结果，绘制时用 opacity=1。 */
  for (const id of ['background', 'objects'] as const) {
    const src = id === 'background' ? bg.img : ob.img
    if (!src) continue

    const m = maskFromRegions(project.canvas.w, project.canvas.h, tops.filter(r => topAppliesTo(r.target, id)))
    ctx.globalAlpha = id === 'background' ? bg.opacity : ob.opacity
    ctx.drawImage(layerIntersect(src, project.canvas.w, project.canvas.h, m), 0, 0)
  }
  ctx.globalAlpha = 1

  topCache = { key, canvas: cv }
  return cv
}

/** 角色脚底锚点钳制到画布内（按碰撞箱留边，立绘允许超出画布） */
export function clampChar(project: MapProject): void {
  const c = project.char
  const hw = Math.max(1, c.boxW || DEFAULT_CHAR.boxW) / 2
  const hh = Math.max(1, c.boxH || DEFAULT_CHAR.boxH) / 2
  c.x = clamp(c.x, hw, project.canvas.w - hw)
  c.y = clamp(c.y, hh, project.canvas.h - hh)
}
