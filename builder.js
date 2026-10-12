import { assetJSON } from './builder-assets.mjs?v=c326a7020e52';
import { AvatarRenderer } from './builder-renderer.mjs?v=3d146ec6d1d4';
import { XRConfiguratorPanel, creatorPanelBridge } from './builder-xr-panel.mjs?v=24dfcd6c31de';
import { AvatarAR } from './builder-ar.mjs?v=4bdd2aebc1ec';
import { resolve } from './builder-model.mjs?v=2776b8514534';
import * as rules from './builder-contract.mjs?v=4e819bf77c16';
import { ColourPicker } from './builder-colour.mjs?v=242184bdff1b';

// The Unity Avatar tab (AvatarPanelPresenter): three cards built from the native creator contract. The stored config is
// what the player chose and is never clamped; the avatar wears WornConfig.For(stored) (builder-contract.mjs).
const $ = id => document.getElementById(id), storageKey = 'avirev.avatar-config.v2';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let data, contract, config, renderer, request, refreshToken = 0, lastFamily, picker, pickerSlot;
let selectedGroupId = null, selectedSlotId = null, colourCollapsed = true, mirrorView = 'live', focusKind = 'Body', focusGroupId = null, showTeeth = false, pendingFrame = true;
const openRows = new Map();
const tr = (key, fallback) => contract?.strings?.['Options/Avatar/' + key] ?? fallback;
const format = (key, fallback, ...args) => tr(key, fallback).replace(/\{(\d+)\}/g, (_, index) => args[Number(index)] ?? '');
const levelCaption = level => level > 0 ? format('LevelShort', 'Lv {0}', level) : tr('Locked', 'Locked');
const currentBody = () => config.BodyType === 'female' ? 'female' : 'male';
const currentFamily = () => { const family = config.Family === 'shared' ? 'human' : config.Family; return contract.families.includes(family) ? family : contract.families[0]; };
const visibleGroups = () => rules.groupsFor(contract, currentFamily());

// ---------------------------------------------------------------- look history (headset Undo/Redo); a drag is one step
let lookHistory = [], historyIndex = -1, restoringHistory = false, lastRemembered = 0;
function remember() {
  const snapshot = JSON.stringify(config);
  if (restoringHistory) { lookHistory[historyIndex] = snapshot; restoringHistory = false; return; }
  if (lookHistory[historyIndex] === snapshot) return;
  const now = performance.now();
  if (historyIndex > 0 && historyIndex === lookHistory.length - 1 && now - lastRemembered < 700) { lookHistory[historyIndex] = snapshot; lastRemembered = now; return; }
  lastRemembered = now; lookHistory = lookHistory.slice(0, historyIndex + 1); lookHistory.push(snapshot); if (lookHistory.length > 60) lookHistory.shift(); historyIndex = lookHistory.length - 1;
}
function travel(step) { const next = historyIndex + step; if (next < 0 || next >= lookHistory.length) return false; historyIndex = next; restoringHistory = true; config = rules.configFromJson(lookHistory[next], contract); render(); refresh(true); return true; }

// ---------------------------------------------------------------- mirror focus (MirrorFocusMap)
const GROUP_FOCUS = { 'human.hair': 'Head', 'human.headgear': 'Head', 'human.eyewear': 'Face', 'human.jewellery': 'Bust', 'human.fantasy': 'Head', 'human.face': 'Face', 'human.eyes': 'Face', 'human.facial_hair': 'Face', 'robot.face': 'Face', 'human.footwear': 'Feet' };
const CATEGORY_FOCUS = { 'human.outfit.normal': 'Body', 'human.colour.outfit': 'Body', 'human.colour.skin': 'Body', 'human.colour.nails': 'Body', 'human.shoes': 'Feet', 'human.colour.shoes': 'Feet', 'robot.shoes': 'Feet', 'human.hair.style': 'Head', 'human.colour.hair': 'Head', 'human.colour.hair_tip': 'Head', 'human.hat': 'Head', 'human.colour.hat': 'Head', 'robot.accessory.head': 'Head', 'human.face.eyebrows': 'Face', 'human.face.eyes': 'Face', 'human.face.nose': 'Face', 'human.colour.eyes': 'Face', 'human.colour.eye_detail': 'Face', 'human.colour.lips': 'Face', 'human.beard': 'Face', 'human.colour.beard': 'Face', 'human.accessory': 'Face', 'robot.face.visemes': 'Face', 'robot.face.rest': 'Face', 'robot.eyes': 'Face', 'human.jewelry': 'Bust', 'human.costume': 'Bust', 'robot.scarf': 'Bust', 'robot.outfit': 'Body', 'robot.wings': 'Body', 'robot.tail': 'Body', 'robot.skin': 'Body' };
const SLOT_FOCUS = { 'hair.base': 'Head', 'hair.tip': 'Head', hat: 'Head', 'hat.secondary': 'Head', eye: 'Face', 'eye.white': 'Face', 'eye.pupil': 'Face', lips: 'Face', beard: 'Face', shoes: 'Feet', 'shoes.secondary': 'Feet', outfit: 'Body', 'outfit.secondary': 'Body', skin: 'Body', nails: 'Body', 'robot.primary': 'Body', 'robot.secondary': 'Body', 'robot.detail': 'Body', 'robot.skin.tint': 'Body' };
function focusOn(kind) { if (!kind || !renderer) return; if (kind !== focusKind) { focusKind = kind; renderer.focus(kind); pendingFrame = true; } }
function focusShape(shapeId) { if (shapeId === 'ears_bat' || shapeId === 'ears_elf') return 'Head'; const group = contract.groups.find(g => g.sliders.some(s => s.shapeId === shapeId)); return group ? GROUP_FOCUS[group.id] || 'Body' : null; }
function frameMirror() { if (!renderer) return; renderer.frame(mirrorView === 'side' ? 'side' : 'front'); pendingFrame = false; }

