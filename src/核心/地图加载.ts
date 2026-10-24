import { readZip } from '@/core/io/zip';
import { canvasFromMapJson, marksFromMapJson, regionsFromMapJson } from '@/core/io/mapFormat';
import type { LayerState, MapProject } from '@/types/map';

/**
 * 地图加载：ZIP → map.json + 三张 PNG → 运行时工程。
 *
 * ZIP 内文件按 **basename** 匹配，不写死路径 —— 实际包内是 `map/` 前缀，
 * 但规格允许任意嵌套目录（见《使用说明》1.1）。
 *
 * ⚠ foreground.png 是可选的，缺失时必须容错，不能报错。
 */

/** 加载结果 */
export interface LoadedMap {
  /** 运行时工程（复用编辑器的 MapProject 形态，core/ 的函数可直接吃） */
  project: MapProject;
  /** 原始 map.json，供后续读取 rules / render_order 等说明字段 */
  raw: Record<string, any>;
}

/** 按 basename 在 ZIP 清单里找文件 */
function findByBasename(files: Map<string, Uint8Array>, basename: string): Uint8Array | null {
  for (const [name, data] of files) {
    const parts = name.split('/');
    if (parts[parts.length - 1] === basename) return data;
  }
  return null;
}

/** Uint8Array → HTMLImageElement */
function loadImage(data: Uint8Array): Promise<HTMLImageElement> {
  const blob = new Blob([data as BlobPart], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('PNG 解码失败'));
    };
    img.src = url;
  });
}

/** 建一个空图层 */
function emptyLayer(): LayerState {
  return { img: null, w: 0, h: 0, visible: true, locked: false, opacity: 1 };
}

/** 读角色判定参数 → CharState */
function actorToChar(actor: Record<string, any> | undefined, x: number, y: number) {
  const sprite = actor?.sprite ?? {};
  const box = actor?.collision_box ?? {};
  return {
    x,
    y,
    w: Number(sprite.width) || 36,
    h: Number(sprite.height) || 56,
    speed: 5,
    ghostAlpha: Number(actor?.ghost_alpha) || 0.35,
    anchorX: Number(actor?.anchor?.x) || 0.5,
    anchorY: Number(actor?.anchor?.y) || 1,
    boxW: Number(box.width) || 26,
    boxH: Number(box.height) || 9,
  };
}

/**
 * 从 ZIP 字节加载地图。
 *
 * @param bytes ZIP 内容
 */
export async function loadMapFromZip(bytes: ArrayBuffer): Promise<LoadedMap> {
  const files = await readZip(bytes);

  const mapEntry = findByBasename(files, 'map.json');
  if (!mapEntry) throw new Error('ZIP 里找不到 map.json');
  const raw = JSON.parse(new TextDecoder().decode(mapEntry)) as Record<string, any>;

  const canvas = canvasFromMapJson(raw) ?? { w: 1920, h: 1080 };
  const regions = regionsFromMapJson(raw);
  const marks = marksFromMapJson(raw);

  /* 图层：background / objects 必需，foreground 可选 */
  const layers = {
    background: emptyLayer(),
    objects: emptyLayer(),
    foreground: emptyLayer(),
  };
  const bgData = findByBasename(files, 'background.png');
  const obData = findByBasename(files, 'objects.png');
  if (!bgData) throw new Error('ZIP 里找不到 background.png');
  if (!obData) throw new Error('ZIP 里找不到 objects.png');

  const bgImg = await loadImage(bgData);
  const obImg = await loadImage(obData);
  layers.background.img = bgImg;
  layers.background.w = bgImg.naturalWidth;
  layers.background.h = bgImg.naturalHeight;
  layers.objects.img = obImg;
  layers.objects.w = obImg.naturalWidth;
  layers.objects.h = obImg.naturalHeight;

  const fgData = findByBasename(files, 'foreground.png');
  if (fgData) {
    const fgImg = await loadImage(fgData);
    layers.foreground.img = fgImg;
    layers.foreground.w = fgImg.naturalWidth;
    layers.foreground.h = fgImg.naturalHeight;
  }

  /* 出生点：优先用 spawn 实体，没有就退回画布中心 */
  const spawn = marks.find((m) => m.kind === 'spawn');
  const project: MapProject = {
    name: String(raw.name ?? 'map'),
    canvas,
    layers,
    regions,
    marks,
    seq: regions.length,
    char: actorToChar(raw.actor, spawn?.x ?? canvas.w / 2, spawn?.y ?? canvas.h / 2),
  };

  return { project, raw };
}

/** 从 URL 加载地图（必须是可跨域的绝对 URL —— 见《使用说明》9.1） */
export async function loadMap(url: string): Promise<LoadedMap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`地图下载失败：HTTP ${res.status}`);
  return loadMapFromZip(await res.arrayBuffer());
}
