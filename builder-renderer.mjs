import * as THREE from 'three';
import { OrbitControls } from './libs/three/package/examples/jsm/controls/OrbitControls.js';
import { assetBytes, assetPath, typedArray, cachedLoad } from './builder-assets.mjs';
import { createMaterial, updateMaterial, loadTexture, releaseUnusedTextures } from './builder-shaders.mjs';
import { coverageFor, cullTriangles } from './builder-model.mjs';
import { postureMatrices, skinPosture } from './builder-posture.mjs';

const reflect = (source, size = 3) => { const value = Float32Array.from(source); for (let i = 0; i < value.length; i += size) value[i] *= -1; if (size === 4) for (let i = 3; i < value.length; i += 4) value[i] *= -1; return value; };
export function morphMix(frames, weight) {
  if (!frames.length || weight === 0) return [];
  const points = [{ weight: 0, frame: null }, ...frames.map(frame => ({ weight: frame.weight, frame }))].sort((a, b) => a.weight - b.weight);
  let upper = points.findIndex(point => point.weight >= weight); if (upper < 0) upper = points.length - 1; if (!upper) upper = 1;
  const a = points[upper - 1], b = points[upper], span = b.weight - a.weight;
  if (!span) return b.frame ? [[b.frame, 1]] : [];
  const t = (weight - a.weight) / span;
  return [[a.frame, 1 - t], [b.frame, t]].filter(([frame, amount]) => frame && amount);
}
export class AvatarRenderer {
  constructor(element, data) {
    this.element = element; this.data = data; this.cache = new Map(); this.instances = new Map(); this.materials = new Map(); this.materialInstances = new Map(); this.token = 0; this.report = []; this.active = []; this.view = 'threequarter';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1;
    element.append(this.renderer.domElement); this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#dedbd4');
    this.camera = new THREE.PerspectiveCamera(34, 1, .01, 200); this.camera.position.set(2.5, 1.5, -4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true; this.controls.minDistance = .1; this.controls.maxDistance = 30; this.controls.target.set(0, 1, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x726b60, 2.2));
    const key = new THREE.DirectionalLight(0xfff7e8, 3.1); key.position.set(-3, 5, -4); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbe8ff, 1.4); fill.position.set(3, 3, 2); this.scene.add(fill);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.wireMaterial = new THREE.MeshBasicMaterial({ color: 0x181d20, wireframe: true, transparent: true, opacity: .34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    this.cutMaterial = new THREE.MeshBasicMaterial({ color: 0xe644aa, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide });
    new ResizeObserver(() => this.resize()).observe(element); this.resize();
    this.renderer.setAnimationLoop(() => { this.controls.update(); this.renderer.render(this.scene, this.camera); });
  }
  resize() { const width = this.element.clientWidth, height = this.element.clientHeight; if (!width || !height) return; this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); }
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
      const mesh = new THREE.Mesh(geometry, materialList); mesh.name = definition.name;
      const wire = new THREE.Mesh(geometry, this.wireMaterial); wire.visible = !!this.wire; mesh.add(wire);
      const cuts = new THREE.Mesh(new THREE.BufferGeometry(), this.cutMaterial); cuts.visible = !!this.cuts; mesh.add(cuts);
      const result = { definition, geometry, positions, normals, tangents, parts, displayParts, morphs, mesh, wire, cuts, materials: materialList, skinCounts: array('bonesPerVertex'), skinIndices: array('allSkinIndices'), skinWeights: array('allSkinWeights') };
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
    this.group.clear(); this.active = items; let hiddenCount = 0, triangles = 0, vertices = 0; const posture = postureMatrices(family, config);
    for (const item of items) {
      this.applyMorphs(item, request.ShapeWeights); skinPosture(item, posture); item.materials.forEach(material => { updateMaterial(material, request, config); for (const [name, change, texture] of textureChanges) if (material.name === name || name === '@face' && material.userData.definition.shader === 'Robot/Face Glow Panel') { const uniforms = material.userData.uniforms; if (uniforms[change.Property]) uniforms[change.Property].value = texture; if (change.Switch && uniforms[change.Switch]) uniforms[change.Switch].value = 1; if (change.ScaleOffset && uniforms[change.Property + '_ST']) uniforms[change.Property + '_ST'].value.fromArray(change.ScaleOffset); if (uniforms[change.Property + '_TexelSize']) { const image = texture.image; uniforms[change.Property + '_TexelSize'].value.set(1 / image.width, 1 / image.height, image.width, image.height); } } });
      if (item.definition.name === request.BodyMesh) {
        const indices = new Uint32Array(item.parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of item.parts) { indices.set(part, at); at += part.length; }
        const hidden = coverageFor(family, request.MeshNames, indices, this.data); hiddenCount += hidden.reduce((sum, value) => sum + value, 0); this.setIndices(item, cullTriangles(item.displayParts, hidden));
        const excluded = cullTriangles(item.displayParts, Uint8Array.from(hidden, value => 1 - value)); const cutIndices = Uint32Array.from(excluded.flatMap(part => [...part])); item.cuts.geometry.setAttribute('position', item.geometry.getAttribute('position')); item.cuts.geometry.setIndex(new THREE.BufferAttribute(cutIndices, 1));
      } else this.setIndices(item, item.displayParts);
      item.wire.visible = !!this.wire; item.cuts.visible = !!this.cuts; this.group.add(item.mesh); vertices += item.positions.length / 3; triangles += item.geometry.index.count / 3;
    }
    const missing = request.MeshNames.filter(name => !definitions.some(mesh => mesh.name === name));
    if (frame || !this.framed) this.frame(); this.framed = true;
    this.stats = { meshes: items.length, vertices, triangles, hiddenTriangles: hiddenCount, missing, materialNotes: [...new Set(this.report)], posture: 'Static standing IK preview. FlexaBody tracking, grounding and animation are validated in Unity.', postureLegs: posture.legs };
    this.renderer.compile(this.scene, this.camera);
    // Keep the currently worn look resident. Retaining every visited 4K texture would exceed 3 GB.
    for (const [key, item] of this.instances) if (!items.includes(item)) { item.geometry.dispose(); item.cuts.geometry.dispose(); this.instances.delete(key); this.cache.delete(key); }
    const activeMaterials = new Set(items.flatMap(item => item.materials)); for (const [key, material] of this.materialInstances) if (!activeMaterials.has(material)) { material.dispose(); this.materialInstances.delete(key); this.materials.delete(key); }
    const activeTextures = new Set(); for (const material of activeMaterials) { for (const uniform of Object.values(material.userData.uniforms)) if (uniform.value?.isTexture) activeTextures.add(uniform.value); for (const value of Object.values(material)) if (value?.isTexture) activeTextures.add(value); }
    releaseUnusedTextures(activeTextures); this.stats.residentMeshes = this.instances.size; this.stats.residentMaterials = this.materialInstances.size; this.stats.residentTextures = activeTextures.size; return this.stats;
  }
  frame(view = this.view) {
    this.view = view; const box = new THREE.Box3().setFromObject(this.group); if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()); this.controls.target.copy(center);
    const distance = Math.max(size.y, size.x / this.camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.2;
    const directions = { front: [0, .03, 1], threequarter: [.55, .08, 1], side: [1, .03, 0], back: [0, .03, -1] };
    this.camera.position.copy(center).add(new THREE.Vector3(...directions[view]).normalize().multiplyScalar(distance)); this.camera.near = Math.max(.001, distance / 1000); this.camera.far = distance * 100; this.camera.updateProjectionMatrix(); this.controls.update();
  }
  overlays(wire, cuts) { this.wire = wire; this.cuts = cuts; for (const item of this.active) { item.wire.visible = wire; item.cuts.visible = cuts; } }
  snapshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
}
