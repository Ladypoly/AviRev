import * as THREE from './libs/three/package/build/three.module.js';

const DISTANCE=1.5, STOP=1.65, RESTART=1.85, CELL=.25, RANGE=12, MAX_NODES=4096;
const horizontal=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const finite=point=>point&&point.toArray().every(Number.isFinite);

/** Session-only floor navigation. Every link is checked against the existing room collider. */
export class AvatarFollower {
  constructor(){this.reset();}
  reset(){this.path=[];this.search=null;this.snapshot=[];this.target=null;this.nextSearch=0;this.moving=false;this.running=false;this.status='Follow is ready.';this.params=null;this.stuckSince=null;this.lastPosition=null;}
  changed(world,body){
    const active=[...world.entries.values()].filter(entry=>entry.active),params=[body.height,body.radius,...body.offset.toArray()];
    const changed=this.params?.some((value,index)=>Math.abs(value-params[index])>.001)||active.length!==this.snapshot.length||active.some((entry,index)=>{const old=this.snapshot[index];return old?.entry!==entry||old.geometry!==entry.geometry||entry.matrix.elements.some((value,at)=>Math.abs(value-old.matrix.elements[at])>.02);});
    if(changed||!this.params){this.params=params;this.snapshot=active.map(entry=>({entry,geometry:entry.geometry,matrix:entry.matrix.clone()}));return true;}
    return false;
  }
  tick({world,position,viewer,body,groundY,seconds}){
    const result=direction=>({direction,run:!!direction&&this.running,waypoint:direction?this.path[0]?.clone():null,status:this.status});
    if(!world?.complete||!world.hasGeometry||!finite(position)||!finite(viewer)||!body||![body.height,body.radius,groundY,seconds,...(body.offset?.toArray()||[])].every(Number.isFinite)||body.height<=0||body.radius<=0||!body.offset){this.path=[];this.search=null;this.moving=false;this.status='Follow needs a tracked room scan and clear floor.';return result(null);}
    const distance=horizontal(position,viewer),changed=this.changed(world,body);
    if(changed){this.path=[];this.search=null;this.nextSearch=0;}
    if(distance>=DISTANCE-.2&&distance<=STOP&&!changed){this.path=[];this.search=null;this.moving=false;this.status='Staying nearby.';return result(null);}
    if(!this.moving&&distance<RESTART&&distance>=DISTANCE-.2){this.status='Staying nearby.';return result(null);}
    this.moving=true;
    if(distance>3.8)this.running=true;else if(distance<2.8)this.running=false;
    if(this.search&&horizontal(viewer,this.target)>2){this.search=null;this.nextSearch=0;}
    if(!this.search&&seconds>=this.nextSearch&&(!this.path.length||this.target&&horizontal(viewer,this.target)>.45)){this.target=viewer.clone();this.search=this.route(world,position.clone(),viewer.clone(),body,groundY);this.status='Finding a clear route.';}
    if(this.search){
      const start=performance.now();let step,operations=0;
      do{step=this.search.next();operations++;}while(!step.done&&operations<24&&performance.now()-start<2);
      if(step.done){
        this.search=null;const path=step.value||[];let nearest=-1,best=Infinity;
        // The actor can advance along its old route while this search is running.
        for(let index=0;index<path.length;index++){const distance=horizontal(position,path[index]);if(distance<=best&&this.link(world,position,path[index],body)){nearest=index;best=distance;}}
        this.path=nearest<0?[]:path.slice(nearest);this.nextSearch=seconds+(this.path.length?.3:1);this.status=this.path.length?'Following you.':'No clear route yet. Staying here.';
      }
    }
    while(this.path.length&&horizontal(position,this.path[0])<.09)this.path.shift();
    if(this.path.length){
      const waypoint=this.path[0];
      if(!this.link(world,position,waypoint,body)){this.path=[];this.search=null;this.nextSearch=0;}
      else{
        if(this.lastPosition&&horizontal(position,this.lastPosition)<.002){this.stuckSince??=seconds;if(seconds-this.stuckSince>.6){this.path=[];this.search=null;this.nextSearch=seconds+.2;this.stuckSince=null;}}
        else this.stuckSince=null;
        this.lastPosition=position.clone();
        if(this.path.length){const delta=waypoint.clone().sub(position);delta.y=0;delta.normalize().multiplyScalar(Math.min(1,horizontal(position,waypoint)/.18));this.status='Following you.';return result(delta);}
      }
    }
    return result(null);
  }
  floor(world,point,body,groundY){
    const probe=point.clone();probe.y=groundY+.1;const support=world.groundSupport(probe,.3,body.radius*.4);
    if(!support||Math.abs(support.point.y-groundY)>.12||/^(table|chair|couch|sofa|bed|desk|cabinet|shelf|ceiling|wall)$/i.test(support.semanticLabel||''))return null;
    const floor=support.point.clone();
    return world.canOccupy(floor.clone().add(body.offset),body.height,body.radius,false,null,body.segment)?floor:null;
  }
  link(world,from,to,body){
    if(Math.abs(from.y-to.y)>.08)return false;
    const start=from.clone().add(body.offset),end=to.clone().add(body.offset);
    return world.constrainMove(start,end,body.height,body.radius,body.segment).distanceToSquared(end)<1e-8;
  }
  *route(world,origin,target,body,groundY){
    const cache=new Map(),nodes=new Map(),open=[];let expanded=0;
    const heuristic=point=>Math.abs(horizontal(point,target)-DISTANCE),key=(x,z)=>x+','+z;
    const push=node=>{open.push(node);let at=open.length-1;while(at){const parent=(at-1)>>1;if(open[parent].f<=node.f)break;open[at]=open[parent];at=parent;}open[at]=node;};
    const pop=()=>{const first=open[0],last=open.pop();if(open.length){let at=0;while(true){let child=at*2+1;if(child>=open.length)break;if(child+1<open.length&&open[child+1].f<open[child].f)child++;if(open[child].f>=last.f)break;open[at]=open[child];at=child;}open[at]=last;}return first;};
    const sample=(x,z)=>{const id=key(x,z);if(!cache.has(id))cache.set(id,this.floor(world,new THREE.Vector3(origin.x+x*CELL,origin.y,origin.z+z*CELL),body,groundY));return cache.get(id);};
    const start={x:0,z:0,point:origin,g:0,f:heuristic(origin),parent:null},build=node=>{const path=[];while(node.parent){path.unshift(node.point.clone());node=node.parent;}return path;};
    nodes.set(key(0,0),start);push(start);let best=start;
    while(open.length&&expanded<MAX_NODES){
      const node=pop();if(node.closed||nodes.get(key(node.x,node.z))!==node)continue;node.closed=true;expanded++;yield;
      const distance=horizontal(node.point,target);
      if(distance>=DISTANCE-.2&&distance<=STOP)return build(node);
      if(heuristic(node.point)<heuristic(best.point))best=node;
      for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
        const x=node.x+dx,z=node.z+dz,id=key(x,z);if(Math.abs(x*CELL)>RANGE||Math.abs(z*CELL)>RANGE||nodes.get(id)?.closed)continue;
        const point=sample(x,z);yield;if(!point)continue;const nextDistance=horizontal(point,target);if(nextDistance<DISTANCE-.35&&nextDistance<=distance+.001)continue;
        if(dx&&dz){if(!sample(node.x+dx,node.z)||!sample(node.x,node.z+dz))continue;yield;}
        if(!this.link(world,node.point,point,body))continue;yield;
        const cost=node.g+node.point.distanceTo(point),old=nodes.get(id);if(old&&cost>=old.g)continue;
        const next={x,z,point,g:cost,f:cost+heuristic(point),parent:node};nodes.set(id,next);push(next);
      }
    }
    // shortcut: Long rooms are planned in bounded sections; replan from the next section instead of scanning an unlimited grid.
    return horizontal(origin,target)>RANGE&&heuristic(best.point)<heuristic(start.point)-CELL?build(best):[];
  }
}
