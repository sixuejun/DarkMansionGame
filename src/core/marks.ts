import type { Mark, MarkFacing, MarkKind, MapProject, PatrolRoute } from '../types/map'
import { MARK_KINDS } from './constants'
import { uid } from './geometry'

/**
 * 点标记的增删改查。
 *
 * 标记与 Region 是**平行**的两套数据：各自有各自的函数，
 * 但共用坐标系、吸附、撤销栈、存档与导出。
 */

/** 创建一个新标记（脚底落点） */
export function createMark(
  kind: MarkKind,
  x: number,
  y: number,
  name?: string,
): Mark {
  return {
    id: uid(),
    kind,
    name: name ?? MARK_KINDS[kind].name,
    x: Math.round(x),
    y: Math.round(y),
    facing: 'down',
  }
}

/** 按 id 找标记 */
export function findMark(project: MapProject, id: string | null): Mark | undefined {
  if (!id) return undefined
  return project.marks.find(m => m.id === id)
}

/** 新增标记到工程 */
export function addMark(project: MapProject, kind: MarkKind, x: number, y: number): Mark {
  const m = createMark(kind, x, y)
  project.marks.push(m)
  return m
}

/** 删除标记 */
export function removeMark(project: MapProject, id: string): boolean {
  const i = project.marks.findIndex(m => m.id === id)
  if (i < 0) return false
  project.marks.splice(i, 1)
  return true
}

/** 修改标记类型 */
export function setMarkKind(project: MapProject, id: string, kind: MarkKind): boolean {
  const m = findMark(project, id)
  if (!m || m.kind === kind) return false
  m.kind = kind
  return true
}

/** 修改朝向 */
export function setMarkFacing(project: MapProject, id: string, facing: MarkFacing): boolean {
  const m = findMark(project, id)
  if (!m || m.facing === facing) return false
  m.facing = facing
  return true
}

/** 重命名 */
export function renameMark(project: MapProject, id: string, name: string): boolean {
  const m = findMark(project, id)
  if (!m) return false
  m.name = name
  return true
}

/** 移动标记（脚底落点） */
export function moveMark(
  project: MapProject,
  id: string,
  x: number,
  y: number,
): boolean {
  const m = findMark(project, id)
  if (!m) return false
  m.x = Math.round(x)
  m.y = Math.round(y)
  return true
}

/**
 * 设置标签键值表（整体替换）。
 * 编辑器只存不解释 —— 这些键值最终由运行器读。
 */
export function setMarkTags(
  project: MapProject,
  id: string,
  tags: Record<string, string>,
): boolean {
  const m = findMark(project, id)
  if (!m) return false
  m.tags = { ...tags }
  return true
}

/** 标签键值表的行（保证 key 顺序稳定，界面与导出都可复现） */
export function markTagRows(mark: Mark | null | undefined): { key: string; value: string }[] {
  if (!mark || !mark.tags) return []
  return Object.keys(mark.tags).map(k => ({ key: k, value: mark.tags![k] }))
}

/* ------------------------------------------------------------------ */
/* 巡逻路线                                                            */
/* ------------------------------------------------------------------ */

/** 给标记新建一条巡逻路线（空路径点，闭环） */
export function createPatrolRoute(loop = true): PatrolRoute {
  return { points: [], loop }
}

/** 标记有没有巡逻路线（哪怕一个路径点都还没有，也算「有路线」） */
export function hasPatrol(mark: Mark | null | undefined): boolean {
  return !!mark?.patrol
}

/**
 * 设置巡逻路线（整体替换）。传 null 表示取消巡逻。
 *
 * 空路径点的路线**保留**（新建后还没点路径点属于正常中间状态），
 * 只有显式传 null 才取消巡逻。
 */
export function setPatrolRoute(
  project: MapProject,
  id: string,
  route: PatrolRoute | null,
): boolean {
  const m = findMark(project, id)
  if (!m) return false
  if (!route) {
    delete m.patrol
    return true
  }
  m.patrol = {
    points: route.points.map(p => ({ x: p.x, y: p.y })),
    loop: route.loop,
  }
  return true
}

/** 往巡逻路线里加一个路径点 */
export function addPatrolPoint(
  project: MapProject,
  id: string,
  x: number,
  y: number,
): boolean {
  const m = findMark(project, id)
  if (!m) return false
  if (!m.patrol) m.patrol = createPatrolRoute()
  m.patrol.points.push({ x: Math.round(x), y: Math.round(y) })
  return true
}

/** 移动巡逻路线里的某个路径点 */
export function movePatrolPoint(
  project: MapProject,
  id: string,
  idx: number,
  x: number,
  y: number,
): boolean {
  const m = findMark(project, id)
  if (!m?.patrol) return false
  const p = m.patrol.points[idx]
  if (!p) return false
  p.x = Math.round(x)
  p.y = Math.round(y)
  return true
}

/**
 * 删掉巡逻路线里的某个路径点。
 *
 * 路径点删到只剩一个也**保留**路线 —— 作者可能正在编辑中途，
 * 自动清掉整条路线会让他前面点的白点。
 * 真的想清空走 `setPatrolRoute(project, id, null)`。
 */
export function removePatrolPoint(project: MapProject, id: string, idx: number): boolean {
  const m = findMark(project, id)
  if (!m?.patrol) return false
  if (idx < 0 || idx >= m.patrol.points.length) return false
  m.patrol.points.splice(idx, 1)
  return true
}

/** 设置巡逻路线的走法（闭环 / 往返） */
export function setPatrolLoop(project: MapProject, id: string, loop: boolean): boolean {
  const m = findMark(project, id)
  if (!m?.patrol) return false
  m.patrol.loop = loop
  return true
}
