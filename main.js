import { State, saveUndoState, performUndo, performRedo } from './state.js';
import { rebuildSegmentsAndIntersections, polyCollides, polyLen, NODE_HIT, SEG_HIT, simplifyPoly, pointsToBezier } from './math.js';
import { initCanvas, resizeCanvas, draw, getXY, canvas, toCx, toCy } from './canvas.js';
import { startSim, stopSim } from './sim.js';
import { generateCode } from './codegen.js';
import { appendSeg, remapRoute, buildPlan, validateRoute, autoFixAll, routeIndexOfSeg,
         segItemPts, routePieces, newLinkItem, projectOnPlan, PIN_ON_TOL } from './route.js';
initCanvas();

// ==========================================================
//  Hit Testing
// ==========================================================
function hitAnyNode(cpx,cpy,onlyCurveIds){
  for(let ci=State.curves.length-1;ci>=0;ci--){
    const c=State.curves[ci];
    if(onlyCurveIds && !onlyCurveIds.includes(c.id)) continue;
    const big = c.id===State.activeCurveId || (onlyCurveIds && onlyCurveIds.includes(c.id));
    const r=big?NODE_HIT*1.2:NODE_HIT*0.8;
    for(let i=c.nodes.length-1;i>=0;i--){
      const dx=toCx(c.nodes[i].x)-cpx, dy=toCy(c.nodes[i].y)-cpy;
      if(dx*dx+dy*dy<=r*r) return{cid:c.id,ni:i};
    }
  }
  return null;
}

// nearest segment within SEG_HIT px (not just the first one found)
function hitSegment(cpx,cpy){
  let best=null, bestD=SEG_HIT*SEG_HIT;
  for(const seg of State.segments){
    for(let i=0;i+1<seg.pts.length;i++){
      const ax=toCx(seg.pts[i].x),ay=toCy(seg.pts[i].y);
      const bx=toCx(seg.pts[i+1].x),by=toCy(seg.pts[i+1].y);
      const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
      if(len2<0.001) continue;
      const t=Math.max(0,Math.min(1,((cpx-ax)*dx+(cpy-ay)*dy)/len2));
      const ex=ax+t*dx-cpx,ey=ay+t*dy-cpy, d=ex*ex+ey*ey;
      if(d<=bestD){bestD=d;best=seg.id;}
    }
  }
  return best;
}

function hitActionPin(cpx,cpy){
  const R=NODE_HIT+4;
  for(let i=State.actionPins.length-1;i>=0;i--){
    const dx=toCx(State.actionPins[i].x)-cpx,dy=toCy(State.actionPins[i].y)-cpy;
    if(dx*dx+dy*dy<=R*R) return i;
  }
  return -1;
}

function findClosestPathPoint(cpx, cpy) {
  const plan = State.plan;
  if(!plan || plan.pts.length<2) return null;
  let minDist = Infinity, best = null;
  const P = plan.pts;
  for (let i = 0; i + 1 < P.length; i++) {
    const ax = toCx(P[i].x), ay = toCy(P[i].y);
    const bx = toCx(P[i+1].x), by = toCy(P[i+1].y);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.001) continue;
    const t = Math.max(0, Math.min(1, ((cpx - ax) * dx + (cpy - ay) * dy) / len2));
    const ex = ax + t * dx, ey = ay + t * dy;
    const dist = Math.hypot(ex - cpx, ey - cpy);
    if (dist < minDist) {
      minDist = dist;
      best = { x: P[i].x + t * (P[i+1].x - P[i].x), y: P[i].y + t * (P[i+1].y - P[i].y) };
    }
  }
  return minDist < 30 ? best : null;
}

const focusedItem = () => State.route.find(it=>it.uid===State.focusUid) || null;
const focusedIdx  = () => State.route.findIndex(it=>it.uid===State.focusUid);

// ==========================================================
//  Mouse + Key Events
// ==========================================================
const tooltip = document.getElementById('tooltip');

function updateZoom(newZ) {
  const pane = document.getElementById('pane-field');
  const scrollRatioX = (pane.scrollLeft + pane.clientWidth / 2) / pane.scrollWidth;
  const scrollRatioY = (pane.scrollTop + pane.clientHeight / 2) / pane.scrollHeight;

  State.viewZoom = newZ;
  resizeCanvas(pane); // Will re-apply transform

  pane.scrollLeft = scrollRatioX * pane.scrollWidth - pane.clientWidth / 2;
  pane.scrollTop = scrollRatioY * pane.scrollHeight - pane.clientHeight / 2;

  draw();
}

