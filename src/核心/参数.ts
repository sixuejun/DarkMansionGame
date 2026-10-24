import { z } from 'zod';

/**
 * 全部可调参数集中在这里。
 *
 * 数值全部是**初始建议**，必须实测后定死（见玩法设计文档第十一章）。
 * 写进 zod schema 是为了：默认值、类型、可调范围由一处定义，
 * 后面接 UI 面板时直接复用。
 */

/** 光照与迷雾 */
export const 光照参数 = z.object({
  /** 随身光满强度时的照明半径（地图像素） */
  playerLightRadius: z.number().default(96),
  /** 随身光在黑暗中的衰减速度（每秒） */
  darkShrinkRate: z.number().default(0.06),
  /** 在灯光范围内的恢复速度（每秒） */
  lightRecoverRate: z.number().default(0.35),
  /** 足迹光半径 */
  footprintRadius: z.number().default(64),
  /** 足迹光持续时间（秒） */
  footprintDuration: z.number().default(8),
  /** 单盏灯的照明半径 */
  lampRadius: z.number().default(180),
  /** 黑暗中的灵力流失速率（每秒） */
  fogDrainRate: z.number().default(3),
}).prefault({});

/** 战斗 */
export const 战斗参数 = z.object({
  /** 自动攻击间隔（秒） */
  attackInterval: z.number().default(0.8),
  /** 自动攻击命中半径 */
  attackRange: z.number().default(28),
  /** 削弱比例 */
  weakenRatio: z.number().default(0.1),
  /** 敌人察觉半径 */
  aggroRange: z.number().default(42),
  /** 脱离战斗所需的持续脱离时间（秒） */
  disengageTime: z.number().default(1),
  /** 敌人每次命中的灵力扣除 */
  enemyDamage: z.number().default(8),
  /** 受击时存在值下降概率 */
  existDropChance: z.number().default(0.15),
  /** 存在值单次下降比例 */
  existDropAmountRatio: z.number().default(0.03),
}).prefault({});

/** 成长与敌人 */
export const 成长参数 = z.object({
  /** 初始存在值 */
  playerExistInit: z.number().default(20),
  /** 普通宝箱收益区间 */
  chestExistGainMin: z.number().default(8),
  chestExistGainMax: z.number().default(12),
  /** 精英宝箱收益区间 */
  eliteChestExistGainMin: z.number().default(15),
  eliteChestExistGainMax: z.number().default(20),
  /** 灵力上限 */
  playerHpMax: z.number().default(100),
  /** 巡回怪存在值区间 */
  patrolExistMin: z.number().default(40),
  patrolExistMax: z.number().default(60),
  /** 镇守怪存在值区间 */
  guardExistMin: z.number().default(90),
  guardExistMax: z.number().default(130),
}).prefault({});

/** 事件 */
export const 事件参数 = z.object({
  /** 门口事件触发半径 */
  doorEventRadius: z.number().default(64),
  /** 触发概率 */
  doorEventChance: z.number().default(0.35),
}).prefault({});

/** 表现 / 调试 */
export const 表现参数 = z.object({
  /** 镜头缩放（1 = 一个地图像素对应一个 CSS 像素） */
  cameraZoom: z.number().min(0.25).max(4).default(1),
  /** 角色移动速度（地图像素 / 秒） */
  moveSpeed: z.number().default(180),
  /** 是否绘制调试叠加层（区域边框、碰撞盒） */
  debugOverlay: z.boolean().default(false),
}).prefault({});

/** 全部参数 */
export const 全部参数 = z
  .object({
    光照: 光照参数,
    战斗: 战斗参数,
    成长: 成长参数,
    事件: 事件参数,
    表现: 表现参数,
  })
  .prefault({});

export type 全部参数类型 = z.infer<typeof 全部参数>;

/** 默认参数实例 */
export const 默认参数: 全部参数类型 = 全部参数.parse({});
