import { surfaceProfiles } from './builder-surface-profiles.mjs';

export function surfaceProfile(definition) {
  const keyword = (definition.keywords || []).find(value => /^_PROFILE_\d+$/.test(value));
  return keyword ? Number(keyword.slice(9)) : definition.profile;
}
export function sampledTextureProperties(definition) {
  const shader = definition.shader || '';
  if (shader.includes('Masked PBR')) {
    const profile = surfaceProfile(definition);
    if (!(profile in surfaceProfiles)) throw new Error(`Missing surface profile for ${definition.name}.`);
    // This immutable native material switch selects the one-texture hair path.
    if (profile === 24 && definition.properties?._Param1?.[2] > .5) return ['_Map2'];
    return [...new Set(surfaceProfiles[profile].match(/\b_Map\d+\b/g) || [])];
  }
  if (shader === 'Robot') return ['_Mask', '_BaseMap'];
  if (shader === 'Robot/Face Glow Panel') return ['_FaceAtlas', '_MouthSilent', ...((definition.keywords || []).includes('_PANEL_MASK') ? ['_PanelDistance'] : [])];
  return definition.textures?._BaseMap ? ['_BaseMap'] : definition.textures?._MainTex ? ['_MainTex'] : [];
}
export async function sampledTextureUniforms(definition, loadTexture) {
  const result = {};
  await Promise.all(sampledTextureProperties(definition).map(async name => {
    const description = definition.textures?.[name];
    if (description) result[name] = { value: await loadTexture(description) };
  }));
  return result;
}