const paneField = document.getElementById('pane-field');
paneField.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    if (dir > 0 && State.zoomIndex > 0) {
      State.zoomIndex--;
      updateZoom(State.ZOOM_LEVELS[State.zoomIndex]);
    } else if (dir < 0 && State.zoomIndex < State.ZOOM_LEVELS.length - 1) {
      State.zoomIndex++;
      updateZoom(State.ZOOM_LEVELS[State.zoomIndex]);
    }
  }
});

let isPanning = false;
let panStartX, panStartY, panScrollLeft, panScrollTop;

paneField.addEventListener('mousedown', (e) => {
  if (e.button === 1 || (e.button === 0 && e.shiftKey)) { // Middle click or Shift+Click
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panScrollLeft = paneField.scrollLeft;
    panScrollTop = paneField.scrollTop;
    paneField.style.cursor = 'grabbing';
  }
});
window.addEventListener('mousemove', (e) => {
  if (isPanning) {
    paneField.scrollLeft = panScrollLeft - (e.clientX - panStartX);
    paneField.scrollTop = panScrollTop - (e.clientY - panStartY);
  }
});
window.addEventListener('mouseup', (e) => {
  if (isPanning) {
    isPanning = false;
    paneField.style.cursor = '';
  }
});

canvas.addEventListener('mousedown',e=>{
  if (isPanning) return;
  if(e.button === 2 || e.button === 1 || e.shiftKey){
    e.preventDefault();
    return;
  }
  const m=getXY(e);
  State.mouseDownCpx=m.cpx; State.mouseDownCpy=m.cpy; State.mouseIsDragging=false;

  if(State.mode==='action'){
    const hit = hitActionPin(m.cpx, m.cpy);
    if(hit >= 0) {
      saveUndoState();
      State.dragTarget = { type: 'actionDrag', idx: hit };
    } else {
      const best = findClosestPathPoint(m.cpx, m.cpy);
      if(best) {
        saveUndoState();
        State.actionPins.push({ x: best.x, y: best.y });
        State.dragTarget = { type: 'actionDrag', idx: State.actionPins.length - 1 };
        refresh();
      } else {
        flashStatus('Click on the route (salmon line) to place an action');
      }
    }
    return;
  }

  if(State.mode==='select'){
    // 1) nodes of the focused / active curve can be dragged to deform it
    const fi = focusedItem();
    const hotCurves = [fi && fi.curveId, State.activeCurveId].filter(v=>v!==null && v!==undefined);
    const hn0 = hotCurves.length ? hitAnyNode(m.cpx,m.cpy,hotCurves) : null;
    if(hn0){ startNodeDrag(hn0); return; }

    // 2) segments: add to route / focus / remove
    const hs=hitSegment(m.cpx,m.cpy);
    if(hs!==null){
      const seg=State.segments.find(s=>s.id===hs);
      const ri=routeIndexOfSeg(seg);
      if(ri>=0){
        if(e.shiftKey || e.altKey){
          saveUndoState(); State.route.splice(ri,1); State.focusUid=null; onRouteChanged();
        } else {
          State.focusUid=State.route[ri].uid; refresh();
        }
      } else {
        saveUndoState();
        const it=appendSeg(seg);
        State.focusUid=it.uid;
        onRouteChanged();
      }
      State.selNodeKey=null;
      return;
    }

    // 3) any other node
    const hn=hitAnyNode(m.cpx,m.cpy);
    if(hn){ startNodeDrag(hn); return; }

    State.selNodeKey=null; State.activeCurveId=null; State.focusUid=null;
    refresh();
    return;
  }
  if(State.mode==='freehand'){
    State.freehandPts = [{x: m.snapX, y: m.snapY}];
    return;
  }

  if(State.mode==='draw'){
    if(State.activeCurveId===null){
      saveUndoState();
      const c={id:State.curveIdCtr++,nodes:[{x:m.snapX,y:m.snapY}]};
      State.curves.push(c); State.activeCurveId=c.id;
      onCurvesChanged();
      return;
    }
    const c=State.curves.find(c=>c.id===State.activeCurveId);
    if(c) {
      saveUndoState();
      c.nodes.push({x:m.snapX,y:m.snapY});
      if(c.nodes.length===3) {
        State.activeCurveId=null;
      }
      onCurvesChanged();
    }
    return;
  }
});

function startNodeDrag(hn){
  State.selNodeKey=hn.cid+'-'+hn.ni;
  State.activeCurveId=hn.cid;
  State.dragTarget={type:'node',...hn};
  saveUndoState();
  refresh();
}

