import * as THREE from './libs/three/package/build/three.module.js';
import { postureMatrices, standingKneePole } from './builder-posture.mjs?v=8f0df2f7d92d';

let clipPromise;
// Global so a restored skin state can never collide with a version cached during capsule sampling.
let skinVersion = 0;
let walkPromise, seatPromise, actionPromise;
let posturePromise;
export function loadPostureClips(url = new URL('./animation/rpm-postures.json', import.meta.url)) {
  if (!posturePromise) posturePromise = fetch(url).then(async response => {
    if (!response.ok) throw new Error('Avatar postures unavailable.');
    const manifest = await response.json(), postures = {};
    if (manifest.schemaVersion !== 1) throw new Error('Invalid avatar posture manifest.');
    for (const name of ['stretch', 'floor-sit']) {
      postures[name] = {};
      for (const type of ['male', 'female']) {
        const result = await fetch(new URL(manifest[name][type], url));
        if (!result.ok) throw new Error(name + ' posture unavailable.');
        postures[name][type] = [await result.json()];
      }
    }
    return postures;
  }).catch(error => { posturePromise = null; throw error; });
  return posturePromise;
}
const fullMovementPromises = new Map(); let fullMovementManifest;
export function loadFullMovementClip(name, url = new URL('./animation/rpm-full-movement.json', import.meta.url)) {
  if (!/^(crawl|crawlIdle|fly|flyIdle|fly(Forward|Backward|Left|Right|Up|Down)|(walk|run|crouch)(Backward|Left|Right))$/.test(name)) throw new Error('Unknown movement animation.');
  if (!fullMovementPromises.has(name)) fullMovementPromises.set(name, (async () => {
    fullMovementManifest ||= fetch(url).then(async response => { if (!response.ok) throw new Error('Movement library unavailable.'); const manifest = await response.json(); if (manifest.schemaVersion !== 1) throw new Error('Invalid movement library.'); return manifest; }).catch(error => { fullMovementManifest = null; throw error; });
    const manifest = await fullMovementManifest, clips = {};
    for (const type of ['male', 'female']) { const relative = manifest[name]?.[type]; if (typeof relative !== 'string' || !/^((rpm|ual)\/)/.test(relative) || relative.includes('..')) throw new Error('Missing movement animation.'); const response = await fetch(new URL(relative, url)); if (!response.ok) throw new Error(name + ' animation unavailable.'); clips[type] = [await response.json()]; }
    return { [name]: clips };
  })().catch(error => { fullMovementPromises.delete(name); throw error; }));
  return fullMovementPromises.get(name);
}
export function loadActionClips(url = new URL('./animation/ual-movements.json', import.meta.url)) {
  if (!actionPromise) actionPromise = fetch(url).then(async response => {
    if (!response.ok) throw new Error('Controller animations unavailable.');
    const manifest = await response.json(), actions = {};
    if (manifest.schemaVersion !== 1) throw new Error('Invalid controller animation manifest.');
    for (const action of ['run', 'jump', 'crouch', 'crouchIdle']) {
      actions[action] = {};
      for (const type of ['male', 'female']) { const result = await fetch(new URL(manifest[action][type], url)); if (!result.ok) throw new Error(action + ' animation unavailable.'); actions[action][type] = [await result.json()]; }
    }
    return actions;
  }).catch(error => { actionPromise = null; throw error; });
  return actionPromise;
}
export function loadSeatClips(url = new URL('./animation/ual-movements.json', import.meta.url)) {
  if (!seatPromise) seatPromise = fetch(url).then(async response => {
    if (!response.ok) throw new Error('Seated pose unavailable.');
    const manifest = await response.json(), clips = {};
    if (manifest.schemaVersion !== 1) throw new Error('Invalid seated animation manifest.');
    for (const type of ['male', 'female']) { const result = await fetch(new URL(manifest.sit[type], url)); if (!result.ok) throw new Error('Seated pose unavailable.'); clips[type] = [await result.json()]; }
    return clips;
  }).catch(error => { seatPromise = null; throw error; });
  return seatPromise;
}
export function loadWalkClips(url = new URL('./animation/ual-movements.json', import.meta.url)) {
  if (!walkPromise) walkPromise = fetch(url).then(async response => {
    if (!response.ok) throw new Error('Walking animation unavailable.');
    const manifest = await response.json(), clips = {};
    for (const type of ['male', 'female']) { const result = await fetch(new URL(manifest.walk[type], url)); if (!result.ok) throw new Error('Walking animation unavailable.'); clips[type] = [await result.json()]; }
    return clips;
  }).catch(error => { walkPromise = null; throw error; });
  return walkPromise;
}
export function loadIdleClip(url = new URL('./animation/rpm-idles.json', import.meta.url)) {
  const load = address => fetch(address).then(response => {
    if (!response.ok) throw new Error(`Standing idle unavailable (${response.status}).`);
    return response.json();
  });
  if (!clipPromise) clipPromise = load(url).then(async manifest => {
    if (!Array.isArray(manifest.male) || !manifest.male.length || !Array.isArray(manifest.female) || !manifest.female.length) throw new Error('Idle library has no body-type pools.');
    const pools = await Promise.all(['male', 'female'].map(type => Promise.all(manifest[type].map(row => load(new URL(row.url, url))))));
    return { male: pools[0], female: pools[1] };
  }).catch(error => { clipPromise = null; throw error; });
  return clipPromise;
}
const reflection = new THREE.Matrix4().makeScale(-1, 1, 1);
const positionOf = matrix => new THREE.Vector3().setFromMatrixPosition(matrix);
const quaternionOf = matrix => { const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); matrix.decompose(p, q, s); return q.normalize(); };
const reflectedQuaternion = q => quaternionOf(reflection.clone().multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(reflection));
// Targets use avatar-local browser axes; the skinning skeleton uses reflected X.
/** Where a WebXR grip sits along the avatar's wrist-to-middle-knuckle line (palm centre). */
export const PALM_FRACTION = .55;
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
// Degrees each joint bends at full curl, knuckle first.
const CURL_DEGREES = { thumb: [15, 35, 45], index: [70, 95, 65], middle: [70, 95, 65], ring: [70, 95, 65], pinky: [70, 95, 65] };
export function createPuppetLayer(family) {
  const bones = new Map(family.skeleton.map(bone => [bone.name, bone])), rest = new Map(family.skeleton.map(bone => [bone.path, new THREE.Matrix4().fromArray(bone.matrix)]));
  const byPath = new Map(family.skeleton.map(bone => [bone.path, bone])), order = [], visited = new Set();
  const visit = bone => { if (visited.has(bone.path)) return; const parent = byPath.get(bone.parent); if (parent) visit(parent); visited.add(bone.path); order.push(bone); }; family.skeleton.forEach(visit);
  const named = (humanName, robotName) => bones.get(family.Family === 'human' ? humanName : robotName);
  const spine = named('spine_01.x', 'Spine'), neck = named('neck.x', 'Neck'), head = named('head.x', 'Head');
  const upperPaths = new Set(spine ? [spine.path] : []);
  for (const bone of order) if (upperPaths.has(bone.parent)) upperPaths.add(bone.path);
  const entries = Object.fromEntries(['head','leftHand','rightHand'].map(name => [name,{weight:0,target:null,position:new THREE.Vector3(),quaternion:new THREE.Quaternion(),curl:Object.fromEntries(FINGERS.map(finger=>[finger,0]))}]));
  let previous = null, reference = new Map(rest);
  const robotLimits = new Map();
  if (family.Family === 'robot') {
    const frame = name => { const bone=bones.get(name),child=bones.get(name==='Spine2'?'Neck':name==='Neck'?'Head':'HeadTop_End'),left=bones.get(name==='Head'?'LeftEye':'LeftShoulder'),right=bones.get(name==='Head'?'RightEye':'RightShoulder'); return anatomicalFrame(positionOf(rest.get(child.path)).sub(positionOf(rest.get(bone.path))),positionOf(rest.get(right.path)).sub(positionOf(rest.get(left.path)))); };
    for(const [name,pitch,roll]of [['Neck',15,12],['Head',25,18]]){const bone=bones.get(name),parent=byPath.get(bone.parent),jointFrame=frame(name),parentFrame=frame(parent.name);robotLimits.set(bone.path,{jointFrame,parentFrame,jointRest:quaternionOf(rest.get(bone.path)),parentRest:quaternionOf(rest.get(parent.path)),restLocal:parentFrame.clone().invert().multiply(jointFrame),pitch:THREE.MathUtils.degToRad(pitch),roll:THREE.MathUtils.degToRad(roll)});}
  }
  // Finger curl: each joint bends about (finger direction x palm normal), stored in the joint's own frame so later joints follow earlier ones.
  const fingerChains = {};
  for (const [side,prefix] of [['l','Left'],['r','Right']]) {
    const hand=named('hand.'+side,prefix+'Hand'),index=named('c_index1.'+side,prefix+'HandIndex1'),middle=named('c_middle1.'+side,prefix+'HandMiddle1'),pinky=named('c_pinky1.'+side,prefix+'HandPinky1'),thumbTip=named('c_thumb3.'+side,prefix+'HandThumb3');
    if(!hand||!index||!middle||!pinky)continue;
    const at=bone=>positionOf(rest.get(bone.path)),wrist=at(hand),normal=at(middle).sub(wrist).cross(at(pinky).sub(at(index))).normalize();
    if(thumbTip&&normal.dot(at(thumbTip).sub(wrist))<0)normal.negate(); // the thumb tip rests on the palm side
    fingerChains[side]=[];
    for(const finger of FINGERS){
      const joints=[1,2,3].map(n=>named('c_'+finger+n+'.'+side,prefix+'Hand'+finger[0].toUpperCase()+finger.slice(1)+n));if(joints.some(joint=>!joint))continue;
      const axis=at(joints[1]).sub(at(joints[0])).normalize().cross(normal);if(!(axis.lengthSq()>.25))continue;axis.normalize();
      fingerChains[side].push({finger,joints:joints.map((bone,i)=>({bone,local:axis.clone().applyQuaternion(quaternionOf(rest.get(bone.path)).invert()),max:THREE.MathUtils.degToRad(CURL_DEGREES[finger][i])}))});
    }
  }
  function limitedHead(current,bone,q){const limit=robotLimits.get(bone.path);if(!limit)return q;const parentFrame=quaternionOf(current.get(bone.parent)).multiply(limit.parentRest.clone().invert()).multiply(limit.parentFrame),jointFrame=q.clone().multiply(limit.jointRest.clone().invert()).multiply(limit.jointFrame),localDelta=parentFrame.clone().invert().multiply(jointFrame).multiply(limit.restLocal.clone().invert()),angles=new THREE.Euler().setFromQuaternion(localDelta,'YXZ');angles.x=THREE.MathUtils.clamp(angles.x,-limit.pitch,limit.pitch);angles.z=THREE.MathUtils.clamp(angles.z,-limit.roll,limit.roll);return parentFrame.multiply(new THREE.Quaternion().setFromEuler(angles)).multiply(limit.restLocal).multiply(limit.jointFrame.clone().invert()).multiply(limit.jointRest).normalize();}
  const finite = values => values.every(Number.isFinite);
  function branch(current, bone, desired, weight) {
    if (!bone || !current.has(bone.path) || weight <= 0) return;
    // Only the moved subtree is copied; cloning every bone per IK step dominated Puppet frame cost.
    const original = current.get(bone.path).clone(), before = new Map([[bone.path, original]]), scale = new THREE.Vector3();
    original.decompose(new THREE.Vector3(),new THREE.Quaternion(),scale);
    current.set(bone.path,new THREE.Matrix4().compose(positionOf(original),quaternionOf(original).slerp(desired,weight),scale));
    for (const child of order) if (before.has(child.parent) && current.has(child.path)) { const old = current.get(child.path).clone(); before.set(child.path, old); current.set(child.path,current.get(child.parent).clone().multiply(before.get(child.parent).clone().invert()).multiply(old)); }
  }
  // Robot binds in A-pose; calibration must use the same true T-pose for both rigs.
  const tPose = new Map([...rest].map(([path,matrix])=>[path,matrix.clone()]));
  for (const [side,prefix] of [['l','Left'],['r','Right']]) {
    const upper=named('arm_stretch.'+side,prefix+'Arm'),lower=named('forearm_stretch.'+side,prefix+'ForeArm'),hand=named('hand.'+side,prefix+'Hand');
    if(!upper||!lower||!hand)continue;
    const sign=Math.sign(positionOf(rest.get(hand.path)).x)|| (side==='l'?-1:1),direction=new THREE.Vector3(sign,0,0);
    for(const [bone,child]of [[upper,lower],[lower,hand]])branch(tPose,bone,new THREE.Quaternion().setFromUnitVectors(positionOf(tPose.get(child.path)).sub(positionOf(tPose.get(bone.path))).normalize(),direction).multiply(quaternionOf(tPose.get(bone.path))),1);
    const index=named('c_index1.'+side,prefix+'HandIndex1'),middle=named('c_middle1.'+side,prefix+'HandMiddle1'),pinky=named('c_pinky1.'+side,prefix+'HandPinky1');
    if(index&&middle&&pinky){const aim=positionOf(tPose.get(middle.path)).sub(positionOf(tPose.get(hand.path))),normal=positionOf(tPose.get(pinky.path)).sub(positionOf(tPose.get(index.path))).cross(aim),desired=anatomicalFrame(direction,new THREE.Vector3(0,-sign,0)).multiply(anatomicalFrame(aim,normal).invert()).multiply(quaternionOf(tPose.get(hand.path)));branch(tPose,hand,desired,1);}
  }
  reference=new Map([...tPose].map(([path,matrix])=>[path,matrix.clone()]));
  // A palm target becomes a wrist goal: step back from the palm by the reference wrist-to-palm offset, turned with the hand.
  function handGoal(entry,side,prefix,hand){
    const middle=entry.palm&&named('c_middle1.'+side,prefix+'HandMiddle1');
    if(!middle||!reference.has(middle.path)||!reference.has(hand.path))return entry.position.clone();
    const wrist=positionOf(reference.get(hand.path)),offset=positionOf(reference.get(middle.path)).sub(wrist).multiplyScalar(PALM_FRACTION);
    return entry.position.clone().sub(offset.applyQuaternion(entry.quaternion));
  }
  const layer = {
    get active() { return Object.values(entries).some(entry=>entry.weight > 1e-5); },
    captureReference(pose) { reference = new Map([...pose].map(([path,matrix])=>[path,matrix.clone()])); },
    referencePose() { return new Map([...tPose].map(([path,matrix])=>[path,matrix.clone()])); },
    setTargets(targets) {
      for (const [name,entry] of Object.entries(entries)) {
        const value = targets?.[name], position = value?.position, q = value?.quaternion;
        if (!position || !q || !finite([position.x,position.y,position.z,q.x,q.y,q.z,q.w]) || q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w < 1e-8) { entry.target=null; continue; }
        const target = {position:new THREE.Vector3(-position.x,position.y,position.z),quaternion:reflectedQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w).normalize()),weight:Number.isFinite(targets.weight ?? 1) ? THREE.MathUtils.clamp(targets.weight ?? 1,0,1) : 0,palm:!!value.palm,curl:Object.fromEntries(FINGERS.map(finger=>[finger,THREE.MathUtils.clamp(Number(value.curl?.[finger])||0,0,1)]))};
        if (!entry.target && entry.weight < 1e-5) { entry.position.copy(target.position); entry.quaternion.copy(target.quaternion); }
        entry.target=target;
      }
    },
    update(seconds) {
      if (!Number.isFinite(seconds)) return;
      const elapsed = previous === null ? 0 : THREE.MathUtils.clamp(seconds-previous,0,.1); previous=seconds;
      const alpha=1-Math.exp(-elapsed*12),fingerAlpha=1-Math.exp(-elapsed*20);
      for(const entry of Object.values(entries)) { for(const finger of FINGERS)entry.curl[finger]=THREE.MathUtils.lerp(entry.curl[finger],entry.target?.curl?.[finger]||0,fingerAlpha); entry.weight=THREE.MathUtils.lerp(entry.weight,entry.target?.weight||0,alpha); if(entry.target){if(Math.abs(entry.weight-entry.target.weight)<1e-4)entry.weight=entry.target.weight;entry.position.lerp(entry.target.position,alpha);entry.quaternion.slerp(entry.target.quaternion,alpha);} }
    },
    apply(current) {
      if (!layer.active) return current;
      // Puppet owns the complete upper body; idle contributes only pelvis and legs.
      const upperWeight = Math.max(...Object.values(entries).map(entry=>entry.weight));
      for (const bone of order) if (upperPaths.has(bone.path)) {
        const original = current.get(bone.path), parent = current.get(bone.parent), refParent = reference.get(bone.parent), neutral = bone === spine ? reference.get(bone.path).clone().setPosition(positionOf(original)) : parent.clone().multiply(refParent.clone().invert()).multiply(reference.get(bone.path)), scale = new THREE.Vector3();
        original.decompose(new THREE.Vector3(),new THREE.Quaternion(),scale);
        current.set(bone.path,new THREE.Matrix4().compose(positionOf(neutral),quaternionOf(original).slerp(quaternionOf(neutral),upperWeight),scale));
      }
      const headEntry=entries.head;
      if(headEntry.weight>1e-5 && spine && neck && head) {
        const a=positionOf(current.get(spine.path)), b=positionOf(current.get(head.path)), requested=headEntry.position.clone().sub(a);
        if(requested.lengthSq()>1e-8){const delta=new THREE.Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(),requested.normalize()),angle=delta.angleTo(new THREE.Quaternion());if(angle>THREE.MathUtils.degToRad(25))delta.slerp(new THREE.Quaternion(),1-THREE.MathUtils.degToRad(25)/angle);const torsoYaw=new THREE.Euler().setFromQuaternion(headEntry.quaternion,'YXZ').y*.3;delta.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.clamp(torsoYaw,-.44,.44)));branch(current,spine,delta.multiply(quaternionOf(current.get(spine.path))),headEntry.weight);}
        const angles=new THREE.Euler().setFromQuaternion(headEntry.quaternion,'YXZ');angles.x=THREE.MathUtils.clamp(angles.x,-.61,.61);angles.y=THREE.MathUtils.clamp(angles.y,-1.22,1.22);angles.z=THREE.MathUtils.clamp(angles.z,-.35,.35);
        const look=new THREE.Quaternion().setFromEuler(angles);
        branch(current,neck,limitedHead(current,neck,new THREE.Quaternion().slerp(look,.25).multiply(quaternionOf(reference.get(neck.path)))),headEntry.weight);
        // Preserve the Robot shell's established neck/head pitch and roll limits.
        if(family.Family==='robot'){angles.x=THREE.MathUtils.clamp(angles.x,-.436,.436);angles.z=THREE.MathUtils.clamp(angles.z,-.314,.314);look.setFromEuler(angles);}
        branch(current,head,limitedHead(current,head,look.multiply(quaternionOf(reference.get(head.path)))),headEntry.weight);
      }
      for (const [name,side,prefix] of [['leftHand','l','Left'],['rightHand','r','Right']]) {
        const entry=entries[name];if(entry.weight<=1e-5)continue;
        const upper=named('arm_stretch.'+side,prefix+'Arm'),lower=named('forearm_stretch.'+side,prefix+'ForeArm'),hand=named('hand.'+side,prefix+'Hand');if(!upper||!lower||!hand)continue;
        const a=positionOf(current.get(upper.path)),b=positionOf(current.get(lower.path)),c=positionOf(current.get(hand.path)),first=a.distanceTo(b),second=b.distanceTo(c),direction=handGoal(entry,side,prefix,hand).sub(a),requested=direction.length();if(requested<1e-8||first<1e-8||second<1e-8)continue;direction.normalize();
        const distance=THREE.MathUtils.clamp(requested,Math.abs(first-second)+1e-5,(first+second)*.985),endpoint=a.clone().addScaledVector(direction,distance);
        const sign=Math.sign(positionOf(rest.get(upper.path)).x)|| (side==='l'?-1:1),pole=new THREE.Vector3(sign*.5,-.6,-.35);pole.addScaledVector(direction,-pole.dot(direction));if(pole.lengthSq()<1e-8)pole.set(0,1,0).addScaledVector(direction,-direction.y);pole.normalize();
        const along=(first*first-second*second+distance*distance)/(2*distance),elbow=a.clone().addScaledVector(direction,along).addScaledVector(pole,Math.sqrt(Math.max(0,first*first-along*along)));
        branch(current,upper,new THREE.Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(),elbow.clone().sub(a).normalize()).multiply(quaternionOf(current.get(upper.path))),entry.weight);
        const newElbow=positionOf(current.get(lower.path)),newHand=positionOf(current.get(hand.path)),aim=endpoint.clone().sub(newElbow);
        if(aim.lengthSq()>1e-10)branch(current,lower,new THREE.Quaternion().setFromUnitVectors(newHand.sub(newElbow).normalize(),aim.normalize()).multiply(quaternionOf(current.get(lower.path))),entry.weight);
        branch(current,hand,entry.quaternion.clone().multiply(quaternionOf(reference.get(hand.path))),entry.weight);
        for(const chain of fingerChains[side]||[]){const amount=entry.curl[chain.finger];if(!(amount>1e-3))continue;for(const joint of chain.joints){const q=quaternionOf(current.get(joint.bone.path));branch(current,joint.bone,new THREE.Quaternion().setFromAxisAngle(joint.local.clone().applyQuaternion(q),amount*joint.max).multiply(q),entry.weight);}}
      }
      return current;
    },
    reset() { previous=null;for(const entry of Object.values(entries)){entry.weight=0;entry.target=null;} },
  };
  return layer;
}
/** Current posed vertex positions for grounding/seating/framing; GPU-skinned items are skinned here only on request. */
/**
 * Procedural wing beat for the Robot's Wing_L/Wing_R roots; Unity ships the wings without animation. Each wing root and
 * everything under it rotates about the spine axis through the root, mirrored left/right, so every wing mesh (rigid
 * child of the root) beats; in the horizontal flying pose that is an up/down stroke. (The torso's forward axis was
 * wrong: in flight it swung the wings toward head and feet.)
 */
