/* 专测导航：栅格化、连通性、A*、标记状态徽标。
   用法：node test_nav.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
                          else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); } };

/**
 * 造一个只有一块红区（矩形）的工程。
 *
 * ⚠ rect 形状只存**两个对角点**（points[0] / points[1]），
 *   写四个点的话 rectOfRegion 只会取前两个，等于墙高度为 0。
 */
function projWithWall(wall) {
  const p = A.createProject();
  p.canvas = { w: 400, h: 300 };
  if (wall) {
    p.regions.push({
      id: 'wall1', name: '墙', type: 'collision', target: 'background',
      priority: 0, shape: 'rect', points: wall, seq: 0,
    });
  }
  A.invalidateNavCache();
  return p;
}

/** 加一道矩形墙（对角两点） */
function addWall(p, id, x0, y0, x1, y1, seq) {
  p.regions.push({
    id, name: '墙', type: 'collision', target: 'background',
    priority: 0, shape: 'rect', points: [{ x: x0, y: y0 }, { x: x1, y: y1 }], seq,
  });
}

/* 一道竖墙，从 y=0 到 y=200，中间留一条 100px 宽的门（y=200~300 通） */
const wallUpper = [{ x: 180, y: 0 }, { x: 220, y: 200 }];

console.log('\n=== A. canStandAt：站在红区里 vs 站在旁边 ===');
{
  const p = projWithWall(wallUpper);
  ok('红区正中间站不住', A.canStandAt(p, 200, 100) === false, 'should be blocked');
  ok('红区旁边站得住', A.canStandAt(p, 100, 100) === true, 'should be standable');
  ok('红区右边站得住', A.canStandAt(p, 300, 100) === true, 'should be standable');
  ok('门洞处站得住', A.canStandAt(p, 200, 250) === true, 'should be standable');
  ok('画布外站不住', A.canStandAt(p, -10, 100) === false, 'should be blocked');
  ok('画布外（右边）站不住', A.canStandAt(p, 500, 100) === false, 'should be blocked');
}

console.log('\n=== B. 栅格化：红区内的格子不可通行 ===');
{
  const p = projWithWall(wallUpper);
  const g = A.navGrid(p);
  ok('格子边长足够细（能认出窄道）', g.cell <= 4, 'cell=' + g.cell);
  const cx = Math.floor(200 / g.cell);
  const cy = Math.floor(100 / g.cell);
  const i = cy * g.cols + cx;
  ok('红区上的格子不可通行', g.passable[i] === 0, 'passable=' + g.passable[i]);
  const cx2 = Math.floor(100 / g.cell);
  const i2 = cy * g.cols + cx2;
  ok('空地上的格子可通行', g.passable[i2] === 1, 'passable=' + g.passable[i2]);
  const cyDoor = Math.floor(250 / g.cell);
  const iDoor = cyDoor * g.cols + cx;
  ok('门洞处的格子可通行', g.passable[iDoor] === 1, 'passable=' + g.passable[iDoor]);
}

console.log('\n=== C. 缓存：签名不变时复用，改红区后重建 ===');
{
  const p = projWithWall(wallUpper);
  const g1 = A.navGrid(p);
  const g2 = A.navGrid(p);
  ok('签名不变时复用同一个栅格对象', g1 === g2, 'different object');
  /* 改红区几何 → 签名变了 → 必须重建 */
  p.regions[0].points[1].x = 221;
  const g3 = A.navGrid(p);
  ok('红区变了会重建栅格', g3 !== g1, 'should rebuild');
}

console.log('\n=== D. 碰撞签名必须包含角色脚底盒尺寸 ===');
{
  const p = projWithWall(wallUpper);
  const s1 = A.collisionSignature(p);
  p.char.boxW = 40;
  const s2 = A.collisionSignature(p);
  ok('改了 boxW 签名就变', s1 !== s2, 'signature unchanged');
}

console.log('\n=== E. connected：墙隔开的两点不连通，同房间连通 ===');
{
  /* 一道完全封死的竖墙（上下都顶到画布边） */
  const p = projWithWall([{ x: 180, y: 0 }, { x: 220, y: 300 }]);
  const left = { x: 100, y: 150 };
  const right = { x: 300, y: 150 };
  ok('被墙隔开的两点不连通', A.connected(p, left, right) === false, 'should be disconnected');
  ok('同一侧的两点连通', A.connected(p, left, { x: 50, y: 50 }) === true, 'should be connected');
}

console.log('\n=== F. 墙上有门时，两侧能连通 ===');
{
  const p = projWithWall(wallUpper);   /* 墙只到 y=200，下面有门 */
  const left = { x: 100, y: 100 };
  const right = { x: 300, y: 100 };
  ok('有门时两侧连通', A.connected(p, left, right) === true, 'should be connected');
}

console.log('\n=== G. A* 寻路 ===');
{
  const p = projWithWall(wallUpper);
  const path = A.findPath(p, { x: 100, y: 100 }, { x: 300, y: 100 });
  ok('有门时能寻到路', path.reachable === true, 'reachable=' + path.reachable);
  ok('路径有多个点', path.points.length >= 2, 'len=' + path.points.length);
  ok('路径起点正确', path.points[0].x === 100 && path.points[0].y === 100, JSON.stringify(path.points[0]));
  ok('路径终点正确', path.points[path.points.length - 1].x === 300, JSON.stringify(path.points[path.points.length - 1]));
}

