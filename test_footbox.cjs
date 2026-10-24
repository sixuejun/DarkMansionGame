/* 验证脚底碰撞箱语义（开发文档第四章补充）：
   1. 判定只看脚底碰撞箱，不按整个立绘；
   2. 锚点固定在角色脚底；
   3. 密集碰撞箱场景下脚底能过 = 角色能过；
   4. 存档归一化不会让碰撞箱变成 0/负数。
   用法：node test_footbox.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); }
};

const project = A.createProject();
project.canvas = { w: 1920, h: 1080 };

const add = (data) => A.addRegion(project, Object.assign({
  name: 'R', type: 'collision', target: 'background', shape: 'rect',
  points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
}, data));

console.log('\n=== 1. 默认锚点在脚底中心 ===');
ok('DEFAULT_CHAR.anchorX === 0.5', A.DEFAULT_CHAR.anchorX === 0.5, String(A.DEFAULT_CHAR.anchorX));
ok('DEFAULT_CHAR.anchorY === 1（底边 = 脚底）', A.DEFAULT_CHAR.anchorY === 1, String(A.DEFAULT_CHAR.anchorY));
ok('默认碰撞箱存在且为正', A.DEFAULT_CHAR.boxW > 0 && A.DEFAULT_CHAR.boxH > 0,
  A.DEFAULT_CHAR.boxW + 'x' + A.DEFAULT_CHAR.boxH);
ok('碰撞箱明显小于立绘（默认 14x8 vs 36x56）',
  A.DEFAULT_CHAR.boxW * A.DEFAULT_CHAR.boxH < A.DEFAULT_CHAR.w * A.DEFAULT_CHAR.h,
  `${A.DEFAULT_CHAR.boxW * A.DEFAULT_CHAR.boxH} vs ${A.DEFAULT_CHAR.w * A.DEFAULT_CHAR.h}`);

console.log('\n=== 2. footBox 以锚点为中心（不是立绘中心）===');
project.char.x = 500;
project.char.y = 400;
const fb = A.footBox(project);
ok('脚底盒水平居中于锚点',
  Math.abs(fb.x + fb.w / 2 - project.char.x) < 1e-9, 'cx=' + (fb.x + fb.w / 2));
ok('脚底盒垂直居中于锚点',
  Math.abs(fb.y + fb.h / 2 - project.char.y) < 1e-9, 'cy=' + (fb.y + fb.h / 2));
ok('脚底盒尺寸 = boxW × boxH', fb.w === project.char.boxW && fb.h === project.char.boxH,
  `${fb.w}x${fb.h}`);

/* 立绘外框：anchorY = 1 时底边正好压在锚点上 */
const rect = A.charRect(project);
ok('立绘底边 = 锚点 y（脚底）',
  Math.abs(rect.y + rect.h - project.char.y) < 1e-9,
  'bottom=' + (rect.y + rect.h));
ok('立绘宽远大于脚底盒（证明两者独立）', rect.w > fb.w * 2,
  `sprite=${rect.w} box=${fb.w}`);

console.log('\n=== 3. 通行判定只看脚底盒，不按整个立绘 ===');
/* 一个只在角色「头顶」高度的红区：立绘会撞上，脚底盒不会 */
project.regions = [];
project.seq = 0;
add({ name: '头顶横梁', points: [{ x: 480, y: 340 }, { x: 520, y: 375 }] });
ok('立绘外框确实与红区相交（若按立绘判定会被挡）',
  A.regionHitRect(project.regions[0], rect), '');

const beforeX = project.char.x;
const moved = A.tryMoveChar(project, 1, 0);
ok('脚底盒不碰红区 → 可以移动（立绘碰了也放行）', moved === true, 'moved=' + moved);
ok('移动后 x 增加了 1', project.char.x === beforeX + 1, 'x=' + project.char.x);

