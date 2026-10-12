import * as THREE from 'three';
import { surfaceProfiles } from './builder-surface-profiles.mjs?v=62c5d9ac114c';
import { robotFaceGLSL, robotFaceUniforms } from './builder-robot-face.mjs?v=bceb42ed921f';
import { assetBytes, assetPath, cachedLoad } from './builder-assets.mjs?v=07aeffe3c350';
import { surfaceProfile, sampledTextureUniforms } from './builder-texture-bindings.mjs?v=648ace8649fe';

const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
const flatNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); flatNormal.needsUpdate = true;
const textureCache = new Map();
const resolvedTextures = new Map();
function vector(value, color = false) { const array = Array.isArray(value) ? [...value] : [1, 1, 1, 1]; if (color) { const c = new THREE.Color(array[0], array[1], array[2]).convertSRGBToLinear(); array[0] = c.r; array[1] = c.g; array[2] = c.b; } return new THREE.Vector4(array[0] ?? 0, array[1] ?? 0, array[2] ?? 0, array[3] ?? 1); }
export async function loadTexture(description) {
  if (!description?.url) return white;
  const key = JSON.stringify(description);
  return cachedLoad(textureCache, key, async () => {
    const { buffer, mime } = await assetBytes(assetPath(description.url));
    const objectURL = URL.createObjectURL(new Blob([buffer], { type: mime.startsWith('image/') ? mime : description.mime || 'image/png' }));
    try { const texture = await new THREE.TextureLoader().loadAsync(objectURL); texture.colorSpace = description.sRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      const wrap = description.wrapMode; texture.wrapS = texture.wrapT = wrap === 0 || wrap === 'Repeat' ? THREE.RepeatWrapping : wrap === 2 || wrap === 'Mirror' ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
      if (description.filterMode === 0 || description.filterMode === 'Point') { texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false; }
      else { texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = description.mipmapEnabled !== false; texture.minFilter = description.mipmapEnabled === false ? THREE.LinearFilter : description.filterMode === 'Bilinear' || description.filterMode === 1 ? THREE.LinearMipmapNearestFilter : THREE.LinearMipmapLinearFilter; }
      resolvedTextures.set(key, texture); return texture;
    } finally { URL.revokeObjectURL(objectURL); }
  });
}
export function releaseUnusedTextures(active) {
  for (const [key, texture] of resolvedTextures) if (!active.has(texture)) { texture.dispose(); resolvedTextures.delete(key); textureCache.delete(key); }
}
const helpers = `
float avatarSaturate(float v){return clamp(v,0.0,1.0);} vec2 avatarSaturate(vec2 v){return clamp(v,0.0,1.0);} vec3 avatarSaturate(vec3 v){return clamp(v,0.0,1.0);} vec4 avatarSaturate(vec4 v){return clamp(v,0.0,1.0);}
float ToValue(vec4 v){return dot(v.rgb,vec3(0.333333333));}
vec3 RotateXYZ(vec3 p,vec3 a){vec3 s=sin(a),c=cos(a);p=vec3(p.x,c.x*p.y-s.x*p.z,s.x*p.y+c.x*p.z);p=vec3(c.y*p.x+s.y*p.z,p.y,-s.y*p.x+c.y*p.z);return vec3(c.z*p.x-s.z*p.y,s.z*p.x+c.z*p.y,p.z);}
vec3 UnpackNormalScale(vec4 sampleValue,float scale){vec3 n=sampleValue.xyz*2.0-1.0;n.xy*=scale;return normalize(n);}
float AvatarHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float AvatarNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(AvatarHash(i),AvatarHash(i+vec3(1.0,0.0,0.0)),f.x),mix(AvatarHash(i+vec3(0.0,1.0,0.0)),AvatarHash(i+vec3(1.0,1.0,0.0)),f.x),f.y),mix(mix(AvatarHash(i+vec3(0.0,0.0,1.0)),AvatarHash(i+vec3(1.0,0.0,1.0)),f.x),mix(AvatarHash(i+vec3(0.0,1.0,1.0)),AvatarHash(i+vec3(1.0,1.0,1.0)),f.x),f.y),f.z);}
float avatarSRGB(float v){return v<=0.04045?v/12.92:pow((v+0.055)/1.055,2.4);}
struct AvatarSurface {vec3 albedo;float metallic;float smoothness;float alpha;vec3 emission;vec3 normalTS;float occlusion;};
varying vec2 vAvatarUv;varying vec2 vAvatarUv2;varying vec2 vAvatarHair;
`;
function uniformsFor(definition) {
  const result = {};
  for (const [name, value] of Object.entries(definition.properties || {})) result[name] = { value: Array.isArray(value) ? vector(definition.rawVectors?.[name] || value) : value };
  for (let i = 0; i < 12; i++) result[`_Param${i}`] ??= { value: new THREE.Vector4() };
  for (let i = 0; i < 7; i++) result[`_Tint${i}`] ??= { value: new THREE.Vector4(1, 1, 1, 1) };
  result._Cutoff ??= { value: 0 };
  for (let i = 0; i < 10; i++) result[`_Map${i}`] = { value: i === 2 ? flatNormal : white };
  return result;
}
function attachVertex(shader, decodeHair) {
  shader.vertexShader = 'attribute vec4 avatarColor;attribute vec2 avatarUv2;varying vec2 vAvatarUv;varying vec2 vAvatarUv2;varying vec2 vAvatarHair;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvAvatarUv=uv;vAvatarUv2=avatarUv2;vAvatarHair=avatarColor.rg;${decodeHair ? 'vAvatarHair=vec2(vAvatarHair.x<=0.04045?vAvatarHair.x/12.92:pow((vAvatarHair.x+0.055)/1.055,2.4),vAvatarHair.y<=0.04045?vAvatarHair.y/12.92:pow((vAvatarHair.y+0.055)/1.055,2.4));' : ''}`);
}
// UnityEngine.Rendering.BlendMode values 0..10.
const BLEND_FACTORS = [THREE.ZeroFactor, THREE.OneFactor, THREE.DstColorFactor, THREE.SrcColorFactor, THREE.OneMinusDstColorFactor, THREE.SrcAlphaFactor, THREE.OneMinusSrcColorFactor, THREE.DstAlphaFactor, THREE.OneMinusDstAlphaFactor, THREE.SrcAlphaSaturateFactor, THREE.OneMinusSrcAlphaFactor];
export async function createMaterial(definition, family, report) {
  const shaderName = definition.shader || '', properties = definition.properties || {}, uniforms = uniformsFor(definition);
  Object.assign(uniforms, await sampledTextureUniforms(definition, loadTexture));
  const side = properties._Cull === 0 ? THREE.DoubleSide : properties._Cull === 1 ? THREE.BackSide : THREE.FrontSide;
  let material;
  if (shaderName.includes('Masked PBR')) {
    const profile = surfaceProfile(definition);
    if (!(profile in surfaceProfiles)) throw new Error(`Missing surface profile for ${definition.name}.`);
    const scattering = (profile === 0 || profile === 24) && properties._SubsurfaceStrength > 0 && !!definition.textures?._ThicknessMap;
    material = new THREE.MeshStandardMaterial({ side, normalMap: flatNormal, roughness: .7 });
    const declarations = [...Array.from({ length: 10 }, (_, i) => `uniform sampler2D _Map${i};`), ...Array.from({ length: 12 }, (_, i) => `uniform vec4 _Param${i};`), ...Array.from({ length: 7 }, (_, i) => `uniform vec4 _Tint${i};`), 'uniform float _Cutoff;'].join('\n');
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms); attachVertex(shader, profile === 24 && (properties._Param1?.[3] || 0) > .5);
      shader.fragmentShader = helpers + declarations + `\nAvatarSurface readAvatarSurface(){AvatarSurface s;s.albedo=vec3(1.0);s.metallic=0.0;s.smoothness=0.0;s.alpha=1.0;s.emission=vec3(0.0);s.normalTS=vec3(0.0,0.0,1.0);s.occlusion=1.0;\n${surfaceProfiles[profile]}\nreturn s;}\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', 'AvatarSurface avatarSurface=readAvatarSurface();diffuseColor.rgb=avatarSurface.albedo;diffuseColor.a=avatarSurface.alpha;if(diffuseColor.a<_Cutoff)discard;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '').replace('#include <roughnessmap_fragment>', 'float roughnessFactor=clamp(1.0-avatarSurface.smoothness,0.04,1.0);').replace('#include <metalnessmap_fragment>', 'float metalnessFactor=clamp(avatarSurface.metallic,0.0,1.0);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', 'normal=normalize(tbn*avatarSurface.normalTS);').replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=avatarSurface.emission;').replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse*=avatarSurface.occlusion;reflectedLight.indirectSpecular*=avatarSurface.occlusion;');
      if (scattering) {
        shader.fragmentShader = 'uniform sampler2D _ThicknessMap;uniform float _SubsurfaceStrength,_ThicknessInvert,_ThicknessPower;uniform vec4 _SubsurfaceColor;\n' + shader.fragmentShader;
        const mask = profile === 0 ? 'texture2D(_Map1,vAvatarUv).r' : '(_Param0.z>.5 ? max(0.0,1.0-texture2D(_Map1,vAvatarUv).r-texture2D(_Map1,vAvatarUv).g)*(1.0-texture2D(_Map1,vAvatarUv).a) : 0.0)';
        shader.fragmentShader = shader.fragmentShader.replace('AvatarSurface avatarSurface=readAvatarSurface();', `AvatarSurface avatarSurface=readAvatarSurface();float avatarThickness=mix(texture2D(_ThicknessMap,vAvatarUv).r,1.0-texture2D(_ThicknessMap,vAvatarUv).r,_ThicknessInvert);float avatarTransmission=pow(clamp(avatarThickness,0.0,1.0),_ThicknessPower)*_SubsurfaceStrength*${mask};`);
        // Match the native thickness-masked light wrap and back scattering.
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\nvec3 AvatarSkinScatter(IncidentLight light,vec3 n,vec3 view,vec3 albedo,float transmission,vec3 tint){float back=pow(clamp(dot(view,-normalize(light.direction+n*.25)),0.0,1.0),3.0);float wrap=max(0.0,clamp((dot(n,light.direction)+.35)/1.35,0.0,1.0)-clamp(dot(n,light.direction),0.0,1.0));return albedo*tint*light.color*(back+wrap*.35)*transmission;}`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replaceAll('RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );', 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\nreflectedLight.directDiffuse+=AvatarSkinScatter(directLight,geometryNormal,geometryViewDir,avatarSurface.albedo,avatarTransmission,_SubsurfaceColor.rgb);'));
      }
    };
    material.customProgramCacheKey = () => `unity-masked-${profile}-${properties._Param1?.[3] || 0}-${scattering}`;
    // Masked PBR's blend/depth properties (soft-alpha scalps use SrcAlpha/OneMinusSrcAlpha, ZWrite off, queue 3000).
    const src = BLEND_FACTORS[properties._SrcBlend ?? 1], dst = BLEND_FACTORS[properties._DstBlend ?? 0];
    if (src !== undefined && dst !== undefined && (src !== THREE.OneFactor || dst !== THREE.ZeroFactor)) {
      Object.assign(material, { transparent: true, blending: THREE.CustomBlending, blendSrc: src, blendDst: dst, blendSrcAlpha: src, blendDstAlpha: dst, depthWrite: properties._ZWrite !== 0 });
    }
  } else if (shaderName === 'Robot') {
    material = new THREE.MeshStandardMaterial({ side, roughness: 1 - (properties._Smoothness || .2) });
    for (const name of ['_PrimaryColor', '_SecondaryColor', '_GlowColor']) uniforms[name] ??= { value: new THREE.Vector4(1, 1, 1, 1) };
    for (const name of ['_UseDiffuse', '_AO']) uniforms[name] ??= { value: 0 };
    uniforms._Mask ??= { value: white }; uniforms._BaseMap ??= { value: white };
    const st = name => { const tex = definition.textures?.[name]; return new THREE.Vector4(...(tex?.scale || [1, 1]), ...(tex?.offset || [0, 0])); };
    uniforms._Mask_ST = { value: st('_Mask') }; uniforms._BaseMap_ST = { value: st('_BaseMap') };
    material.onBeforeCompile = shader => { Object.assign(shader.uniforms, uniforms); attachVertex(shader, false); shader.fragmentShader = 'varying vec2 vAvatarUv;uniform sampler2D _Mask,_BaseMap;uniform vec4 _PrimaryColor,_SecondaryColor,_GlowColor,_Mask_ST,_BaseMap_ST;uniform float _UseDiffuse,_AO;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', 'vec4 avatarMask=texture2D(_Mask,vAvatarUv*_Mask_ST.xy+_Mask_ST.zw);vec3 avatarPrimary=_PrimaryColor.rgb;if(_UseDiffuse>.5)avatarPrimary*=texture2D(_BaseMap,vAvatarUv*_BaseMap_ST.xy+_BaseMap_ST.zw).rgb;diffuseColor.rgb=mix(avatarPrimary*avatarMask.r,avatarMask.b*_SecondaryColor.rgb,avatarMask.b);diffuseColor.rgb=mix(diffuseColor.rgb,avatarMask.a*diffuseColor.rgb,_AO);').replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=_GlowColor.rgb*avatarMask.g;'); };
    material.customProgramCacheKey = () => 'unity-robot';
  } else if (shaderName === 'Robot/Face Glow Panel') {
    material = new THREE.MeshBasicMaterial({ side });
    for (const row of robotFaceUniforms) uniforms[row.name] ??= { value: row.type === 'vec4' ? new THREE.Vector4() : 0 };
    for (const name of ['_FaceAtlas', '_MouthSilent', '_PanelDistance']) uniforms[name] ??= { value: white };
    for (const name of ['_FaceAtlas', '_MouthSilent']) { const image = uniforms[name].value.image; uniforms[name + '_TexelSize'] = { value: new THREE.Vector4(1 / (image.width || 1), 1 / (image.height || 1), image.width || 1, image.height || 1) }; }
    const declarations = robotFaceUniforms.map(row => `uniform ${row.type} ${row.name};`).join('\n') + '\nuniform sampler2D _FaceAtlas,_MouthSilent,_PanelDistance;';
    material.onBeforeCompile = shader => { Object.assign(shader.uniforms, uniforms); attachVertex(shader, false); shader.fragmentShader = helpers + declarations + '\n' + robotFaceGLSL + '\n' + shader.fragmentShader; shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', 'diffuseColor=AvatarRobotFace();'); };
    if ((definition.keywords || []).includes('_PANEL_MASK')) material.defines = { _PANEL_MASK: 1 };
    material.customProgramCacheKey = () => 'unity-robot-face-' + !!(material.defines?._PANEL_MASK);
  } else {
    const baseMap = definition.textures?._BaseMap || definition.textures?._MainTex;
    material = new THREE.MeshStandardMaterial({ side, roughness: 1 - (properties._Smoothness ?? .2), metalness: properties._Metallic || 0, map: baseMap ? await loadTexture(baseMap) : null });
    const source = properties._BaseColor || properties._Color || [1, 1, 1, 1]; material.color = new THREE.Color(...source.slice(0, 3)).convertSRGBToLinear();
    report.push(`${definition.name}: ${shaderName || 'unnamed shader'} uses a standard browser material.`);
  }
  const baseline = Object.fromEntries(Object.entries(uniforms).map(([name, uniform]) => [name, uniform.value?.clone && !uniform.value.isTexture ? uniform.value.clone() : uniform.value]));
  material.name = definition.name; material.userData = { definition, uniforms, baseline, baseColor: material.color.clone(), slots: (family.MaterialSlots || []).filter(slot => (!slot.MaterialName || slot.MaterialName === definition.name) && (!slot.ShaderName || slot.ShaderName === shaderName)) };
  return material;
}
export function updateMaterial(material, request, config) {
  const { uniforms, slots, definition, baseline, baseColor } = material.userData;
  for (const [name, value] of Object.entries(baseline)) uniforms[name].value = value?.clone && !value.isTexture ? value.clone() : value;
  material.color.copy(baseColor);
  const linearHair = definition.shader?.includes('Masked PBR') && definition.keywords?.includes('_PROFILE_24') && definition.properties?._Param1?.[2] > .5;
  for (const slot of slots) { const hex = request.Colours[slot.ColourSlot], values = request.ColourValues?.[slot.ColourSlot]; if (!hex && !values) continue; const property = slot.Property || '_BaseColor', rgb = values?.slice(0,3) || hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255), color = new THREE.Color(...rgb);
    if (uniforms[property]) { color.convertSRGBToLinear(); uniforms[property].value = new THREE.Vector4(color.r, color.g, color.b, 1); }
    else if (!slot.Property || property === '_BaseColor' || property === '_Color') material.color.copy(color.convertSRGBToLinear()); }
  if (config.Family === 'robot') {
    const source = request.Colours['robot.secondary'], defaultGlow = request.RobotDefaultGlow ? [request.RobotDefaultGlow.r, request.RobotDefaultGlow.g, request.RobotDefaultGlow.b, 1] : [.33, .82, .99, 1];
    const rgb = source ? source.slice(1).match(/../g).map(value => parseInt(value, 16) / 255) : defaultGlow.slice(0, 3);
    const glow = new THREE.Color(...rgb.map(value => value * config.GlowIntensity)).convertSRGBToLinear();
    if (uniforms._GlowColor) uniforms._GlowColor.value.set(glow.r, glow.g, glow.b, 1);
    if (uniforms._PanelColor) { const panel = new THREE.Color(...rgb.map(value => value * Math.max(1, config.GlowIntensity))).convertSRGBToLinear(); const luminance = .2126 * panel.r + .7152 * panel.g + .0722 * panel.b; if (luminance > .6) panel.multiplyScalar(.6 / luminance); uniforms._PanelColor.value.set(panel.r, panel.g, panel.b, 1); }
    for (const [property, value] of Object.entries(request.MaterialFloats || {})) if (uniforms[property]) uniforms[property].value = value;
  }
}
