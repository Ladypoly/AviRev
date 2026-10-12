// Replays Unity-computed reference cases (tests/fixtures/unity_creator_vectors.json, written by the native exporter at the
// contract's level) against builder-contract.mjs: WornConfig.For clamps, ClothingLayers.Pick / BodyShape.SetFemale
// sequences, DefaultLook.Ordinal and HumanColourDefaults.TryDerive. Every field must match Unity exactly.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as model from '../builder-contract.mjs';

const root = new URL('../', import.meta.url);
const contract = model.creatorContract(JSON.parse(await readFile(new URL('browser_data/creator_contract.json', root), 'utf8')));
const vectors = JSON.parse(await readFile(new URL('tests/fixtures/unity_creator_vectors.json', root), 'utf8'));
assert.equal(vectors.level, contract.meta.topLevel, 'vectors were computed at the contract level');
let checks = 0; const failures = [];
const check = (ok, label) => { checks++; if (!ok) failures.push(label); };
const normal = cfg => ({ ...cfg, GlowIntensity: Math.round(cfg.GlowIntensity * 1e4) / 1e4, Selections: cfg.Selections.map(({ CategoryId, BodyType, Ordinal }) => ({ CategoryId, BodyType: BodyType ?? '', Ordinal })), Colours: cfg.Colours.map(({ SlotId, Hex }) => ({ SlotId, Hex })), Toggles: cfg.Toggles.map(({ CategoryId, On }) => ({ CategoryId, On })), Shapes: cfg.Shapes.map(({ Id, Value }) => ({ Id, Value })) });
const same = (a, b) => { try { assert.deepStrictEqual(normal(a), normal(b)); return true; } catch { return false; } };

vectors.clamp.forEach((vector, index) => {
  const changes = [], worn = model.wornConfig(model.configFromJson(vector.input, contract), contract, changes), expected = JSON.parse(vector.worn);
  check(same(worn, expected), 'clamp #' + index + ' worn config');
  check(changes.length === vector.changes.length, 'clamp #' + index + ' change count ' + changes.length + ' vs ' + vector.changes.length);
});

vectors.actions.forEach((vector, index) => {
  const cfg = model.newConfig();
  for (const step of vector.steps) if ('female' in step) model.setFemale(cfg, contract, step.female); else model.pick(cfg, contract, step.categoryId, step.body, step.ordinal);
  check(same(cfg, JSON.parse(vector.config)), 'action #' + index + ' config');
  const current = cfg.BodyType === 'female' ? 'female' : 'male';
  const shown = {}; for (const group of contract.groups) for (const row of group.rows) shown[row.categoryId] = model.shownOrdinal(cfg, row.categoryId, row.perBodyType ? current : '', current, row.defaultOrdinal);
  check(JSON.stringify(Object.keys(vector.shownOrdinals).sort().map(key => [key, shown[key]])) === JSON.stringify(Object.keys(vector.shownOrdinals).sort().map(key => [key, vector.shownOrdinals[key]])), 'action #' + index + ' shown ordinals');
  const derived = {}; for (const slot of contract.slots.keys()) { const value = model.derivedColour(cfg, slot); if (value) derived[slot] = value; }
  check(JSON.stringify(Object.entries(derived).sort()) === JSON.stringify(Object.entries(vector.derivedColours).sort()), 'action #' + index + ' derived colours');
});

// Contract facts the public creator must honour.
const skins = contract.rows.get('robot.skin');
check(skins.tileOrdinals.filter(ordinal => ordinal > 0).every(ordinal => ordinal <= 31), 'Robot skins beyond the reward ladder never get a tile');
check(!model.isLegal(contract, skins, 40), 'Robot skin 40 is not legal');

if (failures.length) { console.error(JSON.stringify({ status: 'FAIL', checks, failed: failures.length, first: failures.slice(0, 12) }, null, 1)); process.exit(1); }
console.log(JSON.stringify({ status: 'PASS', checks, coverage: 'Unity-computed WornConfig clamps (' + vectors.clamp.length + '), pick/body sequences with DefaultLook and derived colours (' + vectors.actions.length + '), ladder-only robot skins', contractLevel: contract.meta.topLevel, ladderSavedAt: contract.meta.ladderSavedAt }));
