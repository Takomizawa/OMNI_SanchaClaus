// Global state and Undo/Redo manager

export const State = {
  // Config
  mode: 'draw',
  speed: 300,
  robotHeading: 0,
  snapOn: true,
  showObs: true,

  // Robot Preferences
  prefPortX: 'A',
  prefPortY: 'B',
  prefWheelX: 56.0,
  prefWheelY: 56.0,
  prefGearXm: 1, prefGearXw: 1,
  prefGearYm: 1, prefGearYw: 1,
  prefCalibX: 1.000,
  prefCalibY: 1.000,
  prefBacklash: 0,
  prefInvertX: false,
  prefInvertY: false,
  prefUseGyro: true,
  prefAccel: 600,      // mm/s^2  (max acceleration used for the speed profile)
  prefMinSpeed: 40,    // mm/s    (crawl speed when starting / arriving)

  // Actions
  actionPins: [],

  // Curve mode
  curves: [],
  curveIdCtr: 0,
  activeCurveId: null,
  selNodeKey: null,

  // Route (ordered list of items the robot will drive)
  //  { uid, kind:'seg'|'link', curveId, tS, tE, rev, speed(null=global), smooth, stopMs }
  route: [],
  routeUidCtr: 0,
  focusUid: null,

  // Derived (managed in main/math/route)
  ixPoints: [],
  segments: [],
  plan: null,

  // Interaction
  hoverSegId: null,
  dragTarget: null,
  mouseDownCpx: 0,
  mouseDownCpy: 0,
  mouseIsDragging: false,
  lastMouse: null,
  
  // View
  viewZoom: 1.0,
  zoomIndex: 0,
  cssPanX: 0,
  cssPanY: 0,
  ZOOM_LEVELS: [1.0, 1.25, 1.5, 1.75, 2.0],

  // Sim
  simRunning: false,
  simPos: null,
  simDuration: 0,
  simStartTime: null,

  // Code
  lastGeneratedCode: {fullCode:'', pathOnly:''}
};

// Undo/Redo History
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 50;

function cloneState() {
  return {
    actionPins: JSON.parse(JSON.stringify(State.actionPins)),
    curves: JSON.parse(JSON.stringify(State.curves)),
    curveIdCtr: State.curveIdCtr,
    route: JSON.parse(JSON.stringify(State.route)),
    routeUidCtr: State.routeUidCtr
  };
}

export function saveUndoState() {
  undoStack.push(cloneState());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  // Clear redo stack on new action
  redoStack.length = 0;
}

export function hasUndo() {
  return undoStack.length > 0;
}

export function performUndo(onRestore) {
  if (undoStack.length === 0) return;
  // Save current to redo
  redoStack.push(cloneState());
  const st = undoStack.pop();
  restoreState(st, onRestore);
}

export function performRedo(onRestore) {
  if (redoStack.length === 0) return;
  undoStack.push(cloneState());
  const st = redoStack.pop();
  restoreState(st, onRestore);
}

function restoreState(st, onRestore) {
  State.actionPins = JSON.parse(JSON.stringify(st.actionPins));
  State.curves = JSON.parse(JSON.stringify(st.curves));
  State.curveIdCtr = st.curveIdCtr;
  State.route = JSON.parse(JSON.stringify(st.route));
  State.routeUidCtr = st.routeUidCtr;
  
  // Reset active selections to prevent invalid states
  State.activeCurveId = null;
  State.selNodeKey = null;
  State.hoverSegId = null;
  if (!State.route.some(it => it.uid === State.focusUid)) State.focusUid = null;
  
  if (onRestore) onRestore();
}
