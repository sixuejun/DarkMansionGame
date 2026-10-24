import type { LayerId, MapProject } from '../../types/map'
import { toMapJson, safeName } from './mapFormat'
import { makeZip } from './zip'

/** 把某个图层的 PNG 渲染成字节流（统一缩放到画布尺寸） */
export async function renderLayerToPng(project: MapProject, id: LayerId): Promise<Uint8Array> {
  const c = document.createElement('canvas')
  c.width = project.canvas.w
  c.height = project.canvas.h
  const ctx = c.getContext('2d')
  const L = project.layers[id]
  if (ctx && L.img) ctx.drawImage(L.img, 0, 0, project.canvas.w, project.canvas.h)
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'))
  return new Uint8Array(await (blob as Blob).arrayBuffer())
}

/**
 * 游戏数据导出：ZIP 包
 *   map_name/background.png  白层
 *   map_name/objects.png     黑层
 *   map_name/foreground.png  前景层（没载入前景图时省略此文件）
 *   map_name/map.json        地图配置
 */
export async function buildGameZip(project: MapProject): Promise<Blob> {
  const enc = new TextEncoder()
  const base = safeName(project.name)
  const files: { name: string; data: Uint8Array }[] = []

  const loaded: { id: LayerId; file: string }[] = [
    { id: 'background', file: `${base}/background.png` },
    { id: 'objects', file: `${base}/objects.png` },
  ]
  /* 前景层是可选的：没载入就不打这个文件，运行器按「文件不存在 = 无前景层」处理 */
  if (project.layers.foreground.img) {
    loaded.push({ id: 'foreground', file: `${base}/foreground.png` })
  }

  const pngs = await Promise.all(loaded.map(l => renderLayerToPng(project, l.id)))
  loaded.forEach((l, i) => files.push({ name: l.file, data: pngs[i] }))

  files.push({ name: `${base}/map.json`, data: enc.encode(JSON.stringify(toMapJson(project), null, 2)) })
  return makeZip(files)
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 8000)
}

/** 触发浏览器下载一段文本 */
export function downloadText(text: string, filename: string, mime = 'application/json'): void {
  downloadBlob(new Blob([text], { type: mime }), filename)
}
