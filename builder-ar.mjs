import * as THREE from './libs/three/package/build/three.module.js';
import { AvatarMovementMotor } from './builder-movement.mjs?v=e772e5919b76';
import { XRWorld } from './builder-xr-world.mjs?v=08d2b791ea59';
import { AvatarFollower } from './builder-follow.mjs?v=9cb113ed3702';

export function floorCandidate(matrix, viewer, floorY = null) {
  const point = new THREE.Vector3().setFromMatrixPosition(matrix);
  if (!matrix.elements.every(Number.isFinite) || matrix.elements[5] < .8 || viewer.y - point.y < .35 || viewer.y - point.y > 2.7) return null;
  return floorY !== null && Math.abs(point.y - floorY) > .2 ? null : point;
}
export function seatCandidate(matrix, viewer, floorY) {
  const point = floorCandidate(matrix, viewer);
  return point && (floorY === null || point.y - floorY >= .2 && point.y - floorY <= 1.1) ? point : null;
}

const PERFORMANCE_KEY='avirev.xr-performance.v1';
// Seconds a stick gesture must be held to take off, sit on the floor or land.
const HOLD=1;
// Occlusion sources: Quest room setup planes, the scanned room mesh, both, or live per-frame depth (needs a new session).
// Full-stick avatar turn speed in rad/s (doubled from 1.8 on 2026-10-12: turning felt slow).
const TURN_RATE=3.6;
// Occluder groups (see occlusionGroup): 'setup' = Space Setup walls, floor and furniture boxes; 'scan' = the dense room scan.
const OCCLUSION={off:[],planes:['setup'],mesh:['scan'],both:['setup','scan'],depth:[]};
// Resolution is fixed per WebXR session; foveation, shadows, occlusion and animation rate change live.
const QUALITY={sharp:{scale:1,foveation:.3,shadowMap:1024},balanced:{scale:.85,foveation:.7,shadowMap:1024},fast:{scale:.7,foveation:1,shadowMap:512}};

