import { State } from './state.js';
import { draw } from './canvas.js';
import { planPoseAt } from './route.js';

// Plays State.plan in real time (uses the same speed profile as the robot code)
export function startSim(){
  const plan = State.plan;
  if(!plan || plan.pts.length < 2) return;
  State.simDuration = plan.time;
  State.simRunning = true;
  State.simStartTime = null;
  State.simPos = planPoseAt(plan, 0);
  document.getElementById('sim-progress-bar').style.width = '0%';
  requestAnimationFrame(stepSim);
}

export function stepSim(ts){
  if(!State.simRunning) return;
  if(!State.simStartTime) State.simStartTime = ts;
  const el = ts - State.simStartTime;
  const p = Math.min(el / Math.max(1, State.simDuration), 1);
  State.simPos = planPoseAt(State.plan, el);
  document.getElementById('sim-progress-bar').style.width = (p * 100) + '%';
  draw();
  if(p < 1) requestAnimationFrame(stepSim); else State.simRunning = false;
}

export function stopSim(){
  State.simRunning = false;
  State.simPos = null;
  document.getElementById('sim-progress-bar').style.width = '0%';
  draw();
}
