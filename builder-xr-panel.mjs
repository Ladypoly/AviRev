import * as THREE from './libs/three/package/build/three.module.js';
import { hexRgb, rgbHex, rgbHsv, hsvRgb } from './builder-colour.mjs?v=242184bdff1b';

const label = node => node.getAttribute('aria-label') || node.title || node.textContent.trim();
const shown = node => !node.closest('[hidden]');
const HELP = {
  'ar-behavior':'Manual: left stick walks and strafes; right stick turns. Follow: stays about 1.5 m from you. Puppet: tracked head and hands control the upper body while the legs play idle.',
  'ar-mirror':'Mirror swaps left and right like a reflection. Turn it off to move the same side of the avatar as your own hand.',
  'ar-calibrate':'Stand facing forward with both arms extended sideways in a T-pose. Press both thumbsticks together to calibrate your head and controller grip orientation. Recalibrate after changing avatar proportions.',
  'ar-collision':'Room uses scanned furniture and walls for collision and Follow routes. Floor only keeps the avatar on its placement floor and ignores room obstacles; it can pass through furniture and walls.',
  'ar-run-mode':'Click to toggle: press the left thumbstick once to run, again to walk. Hold to run: keep it pressed while moving.',
  'ar-quality':'Sharp renders full resolution. Balanced and Fast lower resolution and blur the view edges for a higher frame rate. Resolution changes the next time you enter WebXR; edge blur changes now.',
  'ar-animation-rate':'Every 2nd frame halves avatar animation work. Movement speed stays the same; motion looks slightly less smooth.',
  'ar-occlusion':'What hides the avatar behind real things. Room setup uses the walls, floor and furniture boxes from Quest Space Setup; Scanned mesh uses only the detailed room scan; Live depth uses the headset depth sensor every frame, so hands and moving objects occlude too (starts the next time you enter WebXR, costs GPU). Off saves GPU time.',
  'ar-shadows':'The soft floor shadow under the avatar. Turning it off saves a shadow render every frame.',
  'ar-crawl':'Enter or leave crawling. Move with the left stick; right stick turns. Standing again needs clear space above the avatar.',
  'ar-fly':'Double jump (A, then A again in the air) or hold right-stick forward in the stretch pose for 1 second to fly; a ring at the avatar feet fills while you hold. Keep it forward to rise; pull back to descend. Near the floor, hold back for 1 second to land. Left stick moves and strafes; right stick left/right turns.',
  'ar-sit':'Sit on a scanned seat, or the floor. Hold crouch still for 1 second to sit on the floor. Right stick forward stands up.',
  'ar-size':'Change the avatar size while keeping its feet on the floor. Bigger avatars need more room around and above them.',
  'ar-seat-height':'Set the chair height when no scanned seat is available.',
  'ar-reposition':'Pick a new floor location with the controller placement ring, then press the trigger.',
  'ar-walk':'Stop the current walking destination. Left stick also gives you manual control.',
  'ar-turn':'Turn the seated avatar by 45 degrees to face the front of the chair.',
  'ar-exit':'Leave the immersive scene and return to the browser.',
  'a-pose':'Freeze or resume the avatar in its reference A-pose.',
  'idle':'Play or pause idle animation.',
  'wire':'Show the mesh edges over the avatar.',
  'cuts':'Show which body areas are hidden by the selected garments.',
  'reset-config':'Return this family to its default look. Undo brings your look back.',
  'preview-level':'Limit choices to this preview level. Follow the same available-choice rules as the creator.',
  'random-avatar':'Randomize using the currently available choices and creator rules. Undo brings your previous look back.'
};
const SCENE_IDS = ['ar-behavior','ar-mirror','ar-calibrate','ar-run-mode','ar-collision','ar-quality','ar-animation-rate','ar-occlusion','ar-shadows','ar-crawl','ar-fly','ar-sit','ar-walk','ar-turn','ar-reposition','ar-exit','ar-size','ar-seat-height','random-avatar','a-pose','idle','wire','cuts','reset-config','preview-level'];
const SCENE_LABELS = { 'ar-mirror':'Mirror my movements', 'ar-occlusion':'Occlusion', 'ar-shadows':'Avatar shadow', 'ar-size':'Avatar size', 'ar-seat-height':'Fallback seat height', idle:'Idle animation', wire:'Wireframe', cuts:'Coverage overlay', 'reset-config':'Reset look' };
const rowLabel = node => { const title = node.querySelector('.row-title')?.textContent, pick = node.querySelector('.row-pick')?.textContent; return title ? title + (pick ? ' · ' + pick : '') : label(node); };
const describe = node => ({ key: node.dataset.focusKey || node.id || label(node), label: node.classList?.contains('row-heading') ? rowLabel(node) : label(node), node, disabled: node.disabled, selected: node.getAttribute('aria-pressed') === 'true' || !!node.checked || node.classList?.contains('row-heading') && node.getAttribute('aria-expanded') === 'true', image: node.querySelector('img:not([hidden])'), glyph: node.querySelector('.nav-glyph')?.textContent || '', count: node.querySelector('.nav-count')?.textContent || '', colour: node.style.background || node.dataset.colour || '', type: node.tagName==='SELECT'?'select':node.type === 'range' ? 'range' : 'button', value: node.tagName==='SELECT'?node.value:Number(node.value), options:node.tagName==='SELECT'?[...node.options].filter(option=>!option.disabled).map(option=>({value:option.value,label:option.textContent})):null, min: Number(node.min), max: Number(node.max), step: Number(node.step) || 1, help:HELP[node.id]||node.getAttribute('aria-description')||node.title||'' });