/** Uses the current avatar and materials directly; camera access starts only on the AR button. */
export class AvatarAR {
  constructor(owner, ui) {
    this.owner = owner; this.ui = ui; this.controllers = new Map(); this.motionGeneration = 0;this.motor=new AvatarMovementMotor();this.moveVelocity=this.motor.velocity;this.crawlMode=this.flightMode=this.flying=false;this.flightAxis=0;this.runToggled=false;
    ui.button.onclick = () => this.start();
    ui.exit.onclick = () => this.session?.end().catch(() => this.message('Could not exit AR. Use your phone’s back button.'));
    ui.reposition.onclick = () => { this.stand(true); this.stopWalk(); this.walkMode = false;this.flightMode=this.flying=this.crawlMode=false; this.placed = false; owner.group.visible = false; if (this.shadow) this.shadow.visible = false; this.walkButton(); };
    if(ui.crawl)ui.crawl.onclick=()=>this.toggleCrawl();if(ui.fly)ui.fly.onclick=()=>this.toggleFly();
    if(ui.runMode)ui.runMode.onchange=()=>{this.runToggled=false;};
    this.behavior='manual';this.follower=new AvatarFollower();if(ui.behavior)ui.behavior.onchange=()=>this.setBehavior(ui.behavior.value);if(ui.calibrate)ui.calibrate.onclick=()=>{this.puppetCalibration=null;this.owner.setPuppetTargets?.(null);this.companionStatus='Hold a T-pose and press both thumbsticks together to calibrate.';};
    if(ui.collision)ui.collision.onchange=()=>{this.follower.reset();this.motor.velocity.set(0,0,0);this.checkPlacementClearance();};
    if (ui.walk) ui.walk.onclick = () => this.toggleWalk();
    if (ui.sit) ui.sit.onclick = () => this.toggleSit();
    if (ui.turn) ui.turn.onclick = () => { if (this.seatPoint) { owner.group.rotateY(Math.PI / 4); this.setSize(); } };
    this.manualSeatHeight = .45;
    if (ui.seatHeight) ui.seatHeight.oninput = () => this.setSeatHeight(ui.seatHeight.value);
    ui.size.oninput=()=>{this.setSize();this.checkPlacementClearance();};
    ui.controls.addEventListener('beforexrselect', event => event.preventDefault());
    this.loadPerformance();
    for(const name of ['quality','animationRate','occlusion','shadows'])if(ui[name])ui[name].onchange=()=>{this.applyPerformance();this.savePerformance();if(name==='quality'&&this.session)this.message('Foveation changed now. Resolution changes the next time you enter WebXR.');};
    this.available = this.checkSupport();
  }
  performance(){const quality=QUALITY[this.ui.quality?.value]||QUALITY.balanced;return{...quality,stride:this.ui.animationRate?.value==='2'?2:1,occlusion:OCCLUSION[this.ui.occlusion?.value]?this.ui.occlusion.value:'both',shadows:this.ui.shadows?.checked!==false};}
  loadPerformance(){let saved=null;try{saved=JSON.parse(localStorage.getItem(PERFORMANCE_KEY)||'null');}catch{saved=null;}if(!saved||typeof saved!=='object')return;if(this.ui.quality&&QUALITY[saved.quality])this.ui.quality.value=saved.quality;if(this.ui.animationRate&&['1','2'].includes(String(saved.animationRate)))this.ui.animationRate.value=String(saved.animationRate);if(this.ui.occlusion)this.ui.occlusion.value=typeof saved.occlusion==='boolean'?saved.occlusion?'both':'off':OCCLUSION[saved.occlusion]?saved.occlusion:'both';if(this.ui.shadows&&typeof saved.shadows==='boolean')this.ui.shadows.checked=saved.shadows;}
  savePerformance(){try{localStorage.setItem(PERFORMANCE_KEY,JSON.stringify({quality:this.ui.quality?.value,animationRate:this.ui.animationRate?.value,occlusion:this.performance().occlusion,shadows:this.ui.shadows?.checked!==false}));}catch{/* Settings still apply for this visit. */}}
  applyPerformance(){
    const settings=this.performance(),renderer=this.owner.renderer;this.owner.animationStride=settings.stride;
    const occlusion=settings.occlusion==='depth'&&this.session&&!this.depthActive?'both':settings.occlusion;
    if(this.world){const kinds=[...OCCLUSION[occlusion]].join();if(this.world.occlusionKey!==kinds){this.world.occlusionKey=kinds;this.world.occlusionKinds=new Set(OCCLUSION[occlusion]);this.world.flash?.(3);}this.world.updateOcclusion?.();}
    if(this.session&&settings.occlusion==='depth'&&!this.depthActive)this.message(this.depthRequested?'Live depth is not available here; using the room setup and scan.':'Live depth starts the next time you enter WebXR. Using the room setup and scan until then.');
    if(this.session){renderer.xr.setFoveation?.(settings.foveation);renderer.shadowMap.enabled=settings.shadows;if(this.shadowLight){this.shadowLight.castShadow=settings.shadows;if(this.shadowLight.shadow.mapSize.x!==settings.shadowMap){this.shadowLight.shadow.mapSize.set(settings.shadowMap,settings.shadowMap);this.shadowLight.shadow.map?.dispose();this.shadowLight.shadow.map=null;}}if(this.shadow)this.shadow.material.visible=settings.shadows;}
  }
  setBehavior(mode){
    if(!['manual','puppet','follow'].includes(mode))return;
    if(mode!=='manual'&&(this.jumpState||this.flightMode||this.crawlMode||this.seatPoint||!this.motor.grounded||this.direct==='crouch'&&!this.standingReady())){this.message('Stand on the floor before starting '+(mode==='puppet'?'Puppet':'Follow')+'.');if(this.ui.behavior)this.ui.behavior.value=this.behavior;return;}
    this.behavior=mode;if(this.ui.behavior)this.ui.behavior.value=mode;this.puppetCalibration=null;this.puppetCalibrationRequested=this.puppetChordHeld=false;this.owner.setPuppetTargets?.(null);this.owner.setPuppetMode?.(mode==='puppet');this.follower?.reset();this.companionStatus=null;
    this.motionGeneration++;this.modeBusy=this.jumpBusy=false;if(!this.seatPoint)this.floorSitBusy=this.seatBusy=false;this.directRequest=this.directionRequest=null;this.stopWalk();if(!this.jumpState&&!this.flightMode&&!this.crawlMode&&!this.seatPoint&&!(this.direct==='crouch'&&!this.standingReady())){this.direct=null;this.owner.setAction?.(null);}this.motor.velocity.x=this.motor.velocity.z=0;
  }
  manualOverride(pose=false){if(this.behavior==='follow'||pose&&this.behavior==='puppet')this.setBehavior('manual');}
  collisionWorld(){
    if(this.ui.collision?.value!=='floor')return this.world;
    if(!this.floorWorld){const ar=this;this.floorWorld={complete:true,hasGeometry:true,everDetected:false,entries:new Map(),canOccupy:point=>point.toArray().every(Number.isFinite),constrainMove:(_from,to)=>to.clone(),groundSupport(point,down){const y=ar.groundY??(ar.floorSpace?0:ar.anchor?.y);return Number.isFinite(y)&&point.y>=y-.035&&point.y-y<=down?{point:point.clone().setY(y),normal:new THREE.Vector3(0,1,0),semanticLabel:'floor'}:null;},clearStandingPoint:point=>point.clone()};}
    return this.floorWorld;
  }
  /** Finger curl 0..1 per finger: XRHand joint bends when hands are tracked, otherwise trigger (index), grip (other fingers) and thumb touch. */
  fingerCurl(frame,space,input){
    const curl={thumb:.1,index:.15,middle:.15,ring:.15,pinky:.15};if(!input)return curl;
    if(input.hand&&frame.getJointPose){
      const joint=name=>{try{const jointSpace=input.hand.get(name),p=jointSpace&&frame.getJointPose(jointSpace,space)?.transform?.position;return p&&[p.x,p.y,p.z].every(Number.isFinite)?new THREE.Vector3(p.x,p.y,p.z):null;}catch{return null;}};
      const bend=(names,full)=>{const points=names.map(joint);if(points.some(point=>!point))return null;let total=0;for(let i=1;i<points.length-1;i++){const a=points[i].clone().sub(points[i-1]),b=points[i+1].clone().sub(points[i]);if(a.lengthSq()>1e-10&&b.lengthSq()>1e-10)total+=a.angleTo(b);}return THREE.MathUtils.clamp((total-.12)/full,0,1);};
      const thumb=bend(['thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip'],1.3);if(thumb!==null)curl.thumb=thumb;
      for(const finger of ['index','middle','ring','pinky']){const value=bend(['metacarpal','phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'].map(part=>finger+'-finger-'+part),3.4);if(value!==null)curl[finger]=value;}
      return curl;
    }
    const buttons=input.gamepad?.buttons||[],value=index=>THREE.MathUtils.clamp(buttons[index]?.value??(buttons[index]?.pressed?1:0),0,1);
    curl.index=Math.max(buttons[0]?.touched?.3:.15,value(0));
    curl.middle=curl.ring=curl.pinky=Math.max(.15,value(1));
    curl.thumb=[3,4,5,6].some(index=>buttons[index]?.touched||buttons[index]?.pressed)?.65:.1;
    return curl;
  }
  updatePuppet(frame,space,headPose,tracked,elapsed){
    if(this.behavior!=='puppet'||!this.canMove()||this.trackingPaused||this.panelInputs?.size||this.jumpState||this.flightMode||this.crawlMode||['crouch','stretch'].includes(this.direct)){this.puppetCalibrationRequested=false;this.owner.setPuppetTargets?.(null);return;}
    const rigid=transform=>{if(!transform)return null;const matrix=transform.matrix;if(matrix?.length===16&&Array.from(matrix).every(Number.isFinite)){const m=new THREE.Matrix4().fromArray(matrix),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();m.decompose(position,quaternion,scale);if([position.x,position.y,position.z,...quaternion.toArray()].every(Number.isFinite)&&quaternion.lengthSq()>.5)return{position,quaternion:quaternion.normalize()};}const p=transform.position,q=transform.orientation;if(p&&q&&[p.x,p.y,p.z,q.x,q.y,q.z,q.w].every(Number.isFinite)){const quaternion=new THREE.Quaternion(q.x,q.y,q.z,q.w);if(quaternion.lengthSq()>.5)return{position:new THREE.Vector3(p.x,p.y,p.z),quaternion:quaternion.normalize()};}return null;};
    const sample={head:rigid(headPose?.transform)};
    for(const name of ['leftHand','rightHand']){const hand=name==='leftHand'?'left':'right',input=tracked.find(row=>row.handedness===hand&&row.gripSpace);try{sample[name]=input&&rigid(frame.getPose(input.gripSpace,space)?.transform);}catch{sample[name]=null;}sample[name+'Curl']=this.fingerCurl(frame,space,input);}
    if(!sample.head||!sample.leftHand||!sample.rightHand){this.puppetCalibrationRequested=false;this.owner.setPuppetTargets?.(null);this.companionStatus='Puppet paused · track your headset and both controllers.';return;}
    if(this.puppetCalibration?.reference.signature!==this.owner.idleSignature)this.puppetCalibration=null;
    if(!this.puppetCalibration){
      if(!this.puppetCalibrationRequested){this.owner.setPuppetTargets?.(null);this.companionStatus='Hold a T-pose and press both thumbsticks together to calibrate.';return;}
      this.puppetCalibrationRequested=false;
      const reference=this.owner.puppetReference?.('tpose'),headForward=new THREE.Vector3(0,0,-1).applyQuaternion(sample.head.quaternion).setY(0),height=sample.head.position.y-(this.groundY??0);
      const span=sample.leftHand.position.distanceTo(sample.rightHand.position),level=Math.abs(sample.leftHand.position.y-sample.rightHand.position.y),forward=headForward.clone().normalize(),tpose=[sample.leftHand,sample.rightHand].every(hand=>{const delta=hand.position.clone().sub(sample.head.position);return Math.hypot(delta.x,delta.z)>.28*height&&Math.abs(delta.dot(forward))<.25*height&&delta.y>-.35*height&&delta.y<.1*height;});
      if(!reference||headForward.lengthSq()<.01||height<.6||height>2.4||!Number.isFinite(reference.height)||reference.height<.4||!tpose||span<.65*height||level>.15*height){this.owner.setPuppetTargets?.(null);this.companionStatus='Calibration needs a T-pose: arms sideways at shoulder height. Release and press both thumbsticks again.';return;}
      const basis=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.atan2(headForward.x,headForward.z));this.puppetCalibration={reference,neutral:sample,basis,inverse:basis.clone().invert(),origin:sample.head.position.clone(),scale:reference.height/height};
      // Hands move by arm-span ratio, not height ratio: the Robot's short arms otherwise overshoot and cross when your hands meet.
      const avatarSpan=(reference.leftHand.palm||reference.leftHand.position).distanceTo(reference.rightHand.palm||reference.rightHand.position);if(Number.isFinite(avatarSpan)&&avatarSpan>.1)this.puppetCalibration.handScale=avatarSpan/span;
    }
    const c=this.puppetCalibration,travel=sample.head.position.clone().sub(c.origin).setY(0);
    // Recenter physical room walking without turning the calibrated hand frame with head gaze.
    if(travel.length()>.25){c.origin.addScaledVector(travel.clone().addScaledVector(travel.clone().normalize(),-.15),1-Math.exp(-8*elapsed));const remaining=sample.head.position.clone().sub(c.origin).setY(0);if(remaining.length()>.35)c.origin.addScaledVector(remaining.clone().addScaledVector(remaining.clone().normalize(),-.35),1);}
    const recenter=c.origin.clone().sub(c.neutral.head.position).setY(0),mirrored=this.ui.mirror?.checked!==false,targets={weight:1};
    for(const name of ['head','leftHand','rightHand']){const source=mirrored&&name!=='head'?name==='leftHand'?'rightHand':'leftHand':name;const delta=sample[source].position.clone().sub(c.neutral[source].position).sub(recenter).applyQuaternion(c.inverse).multiplyScalar(name==='head'?c.scale:c.handScale||c.scale),grip=c.reference[name].grip;
        // Hands use the absolute WebXR grip frame, so calibration palms (forward or down) cannot offset the wrist.
        let quaternion=grip?c.inverse.clone().multiply(sample[source].quaternion):c.inverse.clone().multiply(sample[source].quaternion.clone().multiply(c.neutral[source].quaternion.clone().invert())).multiply(c.basis);
        if(mirrored){delta.x*=-1;quaternion.y*=-1;quaternion.z*=-1;}if(grip)quaternion.multiply(grip.clone().invert());quaternion.normalize();if(name==='head'&&delta.length()>.3)delta.setLength(.3);const palm=name!=='head'&&c.reference[name].palm;targets[name]={position:(palm||c.reference[name].position).clone().add(delta),quaternion,palm:!!palm,curl:sample[source+'Curl']};}
    this.owner.setPuppetTargets?.(targets);this.companionStatus=mirrored?'Puppet · mirrored headset and hands':'Puppet · direct headset and hands';
  }
  message(text) { this.ui.status.hidden = false; this.ui.status.textContent = text; if (this.session && this.headset) { this.runtimeError = text; } }
  async checkSupport() {
    let supported = false;
    try { supported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); this.vrSupported = !supported && !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr'); supported ||= this.vrSupported; } catch { /* Feature detection can be denied by browser policy. */ }
    if (this.vrSupported) this.ui.button.textContent = 'Open WebXR (VR)';
    this.ui.button.hidden = !supported && !/Android/i.test(navigator.userAgent);
    this.ui.button.disabled = !supported;
    if (!supported && !this.ui.button.hidden) this.message('AR needs Chrome and Google Play Services for AR on a compatible Android phone.');
    return supported;
  }
  async start() {
    if (this.busy || this.session) return;
    this.busy = true; this.ui.button.disabled = true;
    const owner = this.owner, { group, scene, camera, controls, renderer } = owner;
    try {
      this.depthRequested = this.performance().occlusion === 'depth';
      const depth = this.depthRequested ? { optionalFeatures: ['depth-sensing'], depthSensing: { usagePreference: ['gpu-optimized'], dataFormatPreference: ['unsigned-short', 'float32', 'luminance-alpha'] } } : { optionalFeatures: [] };
      let session; try { session = await navigator.xr.requestSession(this.vrSupported ? 'immersive-vr' : 'immersive-ar', { optionalFeatures: ['hit-test', 'local-floor', 'dom-overlay', 'mesh-detection', 'plane-detection', 'hand-tracking', ...depth.optionalFeatures], ...(depth.depthSensing ? { depthSensing: depth.depthSensing } : {}), domOverlay: { root: this.ui.overlay } }); } catch (error) { if (error.name !== 'NotSupportedError') throw error; session = await navigator.xr.requestSession(this.vrSupported ? 'immersive-vr' : 'immersive-ar', { optionalFeatures: ['hit-test', 'local-floor', 'dom-overlay'], domOverlay: { root: this.ui.overlay } }); }
      this.world = new XRWorld(this.vrSupported ? null : scene); this.panelStarted = false;
      this.session = session; this.placed = false; this.walkMode = false; this.chooseSeat = false; this.headset = !!this.vrSupported || /Quest|Oculus/i.test(navigator.userAgent); if (this.ui.overlay.dataset) this.ui.overlay.dataset.headset = String(this.headset);
      this.saved = { position: group.position.clone(), quaternion: group.quaternion.clone(), scale: group.scale.clone(), visible: group.visible, background: scene.background, clearAlpha: renderer.getClearAlpha(), cameraPosition: camera.position.clone(), cameraQuaternion: camera.quaternion.clone(), target: controls.target.clone(), controlsEnabled: controls.enabled, xrEnabled: renderer.xr.enabled, shadowsEnabled: renderer.shadowMap.enabled, shadowType: renderer.shadowMap.type, casters: new Map() };
      group.position.set(0, 0, 0); group.quaternion.identity(); group.scale.setScalar(1);
      group.updateMatrixWorld(true); const bounds = owner.posedBounds?.() || new THREE.Box3().setFromObject(group);
      this.floor = bounds.min.y; this.height = bounds.max.y - bounds.min.y;
      if (!Number.isFinite(this.floor) || !Number.isFinite(this.height) || this.height <= 0) throw new Error('Wait for the avatar to finish loading.');
      // shortcut: Clipped hair casts a solid silhouette; add matching depth clipping if finer shadow fidelity is needed.
      group.traverse(object => { if (object.isMesh) { this.saved.casters.set(object, object.castShadow); object.castShadow = true; } });
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
      this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: .3, depthWrite: false }));
      this.shadow.receiveShadow = true; this.shadow.visible = false; scene.add(this.shadow);
      // A shadow-only light preserves the existing material lighting in AR.
      this.shadowLight = new THREE.DirectionalLight(0xffffff, 0); this.shadowLight.castShadow = true;
      this.shadowLight.shadow.mapSize.set(1024, 1024); this.shadowLight.shadow.radius = 3; this.shadowLight.shadow.bias = -.0001; this.shadowLight.shadow.normalBias = .01;
      scene.add(this.shadowLight, this.shadowLight.target); this.setSize();
      // The placement ring lies on the scanned floor; depth-only room occluders would hide it, so it draws on top.
      this.reticle = new THREE.Mesh(new THREE.RingGeometry(.11, .13, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x72efcd, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true }));
      this.reticle.matrixAutoUpdate = false; this.reticle.visible = false; this.reticle.renderOrder = 9998; scene.add(this.reticle);
      this.holdRing = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffb86b, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true }));
      this.holdRing.visible = false; this.holdRing.renderOrder = 9997; this.holdRingStep = -1; scene.add(this.holdRing);
      scene.background = this.vrSupported ? this.saved.background : null; renderer.setClearAlpha(this.vrSupported ? 1 : 0); controls.enabled = false; group.visible = false;
      this.ui.overlay.hidden = false; this.ui.hint.textContent = 'Move your phone to find the floor, then tap the placement ring.';
      session.addEventListener('end', () => this.restore(), { once: true });
      session.addEventListener('select', event => this.place(event));
      this.floorSpace = false;
      try { await session.requestReferenceSpace('local-floor'); this.floorSpace = true; } catch { /* Phones may provide only local space plus hit testing. */ }
      if (this.session !== session) return;
      renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType(this.floorSpace ? 'local-floor' : 'local');
      const quality = this.performance(); renderer.xr.setFramebufferScaleFactor?.(quality.scale); renderer.xr.setFoveation?.(quality.foveation);
      await renderer.xr.setSession(session);
      if (this.session !== session) return;
      // three.js draws gpu-optimized depth into the depth buffer, so real objects and hands occlude the avatar.
      this.depthActive = !!session.enabledFeatures?.includes?.('depth-sensing') && session.depthUsage === 'gpu-optimized';
      this.applyPerformance();
      if (this.session !== session) return;
      try {
        const viewer = await session.requestReferenceSpace('viewer'), source = await session.requestHitTestSource({ space: viewer });
        if (this.session !== session) { source.cancel(); return; }
        this.source = source;
      } catch (error) { if (!this.floorSpace) throw error; }
      if (this.headset && this.ui.panel) { this.ui.panel.start({ session, scene, renderer, avatar: owner }); this.panelStarted = true; }
      this.walkButton();
    } catch (error) {
      const session = this.session;
      if (session) { try { await session.end(); } catch { /* Restore below even when the device already ended it. */ } }
      this.restore(); this.message(error.name === 'NotAllowedError' ? 'Camera permission was declined. You can try AR again.' : 'AR could not start. ' + error.message);
    } finally { this.busy = false; this.ui.button.disabled = false; }
  }
  async toggleCrawl(){
    if(!this.canMove()||this.modeBusy||this.flightMode||this.jumpState)return;
    this.manualOverride(true);
    if(this.crawlMode){const scale=this.owner.group.scale.x;if(this.world&&!this.collisionWorld().canOccupy(this.anchor,this.height*scale,.18*scale)){this.message('There is not enough room to stand here.');return;}this.crawlMode=false;this.direct=this.directRequest=null;this.motionGeneration++;this.owner.setAction?.(null);this.motor.reset();this.walkButton();return;}
    const session=this.session,generation=++this.motionGeneration;this.modeBusy=true;this.stopWalk();this.direct=this.directRequest=null;
    try{const ready=await this.owner.prepareAction('crawl');if(ready!==false&&session===this.session&&generation===this.motionGeneration&&this.canMove()&&this.modeClear('crawl')){this.crawlMode=true;this.direct='crawl';this.directDirection='forward';this.owner.setGaitDirection?.('forward');this.owner.setAction('crawl');this.motor.reset();this.runtimeError=null;}}
    catch(error){if(session===this.session&&generation===this.motionGeneration)this.message(error.message);}
    finally{if(session===this.session&&generation===this.motionGeneration){this.modeBusy=false;this.walkButton();}}
  }
  async toggleFly(fromStretch=false){
    if(!this.canMove()||this.modeBusy||this.jumpState)return;
    if(this.flightMode){this.manualOverride(true);this.flying=false;this.flightAxis=0;this.motor.grounded=false;this.walkButton();return;}
    const scale=this.owner.group.scale.x,lift=.15*scale;if(this.world&&!this.collisionWorld().canOccupy(this.anchor.clone().setY(this.anchor.y+lift),this.height*scale,.18*scale)){this.message('There is not enough room to take off here.');return;}
    this.manualOverride(true);
    const session=this.session,generation=++this.motionGeneration;this.modeBusy=true;this.stopWalk();this.direct=this.directRequest=null;
    try{const ready=await this.owner.prepareAction('fly');if(ready!==false&&session===this.session&&generation===this.motionGeneration&&this.canMove()&&(!fromStretch||!this.crouchHeld)&&!this.trackingPaused&&this.modeClear('fly',false,lift)){this.anchor.y+=lift;this.flightMode=this.flying=true;this.flightLandTime=0;this.landingBlocked=false;this.crawlMode=false;this.direct='fly';this.directDirection='forward';this.owner.setGaitDirection?.('forward');this.owner.setAction('fly');this.motor.reset();this.motor.grounded=false;this.runtimeError=null;}}
    catch(error){if(session===this.session&&generation===this.motionGeneration)this.message(error.message);}
    finally{if(session===this.session&&generation===this.motionGeneration){this.modeBusy=false;this.walkButton();}}
  }
  walkButton() {
    if(this.ui.crawl){this.ui.crawl.textContent=this.crawlMode?'Stand from crawl':'Crawl';this.ui.crawl.disabled=!this.canMove()||this.modeBusy||this.flightMode||!!this.jumpState;}
    if(this.ui.fly){this.ui.fly.textContent=this.flightMode?(this.flying?'Land':this.landingBlocked?'Move to clear floor':'Landing…'):'Fly';this.ui.fly.disabled=!this.canMove()||this.modeBusy||!!this.jumpState||this.flightMode&&!this.flying;}
    if (this.ui.walk) { this.ui.walk.disabled = !this.placed || !this.destination && !this.direct && !this.directRequest || !!this.chooseSeat || !!this.seatPoint || !!this.owner.aPose; this.ui.walk.textContent = 'Stop walking'; }
    if (this.ui.sit) { this.ui.sit.disabled = !this.placed || !!this.seatBusy || !!this.owner.aPose || this.flightMode || !this.motor.grounded; this.ui.sit.textContent = this.seatPoint ? 'Stand' : this.chooseSeat ? 'Cancel seat' : 'Sit on a chair'; }
    if (this.ui.turn) this.ui.turn.disabled = !this.seatPoint;
    if (this.ui.seatHeightControls) this.ui.seatHeightControls.hidden = !this.chooseSeat;
    this.setSeatHeight(this.manualSeatHeight * 100);
  }
  setSeatHeight(cm) { this.manualSeatHeight = THREE.MathUtils.clamp(Number(cm) || 45, 20, 90) / 100; if (this.ui.seatHeight) this.ui.seatHeight.value = Math.round(this.manualSeatHeight * 100); if (this.ui.seatHeightLabel && this.ui.seatHeightLabel.textContent!==Math.round(this.manualSeatHeight*100)+' cm') this.ui.seatHeightLabel.textContent = Math.round(this.manualSeatHeight * 100) + ' cm'; }
  stopMotion() { this.moveBasis = null; this.motor.reset();this.moveVelocity=this.motor.velocity; this.motionGeneration++;this.modeBusy=false;this.jumpBusy=false; this.jumpState = null; this.jumpHeight = 0; this.direct = this.directRequest = null; this.owner.setAction?.(null); this.stopWalk(); this.walkMode = false; this.stand(true); }
  stand(force = false) {
    const wasSeated=!!this.seatPoint,from=this.owner.group.position.clone();
    if(this.seatPoint && this.world && (this.world.hasGeometry || this.world.everDetected || !this.world.complete)) {
      const scale=this.owner.group.scale.x,forward=new THREE.Vector3(0,0,1).applyQuaternion(this.owner.group.quaternion),point=this.collisionWorld().clearStandingPoint(this.anchor,forward,this.height*scale,.18*scale);
      if(point)this.anchor.copy(point);
      else {this.message('No clear floor beside this chair. Choose Reposition to place the avatar again.');if(!force)return false;this.placed=false;this.owner.group.visible=false;if(this.shadow)this.shadow.visible=false;}
    }
    this.moveBasis=null;this.motor.reset();this.moveVelocity=this.motor.velocity;this.motionGeneration++;this.modeBusy=false;this.jumpBusy=false;this.jumpState=null;this.jumpHeight=0;this.direct=this.directRequest=null;this.owner.setAction?.(null);this.crawlMode=false;this.chooseSeat=false;this.seatPoint=null;this.seatMode=null;this.crouchTime=0;this.floorSitBusy=false;this.seatBusy=false;this.owner.setSitting?.(false);this.posePositionTransition=wasSeated&&!force?{from,age:0}:null;if(this.saved&&this.anchor)this.setSize();this.walkButton();return true;
  }
  async toggleSit() {
    if (!this.placed || this.seatBusy || this.owner.aPose || this.owner.idlePlaying === false || this.jumpState || this.flightMode || !this.motor.grounded) return;
    this.manualOverride(true);
    if (this.seatPoint || this.chooseSeat) { this.stand(); return; }
    const session = this.session, generation = ++this.motionGeneration; this.stopWalk(); this.direct = this.directRequest = null; this.owner.setAction?.(null); this.walkMode = false; this.seatBusy = true; this.walkButton();
    try { await this.owner.prepareSitting(); if (this.session === session && this.motionGeneration === generation && this.placed && !this.owner.aPose) this.chooseSeat = true; } catch (error) { if(this.session===session&&generation===this.motionGeneration)this.message(error.message); }
    finally { if(this.session===session&&generation===this.motionGeneration){this.seatBusy = false; this.walkButton();} }
  }
  async sitOnFloor() {
    if (!this.canMove() || this.flightMode || this.crawlMode || !this.motor.grounded || this.floorSitBusy || this.floorSitFailed || !this.crouchHeld || this.crouchTime < HOLD || !this.owner.floorSeatAnchor) return;
    const session=this.session,generation=++this.motionGeneration; this.floorSitBusy=true; this.seatBusy=true; this.direct=this.directRequest=null; this.owner.setAction?.(null); this.stopWalk();
    try { const ready=await this.owner.prepareSitting('floor');
      if (ready!==false && this.session===session && generation===this.motionGeneration && this.placed && this.crouchHeld && this.crouchTime>=HOLD && !this.turnInput && !this.walkIntent && !this.owner.aPose && this.owner.idlePlaying!==false) { this.posePositionTransition={from:this.owner.group.position.clone(),age:0};this.seatMode='floor'; this.seatPoint=this.anchor.clone(); this.owner.setSitting(true,'floor'); this.moveVelocity?.set(0,0,0); this.setSize(); }
    } catch(error) { if(this.session===session&&generation===this.motionGeneration){this.floorSitFailed=true;this.message(error.message);} }
    finally { if(this.session===session&&generation===this.motionGeneration){this.floorSitBusy=false;this.seatBusy=false;this.walkButton();} }
  }
  async toggleWalk() {
    this.motionGeneration++; this.direct = this.directRequest = null; this.owner.setAction?.(null);this.motor.velocity.x=this.motor.velocity.z=0; this.stopWalk(); this.walkMode = false; this.walkButton();
  }
  // The frame clock is not reset here: seated frames call this every frame, which froze pose transitions at standing height.
  stopWalk() { this.destination = null;this.navigationRequest=null; this.owner.setWalking?.(false); this.walkButton(); }
  controller(input) {
    if (this.controllers.has(input)) return this.controllers.get(input);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -3)]), new THREE.LineBasicMaterial({ color: 0x72efcd, transparent: true, depthTest: false, depthWrite: false }));
    line.matrixAutoUpdate = false; line.renderOrder = 9999; line.visible = false; this.owner.scene.add(line);
    const entry = { line, source: null, candidate: null, sourceUnavailable: !this.session.requestHitTestSource }, session = this.session; this.controllers.set(input, entry);
    session.requestHitTestSource?.({ space: input.targetRaySpace }).then(source => { if (this.session !== session || !this.controllers.has(input)) source.cancel(); else entry.source = source; }).catch(() => { entry.sourceUnavailable = true; });
    return entry;
  }
  removeController(input, entry) { entry.source?.cancel(); this.owner.scene.remove(entry.line); entry.line.geometry.dispose(); entry.line.material.dispose(); this.controllers.delete(input); }
  controlsFor(input) {
    const gamepad = input.gamepad;
    if (gamepad?.mapping !== 'xr-standard') return null;
    const face = (input.profiles || []).some(profile => /^(oculus-touch|meta-quest-touch)/.test(profile));
    return { buttons: gamepad.buttons || [], axes: gamepad.axes || [], face };
  }
  canMove() { return this.placed && !this.seatBusy && !this.chooseSeat && !this.seatPoint && !this.owner.aPose && this.owner.idlePlaying !== false; }
  async walkTo(point) {
    this.manualOverride();
    if (!this.canMove() || this.jumpState || this.jumpBusy) return;
    const crouched=this.direct==='crouch',session = this.session, generation = ++this.motionGeneration; if(!crouched)this.direct=null; this.directRequest = null;this.navigationRequest=generation;
    try { const mode=this.flightMode?'fly':this.crawlMode?'crawl':crouched&&!this.standingReady()?'crouch':'walk';const ready=this.owner.prepareLocomotion?await this.owner.prepareLocomotion(mode,'forward'):mode==='walk'?await this.owner.prepareWalking():await this.owner.prepareAction(mode); if (ready !== false && this.session === session && generation === this.motionGeneration && this.canMove()) { if(crouched&&mode==='walk'&&!this.standingReady()){this.direct='crouch';return this.walkTo(point);}this.runtimeError = null; this.destination=point.clone();if(this.flightMode)this.destination.y=Math.max(this.anchor.y,this.groundY+1);this.direct=mode==='walk'?null:mode;this.directDirection='forward';this.owner.setGaitDirection?.('forward');this.owner.setAction?.(mode==='walk'?null:mode);if(mode==='walk')this.owner.setWalking?.(true); this.walkButton(); } }
    catch (error) { if (this.session === session && generation===this.motionGeneration) this.message(error.message); }
    finally { if(this.navigationRequest===generation)this.navigationRequest=null; }
  }
  modeClear(mode,quiet=false,lift=0){
    // Flight is checked above the floor it lifts off from: scanned floors are bumpy and would block a box resting on them.
    const body=this.bodyCapsule(this.owner.group.quaternion,mode),clear=!this.collisionWorld()||this.collisionWorld().canOccupy(this.anchor.clone().add(body.offset).setY(this.anchor.y+lift),body.height,body.radius,false,null,body.segment);
    if(!clear&&!quiet)this.message(this.world?.complete?'There is not enough clear space for this movement mode.':'Room tracking must recover before changing movement mode.');return clear;
  }
  standingReady(){
    const clear=this.modeClear('standing',true);
    if(clear){if(this.standingBlocked)this.runtimeError=null;this.standingBlocked=false;return true;}
    if(!this.standingBlocked){this.standingBlocked=true;this.message('Move to a clear floor before standing up.');}return false;
  }
  flightDirection(move){
    const vertical=this.flying?this.flightAxis*1.2:this.motor.velocity.y,horizontal=(move?.direction.length()||0)*this.motionSpeed();
    return Math.abs(vertical)>Math.max(.01,horizontal)?vertical>0?'up':'down':this.gaitDirection(move);
  }
  gaitDirection(move){
    if(!move?.direction||move.direction.lengthSq()<1e-8)return this.directDirection||'forward';
    const local=move.direction.clone().applyQuaternion(this.owner.group.quaternion.clone().invert());
    return Math.abs(local.x)>Math.abs(local.z)?local.x<0?'right':'left':local.z<0?'backward':'forward';
  }
  async directMotion(mode,direction='forward'){
    if(this.direct==='crouch'&&mode!=='crouch'&&!this.standingReady())return this.directMotion('crouch',direction);
    if(this.direct===mode&&this.directDirection===direction){if(this.directRequest&&(this.directRequest!==mode||this.directionRequest!==direction)){this.motionGeneration++;this.directRequest=this.directionRequest=null;}return;}
    const key=mode+'/'+direction;if(this.directRequest===mode&&this.directionRequest===direction||this.jumpBusy||this.motionFailures?.has(key))return;
    const session=this.session,generation=++this.motionGeneration;this.directRequest=mode;this.directionRequest=direction;this.destination=null;
    try{
      const ready=mode==='stretch'?await this.owner.prepareAction(mode):this.owner.prepareLocomotion?await this.owner.prepareLocomotion(mode,direction):mode==='walk'?await this.owner.prepareWalking():await this.owner.prepareAction(mode);
      if(ready!==false&&session===this.session&&generation===this.motionGeneration&&this.canMove()&&this.directRequest===mode&&this.directionRequest===direction){if(this.direct==='crouch'&&mode!=='crouch'&&!this.standingReady())return;if(['crawl','fly'].includes(mode)&&!this.modeClear(mode)){(this.motionFailures||=new Set()).add(key);return;}this.runtimeError=null;this.direct=mode;this.directDirection=direction;this.owner.setGaitDirection?.(direction);this.owner.setAction?.(mode==='walk'?null:mode,mode==='crouch'?.5:0);if(mode==='walk')this.owner.setWalking?.(true);this.walkButton();}
    }catch(error){if(session===this.session&&generation===this.motionGeneration){(this.motionFailures||=new Set()).add(key);this.message(error.message);}}
    finally{if(generation===this.motionGeneration)this.directRequest=this.directionRequest=null;}
  }
  /** Double jump: a second jump press while airborne takes off into flight from where the avatar is. */
  async flyFromJump() {
    if (!this.canMove() || this.modeBusy || this.flightMode || !this.jumpState || this.motor.grounded) return;
    const session=this.session,generation=++this.motionGeneration;this.modeBusy=true;
    try{const ready=await this.owner.prepareAction('fly');
      if(ready!==false&&session===this.session&&generation===this.motionGeneration&&this.canMove()&&!this.motor.grounded&&!this.trackingPaused&&this.modeClear('fly')){this.jumpState=null;this.jumpHeight=0;this.flightMode=this.flying=true;this.flightLandTime=0;this.landingBlocked=false;this.crawlMode=false;this.direct='fly';this.directDirection='forward';this.owner.setGaitDirection?.('forward');this.owner.setAction('fly');this.motor.velocity.y=Math.max(0,this.motor.velocity.y);this.motor.grounded=false;this.runtimeError=null;}}
    catch(error){if(session===this.session&&generation===this.motionGeneration)this.message(error.message);}
    finally{if(session===this.session&&generation===this.motionGeneration){this.modeBusy=false;this.walkButton();}}
  }
  async jump() {
    if (this.jumpState && !this.jumpBusy) return this.flyFromJump();
    if (!this.canMove() || this.jumpBusy || this.jumpState || this.flightMode || !this.motor.grounded) return;
    const scale=this.owner.group.scale.x;if(this.world&&!this.collisionWorld().canOccupy(this.anchor,this.height*scale,.18*scale)){this.message('There is not enough room to jump here.');return;}
    this.manualOverride(true);
    const session = this.session, generation = ++this.motionGeneration; this.jumpBusy = true; this.destination=null; this.directRequest=null;
    try {
      const ready = await this.owner.prepareAction('jump');
      if (ready !== false && this.session === session && generation === this.motionGeneration && this.canMove() && this.motor.grounded && !this.trackingPaused && this.modeClear('standing')) { const height=THREE.MathUtils.clamp(.8*this.owner.group.scale.x/.75,.4,1.2);if(this.motor.launch(height)){this.runtimeError=null;this.stopWalk();this.direct=this.directRequest=null;this.owner.setAction('jump');this.crawlMode=false;this.jumpState={age:0,duration:2*Math.sqrt(-2*this.motor.gravity*height)/-this.motor.gravity,landingAge:null};this.jumpHeight=0;} }
    } catch (error) { if (this.session === session && generation===this.motionGeneration) this.message(error.message); }
    finally { if(this.session===session&&generation===this.motionGeneration)this.jumpBusy=false; }
  }
  /** A ring at the avatar's feet fills while a stick gesture is held, so the 1 s hold is visible. */
  updateHoldRing(){
    const ring=this.holdRing;if(!ring)return;
    let progress=0;if(this.placed&&!this.trackingPaused){if(!this.flightMode)progress=Math.max(this.stretchHeld||this.modeBusy?(this.stretchTime||0)/HOLD:0,this.crouchHeld&&!this.seatPoint?(this.crouchTime||0)/HOLD:0);else if(this.flying&&this.flightCrouchHeld)progress=(this.flightLandTime||0)/HOLD;}
    progress=Math.min(1,progress);const step=progress>.03?Math.round(progress*48):0;ring.visible=step>0;if(!step)return;
    if(step!==this.holdRingStep){ring.geometry.dispose();ring.geometry=new THREE.RingGeometry(.3,.36,48,1,Math.PI/2,-step/48*Math.PI*2).rotateX(-Math.PI/2);this.holdRingStep=step;}
    ring.position.copy(this.anchor);ring.position.y=(this.flightMode?this.anchor.y:this.groundY??this.anchor.y)+.02;ring.scale.setScalar(this.owner.group.scale.x/.75);
  }
  /** Seconds a gesture has been held; stick wobble shorter than 0.3 s does not restart the count. */
  holdTimer(name,active,elapsed){const time=name+'Time',gap=name+'Gap';if(active){this[gap]=0;return(this[time]||0)+elapsed;}this[gap]=(this[gap]||0)+elapsed;return this[gap]>.3?0:this[time]||0;}
  motionSpeed() { return this.flightMode?2.1:this.crawlMode?.25:this.direct === 'crouch' ? .55 : this.direct === 'run' ? 2.6 : 1.3; }
  bodyCapsule(rotation=this.owner.group.quaternion,modeOverride){
    const scale=this.owner.group.scale.x,native=this.owner.motionCapsule?.(modeOverride);
    if(native&&[native.height,native.radius,...native.offset.toArray()].every(Number.isFinite)&&native.height>0&&native.radius>0){const segment=native.segment?{start:native.segment.start.clone().multiplyScalar(scale).applyQuaternion(rotation),end:native.segment.end.clone().multiplyScalar(scale).applyQuaternion(rotation),box:native.segment.box?new THREE.Box3(native.segment.box.min.clone().multiplyScalar(scale),native.segment.box.max.clone().multiplyScalar(scale)):null,rotation:rotation.clone()}:null;return{height:native.height*scale,radius:native.radius*scale,offset:native.offset.clone().multiplyScalar(scale).applyQuaternion(rotation),segment};}
    return{height:this.height*scale*((modeOverride??this.owner.motionAction)==='crouch'?.65:1),radius:.18*scale,offset:new THREE.Vector3()};
  }
  face(direction, elapsed) {
    if (direction.lengthSq() < 1e-6) return;
    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.atan2(direction.x,direction.z));
    const next=this.owner.group.quaternion.clone().slerp(target,1-Math.exp(-10*elapsed)),body=this.bodyCapsule(next);
    if((body.offset.lengthSq()>0||body.segment)&&this.world&&!this.collisionWorld().canOccupy(this.anchor.clone().add(body.offset),body.height,body.radius,false,null,body.segment))return;
    this.owner.group.quaternion.copy(next);
  }
  moveAvatar(elapsed,move,crouching,stretching=false){
    if(!this.canMove()){this.motor.velocity.set(0,0,0);this.stopWalk();this.direct=this.directRequest=null;this.owner.setAction?.(null);return;}
    this.stretchTime=this.holdTimer('stretch',stretching&&!this.flightMode&&!this.crawlMode&&!this.jumpState&&!this.jumpBusy&&this.motor.grounded,elapsed);
    if(this.stretchTime>=HOLD&&stretching&&!this.modeBusy&&!this.flightMode)this.toggleFly(true);
    if(!move&&!crouching&&!stretching)this.motionFailures?.clear();
    if(!this.jumpState&&!this.jumpBusy&&!this.modeBusy){
      if(this.flightMode)this.directMotion('fly',this.flightDirection(move));else if(this.crawlMode)this.directMotion('crawl');else if(stretching)this.directMotion('stretch');else if(crouching)this.directMotion('crouch',this.gaitDirection(move));else if(move)this.directMotion(move.run?'run':'walk',move.autonomous?'forward':this.gaitDirection(move));else if((this.direct||this.directRequest)&&this.motor.velocity.length()<.03&&(this.direct!=='crouch'||this.standingReady())){this.motionGeneration++;this.direct=this.directRequest=null;this.owner.setAction?.(null);this.owner.setWalking?.(false);}
    }
    const before=this.anchor.clone(),target=new THREE.Vector3();
    if((this.direct||this.jumpState)&&move&&!stretching&&this.direct!=='stretch')target.copy(move.direction).multiplyScalar(this.motionSpeed()*(this.jumpState?.65:1));
    if(this.destination&&!move&&!crouching){const delta=this.destination.clone().sub(before);if(!this.flightMode)delta.y=0;target.copy(delta).normalize().multiplyScalar(this.motionSpeed());if(!this.turnInput)this.face(delta,elapsed);}
    if(this.flightMode&&this.flying)target.y=this.destination&&!move?THREE.MathUtils.clamp((this.destination.y-before.y)*2,-1.2,1.2):this.flightAxis*1.2;
    const body=this.flightMode&&!this.flying?this.bodyCapsule(this.owner.group.quaternion,'standing'):this.bodyCapsule(),safe=this.motor.step(before.clone().add(body.offset),target,elapsed,{world:this.collisionWorld(),height:body.height,radius:body.radius,flying:this.flightMode&&this.flying,floorY:this.groundY??before.y,segment:body.segment}).sub(body.offset);
    this.anchor.copy(safe);this.moveVelocity=this.motor.velocity;const actualSpeed=elapsed>0?Math.hypot(safe.x-before.x,safe.z-before.z)/elapsed:0;
    if(this.flightMode&&this.flying){
      const lowest=this.anchor.y<=(this.groundY??this.anchor.y)+Math.max(.04,.17*this.owner.group.scale.x)||this.flightAxis<0&&safe.y>=before.y-1e-4;
      this.flightLandTime=this.holdTimer('flightLand',lowest&&this.flightCrouchHeld,elapsed);
      if(this.flightLandTime>=HOLD){this.flying=false;this.flightAxis=0;this.motor.grounded=false;this.flightLandTime=0;this.walkButton();}
    }else this.flightLandTime=0;
    this.owner.setCrouchMoving?.(this.direct==='crouch'&&actualSpeed>.01);this.owner.setCrawlMoving?.(this.crawlMode&&actualSpeed>.01);this.owner.setFlightMoving?.(this.flightMode&&elapsed>0&&before.distanceTo(safe)/elapsed>.01);this.owner.setGaitVelocity?.(actualSpeed);
    if(this.motor.grounded)this.groundY=this.anchor.y;
    if(this.jumpState){
      const jump=this.jumpState;jump.age+=elapsed;
      if(this.motor.grounded&&jump.age>.1){jump.landingAge=(jump.landingAge??0)+elapsed;this.owner.setJumpPhase?.(.75+.249*Math.min(1,jump.landingAge/.32));if(jump.landingAge>=.32){this.jumpState=null;this.owner.setAction?.(null);this.walkButton();}}
      else this.owner.setJumpPhase?.(jump.age<.12?.25*jump.age/.12:.25+.5*Math.min(1,(jump.age-.12)/Math.max(.01,jump.duration-.12)));
    }
    if(this.flightMode&&!this.flying&&this.motor.grounded){const standing=this.bodyCapsule(this.owner.group.quaternion,'standing'),clear=!this.collisionWorld()||this.collisionWorld().canOccupy(this.anchor.clone().add(standing.offset),standing.height,standing.radius,false,null,standing.segment);if(clear){this.flightMode=false;this.landingBlocked=false;this.runtimeError=null;this.motionGeneration++;this.direct=this.directRequest=this.directionRequest=null;this.owner.setAction?.(null);this.walkButton();}else if(!this.landingBlocked){this.landingBlocked=true;this.message('Move to a clear floor before standing up.');this.walkButton();}}
    if(this.destination){const startDelta=this.destination.clone().sub(before),endDelta=this.destination.clone().sub(this.anchor);if(!this.flightMode){startDelta.y=endDelta.y=0;}if(endDelta.length()<.015||startDelta.dot(endDelta)<=0){const endpoint=this.world?this.collisionWorld().constrainMove(this.anchor.clone().add(body.offset),this.destination.clone().add(body.offset),body.height,body.radius,body.segment).sub(body.offset):this.destination;if(endpoint.distanceTo(this.destination)<.015){this.anchor.copy(endpoint);this.motor.velocity.set(0,0,0);this.stopWalk();}}else if(this.anchor.distanceToSquared(before)<1e-12&&elapsed>0)this.stopWalk();}
    const still=crouching&&!this.crawlMode&&!this.flightMode&&!stretching&&!move&&!this.turnInput&&!this.jumpState&&!this.jumpBusy&&actualSpeed<.02;
    this.crouchTime=this.holdTimer('crouch',still,elapsed);if(this.crouchTime>=HOLD)this.sitOnFloor();this.setSize();
  }
  roomCandidate(matrix, viewer, floorY) {
    if(this.ui.collision?.value==='floor'&&!this.chooseSeat)return {handled:false,point:null};
    const handled=!!this.world && (this.world.hasGeometry || this.world.everDetected || !this.world.complete);
    if (!handled) return {handled:false,point:null};
    const origin=new THREE.Vector3().setFromMatrixPosition(matrix),direction=new THREE.Vector3(0,0,-1).transformDirection(matrix),hit=this.world.raycast(origin,direction);
    if (!this.placed && !this.chooseSeat && !hit) return {handled:false,point:null};
    if (!hit || this.placed && !this.world.complete) return {handled:true,point:null};
    if (!this.chooseSeat && /^(table|chair|couch|sofa|bed|desk|cabinet|shelf)$/i.test(hit.semanticLabel || '')) return {handled:true,point:null};
    const surface=new THREE.Matrix4().makeTranslation(...hit.point.toArray()); surface.elements[5]=hit.normal.y;
    const point=this.chooseSeat?seatCandidate(surface,viewer,floorY):this.floorPoint(surface,viewer,floorY,hit.semanticLabel);
    // Scanned floors have tilted triangles; a rejected hit at floor height still means the ray reached the floor.
    return {handled:true,point,floorLike:!point&&!this.chooseSeat&&floorY!==null&&Math.abs(hit.point.y-floorY)<.12};
  }
  floorPoint(matrix, viewer, floorY, label = '') {
    const point = floorCandidate(matrix,viewer,this.placed?floorY:null);
    return point && (!this.placed && floorY !== null && label.toLowerCase() !== 'floor' && point.y > floorY + .2 ? null : point);
  }
  hitCandidate(frame, source, viewer, space, floorY) {
    if (!source) return null;
    for (const hit of frame.getHitTestResults(source)) { const pose = hit.getPose(space); if (!pose) continue; const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix), point = this.chooseSeat ? seatCandidate(matrix, viewer, floorY) : this.floorPoint(matrix, viewer, floorY); if (point) return point; }
    return null;
  }
  update(frame, seconds = 0) {
    if (!frame || !this.session || !this.reticle) return;
    const elapsed = this.lastTime == null ? 0 : THREE.MathUtils.clamp(seconds - this.lastTime, 0, .1); this.lastTime = seconds;
    const space = this.owner.renderer.xr.getReferenceSpace(); if (!space) return;
    let headPose,view;try{headPose=frame.getViewerPose?.(space);view=headPose?.transform.position;}catch{view=null;}const viewerTracked=!!view&&[view.x,view.y,view.z].every(Number.isFinite),viewer=viewerTracked?new THREE.Vector3(view.x,view.y,view.z):this.owner.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3());
    // Frame rate is reported once per second so the status text does not force panel redraws every frame.
    if(elapsed>0){this.frameTimes=(this.frameTimes||0)+elapsed;this.frameCount=(this.frameCount||0)+1;if(this.frameTimes>=1){this.fps=Math.round(this.frameCount/this.frameTimes);this.frameTimes=this.frameCount=0;}}
    this.world?.update(frame,space);const occlusion=this.performance().occlusion,depthMesh=this.owner.renderer.xr.getDepthSensingMesh?.();if(depthMesh)depthMesh.visible=occlusion==='depth';
    const roomStatus=(this.ui.collision?.value==='floor'?'Floor only · walls and furniture are ignored'+(occlusion!=='depth'&&this.world?.occlusionText?' · '+this.world.occlusionText:''):this.world?.statusText||'')+(occlusion==='depth'?this.depthActive?' · live depth on (experimental)':this.depthRequested?' · live depth unavailable here':' · live depth after re-entry':'')+(this.fps?' · '+this.fps+' fps':'');if(this.ui.roomStatus&&this.ui.roomStatus.textContent!==roomStatus)this.ui.roomStatus.textContent=roomStatus;
    const inputs = [...(this.session.inputSources || [])], tracked = inputs.filter(input => input.targetRayMode === 'tracked-pointer');
    if (inputs.some(input => input.targetRayMode !== 'screen')) this.headset = true;
    if (this.headset && this.ui.panel && !this.panelStarted) { this.ui.panel.start({session:this.session,scene:this.owner.scene,renderer:this.owner.renderer,avatar:this.owner}); this.panelStarted=true; }
    const panelInputs=this.panelStarted?this.ui.panel.update(frame,space,seconds,{viewerPosition:viewer,inputSources:tracked})?.consumedInputs:new Set(); this.panelInputs=panelInputs||new Set();
    const chord=this.behavior==='puppet'&&['left','right'].every(hand=>tracked.some(input=>input.handedness===hand&&!this.panelInputs.has(input)&&this.controlsFor(input)?.buttons[3]?.pressed));
    if(chord&&!this.puppetChordHeld&&viewerTracked){this.puppetCalibration=null;this.puppetCalibrationRequested=true;}
    this.puppetChordHeld=chord;
    if([...this.panelInputs].some(input=>input.handedness==='left')){if(this.moveVelocity){this.moveVelocity.x=0;this.moveVelocity.z=0;}this.moveBasis=null;if((this.direct||this.directRequest)&&!['crawl','fly'].includes(this.direct||this.directRequest)){this.motionGeneration++;this.direct=this.directRequest=null;this.owner.setAction?.(null);this.stopWalk();}}
    for (const [input, entry] of this.controllers) if (!tracked.includes(input)) this.removeController(input, entry);
    const choosing = !this.placed || this.canMove() && !this.jumpState && !this.jumpBusy || this.chooseSeat, floorY = this.placed ? this.groundY??this.anchor.y : this.floorSpace ? 0 : null;
    this.ui.overlay.dataset && (this.ui.overlay.dataset.headset = String(this.headset));
    let candidate = null, move = null, crouching = false, stretching = false, leftTracked = false, rightTracked = false, anyTracked = false; this.turnInput=0; this.displayRayInput = null; this.stickActive=false;this.flightAxis=0;this.flightCrouchHeld=false;
    for (const input of tracked) {
      const entry=this.controller(input);let pose;try{pose=frame.getPose?.(input.targetRaySpace,space);}catch{pose=null;}if(pose?.transform?.matrix?.length!==16||!Array.from(pose.transform.matrix).every(Number.isFinite))pose=null;if(pose)anyTracked=true;entry.candidate=null; entry.line.visible = !!pose && choosing;
      const controls = this.controlsFor(input), buttons = controls?.buttons || [], left = input.handedness === 'left', right = input.handedness === 'right';
      if(left&&pose)leftTracked=true; if(right&&pose)rightTracked=true;
      const pressed = index => !!buttons[index]?.pressed;
      const recall = left && controls?.face && pressed(5), turn = left && controls?.face && pressed(4), jump = this.behavior!=='puppet' && right && controls?.face && pressed(4);
      if (pose && recall && !entry.recallPressed) this.ui.panel?.recenter?.();
      if (this.panelInputs.has(input)) { entry.recallPressed=recall; entry.jumpPressed=jump; entry.turnPressed=turn; entry.standPressed=Number(controls?.axes?.[3])<-.35;entry.heightStep=0;entry.runPressed=pressed(3);continue; }
      if (viewerTracked && pose && jump && !entry.jumpPressed) this.jump();
      if (viewerTracked && pose && turn && !entry.turnPressed && this.seatPoint) { this.owner.group.rotateY(Math.PI / 4); this.setSize(); }
      entry.recallPressed = recall; entry.jumpPressed = jump; entry.turnPressed = turn;

      const axes = controls?.axes || [], axis = axes.length >= 4 ? Number(axes[3]) || 0 : 0, heightStep = Math.abs(axis) > .65 ? Math.sign(axis) : 0;
      if (pose && right && this.chooseSeat && heightStep && !entry.heightStep) this.setSeatHeight(this.manualSeatHeight * 100 - heightStep * 5); entry.heightStep = heightStep;
      if (pose && right && controls && axes.length>=4 && !this.chooseSeat && !this.owner.aPose && this.owner.idlePlaying!==false) {
        const x=Number(axes[2]),z=Number(axes[3]);if(this.flightMode&&Math.abs(z)>.18)entry.flightAxisUsed=true;else if(Math.abs(z)<=.18)entry.flightAxisUsed=false;
        // A mostly vertical right stick is a stretch/crouch/altitude gesture; sideways drift must not turn or reset its hold timer.
        const vertical=Number.isFinite(z)&&Math.abs(z)>.35&&Math.abs(x)<Math.abs(z)*.75;
        if(Number.isFinite(x)&&Math.abs(x)>.18&&!vertical){this.manualOverride();this.turnInput=-Math.sign(x)*Math.min(1,(Math.abs(x)-.18)/.82)*TURN_RATE;}
        const forward=Number.isFinite(z)&&z<-.35;
        if(this.behavior!=='puppet'&&this.seatPoint&&forward&&!entry.standPressed){this.stand();entry.standPressed=true;}else if(!forward)entry.standPressed=false;
        if(this.flightMode&&this.flying){this.flightAxis=Number.isFinite(z)&&Math.abs(z)>.18?-Math.sign(z)*Math.min(1,(Math.abs(z)-.18)/.82):0;this.flightCrouchHeld=Number.isFinite(z)&&z>.35;}
        else if(this.behavior!=='puppet'&&!this.crawlMode&&!entry.flightAxisUsed&&(this.canMove()||this.floorSitBusy)){crouching=Number.isFinite(z)&&z>.35;stretching=forward&&!entry.standPressed;if(crouching||stretching)this.manualOverride();}
      }
      if (pose && left && controls && axes.length >= 4 && (this.canMove()||this.floorSitBusy)) {
        const x=Number(axes[2]),z=Number(axes[3]),magnitude=Math.hypot(x,z),click=pressed(3);
        if(viewerTracked&&this.behavior!=='puppet'&&this.ui.runMode?.value!=='hold'&&click&&!entry.runPressed)this.runToggled=!this.runToggled;
        if(Number.isFinite(magnitude)&&magnitude>.18){this.stickActive=true;this.manualOverride();if(this.destination||this.navigationRequest){this.destination=null;this.navigationRequest=null;this.motionGeneration++;this.directRequest=this.directionRequest=null;}const forward=new THREE.Vector3(0,0,1).applyQuaternion(this.owner.group.quaternion),rightward=new THREE.Vector3(-1,0,0).applyQuaternion(this.owner.group.quaternion);move={direction:rightward.multiplyScalar(x).addScaledVector(forward,-z).normalize().multiplyScalar(Math.min(1,(magnitude-.18)/.82)),run:this.ui.runMode?.value==='hold'?click:this.runToggled};}
        entry.runPressed=click;
      }
      if(left&&(!pose||!controls||!(this.canMove()||this.floorSitBusy)))entry.runPressed=pressed(3);
      if (!pose || !choosing) continue;
      entry.line.matrix.fromArray(pose.transform.matrix); const room=this.roomCandidate(entry.line.matrix,viewer,floorY); entry.candidate=room.handled?room.point:this.hitCandidate(frame,entry.source,viewer,space,floorY);
      if ((!room.handled || room.floorLike) && !entry.candidate && floorY !== null && (!this.chooseSeat || entry.sourceUnavailable)) {
        const origin = new THREE.Vector3().setFromMatrixPosition(entry.line.matrix), direction = new THREE.Vector3(0, 0, -1).transformDirection(entry.line.matrix);
        const height = floorY + (this.chooseSeat ? this.manualSeatHeight : 0);
        if (direction.y < -.05) { const distance = (height - origin.y) / direction.y; if (distance > 0 && distance < 4) { const matrix = new THREE.Matrix4().makeTranslation(...origin.addScaledVector(direction, distance).toArray()); entry.candidate = this.chooseSeat ? seatCandidate(matrix, viewer, floorY) : floorCandidate(matrix, viewer, floorY); } }
      }
      if (entry.candidate && this.placed && entry.candidate.distanceTo(this.anchor.clone().setY(this.groundY??this.anchor.y)) > 3) entry.candidate = null;
      const end = entry.candidate ? entry.candidate.clone().applyMatrix4(entry.line.matrix.clone().invert()) : new THREE.Vector3(0, 0, -3); entry.line.geometry.attributes.position.setXYZ(1, end.x, end.y, end.z); entry.line.geometry.attributes.position.needsUpdate = true;
      if (entry.candidate && (!candidate || input.handedness === 'right')) { candidate = entry.candidate; this.displayRayInput = input; }
    }
    for (const [input, entry] of this.controllers) entry.line.visible &&= input === this.displayRayInput;
    if(!this.stickActive)this.moveBasis=null;
    if(!leftTracked){if(this.moveVelocity){this.moveVelocity.x=0;this.moveVelocity.z=0;}this.moveBasis=null;if((this.direct||this.directRequest)&&!['crouch','stretch','crawl','fly'].includes(this.direct||this.directRequest)){this.motionGeneration++;this.direct=this.directRequest=null;this.owner.setAction?.(null);this.owner.setWalking?.(false);}}
    if (!rightTracked) { crouching=stretching=false;this.turnInput=0;this.flightAxis=0;this.flightCrouchHeld=false; }
    this.crouchHeld=crouching;this.stretchHeld=stretching;this.walkIntent=!!move;
    if(this.turnInput&&this.placed&&viewerTracked&&this.canMove()){const next=this.owner.group.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),this.turnInput*elapsed)),body=this.bodyCapsule(next);if((body.offset.lengthSq()>0||body.segment)&&this.world&&!this.collisionWorld().canOccupy(this.anchor.clone().add(body.offset),body.height,body.radius,false,null,body.segment))this.turnInput=0;else{this.owner.group.quaternion.copy(next);move?.direction.applyAxisAngle(new THREE.Vector3(0,1,0),this.turnInput*elapsed);this.setSize();}}
    if(move||this.jumpState||this.jumpBusy)this.crouchTime=this.crouchGap=0;
    if(!crouching)this.floorSitFailed=false;
    if((!crouching&&this.directRequest==='crouch')||(!stretching&&this.directRequest==='stretch')){this.motionGeneration++;this.directRequest=null;}
    this.trackingPaused=!viewerTracked||this.headset&&!anyTracked;
    if(this.posePositionTransition&&!this.trackingPaused)this.posePositionTransition.age+=elapsed;
    this.updatePuppet(frame,space,headPose,tracked,elapsed);
    if(this.behavior==='follow'){
      if(this.canMove()&&!this.trackingPaused&&!this.jumpState&&!this.flightMode&&!this.crawlMode&&!crouching&&!stretching){
        const follow=this.follower.tick({world:this.collisionWorld(),position:this.anchor,viewer,body:this.bodyCapsule(),groundY:this.groundY??this.anchor.y,seconds});this.companionStatus=follow.status;
        if(follow.direction){this.face(follow.direction,elapsed);move={direction:follow.direction,run:!!follow.run,autonomous:true};}
        else this.motor.velocity.x=this.motor.velocity.z=0;
      }else this.companionStatus='Follow paused · place a standing avatar with valid room tracking.';
    }
    if(this.anchor){if(this.trackingPaused){this.motor.velocity.set(0,0,0);this.crouchTime=this.stretchTime=this.flightLandTime=0;this.puppetCalibrationRequested=false;this.owner.setGaitVelocity?.(0);this.owner.setCrawlMoving?.(false);this.owner.setFlightMoving?.(false);}else this.moveAvatar(elapsed,move,crouching,stretching);}
    this.updateHoldRing();
    if (!this.headset && choosing) { const camera=this.owner.renderer.xr.getCamera(),matrix=new THREE.Matrix4().compose(viewer,camera.getWorldQuaternion(new THREE.Quaternion()),new THREE.Vector3(1,1,1)),room=this.roomCandidate(matrix,viewer,floorY); candidate=room.handled?room.point:this.hitCandidate(frame,this.source,viewer,space,floorY); }
    this.phoneCandidate = !this.headset ? candidate : null; this.reticle.visible = !!candidate; if (candidate) this.reticle.matrix.makeTranslation(...candidate.toArray());
    let hint = this.headset ? !tracked.length ? 'Connect a controller. Point its ray at the floor and press the trigger.' : candidate ? this.placed ? 'Point at a floor destination and press the trigger to walk.' : 'Press the trigger to place your avatar on the floor.' : this.placed ? 'Point at the ground and press the trigger to walk there.' : 'Point a controller ray down at the floor.' : candidate ? this.placed ? 'Tap a floor destination to walk there.' : 'Tap the ring to place your avatar.' : this.placed ? 'Tap the ground ring to walk there.' : 'Move your phone slowly and point at the floor.';
    if (this.chooseSeat) hint = 'Point at the chair seat, then ' + (this.headset ? 'press the trigger. Manual seat: ' + Math.round(this.manualSeatHeight * 100) + ' cm; thumbstick up/down adjusts height.' : 'tap the ring.');
    if (this.seatPoint) hint = 'Seated. Use Turn to face the chair’s front, or Stand to return to the floor.';
    if(this.trackingPaused)hint=(this.headset?'Headset or controller':'Camera')+' tracking lost. Movement is paused.';
    if(this.companionStatus)hint=this.companionStatus+' '+hint;
    if(this.runtimeError)hint=this.runtimeError+' '+hint;
    if(this.ui.hint.textContent!==hint)this.ui.hint.textContent=hint;
  }
  async place(event) {
    if (this.panelStarted && this.ui.panel.select(event,this.owner.renderer.xr.getReferenceSpace())) return;
    if(this.trackingPaused)return;
    const input = event?.inputSource, anchor = this.headset ? input?.targetRayMode === 'tracked-pointer' ? this.controllers.get(input)?.candidate : null : this.phoneCandidate;
    if (!anchor || this.headset && input !== this.displayRayInput || this.placed && !this.chooseSeat && !this.canMove()) return;
    if (input?.targetRayMode === 'tracked-pointer') { this.activeRayInput = input; this.reticle.matrix.makeTranslation(...anchor.toArray()); }
    if (this.chooseSeat) {
      this.posePositionTransition={from:this.owner.group.position.clone(),age:0};this.anchor.x = anchor.x; this.anchor.z = anchor.z; this.seatPoint = anchor.clone(); this.chooseSeat = false; this.seatMode='chair'; this.owner.setSitting(true);
      const direction = this.owner.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3()).sub(anchor); this.owner.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(direction.x, direction.z)); this.setSize(); this.walkButton(); return;
    }
    if (this.placed) { await this.walkTo(anchor); return; }
    const owner = this.owner, body=this.bodyCapsule();
    if(this.world && !this.collisionWorld().canOccupy(anchor,body.height,body.radius,true)){this.message('Choose a clear floor spot away from walls and furniture.');return;}
    const viewer = owner.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3()), direction = viewer.sub(anchor);
    this.anchor = anchor.clone();this.groundY=anchor.y;this.motor.reset();this.crawlMode=this.flightMode=this.flying=false; this.setSize();
    // Native avatar front is +Z; keep it upright and face the phone.
    owner.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(direction.x, direction.z));
    owner.group.visible = true; this.shadow.visible = true; this.placed = true; this.reticle.visible = false; this.preloadGestures();
    this.ui.hint.textContent = 'Walk around your avatar. Use Reposition to choose another spot.'; this.walkButton();
  }
  /** Loads hold-gesture clips in the background so the first takeoff or floor sit does not wait for downloads. */
  async preloadGestures(){const session=this.session,owner=this.owner;try{for(const name of ['stretch','crouch','fly']){if(this.session!==session)return;await owner.prepareAction?.(name);}if(this.session===session)await owner.prepareSitting?.('floor');}catch{/* The gesture itself reports loading errors. */}}
  avatarChanged(standingBounds=null) {
    if (!this.session || !this.saved) return;
    const bounds=standingBounds?standingBounds.clone():new THREE.Box3(),currentCasters=new Set();this.owner.group.traverse(object=>{if(object.isMesh)currentCasters.add(object);});
    for(const [object,original] of this.saved.casters)if(!currentCasters.has(object)){object.castShadow=original;this.saved.casters.delete(object);}
    for(const item of this.owner.active || []) {
      if(!standingBounds&&item.geometry.boundingBox)bounds.union(item.geometry.boundingBox);
      item.mesh.traverse(object=>{if(object.isMesh){if(!this.saved.casters.has(object))this.saved.casters.set(object,object.castShadow);object.castShadow=true;}});
    }
    const height=bounds.max.y-bounds.min.y;
    if(Number.isFinite(height)&&height>0){this.floor=bounds.min.y;this.height=height;this.setSize();this.checkPlacementClearance();}
  }
  checkPlacementClearance(){
    if(!this.placed||!this.anchor||!this.collisionWorld()||this.seatPoint)return true;
    if(!this.collisionWorld().complete){this.motor.velocity.set(0,0,0);return true;}
    const body=this.bodyCapsule(this.owner.group.quaternion,this.flightMode?'fly':this.crawlMode?'crawl':undefined);
    if(this.collisionWorld().canOccupy(this.anchor.clone().add(body.offset),body.height,body.radius,false,null,body.segment))return true;
    this.motionGeneration++;this.modeBusy=this.jumpBusy=false;this.direct=this.directRequest=this.directionRequest=null;this.destination=this.jumpState=null;this.crawlMode=this.flightMode=this.flying=false;this.motor.reset();this.owner.setAction?.(null);this.owner.setWalking?.(false);this.placed=false;this.owner.group.visible=false;if(this.shadow)this.shadow.visible=false;this.walkButton();this.message('This avatar shape needs a clearer spot. Point at a clear floor to place it again.');return false;
  }
  posePosition(target){
    const transition=this.posePositionTransition;
    if(transition){const t=Math.min(1,transition.age/.6);target=transition.from.clone().lerp(target,t*t*(3-2*t));
      let low=Infinity;for(const item of this.owner.active||[])if(item.definition.name===this.owner.currentBody||item.definition.name.startsWith('RobotBody_')||/^(shoes_|RobotShoe)/.test(item.definition.name)){const positions=this.owner.posedPositions?.(item)||item.geometry.getAttribute('position').array;for(let i=1;i<positions.length;i+=3)low=Math.min(low,positions[i]);}
      if(Number.isFinite(low))target.y=Math.max(target.y,(this.groundY??this.anchor.y)-low*this.owner.group.scale.x);
      if(t>=1)this.posePositionTransition=null;
    }
    this.owner.group.position.copy(target);
  }
  refreshPoseGround(){
    if(!this.session||!this.saved||!this.anchor)return;
    if(this.seatPoint){const contact=this.seatMode==='floor'?this.owner.floorSeatAnchor():this.owner.seatAnchor();this.posePosition(this.seatPoint.clone().sub(contact.multiplyScalar(this.owner.group.scale.x).applyQuaternion(this.owner.group.quaternion)));return;}
    const contact=this.owner.motionGroundAnchor?.()||this.posePositionTransition&&new THREE.Vector3(0,this.floor,0);if(contact)this.posePosition(this.anchor.clone().sub(contact.multiplyScalar(this.owner.group.scale.x).applyQuaternion(this.owner.group.quaternion)));
  }
  setSize() {
    const percent = THREE.MathUtils.clamp(Number(this.ui.size.value) || 75, 25, 125), scale = percent / 100;
    if(this.ui.sizeLabel.textContent!==percent+'%')this.ui.sizeLabel.textContent=percent+'%';
    if (!this.saved) return;
    this.owner.group.scale.setScalar(scale);
    if (!this.anchor) return;
    if (this.seatPoint) this.posePosition(this.seatPoint.clone().sub((this.seatMode==='floor'?this.owner.floorSeatAnchor():this.owner.seatAnchor()).multiplyScalar(scale).applyQuaternion(this.owner.group.quaternion)));
    else { this.posePosition(this.anchor.clone().sub((this.owner.motionGroundAnchor?.()||new THREE.Vector3(0,this.floor,0)).multiplyScalar(scale).applyQuaternion(this.owner.group.quaternion))); }
    const height = this.height * scale, radius = height * 1.1, camera = this.shadowLight.shadow.camera;
    this.shadow.position.copy(this.anchor); this.shadow.position.y=(this.groundY??this.anchor.y)+.002; this.shadow.scale.setScalar(height * 3);
    this.shadowLight.position.copy(this.anchor).add(new THREE.Vector3(-height, height * 2, height));
    this.shadowLight.target.position.copy(this.anchor).add(new THREE.Vector3(0, height / 2, 0));
    camera.left = camera.bottom = -radius; camera.right = camera.top = radius; camera.near = .01; camera.far = height * 5; camera.updateProjectionMatrix();
  }
  restore() {
    this.puppetCalibration=null;this.puppetCalibrationRequested=this.puppetChordHeld=false;this.owner.setPuppetTargets?.(null);this.owner.setPuppetMode?.(false);this.owner.animationStride=1;this.fps=this.frameTimes=this.frameCount=0;this.follower?.reset();this.companionStatus=null;this.posePositionTransition=null;this.floorWorld=null;this.stretchTime=this.flightLandTime=0;this.stretchHeld=this.flightCrouchHeld=false;this.runToggled=false;this.world?.restore(); this.world=null; if(this.panelStarted)this.ui.panel?.restore();this.panelStarted=false;this.panelInputs=null;this.moveBasis=null;this.motor.reset();this.moveVelocity=this.motor.velocity;this.crawlMode=this.flightMode=this.flying=false;this.landingBlocked=this.standingBlocked=false;this.modeBusy=false;this.groundY=null;this.jumpBusy=false;this.directDirection=this.directionRequest=null;this.flightAxis=0;this.trackingPaused=false;if(this.ui.roomStatus)this.ui.roomStatus.textContent='';
    this.motionGeneration++; this.direct = this.directRequest = null; this.jumpState = null; this.jumpHeight = 0; this.owner.setAction?.(null);
    this.chooseSeat = false; this.seatPoint = null; this.seatMode=null; this.crouchTime=0; this.crouchHeld=false; this.floorSitBusy=false; this.floorSitFailed=false; this.seatBusy=false; this.owner.setSitting?.(false);
    this.stopWalk(); this.lastTime = null; this.walkMode = false; this.phoneCandidate = null;
    for (const [input, entry] of this.controllers) this.removeController(input, entry);
    this.motionFailures?.clear(); this.runtimeError = null; this.activeRayInput = this.displayRayInput = null; if (this.ui.overlay.dataset) delete this.ui.overlay.dataset.headset;
    this.source?.cancel(); this.source = null; this.session = null; this.placed = false; this.anchor = null;
    if (this.reticle) { this.owner.scene.remove(this.reticle); this.reticle.geometry.dispose(); this.reticle.material.dispose(); this.reticle = null; }
    if (this.holdRing) { this.owner.scene.remove(this.holdRing); this.holdRing.geometry.dispose(); this.holdRing.material.dispose(); this.holdRing = null; }
    this.depthActive = this.depthRequested = false;
    if (this.shadow) { this.owner.scene.remove(this.shadow); this.shadow.geometry.dispose(); this.shadow.material.dispose(); this.shadow = null; }
    if (this.shadowLight) { this.owner.scene.remove(this.shadowLight, this.shadowLight.target); this.shadowLight.shadow.dispose(); this.shadowLight = null; }
    const saved = this.saved, owner = this.owner;
    if (saved) {
      owner.group.position.copy(saved.position); owner.group.quaternion.copy(saved.quaternion); owner.group.scale.copy(saved.scale); owner.group.visible = saved.visible;
      for (const [object, castShadow] of saved.casters) object.castShadow = castShadow;
      owner.renderer.shadowMap.enabled = saved.shadowsEnabled; owner.renderer.shadowMap.type = saved.shadowType; owner.renderer.xr.enabled = saved.xrEnabled;
      owner.scene.background = saved.background; owner.renderer.setClearAlpha(saved.clearAlpha);
      owner.camera.position.copy(saved.cameraPosition); owner.camera.quaternion.copy(saved.cameraQuaternion);
      owner.controls.target.copy(saved.target); owner.controls.enabled = saved.controlsEnabled;
      this.saved = null; queueMicrotask(() => owner.resize());
    }
    this.ui.overlay.hidden = true; this.ui.button.disabled = false; this.walkButton();
  }
}