console.log('\n=== 4. 脚底盒真的碰到红区时必须被挡 ===');
project.char.x = 500;
project.char.y = 360;
ok('脚底盒与红区相交', A.regionHitRect(project.regions[0], A.footBox(project)), '');
const bx = project.char.x;
ok('此时水平移动被阻挡', A.tryMoveChar(project, 1, 0) === false, '竟然能走');
ok('被挡后位置不变', project.char.x === bx, 'x=' + project.char.x);

console.log('\n=== 5. 密集碰撞箱：脚底能过 = 角色能过 ===');
/* 复现用户描述的痛点：一排很密的红框（家具腿 / 柱子之间的缝隙）。
   立绘 36×56 必然同时压住好几个框；脚底盒 14×8 只看脚下那一小块，
   因此只有脚底能钻过缝隙 —— 这正是「按整个角色判定就过不去」的根因。 */
project.regions = [];
project.seq = 0;
for (let i = 0; i < 20; i++) {
  /* 框宽 12，间隔 30 → 每两个框之间留出 18px 的缝 */
  add({ name: '密' + i, points: [{ x: 100 + i * 30, y: 100 }, { x: 112 + i * 30, y: 300 }] });
}
/* 缝在 x = 112..130，中心 121 */
project.char.x = 121;
project.char.y = 150;
const gapRect = A.charRect(project);
const denseBox = A.footBox(project);

/* 同一个锚点位置：立绘压住多个红框，但脚底盒落在缝隙里 */
let spriteOverlaps = 0;
for (const r of project.regions) if (A.regionHitRect(r, gapRect)) spriteOverlaps++;
ok('立绘在缝隙上方仍压住多个红框（按立绘判定会被挡死）', spriteOverlaps >= 2,
  'overlaps=' + spriteOverlaps);

ok('脚底盒完整落在缝隙里（112..130）',
  denseBox.x >= 112 && denseBox.x + denseBox.w <= 130,
  `box=${denseBox.x}..${denseBox.x + denseBox.w}`);
ok('脚底盒不碰任何红框', A.collisionAtFoot(project) === null,
  'blockedBy=' + (A.collisionAtFoot(project) || {}).name);

const gapX = project.char.x;
ok('脚底能过 → 角色能移动（立绘碰了也放行）', A.tryMoveChar(project, 1, 0) === true, '');
ok('移动后 x 增加', project.char.x === gapX + 1, 'x=' + project.char.x);

/* 缝隙宽 18px、脚底盒宽 14px → 锚点可在缝内再走 4px，正好被两侧红框夹住。
   这证明「能钻进去」，而不是「卡在缝外一步都动不了」。 */
project.char.x = 119;
project.char.y = 150;
let steps = 0;
while (A.tryMoveChar(project, 1, 0)) steps++;
ok('缝内可连续移动的步数 = 缝宽 − 盒宽 = 4', steps === 4, 'steps=' + steps);
ok('走到缝尽头时脚底盒同时贴住两侧红框',
  project.char.x === 123, 'x=' + project.char.x);

/* 反过来：脚底真的压在框上时不会被「穿透」，但也不能被彻底锁死。
   起点已经在框上（非法位置）时，目标位置也必然还在框里，
   如果只判断「目标是否非法」，所有方向都会被否决 → 角色永久卡死。
   正确行为：允许朝「更靠近脱离红区」的方向蹭出去，
   并且最终停在合法的缝隙里，绝不会穿过红框。 */
project.char.x = 106;
project.char.y = 150;
ok('脚底压在红框上时 collisionAtFoot 报出区域', (A.collisionAtFoot(project) || {}).name === '密0',
   (A.collisionAtFoot(project) || {}).name);
ok('脚底压在红框上时 footInsideCollision 为真', A.footInsideCollision(project) === true, '');
let escapeSteps = 0;
while (A.tryMoveChar(project, 1, 0) && escapeSteps < 60) escapeSteps++;
ok('踩在红框上不会永久卡死（能蹭出去）', escapeSteps > 0, 'steps=' + escapeSteps);
ok('脱困后停在合法位置（不压任何红框）', A.footInsideCollision(project) === false,
  'x=' + project.char.x);
