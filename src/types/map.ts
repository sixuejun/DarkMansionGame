/**
 * 统一地图数据类型。
 *
 * 所有编辑操作（绘制、顶点编辑、撤销重做、导入导出）都基于这里定义的结构，
 * 任何模块都不允许自行发明第二套形状描述。
 */

/** 五种逻辑区域类型 */
export type RegionType = 'top' | 'collision' | 'occlusion' | 'adjust' | 'fade'

/** 区域作用的目标图层（fade 固定作用于前景层） */
export type RegionTarget = 'background' | 'objects' | 'both' | 'foreground'

/** 区域形状：矩形（两点）或多边形（多点） */
export type RegionShape = 'rect' | 'poly'

/** 编辑器工具 */
export type ToolId = 'select' | 'rect' | 'poly' | 'free' | 'erase' | 'pan' | 'mark'

/** 平面坐标点 */
export interface Point {
  x: number
  y: number
}

/** 包围盒（与原始单文件实现保持一致：w / h） */
export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/** map.json 使用的包围盒（width / height） */
export interface JsonBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 一个逻辑区域（白层/黑层之外的注解层） */
export interface Region {
  id: string
  name: string
  type: RegionType
  target: RegionTarget
  /** 优先级，数值大者优先 */
  priority: number
  shape: RegionShape
  /** rect 存 2 点（左上/右下），poly 存全部顶点 */
  points: Point[]
  /** 创建顺序，作为同优先级同类型时的最后裁决依据 */
  seq: number
  /** 淡化后保留的不透明度：0 = 完全消失，0.15 = 只剩 15% 轮廓感。仅 fade 使用 */
  fadeAlpha?: number
  /** 触发迟滞边距（地图像素），仅矩形生效。仅 fade 使用 */
  fadePad?: number
  /** 精确淡出边界。null / 缺省 = 直接用 points 作为边界。仅 fade 使用 */
  clip?: { shape: RegionShape; points: Point[] } | null
}

/** 画布尺寸 */
export interface CanvasSize {
  w: number
  h: number
}

/** 单个 PNG 图层 */
export interface LayerState {
  img: HTMLImageElement | null
  w: number
  h: number
  visible: boolean
  locked: boolean
  opacity: number
}

/** 图层 id 集合：白层（场景）+ 黑层（物件）+ 前景层（淡出） */
export type LayerId = 'background' | 'objects' | 'foreground'

/** 预览用测试角色 */
export interface CharState {
  /** 脚底锚点的世界坐标（地图像素）。碰撞与遮挡判定都以它为中心 */
  x: number
  y: number
  /** 立绘外框尺寸 —— 只影响显示，永远不参与碰撞 */
  w: number
  h: number
  speed: number
  /** 半透明副本的全局透明度 0~1（不作用于正常角色） */
  ghostAlpha: number
  /** 锚点相对立绘外框的位置（0~1），默认 (0.5, 1) = 脚底中心 */
  anchorX: number
  anchorY: number
  /**
   * 脚底碰撞箱尺寸（地图像素）。
   * 这是唯一参与通行判定的形状：只要这个盒子与红区不重叠，角色就能通过，
   * 与立绘外框无关 —— 否则密集红区会让角色完全走不动。
   */
  boxW: number
  boxH: number
}

/** 整个地图工程 —— 唯一的项目状态容器 */
export interface MapProject {
  name: string
  canvas: CanvasSize
  layers: Record<LayerId, LayerState>
  regions: Region[]
  /** 点标记（与 regions 平行，不参与任何图层切片） */
  marks: Mark[]
  seq: number
  char: CharState
}

/** 点标记类型（与 Region 平行，不参与任何图层切片） */
export type MarkKind = 'teleport' | 'monster' | 'chest' | 'npc' | 'spawn' | 'custom'

/**
 * 朝向：四向，不是角度。
 *
 * 标记和角色一样是独立建模的物体 —— 一个怪物模型有正面 / 背面 / 左面 / 右面，
 * 编辑器要能指定「这一处用哪一面面对镜头」，这样以后把四向素材放进运行器就能直接用。
 *
 * down = 正面（朝向镜头 / 向下）· up = 背面 · left = 左面 · right = 右面
 */
export type MarkFacing = 'down' | 'up' | 'left' | 'right'

/** 一个点标记 */
export interface Mark {
  id: string
  kind: MarkKind
  name: string
  /** 脚底锚点（地图像素）。与角色用同一套约定：这是「站的位置」 */
  x: number
  y: number
  /** 朝向：配置用哪一面面对镜头。缺省 'down'（正面） */
  facing: MarkFacing
  /** 脚底碰撞箱尺寸（地图像素）。可选，缺省用角色默认 */
  boxW?: number
  boxH?: number
  /** 自由标签：key → 字符串值。编辑器只存不解释 */
  tags?: Record<string, string>
  /** 巡逻路线（可选）。只对「会走动」的标记有意义，缺省表示不巡逻 */
  patrol?: PatrolRoute
}

/**
 * 巡逻路线：一串路径点 + 走法。
 *
 * 只记**路径点**，不记每一步 —— 相邻两点之间由运行器用编辑器同一套
 * 寻路绕开墙（`core/nav.ts` 的 `findPath`）。
 * 记成完整折线有两个问题：文件大，而且红区一改，存下来的路线就过期了。
 */
