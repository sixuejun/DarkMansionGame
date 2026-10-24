import type { MapProject, Point } from '../types/map'
import { DEFAULT_CHAR } from './constants'
import { rectOfRegion, regionHitRect } from './geometry'
import { overlappingRegions, tryMoveChar } from './preview'

/**
 * 导航模块：栅格化 / 连通性 / 最短路径。
 *
 * ## 与运行器的一致性约定（最重要）
 *
 * 判定「这个位置站不站得住」的**唯一真相**是 `preview.ts` 的 `overlappingRegions`。
 * 本模块所有可通行性判断都通过它完成，绝不自己另写一套「点是否在红区里」。
 *
 * 多边形碰撞判定是**保守近似**（斜墙会多挡一点），
 * 对导航而言这是好事 —— 宁可判窄一点，也不要让角色卡进斜墙。
 * 但这也意味着运行器必须复用同一份代码，否则预览结论不可信。
 */

/** 角色的脚底盒尺寸（判定用，与立绘无关） */
function footBoxSize(project: MapProject): { w: number; h: number } {
  return {
    w: Math.max(1, project.char.boxW || DEFAULT_CHAR.boxW),
    h: Math.max(1, project.char.boxH || DEFAULT_CHAR.boxH),
  }
}

/**
 * 参与判定的碰撞区几何签名。
 *
 * 只包含 collision 区域（紫区 / 黄区 / 淡化区不影响通行性），
 * **必须**包含角色的 boxW / boxH —— 改了这两个值，
 * 「哪些格子站得下人」就变了，不重算会给出过期结论。
 */
export function collisionSignature(project: MapProject): string {
  const parts: string[] = []
  for (const r of project.regions) {
    if (r.type !== 'collision') continue
    parts.push(r.id, r.shape)
    for (const p of r.points) parts.push(p.x.toFixed(2) + ',' + p.y.toFixed(2))
  }
  const f = footBoxSize(project)
  parts.push('box', f.w.toFixed(2), f.h.toFixed(2))
  parts.push('canvas', String(project.canvas.w), String(project.canvas.h))
  return parts.join(';')
}

/** 栅格化结果 */
export interface NavGrid {
  /** 格子边长（地图像素） */
  cell: number
  /** 网格列数 / 行数 */
  cols: number
  rows: number
  /** 每个格子是否可通行 */
  passable: Uint8Array
  /** 签名（用于缓存失效判断） */
  sig: string
}

function idx(grid: NavGrid, cx: number, cy: number): number {
  return cy * grid.cols + cx
}

/** 格子坐标 → 格子中心的世界坐标 */
function centerOf(grid: NavGrid, cx: number, cy: number): Point {
  return { x: cx * grid.cell + grid.cell / 2, y: cy * grid.cell + grid.cell / 2 }
}

/**
 * 选一个格子边长。
 *
 * 目标是**足够细**，这样窄门 / 窄道不会被漏判：
 *   按整个脚底盒宽取格时，采样点容易正好落在墙沿上，
 *   一条明明能挤过去的走廊会被误判成封死。
 * 基准取 2px（远小于默认 14px 的脚底盒），再按画布面积封顶，
 * 避免超大画布把内存吃光。
 */
function pickCell(w: number, h: number): number {
  const MAX_CELLS = 2_000_000
  let cell = 2
  while (Math.ceil(w / cell) * Math.ceil(h / cell) > MAX_CELLS) cell *= 2
  return cell
}

/**
 * 栅格化整张地图。
 *
 * 矩形墙走「膨胀矩形」精确标记：
 *   脚底盒与矩形墙相交 ⟺ 格子中心落在「墙向外扩半个盒」的矩形内。
 * 这个等价关系是**精确**的（不是近似），所以矩形墙可以整片标记，
 * 代价只跟墙的面积成正比，跟画布大小无关。
 *
 * 多边形墙必须逐格判定（判定本身是保守近似，没法用矩形代替），
 * 也只扫它自己的包围盒。
 */