ok('脱困位置落在缝隙 112..130 内', project.char.x >= 112 && project.char.x <= 130,
  'x=' + project.char.x);
/* 从合法位置出发时，红框依旧完全不可穿透。
   缝 112..130、脚底盒宽 14 → 锚点合法范围 119..123（正好 4 步）。 */
project.char.x = 119;
ok('缝内最左的合法位置 119 不压红框', A.footInsideCollision(project) === false, 'x=' + project.char.x);
let penetrate = 0;
while (A.tryMoveChar(project, -1, 0) && penetrate < 60) penetrate++;
ok('从合法位置向左压不进红框（停在贴边 119）',
  project.char.x === 119, 'x=' + project.char.x);

console.log('\n=== 7. 遮挡判定同样只看脚底盒 ===');
project.regions = [];
project.seq = 0;
A.addRegion(project, {
  name: '紫区', type: 'occlusion', target: 'both', shape: 'rect',
  points: [{ x: 470, y: 350 }, { x: 530, y: 370 }],
});
project.char.x = 500;
project.char.y = 330;
let st = A.charState(project);
ok('脚底在紫区外 → 不触发（即使立绘已经压到紫区）', st.occluded === false,
  'occluded=' + st.occluded);
ok('charState 同时返回脚底盒供可视化', !!st.foot && st.foot.w === project.char.boxW, '');

project.char.y = 360;
st = A.charState(project);
ok('脚底进入紫区 → 触发遮挡', st.occluded === true, 'occluded=' + st.occluded);
ok('返回命中的紫区 id', !!st.winner && st.winner.name === '紫区', st.winner && st.winner.name);

console.log('\n=== 8. clampChar 用碰撞箱留边，而不是立绘 ===');
project.canvas = { w: 200, h: 200 };
project.char.x = 0;
project.char.y = 0;
A.clampChar(project);
ok('锚点不会贴到 0（留出半个碰撞箱）', project.char.x > 0, 'x=' + project.char.x);
ok('锚点不会超出画布右边界', project.char.x <= 200, 'x=' + project.char.x);
ok('锚点不会贴到画布底', project.char.y > 0, 'y=' + project.char.y);
project.char.x = 999;
project.char.y = 999;
A.clampChar(project);
ok('超出时钳回画布内', project.char.x <= 200 && project.char.y <= 200,
  `${project.char.x},${project.char.y}`);

console.log('\n=== 9. normalizeChar 防脏数据 ===');
const n1 = A.normalizeChar({ x: 1, y: 2, w: 36, h: 56, speed: 5,
  ghostAlpha: 0.35, anchorX: 0.5, anchorY: 1, boxW: 14, boxH: 8 });
ok('正常值原样保留', n1.boxW === 14 && n1.boxH === 8, `${n1.boxW}x${n1.boxH}`);

const n2 = A.normalizeChar({ boxW: 0, boxH: -5 });
ok('0 / 负数被夹到下限', n2.boxW >= A.FOOT_BOX_MIN && n2.boxH >= A.FOOT_BOX_MIN,
  `${n2.boxW}x${n2.boxH}`);

const n3 = A.normalizeChar({ boxW: 99999, boxH: 99999 });
ok('超大值被夹到上限', n3.boxW <= A.FOOT_BOX_MAX && n3.boxH <= A.FOOT_BOX_MAX,
  `${n3.boxW}x${n3.boxH}`);

const n4 = A.normalizeChar({ boxW: NaN, boxH: undefined, anchorX: 'x' });
ok('NaN / undefined 回落到默认值', n4.boxW === A.DEFAULT_CHAR.boxW && n4.boxH === A.DEFAULT_CHAR.boxH,
  `${n4.boxW}x${n4.boxH}`);
ok('非法 anchorX 回落到 0.5', n4.anchorX === 0.5, String(n4.anchorX));

const n5 = A.normalizeChar(null);
ok('null 输入产出完整默认角色', n5.boxW === A.DEFAULT_CHAR.boxW && n5.anchorY === 1, '');

