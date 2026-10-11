(() => {
  'use strict';
  const data = window.REVIEW_DATA || { entries: [], renders: [], meta: {} };
  const entries = data.entries || [], meta = data.meta || {};
  const renders = Array.isArray(data.renders) ? data.renders : Object.values(data.renders || {}).flat();
  const $ = id => document.getElementById(id);
  const fmt = value => typeof value === 'number' ? value.toLocaleString('en-US') : '—';
  const title = value => String(value || 'Unclassified').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const cameraTitle = () => state.view === 'threequarter' ? 'Three-quarter view' : title(state.view);
  const modeTitle = mode => ({ textured: 'Textured', diagnostic: 'Diagnostic colors', clay: 'Clay', wire: 'Wireframe' }[mode] || title(mode));
  const unityState = entry => entry.unity?.status || 'unknown';
  const unityLabel = entry => ({ selectable: 'In Unity · selectable', imported: 'In Unity · dependency', source: 'Source only', unknown: 'Unity · not verified' }[unityState(entry)] || 'Unity · not verified');
  const unityBadge = entry => text('span', unityLabel(entry), `unity-badge unity-${unityState(entry)}`);
  const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = String(value ?? ''); if (className) node.className = className; return node; };
  const issues = entry => (entry.issues || []).map(item => typeof item === 'string' ? { text: item, status: 'documented' } : item);
  const confirmed = issue => /confirmed|computed|fail|error/i.test(issue.status || '');
  const scopes = entry => Array.isArray(entry.scope) ? entry.scope : [entry.scope || 'unclassified'];
  const sourceTriangles = entry => entry.triangles ?? entry.source_triangles;
  const group = entry => String(entry.similarity_group || entry.category || 'Ungrouped');
  const renderMap = new Map(renders.map(render => [`${render.id}|${render.view || 'threequarter'}|${render.mode || 'clay'}`, render]));
  const versionGroups = new Map();
  for (const entry of entries) { const key = entry.geometry_family || entry.id; if (!versionGroups.has(key)) versionGroups.set(key, []); versionGroups.get(key).push(entry); }
  const versions = entry => versionGroups.get(entry.geometry_family || entry.id) || [entry];
  const preference = entry => ({selectable: 0, imported: 1, source: 2, unknown: 3}[unityState(entry)] ?? 3) * 10 + (scopes(entry).includes('production') ? 0 : 1);
  const state = { category: 'all', scope: 'all', unity: 'all', profile: 'all', issue: 'all', query: '', sort: 'similarity', mode: 'textured', compareMode: 'diagnostic', view: 'threequarter', hoverWire: true, allVersions: false, page: 0, selected: new Set() };
  const PAGE_SIZE = 72;
  const categories = [...new Set(entries.map(entry => entry.category || 'unclassified'))];
  const categoryOrder = ['hair', 'shirts', 'shirt', 'tops', 'jackets', 'pants', 'bottoms', 'skirts', 'dresses', 'shoes', 'hats', 'beards', 'eyes', 'body', 'accessories', 'jewelry', 'costumes', 'outfits', 'outfit', 'other'];
  categories.sort((a, b) => { const ai = categoryOrder.indexOf(a.toLowerCase()), bi = categoryOrder.indexOf(b.toLowerCase()); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b); });
  const safePath = path => typeof path === 'string' && !/^[a-z]+:|^\/\/|[\u0000-\u001f]/i.test(path) ? path : '';
  const renderPath = render => safePath(render?.atlasrelativepath || render?.atlas || render?.path || '');
  function compactRender(entry, view, mode) {
    if (entry.poster_index === undefined) return null;
    const columns = entry.poster_columns || 1, dims = entry.poster_atlasdims || [3072, 3072], scale = dims[0] / (columns * 512), cat = String(entry.category || 'other').toLowerCase();
    return { id: entry.id, view, mode, atlasrelativepath: `${meta.render_prefix || '../render/'}${cat}_all_${view}_${mode}_labeled.webp`, downloadrelativepath: `${meta.render_prefix || '../render/'}${cat}_all_${view}_${mode}_labeled.webp`, tilex: Math.round((entry.poster_index % columns) * 512 * scale), tiley: Math.round((72 + Math.floor(entry.poster_index / columns) * 602) * scale), tilewidth: Math.round(512 * scale), tileheight: Math.round(512 * scale), atlasdims: dims };
  }
  function findRender(entry, view = state.view, mode = state.mode) { return renderMap.size ? renderMap.get(`${entry.id}|${view}|${mode}`) : compactRender(entry, view, mode); }
  function crop(entry, view = state.view, mode = state.mode) {
    const node = text('div', '', 'crop');
    const render = findRender(entry, view, mode), path = renderPath(render);
    if (!render || !path) { node.classList.add('missing'); node.textContent = 'Render unavailable for this view'; return node; }
    const width = render.atlaswidth ?? render.atlas_width ?? render.atlasdims?.[0] ?? render.atlasdims?.width;
    const height = render.atlasheight ?? render.atlas_height ?? render.atlasdims?.[1] ?? render.atlasdims?.height;
    const size = render.tilesize ?? render.tile_size ?? render.size;
    const tileWidth = render.tilewidth ?? render.tile_width ?? (Array.isArray(size) ? size[0] : size);
    const tileHeight = render.tileheight ?? render.tile_height ?? (Array.isArray(size) ? size[1] : size);
    const x = render.tilex ?? render.x ?? 0, y = render.tiley ?? render.y ?? 0;
    if (![width, height, tileWidth, tileHeight, x, y].every(Number.isFinite) || tileWidth <= 0 || tileHeight <= 0 || width < tileWidth || height < tileHeight) {
      node.classList.add('missing'); node.textContent = 'Render coordinates unavailable'; return node;
    }
    node.style.aspectRatio = `${tileWidth} / ${tileHeight}`;
    node.style.backgroundImage = `url(${JSON.stringify(path)})`;
    node.style.backgroundSize = `${width / tileWidth * 100}% ${height / tileHeight * 100}%`;
    node.style.backgroundPosition = `${width === tileWidth ? 0 : x / (width - tileWidth) * 100}% ${height === tileHeight ? 0 : y / (height - tileHeight) * 100}%`;
    node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${entry.name}, ${title(view)}, ${modeTitle(mode)}`);
    return node;
  }
  function filtered() {
    const query = state.query.trim().toLowerCase();
    const matches = entries.filter(entry => {
      const list = issues(entry);
      return (state.category === 'all' || (entry.category || 'unclassified') === state.category)
        && (state.scope === 'all' || scopes(entry).includes(state.scope))
        && (state.unity === 'all' || unityState(entry) === state.unity)
        && (state.profile === 'all' || entry.body_profile === state.profile)
        && (state.issue === 'all' || state.issue === 'any' && list.length || state.issue === 'none' && !list.length || state.issue === 'confirmed' && list.some(confirmed) || state.issue === 'followup' && list.some(item => !confirmed(item)))
        && (!query || JSON.stringify([entry.name, entry.id, entry.aliases, entry.materials, entry.scenes, entry.collections, entry.similarity_group, list]).toLowerCase().includes(query));
    }).sort((a, b) => {
      if (state.sort === 'triangles') return (sourceTriangles(b) || 0) - (sourceTriangles(a) || 0) || String(a.name).localeCompare(String(b.name));
      if (state.sort === 'issues') return issues(b).length - issues(a).length || String(a.name).localeCompare(String(b.name));
      if (state.sort === 'similarity') return group(a).localeCompare(group(b)) || (a.similarity_rank ?? 0) - (b.similarity_rank ?? 0) || String(a.name).localeCompare(String(b.name));
      return String(a.name).localeCompare(String(b.name));
    });
    if (state.allVersions) return matches;
    const grouped = new Map();
    for (const entry of matches) { const key = entry.geometry_family || entry.id; if (!grouped.has(key) || preference(entry) < preference(grouped.get(key))) grouped.set(key, entry); }
    return [...grouped.values()];
  }
  function updateCompare() { $('compare-count').textContent = state.selected.size; $('compare').disabled = state.selected.size !== 2; }
  function card(entry, ordinal) {
    const node = text('article', '', `card${state.selected.has(entry.id) ? ' selected' : ''}`);
    const open = text('button', '', 'asset-open'); open.type = 'button'; open.setAttribute('aria-label', `Inspect ${entry.name}`);
    const image = text('div', '', 'crop-stack');
    const primary = crop(entry); primary.classList.add('crop-layer', 'primary-layer'); primary.append(text('span', String(ordinal).padStart(3, '0'), 'stamp'));
    const hover = crop(entry, state.view, 'wire'); hover.classList.add('crop-layer', 'wire-layer');
    image.append(primary, hover); open.append(image);
    const info = text('div', '', 'cardinfo'); info.append(unityBadge(entry), text('h3', entry.name));
    const line = text('div', '', 'cardmeta'); line.append(text('span', `${fmt(sourceTriangles(entry))} tris`), text('span', scopes(entry).map(title).join(' / '))); info.append(line);
    const lower = text('div', '', 'group');
    if (issues(entry).length) lower.append(text('span', `${issues(entry).length} issue${issues(entry).length === 1 ? '' : 's'} · `, 'issueflag'));
    lower.append(document.createTextNode(entry.body_profile || title(group(entry)))); info.append(lower); open.append(info); open.addEventListener('click', () => showDetail(entry)); node.append(open);
    const label = text('label', '', 'compare-label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = state.selected.has(entry.id); check.setAttribute('aria-label', `Add ${entry.name} to comparison`);
    check.addEventListener('change', () => { if (check.checked && state.selected.size >= 2) { check.checked = false; return; } check.checked ? state.selected.add(entry.id) : state.selected.delete(entry.id); node.classList.toggle('selected', check.checked); updateCompare(); });
    label.append(check, document.createTextNode('Compare')); node.append(label);
    if (versions(entry).length > 1) { const button = text('button', `${versions(entry).length} versions · inspect`, 'versions-link'); button.addEventListener('click', () => showDetail(entry)); node.append(button); }
    return node;
  }
  function downloads() {
    const container = $('downloads'); container.replaceChildren();
    if (renders.length) {
      for (const category of state.category === 'all' ? categories : [state.category]) {
        const assets = entries.filter(entry => entry.category === category);
        for (let offset = 0; offset < assets.length; offset += 16) {
          const page = assets.slice(offset, offset + 16), view = state.view, mode = state.mode;
          const button = text('button', `${category} · page ${offset / 16 + 1} / ${Math.ceil(assets.length / 16)} · ${cameraTitle()} · ${modeTitle(mode)}`, 'atlas-link');
          button.addEventListener('click', async () => {
            const caption = button.textContent; button.disabled = true; button.textContent = 'Preparing contact sheet…';
            try { await downloadSheet(page, category, view, mode, offset / 16 + 1); button.textContent = caption; }
            catch (error) { button.textContent = `Download failed: ${error.message}. Click to retry.`; }
            finally { button.disabled = false; }
          }); container.append(button);
        }
      }
      return;
    }
    if (!renders.length) {
      const cats = state.category === 'all' ? categories : [state.category];
      for (const cat of cats) { const path = `${meta.render_prefix || '../render/'}${String(cat).toLowerCase()}_all_${state.view}_${state.mode}_labeled.webp`; const link = text('a', path.split('/').pop(), 'atlas-link'); link.href = path; link.target = '_blank'; link.rel = 'noopener'; link.append(text('span', `${cameraTitle()} · ${state.mode === 'wire' ? 'Clay + wire' : 'Clay'}`)); container.append(link); }
      if (!cats.length) container.append(text('p', 'No atlases available for this category and view.'));
      return;
    }
    const visibleIds = new Set(entries.filter(entry => state.category === 'all' || entry.category === state.category).map(entry => entry.id));
    const links = new Map();
    for (const render of renders) if (visibleIds.has(render.id) && (render.mode || 'clay') === state.mode && (render.view || 'threequarter') === state.view) {
      const path = safePath(render.downloadrelativepath) || renderPath(render); if (path && !links.has(path)) links.set(path, render);
    }
    for (const [path, render] of links) { const link = text('a', path.split('/').pop(), 'atlas-link'); link.href = path; link.target = '_blank'; link.rel = 'noopener'; link.append(text('span', `${cameraTitle()} · ${modeTitle(state.mode)}`)); container.append(link); }
    if (!links.size) container.append(text('p', 'No atlases available for this category and view.'));
  }
  async function downloadSheet(assets, category, view, mode, page) {
    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 72 + Math.ceil(assets.length / 4) * 592;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
    ctx.fillStyle = '#edf0ef'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#24302f'; ctx.font = '28px Segoe UI, sans-serif'; ctx.fillText(`${category} · ${title(view)} · ${modeTitle(mode)} · page ${page}`, 20, 45);
    const images = new Map();
    try {
      for (const [index, entry] of assets.entries()) {
        const render = findRender(entry, view, mode), path = renderPath(render); if (!render || !path) throw new Error(`Render missing for ${entry.name}`);
        if (!images.has(path)) { const response = await fetch(path); if (!response.ok) throw new Error(`Image HTTP ${response.status}`); images.set(path, await createImageBitmap(await response.blob())); }
        const left = index % 4 * 512, top = 72 + Math.floor(index / 4) * 592;
        ctx.drawImage(images.get(path), render.tilex, render.tiley, render.tilewidth, render.tileheight, left, top, 512, 512);
        ctx.fillStyle = '#24302f'; ctx.font = '18px Segoe UI, sans-serif'; ctx.fillText(entry.name, left + 10, top + 535, 492);
        ctx.font = '15px Segoe UI, sans-serif'; ctx.fillText(`${fmt(sourceTriangles(entry))} tris · ${issues(entry).length} notes · ${entry.body_profile || scopes(entry).join(' / ')}`, left + 10, top + 558, 492);
        ctx.fillStyle = {selectable: '#1a6845', imported: '#825810', source: '#8d344b', unknown: '#50616d'}[unityState(entry)]; ctx.fillText(unityLabel(entry), left + 10, top + 580, 492);
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .84)); if (!blob) throw new Error('Image encoding failed');
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `${category.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${view}_${mode}_${page}.webp`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally { for (const image of images.values()) image.close(); }
  }
  function draw() {
    const list = filtered(), pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE)); state.page = Math.min(state.page, pageCount - 1);
    $('sheet').replaceChildren(...list.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE).map((entry, index) => card(entry, state.page * PAGE_SIZE + index + 1)));
    $('empty').hidden = list.length > 0; $('pages').textContent = `Page ${state.page + 1} of ${pageCount}`;
    $('prev').disabled = state.page === 0; $('next').disabled = state.page >= pageCount - 1;
    $('sheet-title').textContent = state.category === 'all' ? 'All assets' : title(state.category);
    $('results').textContent = `${fmt(list.length)} ${state.allVersions ? 'studies' : 'geometry families'}${state.sort === 'similarity' ? ' · grouped by silhouette family' : ''}`;
    for (const button of $('categories').children) button.setAttribute('aria-pressed', String(button.dataset.category === state.category));
    downloads(); updateCompare();
  }
  function section(parent, heading, content) { const node = text('section', '', 'detail-section'); node.append(text('h3', heading)); if (content instanceof Node) node.append(content); else node.append(text('p', content)); parent.append(node); }
  function listValues(value) { return Array.isArray(value) ? value.map(item => typeof item === 'object' ? item.name || item.id || JSON.stringify(item) : item).join('\n') : typeof value === 'object' && value ? JSON.stringify(value, null, 2) : String(value ?? ''); }
  function showDetail(entry) {
    $('detail-scope').textContent = `${title(entry.category)} / ${scopes(entry).map(title).join(' / ')}`;
    const body = $('detail-body'); body.replaceChildren(); const layout = text('div', '', 'detail-layout'), visual = text('div', ''), info = text('div', '');
    const image = text('div', '', 'detail-image'); image.append(crop(entry)); visual.append(image, text('p', `${cameraTitle()} · ${modeTitle(state.mode)}`, 'detail-caption'));
    const viewControls = text('div', '', 'detail-controls');
    for (const [key, values] of [['mode', ['textured', 'diagnostic', 'clay', 'wire']], ['view', ['front', 'side', 'threequarter', 'back']]]) {
      const buttons = text('div', '', 'segments');
      for (const value of values) { const button = text('button', key === 'mode' ? modeTitle(value) : value === 'threequarter' ? '¾ view' : title(value)); button.setAttribute('aria-pressed', String(state[key] === value)); button.addEventListener('click', () => { state[key] = value; for (const top of $(key === 'mode' ? 'modes' : 'views').children) top.setAttribute('aria-pressed', String(top.dataset[key] === value)); draw(); showDetail(entry); }); buttons.append(button); }
      viewControls.append(buttons);
    }
    visual.append(viewControls);
    const heading = text('h2', entry.name, 'detail-title'); heading.id = 'detail-title'; info.append(heading);
    info.append(unityBadge(entry));
    if (versions(entry).length > 1) {
      const label = text('label', 'Version / source copy', 'version-picker'), select = document.createElement('select');
      select.setAttribute('aria-label', 'Asset version');
      for (const version of versions(entry)) { const option = text('option', `${version.name} · ${scopes(version).map(title).join(' / ')} · ${unityLabel(version)}`); option.value = version.id; select.append(option); }
      select.value = entry.id; select.addEventListener('change', () => showDetail(entries.find(item => item.id === select.value))); label.append(select); info.append(label);
      section(info, 'Shared geometry', 'These versions share source basis geometry. Materials, deformation keys, weights and coverage can differ; each version keeps its own render and details.');
    }
    if (entry.unity?.reason) section(info, 'Unity availability', entry.unity.reason);
    if (entry.unity?.choices?.length) section(info, 'Unity choices', text('pre', listValues(entry.unity.choices)));
    if (entry.render_material_notes?.length) section(info, 'Material rendering notes', text('pre', listValues(entry.render_material_notes)));
    const stats = text('div', '', 'stats');
    for (const [label, value] of [['Source triangles', sourceTriangles(entry)], ['Source vertices', entry.vertices], ['Source polygons', entry.polygons], ['Render triangles', entry.evaluated_triangles ?? entry.render_triangles], ['Materials', Array.isArray(entry.materials) ? entry.materials.length : entry.material_count], ['Shape keys', Array.isArray(entry.shape_keys) ? entry.shape_keys.length : entry.shape_key_count]]) { const cell = text('div', '', 'stat'); cell.append(text('strong', fmt(value)), text('span', label)); stats.append(cell); } info.append(stats);
    if (entry.garment_triangles !== undefined) section(info, 'Garment-only source triangles', fmt(entry.garment_triangles));
    if (entry.stats_basis) section(info, 'Count basis', entry.stats_basis);
    section(info, 'Silhouette family', title(group(entry)));
    if (entry.body_profile) section(info, 'Body profile', entry.body_profile);
    if (entry.asset_role) section(info, 'Asset role', title(entry.asset_role));
    if (entry.retired !== undefined || entry.ordinal !== undefined) section(info, 'Unity choice', `${entry.ordinal !== undefined ? 'Choice ' + entry.ordinal : 'No ordinal'}${entry.retired ? ' · retired' : ''}`);
    const issueList = text('div', '');
    for (const item of issues(entry)) { const row = text('div', '', `issue-item ${item.severity || ''}`); row.append(text('small', `${title(item.severity || 'note')} · ${title(item.status || 'documented')}`), text('p', item.text)); if (item.evidence) row.append(text('small', `Evidence: ${listValues(item.evidence)}`)); issueList.append(row); }
    if (!issueList.children.length) issueList.append(text('p', 'No issues listed. Full visual, deformation and runtime review may still be outstanding.'));
    section(info, 'Review notes', issueList);
    if (entry.components?.length) section(info, 'Rendered components', text('pre', entry.components.map(item => typeof item === 'string' ? item : `${item.object || item.name || item.id || 'Component'}${item.material ? '\n  Material: ' + item.material : ''}${item.fit_keys?.length ? '\n  Fit keys: ' + item.fit_keys.join(', ') : ''}${(item.hidden_source_faces ?? item.hide_faces?.length) !== undefined ? '\n  Hidden source faces: ' + fmt(item.hidden_source_faces ?? item.hide_faces.length) : ''}`).join('\n\n')));
    for (const [label, key] of [['Missing components', 'missing_parts'], ['Material variants', 'materials'], ['Shape keys', 'shape_keys'], ['Aliases / shared copies', 'aliases'], ['Entries sharing a source mesh', 'shared_geometry_entries'], ['Exact geometry fingerprints', 'geometry_fingerprints'], ['Scenes', 'scenes'], ['Collections', 'collections'], ['Modifiers', 'modifiers'], ['Source coverage', 'coverage'], ['Coverage basis', 'coverage_basis'], ['Body profile values', 'body_profile_values'], ['Source bounds in metres (X/Y/Z)', 'dimensions'], ['UV layers', 'uv_layers'], ['Texture files', 'texture_files'], ['Clay opacity treatment', 'clay_opacity'], ['Hair channels', 'hair_channels'], ['Inventory notes', 'notes']]) if (entry[key] !== undefined && entry[key] !== null && entry[key] !== '' && (!Array.isArray(entry[key]) || entry[key].length)) section(info, label, text('pre', listValues(entry[key])));
    if (entry.covered_faces !== undefined) section(info, 'Saved source coverage faces', fmt(entry.covered_faces));
    section(info, 'Inventory ID', entry.id); layout.append(visual, info); body.append(layout); if (!$('detail').open) $('detail').showModal();
  }
  function showComparison() {
    const controls = $('comparison-modes'); controls.replaceChildren();
    for (const mode of ['diagnostic', 'textured', 'clay', 'wire']) { const button = text('button', modeTitle(mode)); button.setAttribute('aria-pressed', String(mode === state.compareMode)); button.addEventListener('click', () => { state.compareMode = mode; showComparison(); }); controls.append(button); }
    const body = $('comparison-body'); body.replaceChildren();
    for (const id of state.selected) {
      const entry = entries.find(item => item.id === id); if (!entry) continue;
      const panel = text('section', '', 'compare-study'); panel.append(text('h3', entry.name), unityBadge(entry));
      panel.append(text('p', `${entry.body_profile || 'Neutral'} · ${fmt(sourceTriangles(entry))} source triangles · ${issues(entry).length} listed issues`));
      const views = text('div', '', 'compare-views');
      for (const view of ['front', 'side', 'back']) { const figure = text('figure', ''); figure.append(text('figcaption', title(view)), crop(entry, view, state.compareMode)); views.append(figure); }
      panel.append(views); body.append(panel);
    }
    if (!$('comparison').open) $('comparison').showModal();
  }
  $('total').textContent = fmt(entries.length); $('snapshot').textContent = meta.created_at || meta.timestamp || meta.snapshot || 'Offline collection snapshot';
  $('source').textContent = meta.source_blend || meta.sourceBlend || meta.source || 'Offline Blender inventory';
  for (const note of Array.isArray(meta.notes) ? meta.notes : meta.notes ? [meta.notes] : []) $('meta-notes').append(text('p', note));
  for (const category of ['all', ...categories]) { const button = text('button', category === 'all' ? 'Everything' : title(category)); button.dataset.category = category; button.append(text('span', category === 'all' ? entries.length : entries.filter(item => (item.category || 'unclassified') === category).length, 'count')); button.addEventListener('click', () => { state.category = category; state.page = 0; draw(); }); $('categories').append(button); }
  for (const scope of [...new Set(entries.flatMap(scopes))].sort()) { const option = text('option', title(scope)); option.value = scope; $('scope').append(option); }
  for (const profile of [...new Set(entries.map(entry => entry.body_profile).filter(Boolean))].sort()) { const option = text('option', profile); option.value = profile; $('profile').append(option); }
  for (const id of ['scope', 'unity', 'profile', 'issue', 'sort']) $(id).addEventListener('change', event => { state[id] = event.target.value; state.page = 0; draw(); });
  $('search').addEventListener('input', event => { state.query = event.target.value; state.page = 0; draw(); });
  for (const [container, key] of [['modes', 'mode'], ['views', 'view']]) $(container).addEventListener('click', event => { const button = event.target.closest('button'); if (!button) return; state[key] = button.dataset[key]; for (const item of $(container).children) item.setAttribute('aria-pressed', String(item === button)); draw(); });
  $('prev').addEventListener('click', () => { state.page--; draw(); $('sheet-title').scrollIntoView({ block: 'start' }); });
  $('next').addEventListener('click', () => { state.page++; draw(); $('sheet-title').scrollIntoView({ block: 'start' }); });
  $('clear').addEventListener('click', () => { state.query = ''; state.scope = 'all'; state.unity = 'all'; state.profile = 'all'; state.issue = 'all'; state.category = 'all'; state.page = 0; $('search').value = ''; $('scope').value = 'all'; $('unity').value = 'all'; $('profile').value = 'all'; $('issue').value = 'all'; draw(); });
  $('about').addEventListener('click', () => { $('notes').hidden = !$('notes').hidden; $('about').setAttribute('aria-expanded', String(!$('notes').hidden)); });
  $('compare').addEventListener('click', showComparison);
  const hoverWire = $('hover-wire'); if (hoverWire) hoverWire.addEventListener('click', () => { state.hoverWire = !state.hoverWire; hoverWire.setAttribute('aria-pressed', String(state.hoverWire)); hoverWire.textContent = `Hover wire: ${state.hoverWire ? 'On' : 'Off'}`; if (document.body) document.body.classList.toggle('hover-wire-off', !state.hoverWire); });
  const allVersions = $('all-versions'); if (allVersions) allVersions.addEventListener('click', () => { state.allVersions = !state.allVersions; allVersions.setAttribute('aria-pressed', String(state.allVersions)); allVersions.textContent = state.allVersions ? 'Group shared geometry' : 'Show every version'; state.page = 0; draw(); });
  for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
  draw();
})();