export function buildGrid(project: MapProject): NavGrid {
  const { w: bw, h: bh } = footBoxSize(project)
  const hw = bw / 2
  const hh = bh / 2
  const cell = pickCell(project.canvas.w, project.canvas.h)
  const cols = Math.max(1, Math.ceil(project.canvas.w / cell))
  const rows = Math.max(1, Math.ceil(project.canvas.h / cell))
  const passable = new Uint8Array(cols * rows).fill(1)

  const block = (cx: number, cy: number): void => {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return
    passable[cy * cols + cx] = 0
  }

  for (const reg of project.regions) {
    if (reg.type !== 'collision') continue
    if (reg.shape === 'rect') {
      /* 膨胀后的矩形：格子中心落在这个开区间内即被挡 */
      const b = rectOfRegion(reg)
      const x0 = b.x - hw
      const x1 = b.x + b.w + hw
      const y0 = b.y - hh
      const y1 = b.y + b.h + hh
      const c0 = Math.max(0, Math.floor(x0 / cell))
      const c1 = Math.min(cols - 1, Math.ceil(x1 / cell))
      const r0 = Math.max(0, Math.floor(y0 / cell))
      const r1 = Math.min(rows - 1, Math.ceil(y1 / cell))
      for (let cy = r0; cy <= r1; cy++) {
        const c = centerOf({ cell, cols, rows, passable, sig: '' } as NavGrid, 0, cy)
        if (c.y <= y0 || c.y >= y1) continue
        for (let cx = c0; cx <= c1; cx++) {
          const p = centerOf({ cell, cols, rows, passable, sig: '' } as NavGrid, cx, cy)
          if (p.x > x0 && p.x < x1) block(cx, cy)
        }
      }
    } else {
      /* 多边形：逐格判定（用同一份 regionHitRect），只扫自己的包围盒 */
      const b = rectOfRegion(reg)
      const c0 = Math.max(0, Math.floor((b.x - hw) / cell))
      const c1 = Math.min(cols - 1, Math.ceil((b.x + b.w + hw) / cell))
      const r0 = Math.max(0, Math.floor((b.y - hh) / cell))
      const r1 = Math.min(rows - 1, Math.ceil((b.y + b.h + hh) / cell))
      for (let cy = r0; cy <= r1; cy++) {
        const c = centerOf({ cell, cols, rows, passable, sig: '' } as NavGrid, 0, cy)
        if (c.y + hh <= b.y || c.y - hh >= b.y + b.h) continue
        for (let cx = c0; cx <= c1; cx++) {
          const p = centerOf({ cell, cols, rows, passable, sig: '' } as NavGrid, cx, cy)
          if (p.x + hw <= b.x || p.x - hw >= b.x + b.w) continue
          const box = { x: p.x - hw, y: p.y - hh, w: bw, h: bh }
          if (regionHitRect(reg, box)) block(cx, cy)
        }
      }
    }
  }

  /* 越界的格子不可通行（与 tryMoveChar 的越界判定一致）。
     只扫边框一圈，不必遍历整张网格。 */
  const frame = Math.ceil(Math.max(bw, bh) / 2 / cell) + 1
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (cx >= frame && cx < cols - frame && cy >= frame && cy < rows - frame) continue
      const c = centerOf({ cell, cols, rows, passable, sig: '' } as NavGrid, cx, cy)
      if (c.x - hw < 0 || c.y - hh < 0 ||
          c.x + hw > project.canvas.w || c.y + hh > project.canvas.h) {
        block(cx, cy)
      }
    }
  }

  return { cell, cols, rows, passable, sig: collisionSignature(project) }
}

/* ------------------------------------------------------------------ */
/* 缓存                                                                */
/* ------------------------------------------------------------------ */

let gridCache: NavGrid | null = null

/** 清除导航缓存（红区或角色尺寸变化时自动失效，这里供手动调用） */
export function invalidateNavCache(): void {
  gridCache = null
}

/** 取当前工程的栅格（按签名缓存，签名变了自动重建） */
export function navGrid(project: MapProject): NavGrid {
  const sig = collisionSignature(project)
  if (gridCache && gridCache.sig === sig) return gridCache
  gridCache = buildGrid(project)
  return gridCache
}

/* ------------------------------------------------------------------ */
/* 站不站得住                                                          */
/* ------------------------------------------------------------------ */

/** 可选的脚底盒覆盖（标记可以有自己的尺寸，缺省用角色的） */
export interface FootBoxOverride {
  boxW?: number
  boxH?: number
}