canvas.addEventListener('mousemove',e=>{
  const m=getXY(e);
  State.lastMouse=m;

  tooltip.textContent=`(${Math.round(m.snapX)}, ${Math.round(m.snapY)}) mm`;
  tooltip.style.left=(e.clientX+14)+'px';
  tooltip.style.top=(e.clientY+10)+'px';
  tooltip.classList.add('show');

  const ddx=m.cpx-State.mouseDownCpx,ddy=m.cpy-State.mouseDownCpy;
  if(ddx*ddx+ddy*ddy>16) State.mouseIsDragging=true;

  if(!State.dragTarget){
    if(State.mode==='freehand' && State.freehandPts){
      const last = State.freehandPts[State.freehandPts.length - 1];
      if (Math.hypot(m.snapX - last.x, m.snapY - last.y) > 10) {
        State.freehandPts.push({x: m.snapX, y: m.snapY});
      }
      draw(); return;
    }
    if(State.mode==='select'){
      const hs=hitSegment(m.cpx,m.cpy);
      if(hs!==State.hoverSegId) State.hoverSegId=hs;
      canvas.style.cursor = hs!==null ? 'pointer' : 'crosshair';
    } else canvas.style.cursor='crosshair';
    draw(); return;
  }

  if(State.dragTarget.type==='actionDrag'){
    const best = findClosestPathPoint(m.cpx, m.cpy);
    if(best) {
      State.actionPins[State.dragTarget.idx] = { x: best.x, y: best.y };
      refresh();
    }
    return;
  }

  if(State.dragTarget.type==='node'){
    const c=State.curves.find(c=>c.id===State.dragTarget.cid);
    if(!c) return;
    if (c.type === 'freehand') {
      const ni = State.dragTarget.ni;
      const dx = m.snapX - c.nodes[ni].x;
      const dy = m.snapY - c.nodes[ni].y;
      for (const p of c.pts) { p.x += dx; p.y += dy; }
      c.nodes[0].x += dx; c.nodes[0].y += dy;
      c.nodes[1].x += dx; c.nodes[1].y += dy;
    } else {
      c.nodes[State.dragTarget.ni].x=m.snapX;
      c.nodes[State.dragTarget.ni].y=m.snapY;
    }
    onCurvesChanged();return;
  }
});

canvas.addEventListener('mouseup',e=>{
  if(e.button === 2 || e.button === 1) return;
  State.dragTarget=null; State.mouseIsDragging=false;

  if(State.mode==='freehand' && State.freehandPts) {
    if(State.freehandPts.length > 1) {
      saveUndoState();
      const simplified = simplifyPoly(State.freehandPts, 3); // 3mm tolerance to keep it mostly smooth but not heavy
      if(simplified.length >= 2) {
        const c = {
          id: State.curveIdCtr++,
          type: 'freehand',
          pts: simplified,
          nodes: [ {x: simplified[0].x, y: simplified[0].y}, {x: simplified[simplified.length-1].x, y: simplified[simplified.length-1].y} ]
        };
        State.curves.push(c);
        onCurvesChanged();
      }
    }
    State.freehandPts = null;
    draw();
  }
});

canvas.addEventListener('mouseleave',()=>{
  State.dragTarget=null;State.mouseIsDragging=false;
  State.hoverSegId=null;State.lastMouse=null;
  State.freehandPts = null;
  tooltip.classList.remove('show');
  draw();
});

canvas.addEventListener('contextmenu',e=>{
  e.preventDefault();
  const m=getXY(e);
  
  if(State.mode==='action'){
    const hit = hitActionPin(m.cpx, m.cpy);
    if(hit >= 0) { saveUndoState(); State.actionPins.splice(hit, 1); refresh(); }
    return;
  }
  
  const hn=hitAnyNode(m.cpx,m.cpy);
  if(hn){
    saveUndoState();
    State.curves=State.curves.filter(c=>c.id!==hn.cid);
    if(State.activeCurveId===hn.cid) State.activeCurveId=null;
    if(State.selNodeKey&&State.selNodeKey.startsWith(hn.cid+'-')) State.selNodeKey=null;
    onCurvesChanged();
    return;
  }
  if(State.mode==='select'){
    const hs=hitSegment(m.cpx,m.cpy);
    if(hs!==null){
      const ri=routeIndexOfSeg(State.segments.find(s=>s.id===hs));
      if(ri>=0){ saveUndoState(); State.route.splice(ri,1); State.focusUid=null; onRouteChanged(); }
    }
  }
});

