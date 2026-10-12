import assert from 'node:assert/strict';
import * as T from '../libs/three/package/build/three.module.js';
import { XRWorld, occlusionGroup } from '../builder-xr-world.mjs';
let checks = 0; const check = (value, message) => { checks++; assert.ok(value, message); };

// A Space Setup room: one 4 x 2.5 m wall facing +Z at z = -2 with a 1 x 1 m window frame on it, the floor, a table box and the dense scan.
const rect = (w, d, x = 0, z = 0) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => ({ x: a + x, y: 0, z: b + z }));
const wallPose = new T.Matrix4().compose(new T.Vector3(0, 1.25, -2), new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2), new T.Vector3(1, 1, 1));
const plane = (label, polygon, matrix) => ({ semanticLabel: label, polygon, planeSpace: { matrix }, lastChangedTime: 1 });
const wall = plane('wall', rect(4, 2.5), wallPose), window = plane('window frame', rect(1, 1, .5, -.1), wallPose.clone().multiply(new T.Matrix4().makeTranslation(0, .01, 0)));
const floor = plane('floor', rect(4, 4), new T.Matrix4());
const box = (label, size, center, triangles) => { const g = new T.BoxGeometry(...size, triangles > 12 ? 30 : 1, triangles > 12 ? 30 : 1, 1).translate(...center); return { semanticLabel: label, vertices: g.attributes.position.array, indices: g.index.array, meshSpace: { matrix: new T.Matrix4() }, lastChangedTime: 1 }; };
const table = box('table', [1, .75, .6], [1, .375, 0], 12), scan = box('global mesh', [3, 2, 3], [0, 1, 4], 9000);
const frame = { detectedPlanes: new Set([wall, window, floor]), detectedMeshes: new Set([table, scan]), getPose: space => ({ transform: { matrix: space.matrix.toArray() } }), getViewerPose: () => ({ transform: { position: { x: 0, y: 1.6, z: 0 } } }) };

const world = new XRWorld(new T.Scene()), entry = source => world.entries.get(source), area = geometry => { const p = geometry.attributes.position, i = geometry.index; let sum = 0; for (let k = 0; k < i.count; k += 3) { const a = new T.Vector3().fromBufferAttribute(p, i.getX(k)), b = new T.Vector3().fromBufferAttribute(p, i.getX(k + 1)), c = new T.Vector3().fromBufferAttribute(p, i.getX(k + 2)); sum += new T.Triangle(a, b, c).getArea(); } return sum; };
const show = kinds => { world.occlusionKinds = new Set(kinds); world.update(frame, 'space'); };

// 1. Grouping: Space Setup planes and furniture boxes are "setup", only the dense scan is "scan".
show(['setup', 'scan']);
check(occlusionGroup(entry(table)) === 'setup' && occlusionGroup(entry(wall)) === 'setup' && occlusionGroup(entry(scan)) === 'scan', 'table box and wall are setup, global mesh is scan');

// 2. Room setup: the window frame never occludes and the wall occluder has the window cut out; collision keeps the whole wall.
show(['setup']);
check(!entry(window).occluder?.visible, 'window frame is not an occluder');
check(entry(wall).occluder?.visible && Math.abs(area(entry(wall).occluder.geometry) - 9) < 1e-3, `wall occluder is 10 m2 minus the 1 m2 window (got ${area(entry(wall).occluder.geometry).toFixed(3)})`);
check(Math.abs(area(entry(wall).geometry) - 10) < 1e-3, 'collision geometry keeps the full wall');
const through = world.raycast(new T.Vector3(.5, 1.15, 0), new T.Vector3(0, 0, -1), 4);
check(through && Math.abs(through.point.z + 2) < .02, 'a ray through the window still hits the wall for collision');
check(/1 window open/.test(world.statusText), 'status reports the open window: ' + world.statusText);
check(entry(table).occluder?.visible && !entry(scan).occluder?.visible, 'Room setup shows the table box, not the scan');

// 3. Scanned mesh shows only the scan; Off shows nothing.
show(['scan']);
check(entry(scan).occluder?.visible && !entry(table).occluder?.visible && !entry(wall).occluder?.visible, 'Scanned mesh shows only the scan');
show([]);
check(!world.occluders.visible, 'Off hides every occluder');

// 4. A window that is not on the wall (another wall, 1 m away) cuts nothing.
window.planeSpace.matrix = wallPose.clone().multiply(new T.Matrix4().makeTranslation(0, 1, 0)); window.lastChangedTime = 2;
show(['setup']);
check(Math.abs(area(entry(wall).occluder.geometry) - 10) < 1e-3, 'an off-plane window leaves the wall whole');

console.log(JSON.stringify({ status: 'PASS', checks, coverage: 'Occluder groups (setup vs global-mesh scan), window frames excluded and cut out of their wall occluder, collision keeps the full wall, Off/Scan/Setup visibility' }));