/**
 * 造一份「不依赖角色实时坐标」的工程视图，供判定 / 寻路使用。
 *
 * ## 为什么必须专门造一份
 *
 * 调用方（画布上的 computed）会把本函数读到的属性登记成响应式依赖。
 * 只要这里读了 `project.char.x` / `project.char.y`，
 * 预览模式里角色每移动一帧，这些 computed 就全部失效重算 ——
 * 一次路线展开要跑 A*（大画布上几十毫秒），多条路线直接卡死。
 *
 * 所以这份视图**只列出判定真正需要的字段**，一个不多：
 *   · regions  —— 碰撞区几何
 *   · canvas  —— 画布尺寸（越界判定）
 *   · char    —— 只保留脚底盒尺寸，用常量打底其余字段
 *
 * ⚠ 绝不能写 `{ ...project }`：展开会把 char 整个读一遍（连带实时坐标），
 *   依赖照样建立起来，问题原封不动。
 */
function navView(project: MapProject, boxW: number, boxH: number): MapProject {
  return {
    name: project.name,
    canvas: project.canvas,
    layers: project.layers,
    regions: project.regions,
    marks: project.marks,
    seq: project.seq,
    char: { ...DEFAULT_CHAR, boxW, boxH },
  }
}

/**
 * 某个位置站不站得住（脚底盒不压任何红区，且不越界）。
 *
 * 这是最基础的校验 —— 标记放在墙里就是站不住。
 *
 * boxW / boxH 可覆盖脚底盒尺寸：怪物比角色大时，它能站的地方就比角色少。
 */
export function canStandAt(
  project: MapProject,
  x: number,
  y: number,
  box?: FootBoxOverride,
): boolean {
  const def = footBoxSize(project)
  const bw = box?.boxW ? Math.max(1, box.boxW) : def.w
  const bh = box?.boxH ? Math.max(1, box.boxH) : def.h
  if (x - bw / 2 < 0 || y - bh / 2 < 0 ||
      x + bw / 2 > project.canvas.w || y + bh / 2 > project.canvas.h) return false
  /* 判定逻辑仍是同一份（overlappingRegions），只是工程视图不含角色实时坐标 */
  return overlappingRegions(navView(project, bw, bh), x, y).length === 0
}

/* ------------------------------------------------------------------ */
/* 连通性                                                              */
/* ------------------------------------------------------------------ */

/**
 * 洪水填充：从某个可通行格子出发，标记它所在的整片连通区域。
 *
 * 用**四邻接**（上下左右）而不是八邻接：
 * 八邻接会让角色「斜着穿过墙缝」，与实际移动（分轴 + 子步推进）不符。
 */
function flood(grid: NavGrid, startCx: number, startCy: number): Uint8Array {
  const seen = new Uint8Array(grid.cols * grid.rows)
  if (startCx < 0 || startCy < 0 || startCx >= grid.cols || startCy >= grid.rows) return seen
  if (!grid.passable[idx(grid, startCx, startCy)]) return seen
  const stack: number[] = [startCy * grid.cols + startCx]
  seen[stack[0]] = 1
  while (stack.length) {
    const cur = stack.pop() as number
    const cx = cur % grid.cols
    const cy = (cur - cx) / grid.cols
    const neigh = [
      [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1],
    ]
    for (const [nx, ny] of neigh) {
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue
      const ni = ny * grid.cols + nx
      if (seen[ni] || !grid.passable[ni]) continue
      seen[ni] = 1
      stack.push(ni)
    }
  }
  return seen
}

/** 找某个点所在的可通行格子（自身不可通行时找附近的可通行格子） */
function nearestPassableCell(grid: NavGrid, x: number, y: number): { cx: number; cy: number } | null {
  const cx = Math.floor(x / grid.cell)
  const cy = Math.floor(y / grid.cell)
  if (cx >= 0 && cy >= 0 && cx < grid.cols && cy < grid.rows && grid.passable[idx(grid, cx, cy)]) {
    return { cx, cy }
  }
  /* 在 3 圈邻域里找最近的 */
  let best: { cx: number; cy: number } | null = null
  let bestD = Infinity
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue
        if (!grid.passable[idx(grid, nx, ny)]) continue
        const c = centerOf(grid, nx, ny)
        const d = Math.hypot(c.x - x, c.y - y)
        if (d < bestD) { bestD = d; best = { cx: nx, cy: ny } }
      }
    }
    if (best) return best
  }
  return best
}