document.addEventListener('keydown',e=>{
  // Prevent shortcuts while typing
  if(e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA') return;

  if((e.key==='z' || e.key==='Z') && (e.ctrlKey || e.metaKey)){
    e.preventDefault();
    if(e.shiftKey) performRedo(onUndoRedoRestore); else performUndo(onUndoRedoRestore);
    return;
  }
  if((e.key==='y' || e.key==='Y') && (e.ctrlKey || e.metaKey)){
    e.preventDefault(); performRedo(onUndoRedoRestore); return;
  }
  if(e.ctrlKey || e.metaKey || e.altKey) return;

  if(e.key==='d' || e.key==='D'){ switchMode('draw'); return; }
  if(e.key==='f' || e.key==='F'){ switchMode('freehand'); return; }
  if(e.key==='s' || e.key==='S'){ switchMode('select'); return; }
  if(e.key==='a' || e.key==='A'){ switchMode('action'); return; }

  if(e.key==='Escape'){
    State.selNodeKey=null;
    if(State.mode==='draw' && State.activeCurveId!==null){
      const c=State.curves.find(c=>c.id===State.activeCurveId);
      if(c && c.nodes.length<3){
        saveUndoState();
        State.curves=State.curves.filter(cc=>cc.id!==State.activeCurveId);
      }
    }
    State.activeCurveId=null; State.focusUid=null;
    onCurvesChanged(); return;
  }

  const fi=focusedIdx();
  if(fi>=0){
    if(e.key==='ArrowUp'){ e.preventDefault(); State.focusUid=State.route[Math.max(0,fi-1)].uid; refresh(); return; }
    if(e.key==='ArrowDown'){ e.preventDefault(); State.focusUid=State.route[Math.min(State.route.length-1,fi+1)].uid; refresh(); return; }
    if(e.key==='r' || e.key==='R'){ reverseFocused(); return; }
  }

  if(e.key==='Delete'||e.key==='Backspace'){
    e.preventDefault();
    if(State.selNodeKey){
      saveUndoState();
      const[cid]=State.selNodeKey.split('-').map(Number);
      State.curves=State.curves.filter(c=>c.id!==cid);
      if(State.activeCurveId===cid) State.activeCurveId=null;
      State.selNodeKey=null; onCurvesChanged();
    } else if(fi>=0){
      removeRouteItem(fi);
    }
  }
});

// ==========================================================
//  Curve / Route Management
// ==========================================================
function finalizeCurve(){
  if(State.activeCurveId===null) return;
  const c=State.curves.find(c=>c.id===State.activeCurveId);
  if(c&&c.nodes.length<3){
    saveUndoState();
    State.curves=State.curves.filter(cc=>cc.id!==c.id);
  }
  State.activeCurveId=null;
  onCurvesChanged();
}

function onCurvesChanged(){ rebuildSegmentsAndIntersections(); remapRoute(); refresh(); }
function onRouteChanged(){ remapRoute(); refresh(); }
function onUndoRedoRestore(){ onCurvesChanged(); } // Full refresh upon undo/redo

function removeRouteItem(i){
  saveUndoState();
  State.route.splice(i,1);
  State.focusUid = State.route[Math.min(i, State.route.length-1)]?.uid ?? null;
  onRouteChanged();
}
function moveRouteItem(from,to){
  if(to<0||to>=State.route.length||from===to) return;
  saveUndoState();
  const [it]=State.route.splice(from,1);
  State.route.splice(to,0,it);
  onRouteChanged();
}
function reverseFocused(){
  const it=focusedItem();
  if(!it || it.kind!=='seg') return;
  saveUndoState(); it.rev=!it.rev; onRouteChanged();
}

let statusFlashTimer=null;
function flashStatus(msg){
  const txt=document.getElementById('status-text');
  txt.textContent=msg;
  clearTimeout(statusFlashTimer);
  statusFlashTimer=setTimeout(updateStatus,2200);
}

// ==========================================================
//  UI Updates
// ==========================================================
function updateStatePill(){
  const pill=document.getElementById('state-pill');
  if(State.mode==='action'){
    pill.className='state-pill selecting';
    pill.innerHTML='Click the route to place an Action (📍)<br>Drag ↕ to adjust ・ Right-click to delete';
    return;
  }
  if(State.mode==='draw'){
    pill.className='state-pill drawing';
    pill.innerHTML='Click Start → End → Middle<br>to draw a curve (straight: Middle on the line)';
  }else if(State.mode==='freehand'){
    pill.className='state-pill drawing';
    pill.innerHTML='Click and drag to draw a continuous freehand path.<br>It will be smoothed automatically.';
  }else{
    pill.className='state-pill selecting';
    pill.innerHTML='Click curves in driving order to build the route<br>Shift/right-click: remove 🗑 ・ Drag rows to reorder';
  }
}

function curveLabel(it){
  const ci=State.curves.findIndex(c=>c.id===it.curveId);
  const parts=State.segments.filter(s=>s.curveId===it.curveId).sort((a,b)=>a.tS-b.tS);
  const k=parts.findIndex(s=>Math.abs(s.tS-it.tS)<1e-6);
  return 'C'+(ci+1)+(parts.length>1?'・'+(k+1)+'/'+parts.length:'')+(it.rev?' ⟲':' ▶');
}
function itemLength(it, idx){
  if(it.kind==='seg'){ const p=segItemPts(it); return p?polyLen(p):0; }
  const pc=routePieces().find(pc=>pc.uid===it.uid);
  return pc?polyLen(pc.pts):0;
}

let dragFrom=null;
function updateRouteList(issues){
  const list=document.getElementById('route-list');
  list.innerHTML='';
  const bad=new Set(issues.filter(i=>i.idx>=0 && i.level!=='info').map(i=>i.idx));
  if(!State.route.length){
    const li=document.createElement('li');
    li.className='route-empty';
    li.innerHTML=State.segments.length
      ? 'Switch to <b>Select</b> and click curves in the order the robot should drive.'
      : 'Draw curves first (Draw mode).';
    list.appendChild(li);
  }
  State.route.forEach((it,i)=>{
    const li=document.createElement('li');
    li.draggable=true;
    li.className=(it.uid===State.focusUid?'focus ':'')+(bad.has(i)?'bad ':'')+(it.kind==='link'?'link':'');
    const name = it.kind==='link' ? 'Link (straight)' : curveLabel(it);
    const tags = (it.speed?`<span class="rt-tag spd">${it.speed}</span>`:'')
      + (it.ramp===false?'<span class="rt-tag">⏹${i+1}</span>`
      +`<span class="rt-name">${name} <span style="color:#aaa">${Math.round(itemLength(it,i))}</span></span>${tags}`
      +`<span class="item-del" title="Remove">&#215;</span>`;
    li.addEventListener('click',e=>{
      if(e.target.classList.contains('item-del')){ e.stopPropagation(); removeRouteItem(i); return; }
      State.focusUid=it.uid; refresh();
    });
    li.addEventListener('dragstart',e=>{ dragFrom=i; li.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
    li.addEventListener('dragend',()=>{ dragFrom=null; li.classList.remove('dragging'); });
    li.addEventListener('dragover',e=>{ e.preventDefault(); li.classList.add('drag-over'); });
    li.addEventListener('dragleave',()=>li.classList.remove('drag-over'));
    li.addEventListener('drop',e=>{
      e.preventDefault(); li.classList.remove('drag-over');
      if(dragFrom!==null) moveRouteItem(dragFrom,i);
    });
    list.appendChild(li);
  });

  const ri=document.getElementById('route-info');
  const plan=State.plan;
  if(plan && plan.pts.length>1){
    const col=State.showObs && polyCollides(plan.pts);
    const txt=`${Math.round(plan.total)} mm ・ {(plan.time/1000).toFixed(1)} s`;
    ri.innerHTML=col?'<span class="wo">'+txt+'</span>':'<span class="hi">'+txt+'</span>';
  } else ri.textContent='—';
}

function updateIssues(issues){
  const sec=document.getElementById('sec-issues');
  const list=document.getElementById('issue-list');
  sec.style.display=issues.length?'':'none';
  list.innerHTML='';
  issues.forEach(is=>{
    const li=document.createElement('li');
    li.className=is.level;
    li.innerHTML=`<span class="issue-dot"></span><span class="issue-msg">${is.msg}</span>`;
    if(is.fix){
      const b=document.createElement('button');
      b.className='issue-fix'; b.textContent=is.fix.label;
      b.addEventListener('click',()=>{ saveUndoState(); is.fix.fn(); onRouteChanged(); });
      li.appendChild(b);
    }
    li.querySelector('.issue-msg').addEventListener('click',()=>{
      if(is.idx>=0 && State.route[is.idx]){ State.focusUid=State.route[is.idx].uid; refresh(); }
    });
    list.appendChild(li);
  });
}

// Inspector -------------------------------------------------
let editing=false;
function beginEdit(){ if(!editing){ saveUndoState(); editing=true; } }
function endEdit(){ editing=false; }

function updateInspector(){
  const sec=document.getElementById('sec-inspector');
  const it=focusedItem();
  if(!it){ sec.style.display='none'; return; }
  sec.style.display='';
  const i=focusedIdx();
  document.getElementById('insp-title').textContent = '#'+(i+1)+'  '+(it.kind==='link'?'Link':curveLabel(it));
  document.getElementById('insp-len').textContent = Math.round(itemLength(it,i))+' mm';
  const custom=!!it.speed;
  document.getElementById('insp-speed-custom').checked=custom;
  const sl=document.getElementById('insp-speed');
  if(document.activeElement!==sl) sl.value = it.speed || State.speed;
  document.getElementById('insp-speed-wrap').classList.toggle('insp-disabled',!custom);
  document.getElementById('insp-ramp').checked = it.ramp!==false;
  document.getElementById('insp-stop').checked = !!it.stop;
  const pz=document.getElementById('insp-pause');
  if(document.activeElement!==pz) pz.value = it.pauseMs||0;
  document.getElementById('insp-pause-wrap').classList.toggle('insp-disabled',!it.stop);
  document.getElementById('insp-rev').disabled = it.kind!=='seg';
  document.getElementById('insp-up').disabled = i<=0;
  document.getElementById('insp-down').disabled = i>=State.route.length-1;
}

document.getElementById('insp-speed-custom').addEventListener('change',function(){
  const it=focusedItem(); if(!it) return;
  saveUndoState();
  it.speed = this.checked ? (+document.getElementById('insp-speed').value || State.speed) : null;
  refresh();
});
const inspSpeed=document.getElementById('insp-speed');
inspSpeed.addEventListener('pointerdown',beginEdit);
inspSpeed.addEventListener('keydown',beginEdit);
inspSpeed.addEventListener('change',endEdit);
inspSpeed.addEventListener('input',function(){
  const it=focusedItem(); if(!it) return;
  beginEdit(); it.speed=+this.value; refresh();
});
document.getElementById('insp-ramp').addEventListener('change',function(){
  const it=focusedItem(); if(!it) return;
  saveUndoState(); it.ramp=this.checked; refresh();
});
document.getElementById('insp-stop').addEventListener('change',function(){
  const it=focusedItem(); if(!it) return;
  saveUndoState(); it.stop=this.checked; refresh();
});
const inspPause=document.getElementById('insp-pause');
inspPause.addEventListener('focus',beginEdit);
inspPause.addEventListener('blur',endEdit);
inspPause.addEventListener('input',function(){
  const it=focusedItem(); if(!it) return;
  beginEdit(); it.pauseMs=Math.max(0,parseInt(this.value)||0); refresh();
});
document.getElementById('insp-up').addEventListener('click',()=>{ const i=focusedIdx(); if(i>0) moveRouteItem(i,i-1); });
document.getElementById('insp-down').addEventListener('click',()=>{ const i=focusedIdx(); if(i>=0) moveRouteItem(i,i+1); });
document.getElementById('insp-rev').addEventListener('click',reverseFocused);
document.getElementById('insp-del').addEventListener('click',()=>{ const i=focusedIdx(); if(i>=0) removeRouteItem(i); });

// Lists -----------------------------------------------------
function updateCurveList(){
  const list=document.getElementById('curve-list');
  list.innerHTML='';
  State.curves.forEach((c,ci)=>{
    const used=State.route.some(it=>it.curveId===c.id);
    const li=document.createElement('li');
    li.className=c.id===State.activeCurveId?'cur':'';
    li.innerHTML='<span class="item-idx">'+(ci+1)+'</span>'
      +'<span>C'+(ci+1)+' · '+(c.type === 'freehand' ? 'freehand' : (c.nodes.length<3?c.nodes.length+'/3 nodes':'curve'))+(used?' <span style="color:var(--ok)">✓</span>':'')+'</span>'
      +'<span class="item-del" data-id="'+c.id+'">&#215;</span>';
    li.style.cursor='pointer';
    li.addEventListener('click',e=>{
      if(e.target.classList.contains('item-del')) return;
      if(State.activeCurveId!==null&&State.activeCurveId!==c.id) finalizeCurve();
      State.activeCurveId=c.id; State.selNodeKey=null; refresh();
    });
    list.appendChild(li);
  });
  list.querySelectorAll('.item-del').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      saveUndoState();
      const id=+btn.dataset.id;
      State.curves=State.curves.filter(c=>c.id!==id);
      if(State.activeCurveId===id) State.activeCurveId=null;
      State.selNodeKey=null; onCurvesChanged();
    });
  });
}

