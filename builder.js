import { assetJSON, assetBytes, cachedLoad } from './builder-assets.mjs?v=c326a7020e52';
import { AvatarRenderer } from './builder-renderer.mjs?v=041c5eb58116';
import { XRConfiguratorPanel, creatorPanelBridge } from './builder-xr-panel.mjs?v=73b48534ef16';
import { AvatarAR } from './builder-ar.mjs?v=51994f10e3bf';
import { freshConfig, parseConfig, pick, setFemale, setShape, shapeValue, setColour, selectedOrdinal, resolve, optionsOf, PIECES } from './builder-model.mjs?v=914e87b696d4';

import { ColourPicker, rgbHex } from './builder-colour.mjs?v=a63afa0cf0f1';

const $ = id => document.getElementById(id), storageKey = 'avirev.avatar-config.v2';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let data, config = freshConfig(), renderer, groupId, request, refreshToken = 0, lastFamily;
let uiData = {}, slotId, colourOpen = false, showTeeth = false, pendingFrame = false, previewIndex = 0, storedLook;
const openRows = new Map(), rowQueries = new Map(), rowGroups = new Map(), thumbnails = new Map();
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
function save() { if (previewIndex) { $('storage-status').textContent = 'Local level preview. Your stored look is unchanged.'; return; } try { localStorage.setItem(storageKey, JSON.stringify(config)); $('storage-status').textContent = 'Saved in this browser. Export JSON to keep a copy.'; } catch { $('storage-status').textContent = 'Browser storage is unavailable. Export JSON to keep this look.'; } }
function button(text, action) { const node = el('button', text); node.type = 'button'; node.onclick = action; return node; }
function section(label) { const node = el('section', undefined, 'control-section'); node.append(el('h3', label)); $('builder-controls').append(node); return node; }
function slider(parent, label, value, min, max, changed, step = 1, unit = '') {
  const wrapper = el('div', undefined, 'slider-row'), header = el('div', undefined, 'slider-label'), title = el('label', label), output = el('output', value + unit), controls = el('div', undefined, 'slider-input');
  const range = el('input'), number = el('input'); range.type = 'range'; number.type = 'number';
  range.dataset.focusKey='range:'+label;number.dataset.focusKey='number:'+label;
  for (const input of [range, number]) { input.min = min; input.max = max; input.step = step; input.value = value; input.setAttribute('aria-label', label); }
  const update = input => { let next = Number(input.value); if (!Number.isFinite(next)) return; next = Math.min(max, Math.max(min, Math.round(next / step) * step)); range.value = number.value = next; output.textContent = next + unit; changed(next); };
  range.oninput = () => update(range); range.onchange = () => drawControls(); number.oninput = () => update(number); number.onchange = () => { update(number); drawControls(); }; title.htmlFor = range.id = 'slider-' + label.replace(/\W+/g, '-'); header.append(title, output); controls.append(range, number, button('↺', () => { range.value = 0; update(range); })); wrapper.append(header, controls); parent.append(wrapper);
}
function rowOptions(row) {
  const f = family(), options = optionsOf(f).filter(option => option.CategoryId === row.CategoryId);
  const hidden = data.rules.hiddenTiles?.[row.CategoryId] || [], real = row.RealOrdinals;
  let values = options.map(option => ({ ordinal: option.Ordinal, title: row.Titles?.[option.Ordinal - 1] || option.Label || option.Name || `Choice ${option.Ordinal}`, unavailable: option.Unavailable, option }));
  if (!values.length && Array.isArray(real)) values = real.map(ordinal => ({ ordinal, title: row.Titles?.[ordinal - 1] || row.RealTitles?.[ordinal - 1] || `Choice ${ordinal}` }));
  if (row.CategoryId === 'robot.eyes') values = (data.RobotEyePresets || []).map((preset, index) => ({ ordinal: index + 1, title: preset.Title }));
  if (row.CategoryId === 'robot.face.rest') values = (data.RobotRestMouths || []).map((texture, index) => ({ ordinal: index + 1, title: texture.name || `Rest mouth ${index + 1}` }));
  if (!authoring()) values = values.filter(value => !hidden.includes(value.ordinal) && (!real || real.includes(value.ordinal)));
  values=values.map(value=>({...value,title:thumbnailFor(row,value.ordinal)?.Title || value.title}));
  if (row.AllowNone) values.unshift({ ordinal: 0, title: 'None' }); return values;
}
function groupFocus(id) {
  if (['human.hair','human.headgear','human.fantasy'].includes(id)) return 'Head';
  if (['human.face','human.eyes','human.facial_hair','human.eyewear','robot.face'].includes(id)) return 'Face';
  return id === 'human.jewellery' ? 'Bust' : 'Body';
}
function categoryFocus(id) {
  if (['human.shoes','robot.shoes'].includes(id)) return 'Feet';
  if (['human.hair.style','human.hat','robot.accessory.head'].includes(id)) return 'Head';
  if (['human.face.eyebrows','human.face.eyes','human.face.nose','human.beard','human.accessory','robot.eyes','robot.face.rest','robot.face.visemes'].includes(id)) return 'Face';
  if (['human.jewelry','human.costume','robot.scarf'].includes(id)) return 'Bust';
  return 'Body';
}
function slotFocus(id) {
  if (id.startsWith('hair.') || id.startsWith('hat')) return 'Head';
  if (id.startsWith('eye') || id === 'lips' || id === 'beard') return 'Face';
  return id.startsWith('shoes') ? 'Feet' : 'Body';
}
function focusOn(kind, force = false) { if (!renderer) return; if (renderer.focusKind !== kind || force) { renderer.focus(kind); pendingFrame = true; } }
function tierLevel() { return previewIndex ? uiData.TierStops?.[previewIndex - 1]?.Level : null; }
function setPreviewIndex(next) {
  next=Math.max(0,Math.min(uiData.TierStops?.length || 0,Math.round(Number(next)||0)));
  if(!previewIndex&&next){storedLook=JSON.stringify(config);config=parseConfig(storedLook);}
  if(!next&&previewIndex){config=parseConfig(storedLook);storedLook=undefined;}
  previewIndex=next;
}
function allowance(category) {
  const level = tierLevel(); if (level === null) return null;
  const row = uiData.Categories?.find(item => (item.Id || item.CategoryId) === category);
  return row?.Levels?.filter(item => item.Level <= level).sort((a,b)=>b.Level-a.Level)[0] || { Count:0, IsEnabled:false, Grade:'none' };
}
function tileAllowed(row, ordinal) {
  if (!ordinal || !previewIndex) return true;
  const value = allowance(row.CategoryId); if (!value) return true;
  if (Array.isArray(value.Ordinals)) return value.Ordinals.includes(ordinal);
  const definition = uiData.Categories?.find(item => (item.Id || item.CategoryId) === row.CategoryId), order = definition?.UnlockOrder || row.UnlockOrder;
  return order?.length ? order.slice(0,value.Count || 0).includes(ordinal) : ordinal <= (value.Count || 0);
}
function shapeAllowed(row) {
  if (!previewIndex || row.Ungated) return true;
  const reward = uiData.ShapeRewards?.find(item => item.Id === row.ShapeId);
  if (reward?.Ungated) return true;
  const id = reward?.CategoryId || row.CapabilityId, definition = uiData.Categories?.find(item => item.Id === id), ordinal = reward?.Ordinal || row.Ordinal;
  return ordinal > 0 && (definition?.ClosedOrder || definition?.UnlockOrder?.length) ? tileAllowed({CategoryId:id}, ordinal) : !!allowance(id)?.IsEnabled;
}
function gradeAllowed(category, grade) {
  if (!previewIndex) return true;
  const grades = uiData.Categories?.find(item => item.Id === category)?.Grades || [], current = grades.indexOf(allowance(category)?.Grade), wanted = grades.indexOf(grade);
  return wanted >= 0 && current >= wanted;
}
function paletteFor(slot) {
  const definition = uiData.Categories?.find(item => item.Id === slot.CategoryId), palette = uiData.Palettes?.find(item => item.Id === (slot.PaletteId || definition?.PaletteId));
  const allowed = allowance(slot.CategoryId), full = !previewIndex || !!allowed?.IsCustom;
  return {full, swatches: (palette?.Swatches || []).filter(swatch => full || tileAllowed({CategoryId:slot.CategoryId},swatch.Ordinal)).slice(0, full ? 16 : Infinity), total: palette?.Swatches?.length || 0};
}
function thumbnailFor(row, ordinal) {
  const body = row.PerBodyType ? config.BodyType : '', photos = uiData.Thumbnails || [];
  return photos.find(item => item.CategoryId === row.CategoryId && item.Ordinal === ordinal && (item.BodyType || '') === body) || photos.find(item => item.CategoryId === row.CategoryId && item.Ordinal === ordinal && !item.BodyType);
}
function unlockLevel(category, ordinal) {
  const definition = uiData.Categories?.find(item => (item.Id || item.CategoryId) === category);
  for(const value of definition?.Levels || []) { const order=definition.UnlockOrder || []; if (value.Ordinals?.includes(ordinal) || !value.Ordinals && (order.length ? order.slice(0,value.Count||0).includes(ordinal) : ordinal <= (value.Count||0))) return value.Level; }
  return 0;
}
function visibleRows(group) { return (group.Rows || []).filter(row => (authoring() || !row.Hidden && !PIECES.includes(row.CategoryId)) && rowOptions(row).length); }
function randomizeAvatar() {
  if(!uiData.Categories?.length)return config;
  const {Family,BodyType}=config;config=freshConfig();config.Family=Family;config.BodyType=BodyType;
  const choose=values=>values[Math.floor(Math.random()*values.length)], available=groups().filter(group=>!group.Hidden);
  for(const group of available) {
    for(const row of visibleRows(group).filter(row=>!row.Hidden && !PIECES.includes(row.CategoryId))) {
      const hatless=row.CategoryId==='human.hat' && data.rules.hatlessHair?.includes(selectedOrdinal(config,'human.hair.style',true,data));
      const hidden=data.rules.hiddenTiles?.[row.CategoryId] || [];
      const category=uiData.Categories.find(item=>(item.Id || item.CategoryId)===row.CategoryId),closed=category?.ClosedOrder ?? row.ClosedOrder,order=category?.UnlockOrder || row.UnlockOrder || [];
      const values=rowOptions(row).filter(value=>!value.unavailable && !hidden.includes(value.ordinal) && (!value.ordinal || !row.RealOrdinals || row.RealOrdinals.includes(value.ordinal)) && (!closed || !value.ordinal || order.includes(value.ordinal)) && tileAllowed(row,value.ordinal) && (!hatless || !value.ordinal));
      if(values.length)pick(config,family(),row.CategoryId,choose(values).ordinal,data);
    }
    if(group.Id==='human.fantasy')continue;
    for(const row of group.Sliders || []) {
      const definition=shapeTable().find(shape=>shape.Id===row.ShapeId);
      if(row.ShapeId==='body_female' || !definition || definition.Hidden || !shapeAllowed(row))continue;
      const min=definition.MinWeight??0,max=definition.MaxWeight??100;
      setShape(config,row.ShapeId,min+Math.floor(Math.random()*(max-min+1)),shapeTable());
    }
  }
  for(const group of available)for(const slot of group.ColourSlots || []) {
    if(['eye.white','eye.pupil'].includes(slot.Id) || slot.ShownWithCategoryId && !selectedOrdinal(config,slot.ShownWithCategoryId,false,data) || slot.RequiresCapabilityId)continue;
    const swatch=choose(paletteFor(slot).swatches);if(swatch)setColour(config,slot.Id,swatch.Hex);
  }
  return config;
}
function groupCount(group) {
  const rows = visibleRows(group), values = rows.flatMap(row => rowOptions(row).filter(value=>value.ordinal>0 && !value.unavailable).map(value=>({row,value})));
  const total = values.length, unlocked=values.filter(({row,value})=>tileAllowed(row,value.ordinal)).length;
  const categories=[...rows.map(row=>row.CategoryId),...(group.ColourSlots || []).map(row=>row.CategoryId),...(group.Sliders || []).map(row=>row.CapabilityId),...(group.Capabilities || []).map(row=>row.CategoryId),group.GradeCategoryId].filter(Boolean), first=Math.min(...categories.map(firstEnabledLevel).filter(level=>level>0));
  if(previewIndex&&!unlocked&&Number.isFinite(first)&&!categories.some(id=>allowance(id)?.IsEnabled))return 'Lv '+first;
  return total ? unlocked + ' of ' + total : '';
}
function attachThumbnail(tile, row, value, glyph) {
  if (!value.ordinal) return;
  const art = thumbnailFor(row,value.ordinal);
  if (!art?.Url) return;
  const image=el('img');image.alt='';image.loading='eager';image.hidden=true;tile.prepend(image);
  cachedLoad(thumbnails,art.Url,async()=>{const {buffer,mime}=await assetBytes(art.Url);return URL.createObjectURL(new Blob([buffer],{type:mime}));}).then(url=>{image.onload=()=>{image.hidden=false;glyph.hidden=true;tile.classList.add('has-art');};image.onerror=()=>{image.remove();};image.src=url;}).catch(()=>image.remove());
}
function optionRow(row, group, rows) {
  const values = rowOptions(row), parent=el('section',undefined,'control-section'), stored=selectedOrdinal(config,row.CategoryId,row.PerBodyType,data), blockedHat=row.CategoryId==='human.hat'&&data.rules.hatlessHair?.includes(selectedOrdinal(config,'human.hair.style',true,data)), current=blockedHat?0:tileAllowed(row,stored)?stored:-1, multiple=rows.length>1;
  const open=!multiple || openRows.get(group.Id)===row.CategoryId;
  const heading=button('',()=>{if(!multiple)return;openRows.set(group.Id,open?null:row.CategoryId);colourOpen=false;showTeeth=false;if(!open)focusOn(categoryFocus(row.CategoryId));drawControls();if(pendingFrame)renderer.frame();});
  heading.className='row-heading';heading.dataset.focusKey='row:'+row.CategoryId;heading.setAttribute('aria-expanded',open);heading.append(el('span',row.Title || row.CategoryId,'row-title'));
  if(multiple)heading.append(el('span',!open?values.find(value=>value.ordinal===current)?.title || '':'','row-pick'),el('span',open?'▾':'▸','chevron'));
  parent.append(heading);const body=el('div');body.hidden=!open;parent.append(body);$('builder-controls').append(parent);
  const search=el('input',undefined,'option-search');search.type='search';search.value=rowQueries.get(row.CategoryId)||'';search.placeholder='Find '+(row.Title || 'a choice')+'…';search.setAttribute('aria-label',search.placeholder);body.append(search);
  const skinGroups=(uiData.SkinGroups || []).filter(item=>item.CategoryId===row.CategoryId && item.Family.toLowerCase()===config.Family);
  let selectedGroup=skinGroups.find(item=>item.Id===rowGroups.get(row.CategoryId));
  const filters=el('div',undefined,'skin-groups');
  if(skinGroups.length)body.append(filters);
  const grid=el('div',undefined,'option-grid');body.append(grid);
  const drawFilters=()=>{filters.replaceChildren();for(const item of [{Id:'',Title:'All'},...skinGroups]){const node=button(item.Title,()=>{selectedGroup=skinGroups.find(value=>value.Id===item.Id);rowGroups.set(row.CategoryId,item.Id);for(const filter of filters.children)filter.setAttribute('aria-pressed',filter.dataset.groupId===item.Id);render();});node.dataset.groupId=item.Id;node.setAttribute('aria-pressed',(selectedGroup?.Id || '')===item.Id);filters.append(node);}};
  const render=()=>{grid.replaceChildren();const matches=values.filter(item=>(!item.ordinal && skinGroups.length || item.title.toLowerCase().includes(search.value.toLowerCase())) && (!selectedGroup || !item.ordinal || selectedGroup.Ordinals.includes(item.ordinal)));for(const value of matches){
    const blocked=row.CategoryId==='human.hat'&&value.ordinal&&data.rules.hatlessHair?.includes(selectedOrdinal(config,'human.hair.style',true,data)), unlocked=tileAllowed(row,value.ordinal), level=unlockLevel(row.CategoryId,value.ordinal);
    const tile=button('',()=>{if(!tileAllowed(row,value.ordinal))return;pick(config,family(),row.CategoryId,value.ordinal,data);showTeeth=false;focusOn(categoryFocus(row.CategoryId),true);drawControls();refresh();});tile.className='option-tile';tile.dataset.focusKey='tile:'+row.CategoryId+':'+value.ordinal;tile.setAttribute('aria-pressed',current===value.ordinal);tile.setAttribute('aria-label',value.title);tile.disabled=!!value.unavailable || !!blocked || !unlocked;
    tile.title=blocked?'This hairstyle excludes headgear in Unity.':value.unavailable?'Retired or unavailable.':!unlocked?level?'Unlocks at level '+level:'Not in the global reward ladder.':value.title+' · '+row.CategoryId+' #'+value.ordinal;
    const glyph=el('span',value.ordinal?group.Glyph || '◈':'—','tile-glyph');tile.append(glyph,el('span',!unlocked?level?'Lv '+level:'Unavailable':blocked?'Hair excludes hats':value.title,'tile-caption'),el('span','✓','tile-tick'));attachThumbnail(tile,row,value,glyph);grid.append(tile);
  }if(!matches.length || skinGroups.length && !matches.some(value=>value.ordinal))grid.append(el('p','No matching choices.','empty-options'));};search.oninput=()=>{rowQueries.set(row.CategoryId,search.value);render();};drawFilters();render();
}
function slotColour(slot) {
  const id=slot.Id || slot.SlotId, custom=config.Colours.find(value=>value.SlotId===id)?.Hex;
  if(custom)return custom;if(request?.Colours[id])return request.Colours[id];
  const unset=slot.Unset;if(Array.isArray(unset))return rgbHex(unset.slice(0,3));if(unset&&typeof unset.r==='number')return rgbHex([unset.r,unset.g,unset.b]);return paletteFor(slot).swatches[0]?.Hex || '#FFFFFF';
}
function drawColour(group, hasBody) {
  const slots=(group.ColourSlots || []).filter(slot=>(!slot.ShownWithCategoryId || selectedOrdinal(config,slot.ShownWithCategoryId,false,data)>0)&&(!slot.RequiresCapabilityId || (!previewIndex || allowance(slot.RequiresCapabilityId)?.IsEnabled)&&config.Toggles.some(row=>row.CategoryId===slot.RequiresCapabilityId&&row.On)));
  const states=slots.map(slot=>({slot,...paletteFor(slot)})), available=states.filter(state=>state.full || state.swatches.length);
  $('colour-card').hidden=!available.length;$('colour-picker').replaceChildren();$('colour-extra').replaceChildren();$('colour-tabs').replaceChildren();if(!available.length){colourOpen=false;return;}
  if(!available.some(state=>state.slot.Id===slotId))slotId=available[0].slot.Id;const state=available.find(state=>state.slot.Id===slotId),slot=state.slot;if(!hasBody)colourOpen=true;
  $('colour-title').textContent='Colour · '+(slot.Label || 'Colour');$('colour-caption').textContent=config.Colours.some(value=>value.SlotId===slotId)?'Chosen colour':'Authored / inherited colour';
  for(const item of states){const enabled=item.full || !!item.swatches.length,node=button(item.slot.Label || item.slot.Id,()=>{if(!enabled)return;slotId=item.slot.Id;showTeeth=false;focusOn(slotFocus(item.slot.Id));drawControls();if(pendingFrame){renderer.frame();pendingFrame=false;}});node.dataset.focusKey='slot:'+item.slot.Id;node.disabled=!enabled;node.setAttribute('aria-pressed',item.slot.Id===slotId);if(!enabled)node.title='Unlocks at level '+firstEnabledLevel(item.slot.CategoryId);$('colour-tabs').append(node);}
  const choose=hex=>{setColour(config,slotId,hex);$('colour-caption').textContent='Chosen colour';refresh();};
  let picker;if(state.full)picker=new ColourPicker($('colour-picker'),slotColour(slot),choose,slot.Label || slotId);
  if(state.swatches.length){const parent=el('div',undefined,'palette-block');parent.append(el('h3',state.full?'Quick pick':'Unlocked colours'));const swatches=el('div',undefined,'preset-colours');for(const swatch of state.swatches){const node=button('',()=>{choose(swatch.Hex);if(picker)picker.setValue(swatch.Hex);else drawControls();});node.dataset.focusKey='swatch:'+slotId+':'+swatch.Ordinal;node.style.background=swatch.Hex;node.title=(swatch.Label || '')+' '+swatch.Hex;node.setAttribute('aria-label',node.title);node.setAttribute('aria-pressed',slotColour(slot).toLowerCase()===swatch.Hex.toLowerCase());swatches.append(node);}parent.append(swatches);if(!state.full&&state.total>state.swatches.length)parent.append(el('p',(state.total-state.swatches.length)+' colours remain locked at this level.','hint'));$('colour-extra').append(parent);}
  if(slot.Resettable){const reset=button('Default',()=>{setColour(config,slotId,null);drawControls();refresh();});reset.className='colour-default';$('colour-extra').append(reset);}
  if(group.GlowCategoryId){const top=previewIndex?Math.max(.5,parseFloat(allowance(group.GlowCategoryId)?.Grade)||.5):2.5;slider($('colour-extra'),'Glow strength',Math.min(config.GlowIntensity,top),.5,top,value=>{config.GlowIntensity=value;refresh();},.1,'×');if(top<=.5)$('colour-extra').lastElementChild.querySelectorAll('input,button').forEach(input=>input.disabled=true);}
  $('colour-heading').disabled=!hasBody;
}
function firstEnabledLevel(category) { return uiData.Categories?.find(item=>item.Id===category)?.Levels?.find(level=>level.IsEnabled)?.Level || 0; }
function applyAccordion(hasBody=true) {
  const open=colourOpen&&!$('colour-card').hidden;$('builder-controls').hidden=open;$('tiles-card').style.flex=open?'0 0 auto':'1 1 0';$('tiles-heading').setAttribute('aria-expanded',!open);$('tiles-heading').querySelector('.chevron').textContent=open?'▸':'▾';$('colour-body').hidden=!open;$('colour-heading').setAttribute('aria-expanded',open);$('colour-heading').querySelector('.chevron').textContent=open?'▾':'▸';$('tiles-card').hidden=!hasBody;
}
function drawControls() {
  request=resolve(config,family(),data,authoring());const available=groups();if(!available.some(group=>group.Id===groupId))groupId=available[0]?.Id;
  const focusKey=document.activeElement?.dataset?.focusKey,scroll=$('builder-controls').scrollTop;$('builder-groups').replaceChildren();
  for(const group of available){const node=button('',()=>{groupId=group.Id;colourOpen=false;showTeeth=false;focusOn(groupFocus(group.Id));drawControls();if(pendingFrame){renderer.frame();pendingFrame=false;}refresh();});node.dataset.focusKey='group:'+group.Id;node.setAttribute('aria-pressed',group.Id===groupId);node.append(el('span',group.Glyph || '◈','nav-glyph'),el('span',group.Title || group.Label || group.Id,'nav-title'),el('span',groupCount(group),'nav-count'),el('span',group.Id===groupId?'▾':'▸','nav-chevron'));$('builder-groups').append(node);}
  $('mobile-category').replaceChildren(...available.map(group=>{const option=el('option',group.Title || group.Label || group.Id);option.value=group.Id;return option;}));$('mobile-category').value=groupId;$('mobile-category').disabled=!available.length;
  $('builder-controls').replaceChildren();const group=available.find(item=>item.Id===groupId);if(!group)return;
  const rows=visibleRows(group);if(!openRows.has(group.Id))openRows.set(group.Id,rows[0]?.CategoryId);$('detail-title').textContent=group.Title || group.Label || group.Id;$('detail-count').textContent=groupCount(group);$('detail-caption').textContent=authoring()?'Authoring controls':'';
  for(const row of rows)optionRow(row,group,rows);
  const sliders=group.Sliders || [];if(sliders.length){const parent=section('Sculpt');for(const row of sliders){const definition=shapeTable().find(shape=>shape.Id===row.ShapeId);if(!definition || definition.Hidden&&!authoring())continue;
    const permitted=shapeAllowed(row);
    slider(parent,row.Label || definition.Label,shapeValue(config,row.ShapeId),definition.MinWeight??0,definition.MaxWeight??100,value=>{if(!permitted)return;if(row.ShapeId==='body_female')setFemale(config,value,shapeTable());else setShape(config,row.ShapeId,value,shapeTable());showTeeth=!!definition.ShowsTeeth;focusOn(row.ShapeId==='ears_bat'||row.ShapeId==='ears_elf'?'Head':groupFocus(group.Id));refresh();});if(!permitted)parent.lastElementChild.querySelectorAll('input,button').forEach(input=>input.disabled=true);
  }}
  if(group.Grades?.length&&group.GradeCategoryId==='robot.face.visemes'){const parent=section('Viseme range'),choices=el('div',undefined,'segments');for(const grade of group.Grades){const enabled=gradeAllowed(group.GradeCategoryId,grade.Grade),node=button(grade.Label,()=>{if(!enabled)return;config.RobotVisemeGrade=grade.Grade;drawControls();refresh();});node.dataset.focusKey='grade:'+grade.Grade;node.disabled=!enabled;node.setAttribute('aria-pressed',enabled&&config.RobotVisemeGrade===grade.Grade);choices.append(node);}parent.append(choices,el('p','Saved for Unity lip sync. The browser shows the resting mouth.','hint'));}
  if(group.Id==='shared.posture'){const parent=section('Standing posture');for(const row of group.Posture || [])slider(parent,row.Label,row.Id==='toe_out'?config.ToeOut:config.FeetApart,row.Min,row.Max,value=>{if(row.Id==='toe_out')config.ToeOut=value;else config.FeetApart=value;showTeeth=false;focusOn('Feet');refresh();},1,row.Unit || '');parent.append(el('p','Static standing IK; Unity adds live tracking and grounding.','hint'));}
  const hasBody=$('builder-controls').childElementCount>0;drawColour(group,hasBody);applyAccordion(hasBody);$('builder-controls').scrollTop=scroll;if(focusKey)document.querySelector('[data-focus-key="'+CSS.escape(focusKey)+'"]')?.focus({preventScroll:true});
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
    const previewRequest=showTeeth&&config.Family==='human'?{...request,ShapeWeights:{...request.ShapeWeights,jawOpen:Math.max(request.ShapeWeights.jawOpen||0,40),mouthSmileLeft:Math.max(request.ShapeWeights.mouthSmileLeft||0,45),mouthSmileRight:Math.max(request.ShapeWeights.mouthSmileRight||0,45),mouthUpperUpLeft:Math.max(request.ShapeWeights.mouthUpperUpLeft||0,30),mouthUpperUpRight:Math.max(request.ShapeWeights.mouthUpperUpRight||0,30)}}:request;
    const stats = await renderer.update(f, previewRequest, config, frame || pendingFrame || lastFamily !== config.Family); if (token !== refreshToken || !stats) return;
    pendingFrame=false;lastFamily = config.Family; $('creator-status').textContent=previewIndex?'Local preview · Lv '+tierLevel():'All imported art is available.'; $('scene-status').textContent = `${config.Family === 'human' ? 'Human' : 'Robot'} / ${config.BodyType} / ${stats.meshes} imported parts${authoring() ? ' / authoring controls' : ''}`;
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
    try { uiData=await assetJSON('browser_data/creator_ui.json?v=0545252f7f3e'); } catch { uiData={}; }
    renderer = new AvatarRenderer($('viewport'), data); request = resolve(config, family(), data, false); drawControls();
    $('random-avatar').disabled=!uiData.Categories?.length;if($('random-avatar').disabled)$('random-avatar').title='Random avatar needs the Unity rules data. Reload to try again.';$('random-avatar').onclick=()=>{randomizeAvatar();colourOpen=showTeeth=false;rowQueries.clear();rowGroups.clear();focusOn('Body',true);drawControls();refresh(true);};
    document.querySelectorAll('[data-family]').forEach(node => node.onclick = () => { config.Family = node.dataset.family; groupId = undefined; drawControls(); refresh(true); });
    $('mobile-category').onchange=()=>document.querySelector('[data-focus-key="group:'+CSS.escape($('mobile-category').value)+'"]')?.click();
    const xrPanel=new XRConfiguratorPanel(renderer.scene,creatorPanelBridge(document,()=>{const row=groups().flatMap(group=>group.Sliders || []).find(row=>row.ShapeId==='body_female');return {value:config.BodyType,allowed:config.Family==='robot'||!!row&&shapeAllowed(row),change:value=>{setFemale(config,value==='female'?100:0,shapeTable());drawControls();refresh(true);}};}));
    renderer.ar = new AvatarAR(renderer, { panel:xrPanel, button: $('ar'), status: $('ar-status'), overlay: $('ar-overlay'), controls: $('ar-controls'), hint: $('ar-hint'), roomStatus: $('ar-room-status'), exit: $('ar-exit'), reposition: $('ar-reposition'), walk: $('ar-walk'), crawl: $('ar-crawl'), fly: $('ar-fly'), behavior: $('ar-behavior'), mirror: $('ar-mirror'), calibrate: $('ar-calibrate'), runMode: $('ar-run-mode'), collision: $('ar-collision'), sit: $('ar-sit'), turn: $('ar-turn'), seatHeight: $('ar-seat-height'), seatHeightLabel: $('ar-seat-height-label'), seatHeightControls: $('ar-seat-height-control'), size: $('ar-size'), sizeLabel: $('ar-size-label') });
    $('wire').onchange = $('cuts').onchange = () => renderer.overlays($('wire').checked, $('cuts').checked);
    $('snapshot').onclick = () => download(renderer.snapshot(), `avirev-${config.Family}-${Date.now()}.png`);
    $('tiles-heading').onclick=()=>{if(!$('colour-card').hidden){colourOpen=false;drawControls();}};
    $('colour-heading').onclick=()=>{colourOpen=!colourOpen;showTeeth=false;if(colourOpen)focusOn(slotFocus(slotId));drawControls();if(pendingFrame){renderer.frame();pendingFrame=false;}};
    const stops=uiData.TierStops || [];if(stops.length&&uiData.Categories?.length){$('preview-level').disabled=false;$('preview-level').max=stops.length;$('tier-hint').textContent='Saved global reward catalog · local simulation. No player ownership is connected.';$('preview-level').oninput=()=>{setPreviewIndex($('preview-level').value);$('preview-level-label').textContent=previewIndex?'Lv '+stops[previewIndex-1].Level+(stops[previewIndex-1].Title?' · '+stops[previewIndex-1].Title:''):'All art';$('preview-badge').textContent=previewIndex?'Local preview · Lv '+tierLevel():'Art preview · all unlocked';drawControls();refresh();};}
    $('authoring').onchange = () => { drawControls(); refresh(); }; $('reset-config').onclick = () => { const selectedFamily = config.Family; config = freshConfig(); config.Family = selectedFamily; drawControls(); refresh(true); };
    $('diagnostics-toggle').onclick = () => { $('diagnostics').hidden = !$('diagnostics').hidden; $('diagnostics-toggle').setAttribute('aria-expanded', !$('diagnostics').hidden); };
    $('import-config').onclick = () => { $('config-text').value = JSON.stringify(config, null, 2); $('config-error').textContent = ''; $('config-dialog').showModal(); };
    $('close-config').onclick = () => $('config-dialog').close(); $('apply-config').onclick = applyImport;
    $('config-file').onchange = async () => { const file = $('config-file').files[0]; if (file?.size > 1_000_000) { $('config-error').textContent = 'Choose a JSON file smaller than 1 MB.'; return; } if (file) $('config-text').value = await file.text(); };
    $('export-config').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })); download(url, `AvatarConfig-${config.Family}.json`); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    window.AVIREV_BUILDER = { getConfig: () => JSON.parse(JSON.stringify(config)), getRequest: () => JSON.parse(JSON.stringify(request)), getStats: () => renderer.stats, getFocus:()=>renderer.focusKind, getIdle:()=>({playing:renderer.idlePlayer?.playing,phase:renderer.idlePlayer?.phase}), applyConfig: source => { config = parseConfig(typeof source === 'string' ? source : JSON.stringify(source)); drawControls(); return refresh(true); }, ready: false };
    await refresh(true); window.AVIREV_BUILDER.ready = !!renderer.stats;
    import('./builder-animation.mjs?v=08f678826fa7').then(async module=>{const clip=await module.loadIdleClip();renderer.enableIdle(clip,module.createIdlePlayer);$('idle').disabled=false;$('idle').checked=!matchMedia('(prefers-reduced-motion: reduce)').matches;renderer.setIdlePlaying($('idle').checked);$('idle').onchange=()=>renderer.setIdlePlaying($('idle').checked);$('a-pose').disabled=$('ar-freeze').disabled=false;$('a-pose').onclick=$('ar-freeze').onclick=()=>{const frozen=!renderer.aPose;renderer.setAPose(frozen);$('a-pose').setAttribute('aria-pressed',frozen);$('a-pose').textContent=$('ar-freeze').textContent=frozen?'Resume idle':'Freeze A-pose';$('idle').disabled=frozen;$('idle').checked=!frozen;renderer.setIdlePlaying(!frozen);};$('animation-status').hidden=false;$('animation-status').textContent='Randomized body-type idles · pause for mesh review.';}).catch(error=>{$('animation-status').hidden=false;$('animation-status').textContent='Idle animation unavailable; static preview remains active.';console.warn(error);});
  } catch (error) { $('loading').hidden = true; $('fatal').hidden = false; $('fatal-message').textContent = error.message; console.error(error); }
}
start();
