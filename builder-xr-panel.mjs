import * as THREE from './libs/three/package/build/three.module.js';
import { hexRgb, rgbHex, rgbHsv, hsvRgb } from './builder-colour.mjs?v=a63afa0cf0f1';

const label = node => node.getAttribute('aria-label') || node.title || node.textContent.trim();
const shown = node => !node.closest('[hidden]');
const HELP = {
  'ar-behavior':'Manual: left stick walks and strafes; right stick turns. Follow: stays about 1.5 m from you. Puppet: tracked head and hands control the upper body while the legs play idle.',
  'ar-mirror':'Mirror swaps left and right like a reflection. Turn it off to move the same side of the avatar as your own hand.',
  'ar-calibrate':'Stand facing forward with both arms extended sideways in a T-pose. Press both thumbsticks together to calibrate your head and controller grip orientation. Recalibrate after changing avatar proportions.',
  'ar-collision':'Room uses scanned furniture and walls for collision and Follow routes. Floor only keeps the avatar on its placement floor and ignores room obstacles; it can pass through furniture and walls.',
  'ar-run-mode':'Click to toggle: press the left thumbstick once to run, again to walk. Hold to run: keep it pressed while moving.',
  'ar-crawl':'Enter or leave crawling. Move with the left stick; right stick turns. Standing again needs clear space above the avatar.',
  'ar-fly':'Hold right-stick forward in the stretch pose for 2 seconds to fly. Keep it forward to rise; pull back to descend. At the lowest floor height, hold back for 2 seconds to land. Left stick moves and strafes; right stick left/right turns.',
  'ar-sit':'Sit on a scanned seat, or the floor. Hold crouch still for 2 seconds to sit on the floor. Right stick forward stands up.',
  'ar-size':'Change the avatar size while keeping its feet on the floor. Bigger avatars need more room around and above them.',
  'ar-seat-height':'Set the chair height when no scanned seat is available.',
  'ar-reposition':'Pick a new floor location with the controller placement ring, then press the trigger.',
  'ar-walk':'Stop the current walking destination. Left stick also gives you manual control.',
  'ar-exit':'Leave the immersive scene and return to the browser.',
  'a-pose':'Freeze or resume the avatar in its reference A-pose.',
  'idle':'Play or pause idle animation.',
  'wire':'Show the mesh edges over the avatar.',
  'cuts':'Show which body areas are hidden by the selected garments.',
  'preview-level':'Limit choices to this preview level. Follow the same available-choice rules as the creator.',
  'random-avatar':'Randomize using the currently available choices and creator rules.'
};
const describe = node => ({ key: node.dataset.focusKey || node.id || label(node), label: label(node), node, disabled: node.disabled, selected: node.getAttribute('aria-pressed') === 'true' || !!node.checked, image: node.querySelector('img:not([hidden])'), colour: node.style.background || '', type: node.tagName==='SELECT'?'select':node.type === 'range' ? 'range' : 'button', value: node.tagName==='SELECT'?node.value:Number(node.value), options:node.tagName==='SELECT'?[...node.options].filter(option=>!option.disabled).map(option=>({value:option.value,label:option.textContent})):null, min: Number(node.min), max: Number(node.max), step: Number(node.step) || 1, help:HELP[node.id]||node.getAttribute('aria-description')||node.title||'' });

