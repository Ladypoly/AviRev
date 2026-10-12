import * as THREE from './libs/three/package/build/three.module.js';
import { MeshBVH, CENTER } from './libs/three-mesh-bvh/index.module.mjs';

const MAX_TRIANGLES = 250000, MAX_ENTRIES = 128, MAX_VERTICES = 200000, MAX_ROOM_VERTICES = 400000;
const semanticPriority=label=>/^(table|chair|couch|sofa|bed|desk|cabinet|shelf)$/i.test(label||'')?2:label?1:0;
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), closest = new THREE.Vector3(), triangle = new THREE.Triangle();
function segmentDistance(p, q, r, s, normal = null) {
  const u = q.clone().sub(p), v = s.clone().sub(r), w = p.clone().sub(r), aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w), determinant = aa * cc - bb * bb;
  let first = determinant > 1e-12 ? THREE.MathUtils.clamp((bb * ee - cc * dd) / determinant, 0, 1) : 0;
  let second = cc > 1e-12 ? (bb * first + ee) / cc : 0;
  if (second < 0) { second = 0; first = aa > 1e-12 ? THREE.MathUtils.clamp(-dd / aa, 0, 1) : 0; }
  else if (second > 1) { second = 1; first = aa > 1e-12 ? THREE.MathUtils.clamp((bb - dd) / aa, 0, 1) : 0; }
  const delta = p.clone().addScaledVector(u, first).sub(r.clone().addScaledVector(v, second)); if(normal)normal.copy(delta); return delta.lengthSq();
}
function capsuleTriangleDistance(start, end, aa, bb, cc, normal = null) {
  const direction = end.clone().sub(start), length = direction.length();
  if (length > 1e-9 && new THREE.Ray(start, direction.divideScalar(length)).intersectTriangle(aa, bb, cc, false, closest) && closest.distanceToSquared(start) <= length * length) { if(normal){triangle.set(aa,bb,cc).getNormal(normal);if(normal.dot(start.clone().sub(closest))<0)normal.negate();}return 0; }
  triangle.set(aa, bb, cc);
  triangle.closestPointToPoint(start,closest); let distance=closest.distanceToSquared(start);if(normal)normal.subVectors(start,closest);
  triangle.closestPointToPoint(end,closest);const endDistance=closest.distanceToSquared(end);if(endDistance<distance){distance=endDistance;if(normal)normal.subVectors(end,closest);}
  const edgeNormal=normal?new THREE.Vector3():null;
  for (const [p, q] of [[aa, bb], [bb, cc], [cc, aa]]) { const edgeDistance=segmentDistance(start,end,p,q,edgeNormal);if(edgeDistance<distance){distance=edgeDistance;if(normal)normal.copy(edgeNormal);} }
  return distance;
}
function makeGeometry(source, kind) {
  let positions, indices;
  if (kind === 'mesh') {
    if (!source.vertices || !source.indices || source.vertices.length % 3 || source.indices.length % 3) throw new Error('Malformed mesh vertex/index arrays');
    if(source.vertices.length>MAX_VERTICES*3||source.indices.length>MAX_TRIANGLES*3)throw new Error('Mesh budget exceeded: '+source.indices.length/3+' triangles, '+source.vertices.length/3+' vertices (limits '+MAX_TRIANGLES+'/'+MAX_VERTICES+')');
    if (Array.from(source.indices).some(index => !Number.isInteger(index) || index < 0)) throw new Error('Invalid detected room indices.');
    positions = Float32Array.from(source.vertices); indices = Uint32Array.from(source.indices);
  } else {
    const polygon = [...(source.polygon || [])];
    if (polygon.length>256)throw new Error('Plane vertex limit exceeded: '+polygon.length+' (max 256)');
    if (polygon.some(p=>![p.x,p.y,p.z].every(Number.isFinite)))throw new Error('Nonfinite plane vertex');
    if(polygon.length<3)return {empty:true,triangles:0};
    const origin=new THREE.Vector3(polygon[0].x,polygon[0].y,polygon[0].z),vectors=polygon.map(p=>new THREE.Vector3(p.x,p.y,p.z).sub(origin)),edge=vectors.find(v=>v.lengthSq()>0);
    if(!edge||vectors.every(v=>edge.clone().cross(v).lengthSq()===0))return {empty:true,triangles:0};
    if(polygon.some(p=>p.y!==polygon[0].y))throw new Error('Plane polygon is not in its local XZ plane');
    positions = Float32Array.from(polygon.flatMap(p => [p.x, p.y, p.z]));
    indices = Uint32Array.from(THREE.ShapeUtils.triangulateShape(polygon.map(p => new THREE.Vector2(p.x, p.z)), []).flat());
    const expected=Math.abs(polygon.reduce((sum,p,i)=>{const next=polygon[(i+1)%polygon.length];return sum+p.x*next.z-next.x*p.z;},0))/2;let covered=0;
    for(let i=0;i<indices.length;i+=3){const p=polygon[indices[i]],q=polygon[indices[i+1]],r=polygon[indices[i+2]];covered+=Math.abs((q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x))/2;}
    if(!indices.length||expected===0||Math.abs(expected-covered)>1e-5*Math.max(1,expected))throw new Error('Invalid plane polygon triangulation');
  }
  if (!positions.every(Number.isFinite) || [...indices].some(index => index >= positions.length / 3)) throw new Error('Nonfinite vertices or out-of-range triangle indices');
  const nondegenerate=[];for(let i=0;i<indices.length;i+=3){a.fromArray(positions,indices[i]*3);b.fromArray(positions,indices[i+1]*3).sub(a);c.fromArray(positions,indices[i+2]*3).sub(a);if(b.cross(c).lengthSq()>0)nondegenerate.push(indices[i],indices[i+1],indices[i+2]);}
  if(!nondegenerate.length)return {empty:true,triangles:0};indices=Uint32Array.from(nondegenerate);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.computeBoundingBox();
  geometry.boundsTree = new MeshBVH(geometry, { strategy: CENTER, indirect: true, targetLeafSize: 8 });
  return { geometry, positions, indices, triangles: indices.length / 3 };
}

