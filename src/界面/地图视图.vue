<script setup lang="ts">
/**
 * 地图视图：Canvas 宿主 + 渲染循环。
 *
 * 职责边界：
 * - 本组件只管「画」和「把输入喂给移动逻辑」；
 * - 所有绘制规则在 `核心/绘制.ts`；
 * - 所有移动规则在 `核心/移动.ts`（内部复用编辑器 core/preview 的 tryMoveChar）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { state } from '@/状态/store';
import { drawScene, followCamera, type Camera } from '@/核心/绘制';
import { Keyboard, stepMovement } from '@/核心/移动';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);

/** 镜头 */
const camera = ref<Camera>({ x: 0, y: 0, zoom: 1 });

const keyboard = new Keyboard();
let rafId = 0;
let lastTime = 0;

const 视口宽 = ref(0);
const 视口高 = ref(0);

/** 调整 canvas 尺寸到容器大小（考虑 devicePixelRatio） */
function resizeCanvas(): void {
  const canvas = canvasRef.value;
  const container = containerRef.value;
  if (!canvas || !container) return;
  const rect = container.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  视口宽.value = rect.width;
  视口高.value = rect.height;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
}

/** 渲染循环 */
function tick(now: number): void {
  rafId = requestAnimationFrame(tick);
  const canvas = canvasRef.value;
  const project = state.project;
  if (!canvas || !project) return;

  const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
  lastTime = now;

  /* 移动 */
  const input = keyboard.input;
  stepMovement(project, input, dt, state.params.表现.moveSpeed);

  /* 镜头跟随 */
  camera.value.zoom = state.params.表现.cameraZoom;
  followCamera(camera.value, project.char, project, 视口宽.value, 视口高.value);

  /* 绘制 */
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScene(ctx, project, camera.value, {
    width: 视口宽.value,
    height: 视口高.value,
    debug: state.params.表现.debugOverlay,
  });
}

onMounted(() => {
  resizeCanvas();
  keyboard.attach();
  const ro = new ResizeObserver(resizeCanvas);
  if (containerRef.value) ro.observe(containerRef.value);
  rafId = requestAnimationFrame(tick);
  onBeforeUnmount(() => ro.disconnect());

  /* 调试钩子：便于在浏览器控制台 / 自动化测试里读角色位置与镜头 */
  (window as any).__dm = {
    pos: () => (state.project ? { x: state.project.char.x, y: state.project.char.y } : null),
    camera: () => ({ ...camera.value }),
    project: () => state.project,
    params: state.params,
  };
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  keyboard.detach();
  delete (window as any).__dm;
});

/* 缩放变化时立刻重画，不用等下一帧 */
watch(
  () => state.params.表现.cameraZoom,
  () => {
    /* 下一帧自然会重画，这里只是保证参数立即生效 */
  },
);
</script>

<template>
  <div ref="containerRef" class="地图视图">
    <canvas ref="canvasRef" class="地图画布"></canvas>
  </div>
</template>

<style scoped>
.地图视图 {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #05060a;
}

.地图画布 {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  outline: none;
}
</style>