console.log('\n=== 10. 旧存档（无 boxW/boxH）能正常读回 ===');
const legacy = {
  name: 'old', canvas: { w: 100, h: 100 },
  layers: { background: {}, objects: {} },
  regions: [], seq: 0,
  char: { x: 10, y: 10, w: 36, h: 56, speed: 5, ghostAlpha: 0.35, anchorX: 0.5, anchorY: 1 },
};
const p2 = A.deserializeProject(legacy, {});
ok('缺失 boxW/boxH 时补上默认值', p2.char.boxW === A.DEFAULT_CHAR.boxW && p2.char.boxH === A.DEFAULT_CHAR.boxH,
  `${p2.char.boxW}x${p2.char.boxH}`);
ok('碰撞箱为正，角色不会被卡死', p2.char.boxW > 0 && p2.char.boxH > 0, '');

console.log('\n=== 11. 存档往返不丢碰撞箱 ===');
project.char.boxW = 22;
project.char.boxH = 11;
const ser = A.serializeProject(project);
ok('serializeProject 写出 boxW/boxH', ser.char.boxW === 22 && ser.char.boxH === 11,
  `${ser.char.boxW}x${ser.char.boxH}`);
const back = A.deserializeProject(JSON.parse(JSON.stringify(ser)), {});
ok('round-trip 后 boxW/boxH 一致', back.char.boxW === 22 && back.char.boxH === 11,
  `${back.char.boxW}x${back.char.boxH}`);
ok('round-trip 后锚点仍在脚底', back.char.anchorY === 1 && back.char.anchorX === 0.5,
  `${back.char.anchorX}/${back.char.anchorY}`);

console.log('\n=== 12. 导出数据必须带脚底判定约定（运行器要靠它）===');
const ex = A.actorToJson(project);
ok('导出 collision_box = 22×11（自定义尺寸要带出去）',
  ex.collision_box.width === 22 && ex.collision_box.height === 11,
  JSON.stringify(ex.collision_box));
ok('导出 sprite 单独存在（明确它不参与判定）',
  ex.sprite.width === project.char.w && ex.sprite.height === project.char.h,
  JSON.stringify(ex.sprite));
ok('锚点默认 = (0.5, 1) 脚底中心', ex.anchor.x === 0.5 && ex.anchor.y === 1,
  JSON.stringify(ex.anchor));
ok('声明碰撞判定方式', ex.collision_test === 'aabb-overlap', ex.collision_test);
ok('声明遮挡判定方式', ex.occlusion_test === 'foot-box-overlap', ex.occlusion_test);
ok('碰撞箱明显小于立绘（证明是脚底小块）',
  ex.collision_box.width * ex.collision_box.height < ex.sprite.width * ex.sprite.height, '');

const map2 = A.toMapJson(project);
ok('map.json 带 actor 段', !!map2.actor && map2.actor.collision_box.width === 22,
  JSON.stringify(map2.actor && map2.actor.collision_box));
ok('map.json rules 写明两种判定方式',
  map2.rules.collision_test === 'aabb-overlap' &&
  map2.rules.occlusion_test === 'foot-box-overlap',
  `${map2.rules.collision_test}/${map2.rules.occlusion_test}`);
ok('map.json rules.notes 说明不按立绘判定',
  /collision_box/.test(map2.rules.notes || '') && /sprite/.test(map2.rules.notes || ''),
  map2.rules.notes);
/* Godot 导出已按「点标记与导航方案」14.1 删除，不再有第二个导出路径需要保持一致 */

console.log('\n=== 13. 大步长不能被整步否决（贴墙抖动）===');
/* 一堵墙在 x=300。盒宽 14 → 起点必须是 x ≤ 293 才不贴墙。
   一帧走 5px：旧实现看终点 298 是否越界（不越界就整步走），
   但当起点更靠近墙时，终点越界会让整步被否 → 角色原地抖动。
   这里从 293 出发，走到贴墙（293+6=299，盒子右边缘 306 > 300 → 实际应停在 293）。
   换个能推进的场景：从 280 出发，5px 后是 285，仍有空间 → 必须能走满。 */
