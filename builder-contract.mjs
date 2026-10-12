/**
 * The Unity creator's configuration rules over the exported creator contract (browser_data/creator_contract.json).
 * The contract is Unity's own evaluation of the live menu at the public level (rows, tile order, legality, colour
 * slot modes, sliders, grades). The functions here mirror the native C# they are named after, so a look edited on the
 * web is the look Unity wears: AvatarConfig (selections/colours/shapes), ClothingLayers.Pick, BodyShape.SetFemale,
 * DefaultLook, HumanColourDefaults, HeadgearRules and AvatarConfigResolver.Clamp (WornConfig.For).
 * tests/unity-parity.mjs replays Unity-computed reference cases against this module.
 */

export const HUMAN_OUTFIT = 'human.outfit.normal', HUMAN_HAIR = 'human.hair.style', HUMAN_HAT = 'human.hat', BODY_FEMALE = 'body_female';
const PIECES = new Set(['human.clothing.top', 'human.clothing.bottom', 'human.clothing.dress', 'human.clothing.outerwear']);
// DefaultLook.Parts: what an unset row wears (clothing pieces only while no outfit is chosen).
const DEFAULT_PARTS = [
  { category: HUMAN_OUTFIT, ordinal: 1 }, { category: 'human.clothing.top', ordinal: 1, clothing: true }, { category: 'human.clothing.bottom', ordinal: 10, clothing: true },
  { category: HUMAN_HAIR, ordinal: 38 }, { category: 'human.beard', ordinal: 1, body: 'male' }, { category: 'human.shoes', ordinal: 14 },
];
const DEFAULT_COLOURS = { eye: '#2E6B3F', 'hair.base': '#33251C' };
// HumanColourDefaults.Rules: slots that follow another slot's colour, at a shade.
const DERIVED = [['hair.tip', 'hair.base', 1], ['beard', 'hair.base', 1], ['lips', 'skin', .5], ['nails', 'skin', .75]];
// AvatarConfigMigration.MovedInVersion2.
const MOVED_V2 = [['human.accessory', 4, HUMAN_HAT, 13], ['human.accessory', 3, HUMAN_HAT, 14], ['human.costume', 2, HUMAN_HAT, 15], ['human.accessory', 1, HUMAN_HAT, 16], ['human.accessory', 6, 'human.jewelry', 15], ['human.accessory', 13, 'human.jewelry', 16]];
const NAMED = { red: 'FF0000', cyan: '00FFFF', blue: '0000FF', darkblue: '0000A0', lightblue: 'ADD8E6', purple: '800080', yellow: 'FFFF00', lime: '00FF00', fuchsia: 'FF00FF', white: 'FFFFFF', silver: 'C0C0C0', grey: '808080', gray: '808080', black: '000000', orange: 'FFA500', brown: 'A52A2A', maroon: '800000', green: '008000', olive: '808000', navy: '000080', teal: '008080', aqua: '00FFFF', magenta: 'FF00FF' };

const bodyKey = body => body === 'male' || body === 'female' ? body : '';
const bodyEnum = key => key === 'male' || key === 'female' ? key : '';
const familyKey = key => ['robot', 'pet', 'shared'].includes(key) ? key : 'human';

/** Indexes a loaded contract the way AvatarOptionCatalog does (first id wins). */
export function creatorContract(raw) {
  if (!raw || raw.schema !== 1 || !Array.isArray(raw.groups)) throw new Error('Unsupported creator contract.');
  const rows = new Map(), slots = new Map(), sliders = new Map(), groups = new Map();
  for (const group of raw.groups) {
    if (!groups.has(group.id)) groups.set(group.id, group);
    for (const row of group.rows) { if (!rows.has(row.categoryId)) rows.set(row.categoryId, row); row.legalSet = new Set(row.legal); row.tileOrdinals = row.tiles.map(tile => tile.ordinal); row.realSet = row.realOrdinals ? new Set(row.realOrdinals) : null; }
    for (const slot of group.colourSlots) if (!slots.has(slot.id)) slots.set(slot.id, slot);
    for (const slider of group.sliders) if (!sliders.has(slider.shapeId)) sliders.set(slider.shapeId, slider);
  }
  return { ...raw, rows, slots, sliders, groupById: groups, hatless: new Set(raw.rules.hatlessHair), posture: raw.groups.flatMap(group => group.posture) };
}

