/**
 * Native XR adapter of the movement core in hh-hang/three-player-controller.
 * Upstream ca82bbc76a3b9b0afa80c73b60167adf6123b9b6, CharacterMovement.ts and PlayerController.ts.
 * Camera, renderer, avatar skinning and input ownership stay with AviRev.
 *
 * MIT License
 * 
 * Copyright (c) 2026 屈航
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import * as THREE from './libs/three/package/build/three.module.js';

export class AvatarMovementMotor {
  constructor(){this.velocity=new THREE.Vector3();this.grounded=true;this.gravity=-13.5;}
  reset(){this.velocity.set(0,0,0);this.grounded=true;}
  launch(height=.8){if(!this.grounded||!Number.isFinite(height)||height<=0)return false;this.velocity.y=Math.sqrt(-2*this.gravity*Math.min(height,1.2));this.grounded=false;return true;}
  step(position,target,delta,{world,height,radius,flying=false,floorY=position.y,segment=null}={}){
    if(![...position.toArray(),...target.toArray(),delta,height,radius,floorY].every(Number.isFinite)||delta<0||delta>.1||height<=0||radius<=0||world&&!world.complete){this.velocity.set(0,0,0);return position.clone();}
    // Adapted from CharacterMovement.update: approach the target velocity without normalizing analog input.
    const diffX=target.x-this.velocity.x,diffZ=target.z-this.velocity.z;
    const hasXZInput=target.x!==0||target.z!==0,xzDiffLen=Math.hypot(diffX,diffZ);
    if(xzDiffLen>0){const xzApplied=Math.min(xzDiffLen,(hasXZInput?20:24)*delta);this.velocity.x+=(diffX/xzDiffLen)*xzApplied;this.velocity.z+=(diffZ/xzDiffLen)*xzApplied;}
    if(flying){const diffY=target.y-this.velocity.y;this.velocity.y+=Math.sign(diffY)*Math.min(Math.abs(diffY),(target.y!==0?20:24)*delta);this.grounded=false;}
    else if(!this.grounded){this.velocity.y=Math.max(-12,this.velocity.y+delta*this.gravity);}
    else this.velocity.y=0;
    let safe=position.clone();
    const lowerFloor=point=>{
      if(!world?.hasGeometry)return floorY;
      const probe=point.clone();probe.y=floorY+.05;
      const support=world.groundSupport?.(probe,4,radius*.4),ground=support?.point?.y;
      if(!Number.isFinite(ground)||ground>=floorY-.035||ground<floorY-3.95)return floorY;
      const destination=point.clone();destination.y=ground;
      return world.canOccupy(destination,height,radius,false,null,segment)?ground:floorY;
    };
    // Adapted from CharacterMovement.update: radius-sized movement steps with a fixed upper bound.
    const totalDist=this.velocity.length()*delta,maxStep=radius*.8,steps=Math.max(1,Math.ceil(totalDist/maxStep));
    if(steps>64){this.velocity.set(0,0,0);return safe;}
    for(let i=0;i<steps;i++){
      const origin=safe.clone(),desired=origin.clone().addScaledVector(this.velocity,delta/steps);
      if(flying&&desired.y<floorY)desired.y=Math.max(desired.y,lowerFloor(desired));
      safe=world?.constrainMove(origin,desired,height,radius,segment)||desired;
      if(safe.distanceToSquared(desired)>1e-10){if(world?.constrainVelocity)world.constrainVelocity(this.velocity);else this.velocity.set(0,0,0);}
      if(safe.distanceToSquared(origin)<1e-12&&totalDist>1e-8)break;
    }
    if(!flying){
      const probe=safe.clone().add(new THREE.Vector3(0,.05,0)),support=world?.groundSupport?.(probe,.15,radius*.4);
      const ground=Number.isFinite(support?.point?.y)?support.point.y:!world?.hasGeometry?floorY:null;
      if(ground!==null&&this.velocity.y<=0&&safe.y<=ground+.035){const snapped=safe.clone();snapped.y=ground;if(!world||world.canOccupy(snapped,height,radius,false,null,segment)){safe.copy(snapped);this.velocity.y=0;this.grounded=true;}}
      else if(this.grounded&&(ground!==null&&safe.y>ground+.035||world?.hasGeometry&&!support))this.grounded=false;
      // Preserve the placement floor unless a bounded real-room probe proves a clear lower floor.
      if(safe.y<floorY){const lower=safe.clone();lower.y=lowerFloor(safe);if(safe.y<lower.y&&(!world||world.canOccupy(lower,height,radius,false,null,segment))){safe.copy(lower);this.velocity.y=0;this.grounded=true;}}
    }
    return safe;
  }
}
