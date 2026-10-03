import { State } from './state.js';
import { FIELD_W, FIELD_H, OFFSET_X, PIN_R, SNAP_MM, ROBOT_W, ROBOT_H, OBSTACLES, MISSIONS, bzAt, polyCollides, toLocal, toField } from './math.js';
import { routePieces, routeIndexOfSeg, routeTail, projectOnPlan, PIN_ON_TOL } from './route.js';

export const MARGIN_MM = 1000;
export const V_FIELD_W = FIELD_W + MARGIN_MM * 2;
export const V_FIELD_H = FIELD_H + MARGIN_MM * 2;

export let canvas;
export let ctx;
export let baseCanvasW = 0, baseCanvasH = 0;

export function initCanvas() {
  canvas = document.getElementById('field');
  ctx = canvas.getContext('2d');
}

export function resizeCanvas(pane, drawFn){
  const availW = pane.offsetWidth - 80;
  const availH = pane.offsetHeight - 80;
  if(availW <= 0 || availH <= 0) {
    setTimeout(() => resizeCanvas(pane, drawFn), 100);
    return;
  }
  
  const scale = Math.min(availW / FIELD_W, availH / FIELD_H);
  if(scale <= 0) return;
  
  baseCanvasW = V_FIELD_W * scale;
  baseCanvasH = V_FIELD_H * scale;
  
  applyTransform();
  
  requestAnimationFrame(() => {
    pane.scrollLeft = (baseCanvasW - availW) / 2;
    pane.scrollTop = (baseCanvasH - availH) / 2;
  });
  
  if (drawFn) drawFn();
}

export function applyTransform() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = baseCanvasW * State.viewZoom;
  const cssH = baseCanvasH * State.viewZoom;
  
  const MAX_TEX = 6000;
  let renderScale = dpr * State.viewZoom;
  if (baseCanvasW * renderScale > MAX_TEX) renderScale = MAX_TEX / baseCanvasW;
  if (baseCanvasH * renderScale > MAX_TEX) renderScale = Math.min(renderScale, MAX_TEX / baseCanvasH);
  
  canvas.width  = baseCanvasW * renderScale;
  canvas.height = baseCanvasH * renderScale;
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  
  const wrap = document.getElementById('field-wrap');
  wrap.style.width = cssW + 'px';
  wrap.style.height = cssH + 'px';
  wrap.style.transform = 'none';
  
  const sizer = document.getElementById('layout-sizer');
  sizer.style.width = (cssW + 80) + 'px';
  sizer.style.height = (cssH + 80) + 'px';
  
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
}

export const cw     = () => baseCanvasW;
export const ch     = () => baseCanvasH;
export const scalePx = mm => mm / V_FIELD_W * cw();
export const toCx   = x   => (x + OFFSET_X + MARGIN_MM) / V_FIELD_W * cw();
export const toCy   = y   => ch() - ((y + MARGIN_MM) / V_FIELD_H * ch());
export const fromCx = px  => (px / cw()) * V_FIELD_W - MARGIN_MM - OFFSET_X;
export const fromCy = py  => (1 - py / ch()) * V_FIELD_H - MARGIN_MM;
export const clampX = v   => Math.max(-OFFSET_X, Math.min(FIELD_W - OFFSET_X, v));
export const clampY = v   => Math.max(0, Math.min(FIELD_H, v));
export const snapV  = v   => State.snapOn ? Math.round(v / SNAP_MM) * SNAP_MM : Math.round(v);

export function getXY(e){
  const r   = canvas.getBoundingClientRect();
  const cpx = (e.clientX - r.left) * (baseCanvasW / r.width);
  const cpy = (e.clientY - r.top) * (baseCanvasH / r.height);
  const rawX = fromCx(cpx), rawY = fromCy(cpy);
  
  if (!State.snapOn) return { cpx, cpy, rawX, rawY, snapX: rawX, snapY: rawY };

  // Snap along the rotated grid (same frame as the drawn grid / robot)
  const heading = State.robotHeading || 0;
  const l = toLocal(rawX, rawY, heading);
  const f = toField(snapV(l.x), snapV(l.y), heading);
  const snapX = Math.round(f.x * 10) / 10, snapY = Math.round(f.y * 10) / 10;
  
  return { cpx, cpy, rawX, rawY, snapX, snapY };
}