export interface PatrolRoute {
  /** 路径点（脚底落点，与标记 / 角色同一套坐标约定） */
  points: Point[]
  /** true = 闭环回路（走完最后一点回到第一点）；false = 来回往返 */
  loop: boolean
}

/** 视图（缩放/平移），不属于工程数据，不进存档 */
export interface ViewState {
  zoom: number
  x: number
  y: number
}

/** 绘制过程中的临时状态 */
export interface PenState {
  kind: 'rect' | 'poly' | 'free'
  type: RegionType
  /** 开始这一次绘制时选定的作用层级（写入新区域，不随中途切换而改变） */
  target: RegionTarget
  start: Point
  cur: Point
  /** 多边形已确定的顶点 / 自由绘制的抽稀结果 */
  pts: Point[]
  /** 自由绘制的原始轨迹 */
  raw: Point[] | null
  /** 矩形的实时预览框 */
  preview: Bounds | null
}

/** 可拖拽手柄 */
export interface Handle {
  x: number
  y: number
  /** 写回 points 的下标 */
  idx: number
  /** 矩形的角标识；多边形为 null */
  corner: 'tl' | 'tr' | 'br' | 'bl' | null
}

/** 撤销/重做使用的快照 */
export interface Snapshot {
  regions: Region[]
  marks: Mark[]
  seq: number
}

/** 导出用的 map.json（Web 通用格式） */
export interface MapJson {
  format: string
  version: number
  name: string
  canvas: { width: number; height: number }
  layers: { id: string; name: string; file: string; z_index: number }[]
  render_order: string[]
  /** 角色通行 / 遮挡判定参数（锚点在脚底，只按碰撞箱判定） */
  actor?: ActorJson
  rules: {
    priority_resolution: string
    type_tiebreak: string[]
    collision_test: string
    occlusion_test: string
    notes?: string
  }
  /** 前景淡化规则（仅前景层参与时才有意义，见「前景淡化方案」第九章） */
  fade?: FadeRulesJson
  /** 白层 / 黑层怎么切成上下片（运行器照这张表切） */
  layer_split?: LayerSplitJson
  regions: MapJsonRegion[]
  /** 点标记（传送阵 / 怪物 / 宝箱 / NPC 等）。运行器自行解释 tags */
  entities?: MarkJson[]
}

/** map.json 中的单个点标记 */
export interface MarkJson {
  id: string
  kind: MarkKind
  name: string
  /** 脚底落点（地图像素），与角色同一套约定 */
  x: number
  y: number
  /** 朝向（四向） */
  facing: MarkFacing
  /** 脚底盒尺寸（缺省用 actor.collision_box） */
  boxW?: number
  boxH?: number
  /** 自由标签：key → 字符串值 */
  tags?: Record<string, string>
  /** 巡逻路线（可选）。相邻两点之间由运行器寻路绕墙 */
  patrol?: PatrolRouteJson
}

/** map.json 中的巡逻路线 */
export interface PatrolRouteJson {
  /** 路径点（脚底落点） */
  points: { x: number; y: number }[]
  /** true = 闭环回路；false = 来回往返 */
  loop: boolean
}

/** 分层切片规则说明（写给运行器看） */
export interface LayerSplitJson {
  /** 白层：默认在角色下方，紫区内提到角色上方 */
  background: string
  /** 黑层：默认在角色上方，黄区内开洞落到底下 */
  objects: string
  /** 最顶层：合并两层的 top 区域内容 */
  top: string
  notes?: string
}

/** 前景淡化段的规则说明（写给运行器看，编辑器不再依赖它） */
export interface FadeRulesJson {
  test: string
  default_alpha: number
  default_pad: number
  hysteresis: string
  composite: string
  clip_default: string
  notes: string
}

/**
 * 角色判定参数。
 *
 * 规则（与编辑器预览完全一致）：
 *   - 锚点 anchor 是脚底点（position），立绘向上生长；
 *   - 通行判定只看 collision_box 这一小块，与立绘无关；
 *   - 遮挡判定同样只看 collision_box 进入 occlusion 区域。
 */
export interface ActorJson {
  /** 脚底锚点在立绘外框内的相对位置 */
  anchor: { x: number; y: number }
  /** 立绘外框（仅显示） */
  sprite: { width: number; height: number }
  /** 脚底碰撞箱尺寸（判定用，以锚点为中心） */
  collision_box: { width: number; height: number }
  /** 半透明副本透明度 */
  ghost_alpha: number
  /** 碰撞层判定：'aabb-overlap' —— 只要有重叠就不可通行 */
  collision_test: 'aabb-overlap'
  /** 遮挡层判定：'foot-box-overlap' */
  occlusion_test: 'foot-box-overlap'
}

/** map.json 中的单个区域 */
export interface MapJsonRegion {
  id: string
  name: string
  type: RegionType
  type_name: string
  target: RegionTarget
  priority: number
  shape: RegionShape
  points: Point[]
  bounds: JsonBounds
  order: number
  /** 以下三个字段仅 type === 'fade' 时输出 */
  fadeAlpha?: number
  fadePad?: number
  clip?: { shape: RegionShape; points: Point[] } | null
}
