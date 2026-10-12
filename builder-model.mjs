const PIECES = ['human.clothing.top', 'human.clothing.bottom', 'human.clothing.dress', 'human.clothing.outerwear'];
const LAYERS = { 'human.clothing.top': ['torso', 'outerwear', 'neckwear', 'scarf.detail', 'bag'], 'human.clothing.bottom': ['legs', 'belt', 'socks'], 'human.clothing.dress': ['torso', 'outerwear', 'neckwear', 'scarf.detail', 'bag', 'legs', 'belt', 'socks'] };
export const optionsOf = family => family.Options || family.options || [];
export const freshConfig = () => ({ Version: 2, Family: 'human', BodyType: 'male', Selections: [], Colours: [], Toggles: [], Shapes: [], RobotVisemeGrade: 'limited', GlowIntensity: .5, ToeOut: 0, FeetApart: 0 });
const clone = value => JSON.parse(JSON.stringify(value));
const boundedString = (value, label) => { if (typeof value !== 'string' || value.length > 256) throw new Error(`Invalid ${label}.`); return value; };
const integer = (value, min, max, label) => { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}.`); return value; };
export function parseConfig(source) {
  if (typeof source !== 'string' || source.length > 1_000_000) throw new Error('Choose an AvatarConfig JSON document smaller than 1 MB.');
  const raw = JSON.parse(source);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The document must contain an AvatarConfig object.');
  if (raw.Version !== undefined && raw.Version !== 2) throw new Error('Import a version 2 AvatarConfig. Older versions must be migrated in Unity first.');
  const result = freshConfig();
  result.Family = raw.Family === undefined ? 'human' : boundedString(raw.Family, 'family');
  if (!['human', 'robot'].includes(result.Family)) throw new Error('This builder supports the Human and Robot families.');
  result.BodyType = raw.BodyType ?? 'male'; if (!['male', 'female'].includes(result.BodyType)) throw new Error('BodyType must be male or female.');
  for (const key of ['Selections', 'Colours', 'Toggles', 'Shapes']) {
    const rows = raw[key] ?? []; if (!Array.isArray(rows) || rows.length > 2048) throw new Error(`Invalid ${key} list.`);
    const identities = new Set();
    result[key] = rows.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid ${key} entry.`);
      let entry, identity;
      if (key === 'Selections') { entry = { CategoryId: boundedString(row.CategoryId, 'category'), BodyType: row.BodyType ?? '', Ordinal: integer(row.Ordinal, 0, 100000, 'ordinal') }; if (!['', 'male', 'female'].includes(entry.BodyType)) throw new Error('Invalid selection body type.'); identity = entry.CategoryId + '|' + entry.BodyType; }
      if (key === 'Colours') { entry = { SlotId: boundedString(row.SlotId, 'colour slot'), Hex: boundedString(row.Hex, 'colour') }; if (!/^#[\da-f]{6}$/i.test(entry.Hex)) throw new Error('Colours must use #RRGGBB.'); identity = entry.SlotId; }
      if (key === 'Toggles') { if (typeof row.On !== 'boolean') throw new Error('Toggle values must be true or false.'); entry = { CategoryId: boundedString(row.CategoryId, 'toggle'), On: row.On }; identity = entry.CategoryId; }
      if (key === 'Shapes') { entry = { Id: boundedString(row.Id, 'shape'), Value: integer(row.Value, -100, 100, 'shape value') }; identity = entry.Id; }
      if (identities.has(identity)) throw new Error(`Duplicate ${key} entry: ${identity}.`); identities.add(identity); return entry;
    });
  }
  result.RobotVisemeGrade = raw.RobotVisemeGrade ?? 'limited'; if (!['limited', 'extended', 'full'].includes(result.RobotVisemeGrade)) throw new Error('Invalid robot viseme grade.');
  result.GlowIntensity = raw.GlowIntensity ?? .5; if (!Number.isFinite(result.GlowIntensity) || result.GlowIntensity < .5 || result.GlowIntensity > 2.5) throw new Error('GlowIntensity must be between 0.5 and 2.5.');
  result.ToeOut = integer(raw.ToeOut ?? 0, -10, 20, 'toe angle'); result.FeetApart = integer(raw.FeetApart ?? 0, -6, 20, 'feet spacing');
  return result;
}
export function setOrdinal(config, category, body, ordinal) {
  config.Selections = config.Selections.filter(row => row.CategoryId !== category || (row.BodyType || '') !== body);
  config.Selections.push({ CategoryId: category, BodyType: body, Ordinal: ordinal });
}
export function setFemale(config, value, shapes) {
  const old = config.BodyType, next = value >= 50 ? 'female' : 'male';
  setShape(config, 'body_female', value, shapes);
  if (old !== next) { config.Selections = config.Selections.filter(row => row.BodyType !== next); for (const row of config.Selections) if (row.BodyType === old) row.BodyType = next; }
  config.BodyType = next;
}
export function setShape(config, id, value, shapes = []) {
  const shape = shapes.find(row => row.Id === id), min = shape?.MinWeight ?? 0;
  value = Math.max(Math.min(0, min), Math.min(100, Math.round(value)));
  config.Shapes = config.Shapes.filter(row => row.Id !== id);
  if (value !== (id === 'body_female' && config.BodyType === 'female' ? 100 : 0)) config.Shapes.push({ Id: id, Value: value });
}
export function shapeValue(config, id) { return config.Shapes.find(row => row.Id === id)?.Value ?? (id === 'body_female' && config.BodyType === 'female' ? 100 : 0); }
export function setColour(config, slot, hex) { config.Colours = config.Colours.filter(row => row.SlotId !== slot); if (hex !== null) config.Colours.push({ SlotId: slot, Hex: hex }); }
export function selectedOrdinal(config, category, perBody, data = {}) {
  const body = perBody ? config.BodyType : '', row = config.Selections.find(item => item.CategoryId === category && (item.BodyType || '') === body);
  if (row) return row.Ordinal;
  if (config.Family !== 'human') return category === 'robot.eyes' ? 1 : 0;
  const defaults = data.defaults?.ordinals || { 'human.outfit.normal': 1, 'human.clothing.top': 1, 'human.clothing.bottom': 10, 'human.hair.style': 38, 'human.beard': config.BodyType === 'male' ? 1 : 0, 'human.shoes': 14 };
  if (PIECES.includes(category) && config.Selections.some(item => item.CategoryId === 'human.outfit.normal' && item.BodyType === config.BodyType)) return 0;
  return defaults[category] ?? 0;
}
export function pick(config, family, category, ordinal, data) {
  const option = optionsOf(family).find(row => row.CategoryId === category && row.Ordinal === ordinal);
  setOrdinal(config, category, (option || optionsOf(family).find(row => row.CategoryId === category))?.PerBodyType ? config.BodyType : '', ordinal);
  if (category === 'human.outfit.normal') config.Selections = config.Selections.filter(row => !PIECES.includes(row.CategoryId));
  if (category === 'human.hair.style' && (data.rules?.hatlessHair || [6, 13, 17, 21, 22, 23, 24, 28, 33, 34, 35, 52, 53]).includes(ordinal)) setOrdinal(config, 'human.hat', '', 0);
}
export function compatible(names, rules = []) {
  const byName = new Map(rules.filter(row => row?.Name).map(row => [row.Name, row])), result = [], adding = new Set();
  const overlaps = (a = [], b = []) => a.some(value => b.includes(value));
  const conflicts = (a, b) => a && b && a.Name !== b.Name && (overlaps(a.OccupiedSlots, b.OccupiedSlots) || overlaps(a.IncompatibleTags, b.Tags) || overlaps(b.IncompatibleTags, a.Tags) || (a.ExcludedParts || []).includes(b.Name) || (b.ExcludedParts || []).includes(a.Name));
  function add(name) { if (!name || adding.has(name)) return; adding.add(name); const rule = byName.get(name); if (rule) { for (const dependency of rule.RequiredParts || []) if (byName.has(dependency)) add(dependency); for (let i = result.length - 1; i >= 0; i--) if (conflicts(rule, byName.get(result[i]))) result.splice(i, 1); } const old = result.indexOf(name); if (old >= 0) result.splice(old, 1); result.push(name); adding.delete(name); }
  for (const name of names) add(name);
  let changed; do { const tags = new Set(result.flatMap(name => byName.get(name)?.Tags || [])); const remove = result.filter(name => { const rule = byName.get(name); return rule && ((rule.RequiredParts || []).some(dep => !result.includes(dep)) || (rule.RequiredTags || []).some(tag => !tags.has(tag))); }); changed = remove.length > 0; for (const name of remove) result.splice(result.indexOf(name), 1); } while (changed);
  return result;
}
export function resolve(config, family, data, authoring = false) {
  config = clone(config); const options = optionsOf(family), hidden = data.rules?.hiddenTiles || { 'human.outfit.normal': [27], 'human.shoes': [15] };
  if (!authoring) config.Selections = config.Selections.filter(row => !PIECES.includes(row.CategoryId) && !(hidden[row.CategoryId] || []).includes(row.Ordinal));
  const find = (category, ordinal) => options.find(row => !row.Unavailable && row.CategoryId === category && row.Ordinal === ordinal);
  const chosen = new Map();
  for (const category of [...new Set(options.map(row => row.CategoryId))]) { const sample = options.find(row => row.CategoryId === category); let option = find(category, selectedOrdinal(config, category, sample.PerBodyType, data)); if (!option && (family.RequiredCategories || []).includes(category)) option = options.filter(row => row.CategoryId === category && !row.Unavailable).sort((a, b) => a.Ordinal - b.Ordinal)[0]; if (option) chosen.set(category, option); }
  const shapes = Object.fromEntries((family.DefaultShapes || []).map(row => [row.Name, row.Weight])); let names = [family.BodyMesh, ...(family.BaseMeshes || [])].filter(Boolean);
  const hatless = data.rules?.hatlessHair || [6, 13, 17, 21, 22, 23, 24, 28, 33, 34, 35, 52, 53];
  const hair = chosen.get(family.HairCategoryId || 'human.hair.style'); if (config.Family === 'human' && hatless.includes(hair?.Ordinal)) chosen.delete(family.HatCategoryId || 'human.hat');
  const hat = chosen.get(family.HatCategoryId || 'human.hat'), hatted = !!hat && !hat.KeepsHair;
  const rank = option => { const index = config.Selections.findIndex(row => row.CategoryId === option.CategoryId && (!option.PerBodyType || row.BodyType === config.BodyType)); return index >= 0 ? index : (family.RequiredCategories || []).includes(option.CategoryId) ? -2 : -1; };
  const suppression = new Set();
  for (const option of [...chosen.values()].sort((a, b) => rank(a) - rank(b))) { names.push(...(hatted && option.HattedMeshes?.length ? option.HattedMeshes : option.Meshes || []), ...(option.RequiredMeshes || [])); for (const row of option.Shapes || []) shapes[row.Name] = row.Weight; for (const name of option.SuppressedMeshes || []) suppression.add(name); }
  names = compatible([...new Set(names)].filter(name => !suppression.has(name)), family.PartRules || []);
  if (config.Family === 'human') {
    const occupies = (name, slots) => (family.PartRules || []).find(rule => rule.Name === name)?.OccupiedSlots?.some(slot => slots.includes(slot));
    const outfit = chosen.get('human.outfit.normal');
    if (outfit) { const replaced = new Set(), pieces = new Set(); for (const category of Object.keys(LAYERS)) { const option = chosen.get(category); if (option) { LAYERS[category].forEach(slot => replaced.add(slot)); option.Meshes.forEach(name => pieces.add(name)); } } const own = new Set([...(outfit.Meshes || []), ...(outfit.HattedMeshes || [])]); names = names.filter(name => !own.has(name) || pieces.has(name) || !occupies(name, [...replaced])); }
    if (!names.some(name => occupies(name, ['legs']))) names.push(...(find('human.clothing.bottom', data.defaults?.Bottom ?? 10)?.Meshes || []));
    if (!names.some(name => occupies(name, ['torso', 'outerwear']))) names.push(...(find('human.clothing.top', data.defaults?.Top ?? 1)?.Meshes || []));
    let shoes = chosen.get(family.ShoesCategoryId || 'human.shoes'); if (!shoes) shoes = find(family.ShoesCategoryId || 'human.shoes', data.defaults?.Shoes ?? 14);
    if (shoes) { names = names.filter(name => !name.startsWith('shoes_')); names.push(...shoes.Meshes); }
    for (const row of config.Shapes) { const definition = (data.humanShapes || []).find(shape => shape.Id === row.Id); if (definition && (authoring || !definition.Hidden)) shapes[row.Id] = Math.max(definition.MinWeight ?? 0, Math.min(definition.MaxWeight ?? 100, row.Value)); }
    shapes.body_female ??= config.BodyType === 'female' ? 100 : 0; shapes.body_female = Math.max(0, Math.min(100, shapes.body_female)); shapes.body_male = 100 - shapes.body_female; if (shapes.body_weight !== undefined) shapes.belly_fat = shapes.body_weight;
    if (hatted && !hair && family.BaldHatShape) shapes[family.BaldHatShape] = 100;
    let boot = 0; for (const fit of family.PartFits || []) if (names.includes(fit.MeshName)) boot = Math.max(boot, fit.BootFit || 0); if (boot && family.BootFitShape) shapes[family.BootFitShape] = Math.max(0, Math.min(100, boot));
    for (const fit of family.PartFits || []) if (names.includes(fit.MeshName)) { if (fit.FitShape) shapes[fit.FitShape] = fit.FitShape === 'Height' ? Math.max(0, Math.min(100, fit.PantsHeight || 0)) : 100; if (fit.PantsHeight > 0) shapes.Height = Math.max(0, Math.min(100, fit.PantsHeight)); for (const correction of fit.Corrections || []) shapes[correction.Target] = shapes[correction.Source] || 0; }
  } else {
    if (chosen.get('robot.shoes')?.Ordinal > 0) names = names.filter(name => name !== 'RobotShoe_Default');
    if (chosen.get('robot.wings')?.Ordinal > 0 && (family.meshes || []).some(mesh => mesh.name === 'RobotWingMount')) names.push('RobotWingMount');
  }
  const colours = Object.fromEntries(config.Colours.map(row => [row.SlotId, row.Hex]));
  if (config.Family === 'human') { colours.skin ??= '#e9bfae'; colours['hair.base'] ??= '#33251c'; colours.eye ??= '#2e6b3f'; colours['hair.tip'] ??= colours['hair.base']; colours.beard ??= colours['hair.base']; for (const slot of ['lips', 'nails']) if (!colours[slot] && colours.skin) colours[slot] = '#' + colours.skin.slice(1).match(/../g).map(value => Math.round(parseInt(value, 16) * .5).toString(16).padStart(2, '0')).join(''); }
  const materialFloats = {}, materialTextures = {};
  const colourValues = Object.fromEntries(Object.entries(colours).map(([name, hex]) => [name, [...hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255), 1]]));
  if (config.Family === 'human') for (const slot of ['lips','nails']) if (!config.Colours.some(row => row.SlotId === slot) && colourValues.skin) colourValues[slot] = [...colourValues.skin.slice(0,3).map(value => value * .5), 1];
  if (config.Family === 'robot') {
    const eyeOrdinal = selectedOrdinal(config, family.EyesCategoryId || 'robot.eyes', false, data), eyes = data.RobotEyePresets?.[eyeOrdinal - 1] || data.RobotEyePresets?.[0];
    if (eyes) for (const name of ['UpperHeight','UpperPeak','UpperCurve','UpperFlat','LowerHeight','LowerPeak','LowerCurve','LowerFlat','CornerTilt','CornerRound']) materialFloats['_Eye' + name] = eyes[name];
    const skinOrdinal = selectedOrdinal(config, 'robot.skin', false, data), skin = family.Skins?.[skinOrdinal - 1];
    if (skin) { materialTextures.Robot = { Property: '_BaseMap', Texture: skin, ScaleOffset: [family.SkinTiling || 4, family.SkinTiling || 4, 0, 0], Switch: '_UseDiffuse' }; colours['robot.skin.worn'] = colours['robot.skin.tint'] || '#ffffff'; colourValues['robot.skin.worn'] = colourValues['robot.skin.tint'] || [1,1,1,1]; }
    const glow = colourValues[family.SecondarySlot || 'robot.secondary'] || Object.values(family.DefaultGlow || {r:.33,g:.82,b:.99,a:1}); colourValues['robot.glow'] = [...glow.slice(0,3).map(value => value * config.GlowIntensity), glow[3]];
    const mouth = data.RobotRestMouths?.[selectedOrdinal(config, 'robot.face.rest', false, data) - 1]; if (mouth) materialTextures['@face'] = { Property: '_MouthSilent', Texture: mouth };
  }
  return { MeshNames: [...new Set(names)], ShapeWeights: shapes, Colours: colours, ColourValues: colourValues, RobotDefaultGlow: family.DefaultGlow, MaterialFloats: materialFloats, MaterialTextures: materialTextures, chosen: [...chosen.values()], hatted, BodyMesh: family.BodyMesh };
}
export function coverageFor(family, names, indices, data = {}) {
  const triangleCount = typeof indices === 'number' ? indices : indices.length / 3, hidden = new Uint8Array(triangleCount);
  const masks = family.BodyOcclusion || family.bodyOcclusion;
  const rows = masks?.Garments || family.coverage || [];
  const worn = rows.filter(row => names.includes(row.GarmentMesh || row.Name));
  if (masks && masks.IsCompatible !== false && typeof indices !== 'number') {
    const bit = (array, index) => !!array && (index >> 6) < array.length && (BigInt(array[index >> 6]) & (1n << BigInt(index & 63))) !== 0n;
    const covered = new Uint8Array(masks.BodyVertexCount), source = typeof masks.Source === 'string' ? { RegionsAndMasks: 0, Regions: 1, Masks: 2 }[masks.Source] : masks.Source;
    const regions = masks.VertexRegion || [], segments = masks.VertexSegment || [], haveRegions = regions.length === covered.length;
    const never = data.NeverCullRegions || [0, 1], regionNames = data.BodyRegions || {}, segmentNames = data.BodySegments || {};
    const mapId = (map, name) => Array.isArray(map) ? map.find(row => row.Name === name || row.name === name)?.Id ?? map.find(row => row.Name === name || row.name === name)?.id ?? 0 : map[name] || 0;
    for (const row of worn) { const regionIds = new Set(), segmentIds = new Set(); if (haveRegions && source !== 2) for (const name of row.OccludesRegions || []) { const segment = mapId(segmentNames, name); if (segment) segmentIds.add(segment); else { const region = mapId(regionNames, name); if (!never.includes(region)) regionIds.add(region); } }
      for (let v = 0; v < covered.length; v++) { let yes = source !== 1 && bit(row.Hidden, v); if (haveRegions && regionIds.has(regions[v]) && !bit(row.PoseShow, v)) yes = true; if (source !== 2 && segments.length === covered.length && segmentIds.has(segments[v]) && !bit(row.PoseShow, v)) yes = true; if (bit(row.ForceHide, v)) yes = true; if (bit(row.ForceShow, v)) yes = false; covered[v] |= Number(yes); }
    }
    const weld = masks.WeldGroup || [], starts = masks.NeighbourStart || [], neighbours = masks.Neighbours || [];
    if (masks.ErodeRings > 0 && weld.length === covered.length && starts.length) { let groups = new Uint8Array(starts.length - 1).fill(1); for (let v = 0; v < covered.length; v++) groups[weld[v]] &= covered[v]; for (let ring = 0; ring < masks.ErodeRings; ring++) { const next = groups.slice(); for (let g = 0; g < groups.length; g++) if (groups[g]) for (let k = starts[g]; k < starts[g + 1]; k++) if (!groups[neighbours[k]]) { next[g] = 0; break; } groups = next; } for (let v = 0; v < covered.length; v++) covered[v] = groups[weld[v]]; }
    const detailed = segments.length === covered.length; if (haveRegions || detailed) for (let v = 0; v < covered.length; v++) if (detailed ? segments[v] === 0 : never.includes(regions[v])) covered[v] = 0;
    for (let t = 0; t < triangleCount; t++) hidden[t] = covered[indices[t * 3]] && covered[indices[t * 3 + 1]] && covered[indices[t * 3 + 2]];
  }
  if (masks?.IsCompatible === false) return hidden;
  for (const row of worn) for (const triangle of row.Triangles || []) { if (!Number.isInteger(triangle) || triangle < 0 || triangle >= triangleCount) throw new Error(`Invalid body-coverage triangle for ${row.GarmentMesh || row.Name}.`); hidden[triangle] = 1; }
  return hidden;
}
export function cullTriangles(submeshes, hidden) {
  let triangle = 0;
  return submeshes.map(submesh => { const output = []; for (let i = 0; i < submesh.length; i += 3, triangle++) if (!hidden[triangle]) output.push(submesh[i], submesh[i + 1], submesh[i + 2]); return new Uint32Array(output); });
}
export { PIECES };
