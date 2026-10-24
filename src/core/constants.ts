import type { MarkFacing, MarkKind, RegionTarget, RegionType, ToolId } from '../types/map'

/** 五种逻辑区域的元数据 */
export const TYPES: Record<RegionType, {
  name: string
  color: string
  short: string
  key: string
  desc: string
  tip: string
}> = {
  top: {
    name: '最上层', color: '#22c55e', short: 'top', key: '1',
    desc: '指定区域始终显示在角色上方',
    tip: '目标图层画在角色之上，用于屋顶、树冠、前景遮挡物。',
  },
  collision: {
    name: '碰撞层', color: '#ef4444', short: 'collision', key: '2',
    desc: '阻挡角色与 NPC 移动',
    tip: '角色与 NPC 无法进入。作用目标默认白层。',
  },
  occlusion: {
    name: '遮挡层', color: '#a855f7', short: 'occlusion', key: '3',
    desc: '角色降到黑层后方，并显示半透明副本',
    tip: '进入后角色绘制位置降到黑层中间，在黑层上方显示副本轮廓。',
  },
  adjust: {
    name: '调节层', color: '#eab308', short: 'adjust', key: '4',
    desc: '该区域黑层移到角色下方',
    tip: '把物件「切开」下移，让角色在该范围内完整显示，且不叠加副本。',
  },
  fade: {
    name: '前景淡化区', color: '#22d3ee', short: 'fade', key: '5',
    desc: '角色走进该区域时，前景层整件变半透',
    tip: '只作用于前景层。框是触发框不是抠图轮廓，画得比前景图大一圈也没关系；' +
      '框里没画图的地方是透明像素，淡化它们等于什么都没做。',
  },
}

/** 类型顺序（与 TYPE_KEYS 一致） */
export const TYPE_KEYS: RegionType[] = ['top', 'collision', 'occlusion', 'adjust', 'fade']

/** 同优先级时的类型裁决顺序（越靠后越优先）。fade 不参与像素裁决，固定排末位 */
export const TYPE_RANK: Record<RegionType, number> = {
  collision: 0,
  adjust: 1,
  occlusion: 2,
  top: 3,
  fade: 4,
}

/** 作用目标显示名 */
export const TARGETS: Record<string, string> = {
  background: '白层',
  objects: '黑层',
  both: '两者',
  foreground: '前景层',
}

/** 作用层级选择 chip 的配色（沿用图层语义，不与区域类型色混淆） */
export const TARGET_COLORS: Record<string, string> = {
  background: '#64748b',
  objects: '#8d95ab',
  both: '#c9a227',
  foreground: '#22d3ee',
}

/** 可选作用层级（不含「前景层」：前景层只属于 fade，不作为可选目标） */
export const TARGET_KEYS: RegionTarget[] = ['background', 'objects', 'both']

/** 作用层级快捷键：B=白层 / N=黑层（objects）/ M=两者（both） */
export const TARGET_HOTKEYS: Record<string, string> = {
  background: 'b',
  objects: 'n',
  both: 'm',
}

/**
 * 各类区域允许的作用层级（数组第一项 = 新建时的默认值）。
 *
 * 默认值刻意与旧实现「finishPen 里按类型硬算」的结果保持一致：
 * 碰撞 → 白层，其余 → 两者，淡化 → 前景层。
 * 这样升级后新画的区域导出结果不变，而用户现在可以主动改选了。
 * fade 固定作用于前景层，因此只有一项（面板上显示为锁定的只读 chip）。
 */
export const TYPE_TARGETS: Record<RegionType, RegionTarget[]> = {
  top: ['both', 'objects', 'background'],
  collision: ['background', 'both', 'objects'],
  occlusion: ['both', 'objects', 'background'],
  adjust: ['both', 'objects'],
  fade: ['foreground'],
}

/** 某类型是否有可选的作用层级 */
export function hasTargetChoice(type: RegionType): boolean {
  return TYPE_TARGETS[type].length > 1
}

/** 新区域的默认作用层级：取该类型的首选 */
export function defaultTargetFor(type: RegionType): RegionTarget {
  return TYPE_TARGETS[type][0]
}

/** 淡化后保留的不透明度默认值（0 = 完全消失） */
export const DEFAULT_FADE_ALPHA = 0

/** 触发迟滞边距默认值（地图像素，仅矩形生效） */
export const DEFAULT_FADE_PAD = 4

/** 保留不透明度的取值范围 */
export const FADE_ALPHA_MIN = 0
export const FADE_ALPHA_MAX = 1

/** 触发边距的取值范围 */
export const FADE_PAD_MIN = 0
export const FADE_PAD_MAX = 64

