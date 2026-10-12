export const XR_HELP_LAYOUT = Object.freeze({ canvasWidth:960, canvasHeight:600, width:.25, height:.15625, hideAfterSeconds:6 });

export function xrHelpContent(state={}) {
  const context=state.error?'Attention':state.aPose?'A-pose · frozen':state.chooseSeat?'Choose a chair':state.sitting?'Seated':!state.placed?'Place your avatar':state.action==='stretch'?'Reaching up':state.action==='crouch'?'Crouching':state.moving?'Moving':'Standing';
  let left=[['Stick ↑↓','Walk'],['Stick ←→','Strafe'],['Click stick','Run'],['Y','Panel / help']],right=[['Stick ↑','Reach up'],['Stick ↓','Crouch · 2s sit'],['Stick ←→','Turn'],['A','Jump']];
  if(!state.placed){left=[['Y','Panel / help']];right=[['Trigger','Place avatar']];}
  else if(state.aPose){left=[['Y','Panel / help']];right=[['Panel','Resume idle']];}
  else if(state.chooseSeat){left=[['Y','Panel / help']];right=[['Trigger','Choose chair'],['Grip','Cancel seat']];}
  else if(state.sitting){left=[['Y','Panel / help']];right=[['Stick ←→','Turn'],['Grip','Stand']];}
  return {context,left,right,footer:state.aPose?'Resume idle in the panel to move':state.chooseSeat?'Point at the chair, then press trigger':state.sitting?'Grip to stand before moving':state.placed?'Trigger: point to ground to walk there':'Point at the floor, then press trigger',note:state.error||''};
}

/** Draw only compact contextual help; callers keep the left-hand anchor and six-second timer. */
export function drawXRHelp(canvas,state={}) {
  const content=xrHelpContent(state),signature=JSON.stringify(content);
  if(canvas.xrHelpSignature===signature)return false;
  if(canvas.width!==XR_HELP_LAYOUT.canvasWidth)canvas.width=XR_HELP_LAYOUT.canvasWidth;
  if(canvas.height!==XR_HELP_LAYOUT.canvasHeight)canvas.height=XR_HELP_LAYOUT.canvasHeight;
  const ctx=canvas.getContext('2d'),text=(value,x,y,width,font,colour='#edf0fa')=>{ctx.font=font;ctx.fillStyle=colour;let str=String(value);while(str.length&&ctx.measureText(str).width>width)str=str.slice(0,-1);if(str!==String(value)){while(str.length&&ctx.measureText(str+'…').width>width)str=str.slice(0,-1);str+='…';}ctx.fillText(str,x,y);};
  ctx.fillStyle='#20242d';ctx.fillRect(0,0,960,600);ctx.fillStyle='#7385db';ctx.fillRect(0,0,960,6);
  text('AviRev',28,56,300,'bold 38px system-ui');text(content.context,350,55,580,'30px system-ui','#b6c3e4');
  const columns=[content.left,content.right];for(let c=0;c<2;c++){const x=28+c*474;text(c?'RIGHT':'LEFT',x,116,410,'bold 23px system-ui','#9aaad1');columns[c].forEach(([key,action],row)=>{const y=168+row*73;ctx.fillStyle='#303a4b';ctx.fillRect(x,y-34,194,51);text(key,x+12,y,170,'bold 24px system-ui');text(action,x+208,y,230,'26px system-ui');});}
  text(content.footer,28,500,900,'28px system-ui','#d2d9ef');
  text(content.note||'Y recalls the panel · Help hides after 6 seconds',28,559,900,'24px system-ui',content.note?'#ffb9ad':'#97a7cb');
  canvas.xrHelpSignature=signature;return true;
}