/**
 * 两点之间走不走得通（在栅格化的连通分量上判断）。
 *
 * 比 A* 便宜得多，能直接回答「这个房间玩家进得去吗」。
 */
export function connected(project: MapProject, a: Point, b: Point): boolean {
  const grid = navGrid(project)
  const sa = nearestPassableCell(grid, a.x, a.y)
  const sb = nearestPassableCell(grid, b.x, b.y)
  if (!sa || !sb) return false
  if (sa.cx === sb.cx && sa.cy === sb.cy) return true
  const seen = flood(grid, sa.cx, sa.cy)
  return !!seen[idx(grid, sb.cx, sb.cy)]
}

/* ------------------------------------------------------------------ */
/* A* 寻路                                                            */
/* ------------------------------------------------------------------ */

/** 寻路结果 */
export interface NavPath {
  /** 折线的顶点（世界坐标）。可达时至少有 2 个点 */
  points: Point[]
  /** 是否可达 */
  reachable: boolean
  /** 折线的每一段是否都通过子步推进验证 */
  verified: boolean
}

/** A* 的最小堆（f 值最小的先出） */
class MinHeap {
  private a: { f: number; i: number }[] = []

  get size(): number {
    return this.a.length
  }

  push(item: { f: number; i: number }): void {
    const a = this.a
    a.push(item)
    let k = a.length - 1
    while (k > 0) {
      const parent = (k - 1) >> 1
      if (a[parent].f <= a[k].f) break
      const t = a[parent]
      a[parent] = a[k]
      a[k] = t
      k = parent
    }
  }

  pop(): { f: number; i: number } | undefined {
    const a = this.a
    if (!a.length) return undefined
    const top = a[0]
    const last = a.pop() as { f: number; i: number }
    if (a.length) {
      a[0] = last
      let k = 0
      for (;;) {
        const l = k * 2 + 1
        const r = l + 1
        let m = k
        if (l < a.length && a[l].f < a[m].f) m = l
        if (r < a.length && a[r].f < a[m].f) m = r
        if (m === k) break
        const t = a[m]
        a[m] = a[k]
        a[k] = t
        k = m
      }
    }
    return top
  }
}

/**
 * A* 的工作缓冲区（可复用）。
 *
 * ## 为什么要复用
 *
 * 栅格在大画布上有几十万个格子（1920×1080 / cell=2 → 51.8 万）。
 * 每次寻路要分配 gScore / fScore / cameFrom / closed 四个数组，
 * 合计约 10MB。设了多条怪物路线就意味着几十次寻路，
 * 几百 MB 的临时垃圾会把 GC 拖成周期性卡顿 ——
 * 表现为「走两步顿一下」，比单次算得慢更难忍受。
 *
 * 复用后每次寻路只有堆里的对象是新的，数组本身不再反复分配。
 */
interface AstScratch {
  gScore: Float64Array
  fScore: Float64Array
  cameFrom: Int32Array
  closed: Uint8Array
  /** 上一次使用的格子总数（格子数变了就重新分配） */
  size: number
}

let astScratch: AstScratch | null = null

/** 取一份与当前栅格匹配的 A* 工作区 */
function getScratch(n: number): AstScratch {
  if (!astScratch || astScratch.size !== n) {
    astScratch = {
      gScore: new Float64Array(n),
      fScore: new Float64Array(n),
      cameFrom: new Int32Array(n),
      closed: new Uint8Array(n),
      size: n,
    }
  }
  return astScratch
}

/**
 * A* 寻路（八方向，允许斜走）。
 *
 * 斜向走格子时必须保证「不切角」—— 两边正交的格子都得可通行，
 * 否则角色会从墙角斜穿过去。
 */