function updateActionList(){
  const list=document.getElementById('action-list');
  list.innerHTML='';
  State.actionPins.forEach((pin,i)=>{
    const pr=State.plan&&State.plan.pts.length?projectOnPlan(State.plan,pin):null;
    const off=!pr||pr.d>PIN_ON_TOL;
    const li=document.createElement('li');
    li.innerHTML='<span class="item-idx">'+(i+1)+'</span><span>📍 (''+Math.round(pin.x)+', '+Math.round(pin.y)+')'
      +(off?' <span style="color:var(--warn)">off route</span>':'')+'</span>'
      +'<span class="item-del" data-idx="'+i+'">&#215;</span>';
    list.appendChild(li);
  });
  list.querySelectorAll('.item-del').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      saveUndoState();
      State.actionPins.splice(+btn.dataset.idx,1);
      refresh();
    });
  });
}

function updateStatus(issues){
  issues = issues || validateRoute();
  const dot=document.getElementById('status-dot');
  const txt=document.getElementById('status-text');
  const dist=document.getElementById('path-dist');
  const plan=State.plan;
  dist.textContent=plan&&plan.total>0?Math.round(plan.total)+' mm':'—';
  const col=State.showObs && plan && plan.pts.length>1 && polyCollides(plan.pts);
  const errs=issues.filter(i=>i.level==='err').length;
  const warns=issues.filter(i=>i.level==='warn').length;
  if(!plan || plan.pts.length<2){ dot.className='ok'; txt.textContent='Ready'; return; }
  dot.className=(col||errs||warns)?'warn':'ok';
  txt.textContent = col ? 'Collision!' : errs ? errs+' route problem'+(errs>1?'s':'') : warns ? warns+' warning'+(warns>1?'s':'') : 'Path OK';
}