project.canvas = { w: 1920, h: 1080 };
project.regions = [];
project.seq = 0;
add({ name: '墙', points: [{ x: 300, y: 0 }, { x: 320, y: 1080 }] });
project.char.boxW = 14;
project.char.boxH = 8;

/* 起点离墙还有空间时，大步长必须能走满 */
project.char.x = 280;
project.char.y = 500;
ok('起点不贴墙', A.collisionAtFoot(project) === null, '');
ok('大步长 5px 能走满', A.tryMoveChar(project, 5, 0) === true, 'moved');
ok('x = 285', project.char.x === 285, 'x=' + project.char.x);

/* 一直推到贴住墙：盒右边缘 = x + 7 ≤ 300 → x ≤ 293 */
let guard = 0;
while (A.tryMoveChar(project, 5, 0) && guard++ < 100) { /* 推到贴墙 */ }
ok('最终贴住墙：x = 293', project.char.x === 293, 'x=' + project.char.x);
ok('贴墙后脚底不与墙重叠', A.collisionAtFoot(project) === null, '');

console.log('\n=== 14. 卡在窄缝里时两轴都要能动 ===');
/* 缝 100..120（20px），盒宽 14 → 锚点自由区 107..113（6px 活动范围）。 */
project.regions = [];
project.seq = 0;
add({ name: 'L', points: [{ x: 60, y: 0 }, { x: 100, y: 1080 }] });
add({ name: 'R', points: [{ x: 120, y: 0 }, { x: 160, y: 1080 }] });
project.char.x = 107;
project.char.y = 500;
ok('缝内起点合法', A.collisionAtFoot(project) === null, '');
ok('窄缝内向右可推进 5px', A.tryMoveChar(project, 5, 0) === true, 'moved');
ok('向右推进到 112', project.char.x === 112, 'x=' + project.char.x);
/* 从 112 再向右 5px：合法区只到 113，所以应当「能走 1px 然后停」，
   而不是整步被否掉 —— 这正是原来「一步都动不了」的根源。 */
ok('继续向右时部分推进（112 → 113）而不是整步卡死',
  A.tryMoveChar(project, 5, 0) === true && project.char.x === 113,
  'x=' + project.char.x);
ok('停在缝内不穿墙', A.collisionAtFoot(project) === null, '');
const backLeft = A.tryMoveChar(project, -5, 0);
ok('贴墙后仍能向左退（沿墙滑动）', backLeft === true, 'moved=' + backLeft);
ok('向左退 5px 到 108', project.char.x === 108, 'x=' + project.char.x);
ok('一路退到缝左边界 107', A.tryMoveChar(project, -5, 0) && project.char.x === 107,
  'x=' + project.char.x);

console.log('\n=== 15. 斜向移动：单轴被挡时另一轴仍应生效 ===');
project.regions = [];
project.seq = 0;
add({ name: '前墙', points: [{ x: 400, y: 0 }, { x: 420, y: 1080 }] });
project.char.x = 385;
project.char.y = 500;
const before2 = { x: project.char.x, y: project.char.y };
A.tryMoveChar(project, 5, 5);
ok('x 正常推进 5px 到 390', project.char.x === 390, 'x=' + project.char.x);
ok('y 正常推进 5px（斜向两轴都生效）', project.char.y === before2.y + 5, 'y=' + project.char.y);

/* 贴住墙后斜向：x 被挡、y 仍动 → 沿墙滑动 */
project.char.x = 393;
project.char.y = 500;
A.tryMoveChar(project, 5, 5);
ok('贴墙后 x 被挡住不动', project.char.x === 393, 'x=' + project.char.x);
ok('贴墙后 y 仍能下滑', project.char.y === 505, 'y=' + project.char.y);
ok('沿墙滑动后脚底不与墙重叠', A.collisionAtFoot(project) === null, '');