export function findPath(project: MapProject, from: Point, to: Point): NavPath {
  const grid = navGrid(project)
  const s = nearestPassableCell(grid, from.x, from.y)
  const t = nearestPassableCell(grid, to.x, to.y)
  if (!s || !t) return { points: [], reachable: false, verified: false }

  const start = idx(grid, s.cx, s.cy)
  const goal = idx(grid, t.cx, t.cy)
  if (start === goal) {
    const pts = [{ x: from.x, y: from.y }, { x: to.x, y: to.y }]
    return { points: pts, reachable: true, verified: verifyPath(project, pts) }
  }

  const n = grid.cols * grid.rows
  /* 复用缓冲区：不每次都分配几十 MB，避免多条路线叠加时 GC 抖动 */
  const scratch = getScratch(n)
  const gScore = scratch.gScore
  const fScore = scratch.fScore
  const cameFrom = scratch.cameFrom
  const closed = scratch.closed
  gScore.fill(Infinity)
  fScore.fill(Infinity)
  cameFrom.fill(-1)
  closed.fill(0)

  /* 八方向的对角距离启发式（可采纳，不会高估实际距离） */
  const h = (i: number): number => {
    const cx = i % grid.cols
    const cy = (i - cx) / grid.cols
    const dx = Math.abs(cx - t.cx)
    const dy = Math.abs(cy - t.cy)
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * grid.cell
  }

  gScore[start] = 0
  fScore[start] = h(start)

  const open = new MinHeap()
  open.push({ f: fScore[start], i: start })

  while (open.size) {
    const cur = open.pop() as { f: number; i: number }
    const ci = cur.i
    if (ci === goal) break
    /* 同一节点可能多次入堆（f 值变小时重新入堆），只展开第一次 */
    if (closed[ci]) continue
    closed[ci] = 1

    const cx = ci % grid.cols
    const cy = (ci - cx) / grid.cols
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue
        const ni = ny * grid.cols + nx
        if (!grid.passable[ni] || closed[ni]) continue
        /* 不切角：斜走时两边正交的格子也得通 */
        if (dx !== 0 && dy !== 0) {
          const a = cy * grid.cols + nx
          const b = ny * grid.cols + cx
          if (!grid.passable[a] || !grid.passable[b]) continue
        }
        const step = (dx !== 0 && dy !== 0) ? Math.SQRT2 * grid.cell : grid.cell
        const tentative = gScore[ci] + step
        if (tentative < gScore[ni]) {
          cameFrom[ni] = ci
          gScore[ni] = tentative
          fScore[ni] = tentative + h(ni)
          /* f 值变小时**必须重新入堆**：
             堆序靠 f 维持，若只改 fScore 不入堆，
             这个节点会以旧的（更大的）f 被弹出，
             导致它被过早标记成「已关闭」，通往目标的路径就此丢失。 */
          open.push({ f: fScore[ni], i: ni })
        }
      }
    }
  }

  if (cameFrom[goal] === -1 && goal !== start) {
    return { points: [], reachable: false, verified: false }
  }

  /* 回溯格子序列 → 世界坐标折线 */
  const cells: number[] = []
  let cur = goal
  while (cur !== -1) {
    cells.push(cur)
    if (cur === start) break
    cur = cameFrom[cur]
  }
  cells.reverse()

  const pts: Point[] = [{ x: from.x, y: from.y }]
  for (const ci of cells) {
    const ccx = ci % grid.cols
    const ccy = (ci - ccx) / grid.cols
    const c = centerOf(grid, ccx, ccy)
    const last = pts[pts.length - 1]
    if (Math.hypot(c.x - last.x, c.y - last.y) > 0.01) pts.push(c)
  }
  pts.push({ x: to.x, y: to.y })

  /* 去掉共线的冗余点。
   *
   * A* 每走一个格子中心就记一个点，一条绕墙的路线能到几百个点，
   * 其中 98% 以上是同一直线上的中间点 —— 画出来毫无区别，
   * 却让 Konva 每帧多画几百个节点，还让下面的子步验证多跑几百次。
   *
   * ⚠ 只删「严格共线」的点：三个点连成一条直线才删中点，
   *   拐弯处的点全部保留，所以路线形状与原来完全一致。
   */
  const simple = dropCollinear(pts)

  return { points: simple, reachable: true, verified: verifyPath(project, simple) }
}

/**
 * 去掉折线里严格共线的中间点。
 *
 * 只删中点，不动首尾 —— 起点与终点必须原样保留。
 */
