<script setup lang="ts">
/**
 * 应用入口：加载地图 → 显示手机外壳 → 跑渲染循环。
 *
 * 地图 URL 必须是**可跨域的绝对 URL**（见《使用说明》9.1）——
 * 相对路径在 CDN 场景下会解析到 CDN 路径下，既拿不到文件也会撞 CORS。
 */
import { onMounted } from 'vue';
import { state } from '@/状态/store';
import { loadMap } from '@/核心/地图加载';
import PhoneShell from '@/界面/手机外壳.vue';
import MapView from '@/界面/地图视图.vue';

/** 地图地址：本地开发用 Vite 静态资源；部署时换成 jsdelivr 上的绝对地址 */
const 地图地址 = import.meta.env.VITE_MAP_URL ?? '/map.zip';

onMounted(async () => {
  state.status = 'loading';
  try {
    const { project } = await loadMap(地图地址);
    state.project = project;
    state.status = 'ready';
    console.info('[暗堕之馆] 地图加载完成', {
      画布: project.canvas,
      区域数: project.regions.length,
      实体数: project.marks.length,
      出生点: { x: project.char.x, y: project.char.y },
    });
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    state.status = 'error';
    console.error('[暗堕之馆] 地图加载失败', e);
  }
});
</script>

<template>
  <div class="应用">
    <div v-if="state.status === 'loading'" class="占位">地图加载中…</div>
    <div v-else-if="state.status === 'error'" class="占位 错误">
      <p>地图加载失败</p>
      <pre>{{ state.error }}</pre>
    </div>
    <PhoneShell v-else :width="420">
      <MapView />
    </PhoneShell>
  </div>
</template>

<style scoped>
.应用 {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 100vh;
}

.占位 {
  color: #8b93a7;
  font-size: 14px;
  text-align: center;
}

.错误 {
  color: #f87171;
}

.错误 pre {
  max-width: 70vw;
  overflow: auto;
  padding: 10px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  font-size: 12px;
  text-align: left;
}
</style>
