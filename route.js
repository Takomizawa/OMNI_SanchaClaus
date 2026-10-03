// ════════════════════════════════════════════════════════════
//  Route: ordered list of curve pieces the robot drives,
//  validation / auto-repair, and the motion (speed) profile.
// ════════════════════════════════════════════════════════════
import { State } from './state.js';
import { samplePiece, polyLen, polyCollides, MATCH_TOL } from './math.js';

export const GAP_TOL     = MATCH_TOL;   // mm: treated as connected
export const GAP_MINOR   = 40;          // mm: small gap -> auto bridged silently (warn)
export const PIN_ON_TOL  = 30;          // mm: action pin considered "on route"
export const HOME        = { x: 0, y: 0 };
const PLAN_STEP          = 10;          // mm resolution of the motion plan

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ── Item helpers ────────────────────────────────────────────
export function newSegItem(seg, rev){
  return { uid: State.routeUidCtr++, kind: 'seg', curveId: seg.curveId, tS: seg.tS, tE: seg.tE,
           rev: !!rev, speed: null, ramp: true, stop: false, pauseMs: 0 };
}
export function newLinkItem(){
  return { uid: State.routeUidCtr++, kind: 'link', speed: null, ramp: true, stop: false, pauseMs: 0 };
}
function curveOf(it){ return State.curves.find(c => c.id === it.curveId); }

export function segItemPts(it){
  const c = curveOf(it);
  if(!c || (c.nodes.length < 3 && c.type !== 'freehand')) return null;
  return samplePiece(c, it.tS, it.tE, it.rev);
}
export function itemEnds(it){
  const p = segItemPts(it);
  return p ? { s: p[0], e: p[p.length - 1] } : null;
}
export function routeIndexOfSeg(seg){
  return State.route.findIndex(it => it.kind === 'seg' && it.curveId === seg.curveId &&
    Math.abs(it.tS - seg.tS) < 1e-6 && Math.abs(it.tE - seg.tE) < 1e-6);
}

// Point where the route currently ends (used to orient newly added pieces)
export function routeTail(){
  for(let i = State.route.length - 1; i >= 0; i--){
    const it = State.route[i];
    if(it.kind === 'seg'){ const e = itemEnds(it); if(e) return e.e; }
  }
  return HOME;
}

// Append a segment, choosing the direction that connects best
export function appendSeg(seg){
  const tail = routeTail();
  const s = seg.pts[0], e = seg.pts[seg.pts.length - 1];
  const rev = dist(e, tail) < dist(s, tail);
  const it = newSegItem(seg, rev);
  State.route.push(it);
  return it;
}

// ── Keep route valid after curves are edited / re-split ─────
export function remapRoute(){
  const out = [];
  for(const it of State.route){
    if(it.kind === 'link'){ out.push(it); continue; }
    const segs = State.segments.filter(s => s.curveId === it.curveId);
    if(!segs.length) continue;                              // curve deleted
    let inside = segs.filter(s => {
      const m = (s.tS + s.tE) / 2;
      return m > it.tS - 1e-6 && m < it.tE + 1e-6;
    });
    if(!inside.length){
      const m = (it.tS + it.tE) / 2;
      const best = segs.reduce((b, s) => {
        const d = Math.abs((s.tS + s.tE) / 2 - m);
        return (!b || d < b.d) ? { s, d } : b;
      }, null);
      inside = [best.s];
    }
    inside.sort((a, b) => a.tS - b.tS);
    if(it.rev) inside.reverse();
    inside.forEach((s, k) => {
      const copy = k === 0 ? it : { ...it, uid: State.routeUidCtr++ };
      copy.tS = s.tS; copy.tE = s.tE;
      // only the last piece keeps the "stop at end" behaviour
      if(k < inside.length - 1){ copy.stop = false; copy.pauseMs = 0; }
      out.push(copy);
    });
  }
  // remove consecutive duplicates (intersection disappeared -> pieces merged)
  const dedup = [];
  for(const it of out){
    const p = dedup[dedup.length - 1];
    if(p && p.kind === 'seg' && it.kind === 'seg' && p.curveId === it.curveId &&
       Math.abs(p.tS - it.tS) < 1e-6 && Math.abs(p.tE - it.tE) < 1e-6 && p.rev === it.rev){
      p.stop = p.stop || it.stop; p.pauseMs = Math.max(p.pauseMs, it.pauseMs);
      continue;
    }
    dedup.push(it);
  }
  // links at the very end or doubled links are meaningless
  const clean = dedup.filter((it, i) =>
    !(it.kind === 'link' && (i === dedup.length - 1 || (dedup[i + 1] && dedup[i + 1].kind === 'link'))));
  State.route = clean;
  if(!State.route.some(it => it.uid === State.focusUid)) State.focusUid = null;
}