// ---------------------------------------------------------------- state changes (presenter intents)
function commit(frame = false) { save(); render(); refresh(frame); }
function selectGroup(id) { if (id !== selectedGroupId) { colourCollapsed = true; showTeeth = false; } selectedGroupId = id; render(); if (pendingFrame) frameMirror(); }
function setFamily(family) {
  const changed = currentFamily() !== family; config.Family = family; if (!['male', 'female'].includes(config.BodyType)) config.BodyType = 'male';
  if (changed || !selectedGroupId) selectedGroupId = visibleGroups()[0]?.id ?? null; colourCollapsed = true; commit(true);
}
function headgearBlocked() { const body = currentBody(); return rules.blocksHeadgear(contract, rules.shownOrdinal(config, rules.HUMAN_HAIR, body, body, 0)); }
function selectTile(categoryId, ordinal) {
  const row = contract.rows.get(categoryId); if (!row) return;
  const body = row.perBodyType ? currentBody() : '';
  if (!rules.isLegal(contract, row, ordinal)) return;
  if (categoryId === rules.HUMAN_HAT && ordinal > 0 && headgearBlocked()) return;
  showTeeth = false; rules.pick(config, contract, categoryId, body, ordinal); focusOn(CATEGORY_FOCUS[categoryId]); commit();
}
function toggleRow(groupId, categoryId) { openRows.set(groupId, openRows.get(groupId) === categoryId ? null : categoryId); colourCollapsed = true; if (openRows.get(groupId)) focusOn(CATEGORY_FOCUS[categoryId]); render(); if (pendingFrame) frameMirror(); }
function setShapeValue(slider, value, final) {
  if (!slider.enabled) return;
  value = Math.max(slider.min, Math.min(slider.max, Math.round(value)));
  if (slider.shapeId === rules.BODY_FEMALE) rules.setFemale(config, contract, value); else rules.setShape(config, slider.shapeId, value, contract);
  focusOn(focusShape(slider.shapeId)); showTeeth = !!slider.showsTeeth;
  if (final) commit(); else { refresh(); syncSliderValues(); }
}
function setPostureValue(posture, value, final) { rules.setPosture(config, posture.id, value, contract); focusOn('Feet'); showTeeth = false; if (final) commit(); else { refresh(); syncSliderValues(); } }
function setGrade(group, grade) { if (!group.grades.find(g => g.grade === grade)?.unlocked) return; config.RobotVisemeGrade = grade; focusOn(CATEGORY_FOCUS[group.gradeCategoryId]); commit(); }
function setToggle(categoryId, on) { rules.setToggle(config, categoryId, on); focusOn(CATEGORY_FOCUS[categoryId]); commit(); }
function applyColour(slot, hex, final) { rules.setColour(config, slot.id, hex); focusOn(SLOT_FOCUS[slot.id]); if (final) commit(); else { refresh(); $('veColourSwatch').style.background = hex; $('btnAvatarColour').style.background = hex; } }
function clearColour(slot) { if (!slot.resettable) return; rules.removeColour(config, slot.id); focusOn(SLOT_FOCUS[slot.id]); commit(); }
function setGlow(value, final) { config.GlowIntensity = Math.max(contract.glowLimits.min, Math.min(contract.glow.max, Number(value))); $('lblGlowStrengthValue').textContent = config.GlowIntensity.toFixed(1) + 'x'; if (final) commit(); else refresh(); }
function setColourOpen(open) { colourCollapsed = !open; if (open && pickerSlot) focusOn(SLOT_FOCUS[pickerSlot.id]); if (open) showTeeth = false; render(); if (pendingFrame) frameMirror(); }

