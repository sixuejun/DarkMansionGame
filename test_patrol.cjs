/* 专测巡逻路线：路径点增删改、走向计算、路线展开、导出往返。
   用法：node test_patrol.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
                          else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); } };

console.log('\n=== A. 路径点增删改 ===');
const p = A.createProject();
p.canvas = { w: 800, h: 600 };

const m = A.addMark(p, 'monster', 100, 100);
ok('新标记没有巡逻路线', A.hasPatrol(m) === false, 'should be false');

A.setPatrolRoute(p, m.id, A.createPatrolRoute());
ok('设了路线后有巡逻', A.hasPatrol(m) === true, 'should be true');
ok('新路线没有路径点', m.patrol.points.length === 0, 'len=' + m.patrol.points.length);

A.addPatrolPoint(p, m.id, 200, 200);
A.addPatrolPoint(p, m.id, 300, 150);
ok('加了两个路径点', m.patrol.points.length === 2, 'len=' + m.patrol.points.length);
ok('路径点坐标正确', m.patrol.points[0].x === 200 && m.patrol.points[0].y === 200,
  JSON.stringify(m.patrol.points[0]));
ok('路径点是整数', Number.isInteger(m.patrol.points[1].x), JSON.stringify(m.patrol.points[1]));

ok('移动路径点', A.movePatrolPoint(p, m.id, 0, 250, 260) === true, 'failed');
ok('路径点位置已改', m.patrol.points[0].x === 250 && m.patrol.points[0].y === 260,
  JSON.stringify(m.patrol.points[0]));
ok('移动不存在的下标返回 false', A.movePatrolPoint(p, m.id, 99, 1, 1) === false, 'should be false');

A.setPatrolLoop(p, m.id, false);
ok('走法改成往返', m.patrol.loop === false, 'loop=' + m.patrol.loop);
A.setPatrolLoop(p, m.id, true);
ok('走法改成闭环', m.patrol.loop === true, 'loop=' + m.patrol.loop);

A.removePatrolPoint(p, m.id, 0);
ok('删掉一个路径点', m.patrol.points.length === 1, 'len=' + m.patrol.points.length);
ok('只剩一个点时路线仍保留（作者可能在编辑中途）', m.patrol !== undefined, JSON.stringify(m.patrol));

console.log('\n=== B. 朝向自动计算 ===');
ok('向右走 → 朝右', A.patrolFacing({ x: 0, y: 0 }, { x: 100, y: 0 }) === 'right', 'wrong');
ok('向左走 → 朝左', A.patrolFacing({ x: 100, y: 0 }, { x: 0, y: 0 }) === 'left', 'wrong');
ok('向下走 → 朝下', A.patrolFacing({ x: 0, y: 0 }, { x: 0, y: 100 }) === 'down', 'wrong');
ok('向上走 → 朝上', A.patrolFacing({ x: 0, y: 100 }, { x: 0, y: 0 }) === 'up', 'wrong');
ok('斜向以水平为准', A.patrolFacing({ x: 0, y: 0 }, { x: 100, y: 50 }) === 'right', 'wrong');
ok('原地不动 → 朝下', A.patrolFacing({ x: 0, y: 0 }, { x: 0, y: 0 }) === 'down', 'wrong');

const facings = A.patrolFacings({ x: 0, y: 0 }, [{ x: 100, y: 0 }, { x: 100, y: 100 }]);
ok('每个点都有朝向', facings.length === 2, 'len=' + facings.length);
ok('第一个点按「从标记本体走向它」算', facings[0] === 'right', JSON.stringify(facings));
ok('第二个点按上一站推', facings[1] === 'down', JSON.stringify(facings));

console.log('\n=== C. 路线展开：绕墙寻路 ===');
const p2 = A.createProject();
p2.canvas = { w: 800, h: 600 };
/* 一道墙，只在下方留一道门 */
p2.regions.push({
  id: 'wall', name: '墙', type: 'collision', target: 'background',
  priority: 0, shape: 'rect', points: [{ x: 300, y: 0 }, { x: 340, y: 450 }], seq: 0,
});
A.invalidateNavCache();
const m2 = A.addMark(p2, 'monster', 100, 300);
A.setPatrolRoute(p2, m2.id, A.createPatrolRoute(true));
A.addPatrolPoint(p2, m2.id, 100, 300);
A.addPatrolPoint(p2, m2.id, 500, 300);

const plan = A.planPatrol(p2, m2.patrol.points, true);
ok('闭环时有两段（两点来回）', plan.legs.length === 2, 'legs=' + plan.legs.length);
ok('整条路线走得通', plan.ok === true, JSON.stringify(plan.brokenCount));
ok('没有断段', plan.brokenCount === 0, 'broken=' + plan.brokenCount);
/* 中间那段必须绕开门（墙底在 y=450，所以路径要走到 450 以下），不能直线穿过墙 */
const midLeg = plan.legs[0];
ok('中间段绕开了墙', midLeg.path.some(pt => pt.y > 450),
  JSON.stringify(midLeg.path.map(p => Math.round(p.y))));