// ── Geometry of the whole route (with link / gap bridging) ──
// returns pieces: {uid, kind, pts, item, implicit}
export function routePieces(){
  const pieces = [];
  let cursor = null;
  const R = State.route;
  for(let i = 0; i < R.length; i++){
    const it = R[i];
    if(it.kind === 'link'){
      const nxt = R.slice(i + 1).find(x => x.kind === 'seg');
      const ne = nxt && itemEnds(nxt);
      if(!ne) continue;
      if(cursor) {
        pieces.push({ uid: it.uid, kind: 'link', item: it, pts: [cursor, ne.s] });
      }
      cursor = ne.s;
      continue;
    }
    const pts = segItemPts(it);
    if(!pts) continue;
    if(cursor) {
      const gap = dist(cursor, pts[0]);
      if(gap > GAP_TOL){
        // implicit straight bridge so the robot can physically get there
        pieces.push({ uid: null, kind: 'gap', item: null, implicit: true, pts: [cursor, pts[0]] });
      }
    }
    pieces.push({ uid: it.uid, kind: 'seg', item: it, pts });
    cursor = pts[pts.length - 1];
  }
  return pieces;
}

// ── Validation (warnings + fixes) ───────────────────────────
// issue: {level:'err'|'warn'|'info', idx, msg, fix:{label, fn}}
export function validateRoute(){
  const issues = [];
  const R = State.route;
  let cursor = HOME, cursorLabel = 'Home';
  for(let i = 0; i < R.length; i++){
    const it = R[i];
    if(it.kind === 'link'){
      const nxt = R.slice(i + 1).find(x => x.kind === 'seg');
      const ne = nxt && itemEnds(nxt);
      if(ne){ cursor = ne.s; }
      cursorLabel = '#' + (i + 1);
      continue;
    }
    const ends = itemEnds(it);
    if(!ends) continue;
    const prevIsLink = i > 0 && R[i - 1].kind === 'link';
    const gap = dist(cursor, ends.s);
    if(!prevIsLink && gap > GAP_TOL){
      const revGap = dist(cursor, ends.e);
      const idx = i;
      if(revGap <= GAP_TOL){
        issues.push({ level: 'err', idx, msg: `#${i + 1} is reversed (end touches ${cursorLabel})`,
          fix: { label: 'Reverse', fn: () => { R[idx].rev = !R[idx].rev; } } });
      } else if(gap <= GAP_MINOR){
        issues.push({ level: 'info', idx, msg: `${Math.round(gap)} mm gap before #${i + 1} (auto-bridged)`,
          fix: { label: 'Insert link', fn: () => { R.splice(idx, 0, newLinkItem()); } } });
      } else {
        const fixes = [];
        // maybe a later item would continue the chain: suggest moving it here
        const j = R.findIndex((x, k) => k > idx && x.kind === 'seg' && (() => {
          const e = itemEnds(x); return e && (dist(e.s, cursor) <= GAP_TOL || dist(e.e, cursor) <= GAP_TOL);
        })());
        const msg = i === 0 && cursorLabel === 'Home'
          ? `Route starts ${Math.round(gap)} mm away from robot home`
          : `${Math.round(gap)} mm jump between ${cursorLabel} and #${i + 1}`;
        if(j > 0){
          issues.push({ level: 'err', idx, msg: msg + ` — #${j + 1} connects here`,
            fix: { label: `Move #${j + 1} here`, fn: () => {
              const [mv] = R.splice(j, 1);
              const e = itemEnds(mv);
              if(e && dist(e.e, cursor) < dist(e.s, cursor)) mv.rev = !mv.rev;
              R.splice(idx, 0, mv);
            } } });
        } else {
          issues.push({ level: i === 0 ? 'warn' : 'err', idx, msg: msg + ' (driven straight)',
            fix: { label: 'Insert link', fn: () => { R.splice(idx, 0, newLinkItem()); } } });
        }
      }
    }
    cursor = ends.e; cursorLabel = '#' + (i + 1);
  }

  // collisions per piece
  if(State.showObs){
    R.forEach((it, i) => {
      const pts = it.kind === 'seg' ? segItemPts(it) : null;
      if(pts && polyCollides(pts)) issues.push({ level: 'warn', idx: i, msg: `#${i + 1} touches the wall zone`, fix: null });
    });
  }

  // action pins far from the route
  const plan = State.plan;
  State.actionPins.forEach((p, k) => {
    const pr = plan ? projectOnPlan(plan, p) : null;
    if(!pr || pr.d > PIN_ON_TOL){
      issues.push({ level: 'warn', idx: -1, pin: k,
        msg: `Action ★${k + 1} is ${pr ? Math.round(pr.d) + ' mm' : ''} off the route`,
        fix: pr ? { label: 'Snap onto route', fn: () => { State.actionPins[k] = { ...State.actionPins[k], x: pr.x, y: pr.y }; } } : null });
    }
  });
  return issues;
}