// ---------------------------------------------------------------- render (AvatarPanelPresenter.RenderCore)
function summaryCaption(group) {
  const { unlocked, total, firstLevel, anythingEnabled } = group.summary;
  if (total > 0) return unlocked === 0 && firstLevel > 0 ? levelCaption(firstLevel) : format('GroupCount', '{0} of {1}', unlocked, total);
  return !anythingEnabled && firstLevel > 0 ? levelCaption(firstLevel) : '';
}
function render() {
  if (!contract) return;
  const family = currentFamily(), groups = visibleGroups();
  if (!groups.some(group => group.id === selectedGroupId)) selectedGroupId = groups[0]?.id ?? null;
  const group = groups.find(item => item.id === selectedGroupId);
  if (group && focusGroupId !== group.id) { focusGroupId = group.id; focusOn(GROUP_FOCUS[group.id] || 'Body'); }
  renderFamilies(family); renderGroups(groups); const hasBody = renderDetail(group); renderColour(group, hasBody); renderStatus(group);
}
function renderFamilies(family) {
  const bar = $('veAvatarFamily'); bar.replaceChildren();
  for (const key of contract.families) {
    const tile = el('button', contract.strings['Options/Avatar/Family/' + key[0].toUpperCase() + key.slice(1)] || key, 'family-tile'); tile.type = 'button'; tile.dataset.family = key; tile.setAttribute('aria-pressed', key === family); tile.onclick = () => setFamily(key); bar.append(tile);
  }
}
function renderGroups(groups) {
  const list = $('builder-groups'), scroll = list.scrollTop; list.replaceChildren();
  for (const group of groups) {
    const header = el('button', undefined, 'group-header'); header.type = 'button'; header.dataset.focusKey = 'group:' + group.id; header.setAttribute('aria-pressed', group.id === selectedGroupId);
    header.append(el('span', group.glyph || '', 'nav-glyph'), el('span', group.title, 'group-title nav-title'), el('span', summaryCaption(group), 'group-caption nav-count'), el('span', '›', 'group-chevron'));
    header.onclick = () => selectGroup(group.id); list.append(header);
  }
  list.scrollTop = scroll;
}
function renderDetail(group) {
  const body = $('builder-controls'), scroll = body.scrollTop; body.replaceChildren();
  $('detail-title').textContent = group?.title || ''; const hint = group?.hint || ''; $('detail-subtitle').textContent = hint; $('detail-subtitle').hidden = !hint;
  const caption = group ? summaryCaption(group) : ''; $('detail-count').textContent = caption; $('detail-count').hidden = !caption;
  if (!group) return false;
  const container = el('div', undefined, 'group-body'); body.append(container);
  const rows = group.rows.filter(row => !row.hidden);
  if (rows.length > 1 && !openRows.has(group.id)) openRows.set(group.id, rows[0].categoryId);
  const accordion = rows.length > 1, blocked = headgearBlocked(), bodyKey = currentBody();
  for (const row of rows) {
    const rowBody = row.perBodyType ? bodyKey : '', stored = rules.shownOrdinal(config, row.categoryId, rowBody, bodyKey, row.defaultOrdinal);
    let selected = rules.tileState(row, stored).unlocked && rules.isLegal(contract, row, stored) ? stored : -1;
    const hatRow = row.categoryId === rules.HUMAN_HAT && blocked; if (hatRow) selected = 0;
    const nameOf = tile => tile.ordinal <= 0 ? tr('None', 'None') : tile.names[rowBody] ?? tile.names[''] ?? Object.values(tile.names)[0] ?? '';
    const open = !accordion || openRows.get(group.id) === row.categoryId, pickTile = row.tiles.find(tile => tile.ordinal === selected);
    const header = el('button', undefined, 'row-header row-heading' + (accordion ? ' accordion' : '')); header.type = 'button'; header.dataset.focusKey = 'row:' + row.categoryId; header.setAttribute('aria-expanded', open); if (!accordion) header.tabIndex = -1;
    const pick = el('span', accordion && !open && pickTile ? nameOf(pickTile) : '', 'row-pick'); pick.hidden = !pick.textContent;
    const chevron = el('span', '›', 'row-chevron'); chevron.hidden = !accordion;
    header.append(el('span', row.title, 'row-title'), pick, chevron); if (accordion) header.onclick = () => toggleRow(group.id, row.categoryId); container.append(header);
    const grid = el('div', undefined, 'tile-grid'); grid.hidden = !open; container.append(grid);
    for (const tile of row.tiles) {
      const state = rules.tileState(row, tile.ordinal), name = nameOf(tile);
      let unlocked = state.unlocked, captionText = unlocked ? name : levelCaption(state.unlockLevel);
      if (hatRow && tile.ordinal > 0 && unlocked) { unlocked = false; captionText = tr('NotWithHair', 'Not with this hair'); }
      const button = el('button', undefined, 'option-tile'); button.type = 'button'; button.dataset.focusKey = 'tile:' + row.categoryId + ':' + tile.ordinal;
      button.setAttribute('aria-label', name); button.title = unlocked ? name : state.unlockLevel > 0 ? 'Unlocks at level ' + state.unlockLevel : captionText;
      button.setAttribute('aria-pressed', unlocked && tile.ordinal === selected); button.disabled = !unlocked;
      const glyph = el('span', tile.ordinal <= 0 ? '—' : group.glyph || '', 'tile-glyph'), caption = el('span', captionText, 'tile-caption');
      const url = tile.image?.[rowBody === 'female' ? 'female' : 'male'];
      if (url) { const image = el('img'); image.alt = ''; image.crossOrigin = 'anonymous'; image.decoding = 'async'; image.hidden = true; image.onload = () => { image.hidden = false; glyph.hidden = true; if (unlocked) caption.hidden = true; }; image.onerror = () => image.remove(); image.src = url; button.prepend(image); }
      button.append(glyph, caption, el('span', '✓', 'tile-tick'));
      button.onclick = () => { if (!button.disabled) selectTile(row.categoryId, tile.ordinal); };
      grid.append(button);
    }
  }
  for (const slider of group.sliders) container.append(sliderRow('Shape', slider.shapeId, slider.label, slider.min, slider.max, () => Math.max(slider.min, Math.min(slider.max, rules.getShape(config, slider.shapeId))), value => String(value), slider.enabled, slider.unlockLevel, (value, final) => setShapeValue(slider, value, final)));
  for (const posture of group.posture) container.append(sliderRow('Posture', posture.id, posture.label, posture.min, posture.max, () => rules.getPosture(config, posture.id), value => (value > 0 ? '+' : '') + value + posture.unit, true, 0, (value, final) => setPostureValue(posture, value, final)));
  if (group.gradeCategoryId && group.grades.length) {
    container.append(el('p', group.gradeCaption || 'Face animation', 'grade-caption'));
    const chips = el('div', undefined, 'chips'), wanted = config.RobotVisemeGrade, shown = group.grades.find(g => g.grade === wanted && g.unlocked) ? wanted : group.highestGrade;
    for (const choice of group.grades) { const chip = el('button', choice.unlocked ? choice.label : choice.label + ' · ' + levelCaption(choice.unlockLevel), 'segment chip-size'); chip.type = 'button'; chip.dataset.focusKey = 'grade:' + choice.grade; chip.disabled = !choice.unlocked; chip.setAttribute('aria-pressed', choice.unlocked && choice.grade === shown); chip.onclick = () => setGrade(group, choice.grade); chips.append(chip); }
    container.append(chips);
  }
  for (const cap of group.capabilities) {
    const row = el('div', undefined, 'cap-row'); row.append(el('span', cap.label, 'cap-label'));
    if (cap.action === 'Toggle') { const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = cap.enabled && rules.getToggle(config, cap.categoryId); toggle.disabled = !cap.enabled; toggle.setAttribute('aria-label', cap.label); toggle.onchange = () => setToggle(cap.categoryId, toggle.checked); row.append(toggle); }
    else { const button = el('button', cap.action === 'Upload' ? tr('Upload', 'Upload…') : tr('Info', 'Details'), 'segment chip-size'); button.type = 'button'; button.disabled = true; row.append(button); }
    const captionText = !cap.enabled ? levelCaption(cap.unlockLevel) : cap.needs2D ? tr('Needs2D', 'Available on PC in 2D mode') : ''; const caption = el('span', captionText, 'cap-caption'); caption.hidden = !captionText; row.append(caption); container.append(row);
  }
  body.scrollTop = scroll;
  return container.childElementCount > 0;
}
function sliderRow(kind, id, label, min, max, read, show, enabled, unlockLevel, set) {
  const root = el('div', undefined, 'slider-row' + (enabled ? '' : ' disabled')); root.id = 've' + kind + '_' + id;
  const input = el('input'); input.type = 'range'; input.min = min; input.max = Math.max(min + 1, max); input.step = 1; input.value = read(); input.disabled = !enabled; input.setAttribute('aria-label', label); input.dataset.focusKey = 'range:' + label; input.dataset.sync = kind + ':' + id;
  const value = el('output', enabled ? show(Number(input.value)) : levelCaption(unlockLevel), 'slider-value');
  input.oninput = () => { value.textContent = show(Number(input.value)); set(Number(input.value), false); };
  input.onchange = () => set(Number(input.value), true);
  root.append(el('span', label, 'slider-label'), input, value); root._read = read; root._show = show; return root;
}
function syncSliderValues() { for (const root of document.querySelectorAll('#builder-controls .slider-row')) { const input = root.querySelector('input'); if (document.activeElement === input || !root._read) continue; input.value = root._read(); root.querySelector('output').textContent = root._show(Number(input.value)); } }

