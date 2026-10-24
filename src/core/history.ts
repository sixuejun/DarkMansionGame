import type { Mark, Region, Snapshot } from '../types/map'
import { HISTORY_MAX } from './constants'

/** 撤销栈中的一条记录 */
export interface HistoryEntry {
  snap: Snapshot
  label: string
  /** 合并键：同一对象上的连续同类操作合并为一步撤销 */
  merge: string | null
  /** 已封口：后续同键操作不再与之合并 */
  sealed: boolean
}

/** 一次操作的句柄（由 beginOp 产生，commitOp 消费） */
export interface HistoryTx {
  snap: Snapshot
}

export interface HistoryHooks {
  /** 取当前状态快照 */
  getSnapshot: () => Snapshot
  /** 应用快照（由调用方负责同步到 UI 状态） */
  applySnapshot: (snap: Snapshot) => void
  /** 状态变化回调（用于刷新按钮可用性 / 落盘） */
  onChange?: () => void
}

/**
 * 撤销 / 重做栈。
 *
 * 采用「每个已完成操作之后的状态」模型：
 *   past = [ 初始, 操作1后, 操作2后, ... ]
 *   撤销 = 弹掉栈顶，把新的栈顶应用回去。
 *
 * mergeKey 区分连续操作的「对象」：同一区域连续挪动 = 一次撤销；
 * 切到别的区域再挪 = 新的、可独立撤销的一步。
 */
export class History {
  past: HistoryEntry[] = []
  future: HistoryEntry[] = []
  locked = false

  constructor(private hooks: HistoryHooks) {}

  /** 深拷贝当前状态 */
  snapshot(): Snapshot {
    const snap = this.hooks.getSnapshot()
    return {
      regions: snap.regions.map(r => ({
        ...r,
        points: r.points.map(p => ({ x: p.x, y: p.y })),
      })),
      marks: (snap.marks || []).map(m => ({
        ...m,
        tags: m.tags ? { ...m.tags } : undefined,
        patrol: m.patrol
          ? { loop: m.patrol.loop, points: m.patrol.points.map(p => ({ x: p.x, y: p.y })) }
          : undefined,
      })),
      seq: snap.seq,
    }
  }

  /**
 * 交给调用方的快照必须是**副本**。
   *
 * 调用方通常会把它直接挂成当前状态（`project.regions = snap.regions`），
 * 之后对当前状态的增删改（splice / push）就等于**就地改在历史记录上**。
   * 一旦如此，撤销读到的就是已经被改坏的状态 —— 表现为
   * 「撤销删除后标记没回来」「再撤销一次就乱了」。
   */
  private static cloneSnapshot(snap: Snapshot): Snapshot {
    return {
      regions: snap.regions.map(r => ({
        ...r,
        points: r.points.map(p => ({ x: p.x, y: p.y })),
      })),
      marks: (snap.marks || []).map(m => ({
        ...m,
        tags: m.tags ? { ...m.tags } : undefined,
        patrol: m.patrol
          ? { loop: m.patrol.loop, points: m.patrol.points.map(p => ({ x: p.x, y: p.y })) }
          : undefined,
      })),
      seq: snap.seq,
    }
  }

  /** 开始一个操作：先抓快照 */
  beginOp(): HistoryTx {
    return { snap: this.snapshot() }
  }

  /** 提交一个操作 */
  commitOp(tx: HistoryTx | null | undefined, label: string, mergeKey?: string): void {
    if (!tx || this.locked) return
    const before = JSON.stringify(tx.snap.regions) + '|' + JSON.stringify(tx.snap.marks || [])
    const afterSnap = this.snapshot()
    const after = JSON.stringify(afterSnap.regions) + '|' + JSON.stringify(afterSnap.marks)
    if (before === after) return /* 没有实际变化，不入栈 */

    const top = this.past[this.past.length - 1]
    if (mergeKey && top && top.label === label && top.merge === mergeKey && !top.sealed) {
      top.snap = History.cloneSnapshot(afterSnap)
      this.future.length = 0
      this.hooks.onChange?.()
      return
    }
    if (top) top.sealed = true
    this.past.push({
      snap: History.cloneSnapshot(afterSnap),
      label,
      merge: mergeKey || null,
      sealed: false,
    })
    if (this.past.length > HISTORY_MAX) this.past.shift()
    this.future.length = 0
    this.hooks.onChange?.()
  }