export function createWingFlap(family, clock = () => performance.now() / 1000) {
  const find = name => family?.skeleton?.find(bone => bone.name === name)?.path;
  const left = find('Wing_L'), right = find('Wing_R'), spine = find('Spine1'), hips = find('Hips');
  if (!left || !right) return null;
  const rotation = new THREE.Matrix4(), back = new THREE.Matrix4(), delta = new THREE.Matrix4();
  return {
    rate: 2.2, amplitude: THREE.MathUtils.degToRad(34), lift: 0,
    apply(current) {
      const l = current.get(left), r = current.get(right); if (!l || !r) return current;
      const lp = new THREE.Vector3().setFromMatrixPosition(l), rp = new THREE.Vector3().setFromMatrixPosition(r), lateral = lp.clone().sub(rp);
      const top = spine && current.get(spine), base = hips && current.get(hips);
      const up = top && base ? new THREE.Vector3().setFromMatrixPosition(top).sub(new THREE.Vector3().setFromMatrixPosition(base)) : new THREE.Vector3(0, 1, 0);
      const axis = up.normalize().clone().addScaledVector(lateral.normalize(), -up.dot(lateral));
      if (!(axis.lengthSq() > .25)) return current; axis.normalize();
      const angle = this.lift + this.amplitude * Math.sin(clock() * this.rate * 2 * Math.PI);
      for (const [path, sign, pivot] of [[left, 1, lp], [right, -1, rp]]) {
        delta.makeTranslation(pivot.x, pivot.y, pivot.z).multiply(rotation.makeRotationAxis(axis, sign * angle)).multiply(back.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
        for (const [key, matrix] of current) if (key === path || key.startsWith(path + '/')) matrix.premultiply(delta);
      }
      return current;
    }
  };
}
export function posedPositions(item) {
  const attribute = item.geometry.getAttribute('position'), skin = item.skin;
  if (!item.mesh?.isSkinnedMesh || !skin?.base) return attribute.array;
  if (item.posedVersion === skin.version && item.posed) return item.posed;
  const base = skin.base, out = item.posed?.length === base.length ? item.posed : new Float32Array(base.length), matrices = skin.matrices.map(matrix => matrix.elements);
  let influence = 0;
  for (let vertex = 0, offset = 0; offset < base.length; vertex++, offset += 3) {
    const count = item.skinCounts[vertex], x = base[offset], y = base[offset + 1], z = base[offset + 2]; let sx = 0, sy = 0, sz = 0, total = 0;
    for (let k = 0; k < count; k++, influence++) { const weight = item.skinWeights[influence], m = matrices[item.skinIndices[influence]]; if (!weight || !m) continue; sx += weight * (m[0] * x + m[4] * y + m[8] * z + m[12]); sy += weight * (m[1] * x + m[5] * y + m[9] * z + m[13]); sz += weight * (m[2] * x + m[6] * y + m[10] * z + m[14]); total += weight; }
    if (total) { out[offset] = sx / total; out[offset + 1] = sy / total; out[offset + 2] = sz / total; } else { out[offset] = x; out[offset + 1] = y; out[offset + 2] = z; }
  }
  item.posed = out; item.posedVersion = skin.version; return out;
}
function anatomicalFrame(direction, palmNormal) {
  const y = direction.clone().normalize(), x = palmNormal.clone().addScaledVector(y, -palmNormal.dot(y)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y).normalize()));
}
const human = ['spine_01.x', 'spine_02.x', 'spine_03.x', 'neck.x', 'head.x'];
const robot = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];
const torso = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head'];

