const clamp = value => Math.min(1, Math.max(0, value));
const hueUnit = value => ((value % 1) + 1) % 1;
export const rgbHex = rgb => '#' + rgb.map(value => Math.round(clamp(value) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
export const hexRgb = hex => hex.slice(1).match(/../g).slice(0, 3).map(value => parseInt(value, 16) / 255);
export function hsvRgb(h, s, v) {
  h = hueUnit(h) * 6; s = clamp(s); v = clamp(v);
  const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
  return (h < 1 ? [c,x,0] : h < 2 ? [x,c,0] : h < 3 ? [0,c,x] : h < 4 ? [0,x,c] : h < 5 ? [x,0,c] : [c,0,x]).map(value => value + m);
}
export function rgbHsv(rgb) {
  const [r,g,b] = rgb, max = Math.max(...rgb), min = Math.min(...rgb), c = max - min;
  const h = !c ? 0 : max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return [h / 6, max ? c / max : 0, max];
}
export function hslRgb(h, s, l) {
  h = hueUnit(h) * 6; s = clamp(s); l = clamp(l);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2;
  return (h < 1 ? [c,x,0] : h < 2 ? [x,c,0] : h < 3 ? [0,c,x] : h < 4 ? [0,x,c] : h < 5 ? [x,0,c] : [c,0,x]).map(value => value + m);
}
export function rgbHsl(rgb) {
  const [h] = rgbHsv(rgb), max = Math.max(...rgb), min = Math.min(...rgb), c = max - min, l = (max + min) / 2;
  return [h, c ? c / (1 - Math.abs(2 * l - 1)) : 0, l];
}
const names = { red:'#FF0000',cyan:'#00FFFF',aqua:'#00FFFF',blue:'#0000FF',darkblue:'#00008B',lightblue:'#ADD8E6',purple:'#800080',yellow:'#FFFF00',lime:'#00FF00',fuchsia:'#FF00FF',magenta:'#FF00FF',white:'#FFFFFF',silver:'#C0C0C0',grey:'#808080',gray:'#808080',black:'#000000',orange:'#FFA500',brown:'#A52A2A',maroon:'#800000',green:'#008000',olive:'#808000',navy:'#000080',teal:'#008080' };
export function parseColour(text) {
  const s = String(text).trim();
  if (/^#?[\da-f]{3,4}$|^#?[\da-f]{6}([\da-f]{2})?$/i.test(s)) { const hex = s.replace('#',''); return '#' + (hex.length < 5 ? [...hex.slice(0,3)].map(value=>value+value).join('') : hex.slice(0,6)).toUpperCase(); }
  const rgb = s.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i);
  if (rgb) return rgbHex(rgb.slice(1,4).map(value=>Math.min(255, Number(value))/255));
  const hsl = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i);
  if (hsl && hsl.slice(1).every(value=>Number.isFinite(Number(value)))) return rgbHex(hslRgb(Number(hsl[1])/360, Number(hsl[2])/100, Number(hsl[3])/100));
  return names[s.toLowerCase()] || null;
}
export function wheelPoint(x, y, radius) {
  const dx = x - radius, dy = y - radius, distance = Math.hypot(dx,dy);
  return { hue: distance > .0001 ? hueUnit(Math.atan2(dy,dx)/(2*Math.PI)) : 0, saturation: radius > 0 ? clamp(distance/radius) : 0, inside: distance <= radius + .001 };
}
const recent = [];
const node = (tag, value, cls) => { const element = document.createElement(tag); if (value !== undefined) element.textContent = value; if (cls) element.className = cls; return element; };
export class ColourPicker {
  constructor(parent, value, onChange, label = 'Colour') {
    this.onChange = onChange; this.root = node('div', undefined, 'colour-picker'); parent.replaceChildren(this.root);
    const stage = node('div', undefined, 'wheel-side'), side = node('div', undefined, 'colour-side'); this.root.append(stage,side);
    this.wheel = node('div', undefined, 'colour-wheel'); this.wheel.tabIndex=0; this.wheel.setAttribute('role','slider'); this.wheel.setAttribute('aria-label',label+' hue and saturation'); this.wheel.setAttribute('aria-valuemin','0'); this.wheel.setAttribute('aria-valuemax','360');
    this.dim=node('div',undefined,'wheel-dim');this.marker=node('div',undefined,'wheel-marker');this.wheel.append(this.dim,this.marker);stage.append(this.wheel);
    const brightnessLabel=node('label',undefined,'brightness-label');brightnessLabel.append(node('span','Brightness'));this.brightnessValue=node('output');brightnessLabel.append(this.brightnessValue);this.brightness=node('input',undefined,'brightness');this.brightness.type='range';this.brightness.min=0;this.brightness.max=100;this.brightness.step=1;this.brightness.setAttribute('aria-label',label+' brightness');stage.append(brightnessLabel,this.brightness);
    this.preview=node('div',undefined,'colour-preview');this.readout=node('p',undefined,'colour-readout');side.append(this.preview,this.readout);this.fields={};
    for(const caption of ['HEX','RGB','HSL']){const row=node('label',undefined,'colour-field'),input=node('input');row.append(node('span',caption),input);input.setAttribute('aria-label',label+' '+caption);input.spellcheck=false;this.fields[caption]=input;side.append(row);const commit=()=>{const parsed=parseColour(input.value);if(parsed){this.error.textContent='';input.removeAttribute('aria-invalid');this.setValue(parsed,this.hex!==parsed);this.remember();}else{input.setAttribute('aria-invalid','true');this.error.textContent='Use a hex, rgb() or hsl() colour.';}};input.onchange=commit;input.onblur=commit;input.onkeydown=event=>{if(event.key==='Enter'||event.key==='Tab'){commit();if(event.key==='Enter')event.preventDefault();}};}
    this.error=node('p',undefined,'colour-error');this.error.setAttribute('role','alert');side.append(this.error,node('p','RECENT','recent-label'));this.recent=node('div',undefined,'recent-colours');side.append(this.recent);
    const point=event=>{const bounds=this.wheel.getBoundingClientRect();return wheelPoint((event.clientX-bounds.left)/bounds.width*240,(event.clientY-bounds.top)/bounds.height*240,120);};
    const move=event=>{const p=point(event);this.h=p.hue;this.s=p.saturation;this.emit();};
    this.wheel.onpointerdown=event=>{if(!point(event).inside)return;event.preventDefault();this.wheel.setPointerCapture(event.pointerId);move(event);};
    this.wheel.onpointermove=event=>{if(this.wheel.hasPointerCapture(event.pointerId))move(event);};
    this.wheel.onpointerup=event=>{if(this.wheel.hasPointerCapture(event.pointerId)){this.wheel.releasePointerCapture(event.pointerId);this.remember();}};
    this.wheel.onkeydown=event=>{const amount=event.shiftKey?10:1;if(event.key==='ArrowRight')this.h=hueUnit(this.h+amount/360);else if(event.key==='ArrowLeft')this.h=hueUnit(this.h-amount/360);else if(event.key==='ArrowUp')this.s=clamp(this.s+amount/100);else if(event.key==='ArrowDown')this.s=clamp(this.s-amount/100);else return;event.preventDefault();this.emit();this.remember();};
    this.brightness.oninput=()=>{this.v=Number(this.brightness.value)/100;this.emit();};this.brightness.onchange=()=>this.remember();this.setValue(value);this.drawRecent();
  }
  setValue(value, notify=false){this.hex=parseColour(value)||'#FFFFFF';[this.h,this.s,this.v]=rgbHsv(hexRgb(this.hex));this.draw();if(notify)this.onChange(this.hex);}
  emit(){this.hex=rgbHex(hsvRgb(this.h,this.s,this.v));this.draw();this.onChange(this.hex);}
  draw(){const rgb=hexRgb(this.hex),hsl=rgbHsl(rgb);this.preview.style.background=this.hex;this.readout.textContent=this.hex;this.dim.style.opacity=1-this.v;this.marker.style.left=(50+Math.cos(this.h*2*Math.PI)*this.s*50)+'%';this.marker.style.top=(50+Math.sin(this.h*2*Math.PI)*this.s*50)+'%';this.wheel.setAttribute('aria-valuenow',Math.round(this.h*360));this.wheel.setAttribute('aria-valuetext',Math.round(this.h*360)+' degrees, '+Math.round(this.s*100)+'% saturation');this.brightness.value=Math.round(this.v*100);this.brightnessValue.textContent=Math.round(this.v*100)+'%';this.brightness.style.background='linear-gradient(to right,#000,'+rgbHex(hsvRgb(this.h,this.s,1))+')';const values={HEX:this.hex,RGB:'rgb('+rgb.map(v=>Math.round(v*255)).join(', ')+')',HSL:'hsl('+Math.round(hsl[0]*360)%360+', '+Math.round(hsl[1]*100)+'%, '+Math.round(hsl[2]*100)+'%)'};for(const [key,input]of Object.entries(this.fields))if(document.activeElement!==input)input.value=values[key];}
  remember(){const index=recent.indexOf(this.hex);if(index>=0)recent.splice(index,1);recent.unshift(this.hex);recent.length=Math.min(recent.length,16);this.drawRecent();}
  drawRecent(){this.recent.replaceChildren();for(const hex of recent){const swatch=node('button');swatch.type='button';swatch.style.background=hex;swatch.title=hex;swatch.setAttribute('aria-label','Use recent '+hex);swatch.onclick=()=>{this.setValue(hex,true);this.remember();};this.recent.append(swatch);}}
}
