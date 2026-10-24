/* 专测「保存工程」不丢数据：
   1. 序列化 → 反序列化往返一致（角色锚点、碰撞箱、标记锚点、巡逻路线、图层配置）
   2. 旧的“手抄字段清单”写法会丢图层配置 —— 现在统一走 serializeProject
   用法：node test_project_save.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); }
};

console.log('\n=== A. 角色锚点 / 碰撞箱往返不丢 ===');
const p = A.createProject();
p.char.x = 321;
p.char.y = 654;
p.char.anchorX = 0.25;
p.char.anchorY = 0.8;
p.char.boxW = 22;
p.char.boxH = 11;
p.char.ghostAlpha = 0.6;
p.char.speed = 7;

const ser = A.serializeProject(p, false);
ok('锚点比例被写入', ser.char.anchorX === 0.25 && ser.char.anchorY === 0.8,
  `${ser.char.anchorX}/${ser.char.anchorY}`);
ok('碰撞箱尺寸被写入', ser.char.boxW === 22 && ser.char.boxH === 11,
  `${ser.char.boxW}x${ser.char.boxH}`);
ok('角色位置被写入', ser.char.x === 321 && ser.char.y === 654, `${ser.char.x},${ser.char.y}`);

const back = A.deserializeProject(JSON.parse(JSON.stringify(ser)), {});
ok('往返后锚点比例一致', back.char.anchorX === 0.25 && back.char.anchorY === 0.8,
  `${back.char.anchorX}/${back.char.anchorY}`);
ok('往返后碰撞箱一致', back.char.boxW === 22 && back.char.boxH === 11,
  `${back.char.boxW}x${back.char.boxH}`);
ok('往返后角色位置一致', back.char.x === 321 && back.char.y === 654, `${back.char.x},${back.char.y}`);
ok('往返后透明度一致', Math.abs(back.char.ghostAlpha - 0.6) < 1e-9, String(back.char.ghostAlpha));
ok('往返后速度一致', back.char.speed === 7, String(back.char.speed));

console.log('\n=== B. 图层配置（显示 / 锁定 / 透明度）往返不丢 ===');
/* 这一条是真实踩过的坑：保存工程时手抄字段清单，图层配置整段漏掉，
   打开工程时又被硬写成默认值 —— 等于图层设置永远存不下来。 */
p.layers.background.opacity = 0.42;
p.layers.background.visible = false;
p.layers.background.locked = true;
p.layers.objects.opacity = 0.7;

const ser2 = A.serializeProject(p, false);
ok('白层透明度被写入', ser2.layers.background.opacity === 0.42, String(ser2.layers.background.opacity));
ok('白层显示状态被写入', ser2.layers.background.visible === false, String(ser2.layers.background.visible));
ok('白层锁定状态被写入', ser2.layers.background.locked === true, String(ser2.layers.background.locked));
ok('黑层透明度被写入', ser2.layers.objects.opacity === 0.7, String(ser2.layers.objects.opacity));

const back2 = A.deserializeProject(JSON.parse(JSON.stringify(ser2)), {});
ok('往返后白层透明度一致', back2.layers.background.opacity === 0.42, String(back2.layers.background.opacity));
ok('往返后白层显示状态一致', back2.layers.background.visible === false, String(back2.layers.background.visible));
ok('往返后白层锁定状态一致', back2.layers.background.locked === true, String(back2.layers.background.locked));
ok('往返后黑层透明度一致', back2.layers.objects.opacity === 0.7, String(back2.layers.objects.opacity));

console.log('\n=== C. 标记锚点 / 朝向 / 标签 / 巡逻路线往返不丢 ===');
const m = A.addMark(p, 'teleport', 300, 400);
A.setMarkFacing(p, m.id, 'up');
A.setMarkTags(p, m.id, { target_scene: 'town', cost: '0' });
p.marks[0].patrol = { loop: false, points: [{ x: 100, y: 100 }, { x: 200, y: 220 }] };

const ser3 = A.serializeProject(p, false);
ok('标记被写入', ser3.marks.length === 1, 'len=' + ser3.marks.length);
ok('标记锚点坐标被写入', ser3.marks[0].x === 300 && ser3.marks[0].y === 400,
  `${ser3.marks[0].x},${ser3.marks[0].y}`);