function mappings(family, fullBody = false) {
  const names = family.Family === 'human' ? human : robot, rows = [];
  names.forEach((name, index) => rows.push([name, torso[index], names[index + 1], torso[index + 1]]));
  if (fullBody) rows.push([family.Family === 'human' ? 'root.x' : 'Hips', 'pelvis', names[0], 'spine_01']);
  for (const side of ['l', 'r']) {
    const prefix = side === 'l' ? 'Left' : 'Right';
    const arm = family.Family === 'human' ? ['shoulder.' + side, 'arm_stretch.' + side, 'forearm_stretch.' + side, 'hand.' + side] : [prefix + 'Shoulder', prefix + 'Arm', prefix + 'ForeArm', prefix + 'Hand'];
    const source = ['clavicle_' + side, 'upperarm_' + side, 'lowerarm_' + side, 'hand_' + side];
    arm.forEach((name, index) => rows.push([name, source[index], arm[index + 1] || (family.Family === 'human' ? `c_middle1.${side}` : `${prefix}HandMiddle1`), source[index + 1] || `middle_01_${side}`]));
    for (const finger of ['index', 'middle', 'ring', 'pinky', 'thumb']) for (let joint = 1; joint <= 3; joint++) {
      const native = family.Family === 'human' ? `c_${finger}${joint}.${side}` : `${prefix}Hand${finger[0].toUpperCase() + finger.slice(1)}${joint}`;
      const child = family.Family === 'human' ? `c_${finger}${joint + 1}.${side}` : `${prefix}Hand${finger[0].toUpperCase() + finger.slice(1)}${joint === 3 ? '3_end' : joint + 1}`;
      rows.push([native, `${finger}_0${joint}_${side}`, child, `${finger}_0${joint + 1}${joint === 3 ? '_leaf' : ''}_${side}`]);
    }
    if (fullBody) {
      const leg = family.Family === 'human' ? [`thigh_stretch.${side}`, `leg_stretch.${side}`, `foot.${side}`, `toes_01.${side}`] : [`${prefix}UpLeg`, `${prefix}Leg`, `${prefix}Foot`, `${prefix}ToeBase`];
      const source = [`thigh_${side}`, `calf_${side}`, `foot_${side}`, `ball_${side}`];
      leg.forEach((name, index) => rows.push([name, source[index], leg[index + 1] || (family.Family === 'robot' ? `${prefix}Toe_End` : null), source[index + 1] || `ball_leaf_${side}`]));
    }
  }
  return rows;
}

