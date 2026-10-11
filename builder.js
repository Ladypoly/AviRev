import { assetJSON } from './builder-assets.mjs';
import { AvatarRenderer } from './builder-renderer.mjs';
import { freshConfig, parseConfig, pick, setFemale, setShape, shapeValue, setColour, selectedOrdinal, resolve, optionsOf, PIECES } from './builder-model.mjs';

const $ = id => document.getElementById(id), storageKey = 'avirev.avatar-config.v2';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let data, config = freshConfig(), renderer, groupId, request, refreshToken = 0, lastFamily;
const authoring = () => $('authoring').checked;
const family = () => data.families.find(item => item.Family.toLowerCase() === config.Family);
const shapeTable = () => data.HumanShapes || [];
function normalize(source) {
  source.humanShapes = source.HumanShapes || source.humanShapes || [];
  source.defaults = source.Rules?.DefaultLook || source.defaults || {};
  source.rules = { ...source.rules, hatlessHair: source.Rules?.HatlessHair, hiddenTiles: source.Rules?.HiddenTiles };
  for (const family of source.families || []) { family.materials = source.materials || family.materials || []; if (family.BodyOcclusion) family.BodyOcclusion.IsCompatible = family.BodyOcclusionCompatible !== false; }
  if (Array.isArray(source.rules.hiddenTiles)) { const map = {}; for (const row of source.rules.hiddenTiles) (map[row.CategoryId] ??= []).push(row.Ordinal); source.rules.hiddenTiles = map; }
  return source;
}
function groups() {
  const actual = (data.OptionGroups || []).filter(item => String(item.VisibleForFamily || item.Family).toLowerCase() === config.Family || String(item.VisibleForFamily).toLowerCase() === 'shared' || item.Id === 'shared.posture');
  return actual.filter((item, index) => !['pet.pets', 'shared.custom_avatar'].includes(item.Id) && (authoring() || !item.Hidden) && actual.findIndex(other => other.Id === item.Id) === index).sort((a, b) => Number(a.Id.startsWith('shared.')) - Number(b.Id.startsWith('shared.')));
}
function save() { try { localStorage.setItem(storageKey, JSON.stringify(config)); $('storage-status').textContent = 'Saved in this browser. Export JSON to keep a copy.'; } catch { $('storage-status').textContent = 'Browser storage is unavailable. Export JSON to keep this look.'; } }
function button(text, action) { const node = el('button', text); node.type = 'button'; node.onclick = action; return node; }
function section(label) { const node = el('section', undefined, 'control-section'); node.append(el('h3', label)); $('builder-controls').append(node); return node; }
function slider(parent, label, value, min, max, changed, step = 1, unit = '') {
  const wrapper = el('div', undefined, 'slider-row'), header = el('div', undefined, 'slider-label'), title = el('label', label), output = el('output', value + unit), controls = el('div', undefined, 'slider-input');
  const range = el('input'), number = el('input'); range.type = 'range'; number.type = 'number';
  for (const input of [range, number]) { input.min = min; input.max = max; input.step = step; input.value = value; input.setAttribute('aria-label', label); }
  const update = input => { let next = Number(input.value); if (!Number.isFinite(next)) return; next = Math.min(max, Math.max(min, Math.round(next / step) * step)); range.value = number.value = next; output.textContent = next + unit; changed(next); };
  range.oninput = () => update(range); number.oninput = number.onchange = () => update(number); title.htmlFor = range.id = 'slider-' + label.replace(/\W+/g, '-'); header.append(title, output); controls.append(range, number, button('↺', () => { range.value = 0; update(range); })); wrapper.append(header, controls); parent.append(wrapper);
}
function rowOptions(row) {
  const f = family(), options = optionsOf(f).filter(option => option.CategoryId === row.CategoryId);
  const hidden = data.rules.hiddenTiles?.[row.CategoryId] || [], real = row.RealOrdinals;
  let values = options.map(option => ({ ordinal: option.Ordinal, title: option.Label || option.Name || `Choice ${option.Ordinal}`, unavailable: option.Unavailable, option }));
  if (!values.length && Array.isArray(real)) values = real.map(ordinal => ({ ordinal, title: row.Titles?.[ordinal - 1] || row.RealTitles?.[ordinal - 1] || `Choice ${ordinal}` }));
  if (row.CategoryId === 'robot.eyes') values = (data.RobotEyePresets || []).map((preset, index) => ({ ordinal: index + 1, title: preset.Title }));
  if (row.CategoryId === 'robot.face.rest') values = (data.RobotRestMouths || []).map((texture, index) => ({ ordinal: index + 1, title: texture.name || `Rest mouth ${index + 1}` }));
  if (!authoring()) values = values.filter(value => !hidden.includes(value.ordinal) && (!real || real.includes(value.ordinal)));
  if (row.AllowNone) values.unshift({ ordinal: 0, title: 'None' }); return values;
}
function optionRow(row) {
  if (!authoring() && (row.Hidden || PIECES.includes(row.CategoryId))) return;
  const values = rowOptions(row); if (!values.length) return;
  const parent = section(row.Title || row.Label || row.CategoryId), search = el('input', undefined, 'option-search'); search.type = 'search'; search.placeholder = `Find ${row.Title || 'a choice'}…`; search.setAttribute('aria-label', search.placeholder); parent.append(search);
  const grid = el('div', undefined, 'option-grid'); parent.append(grid);
  const render = () => { grid.replaceChildren(); const current = selectedOrdinal(config, row.CategoryId, row.PerBodyType, data);
    for (const value of values.filter(item => item.title.toLowerCase().includes(search.value.toLowerCase()))) {
      const node = button(value.title, () => { pick(config, family(), row.CategoryId, value.ordinal, data); drawControls(); refresh(); }); node.setAttribute('aria-pressed', current === value.ordinal);
      const blocked = row.CategoryId === 'human.hat' && value.ordinal && data.rules.hatlessHair?.includes(selectedOrdinal(config, 'human.hair.style', true, data));
      node.disabled = !!value.unavailable || !!blocked; node.title = blocked ? 'This hairstyle excludes headgear in Unity.' : value.unavailable ? 'This ordinal is retired or unavailable.' : `${row.CategoryId} · ${value.ordinal}`;
      node.append(el('span', value.ordinal === 0 ? 'Clear selection' : `#${value.ordinal}${value.unavailable ? ' · unavailable' : ''}`)); grid.append(node);
    }
    if (!grid.childElementCount) grid.append(el('p', 'No matching choices.', 'empty-options'));
  }; search.oninput = render; render();
}
function colourRow(parent, slot) {
  if (slot.ShownWithCategoryId && selectedOrdinal(config, slot.ShownWithCategoryId, false, data) <= 0) return;
  const id = slot.Id || slot.SlotId, row = el('div', undefined, 'color-row'), label = el('label', slot.Label || id), small = el('small', config.Colours.some(value => value.SlotId === id) ? 'Custom review colour' : 'Authored / inherited colour'), input = el('input'); input.type = 'color'; input.value = request?.Colours[id] || '#ffffff'; input.setAttribute('aria-label', slot.Label || id); input.oninput = () => { setColour(config, id, input.value); small.textContent = 'Custom review colour'; refresh(); }; label.append(small); row.append(label, input, button('Reset', () => { setColour(config, id, null); drawControls(); refresh(); })); parent.append(row);
}
function drawControls() {
  request = resolve(config, family(), data, authoring());
  const available = groups(); if (!available.some(group => group.Id === groupId)) groupId = available[0]?.Id;
  $('builder-groups').replaceChildren(); for (const group of available) { const node = button(group.Label || group.Title || group.Id, () => { groupId = group.Id; drawControls(); }); node.setAttribute('aria-pressed', group.Id === groupId); $('builder-groups').append(node); }
  $('builder-controls').replaceChildren(); const group = available.find(item => item.Id === groupId); if (!group) { $('builder-controls').append(el('p', 'This snapshot has no creator control groups.', 'notice')); return; }
  for (const row of group.Rows || []) optionRow(row);
  const sliders = group.Sliders || []; if (sliders.length) { const parent = section('Sculpt'); for (const row of sliders) { const definition = shapeTable().find(shape => shape.Id === row.ShapeId); if (!definition || definition.Hidden && !authoring()) continue; slider(parent, row.Label || definition.Label, shapeValue(config, row.ShapeId), definition.MinWeight ?? 0, definition.MaxWeight ?? 100, value => { if (row.ShapeId === 'body_female') setFemale(config, value, shapeTable()); else setShape(config, row.ShapeId, value, shapeTable()); refresh(); }); } }
  if (group.Grades?.length && group.GradeCategoryId === 'robot.face.visemes') { const parent = section('Viseme range'), choices = el('div', undefined, 'segments'); for (const grade of group.Grades) { const node = button(grade.Label, () => { config.RobotVisemeGrade = grade.Grade; drawControls(); refresh(); }); node.setAttribute('aria-pressed', config.RobotVisemeGrade === grade.Grade); choices.append(node); } parent.append(choices, el('p', 'Saved for Unity lip sync. The static browser preview shows the chosen resting mouth.', 'hint')); }
  if (group.ColourSlots?.length) { const parent = section('Colour'); for (const slot of group.ColourSlots) colourRow(parent, slot); parent.append(el('p', 'Review colour picker. Player reward palettes and ownership are supplied by Unity’s account services.', 'hint')); }
  if (group.Id === 'robot.colours' || group.GlowCategoryId) { const parent = section('Glow'); slider(parent, 'Glow strength', config.GlowIntensity, .5, 2.5, value => { config.GlowIntensity = value; refresh(); }, .1, '×'); }
  if (group.Id === 'shared.posture') { const parent = section('Standing posture'); parent.append(el('p', 'Static standing IK preview on the imported rig. Unity adds live tracking, grounding and animation.', 'hint')); slider(parent, 'Toes out', config.ToeOut, -10, 20, value => { config.ToeOut = value; refresh(); }, 1, '°'); slider(parent, 'Feet apart', config.FeetApart, -6, 20, value => { config.FeetApart = value; refresh(); }, 1, ' cm'); }
  if (!$('builder-controls').childElementCount) $('builder-controls').append(el('p', 'No mesh-backed choices in this group for the current snapshot.', 'hint'));
}
function diagnostic(stats) {
  const node = $('diagnostic-content'); node.replaceChildren();
  const notes = [...stats.materialNotes, ...stats.missing.map(name => `Requested mesh missing: ${name}`)]; if (config.ToeOut || config.FeetApart) notes.push(stats.posture);
  const reachError = Math.max(0, ...(stats.postureLegs || []).map(leg => leg.targetError)); if (reachError > .001) notes.push(`Static leg reach limits the standing target by ${(reachError * 100).toFixed(1)} cm. Live ground/hip motion is handled by Unity.`);
  if (notes.length) { const list = el('ul'); for (const note of notes) list.append(el('li', note)); node.append(list); }
  node.append(el('p', `Unity ${data.unityVersion || 'version unavailable'} · ${config.Family} catalog ${family().Version} · ${stats.hiddenTriangles.toLocaleString()} body triangles covered`, 'hint'));
  node.append(el('pre', 'Worn parts\n' + request.MeshNames.join('\n') + '\n\nActive shapes\n' + Object.entries(request.ShapeWeights).filter(([, value]) => value).map(([id, value]) => `${id}: ${value}`).join('\n')));
}
async function refresh(frame = false) {
  const token = ++refreshToken; save(); $('loading').hidden = false;
  try { const f = family(); if (!f) throw new Error(`No ${config.Family} catalog in this snapshot.`); request = resolve(config, f, data, authoring());
    const stats = await renderer.update(f, request, config, frame || lastFamily !== config.Family); if (token !== refreshToken || !stats) return;
    lastFamily = config.Family; $('scene-status').textContent = `${config.Family === 'human' ? 'Human' : 'Robot'} / ${config.BodyType} / ${stats.meshes} imported parts${authoring() ? ' / authoring controls' : ''}`;
    $('mesh-stats').textContent = `${stats.triangles.toLocaleString()} visible triangles · ${stats.vertices.toLocaleString()} vertices · ${stats.hiddenTriangles.toLocaleString()} body cuts`;
    diagnostic(stats); document.querySelectorAll('[data-family]').forEach(button => button.setAttribute('aria-pressed', button.dataset.family === config.Family));
  } catch (error) { $('scene-status').textContent = error.message; $('diagnostic-content').replaceChildren(el('p', error.message, 'notice')); $('diagnostics').hidden = false; console.error(error); }
  finally { if (token === refreshToken) $('loading').hidden = true; }
}
function download(url, name) { const anchor = el('a'); anchor.href = url; anchor.download = name; anchor.click(); }
function applyImport() { try { const next = parseConfig($('config-text').value); config = next; $('config-dialog').close(); groupId = undefined; drawControls(); refresh(true); } catch (error) { $('config-error').textContent = error.message; } }
async function start() {
  try {
    data = normalize(await assetJSON('browser_data/catalog.json')); if (!Array.isArray(data.families) || !data.families.length) throw new Error('The native Unity catalog export is unavailable.');
    try { const saved = localStorage.getItem(storageKey); if (saved) config = parseConfig(saved); } catch { $('storage-status').textContent = 'Stored configuration could not be read; using the default look.'; }
    renderer = new AvatarRenderer($('viewport'), data); request = resolve(config, family(), data, false); drawControls();
    document.querySelectorAll('[data-family]').forEach(node => node.onclick = () => { config.Family = node.dataset.family; groupId = undefined; drawControls(); refresh(true); });
    document.querySelectorAll('[data-camera]').forEach(node => node.onclick = () => { renderer.frame(node.dataset.camera); document.querySelectorAll('[data-camera]').forEach(button => button.setAttribute('aria-pressed', button === node)); });
    $('frame').onclick = () => renderer.frame(); $('wire').onchange = $('cuts').onchange = () => renderer.overlays($('wire').checked, $('cuts').checked);
    $('snapshot').onclick = () => download(renderer.snapshot(), `avirev-${config.Family}-${Date.now()}.png`);
    $('authoring').onchange = () => { drawControls(); refresh(); }; $('reset-config').onclick = () => { const selectedFamily = config.Family; config = freshConfig(); config.Family = selectedFamily; drawControls(); refresh(true); };
    $('diagnostics-toggle').onclick = () => { $('diagnostics').hidden = !$('diagnostics').hidden; $('diagnostics-toggle').setAttribute('aria-expanded', !$('diagnostics').hidden); };
    $('import-config').onclick = () => { $('config-text').value = JSON.stringify(config, null, 2); $('config-error').textContent = ''; $('config-dialog').showModal(); };
    $('close-config').onclick = () => $('config-dialog').close(); $('apply-config').onclick = applyImport;
    $('config-file').onchange = async () => { const file = $('config-file').files[0]; if (file?.size > 1_000_000) { $('config-error').textContent = 'Choose a JSON file smaller than 1 MB.'; return; } if (file) $('config-text').value = await file.text(); };
    $('export-config').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })); download(url, `AvatarConfig-${config.Family}.json`); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    window.AVIREV_BUILDER = { getConfig: () => JSON.parse(JSON.stringify(config)), getRequest: () => JSON.parse(JSON.stringify(request)), getStats: () => renderer.stats, applyConfig: source => { config = parseConfig(typeof source === 'string' ? source : JSON.stringify(source)); drawControls(); return refresh(true); }, ready: false };
    await refresh(true); window.AVIREV_BUILDER.ready = !!renderer.stats;
  } catch (error) { $('loading').hidden = true; $('fatal').hidden = false; $('fatal-message').textContent = error.message; console.error(error); }
}
start();
