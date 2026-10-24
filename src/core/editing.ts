/**
 * 编辑操作 × 撤销栈 的组合层。
 *
 * 目的：把「改数据」和「记历史」绑在一起，避免每个组件各写一遍
 * beginOp / commitOp（历史上散落在键盘、工具栏、属性面板三处），
 * 同时让这些行为可以在 node 里直接跑单元测试（见根目录 *.cjs）。
 *
 * 约定：
 *   - 连续同类操作通过 mergeKey 合并为一步撤销（键按对象 id 隔离）；
 *   - 合并键形如 'nudge:<id>'，不同对象互不影响；
 *   - 数据没真的变化时不入历史（History.commitOp 内部已做 diff）。
 */
import type { History } from './history'
import type { MapProject, RegionTarget, RegionType } from '../types/map'
import {
  findRegion, nudgeRegion, removeRegion, renameRegion,
  setRegionPriority, setRegionTarget, setRegionType,
} from './project'

/** 移动区域（方向键 / 工具栏微移）。同一区域连续移动合并为一步撤销。 */
export function moveRegionStep(
  history: History,
  project: MapProject,
  id: string,
  dx: number,
  dy: number,
  step = 1,
): boolean {
  if (!findRegion(project, id)) return false
  const tx = history.beginOp()
  if (!nudgeRegion(project, id, dx, dy, step)) return false
  history.commitOp(tx, '移动区域', 'nudge:' + id)
  return true
}

/** 删除区域 */
export function removeRegionWithHistory(
  history: History,
  project: MapProject,
  id: string,
): boolean {
  const tx = history.beginOp()
  if (!removeRegion(project, id)) return false
  history.commitOp(tx, '删除区域')
  return true
}

/** 修改区域类型 */
export function changeRegionType(
  history: History,
  project: MapProject,
  id: string,
  type: RegionType,
): boolean {
  const tx = history.beginOp()
  if (!setRegionType(project, id, type)) return false
  history.commitOp(tx, '修改类型')
  return true
}

/** 修改作用目标 */
export function changeRegionTarget(
  history: History,
  project: MapProject,
  id: string,
  target: RegionTarget,
): boolean {
  const tx = history.beginOp()
  if (!setRegionTarget(project, id, target)) return false
  history.commitOp(tx, '修改作用目标')
  return true
}

/** 修改优先级 */
export function changeRegionPriority(
  history: History,
  project: MapProject,
  id: string,
  priority: number,
): boolean {
  const tx = history.beginOp()
  if (!setRegionPriority(project, id, priority)) return false
  history.commitOp(tx, '调整优先级')
  return true
}

/** 重命名 */
export function renameRegionWithHistory(
  history: History,
  project: MapProject,
  id: string,
  name: string,
): boolean {
  const tx = history.beginOp()
  if (!renameRegion(project, id, name)) return false
  history.commitOp(tx, '重命名')
  return true
}