/** Mirrors live creator controls; native DOM handlers retain ownership of choices and rewards. */
export function creatorPanelBridge(document, bodyType) {
  const id = name => document.getElementById(name);
  const button = node => node && describe(node);
  return {
    observe(changed) { const text=new Map(['ar-hint','ar-room-status'].map(key=>[key,id(key)?.textContent]));const observer=new MutationObserver(records=>{if(records.some(record=>{if(record.type==='attributes'&&record.oldValue===record.target.getAttribute(record.attributeName))return false;const node=record.target.nodeType===3?record.target.parentElement:record.target;const status=node.closest?.('#ar-hint,#ar-room-status');if(status){const previous=text.get(status.id);text.set(status.id,status.textContent);return previous!==status.textContent;}return true;}))changed();});for(const node of document.querySelectorAll('#builder-groups,#builder-controls,#colour-tabs,#colour-picker,#colour-extra,#creator-status,#preview-level-label,.family-switch,.preview-tools,#ar-controls'))observer.observe(node,{childList:true,subtree:true,attributes:true,attributeOldValue:true,characterData:true});return()=>observer.disconnect(); },
    tab(view) { const node = id(view === 'colours' ? 'colour-heading' : 'tiles-heading'); if (node && !node.disabled && (view !== 'colours' || node.getAttribute('aria-expanded') !== 'true')) node.click(); },
    snapshot(view) {
      const roots = view === 'colours' ? ['colour-tabs','colour-extra'] : view === 'scene' ? [] : ['builder-controls'];
      const controls = roots.flatMap(name => [...(id(name)?.querySelectorAll('button,input[type="range"]') || [])].filter(shown).map(describe));
      if (view === 'customize') for (const search of id('builder-controls')?.querySelectorAll('input[type="search"]') || []) if (shown(search) && search.value) controls.unshift({ key:'clear:'+search.getAttribute('aria-label'), label:'Clear search: '+search.value, type:'clear', node:search });
      if (view === 'colours') {
        const field = id('colour-picker')?.querySelector('input[aria-label$=" HEX"]');
        if (field && shown(field)) { const rgb=hexRgb(field.value),hsv=rgbHsv(rgb);for(let channel=2;channel>=0;channel--)controls.unshift({key:'rgb:'+channel,label:['Red','Green','Blue'][channel],type:'rgb',node:field,channel,value:Math.round(rgb[channel]*255),min:0,max:255,step:1,disabled:field.disabled}); for (let channel=2;channel>=0;channel--) controls.unshift({key:'hsv:'+channel,label:['Hue','Saturation','Brightness'][channel],type:'hsv',node:field,channel,value:Math.round(hsv[channel]*(channel===0?360:100)),min:0,max:channel===0?360:100,step:1,disabled:field.disabled}); }
      }
      if (view === 'scene') {
        controls.push(...['ar-behavior','ar-mirror','ar-calibrate','ar-run-mode','ar-collision','ar-crawl','ar-fly','ar-sit','ar-walk','ar-reposition','ar-size','ar-seat-height','ar-turn','random-avatar','a-pose','idle','wire','cuts','reset-config','preview-level','ar-exit'].map(id).filter(node => node && (node.id.startsWith('ar-') || shown(node))).map(node => ({...describe(node), disabled:node.disabled || node.id==='ar-seat-height'&&!!id('ar-seat-height-control')?.hidden, label:node.id==='ar-mirror'?'Mirror puppet':node.id==='preview-level'?'Preview level · '+id('preview-level-label').textContent:node.id==='ar-size'?'Avatar size':node.id==='ar-seat-height'?'Fallback seat height':node.id==='idle'?'Idle animation':node.id==='wire'?'Wireframe':node.id==='cuts'?'Coverage overlay':label(node)})));
      }
      const type=bodyType();
      return { title:id('detail-title')?.textContent || 'Avatar', colourOnly:!!id('tiles-card')?.hidden&&!id('colour-card')?.hidden, status:id('creator-status')?.textContent || '', roomStatus:id('ar-room-status')?.textContent || '', hint:id('ar-hint')?.textContent || '', global:[...document.querySelectorAll('[data-family]')].map(describe).concat(['male','female'].map(value=>({key:'body:'+value,label:value==='male'?'Male':'Female',type:'body',value,selected:type.value===value,disabled:!type.allowed}))), groups:[...(id('builder-groups')?.querySelectorAll('button') || [])].map(node=>({...describe(node),label:node.querySelector('.nav-title')?.textContent || label(node)})), controls };
    },
    dispatch(row, value) {
      if (row.disabled) return false;
      if (row.type==='body') { const current=bodyType(); if (!current.allowed) return false; current.change(row.value); return true; }
      const node=row.node;
      if (!node?.isConnected || node.disabled) return false;
      if (row.type==='clear') { node.value=''; node.dispatchEvent(new Event('input',{bubbles:true})); return true; }
      if(row.type==='rgb'){if(!/^#[0-9a-f]{6}$/i.test(node.value))return false;const rgb=hexRgb(node.value);rgb[row.channel]=THREE.MathUtils.clamp(Math.round(value),0,255)/255;node.value=rgbHex(rgb);node.dispatchEvent(new Event('change',{bubbles:true}));return true;}
      if (row.type==='hsv') { if (!/^#[0-9a-f]{6}$/i.test(node.value)) return false; const hsv=rgbHsv(hexRgb(node.value));hsv[row.channel]=THREE.MathUtils.clamp(value,row.min,row.max)/row.max;node.value=rgbHex(hsvRgb(...hsv));node.dispatchEvent(new Event('change',{bubbles:true}));return true; }
      if(row.type==='select'){const options=[...node.options].filter(option=>!option.disabled),index=options.findIndex(option=>option.value===node.value);const option=value===undefined?options[(index+1)%options.length]:options.find(option=>option.value===value);if(!option)return false;node.value=option.value;node.dispatchEvent(new Event('change',{bubbles:true}));return true;}
      if (row.type==='range') { if(!Number.isFinite(value))return false;const min=Number(node.min),max=Number(node.max),step=Number(node.step)||1;node.value=Math.max(min,Math.min(max,min+Math.round((value-min)/step)*step));node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));return true; }
      node.click();return true;
    }
  };
}

/** A room-pinned canvas mesh with native creator bindings and controller ray input. */
export class XRConfiguratorPanel {
  constructor(scene, bridge) { this.scene=scene;this.bridge=bridge;this.raycaster=new THREE.Raycaster();this.entries=new Map();this.view='customize';this.page=0;this.groupPage=0;this.dirty=true;this.regions=[]; }
  start() {
    this.restore();this.active=true;this.view='customize';this.page=0;this.groupPage=0;this.sceneSection='companion';this.filter='all';this.hoverKey=null;this.helpKey=null;this.helpPinned=false;this.positioned=false;this.dirty=true;
    this.canvas=document.createElement('canvas');this.canvas.width=1200;this.canvas.height=1300;
    const texture=new THREE.CanvasTexture(this.canvas);texture.colorSpace=THREE.SRGBColorSpace;
    this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(.96,1.04),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
    this.cursor=new THREE.Mesh(new THREE.RingGeometry(.006,.009,20),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));this.cursor.visible=false;this.cursor.renderOrder=10001;this.mesh.renderOrder=10000;this.mesh.add(this.cursor);
    this.mesh.visible=false;this.mesh.name='AviRev configurator';this.scene.add(this.mesh);this.unobserve=this.bridge.observe?.(()=>{this.dirty=true;});this.draw();
  }
  draw() {
    if (!this.active) return;
    const state=this.bridge.snapshot(this.view);this.snapshot=state;this.liveRows=new Map([...state.global,...state.groups,...state.controls].map(row=>[row.key,row]));
    const signature=JSON.stringify([this.view,this.page,this.groupPage,this.sceneSection,this.filter,this.hoverKey,this.helpKey,this.helpPinned,state.title,state.status,state.roomStatus,state.hint,[...this.liveRows.values()].map(row=>[row.key,row.label,row.type,row.value,row.min,row.max,row.disabled,row.selected,row.colour,row.image?.currentSrc,row.image?.complete,row.image?.naturalWidth])]);
    if(signature===this.signature){this.dirty=false;return;}this.signature=signature;
    const ctx=this.canvas.getContext('2d'),regions=[],palette={background:'#20242d',rail:'#171c25',card:'#323947',selected:'#485dac',text:'#f0f3ff',muted:'#bcc6dc',disabled:'#939bb0',accent:'#9dabff'};
    ctx.fillStyle=palette.background;ctx.fillRect(0,0,1200,1300);ctx.fillStyle=palette.rail;ctx.fillRect(0,318,320,770);ctx.fillStyle=palette.accent;ctx.fillRect(0,0,1200,6);
    const text=(str,x,y,width,font='29px system-ui',colour=palette.text,maxLines=2)=>{ctx.font=font;ctx.fillStyle=colour;let line='',yy=y,lines=0;for(let word of String(str).split(/\s+/)){if(ctx.measureText(word).width>width){while(word.length&&ctx.measureText(word+'…').width>width)word=word.slice(0,-1);word+='…';}if(ctx.measureText(line+word).width>width&&line){if(lines===maxLines-1){while(line.length&&ctx.measureText(line+'…').width>width)line=line.slice(0,-1);ctx.fillText(line.trim()+'…',x,yy);return;}ctx.fillText(line,x,yy);yy+=34;line='';lines++;}line+=word+' ';}ctx.fillText(line,x,yy);};
    const rect=(row,x,y,w,h,action,kind='button')=>{ctx.fillStyle=row.selected?palette.selected:row.disabled?'#282c36':palette.card;ctx.fillRect(x,y,w,h);if(this.hoverKey===row.key){ctx.strokeStyle=palette.accent;ctx.lineWidth=4;ctx.strokeRect(x+2,y+2,w-4,h-4);}if(row.colour){ctx.fillStyle=row.colour;ctx.fillRect(x+16,y+16,48,h-32);}if(row.image?.complete&&row.image.naturalWidth){try{ctx.drawImage(row.image,x+12,y+12,h-24,h-24);}catch{}}const inset=row.image?.complete?h:row.colour?80:22;text(row.label,x+inset,y+40,w-inset-18,'28px system-ui',row.disabled?palette.disabled:palette.text);regions.push({x,y,w,h,row,action,kind});return regions.at(-1);};
    const helpFor=row=>row.help||(['range','hsv','rgb'].includes(row.type)?'Hold the trigger and drag across the wide track. Use minus or plus for one precise step.':'Point at a choice and press the trigger to select it.');
    const showHelp=(row,pinned=false)=>{this.helpKey=row.key;this.helpPinned=pinned;this.dirty=true;};
    text('AviRev',28,64,500,'bold 44px system-ui');text('Your avatar, in your room',620,63,550,'28px system-ui',palette.muted);
    text(state.hint||'Point + trigger to edit. Hold trigger on a slider to drag.',28,116,1140,'26px system-ui',palette.muted);
    state.global.forEach((row,index)=>rect(row,28+index*286,151,270,68,()=>this.dispatch(row)));
    for(const [index,view] of ['customize','colours','scene'].entries())rect({key:'tab:'+view,label:view==='customize'?'Customize':view==='colours'?'Colours':'Scene',selected:this.view===view},28+index*386,239,370,68,()=>{this.view=view;this.page=0;this.filter='all';this.helpPinned=false;this.helpKey=null;this.bridge.tab?.(view);this.dirty=true;});
    let controls=state.controls;
    if(this.view==='scene'){
      const sections={companion:['ar-behavior','ar-mirror','ar-calibrate','ar-run-mode','ar-collision'],movement:['ar-crawl','ar-fly','ar-sit','ar-walk'],placement:['ar-size','ar-seat-height','ar-turn','ar-reposition','ar-exit'],preview:['random-avatar','a-pose','idle','wire','cuts','reset-config','preview-level']};
      this.sceneSection ||= 'companion';controls=controls.filter(row=>sections[this.sceneSection].includes(row.key));
      for(const[index,[section,title]]of Object.entries({companion:'Modes & controls',movement:'Movement & poses',placement:'Placement & size',preview:'Preview'}).entries())rect({key:'section:'+section,label:title,selected:this.sceneSection===section},24,348+index*128,272,108,()=>{this.sceneSection=section;this.page=0;this.helpKey=null;this.helpPinned=false;this.dirty=true;});
      text('LEFT STICK',28,921,260,'bold 26px system-ui',palette.accent);text('Walk / strafe',28,960,260,'26px system-ui');text('RIGHT STICK',28,1010,260,'bold 26px system-ui',palette.accent);text('Turn / pose',28,1049,260,'26px system-ui');
    }else{
      const maxGroup=Math.max(0,Math.ceil(state.groups.length/6)-1);this.groupPage=Math.min(this.groupPage,maxGroup);
      state.groups.slice(this.groupPage*6,this.groupPage*6+6).forEach((row,index)=>rect(row,24,348+index*106,272,90,()=>{this.dispatch(row);this.page=0;this.filter='all';this.helpKey=null;this.helpPinned=false;this.view=this.bridge.snapshot('customize').colourOnly?'colours':'customize';this.bridge.tab?.(this.view);this.dirty=true;}));
      rect({key:'groups:previous',label:'Previous',disabled:this.groupPage===0},24,1000,130,68,()=>{this.groupPage--;this.dirty=true;});rect({key:'groups:next',label:'Next',disabled:this.groupPage===maxGroup},168,1000,128,68,()=>{this.groupPage++;this.dirty=true;});
    }
    const sectionTitle=this.view==='scene'?({companion:'Modes & controls',movement:'Movement & poses',placement:'Placement & size',preview:'Preview'}[this.sceneSection]):this.view==='colours'?'Colour slots & palettes':state.title;
    text(sectionTitle,348,363,this.view==='scene'?800:540,'bold 34px system-ui');
    if(this.view!=='scene'){this.filter ||= 'all';rect({key:'filter',label:{all:'All choices',available:'Available',selected:'Selected'}[this.filter]},930,327,218,54,()=>{this.filter={all:'available',available:'selected',selected:'all'}[this.filter];this.page=0;this.dirty=true;});controls=controls.filter(row=>['range','hsv','rgb','clear'].includes(row.type)||this.filter==='all'||(this.filter==='available'?!row.disabled:row.selected));}
    const hasRanges=controls.some(row=>['range','hsv','rgb'].includes(row.type)),pageSize=hasRanges?6:8,maxPage=Math.max(0,Math.ceil(controls.length/pageSize)-1);this.page=Math.min(this.page,maxPage);
    controls.slice(this.page*pageSize,this.page*pageSize+pageSize).forEach((row,index)=>{
      const x=348+(hasRanges?0:(index%2)*410),y=394+(hasRanges?index*112:Math.floor(index/2)*164),w=hasRanges?800:390,h=hasRanges?100:148;
      if(['range','hsv','rgb'].includes(row.type)){
        rect({...row,label:''},x,y,w,h,null,'range-row');text(row.label+' · '+row.value,x+22,y+39,w-110,'28px system-ui',row.disabled?palette.disabled:palette.text);
        const trackX=x+100,trackW=w-200,trackY=y+46,trackH=48,ratio=THREE.MathUtils.clamp((row.value-row.min)/(row.max-row.min||1),0,1);
        ctx.fillStyle='#253040';ctx.fillRect(trackX,trackY,trackW,trackH);ctx.fillStyle='#8094ef';ctx.fillRect(trackX,trackY,trackW*ratio,trackH);ctx.fillStyle=palette.text;ctx.fillRect(trackX+trackW*ratio-5,trackY,10,trackH);
        regions.push({x:trackX,y:trackY,w:trackW,h:trackH,row,kind:'range',action:px=>this.dispatch(row,row.min+(row.max-row.min)*THREE.MathUtils.clamp((px-trackX)/trackW,0,1))});
        rect({...row,key:row.key+':minus',controlKey:row.key,label:'−',selected:false},x+14,y+44,72,52,()=>this.dispatch(row,row.value-row.step),'step');rect({...row,key:row.key+':plus',controlKey:row.key,label:'+',selected:false},x+w-86,y+44,72,52,()=>this.dispatch(row,row.value+row.step),'step');
        regions.push({x:x+w-68,y:y+4,w:64,h:44,row,kind:'help',action:()=>showHelp(row,true)});text('?',x+w-48,y+33,40,'bold 28px system-ui',palette.accent);
      }else{
        let display=row.label;
        if(row.type==='select')display+=': '+(row.options?.find(option=>option.value===row.value)?.label||row.value)+' ›';else if(row.node?.type==='checkbox')display+=(row.selected?' · On':' · Off');
        rect({...row,label:display},x,y,w,h,()=>this.dispatch(row));
        text(row.type==='select'?'Press to change':row.selected?'Selected':'Press to select',x+22,y+h-25,w-92,'23px system-ui',palette.muted);
        regions.push({x:x+w-76,y:y+h-76,w:68,h:68,row,kind:'help',action:()=>showHelp(row,true)});text('?',x+w-51,y+h-35,44,'bold 32px system-ui',palette.accent);
      }
    });
    if(!controls.length)text('No controls are available in this category.',348,465,800,'29px system-ui',palette.muted);
    rect({key:'page:previous',label:'Previous',disabled:this.page===0},348,1062,250,64,()=>{this.page--;this.helpPinned=false;this.dirty=true;});text((this.page+1)+' / '+(maxPage+1),678,1106,180,'28px system-ui',palette.muted);rect({key:'page:next',label:'Next',disabled:this.page===maxPage},896,1062,250,64,()=>{this.page++;this.helpPinned=false;this.dirty=true;});
    const help=this.liveRows.get(this.helpKey);text(help?helpFor(help):state.roomStatus||state.status||'Point at a control for a tip. Press ? for full help.',28,1166,1140,'25px system-ui',palette.muted,2);
    if(this.helpPinned&&help){
      ctx.fillStyle=palette.rail;ctx.fillRect(340,386,828,660);ctx.strokeStyle=palette.accent;ctx.lineWidth=3;ctx.strokeRect(340,386,828,660);text(help.label,374,440,720,'bold 34px system-ui');text(helpFor(help),374,512,744,'30px system-ui',palette.text,12);rect({key:'help:close',label:'Back to controls'},374,929,744,80,()=>{this.helpPinned=false;this.dirty=true;});
      regions.splice(0,regions.length,...regions.filter(region=>region.y<318||region.x<320||region.row?.key==='help:close'));
    }
    ctx.fillStyle=palette.selected;ctx.fillRect(28,1224,1144,68);ctx.fillStyle=palette.accent;ctx.fillRect(500,1234,200,5);text('Hold trigger or grip here to move the panel · Y recalls it',64,1274,1070,'27px system-ui');regions.push({x:28,y:1224,w:1144,h:68,kind:'handle'});
    this.regions=regions;this.mesh.material.map.needsUpdate=true;this.dirty=false;
  }
  dispatch(row,value) {const live=this.liveRows?.get(row.key);return live?this.bridge.dispatch(live,value):false;}
  hit(input,frame,space) {
    if (!this.mesh?.visible||input?.targetRayMode!=='tracked-pointer') return null;
    const ray=this.ray(input,frame,space);if(!ray)return null;
    this.mesh.updateMatrixWorld(true);this.raycaster.set(ray.origin,ray.direction);
    const hit=this.raycaster.intersectObject(this.mesh)[0];if (!hit?.uv) return null;
    const x=hit.uv.x*1200,y=(1-hit.uv.y)*1300,region=[...this.regions].reverse().find(row=>row.kind!=='range-row'&&x>=row.x&&x<=row.x+row.w&&y>=row.y&&y<=row.y+row.h);return {x,y,region,point:hit.point,distance:hit.distance};
  }
  ray(input,frame,space) {
    const pose=input?.targetRaySpace&&frame?.getPose?.(input.targetRaySpace,space),values=pose?.transform?.matrix;if(values?.length!==16||!values.every(Number.isFinite))return null;
    const matrix=new THREE.Matrix4().fromArray(values),direction=new THREE.Vector3(0,0,-1).transformDirection(matrix);return direction.lengthSq()>.5?{origin:new THREE.Vector3().setFromMatrixPosition(matrix),direction}:null;
  }
  update(frame,space,seconds,{viewerPosition,inputSources}={}) {
    const consumedInputs=new Set();let anyHit=false;if(!this.active)return{consumedInputs};this.space=space;if(this.cursor)this.cursor.visible=false;
    if(!this.positioned&&viewerPosition){const p=viewerPosition,orientation=frame.getViewerPose?.(space)?.transform?.orientation;const forward=new THREE.Vector3(0,0,-1);if(orientation)forward.applyQuaternion(new THREE.Quaternion(orientation.x,orientation.y,orientation.z,orientation.w));forward.y=0;if(forward.lengthSq()<.01)forward.set(0,0,-1);forward.normalize();const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();this.mesh.position.copy(p).addScaledVector(forward,1.1).addScaledVector(right,-.75);this.mesh.position.y=p.y-.12;this.mesh.lookAt(p.x,this.mesh.position.y,p.z);this.mesh.visible=true;this.positioned=true;}
    const tracked=[...(inputSources||[])].filter(input=>input.targetRayMode==='tracked-pointer'),present=new Set(tracked);
    for(const [input,entry]of this.entries)if(!present.has(input)){if(this.drag?.input===input)this.drag=null;this.entries.delete(input);}
    for(const input of tracked){const entry=this.entries.get(input)||{};this.entries.set(input,entry);const ray=this.ray(input,frame,space),hit=this.hit(input,frame,space),standard=input.gamepad?.mapping==='xr-standard',trigger=standard&&!!input.gamepad.buttons?.[0]?.pressed,grip=standard&&!!input.gamepad.buttons?.[1]?.pressed;
      if(hit){anyHit=true;consumedInputs.add(input);if(!this.cursor.visible){const key=hit.region?.row?.key,helpKey=hit.region?.row?.controlKey||key;if(this.hoverKey!==key){this.hoverKey=key;entry.hoverSince=seconds;this.dirty=true;}if(!this.helpPinned&&key&&Number.isFinite(seconds)&&seconds-(entry.hoverSince??seconds)>.65&&this.helpKey!==helpKey){this.helpKey=helpKey;this.dirty=true;}this.cursor.position.copy(this.mesh.worldToLocal(hit.point.clone()));this.cursor.position.z=.004;this.cursor.visible=true;}}
      if(trigger&&!entry.trigger)entry.suppressSelect=this.drag?.input===input;
      if(!this.drag&&hit?.region?.kind==='range'&&!hit.region.row.disabled&&trigger&&!entry.trigger){this.drag={input,button:'trigger',kind:'slider',key:hit.region.row.key,region:hit.region};entry.suppressSelect=true;hit.region.action(hit.x);this.dirty=true;consumedInputs.add(input);}
      if(!this.drag&&hit?.region?.kind==='handle'&&((trigger&&!entry.trigger)||(grip&&!entry.grip))){this.drag={input,button:trigger&&!entry.trigger?'trigger':'grip',distance:hit.distance,offset:this.mesh.position.clone().sub(hit.point)};if(this.drag.button==='trigger')entry.suppressSelect=true;consumedInputs.add(input);}
      if(this.drag?.input===input){consumedInputs.add(input);if(!ray||!(this.drag.button==='trigger'?trigger:grip))this.drag=null;else if(this.drag.kind==='slider'){const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0,0,1).applyQuaternion(this.mesh.quaternion),this.mesh.position),point=new THREE.Ray(ray.origin,ray.direction).intersectPlane(plane,new THREE.Vector3());if(point){const local=this.mesh.worldToLocal(point);this.drag.region.action((local.x/.96+.5)*1200);this.dirty=true;}}else this.mesh.position.copy(ray.origin).addScaledVector(ray.direction,this.drag.distance).add(this.drag.offset);}
      entry.grip=grip;entry.trigger=trigger;
    }
    if(!anyHit&&this.hoverKey){this.hoverKey=null;this.dirty=true;}
    if(this.dirty&&(this.lastDraw===undefined||seconds-this.lastDraw>.05)){this.draw();this.lastDraw=seconds;}
    return{consumedInputs};
  }
  select(event,space=this.space) {
    if(!this.active||!event)return false;const entry=this.entries.get(event.inputSource);if(entry?.suppressSelect){entry.suppressSelect=false;return true;}if(this.drag?.input===event.inputSource)return true;const hit=this.hit(event.inputSource,event.frame,space);if(!hit)return false;
    const row=hit.region;if(row&&(row.kind==='help'||!row.row?.disabled)&&row.action){row.action(hit.x,hit.y);this.dirty=true;this.draw();}return true;
  }
  recenter() {if(this.active){this.drag=null;this.positioned=false;}}
  restore() {this.active=false;this.unobserve?.();this.unobserve=null;this.entries.clear();this.drag=null;this.hoverKey=null;this.helpKey=null;this.helpPinned=false;this.regions=[];this.snapshot=null;this.liveRows=null;this.signature=null;this.lastDraw=undefined;if(this.mesh){this.scene.remove(this.mesh);this.cursor?.geometry.dispose();this.cursor?.material.dispose();this.cursor=null;this.mesh.geometry.dispose();this.mesh.material.map.dispose();this.mesh.material.dispose();this.mesh=null;}this.canvas=null;}
}