function dropCollinear(pts: Point[]): Point[] {
  if (pts.length < 3) return pts
  const out: Point[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    /* 叉积为 0 说明三点共线 */
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(cross) < 1e-6) continue
    out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * 校验一段折线是否真的走得过去。
 *
 * ## 为什么必须用 tryMoveChar 来验
 *
 * A* 只给粗略路线，窄道里按格子跳会穿墙。
 * 这里**直接调用角色移动本尊**（tryMoveChar）逐段推进：
 * 走法、子步粒度、分轴滑墙、脱困规则全都是运行器那一套，
 * 所以「路径预览的可靠性 = 角色实际移动的可靠性」天然成立。
 *
 * 每段走完后必须真的到达该段终点 —— 被墙挡在半路算「走不通」。
 */
export function verifyPath(project: MapProject, points: Point[]): boolean {
  if (points.length < 2) return false
  /* 起点必须站得住，否则「脱困移动」规则会让判定失去意义 */
  if (!canStandAt(project, points[0].x, points[0].y)) return false

  /* 复制一份工程，模拟角色沿折线移动。
     ⚠ 用 navView 而不是 `{ ...project }`：
       展开响应式对象会把 char 整个读一遍（连带实时坐标），
       调用方（画布上的 computed）于是依赖上角色的位置，
       预览模式里角色每移动一帧，这些 computed 全部失效重算，
       一次路线展开要跑 A*（大画布上几十毫秒），多条路线直接卡死。
     这里只需要脚底盒尺寸与起点坐标。 */
  const view = navView(project, project.char.boxW, project.char.boxH)
  const sim: MapProject = {
    ...view,
    char: { ...view.char, x: points[0].x, y: points[0].y },
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.hypot(dx, dy)
    const steps = Math.max(1, Math.ceil(dist))
    const incX = dx / steps
    const incY = dy / steps
    for (let s = 0; s < steps; s++) {
      tryMoveChar(sim, incX, incY)
    }
    /* 必须真的走到这一段的终点（不能被墙挡在半路） */
    if (Math.hypot(sim.char.x - b.x, sim.char.y - b.y) > 1.5) return false
  }
  return true
}

/* ------------------------------------------------------------------ */
/* 巡逻路线                                                            */
/* ------------------------------------------------------------------ */

/** 一段路的走向（怪物走到路径点时面朝哪边） */
export interface PatrolLeg {
  /** 起点 */
  from: Point
  /** 终点 */
  to: Point
  /** 实际能走的折线（绕开墙后的中间点） */
  path: Point[]
  /** 是否走得到（走不到就是被墙彻底隔开了） */
  reachable: boolean
  /** 是否通过子步推进验证（窄道里 A* 按格子跳可能穿墙） */
  verified: boolean
}

/** 巡逻路线的走向列表 */
export interface PatrolPlan {
  /** 每一段的走向 */
  legs: PatrolLeg[]
  /** 整条路线是否完全走得通（每一段都可达且通过验证） */
  ok: boolean
  /** 有几段走不通 */
  brokenCount: number
}

/**
 * 把巡逻路线的路径点展开成真正能走的折线。
 *
 * 相邻两个路径点之间用 `findPath` 绕开墙 —— 这跟运行器要做的完全一致，
 * 所以编辑器画出来的巡逻路线就是运行器实际会走的路线。
 *
 * 闭环时最后一段会从最后一个点绕回第一个点。
 */
export function planPatrol(
  project: MapProject,
  points: Point[],
  loop: boolean,
): PatrolPlan {
  const legs: PatrolLeg[] = []
  if (points.length < 2) return { legs, ok: true, brokenCount: 0 }

  const legsOf: { from: Point; to: Point }[] = []
  for (let i = 0; i < points.length - 1; i++) {
    legsOf.push({ from: points[i], to: points[i + 1] })
  }
  /* 闭环：最后一点绕回第一点 */
  if (loop) legsOf.push({ from: points[points.length - 1], to: points[0] })

  for (const l of legsOf) {
    const r = findPath(project, l.from, l.to)
    if (!r.reachable) {
      legs.push({ from: l.from, to: l.to, path: [], reachable: false, verified: false })
      continue
    }
    /* 直接用 findPath 已算好的验证结果，不要再验一遍：
       findPath 内部已经调过 verifyPath，同一段路跑两遍是白费力气。 */
    legs.push({ from: l.from, to: l.to, path: r.points, reachable: true, verified: r.verified })
  }

  const brokenCount = legs.filter(l => !l.reachable || !l.verified).length
  return { legs, ok: brokenCount === 0, brokenCount }
}

/**
 * 算出走到某个路径点时该面朝哪边。
 *
 * 按「从上一站走向这一站」的方向推：
 * 水平方向看 dx 的正负，垂直方向看 dy 的正负，斜向时以水平为准。
 * 第一个点没有「上一站」，用「从标记本体走向它」的方向。
 */
export function patrolFacing(
  from: Point,
  to: Point,
): 'up' | 'down' | 'left' | 'right' {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (Math.abs(dx) < 0.01) return 'down'
    return dx > 0 ? 'right' : 'left'
  }
  return dy > 0 ? 'down' : 'up'
}