ok('中间段通过子步验证', midLeg.verified === true, 'not verified');

/* 封死后走不通 */
p2.regions[0].points = [{ x: 300, y: 0 }, { x: 340, y: 600 }];
A.invalidateNavCache();
const plan2 = A.planPatrol(p2, m2.patrol.points, true);
ok('封死后走不通', plan2.ok === false, 'should be false');
ok('两段全断', plan2.brokenCount === 2, 'broken=' + plan2.brokenCount);

console.log('\n=== D. 导出 / 导入往返 ===');
const p3 = A.createProject();
p3.canvas = { w: 800, h: 600 };
const m3 = A.addMark(p3, 'monster', 50, 60);
A.setPatrolRoute(p3, m3.id, { points: [{ x: 100, y: 200 }, { x: 300, y: 400 }], loop: false });

const json = A.toMapJson(p3);
const ent = json.entities[0];
ok('entity 里有 patrol 段', !!ent.patrol, JSON.stringify(ent));
ok('patrol 带路径点', ent.patrol.points.length === 2, JSON.stringify(ent.patrol));
ok('patrol 带走法', ent.patrol.loop === false, 'loop=' + ent.patrol.loop);
ok('路径点坐标正确', ent.patrol.points[1].x === 300 && ent.patrol.points[1].y === 400,
  JSON.stringify(ent.patrol.points[1]));

const back = A.marksFromMapJson(json);
ok('导入后巡逻路线还在', !!back[0].patrol, JSON.stringify(back[0]));
ok('导入后路径点一致', back[0].patrol.points.length === 2
  && back[0].patrol.points[0].x === 100
  && back[0].patrol.points[1].y === 400, JSON.stringify(back[0].patrol));
ok('导入后走法一致', back[0].patrol.loop === false, 'loop=' + back[0].patrol.loop);

/* 没有 patrol 的标记不该导出 patrol 段 */
const p4 = A.createProject();
const m4 = A.addMark(p4, 'chest', 10, 10);
const json4 = A.toMapJson(p4);
ok('没路线的标记不导出 patrol 段', json4.entities[0].patrol === undefined,
  JSON.stringify(json4.entities[0]));

/* 路径点不足两个的路线不导出 */
A.setPatrolRoute(p4, m4.id, { points: [{ x: 1, y: 1 }], loop: true });
ok('只有一个路径点时不导出 patrol 段', A.toMapJson(p4).entities[0].patrol === undefined,
  JSON.stringify(A.toMapJson(p4).entities[0]));

console.log('\n=== E. 存档往返 ===');
const ser = A.serializeProject(p3, false);
ok('存档里有 patrol', !!ser.marks[0].patrol, JSON.stringify(ser.marks[0]));
ok('存档里路径点正确', ser.marks[0].patrol.points.length === 2, JSON.stringify(ser.marks[0].patrol));
const des = A.deserializeProject(ser, {});
ok('读回后巡逻路线还在', !!des.marks[0].patrol, JSON.stringify(des.marks[0]));
ok('读回后路径点正确', des.marks[0].patrol.points[1].y === 400, JSON.stringify(des.marks[0].patrol));

/* 旧存档没有 patrol 字段 */
const oldStored = JSON.parse(JSON.stringify(ser));
delete oldStored.marks[0].patrol;
const des2 = A.deserializeProject(oldStored, {});
ok('旧存档没 patrol 字段不报错', des2.marks.length === 1, 'len=' + des2.marks.length);
ok('旧存档的标记没有巡逻路线', des2.marks[0].patrol === undefined, JSON.stringify(des2.marks[0]));

console.log('\n=== F. 撤销 / 重做 ===');
const hp = A.createProject();
const history = new A.History({
  getSnapshot: () => ({ regions: hp.regions, marks: hp.marks, seq: hp.seq }),
  applySnapshot: (snap) => {
    hp.regions = snap.regions;
    hp.marks = snap.marks || [];
    hp.seq = snap.seq;
  },
});
const hm = A.addMark(hp, 'monster', 100, 100);
history.reset('初始', history.snapshot());

let tx = history.beginOp();
A.setPatrolRoute(hp, hm.id, A.createPatrolRoute());
A.addPatrolPoint(hp, hm.id, 200, 200);
A.addPatrolPoint(hp, hm.id, 300, 300);
history.commitOp(tx, '新建路线');
ok('路线已建', hp.marks[0].patrol && hp.marks[0].patrol.points.length === 2, 'no patrol');

tx = history.beginOp();
A.removePatrolPoint(hp, hm.id, 0);
history.commitOp(tx, '删除路径点');
ok('删掉一个点', hp.marks[0].patrol.points.length === 1, 'len=' + hp.marks[0].patrol.points.length);
history.undo();
ok('撤销后路径点回来了', hp.marks[0].patrol.points.length === 2, 'len=' + hp.marks[0].patrol.points.length);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