  /** 撤销一步 */
  undo(): { label: string; before: Snapshot; after: Snapshot } | null {
    if (this.past.length < 2) return null
    const before = this.snapshot()
    const cur = this.past.pop() as HistoryEntry
    this.future.push({ snap: History.cloneSnapshot(cur.snap), label: cur.label, merge: cur.merge, sealed: true })
    const prev = this.past[this.past.length - 1]
    prev.sealed = true
    this.applySnap(prev.snap)
    return { label: cur.label, before, after: prev.snap }
  }

  /** 重做一步 */
  redo(): { label: string; before: Snapshot; after: Snapshot } | null {
    const before = this.snapshot()
    const nxt = this.future.pop()
    if (!nxt) return null
    /* 压回 past 的必须是 nxt.snap（即将到达的状态） */
    this.past.push({ snap: History.cloneSnapshot(nxt.snap), label: nxt.label, merge: nxt.merge || null, sealed: false })
    this.applySnap(nxt.snap)
    return { label: nxt.label, before, after: nxt.snap }
  }

  /** 一次性替换全部内容（导入 / 清空 / 启动） */
  reset(label: string, snap?: Snapshot): void {
    this.past = [{ snap: History.cloneSnapshot(snap || this.snapshot()), label, merge: null, sealed: true }]
    this.future.length = 0
    this.hooks.onChange?.()
  }

  get canUndo(): boolean {
    return this.past.length >= 2
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  private applySnap(snap: Snapshot): void {
    this.locked = true
    /* 交给调用方的必须是副本：调用方通常会把它直接挂成当前状态
       （`project.marks = snap.marks`），之后对当前状态的增删改
       就等于就地改在历史记录上。 */
    this.hooks.applySnapshot(History.cloneSnapshot(snap))
    this.hooks.onChange?.()
    this.locked = false
  }
}

/**
 * 在 before / after 之间找出变化最大的那个区域（用于撤销/重做后的闪高亮）。
 * 返回需要高亮的区域 id；没有变化返回 null。
 */
export function flashAffected(before: Region[], after: Region[]): string | null {
  const beforeMap = new Map(before.map(r => [r.id, r]))
  let bestId: string | null = null
  let bestScore = 0
  for (const a of after) {
    const b = beforeMap.get(a.id)
    /* 新增区域（撤销删除时恢复） */
    if (!b) return a.id
    let score = 0
    const n = Math.min(b.points.length, a.points.length)
    for (let i = 0; i < n; i++) {
      score += Math.abs(b.points[i].x - a.points[i].x) + Math.abs(b.points[i].y - a.points[i].y)
    }
    if (b.type !== a.type || b.target !== a.target) score += 8
    if (b.priority !== a.priority) score += 4
    if (score > bestScore) { bestId = a.id; bestScore = score }
  }
  /* 撤销删除类（before 有、after 没有） */
  for (const b of before) {
    if (!after.some(a => a.id === b.id)) return b.id
  }
  return bestId
}

/**
 * 在 before / after 之间找出变化最大的那个标记（用于撤销/重做后的闪高亮）。
 * 返回需要高亮的标记 id；没有变化返回 null。
 */
export function flashMarkAffected(before: Mark[], after: Mark[]): string | null {
  const beforeMap = new Map(before.map(m => [m.id, m]))
  let bestId: string | null = null
  let bestScore = 0
  for (const a of after) {
    const b = beforeMap.get(a.id)
    /* 新增标记（撤销删除时恢复） */
    if (!b) return a.id
    let score = 0
    score += Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    if (b.kind !== a.kind) score += 8
    if (b.facing !== a.facing) score += 4
    if (score > bestScore) { bestId = a.id; bestScore = score }
  }
  /* 撤销删除类（before 有、after 没有） */
  for (const b of before) {
    if (!after.some(a => a.id === b.id)) return b.id
  }
  return bestId
}