const COLOUR_TARGET = { outfit: 'outfit', 'outfit.secondary': 'bottoms', shoes: 'shoes', 'shoes.secondary': 'shoes', hat: 'headgear', 'hat.secondary': 'headgear', 'hair.base': 'hair', 'hair.tip': 'hair', beard: 'facial-hair', eye: 'eyes', 'eye.white': 'eyes', 'eye.pupil': 'eyes', skin: 'skin', lips: 'lips', nails: 'nails', 'robot.primary': 'robot-body', 'robot.detail': 'robot-body', 'robot.secondary': 'robot-glow', 'robot.skin.tint': 'robot-skin' };
function slotMode(slot) {
  const mode = slot.state.mode;
  if (mode !== 'Hidden' && slot.requiresCapabilityId && !rules.getToggle(config, slot.requiresCapabilityId)) return 'Hidden';
  if (mode !== 'Hidden' && slot.shownWithCategoryId && rules.getOrdinal(config, slot.shownWithCategoryId, '', 0) <= 0) return 'Hidden';
  return mode;
}
function renderColour(group, hasBody) {
  const slots = group?.colourSlots || [], modes = slots.map(slotMode), shows = mode => mode === 'Presets' || mode === 'Full';
  const visible = modes.some(shows), forcedOpen = !hasBody, open = visible && (!colourCollapsed || forcedOpen);
  $('tiles-card').hidden = !(hasBody && !open); $('colour-card').hidden = !open;
  $('colour-heading').setAttribute('aria-expanded', open); $('btnColourClose').hidden = forcedOpen;
  const button = $('btnAvatarColour'); button.hidden = !(visible && hasBody && !forcedOpen);
  if (!visible) { pickerSlot = null; return; }
  let index = slots.findIndex((slot, i) => slot.id === selectedSlotId && shows(modes[i])); if (index < 0) index = modes.findIndex(shows);
  const slot = slots[index], mode = modes[index]; pickerSlot = slot; selectedSlotId = slot.id;
  const tabs = $('colour-tabs'); tabs.replaceChildren(); const shownTabs = slots.filter((_, i) => modes[i] !== 'Hidden');
  if (shownTabs.length > 1) for (const [i, item] of slots.entries()) {
    if (modes[i] === 'Hidden') continue;
    const enabled = shows(modes[i]), chip = el('button', enabled ? item.label : item.label + ' · ' + levelCaption(item.state.nextLevel), 'segment chip-size'); chip.type = 'button'; chip.dataset.focusKey = 'slot:' + item.id; chip.dataset.colour = currentColour(item); chip.disabled = !enabled; chip.setAttribute('aria-pressed', i === index);
    chip.onclick = () => { selectedSlotId = item.id; focusOn(SLOT_FOCUS[item.id]); render(); if (pendingFrame) frameMirror(); }; tabs.append(chip);
  }
  tabs.hidden = shownTabs.length <= 1;
  const target = COLOUR_TARGET[slot.id], title = target ? format('ColourFor', 'Colour – {0}', contract.strings['Options/Avatar/ColourTarget/' + target]) : slot.label;
  const colour = currentColour(slot), isSet = config.Colours.some(row => row.SlotId === slot.id);
  $('colour-title').textContent = title; $('veColourSwatch').style.background = colour; button.style.background = colour;
  const reset = $('btnColourDefault'); reset.hidden = !slot.resettable; reset.setAttribute('aria-pressed', !isSet); reset.onclick = () => clearColour(slot);
  const options = { mode: mode === 'Full' ? 'Full' : 'Presets', presets: slot.state.presets.length ? slot.state.presets : ['#FFFFFF', '#D1D9E0', '#9E9E9E', '#3C3C3C', '#000000', '#E53935', '#F57C00', '#FDD835', '#7CB342', '#26A69A', '#1E88E5', '#5E35B1', '#D81B60', '#8D6E63', '#546E7A'], recent: [] };
  if (!picker || !document.contains(picker.root)) picker = new ColourPicker($('colour-picker'), colour, (hex, final) => applyColour(pickerSlot, hex, final), slot.label, options);
  else { picker.configure(options); if (picker.hex !== colour.toUpperCase() && !$('colour-picker').contains(document.activeElement)) picker.setValue(colour); }
  for (const input of $('colour-picker').querySelectorAll('.colour-field input')) input.setAttribute('aria-label', slot.label + ' ' + input.previousSibling.textContent);
  const more = slot.state.hiddenCount > 0 && slot.state.nextLevel > 0 ? format('MoreColours', '{0} more at level {1}', slot.state.hiddenCount, slot.state.nextLevel) : ''; $('lblColourMore').textContent = more; $('lblColourMore').hidden = !more;
  const glow = slot.supportsGlow ? slot.state.glow : null, glowRow = $('veAvatarGlowStrength'), glowCaption = $('lblGlowCaption');
  glowRow.hidden = !glow?.visible;
  if (glow?.visible) {
    const slider = $('sldAvatarGlowStrength'), top = Math.max(contract.glowLimits.min, Math.min(contract.glowLimits.max, glow.max));
    slider.min = contract.glowLimits.min; slider.max = Math.max(top, contract.glowLimits.min + .001); slider.disabled = !glow.adjustable; slider.value = Math.max(contract.glowLimits.min, Math.min(top, config.GlowIntensity));
    $('lblGlowStrengthValue').textContent = Number(slider.value).toFixed(1) + 'x'; slider.oninput = () => setGlow(slider.value, false); slider.onchange = () => setGlow(slider.value, true);
    const topText = glow.max.toFixed(1) + 'x', captionText = glow.nextLevel <= 0 || glow.nextMax <= 0 ? format('GlowUpTo', 'Up to {0}', topText) : format('GlowNext', 'Up to {0} · {1} at level {2}', topText, glow.nextMax.toFixed(1) + 'x', glow.nextLevel);
    glowCaption.textContent = captionText; glowCaption.hidden = false;
  } else glowCaption.hidden = true;
}
function currentColour(slot) {
  const stored = config.Colours.find(row => row.SlotId === slot.id), parsed = stored && rules.parseColour(stored.Hex);
  if (parsed) return '#' + parsed.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  return rules.derivedColour(config, slot.id) || slot.unset || slot.state.presets[0] || '#FFFFFF';
}
function renderStatus(group) {
  const level = contract.meta.topLevel, total = group?.summary.total || 0;
  $('creator-status').textContent = group ? (total > 0 ? format('Status', 'Lv {0} · {1} of {2} unlocked in {3}', level, group.summary.unlocked, total, group.title) : format('StatusNoTiles', 'Lv {0} · {1}', level, group.title)) : format('PreviewLevel', 'Lv {0}', level);
}