console.log('\n=== H. 完全封死时寻不到路 ===');
{
  const p = projWithWall([{ x: 180, y: 0 }, { x: 220, y: 300 }]);
  const path = A.findPath(p, { x: 100, y: 150 }, { x: 300, y: 150 });
  ok('封死时不可达', path.reachable === false, 'reachable=' + path.reachable);
}

console.log('\n=== I. 路径不穿墙：每一段都能走过去 ===');
{
  const p = projWithWall(wallUpper);
  const path = A.findPath(p, { x: 100, y: 100 }, { x: 300, y: 100 });
  ok('子步推进验证通过', path.verified === true, 'verified=' + path.verified);
  ok('verifyPath 复核也通过', A.verifyPath(p, path.points) === true, 'verifyPath failed');
}

console.log('\n=== J. 窄道里的路径不穿墙 ===');
{
  /* 上下两面墙夹出一条 30px 高的走廊（角色脚底盒高 8，挤得过去）。
     走廊左端被封死，右端通到开阔地 —— 路径必须从走廊右端绕出去。 */
  const p = A.createProject();
  p.canvas = { w: 400, h: 300 };
  addWall(p, 'top', 0, 100, 300, 120, 0);
  addWall(p, 'bottom', 0, 150, 300, 170, 1);
  A.invalidateNavCache();
  ok('走廊中线站得下', A.canStandAt(p, 150, 135) === true, 'cannot stand in corridor');
  const path = A.findPath(p, { x: 150, y: 135 }, { x: 350, y: 250 });
  ok('窄道里仍然能寻到路', path.reachable === true, 'reachable=' + path.reachable);
  ok('窄道里的路径验证通过（不穿墙）', path.verified === true, 'verified=' + path.verified);
  /* 路径的每一段都不能穿过墙 */
  const segOk = path.points.every((pt, i) => {
    if (i === 0) return true;
    const prev = path.points[i - 1];
    /* 取该段中点，判定脚底盒不压红区 */
    const mx = (prev.x + pt.x) / 2;
    const my = (prev.y + pt.y) / 2;
    return A.canStandAt(p, mx, my);
  });
  ok('路径每段中点都站得下（确实没穿墙）', segOk, 'path crosses wall');
}

console.log('\n=== K. 标记状态徽标 ===');
{
  /* 一个封闭房间：四周红墙，里面一个标记 */
  const p = A.createProject();
  p.canvas = { w: 400, h: 300 };
  addWall(p, 'w0', 50, 50, 200, 70, 0);    /* 顶 */
  addWall(p, 'w1', 50, 50, 70, 200, 1);    /* 左 */
  addWall(p, 'w2', 180, 50, 200, 200, 2);  /* 右 */
  addWall(p, 'w3', 50, 180, 200, 200, 3);  /* 底 */
  A.invalidateNavCache();

  /* 房间里的标记：站得下，但房间里没有别的标记 → 孤立 */
  const inside = { x: 120, y: 120 };
  const s1 = A.markStatus(p, inside, []);
  ok('封闭房间里的标记是「孤立」', s1.status === 'isolated', 'status=' + s1.status);
  ok('孤立徽标是黄色 ⚠', s1.symbol === '⚠' && s1.color === '#eab308', JSON.stringify(s1));

  /* 房间里再放一个标记 → 变成「站得下」 */
  const s2 = A.markStatus(p, inside, [{ x: 160, y: 120 }]);
  ok('有同伴时变成「站得下」', s2.status === 'stand', 'status=' + s2.status);
  ok('站得下徽标是绿色 ✓', s2.symbol === '✓' && s2.color === '#22c55e', JSON.stringify(s2));

  /* 墙里的标记：在墙里 */
  const s3 = A.markStatus(p, { x: 60, y: 60 }, []);
  ok('墙里的标记是「在墙里」', s3.status === 'blocked', 'status=' + s3.status);
  ok('在墙里徽标是红色 ✗', s3.symbol === '✗' && s3.color === '#ef4444', JSON.stringify(s3));
}

console.log('\n=== L. 打开一道门后，不再孤立 ===');
{
  const p = A.createProject();
  p.canvas = { w: 400, h: 300 };
  addWall(p, 'w0', 50, 50, 200, 70, 0);
  addWall(p, 'w1', 50, 50, 70, 200, 1);
  addWall(p, 'w2', 180, 50, 200, 200, 2);
  addWall(p, 'w3', 50, 180, 200, 200, 3);
  A.invalidateNavCache();

  const inside = { x: 120, y: 120 };
  const outside = { x: 300, y: 120 };
  ok('开门前：房间里的是孤立', A.markStatus(p, inside, [outside]).status === 'isolated', 'not isolated');
  ok('开门前：两处不连通', A.connected(p, inside, outside) === false, 'still connected');

  /* 把右边那堵墙拆掉一截（开门） */
  p.regions[2].points = [{ x: 180, y: 50 }, { x: 200, y: 80 }];
  A.invalidateNavCache();
  ok('开门后：房间里的是站得下', A.markStatus(p, inside, [outside]).status === 'stand', 'still isolated');
  ok('开门后：两处连通', A.connected(p, inside, outside) === true, 'still disconnected');
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