/** Mirrors live creator controls; native DOM handlers retain ownership of choices and rewards. */
export function creatorPanelBridge(document, bodyType, look = {}) {
  const id = name => document.getElementById(name);
  return {
    observe(changed) { const text=new Map(['ar-hint','ar-room-status'].map(key=>[key,id(key)?.textContent]));const observer=new MutationObserver(records=>{if(records.some(record=>{if(record.type==='attributes'&&record.oldValue===record.target.getAttribute(record.attributeName))return false;const node=record.target.nodeType===3?record.target.parentElement:record.target;const status=node.closest?.('#ar-hint,#ar-room-status');if(status){const previous=text.get(status.id);text.set(status.id,status.textContent);return previous!==status.textContent;}return true;}))changed();});for(const node of document.querySelectorAll('#builder-groups,#builder-controls,#colour-tabs,#colour-picker,#colour-extra,#scrAvatarColour,#creator-status,#preview-level-label,.family-switch,.preview-tools,#ar-controls'))observer.observe(node,{childList:true,subtree:true,attributes:true,attributeOldValue:true,characterData:true});return()=>observer.disconnect(); },
    tab(view) { const node = id(view === 'colours' ? 'colour-heading' : 'tiles-heading'); if (node && !node.disabled && (view !== 'colours' || node.getAttribute('aria-expanded') !== 'true')) node.click(); },
    snapshot(view) {
      const roots = view === 'colours' ? ['colour-tabs','scrAvatarColour'] : view === 'scene' ? [] : ['builder-controls'];
      // The picker's own brightness bar is drawn by the panel's ring and square; only its swatches and the Default/glow controls are mirrored.
      const controls = roots.flatMap(name => [...(id(name)?.querySelectorAll('button,input[type="range"]') || [])].filter(node => shown(node) && !(node.type === 'range' && node.closest('.colour-picker'))).map(describe));
      if (view === 'customize') for (const search of id('builder-controls')?.querySelectorAll('input[type="search"]') || []) if (shown(search) && search.value) controls.unshift({ key:'clear:'+search.getAttribute('aria-label'), label:'Clear search: '+search.value, type:'clear', node:search });
      let colour = null;
      if (view === 'colours') {
        const field = id('colour-picker')?.querySelector('input[aria-label$=" HEX"]');
        if (field && shown(field) && /^#[0-9a-f]{6}$/i.test(field.value)) { const rgb=hexRgb(field.value),hsv=rgbHsv(rgb);colour={hex:field.value.toUpperCase(),hsv,disabled:field.disabled};for(let channel=2;channel>=0;channel--)controls.unshift({key:'hsv:'+channel,label:['Hue','Saturation','Brightness'][channel],type:'hsv',node:field,channel,value:Math.round(hsv[channel]*(channel===0?360:100)),min:0,max:channel===0?360:100,step:1,disabled:field.disabled});controls.unshift({key:'sv',label:'Shade',type:'sv',node:field,disabled:field.disabled},{key:'hex',label:'Colour',type:'hex',node:field,disabled:field.disabled}); }
      }
      if (view === 'scene') controls.push(...SCENE_IDS.map(id).filter(node => node && (node.id.startsWith('ar-') || shown(node))).map(node => ({...describe(node), disabled:node.disabled || node.id==='ar-seat-height'&&!!id('ar-seat-height-control')?.hidden, label:node.id==='preview-level'?'Preview level · '+id('preview-level-label').textContent:SCENE_LABELS[node.id]||label(node)})));
      const type=bodyType(), random=id('random-avatar');
      return { title:id('detail-title')?.textContent || 'Avatar', colourOnly:!!id('tiles-card')?.hidden&&!id('colour-card')?.hidden, slot:(id('colour-title')?.textContent||'').replace(/^Colour [·–] /,''), status:id('creator-status')?.textContent || '', roomStatus:id('ar-room-status')?.textContent || '', hint:id('ar-hint')?.textContent || '', colour,
        global:[...document.querySelectorAll('[data-family]')].map(describe).concat(['male','female'].map(value=>({key:'body:'+value,label:value==='male'?'Male':'Female',type:'body',value,selected:type.value===value,disabled:!type.allowed}))),
        groups:[...(id('builder-groups')?.querySelectorAll('button') || [])].map(node=>({...describe(node),label:node.querySelector('.nav-title')?.textContent || label(node)})), controls,
        look:{wearing:look.wearing?.()||[],canUndo:!!look.canUndo?.(),canRedo:!!look.canRedo?.()}, random:random?{...describe(random),label:'Surprise me',disabled:random.disabled}:null };
    },
    dispatch(row, value) {
      if (row.disabled) return false;
      if (row.type==='body') { const current=bodyType(); if (!current.allowed) return false; current.change(row.value); return true; }
      if (row.type==='undo') return !!look.undo?.();
      if (row.type==='redo') return !!look.redo?.();
      const node=row.node;
      if (!node?.isConnected || node.disabled) return false;
      if (row.type==='clear') { node.value=''; node.dispatchEvent(new Event('input',{bubbles:true})); return true; }
      if(row.type==='hex'){if(!/^#[0-9a-f]{6}$/i.test(value))return false;node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));return true;}
      if(row.type==='sv'){if(!/^#[0-9a-f]{6}$/i.test(node.value)||!value)return false;const hsv=rgbHsv(hexRgb(node.value));hsv[1]=THREE.MathUtils.clamp(value.s,0,1);hsv[2]=THREE.MathUtils.clamp(value.v,0,1);node.value=rgbHex(hsvRgb(...hsv));node.dispatchEvent(new Event('change',{bubbles:true}));return true;}
      if(row.type==='rgb'){if(!/^#[0-9a-f]{6}$/i.test(node.value))return false;const rgb=hexRgb(node.value);rgb[row.channel]=THREE.MathUtils.clamp(Math.round(value),0,255)/255;node.value=rgbHex(rgb);node.dispatchEvent(new Event('change',{bubbles:true}));return true;}
      if (row.type==='hsv') { if (!/^#[0-9a-f]{6}$/i.test(node.value)) return false; const hsv=rgbHsv(hexRgb(node.value));hsv[row.channel]=THREE.MathUtils.clamp(value,row.min,row.max)/row.max;node.value=rgbHex(hsvRgb(...hsv));node.dispatchEvent(new Event('change',{bubbles:true}));return true; }
      if(row.type==='select'){const options=[...node.options].filter(option=>!option.disabled),index=options.findIndex(option=>option.value===node.value);const option=value===undefined?options[(index+1)%options.length]:options.find(option=>option.value===value);if(!option)return false;node.value=option.value;node.dispatchEvent(new Event('change',{bubbles:true}));return true;}
      if (row.type==='range') { if(!Number.isFinite(value))return false;const min=Number(node.min),max=Number(node.max),step=Number(node.step)||1;node.value=Math.max(min,Math.min(max,min+Math.round((value-min)/step)*step));node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));return true; }
      node.click();return true;
    }
  };
}

// Panel layout is authored at 1 unit = 1 mm of the 0.96 x 1.04 m panel and rendered at 1.25 canvas px per unit.
const W = 960, H = 1040, PX = 1.25, FONT = 'system-ui, "Segoe UI", sans-serif';
const C = { ground:'#0E1117', surface:'#171B24', raised:'#222836', line:'#2E3546', selected:'#2B3350', text:'#F3F5FA', muted:'#AEB6C8', soft:'#C9CFDC', faint:'#4A5269', accent:'#8F9CFF', warm:'#FFB86B', warmGround:'#2A2219', locked:'#12151B', good:'#7EE0A1', bad:'#FF8A8A' };
const ICONS = {
  undo:['M9 14 4 9l5-5','M4 9h11a5 5 0 0 1 0 10h-3'], redo:['m15 14 5-5-5-5','M20 9H9a5 5 0 0 0 0 10h3'],
  dice:['M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z','M8.5 8.5h.01','M15.5 15.5h.01','M15.5 8.5h.01','M8.5 15.5h.01'],
  lock:['M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z','M8 11V7a4 4 0 0 1 8 0v4'], check:['m5 12 5 5 9-10'],
  move:['M12 2v20M2 12h20','M9 5l3-3 3 3','M9 19l3 3 3-3','M5 9l-3 3 3 3','M19 9l3 3-3 3'],
  pin:['M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z','M12 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'],
  tpose:['M12 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z','M2 9h20M12 9v6M9 22l3-7 3 7'], chevronLeft:['m15 6-6 6 6 6'], chevronRight:['m9 6 6 6-6 6'], chevronUp:['m6 15 6-6 6 6'], chevronDown:['m6 9 6 6 6-6'],
  exit:['M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4','M10 17l-5-5 5-5','M5 12h12']
};
const paths = new Map();
const iconPaths = name => { if (!paths.has(name)) paths.set(name, (ICONS[name] || []).map(path => new Path2D(path))); return paths.get(name); };
const DRAGGABLE = new Set(['range', 'ring', 'square']);
const SECTIONS = { modes:'Modes', move:'Move', place:'Place', performance:'Performance', preview:'Preview' };

/** A room-pinned canvas mesh with native creator bindings and controller ray input, plus a palm-up wrist menu. */
export class XRConfiguratorPanel {
  constructor(scene, bridge) { this.scene=scene;this.bridge=bridge;this.raycaster=new THREE.Raycaster();this.entries=new Map();this.view='customize';this.page=0;this.groupPage=0;this.dirty=true;this.regions=[];this.recent=[]; }
  start() {
    this.restore();this.active=true;this.view='customize';this.page=0;this.groupPage=0;this.slotPage=0;this.sceneSection='modes';this.filter='all';this.hoverKey=null;this.helpKey=null;this.positioned=false;this.hidden=false;this.dirty=true;this.recent=[];
    this.canvas=document.createElement('canvas');this.canvas.width=W*PX;this.canvas.height=H*PX;
    const texture=new THREE.CanvasTexture(this.canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(.96,1.04),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
    this.cursor=new THREE.Mesh(new THREE.RingGeometry(.006,.009,20),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));this.cursor.visible=false;this.cursor.renderOrder=10001;this.mesh.renderOrder=10000;this.mesh.add(this.cursor);
    this.mesh.visible=false;this.mesh.name='AviRev configurator';this.scene.add(this.mesh);
    this.wristCanvas=document.createElement('canvas');this.wristCanvas.width=this.wristCanvas.height=512;
    const wristTexture=new THREE.CanvasTexture(this.wristCanvas);wristTexture.colorSpace=THREE.SRGBColorSpace;
    this.wrist=new THREE.Mesh(new THREE.PlaneGeometry(.17,.17),new THREE.MeshBasicMaterial({map:wristTexture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));this.wrist.renderOrder=10002;this.wrist.visible=false;this.wrist.name='AviRev wrist menu';
    this.wristCursor=new THREE.Mesh(new THREE.RingGeometry(.003,.0045,16),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));this.wristCursor.renderOrder=10003;this.wristCursor.visible=false;this.wrist.add(this.wristCursor);this.scene.add(this.wrist);
    this.unobserve=this.bridge.observe?.(()=>{this.dirty=true;});this.draw();
  }
  // ---- drawing primitives (panel units) ----
  shape(ctx,x,y,w,h,r,fill,stroke,width=2){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
  icon(ctx,name,x,y,size,colour,width=2){ctx.save();ctx.translate(x,y);ctx.scale(size/24,size/24);ctx.strokeStyle=colour;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';for(const path of iconPaths(name))ctx.stroke(path);ctx.restore();}
  text(ctx,str,x,y,width,size=24,colour=C.text,{weight=400,lines=1,align='left',lineHeight=1.25}={}){
    ctx.font=weight+' '+size+'px '+FONT;ctx.fillStyle=colour;ctx.textAlign=align;ctx.textBaseline='alphabetic';
    const fit=line=>{if(ctx.measureText(line).width<=width)return line;while(line.length&&ctx.measureText(line+'…').width>width)line=line.slice(0,-1);return line.trimEnd()+'…';};
    const words=String(str??'').split(/\s+/).filter(Boolean),out=[];let line='',rest=[];
    for(let i=0;i<words.length;i++){const next=line?line+' '+words[i]:words[i];if(ctx.measureText(next).width<=width||!line){line=next;continue;}out.push(line);line=words[i];if(out.length===lines){rest=words.slice(i);line='';break;}}
    if(line&&out.length<lines)out.push(line);if(rest.length)out[lines-1]+=' '+rest.join(' ');
    out.forEach((value,index)=>ctx.fillText(fit(value),x,y+index*size*lineHeight));ctx.textAlign='left';
  }
  region(x,y,w,h,options){const region={x,y,w,h,...options};this.regions.push(region);return region;}
  hovered(key){return !!key&&this.hoverKey===key;}
  /** A selectable card: fill/stroke follow selected, disabled and hover states. */
  card(ctx,{key,x,y,w,h,r=18,selected=false,disabled=false,fill=C.surface,stroke=null,action,row,kind='button',help}){
    const hover=!disabled&&this.hovered(key);
    this.shape(ctx,x,y,w,h,r,selected?C.selected:disabled?C.locked:hover?C.raised:fill,selected?C.accent:stroke,selected?3:2);
    if(hover)this.shape(ctx,x+2,y+2,w-4,h-4,Math.max(4,r-2),null,C.accent,3);
    return this.region(x,y,w,h,{key,action,disabled,row,kind,help:help??row?.help});
  }
  pill(ctx,{key,x,y,label,selected,disabled,action,row,h=52,size=22}){
    ctx.font=(selected?700:400)+' '+size+'px '+FONT;const w=Math.ceil(ctx.measureText(label).width)+40;
    const hover=!disabled&&this.hovered(key);this.shape(ctx,x,y,w,h,h/2,selected?C.text:hover?C.raised:null,selected?C.text:hover?C.accent:C.line,2);
    this.text(ctx,label,x+20,y+h/2+size*.36,w-40,size,selected?C.ground:disabled?C.faint:C.muted,{weight:selected?700:400});
    this.region(x,y,w,h,{key,action,disabled,row,help:row?.help});return w;
  }
  toggle(ctx,x,y,on){this.shape(ctx,x,y,68,38,19,on?C.accent:C.faint);ctx.beginPath();ctx.arc(x+(on?49:19),y+19,15,0,Math.PI*2);ctx.fillStyle=C.text;ctx.fill();}
  rangeRow(ctx,row,x,y,w,h=88){
    this.shape(ctx,x,y,w,h,18,row.disabled?C.locked:C.surface);
    this.text(ctx,row.label+' · '+row.value,x+96,y+34,w-192,22,row.disabled?C.faint:C.text);
    const trackX=x+96,trackW=w-192,trackY=y+48,ratio=THREE.MathUtils.clamp((row.value-row.min)/(row.max-row.min||1),0,1);
    this.shape(ctx,trackX,trackY,trackW,24,12,C.raised);this.shape(ctx,trackX,trackY,Math.max(24,trackW*ratio),24,12,row.disabled?C.faint:C.accent);this.shape(ctx,trackX+trackW*ratio-6,trackY-8,12,40,6,C.text,C.ground,2);
    if(this.hovered(row.key))this.shape(ctx,trackX-4,trackY-12,trackW+8,48,16,null,C.accent,3);
    this.region(trackX,trackY-14,trackW,52,{key:row.key,kind:'range',row,disabled:row.disabled,help:row.help||'Hold the trigger and sweep along the track. Use minus or plus for one step.',action:px=>this.dispatch(row,row.min+(row.max-row.min)*THREE.MathUtils.clamp((px-trackX)/trackW,0,1))});
    for(const [dx,sign,glyph] of [[x+14,-1,'−'],[x+w-82,1,'+']]){const key=row.key+(sign<0?':minus':':plus');this.card(ctx,{key,x:dx,y:y+16,w:68,h:56,r:16,fill:C.raised,disabled:row.disabled,row,action:()=>this.dispatch(row,row.value+sign*row.step)});this.text(ctx,glyph,dx+34,y+54,40,32,row.disabled?C.faint:C.text,{align:'center'});}
  }
  pager(ctx,x,y,w,page,max,set){
    this.card(ctx,{key:'page:previous',x,y,w:160,h:68,disabled:page<=0,action:()=>set(page-1)});this.icon(ctx,'chevronLeft',x+20,y+20,28,page<=0?C.faint:C.text);this.text(ctx,'Previous',x+54,y+43,96,22,page<=0?C.faint:C.text);
    this.card(ctx,{key:'page:next',x:x+w-160,y,w:160,h:68,disabled:page>=max,action:()=>set(page+1)});this.text(ctx,'Next',x+w-132,y+43,70,22,page>=max?C.faint:C.text);this.icon(ctx,'chevronRight',x+w-50,y+20,28,page>=max?C.faint:C.text);
    const count=Math.min(max+1,9),start=Math.max(0,Math.min(page-4,max+1-count)),dx=x+w/2-count*10;
    for(let i=0;i<count;i++){const current=start+i===page;this.shape(ctx,dx+i*20+(current?-6:0),y+29,current?22:10,10,5,current?C.accent:C.faint);}
  }
  // ---- views ----
  header(ctx,state,crumb){
    this.text(ctx,'AviRev',24,58,260,30,C.text,{weight:700});this.text(ctx,crumb,24,88,this.view==='scene'?420:300,20,C.muted);
    if(this.view==='scene'){
      const rows=new Map(state.controls.map(row=>[row.key,row]));let x=W-24;
      for(const [id,iconName,light] of [['ar-exit','exit',true],['ar-reposition','pin',false]]){const row=rows.get(id);if(!row)continue;ctx.font='700 22px '+FONT;const w=Math.ceil(ctx.measureText(row.label).width)+86;x-=w;this.card(ctx,{key:row.key,x,y:28,w,h:64,r:18,fill:light?C.text:C.surface,stroke:light?null:C.line,disabled:row.disabled,row,action:()=>this.dispatch(row)});this.icon(ctx,iconName,x+18,46,28,light?C.ground:C.text);this.text(ctx,row.label,x+58,68,w-70,22,light?C.ground:C.text,{weight:700});x-=12;}
      return;
    }
    let x=336;
    for(const group of [state.global.filter(row=>row.type!=='body'),state.global.filter(row=>row.type==='body')]){
      this.shape(ctx,x,28,200,64,20,C.surface);
      group.slice(0,2).forEach((row,index)=>{const bx=x+4+index*98;this.card(ctx,{key:row.key,x:bx,y:32,w:94,h:56,r:16,selected:row.selected,disabled:row.disabled,fill:C.surface,row,action:()=>{this.dispatch(row);this.page=this.groupPage=0;}});this.text(ctx,row.label,bx+47,67,86,22,row.disabled?C.faint:C.text,{align:'center',weight:row.selected?700:400});});
      x+=216;
    }
    for(const [type,iconName,enabled] of [['undo','undo',state.look.canUndo],['redo','redo',state.look.canRedo]]){this.card(ctx,{key:'look:'+type,x,y:28,w:64,h:64,r:18,disabled:!enabled,stroke:C.line,help:type==='undo'?'Undo your last look change.':'Redo the change you undid.',action:()=>this.bridge.dispatch({type})});this.icon(ctx,iconName,x+16,44,32,enabled?C.text:C.faint);x+=72;}
  }
  nav(ctx){
    this.shape(ctx,24,108,912,76,22,C.surface);
    for(const [index,view] of ['customize','colours','scene'].entries()){const x=30+index*302;this.card(ctx,{key:'tab:'+view,x,y:114,w:296,h:64,r:16,selected:this.view===view,fill:C.surface,help:view==='customize'?'Choose parts, outfits and body shape.':view==='colours'?'Change colours of the selected category.':'Avatar modes, movement, placement and performance.',action:()=>{this.view=view;this.page=0;this.helpKey=null;this.bridge.tab?.(view);this.dirty=true;}});this.text(ctx,{customize:'Customize',colours:'Colours',scene:'Scene'}[view],x+148,155,280,26,this.view===view?C.text:C.muted,{align:'center',weight:this.view===view?700:400});}
  }
  footerBar(ctx,state){
    const help=this.helpKey&&this.helpText,message=help||state.hint||state.roomStatus||'Point at a control and press the trigger.';
    this.shape(ctx,24,H-88,912,64,18,C.raised);this.region(24,H-88,912,64,{kind:'handle'});
    this.icon(ctx,'move',44,H-68,26,C.muted);this.text(ctx,message,84,H-49,620,20,help?C.text:C.muted);this.text(ctx,'Grip to move · Y recalls',916,H-49,210,18,C.muted,{align:'right'});
  }
  drawCustomize(ctx,state){
    const perRail=6,groups=state.groups,maxGroup=Math.max(0,Math.ceil(groups.length/perRail)-1);this.groupPage=Math.min(this.groupPage,maxGroup);
    groups.slice(this.groupPage*perRail,this.groupPage*perRail+perRail).forEach((row,index)=>{const y=200+index*80;this.card(ctx,{key:row.key,x:24,y,w:216,h:72,selected:row.selected,disabled:row.disabled,row,action:()=>{this.dispatch(row);this.page=0;this.filter='all';this.helpKey=null;this.view=this.bridge.snapshot('customize').colourOnly?'colours':'customize';this.bridge.tab?.(this.view);this.dirty=true;}});this.text(ctx,row.glyph,52,y+46,40,26,C.text,{align:'center'});this.text(ctx,row.label,76,row.count?y+34:y+44,150,22,row.selected?C.text:C.muted,{weight:row.selected?700:400});if(row.count)this.text(ctx,row.count,76,y+58,150,18,C.muted);});
    if(maxGroup>0)for(const [index,[dir,iconName]] of [[-1,'chevronUp'],[1,'chevronDown']].entries()){const x=24+index*112,disabled=dir<0?this.groupPage===0:this.groupPage===maxGroup;this.card(ctx,{key:'groups:'+dir,x,y:688,w:104,h:56,disabled,help:'More categories',action:()=>{this.groupPage+=dir;this.dirty=true;}});this.icon(ctx,iconName,x+38,700,28,disabled?C.faint:C.text);}
    const x0=264,width=672,controls=state.controls,headings=controls.filter(row=>row.key.startsWith('row:')),tiles=controls.filter(row=>row.key.startsWith('tile:')),ranges=controls.filter(row=>row.type==='range'),chips=controls.filter(row=>!row.key.startsWith('row:')&&!row.key.startsWith('tile:')&&row.type!=='range'&&!['−','+','↺'].includes(row.label.trim()));
    this.text(ctx,state.title,x0,236,tiles.length?300:width,32,C.text,{weight:700});
    if(tiles.length){let fx=x0+width;for(const [id,name] of [['selected','Worn'],['available','Unlocked'],['all','All']]){ctx.font=(this.filter===id?700:400)+' 22px '+FONT;fx-=Math.ceil(ctx.measureText(name).width)+40;this.pill(ctx,{key:'filter:'+id,x:fx,y:200,label:name,selected:this.filter===id,action:()=>{this.filter=id;this.page=0;this.dirty=true;}});fx-=8;}}
    let y=268,cx=x0,line=0;
    const flowChips=list=>{for(const row of list){ctx.font=(row.selected?700:400)+' 22px '+FONT;const w=Math.ceil(ctx.measureText(row.label).width)+40;if(cx+w>x0+width&&cx>x0){cx=x0;line++;}if(line>1)break;cx+=this.pill(ctx,{key:row.key,x:cx,y:y+line*62,label:row.label,selected:row.selected,disabled:row.disabled,row,action:()=>{this.dispatch(row);this.page=0;this.dirty=true;}})+10;}};
    if(headings.length>1||chips.length){flowChips(headings.length>1?headings:[]);flowChips(chips);y+=(line+1)*62+4;}
    const shownTiles=tiles.filter(row=>this.filter==='all'||(this.filter==='available'?!row.disabled:row.selected)),bottom=776,tileH=138,gap=12;
    const blocks=[];for(let i=0;i<shownTiles.length;i+=3)blocks.push({kind:'tiles',rows:shownTiles.slice(i,i+3),h:tileH});for(const row of ranges)blocks.push({kind:'range',row,h:88});
    const pages=[[]];let used=0;const room=bottom-y;for(const block of blocks){if(used+block.h>room&&pages.at(-1).length){pages.push([]);used=0;}pages.at(-1).push(block);used+=block.h+gap;}
    const maxPage=pages.length-1;this.page=Math.min(this.page,maxPage);
    for(const block of pages[this.page]){
      if(block.kind==='range'){this.rangeRow(ctx,block.row,x0,y,width,88);y+=88+gap;continue;}
      block.rows.forEach((row,index)=>{const tw=(width-2*16)/3,tx=x0+index*(tw+16),level=/level (\d+)/i.exec(row.help||'')?.[1];
        this.card(ctx,{key:row.key,x:tx,y,w:tw,h:tileH,r:20,selected:row.selected,disabled:row.disabled,row,help:row.disabled?row.help:row.label,action:()=>this.dispatch(row)});
        const ix=tx+tw/2-46,iy=y+8;this.shape(ctx,ix,iy,92,92,16,C.raised);
        if(row.image?.complete&&row.image.naturalWidth){ctx.save();ctx.beginPath();ctx.roundRect(ix,iy,92,92,16);ctx.clip();if(row.disabled)ctx.globalAlpha=.45;try{ctx.drawImage(row.image,ix+4,iy+4,84,84);}catch{/* A revoked thumbnail URL keeps the placeholder tile. */}ctx.restore();}else this.text(ctx,'◈',ix+46,iy+58,60,36,C.faint,{align:'center'});
        if(row.disabled){this.icon(ctx,'lock',ix+28,iy+16,36,C.text);if(level)this.text(ctx,'Lv '+level,ix+46,iy+80,96,20,C.text,{align:'center',weight:700});}
        if(row.selected){ctx.beginPath();ctx.arc(tx+tw-18,y+18,20,0,Math.PI*2);ctx.fillStyle=C.accent;ctx.fill();ctx.lineWidth=4;ctx.strokeStyle=C.ground;ctx.stroke();this.icon(ctx,'check',tx+tw-30,y+6,24,C.ground,3);}
        this.text(ctx,row.label,tx+tw/2,y+124,tw-20,20,row.disabled?C.muted:C.text,{align:'center'});});
      y+=tileH+gap;
    }
    if(!controls.length)this.text(ctx,'Nothing to change in this category.',x0,320,width,24,C.muted);
    this.shape(ctx,24,792,912,64,20,C.surface);this.text(ctx,'Now wearing',44,832,140,20,C.muted);
    let wx=180,shownCount=0;const worn=state.look.wearing,limit=W-24-224-70;
    for(const title of worn){ctx.font='20px '+FONT;const w=Math.min(200,Math.ceil(ctx.measureText(title).width)+32);if(wx+w>limit)break;this.shape(ctx,wx,802,w,44,22,C.raised,C.line);this.text(ctx,title,wx+16,831,w-32,20,C.text);wx+=w+8;shownCount++;}
    if(worn.length>shownCount){this.shape(ctx,wx,802,60,44,22,C.raised,C.line);this.text(ctx,'+'+(worn.length-shownCount),wx+30,831,50,20,C.muted,{align:'center'});}
    if(state.random){const row=state.random,x=W-24-212;this.card(ctx,{key:row.key,x,y:798,w:204,h:52,r:16,fill:C.accent,disabled:row.disabled,row,help:HELP['random-avatar'],action:()=>this.dispatch(row)});this.icon(ctx,'dice',x+16,810,28,C.ground);this.text(ctx,'Surprise me',x+54,832,140,22,C.ground,{weight:700});}
    this.pager(ctx,24,868,912,this.page,maxPage,page=>{this.page=page;this.dirty=true;});
  }
  drawColours(ctx,state){
    const slots=state.controls.filter(row=>row.key.startsWith('slot:')),per=6,maxSlot=Math.max(0,Math.ceil(slots.length/per)-1);this.slotPage=Math.min(this.slotPage||0,maxSlot);
    this.text(ctx,'Colour slot',30,224,200,20,C.muted);
    slots.slice(this.slotPage*per,this.slotPage*per+per).forEach((row,index)=>{const y=240+index*80;this.card(ctx,{key:row.key,x:24,y,w:216,h:72,selected:row.selected,disabled:row.disabled,row,action:()=>this.dispatch(row)});this.shape(ctx,40,y+20,32,32,10,row.colour||C.raised,C.faint);this.text(ctx,row.label,86,y+44,140,22,row.selected?C.text:C.muted,{weight:row.selected?700:400});});
    if(maxSlot>0)for(const [index,[dir,iconName]] of [[-1,'chevronUp'],[1,'chevronDown']].entries()){const x=24+index*112,disabled=dir<0?this.slotPage===0:this.slotPage===maxSlot;this.card(ctx,{key:'slots:'+dir,x,y:724,w:104,h:56,disabled,action:()=>{this.slotPage+=dir;this.dirty=true;}});this.icon(ctx,iconName,x+38,736,28,disabled?C.faint:C.text);}
    if(!slots.length){this.text(ctx,'This category has no colour slots.',264,260,672,24,C.muted);return;}
    const x0=264,width=672,rows=new Map(state.controls.map(row=>[row.key,row])),colour=state.colour;let y=204;
    const reset=state.controls.find(row=>row.label==='Default');
    if(colour){
      const size=290,cxr=x0+size/2,cyr=y+size/2,outer=size/2,inner=outer-46,hue=colour.hsv[0]*360;
      const conic=ctx.createConicGradient(-Math.PI/2,cxr,cyr);for(let i=0;i<=12;i++)conic.addColorStop(i/12,'hsl('+i*30+',100%,50%)');
      ctx.beginPath();ctx.arc(cxr,cyr,outer,0,Math.PI*2);ctx.arc(cxr,cyr,inner,0,Math.PI*2,true);ctx.fillStyle=conic;ctx.fill('evenodd');
      if(this.hovered('ring')){ctx.lineWidth=3;ctx.strokeStyle=C.accent;ctx.beginPath();ctx.arc(cxr,cyr,outer+4,0,Math.PI*2);ctx.stroke();}
      const sq=inner*1.3,sx=cxr-sq/2,sy=cyr-sq/2;
      ctx.save();ctx.beginPath();ctx.roundRect(sx,sy,sq,sq,14);ctx.clip();ctx.fillStyle='hsl('+hue+',100%,50%)';ctx.fillRect(sx,sy,sq,sq);
      let gradient=ctx.createLinearGradient(sx,0,sx+sq,0);gradient.addColorStop(0,'#fff');gradient.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=gradient;ctx.fillRect(sx,sy,sq,sq);
      gradient=ctx.createLinearGradient(0,sy,0,sy+sq);gradient.addColorStop(0,'rgba(0,0,0,0)');gradient.addColorStop(1,'#000');ctx.fillStyle=gradient;ctx.fillRect(sx,sy,sq,sq);ctx.restore();
      const angle=(hue-90)*Math.PI/180,hx=cxr+Math.cos(angle)*(inner+23),hy=cyr+Math.sin(angle)*(inner+23);
      for(const [px,py,r,fill] of [[hx,hy,20,null],[sx+colour.hsv[1]*sq,sy+(1-colour.hsv[2])*sq,16,colour.hex]]){ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}ctx.lineWidth=5;ctx.strokeStyle=C.text;ctx.stroke();ctx.lineWidth=2;ctx.strokeStyle=C.ground;ctx.beginPath();ctx.arc(px,py,r+3.5,0,Math.PI*2);ctx.stroke();}
      const hueRow=rows.get('hsv:0'),svRow=rows.get('sv');
      if(hueRow)this.region(x0,y,size,size,{key:'ring',kind:'ring',row:hueRow,disabled:colour.disabled,help:'Hold the trigger on the ring and sweep to change hue. The avatar updates live.',action:(px,py)=>this.dispatch(hueRow,((Math.atan2(py-cyr,px-cxr)*180/Math.PI+90)%360+360)%360)});
      if(svRow)this.region(sx,sy,sq,sq,{key:'square',kind:'square',row:svRow,disabled:colour.disabled,help:'Hold the trigger in the square and sweep: left to right adds colour, top to bottom darkens.',action:(px,py)=>this.dispatch(svRow,{s:THREE.MathUtils.clamp((px-sx)/sq,0,1),v:THREE.MathUtils.clamp(1-(py-sy)/sq,0,1)})});
      const rx=x0+size+28,rw=width-size-28,hexRow=rows.get('hex');
      this.shape(ctx,rx,y+6,rw,104,22,colour.hex,C.line);this.text(ctx,colour.hex,rx,y+148,rw,30,C.text,{weight:700});this.text(ctx,state.slot,rx,y+178,rw,20,C.muted);
      if(this.recent.length){this.text(ctx,'Recently used',rx,y+222,rw,20,C.muted);this.recent.slice(0,6).forEach((hex,index)=>{const x=rx+index*52;this.card(ctx,{key:'recent:'+hex,x,y:y+236,w:44,h:44,r:12,fill:hex,stroke:hex===colour.hex?C.text:C.line,disabled:!hexRow||colour.disabled,help:hex,action:()=>this.dispatch(hexRow,hex)});});}
      y+=size+22;
    }
    const swatches=state.controls.filter(row=>row.key.startsWith('swatch:'));
    if(swatches.length){
      this.text(ctx,colour?'Authored palette':'Unlocked colours',x0,y+24,400,24,C.text,{weight:700});
      if(reset){this.card(ctx,{key:reset.key,x:x0+width-210,y:y-4,w:210,h:48,r:14,stroke:C.line,disabled:reset.disabled,row:reset,help:'Return this slot to its authored colour.',action:()=>this.dispatch(reset)});this.text(ctx,'Reset to authored',x0+width-105,y+28,190,20,C.text,{align:'center'});}
      y+=44;const cols=8,sw=(width-(cols-1)*10)/cols;
      swatches.slice(0,24).forEach((row,index)=>{const x=x0+(index%cols)*(sw+10),sy=y+Math.floor(index/cols)*66;this.card(ctx,{key:row.key,x,y:sy,w:sw,h:56,r:14,fill:row.colour,stroke:row.selected?C.text:C.line,disabled:row.disabled,row,help:row.label,action:()=>this.dispatch(row)});if(row.selected){ctx.lineWidth=3;ctx.strokeStyle=C.accent;ctx.beginPath();ctx.roundRect(x-4,sy-4,sw+8,64,17);ctx.stroke();}});
      y+=Math.ceil(Math.min(24,swatches.length)/cols)*66+12;
    }else if(reset){this.card(ctx,{key:reset.key,x:x0,y,w:210,h:48,r:14,stroke:C.line,disabled:reset.disabled,row:reset,action:()=>this.dispatch(reset)});this.text(ctx,'Reset to authored',x0+105,y+32,190,20,C.text,{align:'center'});y+=60;}
    const brightness=rows.get('hsv:2');if(brightness&&y+88<=H-104){this.rangeRow(ctx,{...brightness,label:'Brightness'},x0,y,width,88);y+=100;}
    for(const row of state.controls.filter(row=>row.type==='range')){if(y+88>H-104)break;this.rangeRow(ctx,row,x0,y,width,88);y+=100;}
  }
  drawScene(ctx,state){
    const rows=new Map(state.controls.map(row=>[row.key,row]));
    this.shape(ctx,24,200,912,68,20,C.surface);
    Object.entries(SECTIONS).forEach(([section,title],index)=>{const x=28+index*181.6;this.card(ctx,{key:'section:'+section,x,y:204,w:177,h:60,r:16,selected:this.sceneSection===section,fill:C.surface,action:()=>{this.sceneSection=section;this.helpKey=null;this.dirty=true;}});this.text(ctx,title,x+88,242,165,22,this.sceneSection===section?C.text:C.muted,{align:'center',weight:this.sceneSection===section?700:400});});
    const x0=24,width=912;let y=288;
    const heading=title=>{this.text(ctx,title,x0,y+26,width,26,C.text,{weight:700});y+=42;};
    const segmented=(row,labels)=>{if(!row)return;this.text(ctx,row.label,x0,y+22,width,20,C.muted);y+=34;const options=row.options||[],w=(width-(options.length-1)*8)/options.length;options.forEach((option,index)=>{const x=x0+index*(w+8),on=row.value===option.value;this.card(ctx,{key:row.key+':'+option.value,x,y,w,h:60,r:16,selected:on,disabled:row.disabled,fill:C.surface,row,action:()=>this.dispatch(row,option.value)});this.text(ctx,labels?.[option.value]||option.label,x+w/2,y+38,w-20,22,on?C.text:C.muted,{align:'center',weight:on?700:400});});y+=76;};
    const switchCard=(row,x,w,{on=row?.selected,label=row?.label,detail='',action=()=>this.dispatch(row)}={})=>{if(!row)return;this.card(ctx,{key:row.key,x,y,w,h:76,disabled:row.disabled,fill:C.raised,stroke:C.line,row,action});this.text(ctx,label,x+18,y+(detail?34:46),w-110,22,row.disabled?C.faint:C.text);if(detail)this.text(ctx,detail,x+18,y+60,w-110,18,C.muted);this.toggle(ctx,x+w-86,y+19,on);};
    const actionCard=(row,x,w,h,detail)=>{if(!row)return;this.card(ctx,{key:row.key,x,y,w,h,disabled:row.disabled,selected:row.selected,row,action:()=>this.dispatch(row)});this.text(ctx,row.label,x+20,y+40,w-40,24,row.disabled?C.faint:C.text,{weight:700});if(detail)this.text(ctx,detail,x+20,y+72,w-40,19,C.muted,{lines:2});};
    if(this.sceneSection==='modes'){
      const behavior=rows.get('ar-behavior');heading('Avatar mode');
      if(behavior){const text={manual:'Sticks walk and turn the avatar.',follow:'Stays about 1.5 m from you.',puppet:'Copies your head and hands; legs idle.'},w=(width-24)/3;(behavior.options||[]).forEach((option,index)=>{const x=x0+index*(w+12),on=behavior.value===option.value;this.card(ctx,{key:'mode:'+option.value,x,y,w,h:124,r:20,selected:on,disabled:behavior.disabled,row:behavior,action:()=>this.dispatch(behavior,option.value)});this.text(ctx,option.label,x+18,y+42,w-36,26,C.text,{weight:700});this.text(ctx,text[option.value]||'',x+18,y+76,w-36,19,C.soft,{lines:2});});y+=138;}
      if(behavior?.value==='puppet'){const half=(width-12)/2;switchCard(rows.get('ar-mirror'),x0,half);const calibrate=rows.get('ar-calibrate');if(calibrate){this.card(ctx,{key:calibrate.key,x:x0+half+12,y,w:half,h:76,fill:C.warmGround,stroke:C.warm,row:calibrate,action:()=>this.dispatch(calibrate)});this.icon(ctx,'tpose',x0+half+30,y+22,32,C.warm);this.text(ctx,'T-pose + both sticks',x0+half+76,y+34,half-90,22,C.text,{weight:700});this.text(ctx,'Press to reset calibration',x0+half+76,y+60,half-90,18,C.muted);}y+=90;}
      segmented(rows.get('ar-collision'),{room:'Room',floor:'Floor only'});segmented(rows.get('ar-run-mode'),{toggle:'Click to toggle',hold:'Hold to run'});
    }else if(this.sceneSection==='move'){
      heading('Movement & poses');const w=(width-12)/2;
      for(const pair of [[['ar-crawl','Left stick moves while crawling.'],['ar-fly','Or double jump, or hold right stick forward 1 s.']],[['ar-sit','Or hold crouch still for 1 s.'],['ar-walk','Cancels a pointed destination.']]]){pair.forEach(([id,detail],index)=>actionCard(rows.get(id),x0+index*(w+12),w,118,detail));y+=130;}
      this.shape(ctx,x0,y,width,176,20,C.surface);
      [['LEFT STICK','Walk and strafe · click to run'],['RIGHT STICK','Turn · forward 1 s fly or stand · back 1 s sit'],['A BUTTON','Jump · press again in the air to fly'],['BOTH STICKS','In a T-pose: calibrate Puppet']].forEach(([key,value],index)=>{this.text(ctx,key,x0+24,y+40+index*38,190,20,C.accent,{weight:700});this.text(ctx,value,x0+214,y+40+index*38,width-238,20,C.text);});
    }else if(this.sceneSection==='place'){
      heading('Placement & size');for(const id of ['ar-size','ar-seat-height']){const row=rows.get(id);if(row&&!row.disabled){this.rangeRow(ctx,row,x0,y,width,88);y+=100;}}
      const w=(width-24)/3;[['ar-turn','For chairs: face the front.'],['ar-reposition','Pick a new floor spot.'],['ar-exit','Back to the browser.']].forEach(([id,detail],index)=>actionCard(rows.get(id),x0+index*(w+12),w,118,detail));
    }else if(this.sceneSection==='performance'){
      const fps=Number(/(\d+) fps/.exec(state.roomStatus||'')?.[1])||0,colourFps=!fps?C.muted:fps>=70?C.good:fps>=60?C.warm:C.bad;
      this.shape(ctx,x0,y,width,108,20,C.surface);this.text(ctx,'Frame rate',x0+24,y+42,300,26,C.text,{weight:700});this.text(ctx,fps?String(fps):'–',x0+width-190,y+50,120,44,colourFps,{weight:700,align:'right'});this.text(ctx,fps?'fps · target 72':'measured in XR',x0+width-24,y+48,160,18,C.muted,{align:'right'});
      this.shape(ctx,x0+24,y+70,width-48,14,7,C.line);if(fps)this.shape(ctx,x0+24,y+70,Math.max(14,(width-48)*Math.min(1,fps/72)),14,7,colourFps);y+=124;
      const quality=rows.get('ar-quality');if(quality){this.text(ctx,'Render quality',x0,y+22,width,20,C.muted);y+=34;const detail={sharp:'Full resolution',balanced:'85% · soft edges',fast:'70% · most edge blur'},w=(width-16)/3;(quality.options||[]).forEach((option,index)=>{const x=x0+index*(w+8),on=quality.value===option.value;this.card(ctx,{key:'quality:'+option.value,x,y,w,h:84,selected:on,fill:C.surface,row:quality,action:()=>this.dispatch(quality,option.value)});this.text(ctx,option.label,x+w/2,y+38,w-20,24,C.text,{align:'center',weight:700});this.text(ctx,detail[option.value]||'',x+w/2,y+66,w-20,18,C.soft,{align:'center'});});y+=100;}
      const half=(width-12)/2,rate=rows.get('ar-animation-rate'),collision=rows.get('ar-collision');
      segmented(rows.get('ar-occlusion'),{off:'Off',planes:'Room setup',mesh:'Scan',both:'Setup + scan',depth:'Live depth'});
      switchCard(rows.get('ar-shadows'),x0,half,{detail:'Soft floor shadow · GPU'});switchCard(rate,x0+half+12,half,{on:rate?.value==='2',label:'Half-rate animation',detail:'Halves animation CPU work',action:()=>this.dispatch(rate,rate.value==='2'?'1':'2')});y+=88;
      switchCard(collision,x0,half,{on:collision?.value==='floor',label:'Floor-only collision',detail:'Ignores walls and furniture',action:()=>this.dispatch(collision,collision.value==='floor'?'room':'floor')});
      this.text(ctx,'Render quality and Live depth apply the next time you enter XR. Everything else applies now.',x0+half+12,y+30,half,19,C.muted,{lines:2});
    }else{
      heading('Preview & review');const w=(width-12)/2,list=['random-avatar','a-pose','idle','wire','cuts','reset-config'].map(id=>rows.get(id)).filter(Boolean);
      list.forEach((row,index)=>{const x=x0+(index%2)*(w+12);if(index&&index%2===0)y+=88;if(['idle','wire','cuts'].includes(row.key))switchCard(row,x,w);else{this.card(ctx,{key:row.key,x,y,w,h:76,disabled:row.disabled,selected:row.selected,row,action:()=>this.dispatch(row)});this.text(ctx,row.label,x+20,y+46,w-40,22,row.disabled?C.faint:C.text,{weight:700});}});
      y+=96;const level=rows.get('preview-level');if(level)this.rangeRow(ctx,level,x0,y,width,88);
    }
  }
  draw() {
    if (!this.active) return;
    const state=this.bridge.snapshot(this.view);this.snapshot=state;
    // Recent colours: a value that changed within the same slot was chosen by the viewer.
    if(state.colour){if(this.lastSlot===state.slot&&this.lastColour&&this.lastColour!==state.colour.hex)this.recent=[state.colour.hex,...this.recent.filter(hex=>hex!==state.colour.hex)].slice(0,6);this.lastColour=state.colour.hex;this.lastSlot=state.slot;}
    this.liveRows=new Map([...state.global,...state.groups,...state.controls,...(state.random?[state.random]:[])].map(row=>[row.key,row]));
    const signature=JSON.stringify([this.view,this.page,this.groupPage,this.slotPage,this.sceneSection,this.filter,this.hoverKey,this.helpKey,this.helpText,this.recent,state.title,state.slot,state.status,state.roomStatus,state.hint,state.look,state.colour,state.random?.disabled,[...this.liveRows.values()].map(row=>[row.key,row.label,row.type,row.value,row.min,row.max,row.disabled,row.selected,row.colour,row.count,row.image?.currentSrc,row.image?.complete,row.image?.naturalWidth])]);
    if(signature===this.signature){this.dirty=false;return;}this.signature=signature;
    const ctx=this.canvas.getContext('2d');this.regions=[];
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,this.canvas.width,this.canvas.height);ctx.setTransform(PX,0,0,PX,0,0);
    this.shape(ctx,1,1,W-2,H-2,28,C.ground,C.line,2);
    const crumb=this.view==='scene'?'Scene › '+SECTIONS[this.sceneSection]:this.view==='colours'?'Colours › '+(state.slot||'Colour'):'Customize › '+state.title;
    this.header(ctx,state,crumb);this.nav(ctx);
    if(this.view==='scene')this.drawScene(ctx,state);else if(this.view==='colours')this.drawColours(ctx,state);else this.drawCustomize(ctx,state);
    this.footerBar(ctx,state);
    this.mesh.material.map.needsUpdate=true;this.dirty=false;
  }
  drawWrist() {
    if(!this.wristCanvas)return;
    // The wrist menu: show/hide the creator panel, reposition, and the three scene switches people change most.
    const scene=this.bridge.snapshot('scene'),rows=new Map((scene.controls||[]).map(row=>[row.key,row])),status=scene.roomStatus||'',occlusionState=((status.match(/live depth [^\u00b7]+/)||status.match(/occluding [^\u00b7]+|room occlusion [a-z]+/)||['waiting for room data'])[0]).trim(),reposition=rows.get('ar-reposition'),behavior=rows.get('ar-behavior'),collision=rows.get('ar-collision'),occlusion=rows.get('ar-occlusion');
    const signature=JSON.stringify([this.wristHover,this.hidden,reposition?.disabled,behavior?.value,collision?.value,occlusion?.value,occlusionState]);if(signature===this.wristSignature)return;this.wristSignature=signature;
    const ctx=this.wristCanvas.getContext('2d'),scale=512/480;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,512,512);ctx.setTransform(scale,0,0,scale,0,0);
    this.shape(ctx,4,4,472,472,36,C.ground,C.line,3);
    this.wristRegions=[];
    const ROW=80,GAP=10,TOP=22,X=22,WIDTH=436,y=index=>TOP+index*(ROW+GAP);
    const region=(id,x,top,w,disabled,action)=>this.wristRegions.push({id,x,y:top,w,h:ROW,disabled,action});
    const button=(id,index,title,fill,ink,action,disabled=false,detail='')=>{const hover=this.wristHover===id&&!disabled;this.shape(ctx,X,y(index),WIDTH,ROW,22,disabled?C.locked:hover?(fill===C.accent?'#B7C0FF':C.selected):fill,hover?C.warm:fill===C.accent?null:C.line,3);this.text(ctx,title,240,y(index)+(detail?38:52),WIDTH-30,detail?27:30,disabled?C.faint:ink,{align:'center',weight:700});if(detail)this.text(ctx,detail,240,y(index)+66,WIDTH-30,19,disabled?C.faint:C.muted,{align:'center'});region(id,X,y(index),WIDTH,disabled,action);};
    const segments=(id,index,label,row,choices)=>{const top=y(index),labelWidth=130,width=(WIDTH-labelWidth)/choices.length;this.text(ctx,label,X+8,top+50,labelWidth-12,24,C.muted,{weight:700});
      choices.forEach(([value,title],i)=>{const key=id+':'+value,x=X+labelWidth+i*width,selected=row?.value===value,disabled=!row||row.disabled,hover=this.wristHover===key&&!disabled;this.shape(ctx,x+3,top,width-6,ROW,20,disabled?C.locked:selected?C.accent:hover?C.selected:C.surface,hover?C.warm:selected?null:C.line,3);this.text(ctx,title,x+width/2,top+51,width-16,27,disabled?C.faint:selected?C.ground:C.text,{align:'center',weight:700});region(key,x+3,top,width-6,disabled,()=>{if(!selected)this.bridge.dispatch(row,value);this.dirty=true;});});};
    button('panel',0,this.hidden?'Show panel':'Hide panel',C.accent,C.ground,()=>{this.hidden=!this.hidden;if(!this.hidden)this.recenter();});
    button('reposition',1,'Reposition avatar',C.surface,C.text,()=>{if(reposition)this.bridge.dispatch(reposition);this.dirty=true;},!reposition||reposition.disabled);
    segments('mode',2,'Mode',behavior,[['manual','Manual'],['puppet','Puppet']]);
    segments('collision',3,'Collide',collision,[['room','Room'],['floor','Floor']]);
    const ORDER=['off','planes','mesh','both','depth'],NAMES={off:'Off',planes:'Room setup',mesh:'Scanned mesh',both:'Setup + scan',depth:'Live depth'},current=ORDER.includes(occlusion?.value)?occlusion.value:'both',next=ORDER[(ORDER.indexOf(current)+1)%ORDER.length];
    button('occlusion',4,'Occlusion: '+NAMES[current]+'  \u203A',C.surface,C.text,()=>{if(occlusion)this.bridge.dispatch(occlusion,next);this.dirty=true;},!occlusion||occlusion.disabled,occlusionState);
    this.wrist.material.map.needsUpdate=true;
  }
  dispatch(row,value) {const live=this.liveRows?.get(row.key);return this.bridge.dispatch(live?.node||live?.type==='body'?live:row,value);}
  hit(input,frame,space) {
    if (!this.mesh?.visible||input?.targetRayMode!=='tracked-pointer') return null;
    const ray=this.ray(input,frame,space);if(!ray)return null;
    this.mesh.updateMatrixWorld(true);this.raycaster.set(ray.origin,ray.direction);
    const hit=this.raycaster.intersectObject(this.mesh)[0];if (!hit?.uv) return null;
    const x=hit.uv.x*W,y=(1-hit.uv.y)*H,region=[...this.regions].reverse().find(row=>x>=row.x&&x<=row.x+row.w&&y>=row.y&&y<=row.y+row.h);return {x,y,region,point:hit.point,distance:hit.distance};
  }
  wristHit(input,frame,space) {
    if(!this.wrist?.visible||input?.handedness!=='right')return null;const ray=this.ray(input,frame,space);if(!ray)return null;
    this.wrist.updateMatrixWorld(true);this.raycaster.set(ray.origin,ray.direction);const hit=this.raycaster.intersectObject(this.wrist)[0];if(!hit?.uv)return null;
    const x=hit.uv.x*480,y=(1-hit.uv.y)*480,region=(this.wristRegions||[]).find(row=>x>=row.x&&x<=row.x+row.w&&y>=row.y&&y<=row.y+row.h);return{region,point:hit.point};
  }
  ray(input,frame,space) {
    const pose=input?.targetRaySpace&&frame?.getPose?.(input.targetRaySpace,space),values=pose?.transform?.matrix;if(values?.length!==16||!Array.from(values).every(Number.isFinite))return null;
    const matrix=new THREE.Matrix4().fromArray(values),direction=new THREE.Vector3(0,0,-1).transformDirection(matrix);return direction.lengthSq()>.5?{origin:new THREE.Vector3().setFromMatrixPosition(matrix),direction}:null;
  }
  /** Shows the wrist menu above the left palm while the palm faces up (grip +X is the left palm normal). */
  placeWrist(frame,space,tracked,viewerPosition) {
    if(!this.wrist)return;const left=tracked.find(input=>input.handedness==='left'&&input.gripSpace);let pose=null;try{pose=left&&frame.getPose?.(left.gripSpace,space);}catch{pose=null;}
    const values=pose?.transform?.matrix;if(values?.length!==16||!Array.from(values).every(Number.isFinite)||!viewerPosition){this.wrist.visible=false;return;}
    const matrix=new THREE.Matrix4().fromArray(values),palm=new THREE.Vector3(1,0,0).transformDirection(matrix),origin=new THREE.Vector3().setFromMatrixPosition(matrix);
    const was=this.wrist.visible,show=palm.y>(was?.35:.55)&&!this.drag;this.wrist.visible=show;if(!show)return;
    this.wrist.position.copy(origin).addScaledVector(palm,.1);this.wrist.lookAt(viewerPosition);if(!was||this.dirty)this.drawWrist();
  }
  update(frame,space,seconds,{viewerPosition,inputSources}={}) {
    const consumedInputs=new Set();let anyHit=false,wristHover=null;if(!this.active)return{consumedInputs};this.space=space;if(this.cursor)this.cursor.visible=false;if(this.wristCursor)this.wristCursor.visible=false;
    if(!this.positioned&&viewerPosition){const p=viewerPosition,orientation=frame.getViewerPose?.(space)?.transform?.orientation;const forward=new THREE.Vector3(0,0,-1);if(orientation)forward.applyQuaternion(new THREE.Quaternion(orientation.x,orientation.y,orientation.z,orientation.w));forward.y=0;if(forward.lengthSq()<.01)forward.set(0,0,-1);forward.normalize();const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();this.mesh.position.copy(p).addScaledVector(forward,1.1).addScaledVector(right,-.75);this.mesh.position.y=p.y-.12;this.mesh.lookAt(p.x,this.mesh.position.y,p.z);this.positioned=true;}
    this.mesh.visible=this.positioned&&!this.hidden;
    const tracked=[...(inputSources||[])].filter(input=>input.targetRayMode==='tracked-pointer'),present=new Set(tracked);
    this.placeWrist(frame,space,tracked,viewerPosition);
    for(const [input]of this.entries)if(!present.has(input)){if(this.drag?.input===input)this.drag=null;this.entries.delete(input);}
    for(const input of tracked){const entry=this.entries.get(input)||{};this.entries.set(input,entry);const ray=this.ray(input,frame,space),standard=input.gamepad?.mapping==='xr-standard',trigger=standard&&!!input.gamepad.buttons?.[0]?.pressed,grip=standard&&!!input.gamepad.buttons?.[1]?.pressed;
      const wrist=this.drag?null:this.wristHit(input,frame,space);
      if(wrist){consumedInputs.add(input);wristHover=wrist.region?.id||null;this.wristCursor.position.copy(this.wrist.worldToLocal(wrist.point.clone()));this.wristCursor.position.z=.002;this.wristCursor.visible=true;entry.grip=grip;entry.trigger=trigger;continue;}
      const hit=this.hit(input,frame,space);
      if(hit){anyHit=true;consumedInputs.add(input);if(!this.cursor.visible){const key=hit.region?.key||null;if(this.hoverKey!==key){this.hoverKey=key;entry.hoverSince=seconds;this.dirty=true;}if(hit.region?.help&&key&&Number.isFinite(seconds)&&seconds-(entry.hoverSince??seconds)>.65&&this.helpKey!==key){this.helpKey=key;this.helpText=hit.region.help;this.dirty=true;}this.cursor.position.copy(this.mesh.worldToLocal(hit.point.clone()));this.cursor.position.z=.004;this.cursor.visible=true;}}
      if(trigger&&!entry.trigger)entry.suppressSelect=this.drag?.input===input;
      if(!this.drag&&DRAGGABLE.has(hit?.region?.kind)&&!hit.region.disabled&&trigger&&!entry.trigger){this.drag={input,button:'trigger',kind:'slider',region:hit.region,at:seconds,last:[hit.x,hit.y],sent:[hit.x,hit.y]};entry.suppressSelect=true;hit.region.action(hit.x,hit.y);this.dirty=true;consumedInputs.add(input);}
      if(!this.drag&&hit?.region?.kind==='handle'&&((trigger&&!entry.trigger)||(grip&&!entry.grip))){this.drag={input,button:trigger&&!entry.trigger?'trigger':'grip',distance:hit.distance,offset:this.mesh.position.clone().sub(hit.point)};if(this.drag.button==='trigger')entry.suppressSelect=true;consumedInputs.add(input);}
      if(this.drag?.input===input){consumedInputs.add(input);const held=this.drag.button==='trigger'?trigger:grip;
        if(this.drag.kind==='slider'){
          // Drags dispatch at most ten times a second; the final position is always sent on release.
          if(ray&&held){const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0,0,1).applyQuaternion(this.mesh.quaternion),this.mesh.position),point=new THREE.Ray(ray.origin,ray.direction).intersectPlane(plane,new THREE.Vector3());if(point){const local=this.mesh.worldToLocal(point);this.drag.last=[(local.x/.96+.5)*W,(.5-local.y/1.04)*H];}}
          const changed=this.drag.last[0]!==this.drag.sent[0]||this.drag.last[1]!==this.drag.sent[1];
          if(changed&&(!held||!ray||seconds-this.drag.at>.1)){this.drag.region.action(...this.drag.last);this.drag.sent=[...this.drag.last];this.drag.at=seconds;this.dirty=true;}
          if(!ray||!held)this.drag=null;
        }else if(!ray||!held)this.drag=null;else this.mesh.position.copy(ray.origin).addScaledVector(ray.direction,this.drag.distance).add(this.drag.offset);}
      entry.grip=grip;entry.trigger=trigger;
    }
    if(this.wristHover!==wristHover){this.wristHover=wristHover;if(this.wrist?.visible)this.drawWrist();}
    if(!anyHit&&(this.hoverKey||this.helpKey)){this.hoverKey=this.helpKey=this.helpText=null;this.dirty=true;}
    if(this.dirty&&(this.lastDraw===undefined||seconds-this.lastDraw>.05)){this.draw();this.lastDraw=seconds;}
    return{consumedInputs};
  }
  select(event,space=this.space) {
    if(!this.active||!event)return false;const entry=this.entries.get(event.inputSource);if(entry?.suppressSelect){entry.suppressSelect=false;return true;}if(this.drag?.input===event.inputSource)return true;
    const wrist=this.wristHit(event.inputSource,event.frame,space);if(wrist){if(wrist.region&&!wrist.region.disabled){wrist.region.action();this.wristSignature=null;this.drawWrist();this.dirty=true;}return true;}
    const hit=this.hit(event.inputSource,event.frame,space);if(!hit)return false;
    const region=hit.region;if(region&&!region.disabled&&region.action&&!DRAGGABLE.has(region.kind)&&region.kind!=='handle'){region.action(hit.x,hit.y);this.dirty=true;this.draw();}return true;
  }
  recenter() {if(this.active){this.drag=null;this.positioned=false;}}
  restore() {this.active=false;this.unobserve?.();this.unobserve=null;this.entries.clear();this.drag=null;this.hoverKey=null;this.helpKey=this.helpText=null;this.regions=[];this.wristRegions=[];this.snapshot=null;this.liveRows=null;this.signature=this.wristSignature=null;this.lastDraw=undefined;this.wristHover=null;this.lastColour=this.lastSlot=null;
    for(const name of ['mesh','wrist']){const mesh=this[name];if(!mesh)continue;this.scene.remove(mesh);for(const child of mesh.children){child.geometry.dispose();child.material.dispose();}mesh.geometry.dispose();mesh.material.map.dispose();mesh.material.dispose();this[name]=null;}
    this.cursor=this.wristCursor=null;this.canvas=this.wristCanvas=null;}
}