/** AvatarOptionCatalog.GroupsFor: the family's own visible groups, then the shared ones (posture). */
export function groupsFor(contract, family) {
  const own = contract.groups.filter(group => !group.hidden && group.family === family && family !== 'shared');
  return own.length ? own.concat(contract.groups.filter(group => !group.hidden && group.family === 'shared')) : [];
}

// ---------------------------------------------------------------- AvatarConfig

export function newConfig() { return { Version: 2, Family: 'human', BodyType: 'male', Selections: [], Colours: [], Toggles: [], RobotVisemeGrade: 'limited', Shapes: [], GlowIntensity: .5, ToeOut: 0, FeetApart: 0 }; }

/** AvatarConfig.FromJson: Unity's defaults for missing fields, posture held to range, version migration. */
export function configFromJson(source, contract) {
  const raw = typeof source === 'string' ? JSON.parse(source) : source;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The document must contain an AvatarConfig object.');
  const cfg = newConfig();
  cfg.Version = Number.isInteger(raw.Version) ? raw.Version : 0;
  cfg.Family = typeof raw.Family === 'string' && raw.Family ? raw.Family : 'human';
  cfg.BodyType = typeof raw.BodyType === 'string' ? raw.BodyType : 'male';
  const list = (value, map) => Array.isArray(value) ? value.filter(row => row && typeof row === 'object').map(map) : [];
  cfg.Selections = list(raw.Selections, row => ({ CategoryId: String(row.CategoryId ?? ''), BodyType: String(row.BodyType ?? ''), Ordinal: Number.isFinite(row.Ordinal) ? Math.trunc(row.Ordinal) : 0 }));
  cfg.Colours = list(raw.Colours, row => ({ SlotId: String(row.SlotId ?? ''), Hex: String(row.Hex ?? '') }));
  cfg.Toggles = list(raw.Toggles, row => ({ CategoryId: String(row.CategoryId ?? ''), On: row.On === true }));
  cfg.Shapes = list(raw.Shapes, row => ({ Id: String(row.Id ?? ''), Value: Number.isFinite(row.Value) ? Math.trunc(row.Value) : 0 }));
  cfg.RobotVisemeGrade = typeof raw.RobotVisemeGrade === 'string' && raw.RobotVisemeGrade ? raw.RobotVisemeGrade : 'limited';
  cfg.GlowIntensity = Number.isFinite(raw.GlowIntensity) && raw.GlowIntensity > 0 ? raw.GlowIntensity : .5;
  cfg.ToeOut = Number.isFinite(raw.ToeOut) ? Math.trunc(raw.ToeOut) : 0; cfg.FeetApart = Number.isFinite(raw.FeetApart) ? Math.trunc(raw.FeetApart) : 0;
  for (const slider of contract?.posture || []) setPosture(cfg, slider.id, getPosture(cfg, slider.id), contract);
  if (cfg.Version < 2) {
    for (const [fromCategory, fromOrdinal, toCategory, toOrdinal] of MOVED_V2) {
      const index = cfg.Selections.findIndex(row => row.CategoryId === fromCategory && row.Ordinal === fromOrdinal); if (index < 0) continue;
      const [moved] = cfg.Selections.splice(index, 1);
      if (getOrdinal(cfg, toCategory, bodyEnum(moved.BodyType), 0) > 0) continue;
      setOrdinal(cfg, toCategory, bodyEnum(moved.BodyType), toOrdinal);
    }
    cfg.Toggles = cfg.Toggles.filter(row => row.CategoryId !== 'robot.colour.glow');
    if (Math.abs(cfg.GlowIntensity - 1) < 1e-6) cfg.GlowIntensity = .5;
    cfg.Version = 2;
  }
  return cfg;
}
export const cloneConfig = cfg => JSON.parse(JSON.stringify(cfg));