function sampled(track, time) {
  const times = track.times, values = track.values;
  if (times.length === 1 || time <= times[0]) return values[0];
  let low = 0, high = times.length - 1;
  while (low + 1 < high) { const mid = (low + high) >> 1; if (times[mid] <= time) low = mid; else high = mid; }
  if (time >= times[high]) return values[high];
  const blend = track.interpolation === 'STEP' ? 0 : (time - times[low]) / (times[high] - times[low]);
  if (track.path === 'rotation') return new THREE.Quaternion().fromArray(values[low]).normalize().slerp(new THREE.Quaternion().fromArray(values[high]).normalize(), blend).toArray();
  return values[low].map((value, axis) => value + (values[high][axis] - value) * blend);
}

function sourceMatrices(clip, time, animated) {
  const poses = clip.nodes.map(node => ({ translation: node.translation, rotation: node.rotation, scale: node.scale }));
  if (animated) for (const track of clip.tracks) poses[track.node][track.path] = sampled(track, time);
  const matrices = [], visit = index => {
    if (matrices[index]) return matrices[index];
    const node = clip.nodes[index], pose = poses[index], local = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(pose.translation), new THREE.Quaternion().fromArray(pose.rotation).normalize(), new THREE.Vector3().fromArray(pose.scale));
    return matrices[index] = node.parent === null ? local : visit(node.parent).clone().multiply(local);
  };
  clip.nodes.forEach((_, index) => visit(index)); return matrices;
}

