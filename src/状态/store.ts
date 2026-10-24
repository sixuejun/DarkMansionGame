import { reactive } from 'vue';
import type { MapProject } from '@/types/map';
import { 默认参数, type 全部参数类型 } from '@/核心/参数';

/**
 * 全局游戏状态。
 *
 * 用 reactive 而不是 pinia —— 当前只有一个视图、一份状态，
 * 上 pinia 是过度设计。等加入存档 / 多楼层时再换。
 */
export interface GameState {
  /** 运行时工程（地图 + 角色 + 区域 + 实体） */
  project: MapProject | null;
  /** 加载状态 */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** 错误信息 */
  error: string;
  /** 可调参数 */
  params: 全部参数类型;
}

export const state = reactive<GameState>({
  project: null,
  status: 'idle',
  error: '',
  params: 默认参数,
});