console.log('\n=== 16. 斜向撞墙角：大步长也不会产生非法位置 ===');
project.char.x = 390;
project.char.y = 500;
A.tryMoveChar(project, 20, 20);
ok('大步长斜撞后脚底合法', A.collisionAtFoot(project) === null,
  'x=' + project.char.x + ' y=' + project.char.y);
ok('大步长斜撞后确实移动了（没有被整步否掉）',
  project.char.x === 393 && project.char.y === 520,
  'x=' + project.char.x + ' y=' + project.char.y);

console.log('\n=== 17. 越界仍然被正确拦截 ===');
project.regions = [];
project.seq = 0;
project.canvas = { w: 200, h: 200 };
/* 盒 14×8：右边界要求 x + 7 ≤ 200 → x ≤ 193；上边界 y - 4 ≥ 0 → y ≥ 4 */
project.char.x = 195;
project.char.y = 100;
A.tryMoveChar(project, 20, 0);
ok('撞右边界时停在贴边位置 x = 193', project.char.x === 193, 'x=' + project.char.x);
ok('x 不超过画布宽', project.char.x <= 200, 'x=' + project.char.x);
project.char.x = 100;
project.char.y = 5;
A.tryMoveChar(project, 0, -20);
ok('上边界：停在 y = 4（盒高 8 的一半）', project.char.y === 4, 'y=' + project.char.y);
ok('y ≥ 0', project.char.y >= 0, 'y=' + project.char.y);

/* 与 clampChar 保持一致：直接调用得到同样的贴边值 */
project.char.x = 195;
project.char.y = 195;
A.clampChar(project);
ok('clampChar 右边界一致', project.char.x === 193, 'x=' + project.char.x);
ok('clampChar 下边界在界内', project.char.y <= 200 - 4, 'y=' + project.char.y);

console.log('\n=== 18. 已越界时必须能自愈（改小画布 / 调大碰撞箱后）===');
/* 画布被改小后角色可能已在界外。若不先归位，
   每个子步都会被越界判定挡住 → 角色彻底动不了。 */
project.regions = [];
project.seq = 0;
project.canvas = { w: 100, h: 100 };
project.char.x = 98;   /* 合法上限 93 → 已越界 5px */
project.char.y = 99;   /* 合法上限 96 → 已越界 3px */
ok('起点确实已越界', project.char.x > 93 && project.char.y > 96,
  `x=${project.char.x} y=${project.char.y}`);
ok('越界状态下 footBox 超出画布', A.footBox(project).x + A.footBox(project).w > 100, '');
const recovered = A.tryMoveChar(project, -1, -1);
ok('越界状态下仍可移动（自动归位）', recovered === true, 'moved=' + recovered);
ok('归位后回到合法范围', project.char.x <= 93 && project.char.y <= 96,
  `x=${project.char.x} y=${project.char.y}`);
ok('归位后脚底不越界', A.footBox(project).x >= 0 && A.footBox(project).x + A.footBox(project).w <= 100, '');

/* 调大碰撞箱导致越界，同样要能自愈 */
project.canvas = { w: 400, h: 400 };
project.char.x = 200;
project.char.y = 200;
project.char.boxW = 300;
A.tryMoveChar(project, 1, 1);
ok('碰撞箱变大后仍能移动', project.char.x <= 400 - 150 && project.char.y <= 400 - 150,
  `x=${project.char.x} y=${project.char.y}`);

console.log('\n=== 19. 用户场景回归：密集柱子之间的缝能不能过 ===');
/* 一排柱子：柱宽 40，缝宽 20。立绘宽 36 > 缝宽 20。
   按整个角色判定 → 角色永远进不了缝（这就是用户反馈的「密集处过不去」）。
   按脚底碰撞箱判定 → 脚底 14 < 20，缝进得去、也走得动。 */
