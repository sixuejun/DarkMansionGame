/* 验证 MapStitch 导入的注解兼容规则：
   旧 occlusion → 新 adjust（旧遮挡→新调节）
   旧 adjust    → 新 occlusion（旧调节→新遮挡）
   旧 collision / top 一一对应。
   用法：node test_mapstitch.cjs */
const { load } = require('./tests/load.cjs');

const A = load('src/core/index.ts');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else    { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); }
};

console.log('\n=== 1. 类型映射表 ===');
ok('mapStitchTypeToInternal("occlusion") === "adjust"',
   A.mapStitchTypeToInternal('occlusion') === 'adjust');
ok('mapStitchTypeToInternal("adjust") === "occlusion"',
   A.mapStitchTypeToInternal('adjust') === 'occlusion');
ok('mapStitchTypeToInternal("collision") === "collision"',
   A.mapStitchTypeToInternal('collision') === 'collision');
ok('mapStitchTypeToInternal("top") === "top"',
   A.mapStitchTypeToInternal('top') === 'top');
ok('未知类型兜底为 occlusion',
   A.mapStitchTypeToInternal('nonsense') === 'occlusion');

console.log('\n=== 2. map_layer 映射 ===');
ok('"object"  → "objects"', A.mapStitchLayerToTarget('object') === 'objects');
ok('"surface" → "background"', A.mapStitchLayerToTarget('surface') === 'background');
ok('undefined → "both"', A.mapStitchLayerToTarget(undefined) === 'both');

console.log('\n=== 3. annotations.json 解析 ===');
const sample = {
  layers: [
    /* 旧 occlusion 应该全部 → 新 adjust */
    {
      id: 'occlusion', label: '遮挡层',
      shapes: [
        { id: 'o1', layer_label: '阴影1', mode: 'rectangle',
          map_layer: 'object',
          points: [{ x: 50, y: 60 }, { x: 150, y: 160 }] },
        { id: 'o2', layer_label: '阴影2', mode: 'polygon',
          map_layer: 'surface',
          points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }] },
      ],
    },
    /* 旧 adjust → 新 occlusion */
    { id: 'adjust', label: '调节层', shapes: [
      { id: 'a1', layer_label: '亮度', mode: 'rectangle',
        map_layer: 'object',
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] },
    ]},
    /* collision / top 原样 */
    { id: 'collision', label: '碰撞', shapes: [
      { id: 'c1', layer_label: '墙', mode: 'rectangle',
        map_layer: 'surface',
        points: [{ x: 5, y: 5 }, { x: 25, y: 25 }] },
    ]},
    { id: 'top', label: '最上层', shapes: [] },
    /* 未知层：跳过 + 警告 */
    { id: 'mystery', label: '?', shapes: [
      { id: 'm1', layer_label: '?', mode: 'rectangle',
        map_layer: 'surface',
        points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    ]},
  ],
};

const parsed = A.parseMapStitchAnnotations(sample);
/* 4 个已知层各产若干 + 未知层（兜底成 occlusion，被警告但仍解析）共 5 个 */
ok('共 5 个区域（旧 occlusion ×2、旧 adjust ×1、collision ×1、未知层兜底 ×1）',
   parsed.regions.length === 5, `len=${parsed.regions.length}`);
ok('对未知层发出 warnings', parsed.warnings.length >= 1, JSON.stringify(parsed.warnings));

const byOldName = (oldLabel) => parsed.regions.find(r => r.name === oldLabel);
ok('旧 occlusion「阴影1」→ 新 adjust', byOldName('阴影1') && byOldName('阴影1').type === 'adjust');
ok('旧 occlusion「阴影2」→ 新 adjust', byOldName('阴影2') && byOldName('阴影2').type === 'adjust');
ok('旧 adjust「亮度」→ 新 occlusion',
   byOldName('亮度') && byOldName('亮度').type === 'occlusion');
ok('旧 collision「墙」→ 新 collision',
   byOldName('墙') && byOldName('墙').type === 'collision');

