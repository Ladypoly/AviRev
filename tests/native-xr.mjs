// Native-rig XR checks: real exported skeletons, meshes and clips through the real AR, IK, animation and renderer code.
// Covers Puppet grip orientation, floor-sit grounding/stand-up and GPU-skin parity with the legacy CPU skin.
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url), three = new URL('libs/three/package/build/three.module.js', root).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){return s==='three'?{url:${JSON.stringify(three)},shortCircuit:true}:n(s,c);}`));
globalThis.fetch = async input => { const url = new URL(String(input)); try { return new Response(await readFile(fileURLToPath(url.href.split('?')[0]))); } catch { return new Response('', { status: 404 }); } };
const T = await import(three), at = path => import(new URL(path, root).href);
const { assetJSON } = await at('builder-assets.mjs'), animation = await at('builder-animation.mjs'), { AvatarRenderer } = await at('builder-renderer.mjs'), { AvatarAR } = await at('builder-ar.mjs'), model = await at('builder-model.mjs');
let checks = 0; const check = (value, message) => { checks++; assert.ok(value, message); };
const data = await assetJSON('browser_data/catalog.json');
data.humanShapes = data.HumanShapes || []; data.defaults = data.Rules?.DefaultLook || {}; data.rules = { hiddenTiles: {} };
for (const family of data.families) family.materials = data.materials || family.materials || [];
const idleClip = await animation.loadIdleClip(), v = (x, y, z) => new T.Vector3(x, y, z), R = new T.Matrix4().makeScale(-1, 1, 1), point = m => new T.Vector3().setFromMatrixPosition(m);

async function rig(familyName) {
  const family = data.families.find(f => f.Family.toLowerCase() === familyName), config = model.freshConfig(); config.Family = familyName;
  const request = model.resolve(config, family, data, false), r = Object.create(AvatarRenderer.prototype);
  Object.assign(r, { cache: new Map(), instances: new Map(), materials: new Map(), materialInstances: new Map(), report: [], wireMaterial: new T.MeshBasicMaterial(), cutMaterial: new T.MeshBasicMaterial(), group: new T.Group(), idlePlaying: true, gpuSkinning: true });
  for (const mesh of family.meshes) for (const row of mesh.submeshes || []) r.materials.set(family.Family + ':' + row.materialId, Promise.resolve(new T.MeshBasicMaterial()));
  const items = await Promise.all(family.meshes.filter(mesh => request.MeshNames.includes(mesh.name)).map(definition => r.mesh(family, definition)));
  Object.assign(r, { currentFamily: family, currentConfig: JSON.parse(JSON.stringify(config)), currentWeights: request.ShapeWeights, currentBody: request.BodyMesh, active: items, idleClip, idleFactory: animation.createIdlePlayer });
  r.configureIdle(family, config); for (const item of items) { r.applyMorphs(item, request.ShapeWeights); r.idlePlayer.capture(item); r.group.add(item.mesh); }
  r.idlePlayer.update(0, items); return { r, family };
}

// 1. Puppet hands follow the absolute WebXR grip frame (-Z thumb, +Y up the arm, +X back of right hand), independent of calibration palms.
const grip = (side, aim, across) => { const back = side === 'l' ? across.clone().cross(aim) : aim.clone().cross(across); return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(side === 'l' ? back.negate() : back, aim.clone().negate(), across.clone().negate())); };
const toAvatar = w => v(-w.x, w.y, -w.z); // user faces world -Z; direct avatar frame is turned 180 degrees
const calibrations = { palmsForward: { l: [v(-1, 0, 0), v(0, 1, 0)], r: [v(1, 0, 0), v(0, 1, 0)], lp: v(-.75, 1.42, 0), rp: v(.75, 1.42, 0) }, palmsDown: { l: [v(-1, 0, 0), v(0, 0, -1)], r: [v(1, 0, 0), v(0, 0, -1)], lp: v(-.75, 1.42, 0), rp: v(.75, 1.42, 0) } };
const poses = { relaxedHold: { l: [v(0, 0, -1), v(0, 1, 0)], r: [v(0, 0, -1), v(0, 1, 0)], lp: v(-.22, 1, -.3), rp: v(.22, 1, -.3) }, palmsUp: { l: [v(0, 0, -1), v(-1, 0, 0)], r: [v(0, 0, -1), v(1, 0, 0)], lp: v(-.22, 1.05, -.35), rp: v(.22, 1.05, -.35) }, pointDown: { l: [v(0, -1, 0), v(0, 0, -1)], r: [v(0, -1, 0), v(0, 0, -1)], lp: v(-.25, .85, -.1), rp: v(.25, .85, -.1) }, handsTogether: { l: [v(0, 0, -1), v(0, 1, 0)], r: [v(0, 0, -1), v(0, 1, 0)], lp: v(-.045, 1.2, -.35), rp: v(.045, 1.2, -.35) } };
for (const family of data.families) for (const [calibrationName, calibration] of Object.entries(calibrations)) for (const [poseName, target] of Object.entries(poses)) for (const mode of ['direct', 'mirror']) {
  const human = family.Family === 'human', layer = animation.createPuppetLayer(family), owner = { currentFamily: family, puppetLayer: layer, idleSignature: 's', setPuppetTargets: targets => layer.setTargets(targets) };
  owner.puppetReference = AvatarRenderer.prototype.puppetReference.bind(owner);
  const ar = { behavior: 'puppet', canMove: () => true, fingerCurl: AvatarAR.prototype.fingerCurl, owner, groundY: 0, ui: { mirror: { checked: mode === 'mirror' } }, puppetCalibrationRequested: true };
  let state = calibration; const transform = (p, q) => ({ transform: { matrix: new T.Matrix4().compose(p, q, v(1, 1, 1)).toArray() } });
  const frame = { getPose: space => { const side = space === 'L' ? 'l' : 'r'; return transform(state[side + 'p'], grip(side, ...state[side])); } }, tracked = [{ handedness: 'left', gripSpace: 'L' }, { handedness: 'right', gripSpace: 'R' }];
  const step = () => AvatarAR.prototype.updatePuppet.call(ar, frame, 'space', transform(v(0, 1.6, 0), new T.Quaternion()), tracked, 1 / 72);
  step(); check(!!ar.puppetCalibration, `${family.Family} ${calibrationName} T-pose calibrates`);
  state = target; step(); for (let i = 0; i < 400; i++) layer.update(i / 72);
  const pose = layer.apply(layer.referencePose());
  for (const [side, prefix] of [['l', 'Left'], ['r', 'Right']]) {
    const bone = (h, r) => R.clone().multiply(pose.get(family.skeleton.find(b => b.name === (human ? h : r)).path)).multiply(R), hand = point(bone('hand.' + side, prefix + 'Hand'));
    const aim = point(bone('c_middle1.' + side, prefix + 'HandMiddle1')).sub(hand).normalize(), across = point(bone('c_index1.' + side, prefix + 'HandIndex1')).sub(point(bone('c_pinky1.' + side, prefix + 'HandPinky1')));
    across.addScaledVector(aim, -across.dot(aim)).normalize();
    const source = mode === 'direct' ? side : side === 'l' ? 'r' : 'l', mirror = w => mode === 'mirror' ? toAvatar(w).multiply(v(-1, 1, 1)) : toAvatar(w);
    const label = `${family.Family} ${calibrationName} ${poseName} ${mode} ${side}`;
    check(aim.angleTo(mirror(target[source][0])) < .05, label + ' fingers follow grip');
    check(across.angleTo(mirror(target[source][1])) < .05, label + ' thumb side follows grip');
  }
  // Controllers held together in front: the palms meet, the avatar hands must not cross (grips sit in the palm, not at the wrist).
  if (poseName === 'handsTogether') { const at = (map, h, r) => point(R.clone().multiply(map.get(family.skeleton.find(b => b.name === (human ? h : r)).path)).multiply(R)), palm = (s, p) => at(pose, 'hand.' + s, p + 'Hand').lerp(at(pose, 'c_middle1.' + s, p + 'HandMiddle1'), animation.PALM_FRACTION), reference = layer.referencePose(), restSide = Math.sign(at(reference, 'hand.l', 'LeftHand').x - at(reference, 'hand.r', 'RightHand').x), gap = palm('l', 'Left').sub(palm('r', 'Right'));
    check(Math.sign(gap.x) === restSide && Math.abs(gap.x) < .2, `${family.Family} ${calibrationName} ${mode} hands together do not cross (palm gap ${gap.x.toFixed(3)} m)`); }
}

// 1b. Controller trigger/grip curl the avatar's fingers toward the palm (thumb on a button bends the thumb).
for (const family of data.families) {
  const human = family.Family === 'human', layer = animation.createPuppetLayer(family), owner = { currentFamily: family, puppetLayer: layer, idleSignature: 's', setPuppetTargets: targets => layer.setTargets(targets) };
  owner.puppetReference = AvatarRenderer.prototype.puppetReference.bind(owner);
  const ar = { behavior: 'puppet', canMove: () => true, fingerCurl: AvatarAR.prototype.fingerCurl, owner, groundY: 0, ui: { mirror: { checked: false } }, puppetCalibrationRequested: true };
  let state = calibrations.palmsDown, press = 0; const transform = (p, q) => ({ transform: { matrix: new T.Matrix4().compose(p, q, v(1, 1, 1)).toArray() } });
  const frame = { getPose: space => { const side = space === 'L' ? 'l' : 'r'; return transform(state[side + 'p'], grip(side, ...state[side])); } };
  const pad = () => ({ buttons: [{ value: press, pressed: press > .5, touched: press > 0 }, { value: press, pressed: press > .5 }, {}, { touched: press > 0 }] });
  const tracked = [{ handedness: 'left', gripSpace: 'L', get gamepad() { return pad(); } }, { handedness: 'right', gripSpace: 'R', get gamepad() { return pad(); } }];
  const step = () => AvatarAR.prototype.updatePuppet.call(ar, frame, 'space', transform(v(0, 1.6, 0), new T.Quaternion()), tracked, 1 / 72);
  step(); state = poses.relaxedHold;
  const tips = () => { step(); for (let i = 0; i < 200; i++) layer.update(i / 72); const pose = layer.apply(layer.referencePose()), at = (h, r) => point(R.clone().multiply(pose.get(family.skeleton.find(b => b.name === (human ? h : r)).path)).multiply(R));
    const wrist = at('hand.l', 'LeftHand'), name = finger => at('c_' + finger + '3.l', 'LeftHand' + finger[0].toUpperCase() + finger.slice(1) + '3'), knuckle = finger => at('c_' + finger + '1.l', 'LeftHand' + finger[0].toUpperCase() + finger.slice(1) + '1');
    const normal = knuckle('middle').sub(wrist).cross(knuckle('pinky').sub(knuckle('index'))).normalize(), palmSide = knuckle('thumb').sub(wrist).dot(normal) < 0 ? normal.negate() : normal;
    return { ...Object.fromEntries(['index', 'middle', 'pinky', 'thumb'].map(finger => [finger, name(finger).distanceTo(wrist)])), side: name('middle').sub(knuckle('middle')).dot(palmSide) }; };
  press = 0; const open = tips(); layer.reset(); ar.puppetCalibration = null; ar.puppetCalibrationRequested = true; state = calibrations.palmsDown; step(); state = poses.relaxedHold; press = 1; const closed = tips();
  for (const finger of ['index', 'middle', 'pinky']) check(closed[finger] < open[finger] * .85, `${family.Family} ${finger} curls with trigger/grip (${open[finger].toFixed(3)} -> ${closed[finger].toFixed(3)} m)`);
  check(closed.thumb < open.thumb, `${family.Family} thumb bends when touching a button`);
  check(closed.side > open.side, `${family.Family} fingers curl toward the palm, not backward (${open.side.toFixed(3)} -> ${closed.side.toFixed(3)})`);
}

// 2. Holding crouch sits on the floor (pelvis near the floor, not frozen at hip height); right stick forward stands again.
class E extends EventTarget { hidden = true; disabled = false; textContent = ''; value = '75'; checked = true; setAttribute() {} }
const parity = {};
// A Quest room scan is a bumpy triangle mesh: ±1.5 cm noise on a 6 cm grid gives tilted floor triangles.
function scannedFloor() {
  const size = 4, cell = .06, count = Math.round(size / cell) + 1, vertices = [], indices = []; let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - .5) * .03; };
  for (let z = 0; z < count; z++) for (let x = 0; x < count; x++) vertices.push(-size / 2 + x * cell, noise(), -size / 2 + z * cell);
  for (let z = 0; z < count - 1; z++) for (let x = 0; x < count - 1; x++) { const a = z * count + x, b = a + 1, c = a + count, d = c + 1; indices.push(a, c, b, b, c, d); }
  return { vertices: Float32Array.from(vertices), indices: Uint32Array.from(indices), semanticLabel: 'global mesh', lastChangedTime: 1, meshSpace: 'roomSpace' };
}
for (const [familyName, collision] of [['human', 'floor'], ['robot', 'floor'], ['human', 'room'], ['robot', 'room']]) {
  const { r, family } = await rig(familyName), label = familyName + (collision === 'room' ? ' (bumpy room scan)' : '');
  const session = Object.assign(new EventTarget(), { inputSources: [], async requestReferenceSpace(type) { return type; }, async requestHitTestSource() { return { cancel() {} }; }, async end() { this.dispatchEvent(new Event('end')); } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'OculusBrowser', xr: { isSessionSupported: async type => type === 'immersive-ar', requestSession: async () => session } } });
  const ui = Object.fromEntries(['button', 'status', 'overlay', 'controls', 'hint', 'exit', 'reposition', 'size', 'sizeLabel', 'walk', 'sit', 'turn', 'seatHeight', 'seatHeightLabel', 'seatHeightControls', 'crawl', 'fly', 'roomStatus', 'behavior', 'mirror', 'calibrate', 'collision', 'runMode'].map(key => [key, new E()]));
  ui.collision.value = collision; ui.behavior.value = 'manual'; ui.runMode.value = 'toggle';
  const scene = new T.Scene(), viewer = new T.PerspectiveCamera(); scene.add(r.group); viewer.position.set(0, 1.6, 1.5);
  Object.assign(r, { scene, camera: new T.PerspectiveCamera(), controls: { enabled: true, target: new T.Vector3() }, resize() {}, renderer: { shadowMap: { enabled: false }, getClearAlpha: () => 1, setClearAlpha() {}, xr: { enabled: false, setReferenceSpaceType() {}, async setSession() {}, getReferenceSpace: () => 'space', getCamera: () => viewer, setFramebufferScaleFactor() {}, setFoveation() {} } } });
  const ar = new AvatarAR(r, ui); r.ar = ar; await ar.available; await ar.start();
  const mapped = (handedness, x) => ({ handedness, targetRayMode: 'tracked-pointer', profiles: ['oculus-touch-v3'], targetRaySpace: { x }, gripSpace: { x }, gamepad: { mapping: 'xr-standard', buttons: Array.from({ length: 6 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] } });
  const right = mapped('right', .3); session.inputSources = [mapped('left', -.3), right];
  const pose = m => ({ transform: { matrix: m.toArray(), position: { x: m.elements[12], y: m.elements[13], z: m.elements[14] } } }), ray = new T.Matrix4().compose(v(.3, 1, .8), new T.Quaternion().setFromAxisAngle(v(1, 0, 0), -Math.PI / 3), v(1, 1, 1));
  const room = collision === 'room' ? new Set([scannedFloor()]) : undefined;
  const frame = { detectedMeshes: room, getViewerPose: () => pose(new T.Matrix4().makeTranslation(0, 1.6, 1.5)), getPose: space => space === 'roomSpace' ? pose(new T.Matrix4()) : pose(ray.clone().setPosition(space.x, 1, .8)), getHitTestResults: () => [] };
  let time = 0; const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  const step = async (seconds = 1 / 72) => { for (let t = 0; t < seconds; t += 1 / 72) { time += 1 / 72; ar.update(frame, time); r.animationPlayer()?.update(time, r.active); ar.refreshPoseGround(); await settle(); } };
  await step(); await ar.place({ inputSource: right }); check(ar.placed && ar.reticle && (!room || ar.world.hasGeometry), label + ' placed with the controller ring');
  const pelvis = family.skeleton.find(bone => bone.name === (familyName === 'human' ? 'root.x' : 'Hips'));
  const measure = () => { let low = Infinity; for (const item of r.active) { const positions = r.posedPositions(item); for (let i = 1; i < positions.length; i += 3) low = Math.min(low, positions[i]); } const scale = r.group.scale.x; return { pelvis: r.group.position.y + r.animationPlayer().pose().get(pelvis.path).elements[13] * scale - ar.anchor.y, low: r.group.position.y + low * scale - ar.anchor.y }; };
  await step(.4); const standing = measure();
  // Real thumbs drift sideways and wobble: 30% sideways tilt plus a 0.1 s dropout must not restart the 1 s hold.
  right.gamepad.axes[2] = .3; right.gamepad.axes[3] = 1; await step(.5); check(ar.holdRing.visible, label + ' hold ring shows crouch progress'); right.gamepad.axes[3] = .2; await step(.1); right.gamepad.axes[3] = 1; await step(1);
  check(r.sitting && r.seatMode === 'floor', label + ' drifting, wobbling crouch hold still sits'); right.gamepad.axes[2] = 0; await step(1); const seated = measure();
  check(r.sitting && r.seatMode === 'floor', label + ' crouch hold sits on the floor');
  check(seated.pelvis < .15 && seated.pelvis < standing.pelvis * .3, `${label} seated pelvis near floor (${seated.pelvis.toFixed(3)} m, standing ${standing.pelvis.toFixed(3)} m)`);
  check(Math.abs(seated.low) < .03, `${label} seated body rests on floor (${seated.low.toFixed(3)} m)`);
  right.gamepad.axes[3] = 0; const heading = r.group.quaternion.clone(); right.gamepad.axes[2] = 1; await step(.5); right.gamepad.axes[2] = 0;
  check(r.group.quaternion.angleTo(heading) < 1e-6 && r.sitting, label + ' right stick does not spin a seated avatar');
  await step(); right.gamepad.axes[3] = -1; await step(.2); right.gamepad.axes[3] = 0; await step(1.2); const stood = measure();
  check(!r.sitting && Math.abs(stood.pelvis - standing.pelvis) < .03 && Math.abs(stood.low) < .03, label + ' right stick forward stands back on the floor');
  // Stretch with sideways drift and a short wobble takes off within the 1 s hold plus clip loading.
  right.gamepad.axes[2] = -.3; right.gamepad.axes[3] = -1; await step(.5); right.gamepad.axes[3] = -.2; await step(.1); right.gamepad.axes[3] = -1; for (let i = 0; i < 40 && !ar.flightMode; i++) await step(.1);
  check(ar.flightMode && ar.flying, label + ' drifting, wobbling stretch hold enters flight' + (ar.runtimeError ? ': ' + ar.runtimeError : ''));
  right.gamepad.axes[2] = 0; await step(.6); const high = ar.anchor.y; check(high > (ar.groundY ?? 0) + .3, label + ' flight climbs');
  right.gamepad.axes[3] = 1; for (let i = 0; i < 120 && ar.flightMode; i++) await step(.1);
  check(!ar.flightMode && ar.motor.grounded && Math.abs(ar.anchor.y - ar.groundY) < .05, label + ' pulling back descends and lands on the floor' + (ar.runtimeError ? ': ' + ar.runtimeError : ''));
  right.gamepad.axes[3] = 0; await step(.5);
  // Double jump: A, then A again while airborne, takes off into flight from mid-air.
  const press = async seconds => { right.gamepad.buttons[4].pressed = true; await step(1 / 72); right.gamepad.buttons[4].pressed = false; await step(seconds); };
  await press(.15); check(!!ar.jumpState && !ar.motor.grounded, label + ' A jumps'); await press(0); for (let i = 0; i < 30 && !ar.flightMode; i++) await step(.05);
  check(ar.flightMode && ar.flying && !ar.jumpState, label + ' second A while airborne enters flight' + (ar.runtimeError ? ': ' + ar.runtimeError : ''));
  right.gamepad.axes[3] = 1; for (let i = 0; i < 120 && ar.flightMode; i++) await step(.1); right.gamepad.axes[3] = 0;
  check(!ar.flightMode && ar.motor.grounded, label + ' double-jump flight lands again');
  await press(1.5); check(!ar.flightMode && ar.motor.grounded && !ar.jumpState, label + ' single jump still lands normally');
  await session.end();
  if (collision === 'room') continue;

  // 3. GPU skinning: every native mesh is a SkinnedMesh and its lazily skinned CPU positions equal the legacy CPU skin.
  check(r.active.every(item => item.mesh.isSkinnedMesh && item.mesh.skeleton.boneTexture), familyName + ' all meshes GPU skinned');
  r.setSitting(false); r.motionAction = null; r.walking = false; for (let i = 0; i <= 30; i++) r.idlePlayer.update(10 + i / 30, r.active);
  const gpu = r.active.map(item => Float32Array.from(r.posedPositions(item)));
  for (const item of r.active) Object.defineProperty(item.mesh, 'isSkinnedMesh', { value: false, configurable: true });
  r.idlePlayer.setPoseLayer(r.puppetLayer); r.idlePlayer.update(11, r.active);
  let worst = 0; r.active.forEach((item, index) => { const cpu = item.geometry.getAttribute('position').array; for (let i = 0; i < cpu.length; i++) worst = Math.max(worst, Math.abs(cpu[i] - gpu[index][i])); });
  check(worst < 1e-5, `${familyName} GPU-skin positions equal legacy CPU skin (max ${worst} m)`); parity[familyName] = worst;
}
console.log(JSON.stringify({ status: 'PASS', checks, coverage: 'Native Human/Robot: absolute grip hand orientation (palms-forward and palms-down calibration, direct/mirror), 1 s crouch-hold floor sit and stand, stretch takeoff and pull-back landing with Floor-only and a bumpy scanned room mesh, GPU-skin position parity', parity, limits: ['GPU shader output is checked in a browser, not here; Quest comfort/frame time still need the headset.'] }));
