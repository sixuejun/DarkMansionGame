import { tryMoveChar } from '@/core/preview';
import type { MapProject } from '@/types/map';

/**
 * 角色移动。
 *
 * ## 为什么要直接复用 core/preview.ts 的 tryMoveChar
 *
 * 规格第七章列了四个坑（单步跳跃 / 卡在缝里 / 斜向卡死 / 踩在红区里锁死），
 * 编辑器已经把这四个坑全部解决并有 115 个断言守着（test_footbox.cjs）。
 * **绝不能另写一套** —— 规格明确警告过：
 * 「否则会出现『编辑器说这条路能走、游戏里走不通』」。
 *
 * 所以这里只做一件事：把「输入方向」翻译成「每帧位移」，判定交给 tryMoveChar。
 */

/** 输入方向（八向） */
export interface MoveInput {
  x: number;
  y: number;
}

/** 按住 WASD / 方向键时的移动输入 */
const KEY_MAP: Record<string, MoveInput> = {
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/** 键盘输入状态 */
export class Keyboard {
  private pressed = new Set<string>();

  /** 绑定到 window */
  constructor(private target: Window = window) {}

  attach(): void {
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    /* 失焦时清空，避免「按住方向键切到别的标签页后角色一直走」 */
    this.target.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (KEY_MAP[e.code]) {
      this.pressed.add(e.code);
      /* 方向键会滚动页面，按住时挡掉 */
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
  };

  private onBlur = (): void => {
    this.pressed.clear();
  };

  /** 当前输入方向（已归一化到长度 ≤ 1） */
  get input(): MoveInput {
    let x = 0;
    let y = 0;
    for (const code of this.pressed) {
      const d = KEY_MAP[code];
      if (!d) continue;
      x += d.x;
      y += d.y;
    }
    const len = Math.hypot(x, y);
    if (len === 0) return { x: 0, y: 0 };
    /* 斜向归一化：斜着走不能比直着快 */
    return { x: x / len, y: y / len };
  }
}

/**
 * 推进一帧的移动。
 *
 * @param dt 距上一帧的秒数
 * @param speed 移动速度（地图像素 / 秒）
 */
export function stepMovement(
  project: MapProject,
  input: MoveInput,
  dt: number,
  speed: number,
): boolean {
  if (input.x === 0 && input.y === 0) return false;
  const dx = input.x * speed * dt;
  const dy = input.y * speed * dt;
  return tryMoveChar(project, dx, dy);
}
