import {
  adjustRegions,
  buildTopObjects,
  charState,
  layerSlices,
  type LayerSlices,
} from '@/core/preview';
import { buildFadedForeground, updateFadeTargets } from '@/core/fade';
import type { MapProject, Point, Region } from '@/types/map';

/**
 * 八步绘制管线（严格按《使用说明》第四章的 render_order）。
 *
 * ```
 * background_below → objects_lower → character → background_above
 * → objects_upper → character_ghost → foreground → top
 * ```
 *
 * ## 两个关键约定
 *
 * 1. **始终走统一切片**，不按「是否在遮挡区」分叉。
 *    规格 4.5 明确要求这一点：统一走切片，行为才与 render_order 严格一致，
 *    也不会出现「走进黄区前后画面突变」的怪问题。
 *
 * 2. **切片结果按签名缓存**（core/preview.ts 内部实现），
 *    角色每帧移动不会触发全尺寸画布重建。
 */

/** 镜头 */
export interface Camera {
  /** 镜头中心（地图像素） */
  x: number;
  y: number;
  /** 缩放：1 = 一个地图像素对应一个 CSS 像素 */
  zoom: number;
}

/** 绘制选项 */
export interface DrawOptions {
  /** 视口宽高（CSS 像素） */
  width: number;
  height: number;
  /** 是否绘制调试叠加层 */
  debug?: boolean;
}