// ---------------------------------------------------------------- persistence and the 3D mirror
function save() { remember(); try { localStorage.setItem(storageKey, JSON.stringify(config)); $('storage-status').textContent = 'Saved in this browser.'; } catch { $('storage-status').textContent = 'Browser storage is unavailable. Export JSON to keep this look.'; } }
const familyData = () => data.families.find(item => item.Family.toLowerCase() === currentFamily());
async function refresh(frame = false) {
  const token = ++refreshToken; $('loading').hidden = false;
  try {
    const f = familyData(); if (!f) throw new Error(`No ${currentFamily()} catalog in this snapshot.`);
    const worn = rules.wornConfig(config, contract); request = resolve(worn, f, data, false);
    const shown = showTeeth && worn.Family === 'human' ? { ...request, ShapeWeights: { ...request.ShapeWeights, jawOpen: Math.max(request.ShapeWeights.jawOpen || 0, 40), mouthSmileLeft: Math.max(request.ShapeWeights.mouthSmileLeft || 0, 45), mouthSmileRight: Math.max(request.ShapeWeights.mouthSmileRight || 0, 45), mouthUpperUpLeft: Math.max(request.ShapeWeights.mouthUpperUpLeft || 0, 30), mouthUpperUpRight: Math.max(request.ShapeWeights.mouthUpperUpRight || 0, 30) } } : request;
    const stats = await renderer.update(f, shown, worn, frame || pendingFrame || lastFamily !== worn.Family); if (token !== refreshToken || !stats) return;
    if (pendingFrame) frameMirror(); lastFamily = worn.Family;
    $('lblAvatarMirrorOverlay').textContent = '';
    $('scene-status').textContent = `${worn.Family} / ${worn.BodyType} / ${stats.meshes} parts`; $('mesh-stats').textContent = `${stats.triangles.toLocaleString()} triangles · ${stats.vertices.toLocaleString()} vertices`;
    $('diagnostic-content').replaceChildren(el('pre', 'Worn parts\n' + request.MeshNames.join('\n') + '\n\nWorn config\n' + JSON.stringify(worn, null, 2)));
  } catch (error) { $('lblAvatarMirrorOverlay').textContent = error.message; console.error(error); }
  finally { if (token === refreshToken) $('loading').hidden = true; }
}