const legacyIdle = clip => clip.author === 'Quaternius' && !clip.fullBody;
/** Retargets RPM full-body idles with native proportions and sole grounding; A-pose keeps the authored standing solve. */
export function createIdlePlayer(family, config, library, initialClip) {
  const clips = library?.male ? library[config.BodyType === 'female' ? 'female' : 'male'] : [library];
  if (!clips?.length || clips.some(clip => clip?.schemaVersion !== 1 || !(clip.duration > 0) || !Array.isArray(clip.nodes) || !Array.isArray(clip.tracks))) throw new Error('Invalid standing idle clip.');
  if (!['human', 'robot'].includes(family.Family)) throw new Error('Standing idle supports Human and Robot rigs.');
  let clipIndex = clips.findIndex(clip => clip.sourceClip === initialClip); if (clipIndex < 0) clipIndex = Math.floor(Math.random() * clips.length);
  let clip = clips[clipIndex], gaitHeading = null;
  const standing = postureMatrices(family, config), nativeNames = new Map(family.skeleton.map(bone => [bone.name, bone]));
  const calibrations = new Map(), missing = [], originals = new WeakMap(), skeletonOrder = [];
  const indexed = new Map(family.skeleton.map(bone => [bone.path, bone])), visited = new Set();
  function visit(bone) { if (visited.has(bone.path)) return; const parent = indexed.get(bone.parent); if (parent) visit(parent); visited.add(bone.path); skeletonOrder.push(bone); }
  family.skeleton.forEach(visit);
  const footPaths = new Set(family.skeleton.filter(bone => /^(foot\.[lr]|toes_01\.[lr]|LeftFoot|RightFoot|LeftToeBase|RightToeBase)$/.test(bone.name)).map(bone => bone.path));
  const defaultContacts = [...footPaths].map(path => ({ point: positionOf(standing.rest.get(path)), influences: [{ path, inverse: standing.rest.get(path).clone().invert(), weight: 1 }] }));
  let contacts = defaultContacts;
  const localRest = new Map(skeletonOrder.map(bone => [bone.path, indexed.has(bone.parent) ? standing.rest.get(bone.parent).clone().invert().multiply(standing.rest.get(bone.path)) : standing.rest.get(bone.path)]));
  const robotLimits = new Map();
  if (family.Family === 'robot') {
    const frame = name => {
      const child = name === 'Spine2' ? 'Neck' : name === 'Neck' ? 'Head' : 'HeadTop_End', rest = standing.rest.get(nativeNames.get(name).path);
      const direction = positionOf(standing.rest.get(nativeNames.get(child).path)).sub(positionOf(rest));
      const left = name === 'Head' ? 'LeftEye' : 'LeftShoulder', right = name === 'Head' ? 'RightEye' : 'RightShoulder';
      return anatomicalFrame(direction, positionOf(standing.rest.get(nativeNames.get(right).path)).sub(positionOf(standing.rest.get(nativeNames.get(left).path))));
    };
    for (const [name, pitch, roll] of [['Neck', 15, 12], ['Head', 25, 18]]) {
      const bone = nativeNames.get(name), parent = indexed.get(bone.parent), jointFrame = frame(name), parentFrame = frame(parent.name);
      robotLimits.set(bone.path, { jointFrame, parentFrame, jointRest: quaternionOf(standing.rest.get(bone.path)), parentRest: quaternionOf(standing.rest.get(parent.path)), restLocal: parentFrame.clone().invert().multiply(jointFrame), pitch: THREE.MathUtils.degToRad(pitch), roll: THREE.MathUtils.degToRad(roll) });
    }
  }
  function restPose(aPose) {
    const calmRest = new Map();
    for (const bone of skeletonOrder) {
      const parent = calmRest.get(bone.parent), matrix = parent ? parent.clone().multiply(localRest.get(bone.path)) : localRest.get(bone.path).clone();
      const arm = /^(arm_stretch\.[lr]|LeftArm|RightArm)$/.test(bone.name), forearm = /^(forearm_stretch\.[lr]|LeftForeArm|RightForeArm)$/.test(bone.name);
      if (arm || forearm) {
        const childName = family.Family === 'human' ? (arm ? 'forearm_stretch.' : 'hand.') + bone.name.at(-1) : bone.name.replace(arm ? 'Arm' : 'ForeArm', arm ? 'ForeArm' : 'Hand');
        const child = nativeNames.get(childName), nativeRest = standing.rest.get(bone.path), q = quaternionOf(matrix);
        const direction = positionOf(standing.rest.get(child.path)).sub(positionOf(nativeRest)), side = Math.sign(direction.x);
        direction.applyQuaternion(q.clone().multiply(quaternionOf(nativeRest).invert())).normalize();
        const relaxed = new THREE.Vector3(side * (aPose ? 1 : arm ? .14 : .06), -1, aPose ? 0 : arm ? .04 : .20).normalize();
        q.premultiply(new THREE.Quaternion().setFromUnitVectors(direction, relaxed));
        const position = new THREE.Vector3(), scale = new THREE.Vector3(); matrix.decompose(position, new THREE.Quaternion(), scale); matrix.compose(position, q, scale);
      } else if (standing.current.get(bone.path) !== standing.rest.get(bone.path)) matrix.copy(standing.current.get(bone.path));
      calmRest.set(bone.path, matrix);
    }
    return calmRest;
  }
  const calmRest = restPose(false), aRest = restPose(true);
  function selectClip(index) {
    clipIndex = index; clip = clips[index]; calibrations.clear(); missing.length = 0;
    const adapted = legacyIdle(clip), sourceReference = sourceMatrices(clip, 0, adapted), sourceNames = new Map(clip.nodes.map((node, index) => [node.name, index]));
    const palms = new Map();
    if (!adapted) for (const side of ['l', 'r']) {
      const nativeName = finger => family.Family === 'human' ? finger === 'hand' ? `hand.${side}` : `c_${finger}1.${side}` : `${side === 'l' ? 'Left' : 'Right'}Hand${finger === 'hand' ? '' : finger[0].toUpperCase() + finger.slice(1) + '1'}`;
      const nativePoint = finger => positionOf(standing.rest.get(nativeNames.get(nativeName(finger)).path));
      const sourcePoint = finger => { const point = positionOf(sourceReference[sourceNames.get(finger === 'hand' ? `hand_${side}` : `${finger}_01_${side}`)]); point.x *= -1; return point; };
      const frame = point => { const direction = point('middle').sub(point('hand')).normalize(), normal = point('pinky').sub(point('index')).cross(direction).normalize(); return { direction, normal, rotation: anatomicalFrame(direction, normal) }; };
      palms.set(side, { native: frame(nativePoint), source: frame(sourcePoint) });
    }
    const nativeHip = side => positionOf(standing.rest.get(nativeNames.get(family.Family === 'human' ? `thigh_stretch.${side}` : `${side === 'l' ? 'Left' : 'Right'}UpLeg`).path));
    const sourceHip = side => { const point = positionOf(sourceReference[sourceNames.get(`thigh_${side}`)]); point.x *= -1; return point; };
    const nativeAcross = adapted ? null : nativeHip('r').sub(nativeHip('l')).normalize(), sourceAcross = adapted ? null : sourceHip('r').sub(sourceHip('l')).normalize();
    // Directional RPM clips include a sideways baseline heading; input yaw belongs to the right stick.
    gaitHeading=null;
    if(!adapted && /^(walk|run|crouch)(Left|Right|Backward)$/.test(clip.action || '')){const initial=sourceMatrices(clip,0,true),across=positionOf(initial[sourceNames.get('thigh_r')]).sub(positionOf(initial[sourceNames.get('thigh_l')]));across.x*=-1;gaitHeading=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(across.x,0,across.z).normalize(),new THREE.Vector3(nativeAcross.x,0,nativeAcross.z).normalize());}
    for (const [name, sourceName, childName, sourceChild] of mappings(family, !adapted)) {
      const bone = nativeNames.get(name), sourceIndex = sourceNames.get(sourceName);
      if (!bone || sourceIndex === undefined) { missing.push(name); continue; }
      const nativeRest = standing.rest.get(bone.path), virtualRest = quaternionOf(adapted ? calmRest.get(bone.path) : nativeRest);
      const child = nativeNames.get(childName), sourceChildIndex = sourceNames.get(sourceChild), parentRest = standing.rest.get(bone.parent);
      const finger = /^(index|middle|ring|pinky|thumb)_0[123]_[lr]$/.test(sourceName), hand = /^hand_[lr]$/.test(sourceName), palm = palms.get(sourceName.at(-1));
      if (!adapted && (finger || hand)) {
        // Preserve anatomical roll; aim alone leaves unrelated native/source palm and phalanx twists.
        const nativeDirection = hand ? palm.native.direction : child ? positionOf(standing.rest.get(child.path)).sub(positionOf(nativeRest)) : new THREE.Vector3(0, 1, 0).applyQuaternion(quaternionOf(nativeRest));
        const sourceDirection = hand ? palm.source.direction : positionOf(sourceReference[sourceChildIndex]).sub(positionOf(sourceReference[sourceIndex]));
        if (!hand) sourceDirection.x *= -1;
        const nativeFrame = hand ? palm.native.rotation : anatomicalFrame(nativeDirection, palm.native.normal), sourceFrame = hand ? palm.source.rotation : anatomicalFrame(sourceDirection, palm.source.normal);
        virtualRest.premultiply(sourceFrame.clone().multiply(nativeFrame.clone().invert()));
      } else if (!adapted && sourceName === 'Head') {
        const headEnd = nativeNames.get('HeadTop_End'), nativeDirection = headEnd ? positionOf(standing.rest.get(headEnd.path)).sub(positionOf(nativeRest)) : new THREE.Vector3(0, 1, 0).applyQuaternion(quaternionOf(nativeRest));
        const leftEye = nativeNames.get(family.Family === 'human' ? 'c_eye.l' : 'LeftEye'), rightEye = nativeNames.get(family.Family === 'human' ? 'c_eye.r' : 'RightEye');
        const nativeAcross = positionOf(standing.rest.get(rightEye.path)).sub(positionOf(standing.rest.get(leftEye.path)));
        const sourceDirection = positionOf(sourceReference[sourceNames.get('Head_leaf')]).sub(positionOf(sourceReference[sourceIndex])); sourceDirection.x *= -1;
        const sourceAcross = positionOf(sourceReference[sourceNames.get('eye_r')]).sub(positionOf(sourceReference[sourceNames.get('eye_l')])); sourceAcross.x *= -1;
        virtualRest.premultiply(anatomicalFrame(sourceDirection, sourceAcross).multiply(anatomicalFrame(nativeDirection, nativeAcross).invert()));
      } else if (!adapted && /^(pelvis|thigh_[lr]|calf_[lr]|foot_[lr]|ball_[lr])$/.test(sourceName)) {
        const nativeDirection = child ? positionOf(standing.rest.get(child.path)).sub(positionOf(nativeRest)) : new THREE.Vector3(0, 1, 0).applyQuaternion(quaternionOf(nativeRest));
        const sourceDirection = positionOf(sourceReference[sourceChildIndex]).sub(positionOf(sourceReference[sourceIndex])); sourceDirection.x *= -1;
        virtualRest.premultiply(anatomicalFrame(sourceDirection, sourceAcross).multiply(anatomicalFrame(nativeDirection, nativeAcross).invert()));
      } else if (!adapted && (child || parentRest) && sourceChildIndex !== undefined) {
        const nativeDirection = child ? positionOf(standing.rest.get(child.path)).sub(positionOf(nativeRest)) : positionOf(nativeRest).sub(positionOf(parentRest));
        const sourceDirection = positionOf(sourceReference[sourceChildIndex]).sub(positionOf(sourceReference[sourceIndex])); sourceDirection.x *= -1;
        if (nativeDirection.lengthSq() > 1e-10 && sourceDirection.lengthSq() > 1e-10) virtualRest.premultiply(new THREE.Quaternion().setFromUnitVectors(nativeDirection.normalize(), sourceDirection.normalize()));
      }
      const calibration = { sourceIndex, sourceInverse: reflectedQuaternion(quaternionOf(sourceReference[sourceIndex])).invert(), virtualRest };
      if (!adapted && /^ball_[lr]$/.test(sourceName)) {
        // Toe motion is parent-local: world aim calibration otherwise curls even unanimated boot tips.
        const sourceParent = clip.nodes[sourceIndex].parent, sourceFoot = reflectedQuaternion(quaternionOf(sourceReference[sourceParent]));
        const nativeForward = positionOf(nativeRest).sub(positionOf(parentRest)), sourceForward = positionOf(sourceReference[sourceIndex]).sub(positionOf(sourceReference[sourceParent]));
        nativeForward.y = 0; sourceForward.x *= -1; sourceForward.y = 0;
        calibration.toe = { sourceParent, restInverse: sourceFoot.clone().invert().multiply(reflectedQuaternion(quaternionOf(sourceReference[sourceIndex]))).invert(), sourceAxis: new THREE.Vector3(0,1,0).cross(sourceForward.normalize()).normalize().applyQuaternion(sourceFoot.clone().invert()), nativeAxis: new THREE.Vector3(0,1,0).cross(nativeForward.normalize()).normalize().applyQuaternion(quaternionOf(parentRest).invert()) };
      }
      calibrations.set(bone.path, calibration);
    }
  }
  selectClip(clipIndex);
  let phase = 0, previous = null, playing = true, changed = true, aPose = false, transition = null, blendAge = 0, footLock = true, grounded = true, tiptoe = false, blendDuration = .6, poseLayer = null, afterLayer = null, sampling = false, lastLayerActive = false, speed = 1, nativeStanceSpeed = null, gaitSpeed = 1;
  const toeTargets = new Map(); let toeRise = 0;
  for (const side of ['l', 'r']) {
    const prefix = side === 'l' ? 'Left' : 'Right', foot = nativeNames.get(family.Family === 'human' ? `foot.${side}` : `${prefix}Foot`), toe = nativeNames.get(family.Family === 'human' ? `toes_01.${side}` : `${prefix}ToeBase`);
    if (!foot || !toe) continue;
    const ankle = positionOf(standing.current.get(foot.path)), pivot = positionOf(standing.current.get(toe.path)), forward = pivot.clone().sub(ankle); forward.y = 0;
    if (forward.lengthSq() < 1e-10) continue;
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0).cross(forward.normalize()).normalize(), THREE.MathUtils.degToRad(22));
    const target = ankle.clone().sub(pivot).applyQuaternion(turn).add(pivot), rotation = quaternionOf(standing.current.get(foot.path)).premultiply(turn);
    toeTargets.set(foot.path, { target, rotation }); toeRise = Math.max(toeRise, target.y - ankle.y);
  }
  const blendProgress = () => THREE.MathUtils.smoothstep(blendAge, 0, blendDuration);
  function plantFeet(current) {
    let drop = 0;
    for (const side of ['l', 'r']) {
      const prefix = side === 'l' ? 'Left' : 'Right', names = family.Family === 'human' ? [`thigh_stretch.${side}`, `leg_stretch.${side}`, `foot.${side}`] : [`${prefix}UpLeg`, `${prefix}Leg`, `${prefix}Foot`], bones = names.map(name => nativeNames.get(name));
      if (bones.some(bone => !bone)) continue;
      const [a, b, c] = bones.map(bone => positionOf(current.get(bone.path))), target = tiptoe && toeTargets.has(bones[2].path) ? toeTargets.get(bones[2].path).target.clone() : positionOf(standing.current.get(bones[2].path));
      if (transition?.has(bones[2].path)) target.lerpVectors(positionOf(transition.get(bones[2].path)), target, blendProgress());
      const reach = a.distanceTo(b) + b.distanceTo(c) - 1e-6, horizontal = (a.x - target.x) ** 2 + (a.z - target.z) ** 2;
      if (horizontal < reach * reach) drop = Math.max(drop, a.y - target.y - Math.sqrt(reach * reach - horizontal));
    }
    // Lower the pelvis just enough to reach both planted feet without stretching either leg.
    if (drop > 0) for (const matrix of current.values()) matrix.elements[13] -= drop;
    const before = new Map([...current].map(([path, matrix]) => [path, matrix.clone()])), overrides = new Map();
    for (const side of ['l', 'r']) {
      const prefix = side === 'l' ? 'Left' : 'Right', names = family.Family === 'human' ? [`thigh_stretch.${side}`, `leg_stretch.${side}`, `foot.${side}`] : [`${prefix}UpLeg`, `${prefix}Leg`, `${prefix}Foot`];
      const [upper, lower, foot] = names.map(name => nativeNames.get(name));
      if (!upper || !lower || !foot) continue;
      const a = positionOf(before.get(upper.path)), b = positionOf(before.get(lower.path)), c = positionOf(before.get(foot.path));
      const target = tiptoe && toeTargets.has(foot.path) ? toeTargets.get(foot.path).target.clone() : positionOf(standing.current.get(foot.path)); if (transition?.has(foot.path)) target.lerpVectors(positionOf(transition.get(foot.path)), target, blendProgress());
      const first = a.distanceTo(b), second = b.distanceTo(c), direction = target.clone().sub(a), requested = direction.length();
      if (requested < 1e-8 || first < 1e-8 || second < 1e-8) continue;
      direction.normalize();
      const distance = THREE.MathUtils.clamp(requested, Math.abs(first - second) + 1e-6, first + second - 1e-6), endpoint = a.clone().addScaledVector(direction, distance);
      const pole = standingKneePole(direction, (side === 'l' ? -1 : 1) * (config.ToeOut || 0));
      if (transition?.has(lower.path)) {
        const previousPole = positionOf(transition.get(lower.path)).sub(a);
        previousPole.addScaledVector(direction, -previousPole.dot(direction));
        if (previousPole.lengthSq() > 1e-10) pole.lerpVectors(previousPole.normalize(), pole.clone(), blendProgress()).normalize();
      }
      const along = (first * first - second * second + distance * distance) / (2 * distance), knee = a.clone().addScaledVector(direction, along).addScaledVector(pole, Math.sqrt(Math.max(0, first * first - along * along)));
      const solve = (bone, position, turn) => { const matrix = before.get(bone.path), q = quaternionOf(matrix), scale = new THREE.Vector3(); matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale); if (turn) q.premultiply(turn); overrides.set(bone.path, new THREE.Matrix4().compose(position, q, scale)); };
      solve(upper, a, new THREE.Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(), knee.clone().sub(a).normalize()));
      solve(lower, knee, new THREE.Quaternion().setFromUnitVectors(c.clone().sub(b).normalize(), endpoint.clone().sub(knee).normalize()));
      const matrix = before.get(foot.path), scale = new THREE.Vector3(); matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      const footRotation = tiptoe && toeTargets.has(foot.path) ? toeTargets.get(foot.path).rotation.clone() : quaternionOf(standing.current.get(foot.path)); if (transition?.has(foot.path)) footRotation.copy(quaternionOf(transition.get(foot.path))).slerp(tiptoe && toeTargets.has(foot.path) ? toeTargets.get(foot.path).rotation : quaternionOf(standing.current.get(foot.path)), blendProgress());
      const footMatrix = new THREE.Matrix4().compose(endpoint, footRotation, scale);
      overrides.set(foot.path, footMatrix);
      const toe = nativeNames.get(family.Family === 'human' ? `toes_01.${side}` : `${prefix}ToeBase`);
      if (toe) {
        const toeMatrix = footMatrix.clone().multiply(localRest.get(toe.path)), toeRotation = tiptoe ? quaternionOf(standing.current.get(toe.path)) : quaternionOf(toeMatrix);
        if (transition?.has(toe.path)) toeRotation.copy(quaternionOf(transition.get(toe.path))).slerp(tiptoe ? quaternionOf(standing.current.get(toe.path)) : quaternionOf(toeMatrix), blendProgress());
        toeMatrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
        overrides.set(toe.path, new THREE.Matrix4().compose(positionOf(toeMatrix), toeRotation, scale));
      }
    }
    for (const bone of skeletonOrder) {
      if (overrides.has(bone.path)) current.set(bone.path, overrides.get(bone.path));
      else if (before.has(bone.parent)) current.set(bone.path, current.get(bone.parent).clone().multiply(before.get(bone.parent).clone().invert()).multiply(before.get(bone.path)));
    }
  }
  const player = {
    get playing() { return playing; },
    setPlaying(value) { playing = !!value; if (!playing) phase = 0; previous = null; changed = true; },
    get aPose() { return aPose; },
    setAPose(value) { aPose = !!value; previous = null; transition = null; changed = true; },
    setPoseLayer(value) { poseLayer = value; changed = true; },
    setAfterLayer(value) { afterLayer = value || null; changed = true; },
    setFootLock(value) { footLock = !!value; changed = true; },
    setGrounded(value) { grounded = !!value; changed = true; },
    setTiptoe(value) { tiptoe = !!value; changed = true; },
    blendFrom(pose, duration = .6) { transition = pose; blendAge = 0; blendDuration = THREE.MathUtils.clamp(duration, .06, 1); changed = true; },
    setSpeed(value) { speed = THREE.MathUtils.clamp(Number(value) || 1, .1, 2); },
    calibrateGaitSpeed(rootSpeed) {
      const names = clip.nativeCrawlPose ? (family.Family === 'human' ? ['hand.l', 'hand.r'] : ['LeftHand', 'RightHand']) : (family.Family === 'human' ? ['foot.l', 'foot.r'] : ['LeftFoot', 'RightFoot']), paths = names.map(name => nativeNames.get(name)?.path);
      const travel = clip.sourceTravelVector ? new THREE.Vector3(-clip.sourceTravelVector[0], 0, clip.sourceTravelVector[2]) : new THREE.Vector3(0, 0, 1);
      if(travel.lengthSq()<1e-6)travel.set(0,0,1);else travel.normalize();
      if (paths.some(path => !path)) throw new Error('Native gait feet unavailable.');
      const samples = [], count = 240, interval = clip.duration / count;
      const savedSampling = sampling;
      try { sampling = true; for (let i = 0; i <= count; i++) { const current = player.pose(i * interval); samples.push(paths.map(path => positionOf(current.get(path)))); } }
      finally { sampling = savedSampling; }
      const velocities = [];
      for (let side = 0; side < 2; side++) {
        const low = Math.min(...samples.map(sample => sample[side].y));
        for (let i = 1; i < samples.length; i++) { const a = samples[i - 1][side], b = samples[i][side], velocity = b.clone().sub(a).dot(travel) / interval; if (b.y <= low + .025 && b.y <= samples[i][1 - side].y && velocity < -.01) velocities.push(-velocity); }
      }
      velocities.sort((a, b) => a - b); nativeStanceSpeed = velocities[Math.floor(velocities.length / 2)];
      if (!(nativeStanceSpeed > 0) || !Number.isFinite(rootSpeed) || rootSpeed <= 0) throw new Error('Native gait speed unavailable.');
      player.setSpeed(rootSpeed / nativeStanceSpeed); gaitSpeed = speed; return nativeStanceSpeed;
    },
    setGaitStrength(value) { if (nativeStanceSpeed) speed = gaitSpeed * THREE.MathUtils.clamp(Number(value) || 0, 0, 1); },
    setGaitVelocity(value) { if (nativeStanceSpeed && Number.isFinite(value)) speed = THREE.MathUtils.clamp(value / nativeStanceSpeed, 0, 8); },
    get phase() { return phase; },
    set phase(value) { phase = ((Number(value) || 0) % clip.duration + clip.duration) % clip.duration; changed = true; },
    get report() { return { source: clip.sourceClip, author: clip.author, license: clip.license, duration: clip.duration / (legacyIdle(clip) ? .28 : 1), poolSize: clips.length, bodyType: config.BodyType, mappedBones: calibrations.size, missingBones: [...missing], plantedFeet: footLock, fullBody: !legacyIdle(clip), groundedFeet: grounded, rootMotion: false, nativeStanceSpeed, playbackSpeed: speed, anatomicalHeadLimits: family.Family === 'robot' && !legacyIdle(clip), aPose }; },
    capture(item) {
      const attributes = {};
      for (const name of ['position', 'normal', 'tangent']) { const attribute = item.geometry.getAttribute(name); if (attribute) attributes[name] = attribute.array.slice(); }
      const inverse = (item.definition.bones || []).map(bone => new THREE.Matrix4().fromArray(bone.inverse));
      let rigidParent = null;
      if (!inverse.length || !item.skinCounts?.length) {
        let ancestor = item.definition.path?.split('/').slice(0, -1).join('/');
        while (ancestor) { if (standing.rest.has(ancestor)) { rigidParent = ancestor; break; } ancestor = ancestor.split('/').slice(0, -1).join('/'); }
      }
      const soleContacts = [];
      if (attributes.position && item.skinCounts?.length) {
        let influence = 0;
        for (let vertex = 0; vertex < item.skinCounts.length; vertex++) {
          const count = item.skinCounts[vertex], influences = []; let footWeight = 0;
          for (let k = 0; k < count; k++, influence++) {
            const index = item.skinIndices[influence], bone = item.definition.bones[index], weight = item.skinWeights[influence];
            if (bone && weight) { influences.push({ path: bone.path, inverse: inverse[index], weight }); if (footPaths.has(bone.path)) footWeight += weight; }
          }
          if (footWeight > .5 || /^(shoes_|RobotShoe)/.test(item.definition.name)) { const point = new THREE.Vector3().fromArray(attributes.position, vertex * 3); point.x *= -1; soleContacts.push({ point, influences }); }
        }
      }
      originals.set(item, { attributes, inverse, rigidParent, rigidInverse: rigidParent ? standing.rest.get(rigidParent).clone().invert() : null, soleContacts }); changed = true;
    },
    pose(time = phase) {
      if (aPose) return aRest;
      const source = sourceMatrices(clip, time, true), current = new Map();
      for (const bone of skeletonOrder) {
        // Native local translations preserve segment lengths; RPM contributes rotations, not source scale/root drift.
        const calibration = calibrations.get(bone.path), parent = current.get(bone.parent);
        const matrix = parent ? parent.clone().multiply(localRest.get(bone.path)) : localRest.get(bone.path).clone();
        if (!parent) {
          if (tiptoe) matrix.elements[13] += toeRise;
          if (transition?.has(bone.path)) { const position = positionOf(transition.get(bone.path)).lerp(positionOf(matrix), blendProgress()); matrix.setPosition(position); }
        }
        if (calibration) {
          const delta = reflectedQuaternion(quaternionOf(source[calibration.sourceIndex])).multiply(calibration.sourceInverse).normalize();
          const q = new THREE.Quaternion().slerp(delta, legacyIdle(clip) ? .12 : 1).multiply(calibration.virtualRest).normalize();
          if (calibration.toe) {
            const toe = calibration.toe, localDelta = reflectedQuaternion(quaternionOf(source[toe.sourceParent])).invert().multiply(reflectedQuaternion(quaternionOf(source[calibration.sourceIndex]))).multiply(toe.restInverse).normalize();
            if (localDelta.w < 0) localDelta.set(-localDelta.x, -localDelta.y, -localDelta.z, -localDelta.w);
            const bend = footLock ? 0 : THREE.MathUtils.clamp(2 * Math.atan2(new THREE.Vector3(localDelta.x,localDelta.y,localDelta.z).dot(toe.sourceAxis), localDelta.w), -THREE.MathUtils.degToRad(25), THREE.MathUtils.degToRad(25));
            q.copy(quaternionOf(parent)).multiply(new THREE.Quaternion().setFromAxisAngle(toe.nativeAxis, bend)).multiply(quaternionOf(localRest.get(bone.path))).normalize();
          } else if (gaitHeading && !/^(thigh_stretch\.[lr]|leg_stretch\.[lr]|(Left|Right)(UpLeg|Leg))$/.test(bone.name)) q.premultiply(gaitHeading);
          if (transition) { const target = q.clone(); q.copy(quaternionOf(transition.get(bone.path))).slerp(target, blendProgress()); }
          const limit = !legacyIdle(clip) && robotLimits.get(bone.path);
          if (limit) {
            // The bulky Robot shell needs bounded pitch/roll in actual head/neck anatomical frames; yaw remains expressive.
            const parentFrame = quaternionOf(parent).multiply(limit.parentRest.clone().invert()).multiply(limit.parentFrame);
            const jointFrame = q.clone().multiply(limit.jointRest.clone().invert()).multiply(limit.jointFrame);
            const localDelta = parentFrame.clone().invert().multiply(jointFrame).multiply(limit.restLocal.clone().invert()), angles = new THREE.Euler().setFromQuaternion(localDelta, 'YXZ');
            angles.x = THREE.MathUtils.clamp(angles.x, -limit.pitch, limit.pitch); angles.z = THREE.MathUtils.clamp(angles.z, -limit.roll, limit.roll);
            q.copy(parentFrame).multiply(new THREE.Quaternion().setFromEuler(angles)).multiply(limit.restLocal).multiply(limit.jointFrame.clone().invert()).multiply(limit.jointRest).normalize();
          }
          const p = positionOf(matrix), s = new THREE.Vector3(); matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), s); matrix.compose(p, q, s);
        } else if (legacyIdle(clip) && standing.current.get(bone.path) !== standing.rest.get(bone.path)) matrix.copy(standing.current.get(bone.path));
        current.set(bone.path, matrix);
      }
      if (footLock && !legacyIdle(clip)) plantFeet(current);
      if (grounded && !legacyIdle(clip)) {
        const matrices = new Map(), point = new THREE.Vector3(); let lowest = Infinity, baseline = Infinity;
        for (const contact of contacts) {
          let y = 0, total = 0;
          for (const influence of contact.influences) {
            if (!current.has(influence.path)) continue;
            let matrix = matrices.get(influence.inverse); if (!matrix) { matrix = current.get(influence.path).clone().multiply(influence.inverse); matrices.set(influence.inverse, matrix); }
            y += point.copy(contact.point).applyMatrix4(matrix).y * influence.weight; total += influence.weight;
          }
          if (total) { lowest = Math.min(lowest, y / total); baseline = Math.min(baseline, contact.point.y); }
        }
        if (Number.isFinite(lowest)) for (const matrix of current.values()) matrix.elements[13] += baseline - lowest;
      }
      const layered = !sampling && poseLayer?.active ? poseLayer.apply(current) : current;
      return !sampling && afterLayer ? afterLayer.apply(layered) : layered;
    },
    sampleGeometry(time, items) {
      const state={phase,previous,playing,changed,aPose,transition,blendAge,blendDuration,contacts,sampling,lastLayerActive};
      try { sampling=true;phase=time;previous=null;playing=false;changed=true;aPose=false;transition=null;player.update(0,items); }
      finally { ({phase,previous,playing,changed,aPose,transition,blendAge,blendDuration,contacts,sampling,lastLayerActive}=state); }
    },
    update(seconds, items) {
      if (!Number.isFinite(seconds)) return;
      const elapsed = previous === null ? 0 : Math.max(0, Math.min(.1, seconds - previous)); previous = seconds;
      if (transition && !aPose) { blendAge += elapsed; changed = true; if (blendAge >= blendDuration) transition = null; }
      if (playing && !aPose) {
        phase += elapsed * (legacyIdle(clip) ? .28 : 1) * speed;
        if (phase >= clip.duration) {
          transition = clips.length > 1 ? player.pose(clip.duration) : null;
          phase %= clip.duration; blendAge = 0;
          if (clips.length > 1) { const next = Math.floor(Math.random() * (clips.length - 1)); selectClip(next >= clipIndex ? next + 1 : next); phase = Math.min(phase, clip.duration); }
        }
      }
      if (poseLayer?.active || lastLayerActive) changed = true;
      lastLayerActive = !!poseLayer?.active;
      if ((!playing || aPose) && !changed) return;
      const capturedContacts = items.flatMap(item => originals.get(item)?.soleContacts || []); contacts = capturedContacts.length ? capturedContacts : defaultContacts;
      const pose = player.pose();
      for (const item of items) {
        const saved = originals.get(item); if (!saved) continue;
        const matrices = (item.definition.bones || []).map((bone, index) => reflection.clone().multiply((pose.get(bone.path) || new THREE.Matrix4().fromArray(bone.matrix)).clone().multiply(saved.inverse[index])).multiply(reflection));
        const skeleton = item.mesh?.isSkinnedMesh ? item.mesh.skeleton : null;
        if (skeleton && matrices.length) {
          // GPU skinning: upload bone matrices only; CPU positions are skinned lazily by posedPositions().
          for (let index = 0; index < matrices.length; index++) matrices[index].toArray(skeleton.boneMatrices, index * 16);
          skeleton.boneTexture.needsUpdate = true; item.skin = { matrices, base: saved.attributes.position, version: ++skinVersion };
          continue;
        }
        const normalMatrices = matrices.map(matrix => new THREE.Matrix3().getNormalMatrix(matrix).elements);
        // Exported rigid vertices already include sourceMatrix in root space. Apply only their parent pose delta.
        const rigidMatrix = saved.rigidParent ? reflection.clone().multiply(pose.get(saved.rigidParent).clone().multiply(saved.rigidInverse)).multiply(reflection) : null;
        const rigidNormal = rigidMatrix ? new THREE.Matrix3().getNormalMatrix(rigidMatrix) : null;
        for (const name of ['position', 'normal', 'tangent']) {
          const attribute = item.geometry.getAttribute(name), base = saved.attributes[name]; if (!attribute || !base) continue;
          const target = attribute.array, size = attribute.itemSize;
          if (!matrices.length || !item.skinCounts?.length) {
            target.set(base);
            if (rigidMatrix) {
              const vector = new THREE.Vector3();
              for (let offset = 0; offset < base.length; offset += size) {
                vector.fromArray(base, offset);
                if (name === 'position') vector.applyMatrix4(rigidMatrix); else vector.applyMatrix3(rigidNormal).normalize();
                target[offset] = vector.x; target[offset + 1] = vector.y; target[offset + 2] = vector.z;
              }
            }
            attribute.needsUpdate = true; continue;
          }
          let influence = 0;
          for (let vertex = 0; vertex < attribute.count; vertex++) {
            const offset = vertex * size, count = item.skinCounts[vertex], x = base[offset], y = base[offset + 1], z = base[offset + 2];
            let sx = 0, sy = 0, sz = 0, total = 0;
            for (let k = 0; k < count; k++, influence++) {
              const index = item.skinIndices[influence], weight = item.skinWeights[influence]; if (!weight || !matrices[index]) continue;
              const m = name === 'position' ? matrices[index].elements : normalMatrices[index];
              if (name === 'position') { sx += weight * (m[0] * x + m[4] * y + m[8] * z + m[12]); sy += weight * (m[1] * x + m[5] * y + m[9] * z + m[13]); sz += weight * (m[2] * x + m[6] * y + m[10] * z + m[14]); }
              else { sx += weight * (m[0] * x + m[3] * y + m[6] * z); sy += weight * (m[1] * x + m[4] * y + m[7] * z); sz += weight * (m[2] * x + m[5] * y + m[8] * z); }
              total += weight;
            }
            if (!total) { target[offset] = x; target[offset + 1] = y; target[offset + 2] = z; continue; }
            const divisor = name === 'position' ? total : Math.hypot(sx, sy, sz) || 1;
            target[offset] = sx / divisor; target[offset + 1] = sy / divisor; target[offset + 2] = sz / divisor;
            if (size === 4) target[offset + 3] = base[offset + 3];
          }
          attribute.needsUpdate = true;
        }
        item.geometry.computeBoundingSphere();
      }
      changed = false;
    },
    dispose() { previous = null; playing = false; },
  };
  return player;
}