function updateCode(){
  State.lastGeneratedCode = generateCode();
  document.getElementById('code-out').value = State.lastGeneratedCode.fullCode;
}

function refresh(){
  State.plan = buildPlan();
  const issues = validateRoute();
  draw(); updateStatePill(); updateCurveList(); updateRouteList(issues); updateIssues(issues);
  updateInspector(); updateActionList(); updateStatus(issues); updateCode();
}

function switchMode(m){
  State.mode=m;
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('[data-mode="'+m+'"]').classList.add('active');
  document.getElementById('sec-curves').style.display=(m==='draw')?'':'none';
  document.getElementById('sec-actions').style.display=(m==='action')?'':'none';
  State.hoverSegId=null;
  if (m === 'draw' || m === 'freehand') {
    const shouldSnap = (m === 'draw');
    document.getElementById('chk-snap').checked = shouldSnap;
    State.snapOn = shouldSnap;
  }
  if (m !== 'draw') finalizeCurve();
  refresh();
}

// ==========================================================
//  Controls Binding
// ==========================================================
document.querySelectorAll('.mode-btn').forEach(btn=>
  btn.addEventListener('click',()=>switchMode(btn.dataset.mode)));



document.getElementById('btn-clear-route').addEventListener('click',()=>{
  if(!State.route.length) return;
  saveUndoState(); State.route=[]; State.focusUid=null; stopSim(); refresh();
});