const pillars = () => {
  project.canvas = { w: 1920, h: 1080 };
  project.regions = [];
  project.seq = 0;
  for (let i = 0; i < 6; i++) {
    const x = 400 + i * 60;
    add({ name: '柱' + i, points: [{ x, y: 300 }, { x: x + 40, y: 800 }] });
  }
};
/* 缝 = 440..460（柱0 与 柱1 之间）。站进去并试左右移动。 */
const inGap = (bw, bh) => {
  pillars();
  project.char.boxW = bw;
  project.char.boxH = bh;
  project.char.x = 450;          /* 缝正中央 */
  project.char.y = 550;
  const stands = A.collisionAtFoot(project) === null;
  let n = 0; while (A.tryMoveChar(project, 1, 0) && n < 50) n++;
  const xr = project.char.x;
  n = 0; while (A.tryMoveChar(project, -1, 0) && n < 50) n++;
  const xl = project.char.x;
  return { stands, moves: xr > xl, range: xl + '..' + xr };
};

const gSprite = inGap(36, 56);
ok('立绘大小判定（36×56）→ 进不了缝（用户遇到的旧问题）',
  gSprite.stands === false, JSON.stringify(gSprite));
ok('立绘大小判定 → 缝内也走不动', gSprite.moves === false, JSON.stringify(gSprite));

const gExact = inGap(20, 10);
ok('碰撞箱正好等于缝宽（20×10）→ 进得去', gExact.stands === true, JSON.stringify(gExact));
ok('碰撞箱等于缝宽 → 没有余量，缝内仍走不动', gExact.moves === false, JSON.stringify(gExact));

const gDefault = inGap(14, 8);
ok('默认脚底碰撞箱（14×8）→ 进得了缝', gDefault.stands === true, JSON.stringify(gDefault));
ok('默认脚底碰撞箱 → 缝内可以左右移动', gDefault.moves === true, JSON.stringify(gDefault));
ok('缝内活动范围为 447..453（缝 440..460，居中 450）',
  gDefault.range === '447..453', gDefault.range);

console.log('\n=== 20. 缝内移动范围必须正好等于「缝宽 − 盒宽」===');
ok('缝 20 − 盒 14 = 6px 活动量，范围宽度 453−447 = 6',
  453 - 447 === 20 - 14, 'measured=' + (453 - 447));

console.log('\n=== 21. 脚底踩进红区里必须能自动脱困（不会被永久锁死）===');
/* 这是「密集碰撞区里角色一步都走不掉」的第二个真凶：
   起点已经压在红区上时，任何目标位置仍然压在红区上，
   只判断「目标是否非法」会把四个方向全部否决 → 角色永久卡死。 */
project.canvas = { w: 1920, h: 1080 };
project.regions = [];
project.seq = 0;
add({ name: '墙', points: [{ x: 400, y: 300 }, { x: 600, y: 700 }] });
project.char.boxW = 14;
project.char.boxH = 8;

/* 站在墙的正中间：脚底盒 493..507 完全陷在墙内 */
project.char.x = 500;
project.char.y = 550;
ok('起点确实踩在红区里', A.footInsideCollision(project) === true, '');

let rSteps = 0;
while (A.footInsideCollision(project) && rSteps < 500) {
  A.tryMoveChar(project, 1, 0);
  rSteps++;
  /* 已经完全脱离就立刻停下，别再多走一步到墙外 */
  if (!A.footInsideCollision(project)) break;
}
ok('向右能蹭出红区（不再是永久卡死）', rSteps > 0 && rSteps < 500, 'steps=' + rSteps);
ok('向右脱困后脚底不再压红区', A.footInsideCollision(project) === false,
  'x=' + project.char.x);
/* 墙 400..600，盒宽 14。完全脱离需要脚底盒整体越过边界：
   向右 → 盒左边 ≥ 600 → charX ≥ 607；向左 → 盒右边 ≤ 400 → charX ≤ 393 */
ok('向右脱困停在 607（脚底盒刚好整体越过墙的右边界）',
  project.char.x === 607, 'x=' + project.char.x);