// ════════════════════════════════════════════════════════════
//  Draw
// ════════════════════════════════════════════════════════════
export function draw(){
  const W=cw(), H=ch();
  ctx.clearRect(0,0,W,H);

  // Grid (Rotated based on Robot Heading)
  const heading = State.robotHeading || 0;
  ctx.save();
  ctx.translate(toCx(0), toCy(0));
  ctx.rotate(heading * Math.PI / 180);
  ctx.strokeStyle='#ebebeb'; ctx.lineWidth=1;
  const gridSpan = 4000;
  for(let p = -gridSpan; p <= gridSpan; p+=100){
    const dPx = scalePx(p);
    const spanPx = scalePx(gridSpan);
    // Vertical lines
    ctx.beginPath();ctx.moveTo(dPx, -spanPx);ctx.lineTo(dPx, spanPx);ctx.stroke();
    // Horizontal lines
    ctx.beginPath();ctx.moveTo(-spanPx, -dPx);ctx.lineTo(spanPx, -dPx);ctx.stroke();
  }
  ctx.restore();

  // Draw Origin Robot Icon
  const pieces = routePieces();
  const firstSeg = pieces.find(p => p.kind === 'seg');
  const startPt = firstSeg ? firstSeg.pts[0] : {x:0, y:0};

  const rw = scalePx(ROBOT_W), rh = scalePx(ROBOT_H);
  ctx.save();
  ctx.translate(toCx(startPt.x), toCy(startPt.y));
  ctx.rotate(heading * Math.PI / 180);
  ctx.fillStyle='rgba(238,130,124,0.15)';ctx.fillRect(-rw/2, -rh/2, rw, rh);
  ctx.strokeStyle='#ee827c';ctx.lineWidth=1;ctx.strokeRect(-rw/2, -rh/2, rw, rh);
  // Direction marker (Front)
  ctx.fillStyle='#cc2200';
  ctx.beginPath();ctx.arc(0, -rh/2 + scalePx(15), scalePx(15), 0, Math.PI*2);ctx.fill();
  ctx.restore();

  // Field boundary
  ctx.strokeStyle='#ccc'; ctx.lineWidth=2;
  const physicalLeft = toCx(-OFFSET_X);
  const physicalRight = toCx(FIELD_W - OFFSET_X);
  ctx.strokeRect(physicalLeft, toCy(FIELD_H), physicalRight - physicalLeft, toCy(0)-toCy(FIELD_H));

  // Inner Mat boundary
  ctx.strokeStyle='#999'; ctx.lineWidth=2; 
  ctx.strokeRect(toCx(0), toCy(FIELD_H), toCx(2000)-toCx(0), toCy(0)-toCy(FIELD_H));
  
  // Home areas
  ctx.beginPath();
  ctx.arc(toCx(0), toCy(0), scalePx(475), 0, -Math.PI/2, true);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(toCx(2000), toCy(0), scalePx(475), -Math.PI, -Math.PI/2, false);
  ctx.stroke();

  // Snap cross
  if(State.lastMouse){
    const sx=toCx(State.lastMouse.snapX), sy=toCy(State.lastMouse.snapY);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(heading * Math.PI / 180);
    ctx.strokeStyle='rgba(238,130,124,0.3)'; ctx.lineWidth=1; ctx.setLineDash([2,3]);
    ctx.beginPath();ctx.moveTo(0,-H);ctx.lineTo(0,H);ctx.stroke();
    ctx.beginPath();ctx.moveTo(-W,0);ctx.lineTo(W,0);ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='rgba(238,130,124,0.45)';
    ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
  
  // Labels
  const fs=Math.max(9, W*(FIELD_W/V_FIELD_W)*0.015);
  ctx.fillStyle='#999';ctx.font=fs+'px Courier New';
  ctx.textAlign='center';ctx.textBaseline='bottom';
  const fieldBottom = toCy(0);
  const fieldLeft = toCx(0);
  const startX = -MARGIN_MM - OFFSET_X, endX = FIELD_W + MARGIN_MM - OFFSET_X;
  const startY = -MARGIN_MM, endY = FIELD_H + MARGIN_MM;
  for(let x = Math.ceil(startX/100)*100; x <= endX; x+=100) {
    if(x % 200 !== 0 && x !== 0) continue;
    const tx = toCx(x);
    ctx.beginPath(); ctx.moveTo(tx, fieldBottom); ctx.lineTo(tx, fieldBottom-6); ctx.strokeStyle='#999'; ctx.stroke();
    ctx.fillText(x, tx, fieldBottom-8);
  }
  ctx.textAlign='left';ctx.textBaseline='middle';
  for(let y = Math.ceil(startY/100)*100; y <= endY; y+=100) {
    if(y % 200 !== 0 && y !== 0) continue;
    const ty = toCy(y);
    ctx.beginPath(); ctx.moveTo(fieldLeft, ty); ctx.lineTo(fieldLeft+6, ty); ctx.strokeStyle='#999'; ctx.stroke();
    ctx.fillText(y, fieldLeft+8, ty);
  }

  if(State.showObs) drawObstacles();
  drawCV();
  if(State.simPos) drawSimRobot();
}

function drawObstacles(){
  for(const obs of OBSTACLES){
    ctx.fillStyle='rgba(200,0,0,0.02)';ctx.strokeStyle='rgba(200,0,0,0.16)';
    ctx.lineWidth=1;ctx.setLineDash([4,3]);
    const hx=toCx(obs.x-ROBOT_W/2),hy=toCy(obs.y+obs.h+ROBOT_H/2);
    const hw=scalePx(obs.w+ROBOT_W),hh=scalePx(obs.h+ROBOT_H);
    ctx.fillRect(hx,hy,hw,hh);ctx.strokeRect(hx,hy,hw,hh);
    ctx.setLineDash([]);
    const ox=toCx(obs.x),oy=toCy(obs.y+obs.h),ow=scalePx(obs.w),oh=scalePx(obs.h);
    ctx.fillStyle='rgba(200,0,0,0.05)';ctx.strokeStyle='rgba(200,0,0,0.30)';ctx.lineWidth=1.5;
    ctx.fillRect(ox,oy,ow,oh);ctx.strokeRect(ox,oy,ow,oh);
    ctx.fillStyle='rgba(160,0,0,0.55)';
    ctx.font='bold '+Math.max(9,cw()*0.022)+'px Courier New';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(obs.label,ox+ow/2,oy+oh/2);
  }

  // Draw FLL Missions
  for(const m of MISSIONS) {
    ctx.fillStyle='rgba(200,0,0,0.15)';
    ctx.strokeStyle='rgba(200,0,0,0.50)';
    ctx.lineWidth=1.5;
    ctx.beginPath();
    for(let i=0; i<m.pts.length; i++) {
        const pt = m.pts[i];
        if (i === 0) ctx.moveTo(toCx(pt.x), toCy(pt.y));
        else ctx.lineTo(toCx(pt.x), toCy(pt.y));
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function strokePoly(pts){
  ctx.beginPath();ctx.moveTo(toCx(pts[0].x),toCy(pts[0].y));
  for(let i=1;i<pts.length;i++) ctx.lineTo(toCx(pts[i].x),toCy(pts[i].y));
  ctx.stroke();
}

function badge(x, y, txt, fill, fg){
  const r = 8;
  ctx.shadowColor='rgba(0,0,0,0.15)';ctx.shadowBlur=3;
  ctx.fillStyle=fill;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=0;
  ctx.fillStyle=fg;ctx.font='bold 9px Courier New';
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(txt,x,y+0.5);
}

function drawCV(){
  const rw=scalePx(ROBOT_W),rh=scalePx(ROBOT_H);
  const heading = (State.robotHeading||0) * Math.PI / 180;
  const plan = State.plan;

  // Robot footprint swept along the route (rotated with the robot)
  if(plan && plan.pts.length){
    ctx.strokeStyle='rgba(238,130,124,0.10)';ctx.lineWidth=1;
    let lastS = -Infinity;
    for(const p of plan.pts){
      if(p.s - lastS < 60) continue; lastS = p.s;
      ctx.save();ctx.translate(toCx(p.x),toCy(p.y));ctx.rotate(heading);
      ctx.strokeRect(-rw/2,-rh/2,rw,rh);ctx.restore();
    }
  }

  // Unrouted segments
  for(const seg of State.segments){
    if(routeIndexOfSeg(seg) >= 0) continue;
    const isHover=(seg.id===State.hoverSegId);
    ctx.setLineDash([]);
    ctx.strokeStyle=isHover?'#ffb3b0':'#c8c5c3';
    ctx.lineWidth=isHover?4:2;
    strokePoly(seg.pts);
  }

  // Hover preview: direction it would be added with
  if(State.mode==='select' && State.hoverSegId!==null){
    const seg=State.segments.find(s=>s.id===State.hoverSegId);
    if(seg && routeIndexOfSeg(seg)<0){
      const tail=routeTail();
      const s=seg.pts[0], e=seg.pts[seg.pts.length-1];
      const rev=Math.hypot(e.x-tail.x,e.y-tail.y)<Math.hypot(s.x-tail.x,s.y-tail.y);
      const pts=rev?[...seg.pts].reverse():seg.pts;
      const m=Math.floor(pts.length/2);
      arrow(toCx(pts[m].x),toCy(pts[m].y),toCx(pts[m+1].x),toCy(pts[m+1].y),'#ffb3b0');
      badge(toCx(pts[m].x),toCy(pts[m].y)-14,'+'+(State.route.length+1),'#fff1f0','#993a35');
    }
  }

  // Routed pieces
  const pieces = routePieces();
  const idxOf = uid => State.route.findIndex(it=>it.uid===uid);
  for(const pc of pieces){
    const focused = pc.uid!==null && pc.uid===State.focusUid;
    if(pc.kind==='gap'){
      ctx.strokeStyle='#cc2200';ctx.lineWidth=2;ctx.setLineDash([3,4]);
      strokePoly(pc.pts);ctx.setLineDash([]);
      const a=pc.pts[0],b=pc.pts[1];
      badge(toCx((a.x+b.x)/2),toCy((a.y+b.y)/2),'!','#cc2200','#fff');
      continue;
    }
    if(pc.kind==='link'){
      ctx.strokeStyle=focused?'#c4524b':'#ee827c';ctx.lineWidth=focused?4:2.5;ctx.setLineDash([8,5]);
      strokePoly(pc.pts);ctx.setLineDash([]);
      const a=pc.pts[0],b=pc.pts[1];
      arrow(toCx(a.x),toCy(a.y),toCx((a.x+b.x)/2),toCy((a.y+b.y)/2),'#ee827c');
      badge(toCx((a.x+b.x)/2),toCy((a.y+b.y)/2)-14,String(idxOf(pc.uid)+1),focused?'#c4524b':'#fff','#222');
      continue;
    }
    const col=State.showObs&&polyCollides(pc.pts);
    if(focused){
      ctx.strokeStyle='rgba(238,130,124,0.25)';ctx.lineWidth=11;ctx.setLineDash([]);
      strokePoly(pc.pts);
    }
    ctx.strokeStyle=col?'#cc2200':(focused?'#c4524b':'#ee827c');
    ctx.lineWidth=focused?4.5:3.5;ctx.setLineDash(col?[6,3]:[]);
    strokePoly(pc.pts);ctx.setLineDash([]);
    const pts=pc.pts, m=Math.floor(pts.length/2);
    if(m+1<pts.length){
      arrow(toCx(pts[m].x),toCy(pts[m].y),toCx(pts[m+1].x),toCy(pts[m+1].y),col?'#cc2200':(focused?'#c4524b':'#ee827c'));
      const it=pc.item;
      const label=String(idxOf(pc.uid)+1);
      badge(toCx(pts[m].x)+10,toCy(pts[m].y)-12,label,focused?'#c4524b':'#222','#fff');
      if(it.stop){
        const e=pts[pts.length-1];
        ctx.fillStyle='#222';ctx.fillRect(toCx(e.x)-4,toCy(e.y)-4,8,8);
      }
    }
  }

  // Control polygons (active curve, or curves used by the focused item)
  const focusItem = State.route.find(it=>it.uid===State.focusUid);
  for(const c of State.curves){
    const isActive = (c.id === State.activeCurveId) || (focusItem && focusItem.curveId===c.id);
    if(isActive && c.nodes.length === 3) {
      const p1=c.nodes[0], p2=c.nodes[1], cp=c.nodes[2];
      ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(toCx(p1.x),toCy(p1.y));
      ctx.lineTo(toCx(cp.x),toCy(cp.y));
      ctx.lineTo(toCx(p2.x),toCy(p2.y));
      ctx.stroke();
    }
  }

  if(State.mode==='draw' && State.activeCurveId!==null && State.lastMouse) {
    const c = State.curves.find(c=>c.id===State.activeCurveId);
    if(c) {
      if(c.nodes.length===1) {
        ctx.strokeStyle='#ee827c'; ctx.lineWidth=2; ctx.setLineDash([5,5]);
        ctx.beginPath(); ctx.moveTo(toCx(c.nodes[0].x), toCy(c.nodes[0].y));
        ctx.lineTo(toCx(State.lastMouse.snapX), toCy(State.lastMouse.snapY));
        ctx.stroke(); ctx.setLineDash([]);
      } else if(c.nodes.length===2) {
        ctx.strokeStyle='#ee827c'; ctx.lineWidth=2; ctx.setLineDash([5,5]);
        ctx.beginPath(); ctx.moveTo(toCx(c.nodes[0].x), toCy(c.nodes[0].y));
        const pts = [];
        for(let i=0; i<=50; i++) pts.push(bzAt(c.nodes[0], c.nodes[1], {x:State.lastMouse.snapX, y:State.lastMouse.snapY}, i/50));
        for(let i=1; i<pts.length; i++) ctx.lineTo(toCx(pts[i].x), toCy(pts[i].y));
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }

  if (State.freehandPts && State.freehandPts.length > 0) {
    ctx.strokeStyle='#ee827c'; ctx.lineWidth=3; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(toCx(State.freehandPts[0].x), toCy(State.freehandPts[0].y));
    for(let i=1; i<State.freehandPts.length; i++){
      ctx.lineTo(toCx(State.freehandPts[i].x), toCy(State.freehandPts[i].y));
    }
    ctx.stroke();
  }

  for(const c of State.curves){
    const isActive=c.id===State.activeCurveId || (focusItem && focusItem.curveId===c.id);
    const r=isActive?PIN_R:PIN_R*0.55;
    c.nodes.forEach((n,i)=>{
      const cx_=toCx(n.x),cy_=toCy(n.y);
      const key=c.id+'-'+i;
      const isSel=key===State.selNodeKey;
      ctx.shadowColor='rgba(0,0,0,0.1)';ctx.shadowBlur=3;
      if(isSel){ctx.fillStyle='#ee827c';ctx.strokeStyle='#ee827c';ctx.lineWidth=2;}
      else if(isActive){ctx.fillStyle='#fff';ctx.strokeStyle='#222';ctx.lineWidth=1.5;}
      else{ctx.fillStyle='#e0e0e0';ctx.strokeStyle='#bbb';ctx.lineWidth=1;}
      ctx.beginPath();ctx.arc(cx_,cy_,r,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.shadowBlur=0;
      if(isActive){
        ctx.fillStyle=isSel?'#fff':'#222';
        ctx.font='bold '+Math.max(6,r*1.15)+'px Courier New';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(i,cx_,cy_);
      }
    });
  }

  State.actionPins.forEach((p, k) => {
    const cx = toCx(p.x), cy = toCy(p.y);
    const pr = plan && plan.pts.length ? projectOnPlan(plan, p) : null;
    const off = !pr || pr.d > PIN_ON_TOL;
    ctx.shadowColor='rgba(0,0,0,0.2)';ctx.shadowBlur=4;ctx.shadowOffsetY=2;
    ctx.fillStyle = off ? '#bbb' : '#f06c64';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', cx, cy - 2);
    ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    ctx.fillStyle = off ? '#999' : '#993a35';
    ctx.font = 'bold 9px Courier New';
    ctx.fillText(String(k+1), cx + 11, cy - 11);
  });
}

function arrow(x1,y1,x2,y2,col){
  const dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy);
  if(len<0.01) return;
  const ux=dx/len,uy=dy/len,s=7;
  ctx.fillStyle=col;ctx.beginPath();
  ctx.moveTo(x2,y2);
  ctx.lineTo(x2-ux*s-uy*s*.5,y2-uy*s+ux*s*.5);
  ctx.lineTo(x2-ux*s+uy*s*.5,y2-uy*s-ux*s*.5);
  ctx.closePath();ctx.fill();
}

function drawSimRobot(){
  const pt=State.simPos;
  const rw=scalePx(ROBOT_W),rh=scalePx(ROBOT_H);
  const heading = State.robotHeading || 0;
  
  ctx.save();
  ctx.translate(toCx(pt.x), toCy(pt.y));
  ctx.rotate(heading * Math.PI / 180);
  ctx.fillStyle='rgba(238,130,124,0.25)';ctx.fillRect(-rw/2,-rh/2,rw,rh);
  ctx.strokeStyle='#ee827c';ctx.lineWidth=2.5;ctx.strokeRect(-rw/2,-rh/2,rw,rh);
  ctx.strokeStyle = '#cc2200';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-rw/2, -rh/2);
  ctx.lineTo(rw/2, -rh/2);
  ctx.stroke();
  ctx.restore();

  // live speed readout
  ctx.fillStyle='#993a35';ctx.font='bold 10px Courier New';
  ctx.textAlign='center';ctx.textBaseline='top';
  ctx.fillText(pt.paused?'pause':Math.round(pt.v)+' mm/s', toCx(pt.x), toCy(pt.y)+rh/2+4);
}