// Modal and Preferences Logic
const modal = document.getElementById('settings-modal-overlay');
document.getElementById('btn-open-settings').addEventListener('click', () => {
  // Sync state to inputs before showing
  document.getElementById('pref-port-x').value = State.prefPortX;
  document.getElementById('pref-port-y').value = State.prefPortY;
  document.getElementById('pref-wheel-x').value = State.prefWheelX;
  document.getElementById('pref-wheel-y').value = State.prefWheelY;
  document.getElementById('pref-gear-xm').value = State.prefGearXm;
  document.getElementById('pref-gear-xw').value = State.prefGearXw;
  document.getElementById('pref-gear-ym').value = State.prefGearYm;
  document.getElementById('pref-gear-yw').value = State.prefGearYw;
  document.getElementById('pref-calib-x').value = State.prefCalibX;
  document.getElementById('pref-calib-y').value = State.prefCalibY;
  document.getElementById('pref-backlash').value = State.prefBacklash;
  document.getElementById('pref-inv-x').checked = State.prefInvertX;
  document.getElementById('pref-inv-y').checked = State.prefInvertY;
  document.getElementById('pref-gyro').checked = State.prefUseGyro;
  document.getElementById('pref-defspeed').value = State.speed;
  document.getElementById('pref-accel').value = State.prefAccel;
  document.getElementById('pref-minspeed').value = State.prefMinSpeed;
  modal.classList.add('active');
});

function syncPreferencesFromUI() {
  const port = v => (/^[A-Fa-f]$/.test(v.trim()) ? v.trim().toUpperCase() : null);
  State.prefPortX = port(document.getElementById('pref-port-x').value) || 'A';
  State.prefPortY = port(document.getElementById('pref-port-y').value) || 'B';
  State.prefWheelX = parseFloat(document.getElementById('pref-wheel-x').value) || 56.0;
  State.prefWheelY = parseFloat(document.getElementById('pref-wheel-y').value) || 56.0;
  State.prefGearXm = parseFloat(document.getElementById('pref-gear-xm').value) || 1;
  State.prefGearXw = parseFloat(document.getElementById('pref-gear-xw').value) || 1;
  State.prefGearYm = parseFloat(document.getElementById('pref-gear-ym').value) || 1;
  State.prefGearYw = parseFloat(document.getElementById('pref-gear-yw').value) || 1;
  State.prefCalibX = parseFloat(document.getElementById('pref-calib-x').value) || 1.0;
  State.prefCalibY = parseFloat(document.getElementById('pref-calib-y').value) || 1.0;
  State.prefBacklash = Math.max(0, parseInt(document.getElementById('pref-backlash').value) || 0);
  State.prefInvertX = document.getElementById('pref-inv-x').checked;
  State.prefInvertY = document.getElementById('pref-inv-y').checked;
  State.prefUseGyro = document.getElementById('pref-gyro').checked;
  State.speed = Math.max(50, parseFloat(document.getElementById('pref-defspeed').value) || 300);
  State.prefAccel = Math.max(50, parseFloat(document.getElementById('pref-accel').value) || 600);
  State.prefMinSpeed = Math.max(10, parseFloat(document.getElementById('pref-minspeed').value) || 40);
  refresh();
}

