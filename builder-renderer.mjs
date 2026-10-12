import * as THREE from 'three';
import { PALM_FRACTION, loadWalkClips, loadSeatClips, loadActionClips, loadPostureClips, loadFullMovementClip, createPuppetLayer, createWingFlap, posedPositions } from './builder-animation.mjs?v=594b31c0b38e';
import { OrbitControls } from './libs/three/package/examples/jsm/controls/OrbitControls.js';
import { assetBytes, assetPath, typedArray, cachedLoad } from './builder-assets.mjs?v=07aeffe3c350';
import { createMaterial, updateMaterial, loadTexture, releaseUnusedTextures } from './builder-shaders.mjs?v=89f98db27c04';
import { coverageFor, cullTriangles } from './builder-model.mjs?v=2776b8514534';
import { postureMatrices, skinPosture } from './builder-posture.mjs?v=8f0df2f7d92d';

const reflect = (source, size = 3) => { const value = Float32Array.from(source); for (let i = 0; i < value.length; i += size) value[i] *= -1; if (size === 4) for (let i = 3; i < value.length; i += 4) value[i] *= -1; return value; };
export function seatedBodyContact(pelvis, positions) {
  let underside = Infinity;
  // Rear body only: garment hems and forward thighs must not determine chair contact.
  for (let i = 0; i < (positions?.length || 0); i += 3) {
    const x = positions[i] - pelvis.x, y = positions[i + 1] - pelvis.y, z = positions[i + 2] - pelvis.z;
    if (Math.abs(x) < .18 && z > -.2 && z < -.04 && y > -.22 && y < .08) underside = Math.min(underside, positions[i + 1]);
  }
  const point = pelvis.clone();
  // One centimetre allows cushion/close-fitting cloth clearance; loose garments are not chair collision geometry.
  point.y = Number.isFinite(underside) ? underside - .01 : pelvis.y - .07;
  return point;
}
/** GPU skin for native Unity weights (max 4 per vertex). Bone matrices are written by the animation player; zero-weight vertices use an extra identity bone like the CPU path. */
export function gpuSkeleton(geometry, definition, counts, indices, weights) {
  const boneCount = definition.bones?.length || 0, vertexCount = geometry.getAttribute('position').count;
  if (!boneCount || counts?.length !== vertexCount || !indices?.length || !weights?.length) return null;
  const skinIndex = new Uint16Array(vertexCount * 4), skinWeight = new Float32Array(vertexCount * 4);
  let influence = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const count = counts[vertex], at = vertex * 4; let total = 0;
    if (count > 4) return null;
    for (let k = 0; k < count; k++, influence++) { const weight = weights[influence]; if (!weight || indices[influence] >= boneCount) continue; skinIndex[at + k] = indices[influence]; skinWeight[at + k] = weight; total += weight; }
    if (total > 0) for (let k = 0; k < 4; k++) skinWeight[at + k] /= total; else { skinIndex[at] = boneCount; skinWeight[at] = 1; }
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const bones = Array.from({ length: boneCount + 1 }, () => new THREE.Bone()), skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
  for (let i = 0; i < bones.length; i++) new THREE.Matrix4().toArray(skeleton.boneMatrices, i * 16);
  skeleton.computeBoneTexture(); skeleton.update = () => {};
  return skeleton;
}
export function focusSlice(kind, h, floor, head, eyes, neck, top) {
  h = Math.max(.4, h);
  if (kind === 'Head') { let above = Math.min(h * .45, Math.max(h * .10, top - head + h * .045)), below = h * .09; if (above > h * .21) below = Math.max(below, above - 2 * (eyes - head)); return { center: head + (above - below) / 2, height: above + below, width: h * .20, anchor: 1 }; }
  if (kind === 'Face') return { center: eyes - h * .015, height: h * .20, width: h * .155, anchor: 1 };
  if (kind === 'Bust') return { center: neck - h * .04, height: h * .36, width: h * .32, anchor: 0 };
  if (kind === 'Feet') return { center: floor + h * .105, height: h * .27, width: h * .31, anchor: -1 };
  return { center: floor + h * .52, height: h * 1.1, width: h * .45, anchor: 0 };
}
export function standingHeight(headY, geometryTop, rootY = 0) {
  const fromHead = Number.isFinite(headY) ? headY - rootY + .18 : 0;
  return fromHead > .4 ? fromHead : Math.max(.4, geometryTop - rootY);
}
export function morphMix(frames, weight) {
  if (!frames.length || weight === 0) return [];
  const points = [{ weight: 0, frame: null }, ...frames.map(frame => ({ weight: frame.weight, frame }))].sort((a, b) => a.weight - b.weight);
  let upper = points.findIndex(point => point.weight >= weight); if (upper < 0) upper = points.length - 1; if (!upper) upper = 1;
  const a = points[upper - 1], b = points[upper], span = b.weight - a.weight;
  if (!span) return b.frame ? [[b.frame, 1]] : [];
  const t = (weight - a.weight) / span;
  return [[a.frame, 1 - t], [b.frame, t]].filter(([frame, amount]) => frame && amount);
}
export function correctLegacyBakedScale(definition, positions, normals, tangents, morphs) {
  if (!definition.skinned || definition.bakedScaleExcluded || !definition.sourceMatrix) return false;
  const source = new THREE.Matrix4().fromArray(definition.sourceMatrix), origin = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  if (!source.elements.every(Number.isFinite) || ![0, 4, 8].every(at => Math.hypot(...source.elements.slice(at, at + 3)) > 1e-8) || source.determinant() === 0) throw new Error('Invalid baked renderer scale: ' + definition.name);
  source.decompose(origin, rotation, scale);
  if ([scale.x, scale.y, scale.z].every(value => Math.abs(value - 1) < 1e-6)) return false;
  if (![scale.x, scale.y, scale.z].every(value => Number.isFinite(value) && Math.abs(value) > 1e-8)) throw new Error('Invalid baked renderer scale: ' + definition.name);
  // BakeMesh excludes renderer scale; the legacy exporter applied it again in root space.
  const reflection = new THREE.Matrix4().makeScale(-1, 1, 1), correction = reflection.clone().multiply(new THREE.Matrix4().compose(origin, rotation, new THREE.Vector3(1, 1, 1))).multiply(source.clone().invert()).multiply(reflection);
  const linear = new THREE.Matrix3().setFromMatrix4(correction), normalMatrix = new THREE.Matrix3().getNormalMatrix(correction), vector = new THREE.Vector3();
  const oldNormals = normals?.slice(), oldTangents = tangents?.slice();
  for (let i = 0; i < positions.length; i += 3) vector.fromArray(positions, i).applyMatrix4(correction).toArray(positions, i);
  for (const [values, stride, matrix] of [[normals, 3, normalMatrix], [tangents, 4, linear]]) if (values) for (let i = 0; i < values.length; i += stride) vector.fromArray(values, i).applyMatrix3(matrix).normalize().toArray(values, i);
  for (const morph of morphs) for (const frame of morph.frames) {
    if (frame.positions) for (let i = 0; i < frame.positions.length; i += 3) vector.fromArray(frame.positions, i).applyMatrix3(linear).toArray(frame.positions, i);
    for (const [delta, oldBase, newBase, stride, matrix] of [[frame.normals, oldNormals, normals, 3, normalMatrix], [frame.tangents, oldTangents, tangents, 4, linear]]) if (delta && oldBase) for (let vertex = 0; vertex < delta.length / 3; vertex++) {
      const at = vertex * 3, baseAt = vertex * stride;
      vector.set(oldBase[baseAt] + delta[at], oldBase[baseAt + 1] + delta[at + 1], oldBase[baseAt + 2] + delta[at + 2]).applyMatrix3(matrix).normalize();
      delta[at] = vector.x - newBase[baseAt]; delta[at + 1] = vector.y - newBase[baseAt + 1]; delta[at + 2] = vector.z - newBase[baseAt + 2];
    }
  }
  return true;
}
export class AvatarRenderer {
  constructor(element, data) {
    this.element = element; this.data = data; this.cache = new Map(); this.instances = new Map(); this.materials = new Map(); this.materialInstances = new Map(); this.token = 0; this.report = []; this.active = []; this.view = 'threequarter'; this.focusKind = 'Body'; this.idlePlaying = true; this.gpuSkinning = !new URLSearchParams(globalThis.location?.search || '').has('cpu-skinning');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1;
    element.append(this.renderer.domElement); this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#20242d');
    this.camera = new THREE.PerspectiveCamera(34, 1, .01, 200); this.camera.position.set(2.5, 1.5, -4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true; this.controls.minDistance = .1; this.controls.maxDistance = 30; this.controls.target.set(0, 1, 0); this.controls.addEventListener('start', () => { this.follow = null; });
    this.controls.listenToKeyEvents(element);
    element.addEventListener('keydown', event => { if (event.key === 'Home' && !this.ar?.session) { event.preventDefault(); this.focus('Body'); this.frame(); } });
    // Metallic details need an environment reflection as well as direct lights.
    const studio = new THREE.Scene(); studio.background = new THREE.Color('#a9adb5');
    const environment = new THREE.PMREMGenerator(this.renderer); this.environment = environment.fromScene(studio, .04); environment.dispose(); this.scene.environment = this.environment.texture; this.scene.environmentIntensity = .45;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x726b60, 2.2));
    const key = new THREE.DirectionalLight(0xfff7e8, 3.1); key.position.set(-3, 5, -4); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbe8ff, 1.4); fill.position.set(3, 3, 2); this.scene.add(fill);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.wireMaterial = new THREE.MeshBasicMaterial({ color: 0x181d20, wireframe: true, transparent: true, opacity: .34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    this.cutMaterial = new THREE.MeshBasicMaterial({ color: 0xe644aa, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide });
    new ResizeObserver(() => this.resize()).observe(element); this.resize();
    this.renderer.setAnimationLoop((time, frame) => { this.ar?.update(frame, time / 1000); this.puppetLayer?.update(time / 1000); this.renderFrame = (this.renderFrame || 0) + 1; if (this.renderFrame % (this.animationStride || 1) === 0) this.animationPlayer()?.update(time / 1000, this.active); this.ar?.refreshPoseGround?.(); if (!this.ar?.session) { this.followHead(); this.controls.update(); } this.renderer.render(this.scene, this.camera); });
  }
  puppetReference() {
    const family = this.currentFamily, pose = this.puppetLayer?.referencePose();
    if (!pose || !family || !this.puppetLayer) return null;
    this.puppetLayer.reset(); this.puppetLayer.captureReference(pose);
    const result = {height:standingHeight(family.skeleton.find(bone=>bone.name===(family.Family==='human'?'head.x':'Head'))?.matrix[13],this.bounds?.max.y||1.7),signature:this.idleSignature};
    const reflection=new THREE.Matrix4().makeScale(-1,1,1);
    const browserPoint=(human,robot)=>{const bone=family.skeleton.find(row=>row.name===(family.Family==='human'?human:robot)),matrix=bone&&pose.get(bone.path);return matrix?new THREE.Vector3().setFromMatrixPosition(matrix).multiply(new THREE.Vector3(-1,1,1)):null;};
    for(const [name,human,robot]of [['head','head.x','Head'],['leftHand','hand.l','LeftHand'],['rightHand','hand.r','RightHand']]){const bone=family.skeleton.find(row=>row.name===(family.Family==='human'?human:robot)),matrix=bone&&pose.get(bone.path);if(!matrix)return null;const reflected=reflection.clone().multiply(matrix).multiply(reflection),position=new THREE.Vector3(),quaternion=new THREE.Quaternion();reflected.decompose(position,quaternion,new THREE.Vector3());result[name]={position,quaternion:quaternion.normalize()};
      if(name==='head')continue;
      // WebXR grip frame a controller would have in this T-pose hand: -Z toward the thumb, +Y up the arm, +X out of the right hand's back (-X for the left).
      const side=name==='leftHand'?'l':'r',prefix=side==='l'?'Left':'Right',middle=browserPoint('c_middle1.'+side,prefix+'HandMiddle1'),index=browserPoint('c_index1.'+side,prefix+'HandIndex1'),pinky=browserPoint('c_pinky1.'+side,prefix+'HandPinky1');
      if(!middle||!index||!pinky)continue;
      // WebXR grips sit in the palm, not at the wrist; Puppet tracks this palm point so turning a hand cannot swing the wrist inward.
      result[name].palm=position.clone().lerp(middle,PALM_FRACTION);
      const aim=middle.sub(position).normalize(),across=index.sub(pinky);across.addScaledVector(aim,-across.dot(aim)).normalize();
      if(!aim.toArray().concat(across.toArray()).every(Number.isFinite)||across.lengthSq()<.5)continue;
      const back=side==='l'?across.clone().cross(aim):aim.clone().cross(across),x=side==='l'?back.negate():back;
      result[name].grip=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,aim.clone().negate(),across.clone().negate())).normalize();}
    return result;
  }
  setPuppetMode(value) {
    if(this.puppetMode===!!value)return;
    const previous=this.animationPlayer()?.pose();this.puppetMode=!!value;
    const player=this.animationPlayer();player?.setPlaying(this.idlePlaying);if(previous)player?.blendFrom(previous,.3);player?.update(performance.now()/1000,this.active);
  }
  setPuppetTargets(targets) { this.puppetLayer?.setTargets(this.aPose || ['crawl','stretch','fly','jump'].includes(this.motionAction) ? null : targets); }
  locomotionKey(mode) { if(mode==='fly')return 'fly'+({forward:'Forward',backward:'Backward',left:'Left',right:'Right',up:'Up',down:'Down'}[this.gaitDirection||'forward']); return ['walk','run','crouch'].includes(mode) && ['backward','left','right'].includes(this.gaitDirection) ? mode + ({backward:'Backward',left:'Left',right:'Right'}[this.gaitDirection]) : mode; }
  locomotionPlayer(mode) { if (mode === 'crouch' && this.crouchMoving === false) return this.actionPlayers?.crouchIdle; if (mode === 'crawl' && this.crawlMoving === false) return this.actionPlayers?.crawlIdle; if (mode === 'fly' && this.flightMoving === false) return this.actionPlayers?.flyIdle; return this.actionPlayers?.[this.locomotionKey(mode)] || (mode === 'walk' ? this.walkPlayer : null); }
  animationPlayer() { return this.puppetMode && !this.sitting && !['crawl','stretch','fly','jump'].includes(this.motionAction) ? this.idlePlayer : this.sitting ? (this.seatMode === 'floor' ? this.floorSeatPlayer : this.seatPlayer) : this.motionAction ? this.locomotionPlayer(this.motionAction) : this.walking ? this.locomotionPlayer('walk') : this.idlePlayer; }
  async prepareLocomotion(mode, direction = 'forward') {
    if (!['walk','run','crouch','crawl','fly'].includes(mode) || !(mode==='fly'?['forward','backward','left','right','up','down']:['forward','backward','left','right']).includes(direction)) throw new Error('Unknown movement.');
    if (direction !== 'forward' && ['walk','run','crouch'].includes(mode)) return this.prepareAction(mode + ({backward:'Backward',left:'Left',right:'Right'}[direction]));
    return mode === 'walk' ? this.prepareWalking() : this.prepareAction(mode);
  }
  setGaitDirection(direction) {
    if (!['forward','backward','left','right','up','down'].includes(direction) || direction === this.gaitDirection) return;
    const old = this.animationPlayer(), previous = old?.pose(); this.gaitDirection = direction; const player = this.animationPlayer();
    if (player && player !== old) { player.setPlaying(old?.playing ?? true); if (old) player.phase = old.phase / old.report.duration * player.report.duration; if (previous) player.blendFrom(previous); player.update(performance.now()/1000,this.active); }
  }
  async prepareAction(name) {
    if (!/^(run|jump|crouch|crouchIdle|stretch|crawl|crawlIdle|fly|flyIdle|fly(Forward|Backward|Left|Right|Up|Down)|(walk|run|crouch)(Backward|Left|Right))$/.test(name) || !this.idleFactory || !this.currentFamily) throw new Error('Wait for the avatar animation to load.');
    const signature = this.idleSignature, family = this.currentFamily, config = this.currentConfig, library = name === 'stretch' ? await loadPostureClips() : /^(run|jump|crouch|crouchIdle)$/.test(name) ? await loadActionClips() : await loadFullMovementClip(name);
    if (signature !== this.idleSignature || family !== this.currentFamily) return false;
    this.actionPlayers ||= {}; this.actionClips = {...this.actionClips, ...library};
    if (!this.actionPlayers[name]) {
      const player = this.actionPlayers[name] = this.idleFactory(family, config, library[name]);
      player.setPoseLayer(this.puppetLayer); if (/^fly/.test(name)) { if (this.wingFamily !== family) { this.wingFamily = family; this.wingFlap = createWingFlap(family); } player.setAfterLayer(this.wingFlap); } player.setFootLock(name === 'stretch'); player.setTiptoe(name === 'stretch'); player.setGrounded(!/^(crawl|fly)/.test(name)); player.setPlaying(false);
      if (/^(walk|run|crouch)(Backward|Left|Right)?$/.test(name) || name === 'crawl') player.calibrateGaitSpeed(library[name][config.BodyType]?.[0]?.nativeWalkSpeed || (name.startsWith('run') ? 1.5 : name.startsWith('crouch') ? .28 : name === 'crawl' ? .45 : .6));
      for (const item of this.active) { this.applyMorphs(item, this.currentWeights); player.capture(item); }
      const current = this.animationPlayer(); if (current) { current.phase = current.phase; current.update(performance.now() / 1000, this.active); }
    }
    if(name==='crouch'){const ready=await this.prepareAction('crouchIdle');if(ready===false)return false;}
    if (name === 'crawl' || name === 'fly') { const ready = await this.prepareAction(name + 'Idle'); if (ready === false) return false; if(name==='fly'){const variants=await Promise.all(['Forward','Backward','Left','Right','Up','Down'].map(direction=>this.prepareAction('fly'+direction)));if(variants.some(value=>value===false))return false;} if (!this.motionCapsules?.[name]) this.captureMotionCapsule(name); }
    return true;
  }
  setAction(name, phase = 0) {
    const next = name && this.locomotionPlayer(name) ? name : null;
    if (next === this.motionAction) { if (next === 'jump') this.setJumpPhase(phase); return; }
    const previous = this.animationPlayer()?.pose(), wasJump = this.motionAction === 'jump';
    this.motionAction = next; this.walking = false;
    const player = this.animationPlayer();
    if (next) { player.setPlaying(['run','stretch','crawl','fly'].includes(next)); if (next === 'jump' || next === 'crouch') player.phase = phase * player.report.duration; }
    else player?.setPlaying(this.idlePlaying);
    if (previous) player?.blendFrom(previous, next === 'jump' ? .12 : wasJump ? .3 : .6);
    player?.update(performance.now() / 1000, this.active);
  }
  actionClip(name) { return this.actionClips?.[this.locomotionKey(name)]?.[this.currentConfig.BodyType === 'female' ? 'female' : 'male']?.[0]; }
  setGaitStrength(value) { this.animationPlayer()?.setGaitStrength?.(value); }
  setGaitVelocity(value) { const scale = this.group.scale.x; if (Number.isFinite(value) && scale > 0) this.animationPlayer()?.setGaitVelocity?.(value / scale); }
  setCrouchMoving(value) { this.setCycleMoving('crouch', 'crouchMoving', value); }
  setCrawlMoving(value) { this.setCycleMoving('crawl', 'crawlMoving', value); }
  setFlightMoving(value) { this.setCycleMoving('fly', 'flightMoving', value); }
  setCycleMoving(mode, property, value) {
    if (this.motionAction !== mode || this[property] === !!value) return;
    const previous = this.animationPlayer()?.pose(); this[property] = !!value; const player = this.animationPlayer();
    player?.setPlaying(true); if (previous) player?.blendFrom(previous); player?.update(performance.now()/1000,this.active);
  }
  captureMotionCapsule(mode) {
    const box = new THREE.Box3(), contacts = this.active.filter(item => item.definition.name === this.currentBody || item.definition.name.startsWith('RobotBody_') || ['RobotHands','RobotHead','RobotFace'].includes(item.definition.name) || /^(shoes_|RobotShoe)/.test(item.definition.name));
    const point = new THREE.Vector3(),saved=contacts.map(item=>({item,skin:item.skin,bones:item.mesh?.skeleton?.boneMatrices.slice(),attributes:Object.fromEntries(['position','normal','tangent'].filter(name=>item.geometry.getAttribute(name)).map(name=>[name,item.geometry.getAttribute(name).array.slice()])),box:item.geometry.boundingBox?.clone(),sphere:item.geometry.boundingSphere?.clone()}));
    try { for (const name of mode==='fly'?Object.keys(this.actionPlayers).filter(name=>name.startsWith('fly')):[mode,mode+'Idle']) {
      const player = this.actionPlayers[name];
      const samples=this.actionClips[name]?.[this.currentConfig.BodyType]?.[0]?.staticSourcePose?1:32;
      for (let sample=0;sample<samples;sample++) { player.sampleGeometry(sample/samples*player.report.duration,contacts); const poseBox = new THREE.Box3(); for(const item of contacts){const positions=posedPositions(item);for(let i=0;i<positions.length;i+=3)poseBox.expandByPoint(point.fromArray(positions,i));} if(!poseBox.isEmpty()){const floor=poseBox.min.y-.01;poseBox.min.y-=floor;poseBox.max.y-=floor;box.union(poseBox);} }
    } } finally { for(const {item,skin,bones,attributes,box,sphere} of saved){if(bones){item.mesh.skeleton.boneMatrices.set(bones);item.mesh.skeleton.boneTexture.needsUpdate=true;item.skin=skin;}for(const [name,array]of Object.entries(attributes)){const attribute=item.geometry.getAttribute(name);attribute.array.set(array);attribute.needsUpdate=true;}item.geometry.boundingBox=box||null;item.geometry.boundingSphere=sphere||null;} }
    if (box.isEmpty()) throw new Error('Movement body bounds unavailable.');
    const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),horizontal=size.z>size.y,radius=Math.max(size.x,horizontal?size.y:size.z)/2+.01,height=Math.max(size.y+.02,2*radius+.006);
    const offset=new THREE.Vector3(center.x,0,center.z),envelope=box.clone().translate(offset.clone().negate()).expandByScalar(.01);envelope.min.y=Math.max(.001,envelope.min.y);
    // Prone and flight poses need their full box: a single floor-safe capsule misses hands and boot corners.
    const segment={start:new THREE.Vector3(0,radius+.003,-Math.max(0,size.z/2-radius)),end:new THREE.Vector3(0,radius+.003,Math.max(0,size.z/2-radius)),box:envelope,rotation:new THREE.Quaternion()};
    this.motionCapsules ||= {}; this.motionCapsules[mode]={height,radius,offset:new THREE.Vector3(center.x,0,center.z),segment};
  }
  motionCapsule(mode=this.motionAction) { return this.motionCapsules?.[mode] || null; }
  motionGroundAnchor() {
    if (!['crawl','fly'].includes(this.motionAction)) return null;
    let lowest = Infinity;
    for (const item of this.active) if (item.definition.name === this.currentBody || item.definition.name.startsWith('RobotBody_') || ['RobotHands','RobotHead','RobotFace'].includes(item.definition.name) || /^(shoes_|RobotShoe)/.test(item.definition.name)) { const positions = posedPositions(item); for (let i=1;i<positions.length;i+=3) lowest = Math.min(lowest, positions[i]); }
    return Number.isFinite(lowest) ? new THREE.Vector3(0, lowest - .01, 0) : null;
  }
  setJumpPhase(fraction) { const player = this.actionPlayers?.jump; if (this.motionAction === 'jump' && player) player.phase = Math.min(.999, Math.max(0, fraction)) * player.report.duration; }
  configureIdle(family, config) {
    if (!this.idleFactory) return;
    const signature = JSON.stringify([family.Family, config.BodyType, config.FeetApart, config.ToeOut]);
    if (signature === this.idleSignature) return;
    if (this.ar?.session) this.ar.stopMotion();
    const phase = this.idlePlayer?.phase || 0, source = this.idlePlayer?.report.bodyType === config.BodyType ? this.idlePlayer.report.source : undefined; this.idlePlayer?.dispose(); this.walkPlayer?.dispose(); this.seatPlayer?.dispose(); this.floorSeatPlayer?.dispose(); this.walkPlayer = this.seatPlayer = this.floorSeatPlayer = null; this.seatMode = null; for (const player of Object.values(this.actionPlayers || {})) player.dispose(); this.actionPlayers = {}; this.motionAction = null; this.gaitDirection = 'forward'; this.motionCapsules = {}; this.crouchMoving = this.crawlMoving = this.flightMoving = true; this.walking = this.sitting = false;
    this.puppetLayer?.reset(); this.puppetLayer = createPuppetLayer(family); this.idlePlayer = this.idleFactory(family, config, this.idleClip, source); this.idlePlayer.setPoseLayer(this.puppetLayer); this.idlePlayer.setPlaying(this.idlePlaying); this.idlePlayer.setAPose(!!this.aPose); if (this.idlePlaying) this.idlePlayer.phase = phase; this.idleSignature = signature;
  }
  enableIdle(clip, factory) {
    this.idleClip = clip; this.idleFactory = factory;
    if (!this.currentFamily) return;
    this.configureIdle(this.currentFamily, this.currentConfig);
    for (const item of this.active) { this.applyMorphs(item, this.currentWeights); this.idlePlayer.capture(item); }
    this.idlePlayer.update(performance.now() / 1000, this.active); this.frame();
    if (this.stats) this.stats.idle = this.idlePlayer.report;
  }
  setIdlePlaying(value) { this.idlePlaying = !!value; if (!this.idlePlaying && this.ar?.session) this.ar.stopMotion(); this.idlePlayer?.setPlaying(this.idlePlaying); this.idlePlayer?.update(performance.now() / 1000, this.active); }
  async prepareWalking() {
    if (!this.idleFactory || !this.currentFamily) throw new Error('Wait for the avatar animation to load.');
    const signature = this.idleSignature, family = this.currentFamily, library = await loadWalkClips();
    if (signature !== this.idleSignature || family !== this.currentFamily) return false;
    if (!this.walkPlayer) {
      this.walkPlayer = this.idleFactory(this.currentFamily, this.currentConfig, library); this.walkPlayer.setPoseLayer(this.puppetLayer); this.walkPlayer.setFootLock(false); this.walkPlayer.calibrateGaitSpeed(.6);
      for (const item of this.active) { this.applyMorphs(item, this.currentWeights); this.walkPlayer.capture(item); }
      const current = this.animationPlayer(); if (current) { current.phase = current.phase; current.update(performance.now() / 1000, this.active); }
    }
  }
  setWalking(value) {
    const player = this.locomotionPlayer('walk'), next = !!value && !!player;
    if (!next && this.motionAction) { this.walking = false; player?.setPlaying(false); return; }
    if (next === this.walking && !this.motionAction) return;
    const previous = this.animationPlayer()?.pose();
    if (next) this.motionAction = null;
    this.walking = next; player?.setPlaying(next);
    const selected = this.animationPlayer();
    if (!next) selected?.setPlaying(this.idlePlaying);
    if (previous) selected?.blendFrom(previous, .25);
    selected?.update(performance.now() / 1000, this.active);
  }
  async prepareSitting(mode = 'chair') {
    if (!this.idleFactory || !this.currentFamily) throw new Error('Wait for the avatar animation to load.');
    const signature = this.idleSignature, family = this.currentFamily;
    const library = mode === 'floor' ? (await loadPostureClips())['floor-sit'] : await loadSeatClips();
    if (signature !== this.idleSignature || family !== this.currentFamily) return false;
    const key = mode === 'floor' ? 'floorSeatPlayer' : 'seatPlayer';
    if (!this[key]) {
      const player = this[key] = this.idleFactory(family, this.currentConfig, library);
      player.setPoseLayer(this.puppetLayer); player.setFootLock(false); player.setGrounded(false); player.setPlaying(false);
      for (const item of this.active) { this.applyMorphs(item, this.currentWeights); player.capture(item); }
      const current = this.animationPlayer(); if (current) { current.phase = current.phase; current.update(performance.now() / 1000, this.active); }
    }
    return true;
  }
  setSitting(value, mode = 'chair') {
    const player = mode === 'floor' ? this.floorSeatPlayer : this.seatPlayer, next = !!value && !!player;
    if (next === this.sitting && (!next || this.seatMode === mode)) return;
    const previous = this.animationPlayer()?.pose();
    this.sitting = next; this.seatMode = next ? mode : null; this.walking = false; this.motionAction = null;
    const selected = this.animationPlayer();
    selected?.setPlaying(next ? mode === 'chair' && this.idlePlaying : this.idlePlaying);
    if (!next) selected?.setAPose(!!this.aPose);
    if (previous) selected?.blendFrom(previous, .6);
    selected?.update(performance.now() / 1000, this.active);
  }
  floorSeatAnchor() {
    const bone = this.currentFamily?.skeleton.find(row => row.name === (this.currentFamily.Family === 'human' ? 'root.x' : 'Hips'));
    const matrix = bone && this.floorSeatPlayer?.pose().get(bone.path);
    if (!matrix) throw new Error('The floor-seated pelvis is unavailable.');
    const point = new THREE.Vector3().setFromMatrixPosition(matrix); point.x *= -1;
    const body = this.active.find(item => this.currentFamily.Family === 'robot' ? item.definition.name.startsWith('RobotBody_') : item.definition.name === this.currentBody);
    const contact = seatedBodyContact(point, body && posedPositions(body));
    for (const item of this.active) if (item === body || /^(shoes_|RobotShoe)/.test(item.definition.name)) {
      const positions = posedPositions(item);
      for (let i = 1; i < positions.length; i += 3) contact.y = Math.min(contact.y, positions[i] - .01);
    }
    return contact;
  }
  seatAnchor() {
    const bone = this.currentFamily?.skeleton.find(row => row.name === (this.currentFamily.Family === 'human' ? 'root.x' : 'Hips')), matrix = bone && this.seatPlayer?.pose().get(bone.path);
    if (!matrix) throw new Error('The seated pelvis is unavailable.');
    const point = new THREE.Vector3().setFromMatrixPosition(matrix); point.x *= -1;
    const body = this.active.find(item => this.currentFamily.Family === 'robot' ? item.definition.name.startsWith('RobotBody_') : item.definition.name === this.currentBody);
    return seatedBodyContact(point, body && posedPositions(body));
  }
  setAPose(value) { this.aPose = !!value; if (this.aPose && this.ar?.session) this.ar.stopMotion(); this.idlePlayer?.setAPose(this.aPose); this.idlePlayer?.update(performance.now() / 1000, this.active); this.frame(); }
  focus(kind) { this.focusKind = ['Body', 'Head', 'Face', 'Bust', 'Feet'].includes(kind) ? kind : 'Body'; }
  resize() { if (this.renderer.xr.isPresenting) return; const width = this.element.clientWidth, height = this.element.clientHeight; if (!width || !height) return; this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); if (this.framed) this.frame(); }
  async mesh(family, definition) {
    const key = `${family.Family}:${definition.id}`;
    return cachedLoad(this.cache, key, async () => {
      const { buffer } = await assetBytes(assetPath(definition.geometry.url)), geometry = new THREE.BufferGeometry(), count = definition.geometry.vertexCount;
      const desc = definition.geometry, array = name => { const value = typedArray(buffer, desc[name]); return value?.length ? value : null; };
      const positions = reflect(array('positions')), normals = array('normals') ? reflect(array('normals')) : null;
      geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3)); if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals.slice(), 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(array('uv') || new Float32Array(count * 2), 2));
      geometry.setAttribute('avatarUv2', new THREE.BufferAttribute(array('uv2') || new Float32Array(count * 2), 2));
      const colours = array('colors') || new Float32Array(count * 4).fill(1); geometry.setAttribute('avatarColor', new THREE.BufferAttribute(colours, 4));
      const tangents = array('tangents') ? reflect(array('tangents'), 4) : null; if (tangents) geometry.setAttribute('tangent', new THREE.BufferAttribute(tangents.slice(), 4));
      const parts = (definition.submeshes || []).map(row => Uint32Array.from(typedArray(buffer, row.indices)));
      const reverse = (definition.avgNormalCrossDot ?? 1) >= 0;
      const displayParts = parts.map(part => { const indices = part.slice(); if (reverse) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]; return indices; });
      const materialList = await Promise.all((definition.submeshes || []).map(async row => {
        const id = row.materialId, materialKey = family.Family + ':' + id;
        return cachedLoad(this.materials, materialKey, async () => { const description = family.materials.find(item => item.id === id); if (!description) throw new Error(`Material missing for ${definition.name}: ${id}`); const material = await createMaterial(description, family, this.report); this.materialInstances.set(materialKey, material); return material; });
      }));
      if (!normals) geometry.computeVertexNormals();
      const morphs = (definition.morphs || []).map(morph => ({ name: morph.name, frames: morph.frames.map(frame => ({ weight: frame.weight, positions: frame.positions ? reflect(typedArray(buffer, frame.positions)) : null, normals: frame.normals ? reflect(typedArray(buffer, frame.normals)) : null, tangents: frame.tangents ? reflect(typedArray(buffer, frame.tangents)) : null })) }));
      if (correctLegacyBakedScale(definition, positions, normals, tangents, morphs)) {
        for (const [name, values] of [['position', positions], ['normal', normals], ['tangent', tangents]]) if (values) geometry.getAttribute(name).array.set(values);
        if (!normals) geometry.computeVertexNormals();
      }
      const skinCounts = array('bonesPerVertex'), skinIndices = array('allSkinIndices'), skinWeights = array('allSkinWeights'), skeleton = this.gpuSkinning !== false ? gpuSkeleton(geometry, definition, skinCounts, skinIndices, skinWeights) : null;
      const part = (geometry, material) => { if (!skeleton) return new THREE.Mesh(geometry, material); const node = new THREE.SkinnedMesh(geometry, material); node.bindMode = THREE.DetachedBindMode; node.bind(skeleton, new THREE.Matrix4()); node.frustumCulled = false; return node; };
      const mesh = part(geometry, materialList); mesh.name = definition.name;
      const wire = part(geometry, this.wireMaterial); wire.visible = !!this.wire; mesh.add(wire);
      const cuts = part(new THREE.BufferGeometry(), this.cutMaterial); cuts.visible = !!this.cuts; mesh.add(cuts);
      const result = { definition, geometry, positions, normals, tangents, parts, displayParts, morphs, mesh, wire, cuts, materials: materialList, skinCounts, skinIndices, skinWeights };
      const headPath = family.skeleton?.find(bone => ['head.x', 'Head'].includes(bone.name))?.path, headVertices = [];
      if (headPath && result.skinCounts?.length) { let influence = 0; for (let vertex = 0; vertex < count; vertex++) { let strongest = -1, weight = -1; for (let i = 0; i < result.skinCounts[vertex]; i++, influence++) if (result.skinWeights[influence] > weight) { weight = result.skinWeights[influence]; strongest = result.skinIndices[influence]; } const path = definition.bones?.[strongest]?.path; if (path === headPath || path?.startsWith(headPath + '/')) headVertices.push(vertex); } }
      else if (headPath && definition.path?.startsWith(headPath + '/')) for (let vertex = 0; vertex < count; vertex++) headVertices.push(vertex);
      result.headVertices = Uint32Array.from(headVertices);
      this.setIndices(result, displayParts); this.instances.set(key, result); return result;
    });
  }
  setIndices(item, parts) {
    item.geometry.clearGroups(); let offset = 0;
    parts.forEach((part, index) => { item.geometry.addGroup(offset, part.length, index); offset += part.length; });
    const indices = new Uint32Array(offset); offset = 0; for (const part of parts) { indices.set(part, offset); offset += part.length; } item.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  applyMorphs(item, weights) {
    for (const name of ['position', 'normal', 'tangent']) { const base = name === 'position' ? item.positions : name === 'normal' ? item.normals : item.tangents; const attribute = item.geometry.getAttribute(name); if (base && attribute) attribute.array.set(base); }
    for (const morph of item.morphs) for (const [frame, amount] of morphMix(morph.frames, weights[morph.name] || 0)) for (const [attributeName, deltaName] of [['position', 'positions'], ['normal', 'normals'], ['tangent', 'tangents']]) { const target = item.geometry.getAttribute(attributeName), delta = frame[deltaName]; if (!target || !delta) continue; const stride = attributeName === 'tangent' ? 4 : 3; for (let v = 0; v < target.count; v++) for (let axis = 0; axis < 3; axis++) target.array[v * stride + axis] += delta[v * 3 + axis] * amount; }
    for (const name of ['normal', 'tangent']) { const target = item.geometry.getAttribute(name); if (!target) continue; for (let v = 0; v < target.count; v++) { const at = v * target.itemSize, length = Math.hypot(target.array[at], target.array[at + 1], target.array[at + 2]) || 1; for (let axis = 0; axis < 3; axis++) target.array[at + axis] /= length; } }
    for (const name of ['position', 'normal', 'tangent']) { const target = item.geometry.getAttribute(name); if (target) target.needsUpdate = true; } item.geometry.computeBoundingSphere(); item.geometry.computeBoundingBox();
  }
  async update(family, request, config, frame = false) {
    const token = ++this.token, definitions = (family.meshes || []).filter(mesh => request.MeshNames.includes(mesh.name));
    const items = await Promise.all(definitions.map(definition => this.mesh(family, definition)));
    const textureChanges = await Promise.all(Object.entries(request.MaterialTextures || {}).map(async ([name, change]) => [name, change, await loadTexture(change.Texture)]));
    if (token !== this.token) return null;
    this.currentFamily = family; this.currentConfig = JSON.parse(JSON.stringify(config)); this.currentWeights = request.ShapeWeights; const capsuleSignature=JSON.stringify([family.Family,config.BodyType,config.FeetApart,config.ToeOut,request.ShapeWeights,request.MeshNames]); if(capsuleSignature!==this.motionCapsuleSignature){this.motionCapsules={};this.motionCapsuleSignature=capsuleSignature;} this.currentBody = request.BodyMesh; this.configureIdle(family, config);
    this.group.clear(); this.active = items; let hiddenCount = 0, triangles = 0, vertices = 0; const posture = postureMatrices(family, config);
    for (const item of items) {
      this.applyMorphs(item, request.ShapeWeights); if (this.idlePlayer) this.idlePlayer.capture(item); else skinPosture(item, posture); this.walkPlayer?.capture(item); this.seatPlayer?.capture(item); this.floorSeatPlayer?.capture(item); for (const player of Object.values(this.actionPlayers || {})) player.capture(item); item.materials.forEach(material => { updateMaterial(material, request, config); for (const [name, change, texture] of textureChanges) if (material.name === name || name === '@face' && material.userData.definition.shader === 'Robot/Face Glow Panel') { const uniforms = material.userData.uniforms; if (uniforms[change.Property]) uniforms[change.Property].value = texture; if (change.Switch && uniforms[change.Switch]) uniforms[change.Switch].value = 1; if (change.ScaleOffset && uniforms[change.Property + '_ST']) uniforms[change.Property + '_ST'].value.fromArray(change.ScaleOffset); if (uniforms[change.Property + '_TexelSize']) { const image = texture.image; uniforms[change.Property + '_TexelSize'].value.set(1 / image.width, 1 / image.height, image.width, image.height); } } });
      if (item.definition.name === request.BodyMesh) {
        const indices = new Uint32Array(item.parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of item.parts) { indices.set(part, at); at += part.length; }
        const hidden = coverageFor(family, request.MeshNames, indices, this.data); hiddenCount += hidden.reduce((sum, value) => sum + value, 0); this.setIndices(item, cullTriangles(item.displayParts, hidden));
        const excluded = cullTriangles(item.displayParts, Uint8Array.from(hidden, value => 1 - value)); const cutIndices = Uint32Array.from(excluded.flatMap(part => [...part])); item.cuts.geometry.setAttribute('position', item.geometry.getAttribute('position')); for (const name of ['skinIndex', 'skinWeight']) if (item.geometry.getAttribute(name)) item.cuts.geometry.setAttribute(name, item.geometry.getAttribute(name)); item.cuts.geometry.setIndex(new THREE.BufferAttribute(cutIndices, 1));
      } else this.setIndices(item, item.displayParts);
      item.wire.visible = !!this.wire; item.cuts.visible = !!this.cuts; this.group.add(item.mesh); vertices += item.positions.length / 3; triangles += item.geometry.index.count / 3;
    }
    const standingBounds=new THREE.Box3();for(const item of items)if(item.geometry.boundingBox)standingBounds.union(item.geometry.boundingBox);
    if (['crawl','fly'].includes(this.motionAction) && !this.motionCapsules?.[this.motionAction]) this.captureMotionCapsule(this.motionAction);
    this.ar?.avatarChanged?.(standingBounds);
    const missing = request.MeshNames.filter(name => !definitions.some(mesh => mesh.name === name));
    this.animationPlayer()?.update(performance.now() / 1000, items);
    if (this.sitting && this.ar?.seatPoint) this.ar.setSize();
    if (frame || !this.framed) this.frame(); this.framed = true;
    this.stats = { meshes: items.length, vertices, triangles, hiddenTriangles: hiddenCount, missing, materialNotes: [...new Set(this.report)], posture: 'Standing IK and retargeted idle preview. Live FlexaBody tracking and grounding remain Unity behavior.', postureLegs: posture.legs, idle: this.idlePlayer?.report };
    this.renderer.compile(this.scene, this.camera);
    // Keep the currently worn look resident. Retaining every visited 4K texture would exceed 3 GB.
    for (const [key, item] of this.instances) if (!items.includes(item)) { item.geometry.dispose(); item.cuts.geometry.dispose(); this.instances.delete(key); this.cache.delete(key); }
    const activeMaterials = new Set(items.flatMap(item => item.materials)); for (const [key, material] of this.materialInstances) if (!activeMaterials.has(material)) { material.dispose(); this.materialInstances.delete(key); this.materials.delete(key); }
    const activeTextures = new Set(); for (const material of activeMaterials) { for (const uniform of Object.values(material.userData.uniforms)) if (uniform.value?.isTexture) activeTextures.add(uniform.value); for (const value of Object.values(material)) if (value?.isTexture) activeTextures.add(value); }
    releaseUnusedTextures(activeTextures); this.stats.residentMeshes = this.instances.size; this.stats.residentMaterials = this.materialInstances.size; this.stats.residentTextures = activeTextures.size; return this.stats;
  }
  frame(view = this.view) {
    if (this.ar?.session) return;
    this.view = view; const box = this.posedBounds(); if (box.isEmpty()) return;
    const floor = box.min.y, pose = this.idlePlayer?.pose();
    const bone = names => { const row = this.currentFamily?.skeleton?.find(item => names.includes(item.name)), matrix = row && (pose?.get(row.path)?.elements || row.matrix); return matrix ? new THREE.Vector3(-matrix[12], matrix[13], matrix[14]) : null; };
    const measuredHead = bone(['head.x', 'Head']), height = standingHeight(measuredHead?.y, box.max.y), head = measuredHead || new THREE.Vector3(0, floor + height * .87, 0), eyes = bone(['c_eye.l', 'LeftEye']) || head.clone().add(new THREE.Vector3(0, height * .05, 0)), neck = bone(['neck.x', 'Neck']) || head.clone().add(new THREE.Vector3(0, -height * .05, 0));
    let headTop = -Infinity, headLeft = Infinity, headRight = -Infinity, headBack = Infinity, headFront = -Infinity; const point = new THREE.Vector3(); for (const item of this.active) { const positions = posedPositions(item), matrix = item.mesh.matrixWorld; for (const vertex of item.headVertices) { point.fromArray(positions, vertex * 3).applyMatrix4(matrix); headTop = Math.max(headTop, point.y); headLeft = Math.min(headLeft, point.x); headRight = Math.max(headRight, point.x); headBack = Math.min(headBack, point.z); headFront = Math.max(headFront, point.z); } }
    const framing = focusSlice(this.focusKind, height, floor, head.y, eyes.y, neck.y, Number.isFinite(headTop) ? headTop : box.max.y);
    if (this.focusKind === 'Body') { const size = box.getSize(new THREE.Vector3()); framing.center = box.getCenter(new THREE.Vector3()).y; framing.height = Math.max(framing.height, size.y * 1.1); framing.width = Math.max(framing.width, size.x, size.z); }
    // Face/Head: keep the whole posed head (hair, helmet) in a narrow portrait mirror, also once the idle turns it to profile.
    const headFocus = (this.focusKind === 'Face' || this.focusKind === 'Head') && Number.isFinite(headTop);
    if (headFocus) framing.width = Math.max(framing.width, Math.max(headRight - headLeft, headFront - headBack) * 1.4);
    const center = new THREE.Vector3(headFocus ? (headLeft + headRight) / 2 : 0, framing.center, 0), slice = Math.max(framing.height, framing.width / this.camera.aspect);
    center.y += framing.anchor * (framing.height - slice) / 2;
    if (headFocus) center.y = Math.max(center.y, headTop + height * .05 - slice / 2);
    this.controls.target.copy(center);
    const distance = slice / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.08;
    const directions = { front: [0, .03, 1], threequarter: [.55, .08, 1], side: [1, .03, 0], back: [0, .03, -1] };
    this.camera.position.copy(center).add(new THREE.Vector3(...directions[view]).normalize().multiplyScalar(distance)); this.camera.near = Math.max(.001, distance / 1000); this.camera.far = distance * 100; this.camera.updateProjectionMatrix(); this.controls.update();
    this.follow = headFocus && measuredHead ? { anchor: measuredHead.clone(), target: center.clone() } : null;
  }
  /** Close-ups follow the head bone as the idle moves it (Unity's mirror tracks the head); a user orbit stops following until the next frame(). */
  followHead() {
    const follow = this.follow; if (!follow || this.ar?.session) return;
    const row = this.currentFamily?.skeleton?.find(item => item.name === 'head.x' || item.name === 'Head'), m = row && this.idlePlayer?.pose()?.get(row.path)?.elements; if (!m) return;
    const step = follow.target.clone().add(new THREE.Vector3(-m[12] - follow.anchor.x, m[13] - follow.anchor.y, 0)).sub(this.controls.target).multiplyScalar(.08);
    this.controls.target.add(step); this.camera.position.add(step);
  }
  posedPositions(item) { return posedPositions(item); }
  /** Posed bounds in group-parent space; GPU-skinned geometry attributes stay in bind pose. */
  posedBounds() {
    const box = new THREE.Box3(), point = new THREE.Vector3(); this.group.updateMatrixWorld(true);
    for (const item of this.active) { const positions = posedPositions(item), matrix = item.mesh.matrixWorld; for (let i = 0; i < positions.length; i += 3) box.expandByPoint(point.fromArray(positions, i).applyMatrix4(matrix)); }
    return box;
  }
  overlays(wire, cuts) { this.wire = wire; this.cuts = cuts; for (const item of this.active) { item.wire.visible = wire; item.cuts.visible = cuts; } }
  snapshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
}