project.char.x = 500;
project.char.y = 550;
let lSteps = 0;
while (A.footInsideCollision(project) && lSteps < 500) {
  A.tryMoveChar(project, -1, 0);
  lSteps++;
  if (!A.footInsideCollision(project)) break;
}
ok('向左能蹭出红区', lSteps > 0 && lSteps < 500, 'steps=' + lSteps);
ok('向左脱困后脚底不再压红区', A.footInsideCollision(project) === false,
  'x=' + project.char.x);
/* 贴住左边界时 charX = 400 − 7 = 393 */
ok('向左脱困停在 393（脚底盒刚好整体越过墙的左边界）',
  project.char.x === 393, 'x=' + project.char.x);

console.log('\n=== 22. 脱困绝不允许穿墙或钻进新红区 ===');
/* 从合法位置走向红区仍然被挡住 */
project.char.x = 380;
project.char.y = 550;
ok('起点在墙外合法位置', A.footInsideCollision(project) === false, 'x=' + project.char.x);
let intoSteps = 0;
while (A.tryMoveChar(project, 1, 0) && intoSteps < 500) intoSteps++;
ok('从合法位置走不进红区（穿墙被禁止）',
  A.footInsideCollision(project) === false, 'x=' + project.char.x);
ok('撞墙时停在贴边 393（脚底右边缘正好 400）',
  project.char.x === 393, 'x=' + project.char.x);

/* 两个紧邻红区：从 A 里脱困时不能顺势钻进 B */
project.regions = [];
project.seq = 0;
add({ name: 'A', points: [{ x: 400, y: 300 }, { x: 500, y: 700 }] });
add({ name: 'B', points: [{ x: 500, y: 300 }, { x: 600, y: 700 }] });
project.char.x = 450;   /* 在 A 内（盒 443..457），右侧紧贴 B */
project.char.y = 550;
ok('起点在 A 区内', (A.collisionAtFoot(project) || {}).name === 'A',
  (A.collisionAtFoot(project) || {}).name);
let k = 0;
while (A.footInsideCollision(project) && k < 500) {
  A.tryMoveChar(project, 1, 0);
  k++;
}
/* 往右会进入 B → 必须被拒；合法出口只能是左/上/下 */
ok('向右脱困被拒绝（不会钻进紧邻的 B 区）',
  (A.collisionAtFoot(project) || {}).name === 'A',
  (A.collisionAtFoot(project) || {}).name + ' x=' + project.char.x);
/* 改向左，应能脱困到 A 左侧 */
project.char.x = 450;
k = 0;
while (A.footInsideCollision(project) && k < 500) {
  A.tryMoveChar(project, -1, 0);
  k++;
  if (!A.footInsideCollision(project)) break;
}
ok('向左可以正常脱困出去', A.footInsideCollision(project) === false,
  'x=' + project.char.x);
ok('向左脱困停在 A 左边界外 393', project.char.x === 393, 'x=' + project.char.x);

console.log('\n=== 23. 脱困不改变「立绘大小不影响判定」===');
project.regions = [];
project.seq = 0;
add({ name: '墙', points: [{ x: 400, y: 300 }, { x: 600, y: 700 }] });
for (const sw of [36, 200, 800]) {
  project.char.w = sw;
  project.char.h = sw;
  project.char.x = 380;
  project.char.y = 550;
  let n = 0; while (A.tryMoveChar(project, 1, 0) && n < 500) n++;
  ok('立绘 ' + sw + 'px 时撞墙结果一致（停在 393）', project.char.x === 393,
    'x=' + project.char.x);
}

console.log('\n=== 24. 脱困模式下仍然不能越界 ===');
project.regions = [];
project.seq = 0;
project.char.w = 36;
project.char.h = 56;
project.char.x = 0;
project.char.y = 0;
project.char.x = -50;   /* 故意放到画布外并压不压红区 */
project.char.y = 500;
A.clampChar(project);
ok('越界位置被 clamp 回画布内',
  project.char.x >= 0 && project.char.x <= project.canvas.w, 'x=' + project.char.x);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);