<script setup lang="ts">
/**
 * 手机外壳。
 *
 * 尺寸刻意做成竖屏手机比例 —— 这不是为了好看，而是为了**尽早拿到真实的视口尺寸**。
 * 地图是 1536×1024 的世界坐标，立绘 36×56：
 *   - 缩放 1.0 → 立绘 36×56 CSS px，视野约占地图宽度 1/4（经典 2D RPG 视角）
 *   - 缩放到「整层地图全览」(0.26) → 立绘只剩 9×15 px，角色变成一个点
 * 所以视口宽度直接决定了镜头缩放的取值范围，必须在有画面之前就定下来。
 */
defineProps<{
  /** 面板宽度（CSS 像素） */
  width?: number;
}>();
</script>

<template>
  <div class="手机外壳" :style="{ width: `${width ?? 420}px` }">
    <div class="手机边框">
      <div class="手机屏幕">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.手机外壳 {
  display: flex;
  justify-content: center;
  padding: 16px;
}

.手机边框 {
  position: relative;
  width: 100%;
  border-radius: 34px;
  padding: 10px;
  background: linear-gradient(160deg, #2a2e3a 0%, #14161d 60%, #0d0f14 100%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 18px 50px rgba(0, 0, 0, 0.6);
}

.手机屏幕 {
  position: relative;
  border-radius: 26px;
  overflow: hidden;
  background: #05060a;
  /* 竖屏手机比例：9:16 */
  aspect-ratio: 9 / 16;
  max-height: calc(100vh - 64px);
}
</style>