export function autoFixAll(){
  // Apply fixes repeatedly (each fix can change indexes)
  for(let guard = 0; guard < 50; guard++){
    const fx = validateRoute().find(is => is.fix && is.level !== 'warn' || (is.fix && is.pin !== undefined));
    if(!fx) break;
    fx.fix.fn();
    State.plan = buildPlan();
  }
}

// ── Motion plan ─────────────────────────────────────────────
// Dense polyline with arc length, speed cap and timing.
// point: {x,y,s,vmax,v,t,stopMs(at this point), action(index|undefined), uid}
export function buildPlan(){
  const pieces = routePieces();
  const pts = [];
  const gSpeed = State.speed;
  const aMax = Math.max(50, State.prefAccel);
  const vMin = Math.max(10, Math.min(State.prefMinSpeed, gSpeed));

  for(const pc of pieces){
    const it = pc.item;
    const vCap = it && it.speed ? it.speed : gSpeed;
    const ramp = it ? it.ramp !== false : true;
    // resample to PLAN_STEP
    const L = polyLen(pc.pts);
    if(L < 0.5) continue;
    const n = Math.max(1, Math.ceil(L / PLAN_STEP));
    const res = resample(pc.pts, n);
    for(let k = 0; k < res.length; k++){
      if(pts.length && k === 0) {
        // boundary point: the stricter cap wins, keep previous ramp/stop
        const last = pts[pts.length - 1];
        last.vmax = Math.min(last.vmax, vCap);
        last.ramp = last.ramp && ramp;
        continue;
      }
      pts.push({ x: res[k].x, y: res[k].y, vmax: vCap, ramp, uid: pc.uid, stopMs: 0, kind: pc.kind });
    }
    if(it && it.stop) pts[pts.length - 1].stopMs = Math.max(1, it.pauseMs | 0);
  }
  if(pts.length < 2) return { pts: [], total: 0, time: 0, actions: [] };

  // arc length
  pts[0].s = 0;
  for(let i = 1; i < pts.length; i++) pts[i].s = pts[i - 1].s + dist(pts[i], pts[i - 1]);

  // action pins -> stop points on the plan
  const actions = [];
  State.actionPins.forEach((p, k) => {
    const pr = projectOnPlanIdx(pts, p);
    if(pr && pr.d <= PIN_ON_TOL){
      const P = pts[pr.i];
      P.stopMs = Math.max(P.stopMs, 1);
      P.action = k + 1;
      actions.push({ n: k + 1, s: P.s });
    }
  });

  // curvature / corner limit (omni: direction change at speed = slip)
  for(let i = 1; i + 1 < pts.length; i++){
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
    const la = Math.hypot(ux, uy), lb = Math.hypot(vx, vy);
    if(la < 1e-6 || lb < 1e-6) continue;
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (la * lb)));
    const ang = Math.acos(cos);
    if(ang < 1e-3) continue;
    if(ang > Math.PI / 3){ b.vmax = Math.min(b.vmax, vMin); continue; }   // sharp corner
    const R = ((la + lb) / 2) / ang;                                      // local radius
    b.vmax = Math.min(b.vmax, Math.max(vMin, Math.sqrt(aMax * R)));
  }

  // start / stops / end are zero-speed (we use vMin as crawl to avoid stall)
  pts[0].vmax = Math.min(pts[0].vmax, vMin);
  pts[pts.length - 1].vmax = Math.min(pts[pts.length - 1].vmax, vMin);
  pts[pts.length - 1].stopMs = Math.max(pts[pts.length - 1].stopMs, 1);
  for(const p of pts) if(p.stopMs) p.vmax = Math.min(p.vmax, vMin);

  // forward pass (acceleration)
  pts[0].v = pts[0].vmax;
  for(let i = 1; i < pts.length; i++){
    const ds = pts[i].s - pts[i - 1].s;
    const lim = pts[i].ramp ? Math.sqrt(pts[i - 1].v ** 2 + 2 * aMax * ds) : Infinity;
    pts[i].v = Math.min(pts[i].vmax, lim);
  }
  // backward pass (deceleration)
  for(let i = pts.length - 2; i >= 0; i--){
    const ds = pts[i + 1].s - pts[i].s;
    const lim = pts[i + 1].ramp ? Math.sqrt(pts[i + 1].v ** 2 + 2 * aMax * ds) : Infinity;
    pts[i].v = Math.min(pts[i].v, lim);
  }
  // timing
  pts[0].t = 0;
  for(let i = 1; i < pts.length; i++){
    const ds = pts[i].s - pts[i - 1].s;
    const vAvg = Math.max(1, (pts[i].v + pts[i - 1].v) / 2);
    pts[i].t = pts[i - 1].t + ds / vAvg * 1000 + (pts[i - 1].stopMs > 1 ? pts[i - 1].stopMs : 0);
  }
  const last = pts[pts.length - 1];
  return { pts, total: last.s, time: last.t, actions };
}