// ---------------------------------------------------------------- headset panel helpers
function wornTitles() {
  const body = currentBody(), titles = [];
  for (const group of visibleGroups()) for (const row of group.rows) { if (row.hidden) continue; const rowBody = row.perBodyType ? body : '', ordinal = rules.shownOrdinal(config, row.categoryId, rowBody, body, row.defaultOrdinal); if (ordinal <= 0) continue; const tile = row.tiles.find(item => item.ordinal === ordinal); if (tile) titles.push(tile.names[rowBody] ?? Object.values(tile.names)[0]); }
  return titles;
}
function randomizeAvatar() {
  const family = currentFamily(), body = config.BodyType; config = rules.newConfig(); config.Family = family; config.BodyType = body;
  const choose = list => list[Math.floor(Math.random() * list.length)];
  for (const group of visibleGroups()) {
    for (const row of group.rows) { if (row.hidden) continue; const legal = row.tileOrdinals.filter(ordinal => ordinal > 0 && rules.isLegal(contract, row, ordinal) && !(row.categoryId === rules.HUMAN_HAT && headgearBlocked())); if (legal.length) rules.pick(config, contract, row.categoryId, row.perBodyType ? currentBody() : '', choose(legal)); }
    for (const slot of group.colourSlots) if (slotMode(slot) !== 'Hidden' && slot.state.presets.length) rules.setColour(config, slot.id, choose(slot.state.presets));
  }
}