/** 角色占位立绘（暂无角色美术资源，先用可辨识的色块） */
function drawChar(
  ctx: CanvasRenderingContext2D,
  project: MapProject,
  alpha: number,
  clipRegions: Region[] | null,
  inverseClip: boolean,
): void {
  const c = project.char;
  const ox = c.x - c.w * c.anchorX;
  const oy = c.y - c.h * c.anchorY;

  ctx.save();

  if (clipRegions && clipRegions.length > 0) {
    ctx.beginPath();
    if (inverseClip) {
      /* 反向裁剪：先铺满整张画布，再用 evenodd 挖掉裁剪区域 */
      ctx.rect(-ox - 1e4, -oy - 1e4, 2e4, 2e4);
    }
    for (const r of clipRegions) {
      if (r.shape === 'rect' && r.points.length >= 2) {
        const a = r.points[0];
        const b = r.points[1];
        ctx.rect(
          Math.min(a.x, b.x) - ox,
          Math.min(a.y, b.y) - oy,
          Math.abs(a.x - b.x),
          Math.abs(a.y - b.y),
        );
      } else if (r.shape === 'poly' && r.points.length >= 3) {
        ctx.moveTo(r.points[0].x - ox, r.points[0].y - oy);
        for (let i = 1; i < r.points.length; i++) ctx.lineTo(r.points[i].x - ox, r.points[i].y - oy);
        ctx.closePath();
      }
    }
    ctx.clip(inverseClip ? 'evenodd' : 'nonzero');
  }

  /* 身体 */
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#4f8cff';
  ctx.beginPath();
  ctx.moveTo(c.w * 0.5, c.h * 0.26);
  ctx.lineTo(c.w * 0.92, c.h * 0.45);
  ctx.lineTo(c.w * 0.78, c.h);
  ctx.lineTo(c.w * 0.22, c.h);
  ctx.lineTo(c.w * 0.08, c.h * 0.45);
  ctx.closePath();
  ctx.fill();

  /* 头 */
  ctx.fillStyle = '#a9c9ff';
  ctx.beginPath();
  ctx.arc(c.w * 0.5, c.h * 0.17, c.h * 0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** 画一张图层切片 */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement | HTMLImageElement | null,
  opacity: number,
  w: number,
  h: number,
): void {
  if (!src) return;
  ctx.globalAlpha = opacity;
  ctx.drawImage(src, 0, 0, w, h);
  ctx.globalAlpha = 1;
}

/** 调试叠加层：画区域边框与碰撞盒 */
function drawDebug(ctx: CanvasRenderingContext2D, project: MapProject, camera: Camera): void {
  const colors: Record<string, string> = {
    collision: 'rgba(239,68,68,0.9)',
    occlusion: 'rgba(168,85,247,0.9)',
    adjust: 'rgba(234,179,8,0.9)',
    top: 'rgba(34,197,94,0.9)',
    fade: 'rgba(34,211,238,0.9)',
  };
  ctx.save();
  ctx.lineWidth = 1 / camera.zoom;
  for (const r of project.regions) {
    ctx.strokeStyle = colors[r.type] ?? 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    if (r.shape === 'rect') {
      const a = r.points[0];
      const b = r.points[1];
      ctx.rect(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.abs(a.x - b.x),
        Math.abs(a.y - b.y),
      );
    } else {
      ctx.moveTo(r.points[0].x, r.points[0].y);
      for (let i = 1; i < r.points.length; i++) ctx.lineTo(r.points[i].x, r.points[i].y);
      ctx.closePath();
    }
    ctx.stroke();
  }
  /* 碰撞盒 */
  const c = project.char;
  ctx.strokeStyle = '#00ff88';
  ctx.strokeRect(c.x - c.boxW / 2, c.y - c.boxH / 2, c.boxW, c.boxH);
  ctx.restore();
}

/**
 * 绘制一帧。
 *
 * @param ctx 目标 2D 上下文（尺寸应为 width × height，已按 devicePixelRatio 缩放）
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  project: MapProject,
  camera: Camera,
  opts: DrawOptions,
): void {
  const { width, height } = opts;
  const W = project.canvas.w;
  const H = project.canvas.h;
  const zoom = camera.zoom;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, width, height);

  /* 世界 → 屏幕：先缩放，再平移（平移量要按缩放折算） */
  ctx.setTransform(zoom, 0, 0, zoom, -camera.x * zoom + width / 2, -camera.y * zoom + height / 2);

  /* 当前命中的遮挡区（决定白层上片与副本） */
  const active = charState(project).winner;

  const bg: LayerSlices = layerSlices(project, 'background', active);
  const ob: LayerSlices = layerSlices(project, 'objects', active);

  /* 1. background_below —— 白层留在角色下方 */
  drawLayer(ctx, bg.below, project.layers.background.opacity, W, H);
  /* 2. objects_lower —— 黑层被开洞落到角色下方的部分 */
  drawLayer(ctx, ob.below, project.layers.objects.opacity, W, H);
  /* 3. character —— 正常角色（完整、不透明） */
  drawChar(ctx, project, 1, null, false);
  /* 4. background_above —— 白层被紫区提到角色上方 */
  drawLayer(ctx, bg.above, project.layers.background.opacity, W, H);
  /* 5. objects_upper —— 黑层盖住角色的部分 */
  drawLayer(ctx, ob.above, project.layers.objects.opacity, W, H);
  /* 6. character_ghost —— 半透明副本（只在遮挡态绘制，且只在黄色区外） */
  if (active) {
    drawChar(ctx, project, project.char.ghostAlpha, adjustRegions(project), true);
  }
  /* 7. foreground —— 前景层（命中淡化区则整件变半透） */
  const fadeTargets = updateFadeTargets(project);
  drawLayer(ctx, buildFadedForeground(project, fadeTargets), project.layers.foreground.opacity, W, H);
  /* 8. top —— 绿色最上层（白层 + 黑层的 top 段） */
  drawLayer(ctx, buildTopObjects(project), 1, W, H);

  if (opts.debug) drawDebug(ctx, project, camera);
}

/**
 * 镜头跟随：把镜头中心对准角色，并夹在地图范围内。
 *
 * 地图比视口小的时候（某一维度），该维度居中显示而不是卡边。
 */
export function followCamera(
  camera: Camera,
  target: Point,
  project: MapProject,
  viewW: number,
  viewH: number,
): void {
  const halfW = viewW / 2 / camera.zoom;
  const halfH = viewH / 2 / camera.zoom;
  const W = project.canvas.w;
  const H = project.canvas.h;

  camera.x = halfW * 2 >= W ? W / 2 : Math.min(Math.max(target.x, halfW), W - halfW);
  camera.y = halfH * 2 >= H ? H / 2 : Math.min(Math.max(target.y, halfH), H - halfH);
}