/**
 * 巡逻路线每个路径点的朝向。
 *
 * 返回的数组与路径点一一对应。
 */
export function patrolFacings(
  origin: Point,
  points: Point[],
): ('up' | 'down' | 'left' | 'right')[] {
  const out: ('up' | 'down' | 'left' | 'right')[] = []
  for (let i = 0; i < points.length; i++) {
    const prev = i === 0 ? origin : points[i - 1]
    out.push(patrolFacing(prev, points[i]))
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 标记状态徽标                                                        */
/* ------------------------------------------------------------------ */

/** 标记的连通状态 */
export type MarkStatus = 'stand' | 'blocked' | 'isolated'

/** 标记的状态徽标 */
export interface MarkStatusInfo {
  status: MarkStatus
  /** 显示用的符号 */
  symbol: string
  /** 显示用的文字 */
  label: string
  /** 徽标颜色 */
  color: string
}

/**
 * 洪水填充的缓存。
 *
 * `flood` 要扫整张网格（几十万个格子），一次约 20ms。
 * 标记列表里每个标记都要判一次「是不是孤立的」，
 * 而多个标记往往在**同一个连通区域**里 —— 起点一样就该复用同一份结果。
 *
 * 缓存跟着栅格签名走：红区一变签名就变，缓存自动失效。
 */
interface FloodCacheEntry {
  sig: string
  /** 起点格子 → 填充结果 */
  byStart: Map<number, Uint8Array>
}

let floodCache: FloodCacheEntry | null = null

/** 洪水填充（带缓存：同一栅格 + 同一起点只算一次） */
function floodCached(grid: NavGrid, startCx: number, startCy: number): Uint8Array {
  const sig = grid.sig
  if (!floodCache || floodCache.sig !== sig) {
    floodCache = { sig, byStart: new Map() }
  }
  const key = startCy * grid.cols + startCx
  const hit = floodCache.byStart.get(key)
  if (hit) return hit
  const seen = flood(grid, startCx, startCy)
  floodCache.byStart.set(key, seen)
  return seen
}

/**
 * 判定一个标记的连通状态。
 *
 * - `stand`   可站立（脚底盒不压红区）
 * - `blocked` 在墙里（脚底盒压住红区）
 * - `isolated` 可站立，但所在连通分量里没有别的标记 —— 典型症状是「忘了开门」
 */
export function markStatus(
  project: MapProject,
  mark: { x: number; y: number; boxW?: number; boxH?: number },
  otherMarks: { x: number; y: number }[],
): MarkStatusInfo {
  if (!canStandAt(project, mark.x, mark.y, { boxW: mark.boxW, boxH: mark.boxH })) {
    return { status: 'blocked', symbol: '✗', label: '在墙里', color: '#ef4444' }
  }
  /* 孤立判定：所在连通分量里是否还有别的标记 */
  const grid = navGrid(project)
  const sc = nearestPassableCell(grid, mark.x, mark.y)
  if (!sc) {
    return { status: 'blocked', symbol: '✗', label: '在墙里', color: '#ef4444' }
  }
  const seen = floodCached(grid, sc.cx, sc.cy)
  for (const om of otherMarks) {
    const oc = nearestPassableCell(grid, om.x, om.y)
    if (!oc) continue
    if (seen[idx(grid, oc.cx, oc.cy)]) {
      return { status: 'stand', symbol: '✓', label: '站得下', color: '#22c55e' }
    }
  }
  return { status: 'isolated', symbol: '⚠', label: '孤立', color: '#eab308' }
}