document.getElementById('btn-close-modal').addEventListener('click', () => {
  syncPreferencesFromUI();
  modal.classList.remove('active');
});

// Close when clicking overlay background
modal.addEventListener('click', (e) => {
  if (e.target === modal) {
    syncPreferencesFromUI();
    modal.classList.remove('active');
  }
});

// Sync on any change while modal is open (so generated code updates real-time)
const prefInputs = [
  'pref-port-x', 'pref-port-y', 'pref-wheel-x', 'pref-wheel-y',
  'pref-gear-xm', 'pref-gear-xw', 'pref-gear-ym', 'pref-gear-yw',
  'pref-calib-x', 'pref-calib-y', 'pref-backlash',
  'pref-inv-x', 'pref-inv-y', 'pref-gyro', 'pref-defspeed', 'pref-accel', 'pref-minspeed'
];
prefInputs.forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', syncPreferencesFromUI);
});

document.getElementById('chk-snap').addEventListener('change',function(){
  State.snapOn=this.checked; draw();
});
document.getElementById('chk-obstacles').addEventListener('change',function(){
  State.showObs=this.checked; refresh();
});
document.getElementById('in-heading').addEventListener('input',function(){
  const v = parseInt(this.value) || 0;
  State.robotHeading = ((v % 360) + 360) % 360;
  refresh();
});

document.getElementById('btn-clear').addEventListener('click',()=>{
  if(!confirm("Are you sure you want to clear everything?")) return;
  saveUndoState();
  if(State.mode==='action') State.actionPins=[];
  else{
    State.curves=[];State.activeCurveId=null;State.selNodeKey=null;State.curveIdCtr=0;
    State.ixPoints=[];State.segments=[];State.route=[];State.focusUid=null;State.actionPins=[];
  }
  stopSim(); refresh();
});



document.getElementById('btn-sim-play').addEventListener('click',startSim);
document.getElementById('btn-sim-stop').addEventListener('click',stopSim);

document.getElementById('btn-copy').addEventListener('click',()=>{
  navigator.clipboard.writeText(State.lastGeneratedCode.fullCode).catch(()=>{
    const ta=document.getElementById('code-out'); ta.select(); document.execCommand('copy');
  });
  const btn=document.getElementById('btn-copy');
  btn.textContent='Copied!';
  setTimeout(()=>btn.textContent='Copy All',1500);
});
document.getElementById('btn-copy-path').addEventListener('click',()=>{
  navigator.clipboard.writeText(State.lastGeneratedCode.pathOnly).catch(()=>{
    const ta=document.createElement('textarea');
    ta.value=State.lastGeneratedCode.pathOnly;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  });
  const btn=document.getElementById('btn-copy-path');
  btn.textContent='Copied!';
  setTimeout(()=>btn.textContent='Copy Path',1500);
});

// Credits
document.getElementById('btn-credits').addEventListener('click',()=>{
  document.getElementById('credits-overlay').classList.add('show');
});
document.getElementById('btn-credits-close').addEventListener('click',()=>{
  document.getElementById('credits-overlay').classList.remove('show');
});
document.getElementById('credits-overlay').addEventListener('click',e=>{
  if(e.target===e.currentTarget) e.currentTarget.classList.remove('show');
});

// ==========================================================
//  Init
// ==========================================================
window.addEventListener('resize',()=>{
  clearTimeout(window._resizeTimer);
  window._resizeTimer = setTimeout(() => resizeCanvas(document.getElementById('pane-field'), draw), 50);
});
switchMode('draw');
requestAnimationFrame(()=>{ requestAnimationFrame(()=>resizeCanvas(document.getElementById('pane-field'), draw)); });

// expose for debugging in the console
window.GS = { State, refresh, validateRoute, buildPlan, newLinkItem, onCurvesChanged, switchMode, toCx, toCy };