function resample(poly, n){
  const L = polyLen(poly), out = [];
  let seg = 0, acc = 0;
  for(let k = 0; k <= n; k++){
    const target = L * k / n;
    while(seg < poly.length - 2 && acc + dist(poly[seg], poly[seg + 1]) < target){
      acc += dist(poly[seg], poly[seg + 1]); seg++;
    }
    const sl = dist(poly[seg], poly[seg + 1]) || 1;
    const f = Math.max(0, Math.min(1, (target - acc) / sl));
    out.push({ x: poly[seg].x + (poly[seg + 1].x - poly[seg].x) * f,
               y: poly[seg].y + (poly[seg + 1].y - poly[seg].y) * f });
  }
  return out;
}

function projectOnPlanIdx(pts, p){
  let best = null;
  for(let i = 0; i < pts.length; i++){
    const d = dist(pts[i], p);
    if(!best || d < best.d) best = { i, d };
  }
  return best;
}
export function projectOnPlan(plan, p){
  const pts = plan.pts;
  let best = null;
  for(let i = 0; i + 1 < pts.length; i++){
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    if(l2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const x = a.x + t * dx, y = a.y + t * dy, d = Math.hypot(p.x - x, p.y - y);
    if(!best || d < best.d) best = { x, y, d };
  }
  return best;
}

// Position at time t (ms) along the plan (for the simulator)
export function planPoseAt(plan, tms){
  const P = plan.pts;
  if(!P.length) return null;
  if(tms <= 0) return { x: P[0].x, y: P[0].y, v: P[0].v, i: 0 };
  for(let i = 1; i < P.length; i++){
    if(P[i].t >= tms){
      const pause = P[i - 1].stopMs > 1 ? P[i - 1].stopMs : 0;
      const t0 = P[i - 1].t + pause;
      if(tms <= t0) return { x: P[i - 1].x, y: P[i - 1].y, v: 0, i: i - 1, paused: true };
      const f = (tms - t0) / Math.max(1e-6, P[i].t - t0);
      return { x: P[i - 1].x + (P[i].x - P[i - 1].x) * f, y: P[i - 1].y + (P[i].y - P[i - 1].y) * f,
               v: P[i - 1].v + (P[i].v - P[i - 1].v) * f, i: i - 1 };
    }
  }
  const L = P[P.length - 1];
  return { x: L.x, y: L.y, v: 0, i: P.length - 1 };
}