// ---------------------------------------------------------------- import / export
function applyImport() {
  try { const text = $('config-text').value; if (text.length > 1_000_000) throw new Error('Choose a document smaller than 1 MB.'); config = rules.configFromJson(text, contract); $('config-dialog').close(); selectedGroupId = null; commit(true); }
  catch (error) { $('config-error').textContent = error.message; }
}
function download(url, name) { const anchor = el('a'); anchor.href = url; anchor.download = name; anchor.click(); }
function normalize(source) {
  source.humanShapes = source.HumanShapes || source.humanShapes || [];
  source.defaults = source.Rules?.DefaultLook || source.defaults || {};
  source.rules = { ...source.rules, hatlessHair: source.Rules?.HatlessHair, hiddenTiles: source.Rules?.HiddenTiles };
  for (const family of source.families || []) { family.materials = source.materials || family.materials || []; if (family.BodyOcclusion) family.BodyOcclusion.IsCompatible = family.BodyOcclusionCompatible !== false; }
  if (Array.isArray(source.rules.hiddenTiles)) { const map = {}; for (const row of source.rules.hiddenTiles) (map[row.CategoryId] ??= []).push(row.Ordinal); source.rules.hiddenTiles = map; }
  return source;
}

async function start() {
  try {
    [data, contract] = await Promise.all([assetJSON('browser_data/catalog.json').then(normalize), assetJSON('browser_data/creator_contract.json?v=5e25f639716f').then(rules.creatorContract)]);
    if (!Array.isArray(data.families) || !data.families.length) throw new Error('The native Unity catalog export is unavailable.');
    for (const [id, key] of [['lblNavTitle', 'NavTitle'], ['lblNavSubtitle', 'NavSubtitle'], ['lblAvatarMirrorTitle', 'MirrorTitle'], ['lblMirrorSubtitle', 'MirrorSubtitle'], ['btnMirrorViewFront', 'MirrorFront'], ['btnMirrorViewSide', 'MirrorSide'], ['btnColourDefault', 'DefaultColour']]) $(id).textContent = tr(key, $(id).textContent);
    config = rules.newConfig();
    try { const saved = localStorage.getItem(storageKey); if (saved) config = rules.configFromJson(saved, contract); } catch { $('storage-status').textContent = 'The stored look could not be read; using the default look.'; }
    $('lblAvatarMirrorOverlay').textContent = tr('MirrorLoading', 'Loading avatar…');
    renderer = new AvatarRenderer($('viewport'), data);
    // The mirror has no backdrop of its own: the twin stands directly on the menu surface (AvatarPanelPresenter.Mirror).
    renderer.scene.background = null; renderer.renderer.setClearAlpha(0);
    const xrPanel = new XRConfiguratorPanel(renderer.scene, creatorPanelBridge(document, () => ({ value: config.BodyType, allowed: currentFamily() === 'human', change: value => { rules.setFemale(config, contract, value === 'female' ? 100 : 0); commit(true); } }), { wearing: wornTitles, undo: () => travel(-1), redo: () => travel(1), canUndo: () => historyIndex > 0, canRedo: () => historyIndex < lookHistory.length - 1 }));
    renderer.ar = new AvatarAR(renderer, { panel: xrPanel, button: $('ar'), status: $('ar-status'), overlay: $('ar-overlay'), controls: $('ar-controls'), hint: $('ar-hint'), roomStatus: $('ar-room-status'), exit: $('ar-exit'), reposition: $('ar-reposition'), walk: $('ar-walk'), crawl: $('ar-crawl'), fly: $('ar-fly'), behavior: $('ar-behavior'), mirror: $('ar-mirror'), calibrate: $('ar-calibrate'), runMode: $('ar-run-mode'), collision: $('ar-collision'), quality: $('ar-quality'), animationRate: $('ar-animation-rate'), occlusion: $('ar-occlusion'), shadows: $('ar-shadows'), sit: $('ar-sit'), turn: $('ar-turn'), seatHeight: $('ar-seat-height'), seatHeightLabel: $('ar-seat-height-label'), seatHeightControls: $('ar-seat-height-control'), size: $('ar-size'), sizeLabel: $('ar-size-label') });
    $('btnAvatarColour').onclick = () => setColourOpen(true); $('btnColourClose').onclick = () => setColourOpen(false);
    $('colour-heading').onclick = () => setColourOpen(true); $('tiles-heading').onclick = () => setColourOpen(false);
    for (const [id, view] of [['btnMirrorViewFront', 'front'], ['btnMirrorViewSide', 'side']]) $(id).onclick = () => { mirrorView = mirrorView === view ? 'live' : view; $('btnMirrorViewFront').setAttribute('aria-pressed', mirrorView === 'front'); $('btnMirrorViewSide').setAttribute('aria-pressed', mirrorView === 'side'); frameMirror(); };
    $('random-avatar').disabled = false; $('random-avatar').onclick = () => { randomizeAvatar(); colourCollapsed = true; commit(true); };
    $('wire').onchange = $('cuts').onchange = () => renderer.overlays($('wire').checked, $('cuts').checked);
    $('snapshot').onclick = () => download(renderer.snapshot(), `avirev-${config.Family}-${Date.now()}.png`);
    $('reset-config').onclick = () => { const family = currentFamily(); config = rules.newConfig(); config.Family = family; commit(true); };
    $('diagnostics-toggle').onclick = () => { $('diagnostics').hidden = !$('diagnostics').hidden; $('diagnostics-toggle').setAttribute('aria-expanded', !$('diagnostics').hidden); };
    $('import-config').onclick = () => { $('config-text').value = JSON.stringify(config, null, 2); $('config-error').textContent = ''; $('config-dialog').showModal(); };
    $('close-config').onclick = () => $('config-dialog').close(); $('apply-config').onclick = applyImport;
    $('config-file').onchange = async () => { const file = $('config-file').files[0]; if (file?.size > 1_000_000) { $('config-error').textContent = 'Choose a JSON file smaller than 1 MB.'; return; } if (file) $('config-text').value = await file.text(); };
    $('export-config').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 4)], { type: 'application/json' })); download(url, `AvatarConfig-${config.Family}.json`); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    window.AVIREV_BUILDER = { getConfig: () => JSON.parse(JSON.stringify(config)), getWorn: () => rules.wornConfig(config, contract), getRequest: () => JSON.parse(JSON.stringify(request)), getStats: () => renderer.stats, getFocus: () => renderer.focusKind, getMirror: () => ({ aspect: renderer.camera.aspect, width: $('viewport').clientWidth, height: $('viewport').clientHeight, canvas: [renderer.renderer.domElement.width, renderer.renderer.domElement.height], target: renderer.controls.target.toArray(), camera: renderer.camera.position.toArray() }), previewAction: async name => { if (name && await renderer.prepareAction(name) === false) return false; renderer.setAction(name || null); return true; }, getIdle: () => ({ playing: renderer.idlePlayer?.playing, phase: renderer.idlePlayer?.phase }), applyConfig: source => { config = rules.configFromJson(typeof source === 'string' ? source : JSON.stringify(source), contract); render(); return refresh(true); }, contract: () => contract, ready: false };
    render(); remember(); await refresh(true); window.AVIREV_BUILDER.ready = !!renderer.stats;
    import('./builder-animation.mjs?v=594b31c0b38e').then(async module => { const clip = await module.loadIdleClip(); renderer.enableIdle(clip, module.createIdlePlayer); $('idle').disabled = false; $('idle').checked = !matchMedia('(prefers-reduced-motion: reduce)').matches; renderer.setIdlePlaying($('idle').checked); $('idle').onchange = () => renderer.setIdlePlaying($('idle').checked); $('a-pose').disabled = $('ar-freeze').disabled = false; $('a-pose').onclick = $('ar-freeze').onclick = () => { const frozen = !renderer.aPose; renderer.setAPose(frozen); $('a-pose').setAttribute('aria-pressed', frozen); $('a-pose').textContent = $('ar-freeze').textContent = frozen ? 'Resume idle' : 'Freeze A-pose'; $('idle').disabled = frozen; $('idle').checked = !frozen; renderer.setIdlePlaying(!frozen); }; }).catch(error => { $('animation-status').hidden = false; $('animation-status').textContent = 'Idle animation unavailable.'; console.warn(error); });
  } catch (error) { $('fatal').hidden = false; $('fatal-message').textContent = error.message; console.error(error); }
}
start();