export function getOrdinal(cfg, category, body, fallback) { const key = bodyKey(body); return cfg.Selections.find(row => row.CategoryId === category && (row.BodyType || '') === key)?.Ordinal ?? fallback; }
export function hasSelection(cfg, category, body) { const key = bodyKey(body); return cfg.Selections.some(row => row.CategoryId === category && (row.BodyType || '') === key); }
/** AvatarConfig.SetOrdinal: an existing entry moves to the end, because the last pick wins part conflicts. */
export function setOrdinal(cfg, category, body, ordinal) {
  const key = bodyKey(body), index = cfg.Selections.findIndex(row => row.CategoryId === category && (row.BodyType || '') === key);
  if (index >= 0) { const [entry] = cfg.Selections.splice(index, 1); entry.Ordinal = ordinal; cfg.Selections.push(entry); return; }
  cfg.Selections.push({ CategoryId: category, BodyType: key, Ordinal: ordinal });
}
function removeSelection(cfg, category, body) { const key = bodyKey(body); cfg.Selections = cfg.Selections.filter(row => !(row.CategoryId === category && (row.BodyType || '') === key)); }
export function getColour(cfg, slot) { const entry = cfg.Colours.find(row => row.SlotId === slot); return entry ? parseColour(entry.Hex) : null; }
export function setColour(cfg, slot, hex) {
  const value = '#' + parseColour(hex).map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase(), entry = cfg.Colours.find(row => row.SlotId === slot);
  if (entry) entry.Hex = value; else cfg.Colours.push({ SlotId: slot, Hex: value });
}
export function removeColour(cfg, slot) { cfg.Colours = cfg.Colours.filter(row => row.SlotId !== slot); }
export function getToggle(cfg, category) { return cfg.Toggles.find(row => row.CategoryId === category)?.On ?? false; }
export function setToggle(cfg, category, on) { const entry = cfg.Toggles.find(row => row.CategoryId === category); if (entry) entry.On = on; else cfg.Toggles.push({ CategoryId: category, On: on }); }
const defaultWeight = (id, body) => id === BODY_FEMALE && body === 'female' ? 100 : 0;
export function getShape(cfg, id) { const entry = cfg.Shapes.find(row => row.Id === id); return entry ? entry.Value : defaultWeight(id, bodyEnum(cfg.BodyType)); }
export function setShape(cfg, id, value, contract) {
  if (!id) return;
  const min = Math.min(0, contract?.sliders.get(id)?.min ?? 0);
  value = Math.max(min, Math.min(100, Math.round(value)));
  if (value === defaultWeight(id, bodyEnum(cfg.BodyType))) { removeShape(cfg, id); return; }
  const entry = cfg.Shapes.find(row => row.Id === id); if (entry) entry.Value = value; else cfg.Shapes.push({ Id: id, Value: value });
}
export function removeShape(cfg, id) { cfg.Shapes = cfg.Shapes.filter(row => row.Id !== id); }
export function getPosture(cfg, id) { return id === 'toe_out' ? cfg.ToeOut : id === 'feet_apart' ? cfg.FeetApart : 0; }
export function setPosture(cfg, id, value, contract) {
  const slider = contract?.posture.find(row => row.id === id); if (!slider) return;
  value = Math.max(slider.min, Math.min(slider.max, Math.trunc(value)));
  if (id === 'toe_out') cfg.ToeOut = value; else if (id === 'feet_apart') cfg.FeetApart = value;
}

// ---------------------------------------------------------------- actions