/** Keeps detected room data only for the current session; no room data is stored or uploaded. */
export class XRWorld {
  constructor(scene = null) {
    this.occluders = scene ? new THREE.Group() : null;
    this.occlusionMaterial = scene ? new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: true, depthTest: true, blending: THREE.NoBlending, toneMapped: false }) : null;
    if (this.occluders) { this.occluders.visible = false; this.occluders.renderOrder = -1000; scene.add(this.occluders); }
    // shortcut: Scanned room surfaces cannot occlude moving hands or unscanned objects; upgrade when per-eye depth sensing is supported correctly.
    this.entries = new Map(); this.detectedKinds = new Set(); this.everDetected = false; this.statusText = 'Room scan unavailable · floor fallback, no obstacle collision'; this.complete = true; this.totalTriangles = 0; }
  update(frame, space) {
    let meshes, planes, readFailure = false;
    try { meshes = frame.detectedMeshes; } catch { meshes = null; readFailure ||= this.detectedKinds.has('mesh'); }
    try { planes = frame.detectedPlanes; } catch { planes = null; readFailure ||= this.detectedKinds.has('plane'); }
    readFailure ||= (meshes == null && this.detectedKinds.has('mesh')) || (planes == null && this.detectedKinds.has('plane'));
    const tracked = new Map();
    for (const [sources,kind] of [[meshes,'mesh'],[planes,'plane']]) { for(const source of sources||[]) { tracked.set(source,kind); this.detectedKinds.add(kind); if(tracked.size>MAX_ENTRIES)break; } if(tracked.size>MAX_ENTRIES)break; }
    let viewerTracked=false; try { const position=frame.getViewerPose?.(space)?.transform?.position; viewerTracked=!!position&&[position.x,position.y,position.z].every(Number.isFinite); } catch { /* Current viewer tracking is required for cached scan use. */ }
    const cached = !readFailure && !tracked.size && this.everDetected && this.entries.size>0;
    // shortcut: A cached static room can miss moved furniture; use live depth once correct per-eye integration is available.
    if(cached)for(const [source,entry] of this.entries)tracked.set(source,entry.kind);
    for (const [source, entry] of this.entries) if (!tracked.has(source)) { this.removeOccluder(entry); entry.geometry?.dispose(); this.entries.delete(source); }
    this.complete = !readFailure && (!cached || viewerTracked) && tracked.size <= MAX_ENTRIES; this.totalTriangles = 0; const duplicates=new Set(),reasons=[];this.skippedEmpty=0;this.duplicateSurfaces=0;if(tracked.size>MAX_ENTRIES)reasons.push('Surface limit exceeded: '+tracked.size+'+ (max '+MAX_ENTRIES+')'); let missing = readFailure || cached && !viewerTracked ? 1 : 0, usable = 0;
    let allocatedTriangles = 0, allocatedVertices = 0;
    for (const [source, kind] of tracked) {
      if (!this.entries.has(source) && this.entries.size >= MAX_ENTRIES) { this.complete = false; continue; }
      let entry = this.entries.get(source);
      const vertices = kind === 'mesh' ? (source.vertices?.length || 0) / 3 : (source.polygon?.length || 0), triangles = kind === 'mesh' ? (source.indices?.length || 0) / 3 : Math.max(0, vertices - 2);
      if (allocatedTriangles + triangles > MAX_TRIANGLES || allocatedVertices + vertices > MAX_ROOM_VERTICES) {
        this.removeOccluder(entry); entry?.geometry?.dispose();
        entry = { wasUsable: entry?.wasUsable || !!entry?.geometry, kind, changed: source.lastChangedTime, active: false, error: 'Room allocation budget exceeded: '+(allocatedTriangles+triangles)+' triangles, '+(allocatedVertices+vertices)+' vertices (limits '+MAX_TRIANGLES+'/'+MAX_ROOM_VERTICES+')' };
        this.entries.set(source, entry); this.complete = false; reasons.push(entry.error); continue;
      }
      allocatedTriangles += triangles; allocatedVertices += vertices;
      if (!entry || entry.changed !== source.lastChangedTime || entry.error?.startsWith('Room allocation budget')) {
        const wasUsable=entry?.wasUsable||!!entry?.geometry;this.removeOccluder(entry); entry?.geometry?.dispose(); entry = { wasUsable, kind, changed: source.lastChangedTime, matrix: new THREE.Matrix4(), inverse: new THREE.Matrix4(), active: false, label: source.semanticLabel || '' };
        try { Object.assign(entry, makeGeometry(source, kind));if(entry.empty&&wasUsable)entry.error='Previously usable surface became empty';if(entry.geometry)entry.wasUsable=true; } catch (error) { entry.error = error.message; }
        this.entries.set(source, entry);
      }
      entry.active = false;
      if (cached && !viewerTracked) continue;
      if(entry.error){this.complete=false;reasons.push(kind+': '+entry.error);continue;}
      if(entry.empty){this.skippedEmpty++;continue;}
      let pose; try { pose = frame.getPose?.(kind === 'mesh' ? source.meshSpace : source.planeSpace, space); } catch { pose = null; }
      if (pose?.transform?.matrix?.length !== 16 || !Array.from(pose.transform.matrix).every(Number.isFinite)) { missing++; this.complete = false; continue; }
      // Pose can change without lastChangedTime changing; always recompute in the renderer's actual reference space.
      entry.matrix.fromArray(pose.transform.matrix); const determinant=entry.matrix.determinant(), basis=[0,4,8].map(i=>new THREE.Vector3().fromArray(entry.matrix.elements,i)); if (!Number.isFinite(determinant) || Math.abs(determinant-1)>.02 || basis.some(v=>Math.abs(v.lengthSq()-1)>.02) || Math.abs(basis[0].dot(basis[1]))>.02 || Math.abs(basis[0].dot(basis[2]))>.02 || Math.abs(basis[1].dot(basis[2]))>.02) { this.complete = false; continue; }
      entry.inverse.copy(entry.matrix).invert();
      // Only equal triangles in the current reference space share a budget slot; distinct nearby walls stay separate.
      if(entry.triangles<=254){
        if(!entry.signaturePose?.equals(entry.matrix)){const faces=[];for(let i=0;i<entry.indices.length;i+=3){const vertices=[];for(let j=0;j<3;j++){a.fromArray(entry.positions,entry.indices[i+j]*3).applyMatrix4(entry.matrix);vertices.push(a.toArray().join(','));}faces.push(vertices.sort().join('/'));}entry.signature=JSON.stringify(entry.label)+'|'+faces.sort().join('|');entry.signaturePose=entry.matrix.clone();}
        if(duplicates.has(entry.signature)){this.duplicateSurfaces++;continue;}duplicates.add(entry.signature);
      }
      if(this.totalTriangles+entry.triangles>MAX_TRIANGLES){this.complete=false;reasons.push('Triangle limit exceeded: '+(this.totalTriangles+entry.triangles)+' (max '+MAX_TRIANGLES+')');continue;}
      this.totalTriangles+=entry.triangles;entry.active = true; usable++;
    }
    this.everDetected ||= usable > 0;
    this.hasGeometry = usable > 0;
    if (!this.complete) this.statusText = missing ? 'Room tracking incomplete: '+missing+' untracked sources - avatar movement paused' : 'Room scan paused - '+(reasons[0]||'Nonrigid room pose');
    else if (usable) this.statusText = (cached ? 'Cached room scan active' : 'Room collision active') + ' · ' + usable + ' detected surfaces';
    else if (this.everDetected) { this.complete = false; this.statusText = 'Room tracking lost · avatar movement paused'; }
    else this.statusText = meshes || planes ? 'No usable scanned surfaces - floor fallback, no obstacle collision' : 'Room scan unavailable - floor fallback, no obstacle collision';
    if(this.skippedEmpty||this.duplicateSurfaces)this.statusText+=' - '+this.skippedEmpty+' empty, '+this.duplicateSurfaces+' duplicate sources skipped';
    this.updateOcclusion();
    this.statusText += this.occluders ? this.complete && this.hasGeometry ? ' · room occlusion active' : !this.complete ? ' · room occlusion paused' : ' · room occlusion unavailable' : ' · room occlusion unavailable';
    return this.statusText;
  }
  removeOccluder(entry) { if (entry?.occluder) { entry.occluder.removeFromParent(); entry.occluder = null; } }
  updateOcclusion() {
    if (!this.occluders) return;
    this.occluders.visible = this.complete && this.hasGeometry;
    for (const entry of this.entries.values()) {
      if (this.occluders.visible && entry.active && !entry.occluder) {
        entry.occluder = new THREE.Mesh(entry.geometry, this.occlusionMaterial);
        entry.occluder.matrixAutoUpdate = false; entry.occluder.renderOrder = -1000; this.occluders.add(entry.occluder);
      }
      if (entry.occluder) { entry.occluder.visible = this.occluders.visible && entry.active; entry.occluder.matrix.copy(entry.matrix); entry.occluder.matrixWorldNeedsUpdate = true; }
    }
  }
  raycast(origin, direction, maxDistance = 4) {
    let result = null, nearest = maxDistance;
    for (const entry of this.entries.values()) {
      if (!entry.active) continue;
      const ray = new THREE.Ray(origin.clone(), direction.clone().normalize()).applyMatrix4(entry.inverse);
      if (!ray.intersectsBox(entry.geometry.boundingBox)) continue;
      // A nearest hit before the near threshold must not hide a farther valid surface.
      const hit = entry.geometry.boundsTree.raycastFirst(ray, THREE.DoubleSide, .01, nearest);
      if (!hit) continue;
      const distance = hit.distance;
      if (distance===nearest && semanticPriority(entry.label)<=semanticPriority(result?.semanticLabel)) continue;
      const worldPoint=hit.point.clone().applyMatrix4(entry.matrix),normal=hit.face.normal.clone().transformDirection(entry.matrix); if (normal.dot(direction)>0) normal.negate();
      result={point:worldPoint,normal,semanticLabel:entry.label,kind:entry.kind,distance}; nearest=distance;
    }
    return result;
  }
  canOccupy(point, height, radius, allowIncomplete = false, contactNormal = null, segment = null) {
    if (![...point.toArray(),height,radius].every(Number.isFinite) || height<=0 || radius<=0) return false;
    if (!this.complete && !allowIncomplete) return false;
    if (segment && (![...segment.start.toArray(), ...segment.end.toArray()].every(Number.isFinite))) return false;
    const envelope=segment?.box,rotation=segment?.rotation;
    if(envelope&&(!rotation||envelope.isEmpty()||![...envelope.min.toArray(),...envelope.max.toArray(),...rotation.toArray()].every(Number.isFinite)||Math.abs(rotation.lengthSq()-1)>.001))return false;
    const boxMatrix=envelope?new THREE.Matrix4().compose(point,rotation,new THREE.Vector3(1,1,1)):null,boxInverse=boxMatrix?.clone().invert(),bodyCenter=envelope?.getCenter(new THREE.Vector3());
    const bottom=point.clone().add(segment?.start || new THREE.Vector3(0,radius+.003,0)),top=point.clone().add(segment?.end || new THREE.Vector3(0,Math.max(radius,height-radius),0));
    let blocked=false,nearest=Infinity;
    for(const entry of this.entries.values()) {
      if(!entry.active)continue;
      const start=bottom.clone().applyMatrix4(entry.inverse),end=top.clone().applyMatrix4(entry.inverse),box=envelope?envelope.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(entry.inverse,boxMatrix)):new THREE.Box3().setFromPoints([start,end]).expandByScalar(radius),normal=contactNormal?new THREE.Vector3():null,triangle=envelope?new THREE.Triangle():null,toBox=envelope?new THREE.Matrix4().multiplyMatrices(boxInverse,entry.matrix):null;
      if(!box.intersectsBox(entry.geometry.boundingBox))continue;
      entry.geometry.boundsTree.shapecast({
        intersectsBounds: bounds=>box.intersectsBox(bounds),
        intersectsTriangle: face=>{
          if(envelope){triangle.copy(face);triangle.a.applyMatrix4(toBox);triangle.b.applyMatrix4(toBox);triangle.c.applyMatrix4(toBox);if(!triangle.intersectsBox(envelope))return false;blocked=true;if(contactNormal){const closest=triangle.closestPointToPoint(bodyCenter,new THREE.Vector3()),distance=closest.distanceToSquared(bodyCenter);if(distance<nearest){nearest=distance;normal.copy(bodyCenter).sub(closest);if(normal.lengthSq()<1e-12)triangle.getNormal(normal);contactNormal.copy(normal).applyQuaternion(rotation).normalize();}}return !contactNormal;}
          const distance=capsuleTriangleDistance(start,end,face.a,face.b,face.c,normal);
          if(distance<(radius-.002)**2){blocked=true;if(contactNormal&&distance<nearest){nearest=distance;contactNormal.copy(normal).transformDirection(entry.matrix);}return !contactNormal;}
          return false;
        }
      });
      if(blocked&&!contactNormal)return false;
    }
    return !blocked;
  }
  groundSupport(point, maxDown, radius) {
    if(!this.complete||!this.hasGeometry||![...point.toArray(),maxDown,radius].every(Number.isFinite)||maxDown<=0||radius<=0)return null;
    let support=null;
    for(const [x,z] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[.707,.707],[-.707,.707],[.707,-.707],[-.707,-.707]]) {
      const origin=point.clone().add(new THREE.Vector3(x*radius*.8,.08,z*radius*.8)),hit=this.raycast(origin,new THREE.Vector3(0,-1,0),maxDown+.08);
      if(!hit||hit.normal.y<.7||/^(ceiling|wall)$/i.test(hit.semanticLabel||'')||hit.point.y>point.y+.08||support&&hit.point.y<=support.point.y)continue;
      support={...hit,point:new THREE.Vector3(point.x,hit.point.y,point.z)};
    }
    return support;
  }
  constrainMove(from, to, height, radius, segment = null) {
    this.moveContacts=[];this.moveBlocked=false;
    if (![...from.toArray(),...to.toArray(),height,radius].every(Number.isFinite) || height<=0 || radius<=0) return from.clone();
    if (!this.complete) return from.clone();
    if (!this.hasGeometry) return to.clone();
    let target=to.clone(),safe=from.clone();
    // Contact projection is inspired by hh-hang/three-player-controller (MIT) (ca82bbc76a3b9b0afa80c73b60167adf6123b9b6); XR validation and bounded sweeps stay local.
    for(let pass=0;pass<3;pass++){
      const origin=safe.clone(),distance=origin.distanceTo(target),steps=Math.max(1,Math.ceil(distance/Math.min(.03,radius*.5)));
      if(steps>64)return safe;
      let blocked=false;const normal=new THREE.Vector3();
      for(let i=1;i<=steps;i++){const next=origin.clone().lerp(target,i/steps);if(!this.canOccupy(next,height,radius,false,normal,segment)){blocked=true;break;}safe=next;}
      if(!blocked)return safe;if(pass===2){this.moveBlocked=true;return safe;}
      if(normal.lengthSq()<1e-12)return safe;normal.normalize();
      const remaining=target.clone().sub(safe),into=remaining.dot(normal);if(into>=-1e-8)return safe;
      this.moveContacts.push(normal.clone());remaining.addScaledVector(normal,-into);
      if(remaining.lengthSq()<1e-12)return safe;target.copy(safe).add(remaining);
    }
    return safe;
  }
  constrainVelocity(velocity) {
    if(!this.complete||this.moveBlocked||!this.moveContacts?.length)return velocity.set(0,0,0);
    for(let pass=0;pass<3;pass++)for(const normal of this.moveContacts){const into=velocity.dot(normal);if(into<0)velocity.addScaledVector(normal,-into);}
    if(this.moveContacts.some(normal=>velocity.dot(normal)<-1e-8))velocity.set(0,0,0);
    return velocity;
  }
  clearStandingPoint(anchor, forward, height, radius) {
    const candidates=[anchor.clone()];
    for(const distance of [.35,.55,.75,1])for(const angle of [0,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2,Math.PI])candidates.push(anchor.clone().addScaledVector(forward.clone().applyAxisAngle(new THREE.Vector3(0,1,0),angle),distance));
    for(const point of candidates) {
      const floor=this.raycast(point.clone().add(new THREE.Vector3(0,.15,0)),new THREE.Vector3(0,-1,0),.25);
      if(!floor||floor.normal.y<.8||Math.abs(floor.point.y-anchor.y)>.08)continue;
      point.y=floor.point.y;if(!this.canOccupy(point,height,radius))continue;
      const delta=point.clone().sub(anchor);delta.y=0;
      if(delta.length()>.01){const wall=this.raycast(anchor.clone().add(new THREE.Vector3(0,height*.7,0)),delta.clone().normalize(),delta.length());if(wall)continue;}
      return point;
    }
    return null;
  }
  restore() { this.occluders?.removeFromParent(); for (const entry of this.entries.values()) { this.removeOccluder(entry); entry.geometry?.dispose(); } this.occlusionMaterial?.dispose(); this.occlusionMaterial = null; this.occluders = null; this.entries.clear(); this.detectedKinds.clear(); this.hasGeometry = false; this.everDetected = false; this.complete = true; this.totalTriangles = 0; }
}
