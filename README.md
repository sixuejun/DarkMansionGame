# 暗堕之馆 · 实时探索玩法

独立 Vite 仓库，用于《暗堕之馆》的实时探索玩法开发（黑雾探索、点灯、宝箱成长、战斗压制、随机事件）。

## 为什么要独立于 yashiki

| 理由 | 说明 |
| --- | --- |
| **开发体验** | Vite 有真 HMR 与静态服务，调参数秒刷新；yashiki 的 webpack watch 只有增量重建，没有 HMR |
| **依赖隔离** | 游戏要 Konva/Canvas/Vue，与酒馆助手的 iframe 环境、jQuery、toastr 全无关系 |
| **发布自由** | jsdelivr 支持任意 gh 仓库，用户可直接 `import 'https://testingcf.jsdelivr.net/gh/sixuejun/DarkMansionGame/dist/...'` |
| **设计文档留在 yashiki** | 玩法层文档、地图规格、参考 ZIP 仍在 yashiki，本仓库只放代码 |

## 目录结构

```
src/
├── core/              # 从地图编辑器移植的纯逻辑层（零 Vue 依赖）
│   ├── geometry.ts    #   几何判定：rectOfRegion / pointInPoly / regionHitRect
│   ├── preview.ts     #   移动判定：overlappingRegions / tryMoveChar（含四个坑）
│   ├── nav.ts         #   寻路：buildGrid / findPath / planPatrol / verifyPath
│   ├── fade.ts        #   前景淡化（迟滞触发 + 缓存）
│   ├── io/zip.ts      #   无依赖 ZIP 读写（DecompressionStream）
│   └── io/mapFormat.ts#   map.json 解析
├── types/map.ts       # 地图数据类型（与编辑器一致）
├── 核心/              # 游戏层
│   ├── 地图加载.ts     #   fetch ZIP → map.json + PNG → 运行时工程
│   ├── 绘制.ts         #   八步绘制管线 + 镜头跟随
│   ├── 移动.ts         #   键盘输入 → 每帧位移（判定复用 core/preview）
│   └── 参数.ts         #   zod 定义的��部可调参数
├── 状态/store.ts      # 全局状态
└── 界面/              # Vue 组件
    ├── 手机外壳.vue
    └── 地图视图.vue    #   Canvas 宿主 + 渲染循环
```

## 核心复用约定（最重要）

**运行器与编辑器必须共用同一份判定实现**，否则会出现「编辑器说这条路能走、游戏里走不通」。

本仓库的做法是：**逐字移植**编辑器 `src/core/`，并把编辑器的 14 个测试文件**逐字节复制**过来。

```
scripts/port-core.cjs   # 重新移植（编辑器更新后跑一次）
tests/run.cjs           # 跑全部测试
```

移植脚本只做一件事：把 `from '@/types/map'` 改成相对路径，其余一字不改。

这样每次移植后，只要 585 个断言仍然全绿，就证明**行为与编辑器完全一致**。

## 开发

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # 14 个测试文件
pnpm typecheck
pnpm build
```

地图默认从 `public/map.zip` 加载（Vite 静态资源）。
部署时用环境变量指定绝对 URL：

```
VITE_MAP_URL=https://testingcf.jsdelivr.net/gh/sixuejun/yashiki/dist/map.zip
```

> ⚠ 地图 ZIP **必须**是可跨域的绝对 URL，不能用相对路径 fetch
> （脚本通过 CDN 加载后，相对路径会解析到 CDN 路径下，既拿不到文件也会撞 CORS）。

## 当前进度

| 阶段 | 状态 |
| --- | --- |
| P0 复用验证（core/ 移植 + 测试） | ✅ 585 断言全绿 |
| P1 最小切片（移动 + 镜头跟随 + 渲染管线） | ✅ 地图加载、八步绘制、碰撞移动、镜头跟随均已跑通 |
| P2 垂直切片（迷雾 + 点灯） | ⬜ |
| P3 玩法系统（战斗 / 宝箱 / 敌人 AI / 事件 / 存档） | ⬜ |
| P4 酒馆适配（脚本入口 + 浮窗 + 变量持久化 + generate） | ⬜ |

## 相关文档

- 玩法层：`yashiki/暗堕之馆-玩法设计.md`
- 地图运行器规格（自包含）：`yashiki/参考/参考ZIP/使用说明.md`
- 编辑器规格：`Dark馆地图编辑器/开发文档.md`
