import { State } from './state.js';

// ════════════════════════════════════════════════════════════
//  Constants
// ════════════════════════════════════════════════════════════
export const FIELD_W    = 2362;
export const FIELD_H    = 1143;
export const OFFSET_X   = 181;
export const PIN_R      = 7;
export const SNAP_MM    = 100;
export const ROBOT_W    = 200;
export const ROBOT_H    = 200;
export const SEG_HIT    = 16;
export const NODE_HIT   = 10;
export const DISC_N     = 60;
export const SEG_PTS    = 50;
export const MATCH_TOL  = 8;
export const MIN_SEG_T  = 0.008;

export const OBSTACLES = [
  { x:-OFFSET_X, y:FIELD_H, w:FIELD_W, h:0, label:'' },
  { x:-OFFSET_X, y:0, w:FIELD_W, h:0, label:'' },
  { x:-OFFSET_X, y:0, w:0, h:FIELD_H, label:'' },
  { x:FIELD_W-OFFSET_X, y:0, w:0, h:FIELD_H, label:'' }
];

import { parseFLLMissions } from './missions.js';
export const MISSIONS = parseFLLMissions(FIELD_W, FIELD_H);
for (const m of MISSIONS) {
  OBSTACLES.push(m.aabb);
}

// ════════════════════════════════════════════════════════════
//  Bézier Math  (nodes = [start, end, control])
// ════════════════════════════════════════════════════════════
export function bzAt(p1, p2, cp, t){
  const m = 1 - t;
  return {
    x: m*m*p1.x + 2*m*t*cp.x + t*t*p2.x,
    y: m*m*p1.y + 2*m*t*cp.y + t*t*p2.y
  };
}
export function evalSpan(curve, t){
  if (curve.type === 'freehand') {
    if (t <= 0) return curve.pts[0];
    if (t >= 1) return curve.pts[curve.pts.length - 1];
    const L = polyLen(curve.pts);
    const target = L * t;
    let acc = 0;
    for (let i = 0; i + 1 < curve.pts.length; i++) {
      const segL = Math.hypot(curve.pts[i+1].x - curve.pts[i].x, curve.pts[i+1].y - curve.pts[i].y);
      if (acc + segL >= target) {
        const f = segL === 0 ? 0 : (target - acc) / segL;
        return {
          x: curve.pts[i].x + (curve.pts[i+1].x - curve.pts[i].x) * f,
          y: curve.pts[i].y + (curve.pts[i+1].y - curve.pts[i].y) * f
        };
      }
      acc += segL;
    }
    return curve.pts[curve.pts.length - 1];
  }
  if(curve.nodes.length < 3) {
    const p1 = curve.nodes[0], p2 = curve.nodes[1] || p1;
    return { x: p1.x + t*(p2.x - p1.x), y: p1.y + t*(p2.y - p1.y) };
  }
  return bzAt(curve.nodes[0], curve.nodes[1], curve.nodes[2], t);
}
export function evalGT(curve, gt){
  return evalSpan(curve, Math.max(0, Math.min(1, gt)));
}
export function discSpan(curve, n){
  const pts = [];
  for(let i=0; i<=n; i++) pts.push(evalSpan(curve, i/n));
  return pts;
}
// Sample a curve between tS..tE (optionally reversed)
export function samplePiece(curve, tS, tE, rev, n = SEG_PTS){
  const pts = [];
  for(let k=0;k<=n;k++) pts.push(evalGT(curve, tS+(tE-tS)*k/n));
  if(rev) pts.reverse();
  return pts;
}
export function polyLen(pts){
  let d=0;
  for(let i=0;i+1<pts.length;i++) d+=Math.hypot(pts[i+1].x-pts[i].x, pts[i+1].y-pts[i].y);
  return d;
}
export function simplifyPoly(pts, tol){
  if(pts.length <= 2) return pts;
  let maxDist = 0;
  let index = 0;
  const end = pts.length - 1;
  for (let i = 1; i < end; i++) {
    const d = pointLineDist(pts[i], pts[0], pts[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tol) {
    const left = simplifyPoly(pts.slice(0, index + 1), tol);
    const right = simplifyPoly(pts.slice(index), tol);
    return left.slice(0, left.length - 1).concat(right);
  } else {
    return [pts[0], pts[end]];
  }
}
function pointLineDist(p, a, b) {
  const num = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x);
  const den = Math.hypot(b.y - a.y, b.x - a.x);
  return den === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : num / den;
}
export function pointsToBezier(pts){
  if(pts.length < 2) return pts;
  if(pts.length === 2) return [pts[0], {x:(pts[0].x+pts[1].x)/2, y:(pts[0].y+pts[1].y)/2}, pts[1]];
  const nodes = [pts[0]];
  for(let i=1; i<pts.length-1; i++){
    nodes.push(pts[i]); // Control point
    if (i < pts.length - 2) {
      nodes.push({x: (pts[i].x + pts[i+1].x)/2, y: (pts[i].y + pts[i+1].y)/2}); // On-curve anchor
    }
  }
  nodes.push(pts[pts.length-1]);
  return nodes;
}

// ════════════════════════════════════════════════════════════
//  Intersection Detection
// ════════════════════════════════════════════════════════════
export function lineLine(p1,p2,p3,p4){
  const d1x=p2.x-p1.x,d1y=p2.y-p1.y;
  const d2x=p4.x-p3.x,d2y=p4.y-p3.y;
  const cross=d1x*d2y-d1y*d2x;
  if(Math.abs(cross)<1e-9) return null;
  const dx=p3.x-p1.x,dy=p3.y-p1.y;
  const tA=(dx*d2y-dy*d2x)/cross;
  const tB=(dx*d1y-dy*d1x)/cross;
  if(tA>0.001&&tA<0.999&&tB>0.001&&tB<0.999)
    return {x:p1.x+tA*d1x,y:p1.y+tA*d1y,tA,tB};
  return null;
}

export function findIntersections(){
  const spans=[];
  for(const c of State.curves){
    if(c.nodes.length < 3 && c.type !== 'freehand') continue;
    spans.push({cid:c.id, pts:discSpan(c, DISC_N)});
  }
  const res=[];
  for(let a=0;a<spans.length;a++){
    for(let b=a;b<spans.length;b++){
      const sa=spans[a],sb=spans[b];
      for(let i=0;i<DISC_N;i++){
        const jStart = (sa.cid===sb.cid) ? i + 5 : 0;
        for(let j=jStart;j<DISC_N;j++){
          const ix=lineLine(sa.pts[i],sa.pts[i+1],sb.pts[j],sb.pts[j+1]);
          if(!ix) continue;
          const gtA=(i+ix.tA)/DISC_N;
          const gtB=(j+ix.tB)/DISC_N;
          let dup=false;
          for(const ex of res){
            if(Math.abs(ex.x-ix.x)<MATCH_TOL&&Math.abs(ex.y-ix.y)<MATCH_TOL){dup=true;break;}
          }
          if(!dup) res.push({x:ix.x,y:ix.y,cidA:sa.cid,gtA,cidB:sb.cid,gtB});
        }
      }
    }
  }
  return res;
}

// ════════════════════════════════════════════════════════════
//  Segment Building  (curves are split at intersections)
// ════════════════════════════════════════════════════════════
export function curveSplits(cid){
  const splits=[0, 1];
  for(const ix of State.ixPoints){
    if(ix.cidA===cid) splits.push(ix.gtA);
    if(ix.cidB===cid) splits.push(ix.gtB);
  }
  splits.sort((a,b)=>a-b);
  const uniq=[splits[0]];
  for(let i=1;i<splits.length;i++){
    if(splits[i]-uniq[uniq.length-1]>MIN_SEG_T) uniq.push(splits[i]);
  }
  if(uniq[uniq.length-1] !== 1) uniq[uniq.length-1] = 1;
  return uniq;
}

export function buildSegments(){
  const res=[]; let sid=0;
  for(const c of State.curves){
    if(c.nodes.length < 3 && c.type !== 'freehand') continue;
    const uniq=curveSplits(c.id);
    for(let i=0;i+1<uniq.length;i++){
      const tS=uniq[i],tE=uniq[i+1];
      if(tE-tS<MIN_SEG_T) continue;
      res.push({id:sid++,curveId:c.id,tS,tE,pts:samplePiece(c,tS,tE,false)});
    }
  }
  return res;
}

export function rebuildSegmentsAndIntersections(){
  State.ixPoints = findIntersections();
  State.segments = buildSegments();
  State.hoverSegId = null;
}

// ════════════════════════════════════════════════════════════
//  Collision
// ════════════════════════════════════════════════════════════
export function segRectIx(ax,ay,bx,by,rx,ry,rw,rh){
  if(ax>rx&&ax<rx+rw&&ay>ry&&ay<ry+rh) return true;
  if(bx>rx&&bx<rx+rw&&by>ry&&by<ry+rh) return true;
  let tmin=0,tmax=1;
  const dx=bx-ax,dy=by-ay;
  for(const[p,q]of[[-dx,ax-rx],[dx,rx+rw-ax],[-dy,ay-ry],[dy,ry+rh-ay]]){
    if(p===0){if(q<=0) return false;continue;}
    const t=q/p;
    if(p<0) tmin=Math.max(tmin,t); else tmax=Math.min(tmax,t);
    if(tmin>=tmax) return false;
  }
  return true;
}
export function polyCollides(pts){
  for(let i=0;i+1<pts.length;i++){
    for(const obs of OBSTACLES){
      if(segRectIx(pts[i].x,pts[i].y,pts[i+1].x,pts[i+1].y,
         obs.x-ROBOT_W/2+0.01, obs.y-ROBOT_H/2+0.01, obs.w+ROBOT_W-0.02, obs.h+ROBOT_H-0.02)) return true;
    }
  }
  return false;
}

// ════════════════════════════════════════════════════════════
//  Robot frame helpers
//  heading H (deg, clockwise on screen).  Robot forward = (sinH, cosH),
//  robot right = (cosH, -sinH) in field coordinates.
// ════════════════════════════════════════════════════════════
export function toLocal(dx, dy, headingDeg){
  const A = headingDeg * Math.PI / 180, c = Math.cos(A), s = Math.sin(A);
  return { x: dx*c - dy*s, y: dx*s + dy*c };   // x = right, y = forward
}
export function toField(lx, ly, headingDeg){
  const A = headingDeg * Math.PI / 180, c = Math.cos(A), s = Math.sin(A);
  return { x: lx*c + ly*s, y: -lx*s + ly*c };
}
// motor degrees per mm of travel (gear = motor rotations : wheel rotations)
export function degPerMm(){
  const gx = State.prefGearXm / State.prefGearXw;
  const gy = State.prefGearYm / State.prefGearYw;
  return {
    x: 360 / (Math.PI * State.prefWheelX) * gx * State.prefCalibX,
    y: 360 / (Math.PI * State.prefWheelY) * gy * State.prefCalibY
  };
}
export const MOTOR_MAX_DEG_S = 1000;   // conservative SPIKE motor limit
