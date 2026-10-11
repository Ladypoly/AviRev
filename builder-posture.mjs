import * as THREE from './libs/three/package/build/three.module.js';
const point = matrix => new THREE.Vector3().setFromMatrixPosition(matrix);
const up = new THREE.Vector3(0, 1, 0);
const reflection = new THREE.Matrix4().makeScale(-1, 1, 1);
function posed(rest, position, alignment) { const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); rest.decompose(p, q, s); if (alignment) q.premultiply(alignment); return new THREE.Matrix4().compose(position, q, s); }
/** Static standing solve, using imported rest chains. Live ground/tracking targets are separate. */
export function postureMatrices(family, config) {
  const rest = new Map(family.skeleton.map(bone => [bone.path, new THREE.Matrix4().fromArray(bone.matrix)])), parents = new Map(family.skeleton.map(bone => [bone.path, bone.parent])), overrides = new Map(), legs = [];
  if (!config.ToeOut && !config.FeetApart) return { rest, current: rest, legs, approximate: false };
  for (const side of ['left', 'right']) {
    const suffix = side === 'left' ? '.l' : '.r', sign = side === 'left' ? -1 : 1;
    const names = family.Family === 'human' ? ['thigh_stretch' + suffix, 'leg_stretch' + suffix, 'foot' + suffix] : [side === 'left' ? 'LeftUpLeg' : 'RightUpLeg', side === 'left' ? 'LeftLeg' : 'RightLeg', side === 'left' ? 'LeftFoot' : 'RightFoot'];
    const chain = names.map(name => family.skeleton.find(bone => bone.name === name)); if (chain.some(bone => !bone)) throw new Error(`The ${family.Family} ${side} leg chain is missing.`);
    const [upper, lower, foot] = chain, a = point(rest.get(upper.path)), b = point(rest.get(lower.path)), c = point(rest.get(foot.path));
    const target = c.clone().add(new THREE.Vector3(sign * config.FeetApart * .01 * .5, 0, 0)), firstLength = a.distanceTo(b), secondLength = b.distanceTo(c);
    const direction = target.clone().sub(a), requestedDistance = direction.length(); direction.normalize();
    const distance = Math.max(Math.abs(firstLength - secondLength) + 1e-6, Math.min(firstLength + secondLength - 1e-6, requestedDistance));
    const endpoint = a.clone().addScaledVector(direction, distance);
    let pole = b.clone().sub(a).addScaledVector(direction, -b.clone().sub(a).dot(direction)); if (pole.lengthSq() < 1e-10) pole = new THREE.Vector3(0, 0, -1).addScaledVector(direction, direction.z); pole.normalize();
    // FootPlacer rotates its upright foot BASE, whose up differs from the imported foot bone's length axis.
    pole.applyAxisAngle(up, THREE.MathUtils.degToRad(sign * config.ToeOut)); pole.addScaledVector(direction, -pole.dot(direction)).normalize();
    const along = (firstLength * firstLength - secondLength * secondLength + distance * distance) / (2 * distance), height = Math.sqrt(Math.max(0, firstLength * firstLength - along * along));
    const knee = a.clone().addScaledVector(direction, along).addScaledVector(pole, height);
    const upperTurn = new THREE.Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(), knee.clone().sub(a).normalize()), lowerTurn = new THREE.Quaternion().setFromUnitVectors(c.clone().sub(b).normalize(), endpoint.clone().sub(knee).normalize());
    overrides.set(upper.path, posed(rest.get(upper.path), a, upperTurn)); overrides.set(lower.path, posed(rest.get(lower.path), knee, lowerTurn));
    const footRest = rest.get(foot.path), p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3(); footRest.decompose(p, q, scale); q.premultiply(new THREE.Quaternion().setFromAxisAngle(up, THREE.MathUtils.degToRad(sign * config.ToeOut))); overrides.set(foot.path, new THREE.Matrix4().compose(endpoint, q, scale));
    legs.push({ side, upper: a.toArray(), knee: knee.toArray(), foot: endpoint.toArray(), target: target.toArray(), targetError: endpoint.distanceTo(target), firstLength, secondLength });
  }
  const current = new Map();
  for (const bone of family.skeleton) { if (overrides.has(bone.path)) current.set(bone.path, overrides.get(bone.path)); else { let ancestor = parents.get(bone.path); while (ancestor !== null && ancestor !== undefined && !overrides.has(ancestor)) ancestor = parents.get(ancestor); current.set(bone.path, ancestor === null || ancestor === undefined ? rest.get(bone.path) : overrides.get(ancestor).clone().multiply(rest.get(ancestor).clone().invert()).multiply(rest.get(bone.path))); } }
  return { rest, current, legs, approximate: true };
}
export function skinPosture(item, posture) {
  if (!posture.approximate) return;
  const matrices = (item.definition.bones || []).map(bone => reflection.clone().multiply((posture.current.get(bone.path) || new THREE.Matrix4().fromArray(bone.matrix)).clone().multiply(new THREE.Matrix4().fromArray(bone.inverse))).multiply(reflection));
  if (!matrices.length || !item.skinCounts?.length) return;
  const normalMatrices = matrices.map(matrix => new THREE.Matrix3().getNormalMatrix(matrix)), position = item.geometry.getAttribute('position'), normal = item.geometry.getAttribute('normal'), tangent = item.geometry.getAttribute('tangent'), vector = new THREE.Vector3(), result = new THREE.Vector3();
  let influence = 0;
  for (let vertex = 0; vertex < position.count; vertex++) {
    const start = influence, count = item.skinCounts[vertex]; influence += count;
    for (const [attribute, isNormal] of [[position, false], [normal, true], [tangent, true]]) { if (!attribute) continue; vector.fromBufferAttribute(attribute, vertex); result.set(0, 0, 0); let total = 0;
      for (let k = start; k < start + count; k++) { const index = item.skinIndices[k], weight = item.skinWeights[k]; if (!weight || !matrices[index]) continue; const transformed = vector.clone(); if (isNormal) transformed.applyMatrix3(normalMatrices[index]); else transformed.applyMatrix4(matrices[index]); result.addScaledVector(transformed, weight); total += weight; }
      if (!total) continue; result.multiplyScalar(1 / total); if (isNormal) result.normalize(); attribute.setXYZ(vertex, result.x, result.y, result.z);
    }
  }
  position.needsUpdate = true; if (normal) normal.needsUpdate = true; if (tangent) tangent.needsUpdate = true; item.geometry.computeBoundingSphere(); item.geometry.computeBoundingBox();
}