const y1 = byOldName('阴影1');
ok('rect 规整为左上/右下两点', y1 && y1.shape === 'rect' && y1.points.length === 2
   && y1.points[0].x === 50 && y1.points[0].y === 60
   && y1.points[1].x === 150 && y1.points[1].y === 160);
ok('object map_layer → target=objects', y1.target === 'objects');

const y2 = byOldName('阴影2');
ok('polygon shape 保留全部顶点', y2.shape === 'poly' && y2.points.length === 3);
ok('surface map_layer → target=background', y2.target === 'background');

console.log('\n=== 4. 导出格式（toMapJson）必须使用新类型，不会反向还原 ===');
const project = A.createProject();
project.canvas = { w: 1920, h: 1080 };
A.addRegion(project, { name: 'X', type: 'adjust', target: 'both', shape: 'rect',
  points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] });
A.addRegion(project, { name: 'Y', type: 'occlusion', target: 'both', shape: 'rect',
  points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] });
const map = A.toMapJson(project);
ok('map.json 含 adjust / occlusion（不再写旧 occlusion/adjust 反向）',
   map.regions.some(r => r.type === 'adjust') && map.regions.some(r => r.type === 'occlusion'));
ok('map.json 含 4 套规则的 type_tiebreak',
   JSON.stringify(map.rules.type_tiebreak) === JSON.stringify(['collision', 'adjust', 'occlusion', 'top']),
   JSON.stringify(map.rules.type_tiebreak));
/* render_order 现在是九步：
   白层拆成 below / above 两段（不再固定在最底），
   前景层固定插在角色之上、绿色最上层之下 */
ok('render_order 为九步顺序',
   JSON.stringify(map.render_order) === JSON.stringify([
     'background_below', 'objects_lower', 'character', 'background_above',
     'objects_upper', 'character_ghost', 'foreground', 'top',
   ]),
   JSON.stringify(map.render_order));
ok('foreground 排在 character 之后（永远盖住角色）',
   map.render_order.indexOf('foreground') > map.render_order.indexOf('character'));
ok('foreground 排在 top 之前（绿色最上层仍是最顶上）',
   map.render_order.indexOf('foreground') < map.render_order.indexOf('top'));
/* 白层不再是单段：below 在角色下方，above 在角色上方（遮挡物） */
ok('白层拆成 background_below / background_above 两段',
   map.render_order.includes('background_below') && map.render_order.includes('background_above'));
ok('background_below 排在 character 之前（白层默认在角色下方）',
   map.render_order.indexOf('background_below') < map.render_order.indexOf('character'));
ok('background_above 排在 character 之后（白层遮挡物在角色上方）',
   map.render_order.indexOf('background_above') > map.render_order.indexOf('character'));
ok('layer_split 规则段存在且说明了两层的切法',
   !!map.layer_split && /白层/.test(map.layer_split.background) && /黑层/.test(map.layer_split.objects));
ok('layers 含三张 PNG，前景层文件名为 foreground.png',
   map.layers.length === 3 && map.layers[2].id === 'foreground' && map.layers[2].file === 'foreground.png',
   JSON.stringify(map.layers));
ok('fade 规则段说明 globalAlpha 需取 1 - fadeAlpha',
   map.fade && map.fade.composite === 'destination-out' && /1 - fadeAlpha/.test(map.fade.notes));

console.log('\n=== 5. map.json → 工程 round-trip 不能丢失区域与类型 ===');
const json = JSON.parse(JSON.stringify(map));
const regions2 = A.regionsFromMapJson(json);
ok('round-trip 区域数一致', regions2.length === map.regions.length,
   `${regions2.length} vs ${map.regions.length}`);
ok('round-trip 后类型一致',
   regions2.every((r, i) => r.type === map.regions[i].type),
   regions2.map(r => r.type).join(',') + ' vs ' + map.regions.map(r => r.type).join(','));

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