export const blocksHeadgear = (contract, hairOrdinal) => hairOrdinal > 0 && contract.hatless.has(hairOrdinal);
/** ClothingLayers.Pick: an outfit clears the separately picked pieces; a bare-headed hair style takes the headgear off. */
export function pick(cfg, contract, category, body, ordinal) {
  setOrdinal(cfg, category, body, ordinal);
  if (category === HUMAN_HAIR && blocksHeadgear(contract, ordinal)) setOrdinal(cfg, HUMAN_HAT, '', 0);
  if (category === HUMAN_OUTFIT) cfg.Selections = cfg.Selections.filter(row => !PIECES.has(row.CategoryId));
}
/** BodyShape.SetFemale: the masculine-feminine slider also picks the body, carrying per-body picks across. */
export function setFemale(cfg, contract, weight) {
  setShape(cfg, BODY_FEMALE, weight, contract);
  const body = weight >= (contract.rules.femaleFrom ?? 50) ? 'female' : 'male', old = bodyEnum(cfg.BodyType) || 'male';
  if (body !== old) { cfg.Selections = cfg.Selections.filter(row => (row.BodyType || '') !== body); for (const row of cfg.Selections) if ((row.BodyType || '') === old) row.BodyType = body; }
  cfg.BodyType = body;
}
/** DefaultLook.TryGetOrdinal. */
export function defaultOrdinal(cfg, category, body) {
  body = bodyEnum(body) || 'male';
  for (const part of DEFAULT_PARTS) {
    if (part.category !== category || (part.body && part.body !== body)) continue;
    if (part.clothing && hasSelection(cfg, HUMAN_OUTFIT, body)) break;
    return part.ordinal;
  }
  return null;
}
/** DefaultLook.Ordinal: the stored pick, else the default look's, else the fallback. */
export function shownOrdinal(cfg, category, rowBody, body, fallback) {
  if (hasSelection(cfg, category, rowBody)) return getOrdinal(cfg, category, rowBody, fallback);
  return defaultOrdinal(cfg, category, body) ?? fallback;
}
/** HumanColourDefaults.TryDerive: what an unset slot shows (eye/hair start colours, lips/nails a shade of skin…). */
export function derivedColour(cfg, slot) {
  if (DEFAULT_COLOURS[slot]) return DEFAULT_COLOURS[slot];
  for (const [target, from, shade] of DERIVED) {
    if (target !== slot) continue;
    const source = getColour(cfg, from) || (DEFAULT_COLOURS[from] ? parseColour(DEFAULT_COLOURS[from]) : null); if (!source) continue;
    return '#' + source.map(channel => Math.round(channel / 255 * shade * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return null;
}

// ---------------------------------------------------------------- legality (OptionAvailability at the contract level)

const isHole = (row, ordinal) => ordinal > 0 && !!row.realSet && !row.realSet.has(ordinal);
const allowance = (contract, id) => contract.allowances[id] || { enabled: false, custom: false, grade: null };
export function isLegal(contract, row, ordinal) {
  if (!row) return false;
  if (ordinal <= 0) return row.allowNone;
  if (isHole(row, ordinal)) return false;
  return ordinal <= row.placeholderCount ? row.legalSet.has(ordinal) : allowance(contract, row.categoryId).custom;
}
export function tileState(row, ordinal) { if (ordinal <= 0) return { unlocked: true, unlockLevel: 0 }; const tile = row.tiles.find(item => item.ordinal === ordinal); return tile ? { unlocked: tile.unlocked, unlockLevel: tile.unlockLevel } : { unlocked: row.legalSet.has(ordinal), unlockLevel: 0 }; }

// ---------------------------------------------------------------- AvatarConfigResolver.Clamp / WornConfig.For

/** WornConfig.For: a clamped copy; the stored config is never changed. */
export function wornConfig(stored, contract, changes = null) { return clamp(cloneConfig(stored), contract, changes); }

export function clamp(cfg, contract, changes = null) {
  const note = text => changes?.push(text);
  // Family and body.
  let family = familyKey(cfg.Family); if (family === 'shared') family = 'human';
  if (!contract.families.includes(family)) family = contract.families[0] || 'human';
  if (cfg.Family !== family) { note("Avatar family '" + (cfg.Family ?? '') + "' -> '" + family + "'"); cfg.Family = family; }
  if (!bodyEnum(cfg.BodyType)) { note("Body type '" + (cfg.BodyType ?? '') + "' -> 'male'"); cfg.BodyType = 'male'; }
  // Selections, over every row of every group (hidden ones too).
  for (const group of contract.groups) for (const row of group.rows) for (const body of row.perBodyType ? ['male', 'female'] : ['']) {
    if (!hasSelection(cfg, row.categoryId, body)) {
      if (row.allowNone || defaultOrdinal(cfg, row.categoryId, row.perBodyType ? body : bodyEnum(cfg.BodyType)) !== null) continue;
      const first = row.tileOrdinals.find(ordinal => ordinal > 0 && isLegal(contract, row, ordinal)) ?? -1;
      if (first > 0 && first !== row.lowestOrdinal) setOrdinal(cfg, row.categoryId, body, first);
      continue;
    }
    const stored = getOrdinal(cfg, row.categoryId, body, row.minOrdinal);
    if (isLegal(contract, row, stored)) continue;
    const replacement = highestLegalAtOrBelow(contract, row, stored);
    if (replacement < 0) { note(row.rawTitle + ': ' + stored + ' removed (nothing unlocked yet)'); removeSelection(cfg, row.categoryId, body); continue; }
    note(row.rawTitle + ': ' + stored + ' -> ' + replacement);
    setOrdinal(cfg, row.categoryId, body, replacement);
  }
  // Colours: unknown slots and unreadable values go; presets snap to the nearest swatch; locked slots lose theirs.
  for (const entry of [...cfg.Colours]) {
    const slot = contract.slots.get(entry.SlotId), colour = slot ? parseColour(entry.Hex) : null;
    if (!slot || !colour) { note('colour ' + entry.SlotId + ' removed'); cfg.Colours.splice(cfg.Colours.indexOf(entry), 1); continue; }
    const state = slot.state;
    if (state.mode === 'Full') continue;
    if (state.mode === 'Presets') {
      const presets = state.presets.map(parseColour);
      if (presets.some(preset => preset.every((channel, i) => channel === colour[i]))) continue;
      let best = presets[0], bestDistance = Infinity;
      for (const preset of presets) { const d = preset.reduce((sum, channel, i) => sum + ((channel - colour[i]) / 255) ** 2, 0); if (d < bestDistance) { bestDistance = d; best = preset; } }
      note(slot.label + ': nearest unlocked swatch'); setColour(cfg, slot.id, '#' + best.map(channel => channel.toString(16).padStart(2, '0')).join('')); continue;
    }
    note(slot.label + ': removed'); cfg.Colours.splice(cfg.Colours.indexOf(entry), 1);
  }
  // Capabilities switch off when not unlocked.
  for (const toggle of cfg.Toggles) if (toggle.On && !allowance(contract, toggle.CategoryId).enabled) { note(toggle.CategoryId + ': switched off'); toggle.On = false; }
  // Sculpt sliders: unknown or locked go back to default; unlocked ones stay in range.
  for (const entry of [...cfg.Shapes]) {
    const slider = contract.sliders.get(entry.Id);
    if (!slider || !slider.enabled) { note('Shape ' + entry.Id + ' back to default'); cfg.Shapes.splice(cfg.Shapes.indexOf(entry), 1); continue; }
    const capped = Math.max(slider.min, Math.min(slider.max, entry.Value));
    if (capped !== entry.Value) { note(slider.label + ' ' + entry.Value + ' -> ' + capped); entry.Value = capped; }
  }
  // Robot face visemes fall to the highest unlocked grade.
  const face = contract.groupById.get('robot.face'), grades = face?.grades || [], stored = cfg.RobotVisemeGrade ?? '';
  if (!grades.some(grade => grade.grade === stored && grade.unlocked)) {
    const best = [...grades].reverse().find(grade => grade.unlocked)?.grade ?? (contract.rules.defaultVisemeGrade || 'limited');
    if (best !== stored) { note("Robot face visemes: '" + stored + "' -> '" + best + "'"); cfg.RobotVisemeGrade = best; }
  }
  // Glow strength stays under what the level's grade allows.
  const limits = contract.glowLimits, wanted = Math.max(limits.min, Math.min(limits.top, cfg.GlowIntensity));
  if (Math.abs(wanted - cfg.GlowIntensity) > 1e-6 * Math.max(1, Math.abs(wanted))) { note('Glow intensity ' + cfg.GlowIntensity + ' -> ' + wanted); cfg.GlowIntensity = wanted; }
  return cfg;
}

function highestLegalAtOrBelow(contract, row, stored) {
  const tiles = row.tileOrdinals, index = stored > 0 ? tiles.indexOf(stored) : -1;
  const candidates = index >= 0 ? tiles.slice(0, index).filter(ordinal => ordinal > 0).reverse() : (() => { const below = []; for (let ordinal = Math.min(stored - 1, row.placeholderCount); ordinal >= 1; ordinal--) if (!isHole(row, ordinal)) below.push(ordinal); return below; })();
  for (const ordinal of candidates) if (isLegal(contract, row, ordinal)) return ordinal;
  if (!row.allowNone) for (const ordinal of tiles) if (isLegal(contract, row, ordinal)) return ordinal;
  return isLegal(contract, row, row.minOrdinal) ? row.minOrdinal : -1;
}

/** ColorMath.TryParse for the forms a stored colour uses: #RGB, #RRGGBB, #RRGGBBAA, bare hex, rgb()/rgba() and named colours. Returns [r,g,b] bytes or null. */
export function parseColour(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let s = text.trim();
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*[\d.]+%?\s*)?\)$/i.exec(s);
  if (rgb) return rgb.slice(1, 4).map(value => Math.max(0, Math.min(255, Math.round(Number(value)))));
  if (s[0] !== '#' && /^[0-9a-f]{3,8}$/i.test(s)) s = '#' + s;
  if (s[0] !== '#') { const named = NAMED[s.toLowerCase()]; if (!named) return null; s = '#' + named; }
  const hex = s.slice(1);
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map(ch => ch + ch).join('') : hex;
  return [0, 2, 4].map(at => parseInt(full.slice(at, at + 2), 16));
}