/** 点标记类型（元数据）。与 TYPES 并列但独立 —— 标记不参与图层切片 */
export const MARK_KINDS: Record<MarkKind, {
  name: string
  color: string
  icon: string
  desc: string
}> = {
  teleport: { name: '传送阵', color: '#a855f7', icon: '◎', desc: '传送落点' },
  monster: { name: '怪物', color: '#ef4444', icon: '☠', desc: '怪物刷新点' },
  chest: { name: '宝箱', color: '#eab308', icon: '❖', desc: '可开启容器' },
  npc: { name: 'NPC', color: '#22c55e', icon: '☺', desc: '角色 / 对话' },
  spawn: { name: '出生点', color: '#22d3ee', icon: '✦', desc: '玩家初始位置' },
  custom: { name: '自定义', color: '#94a3b8', icon: '·', desc: '其它用途' },
}

/** 标记类型顺序（与 Ctrl+1~6 快捷键一一对应） */
export const MARK_KEYS: MarkKind[] = ['teleport', 'monster', 'chest', 'npc', 'spawn', 'custom']

/**
 * 朝向：四向（与角色素材的正面 / 背面 / 左面 / 右面对应）。
 *
 * dx / dy 是箭头相对于锚点的偏移方向：
 *   down / up 的箭头排在图标正下方，left / right 的箭头排在图标侧边。
 */
export const MARK_FACINGS: Record<MarkFacing, {
  name: string
  arrow: string
  dx: number
  dy: number
}> = {
  down: { name: '正面', arrow: '▼', dx: 0, dy: 1 },
  up: { name: '背面', arrow: '▲', dx: 0, dy: -1 },
  left: { name: '左面', arrow: '◀', dx: -1, dy: 0 },
  right: { name: '右面', arrow: '▶', dx: 1, dy: 0 },
}

/** 朝向顺序（属性面板上的四个按钮按这个顺序排） */
export const FACING_KEYS: MarkFacing[] = ['down', 'up', 'left', 'right']

/** 工具显示名 */
export const TOOLS: Record<ToolId, string> = {
  select: '选择', rect: '矩形', poly: '多边形', free: '自由绘制', erase: '删除', pan: '平移', mark: '放标记',
}

/** 每个工具的帮助文案 */
export const TOOL_HELP: Record<ToolId, string> = {
  select: '<b>选择模式</b>（默认）：鼠标<b>悬停即自动选中</b>区域。<br>拖内部移动 · 拖四角/顶点改形 · <kbd>Alt</kbd>+点顶点删除顶点 · 双击边插入顶点 · <kbd>Shift</kbd> 锁轴。<br><b>方向键</b>上下左右微移 1px，<kbd>Shift</kbd>+方向键 10px。',
  rect: '<b>绘制 · 矩形</b>：在画布上<b>按住左键拖动，松开立即固定</b>。<br><kbd>Shift</kbd> 正方形 · <kbd>Alt</kbd> 从中心向外。<br>作用层级取上方的「作用层级」设置，按下鼠标那一刻锁定。',
  poly: '<b>绘制 · 多边形</b>：逐次单击加点，回到起点 / <kbd>C</kbd> / 双击 闭合。<br><kbd>Backspace</kbd> 撤销上一点 · <kbd>Esc</kbd> 取消。',
  free: '<b>绘制 · 自由</b>：按住左键<b>随手勾画</b>，松开立即生成区域（自动抽稀顶点）。',
  erase: '<b>删除</b>：点击区域即可删除。悬停会显示区域信息。',
  pan: '<b>移动视图</b>：按住左键拖动平移画布，<b>不会</b>移动区域。<br>任何工具下都可以用右键 / 中键 / <kbd>空格</kbd>+拖动。',
  mark: '<b>放置标记</b>：在画布上单击即放下一个点标记（传送阵 / 怪物 / 宝箱 / NPC 等）。<br>标记类型用 <kbd>Ctrl</kbd>+<kbd>1</kbd>~<kbd>6</kbd> 切换。<br>选中标记后按住 <kbd>Shift</kbd> 点另一个标记可预览两者之间的路径。',
}

/** 本地存档键 */
export const STORAGE_KEY = 'darkmansion.map.v1'

/** 撤销栈最大深度 */
export const HISTORY_MAX = 120

/**
 * 自动存档去抖间隔（毫秒）。
 * 方向键微移、拖拽顶点、改透明度都是高频操作，
 * 每次都 JSON.stringify 整个区域列表纯属浪费，去抖后只在停下时落一次盘。
 */
export const SAVE_DEBOUNCE_MS = 400

/** 悬停多久后自动聚焦到区域（毫秒） */
export const HOVER_FOCUS_MS = 170

/** 缩放上下限 */
export const ZOOM_MIN = 0.02
export const ZOOM_MAX = 16

/** 默认画布尺寸 */
export const DEFAULT_CANVAS = { w: 1920, h: 1080 }

/** 默认角色参数
 *  anchorX / anchorY = 脚底中心；boxW / boxH 是脚底碰撞箱（判定用，与立绘无关）。 */
export const DEFAULT_CHAR = {
  x: 200, y: 200, w: 36, h: 56, speed: 5,
  ghostAlpha: 0.35, anchorX: 0.5, anchorY: 1,
  boxW: 14, boxH: 8,
}

/** 脚底碰撞箱的尺寸上下限（地图像素） */
export const FOOT_BOX_MIN = 2
export const FOOT_BOX_MAX = 400