ok('标记朝向被写入', ser3.marks[0].facing === 'up', ser3.marks[0].facing);
ok('标记标签被写入', ser3.marks[0].tags.target_scene === 'town',
  JSON.stringify(ser3.marks[0].tags));
ok('巡逻路线被写入', ser3.marks[0].patrol && ser3.marks[0].patrol.points.length === 2,
  JSON.stringify(ser3.marks[0].patrol));
ok('巡逻走法（闭环/往返）被写入', ser3.marks[0].patrol.loop === false,
  String(ser3.marks[0].patrol.loop));

const back3 = A.deserializeProject(JSON.parse(JSON.stringify(ser3)), {});
ok('往返后标记数量一致', back3.marks.length === 1, 'len=' + back3.marks.length);
ok('往返后标记锚点一致', back3.marks[0].x === 300 && back3.marks[0].y === 400,
  `${back3.marks[0].x},${back3.marks[0].y}`);
ok('往返后标记朝向一致', back3.marks[0].facing === 'up', back3.marks[0].facing);
ok('往返后标记标签一致', back3.marks[0].tags.target_scene === 'town',
  JSON.stringify(back3.marks[0].tags));
ok('往返后巡逻路线一致', back3.marks[0].patrol && back3.marks[0].patrol.points.length === 2,
  JSON.stringify(back3.marks[0].patrol));
ok('往返后巡逻走法一致', back3.marks[0].patrol.loop === false,
  String(back3.marks[0].patrol.loop));

console.log('\n=== D. 区域的淡化参数往返不丢 ===');
A.addRegion(p, {
  name: '淡化区', type: 'fade', target: 'foreground', shape: 'rect',
  points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
});
p.regions[p.regions.length - 1].fadeAlpha = 0.25;
p.regions[p.regions.length - 1].fadePad = 7;
const ser4 = A.serializeProject(p, false);
ok('淡化不透明度被写入', ser4.regions[0].fadeAlpha === 0.25, String(ser4.regions[0].fadeAlpha));
ok('触发边距被写入', ser4.regions[0].fadePad === 7, String(ser4.regions[0].fadePad));
const back4 = A.deserializeProject(JSON.parse(JSON.stringify(ser4)), {});
ok('往返后淡化不透明度一致', back4.regions[0].fadeAlpha === 0.25, String(back4.regions[0].fadeAlpha));
ok('往返后触发边距一致', back4.regions[0].fadePad === 7, String(back4.regions[0].fadePad));

console.log('\n=== E. 自动存档不含图片 / 工程文件带图片 ===');
p.layers.background.img = { src: 'data:image/png;base64,AAAA' };
const noImg = A.serializeProject(p, false);
ok('自动存档不带图片', noImg.layers.background.src === null, String(noImg.layers.background.src));
const withImg = A.serializeProject(p, true);
ok('工程文件带图片', typeof withImg.layers.background.src === 'string' &&
  withImg.layers.background.src.indexOf('data:image/png') === 0, String(withImg.layers.background.src));

console.log('\n=== F. 旧工程（没有这些字段）照样能打开 ===');
const legacy = {
  name: 'old', canvas: { w: 800, h: 600 },
  layers: {
    background: { src: null, w: 0, h: 0 },
    objects: { src: null, w: 0, h: 0 },
  },
  regions: [], seq: 0,
  char: { x: 10, y: 20, w: 36, h: 56, speed: 5, ghostAlpha: 0.35 },
};
let p6 = null, threw = false;
try { p6 = A.deserializeProject(legacy, {}); } catch (e) { threw = true; console.log('    抛错原文: ' + e.message); }
ok('旧工程读取不报错', !threw, 'threw');
ok('旧工程补出前景层', !!p6 && !!p6.layers.foreground, 'no foreground');
ok('旧工程图层默认可见', p6 && p6.layers.background.visible === true, String(p6 && p6.layers.background.visible));
ok('旧工程补出默认碰撞箱', p6 && p6.char.boxW === A.DEFAULT_CHAR.boxW, String(p6 && p6.char.boxW));
ok('旧工程补出默认锚点', p6 && p6.char.anchorX === 0.5 && p6.char.anchorY === 1,
  `${p6 && p6.char.anchorX}/${p6 && p6.char.anchorY}`);
ok('旧工程补出空标记列表', p6 && Array.isArray(p6.marks) && p6.marks.length === 0, 'marks');

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
