/**
 * ai.ts — Guard and Police AI system
 *
 * Guards patrol waypoints, detect the player with a view cone, and dispatch
 * Police when the player is spotted at close range.
 *
 * Police pathfind to the Suspicion Square, then random-patrol within a radius.
 * They are the only units that can arrest the player.
 *
 * All distances, timers, and radii are configurable in AI_CONFIG below.
 */
import { TILE, MAP_ROWS, MAP_COLS } from "./constants";

// ─── Configuration ────────────────────────────────────────────────────────────

export const AI_CONFIG = {
  // ── Guard ──────────────────────────────────────────────────────────────────
  /** Guard patrol speed (px/s) */
  GUARD_SPEED: 60,
  /** Guard view cone range (grid units) */
  GUARD_VIEW_RANGE: 6,
  /** Half-angle of guard view cone (radians). 30° → 60° total cone. */
  GUARD_VIEW_HALF_ANGLE: Math.PI / 6,
  /** Immediate detection range (grid units): spots player + dispatches police */
  GUARD_IMMEDIATE_RANGE: 3,
  /** Suspicious range (grid units): guard becomes suspicious but keeps patrolling */
  GUARD_SUSPICIOUS_RANGE: 5,

  // ── Police ─────────────────────────────────────────────────────────────────
  /** Police movement speed (px/s) */
  POLICE_SPEED: 100,
  /** Police view cone range (grid units) */
  POLICE_VIEW_RANGE: 6,
  /** Half-angle of police view cone (radians) */
  POLICE_VIEW_HALF_ANGLE: Math.PI / 6,
  /** Search patrol radius (tiles) around the Suspicion Square */
  POLICE_SEARCH_RADIUS: 7,
  /** Seconds to wait at each search location before choosing the next */
  POLICE_SEARCH_COOLDOWN: 10,
  /** Retry delay (seconds) when chosen search tile is invalid */
  POLICE_SEARCH_RETRY: 5,
  /** Seconds without any sighting before police despawn */
  POLICE_DESPAWN_TIME: 120,
  /** Distance (grid units) at which police arrests the player */
  POLICE_ARREST_RANGE: 0.9,
} as const;

// ─── Guard patrol definitions ──────────────────────────────────────────────────
// Each entry is a list of waypoints for one guard.
// Guards bounce back and forth between the first and last waypoint.
export const GUARD_PATROLS: Array<Array<{ col: number; row: number }>> = [
  // Guard 1 — patrols the full hallway east–west (row 6)
  [
    { col: 2,  row: 6 },
    { col: 23, row: 6 },
  ],
];

// ─── Police spawn point ────────────────────────────────────────────────────────
// Where police appear when dispatched by a guard.
export const POLICE_SPAWN_POINT = { col: 13, row: 6 };

// ─── Types ────────────────────────────────────────────────────────────────────

export type GuardState = "patrol" | "suspicious" | "spotted";

export interface Guard {
  id: number;
  waypoints: Array<{ col: number; row: number }>;
  waypointIdx: number;
  waypointDir: 1 | -1;
  x: number;
  y: number;
  /** Standard math angle: 0=east, PI/2=south, PI=west, -PI/2=north */
  mathFacing: number;
  state: GuardState;
  /** True once police has been dispatched for this spotted event */
  dispatched: boolean;
}

export type PoliceState = "approaching" | "chasing" | "searching";

export interface Police {
  id: number;
  x: number;
  y: number;
  mathFacing: number;
  state: PoliceState;
  /** Remaining A* path (tile coordinates, excluding current position) */
  path: Array<{ col: number; row: number }>;
  /** The original suspicion square (the anchor for search radius) */
  suspicionCol: number;
  suspicionRow: number;
  /** Last known player position while chasing (updates to the player when seen) */
  lastKnownPlayerCol: number;
  lastKnownPlayerRow: number;
  /** Seconds until next search waypoint is chosen (counts down while standing) */
  searchCooldown: number;
  /** Seconds since any guard or police last sighted the player */
  timeSinceLastSighting: number;
}

export interface SuspicionMarker {
  col: number;
  row: number;
}

// ─── A* pathfinder ────────────────────────────────────────────────────────────
// Treats only wall tiles (value === 1) as blocked.
// Doors and furniture are walkable so police can navigate the full building.

interface ANode {
  col: number; row: number;
  g: number; h: number;
  parent: ANode | null;
}

function aStar(
  fromCol: number, fromRow: number,
  toCol: number,   toRow: number,
  map: number[][]
): Array<{ col: number; row: number }> {
  if (fromCol === toCol && fromRow === toRow) return [];

  const key = (c: number, r: number) => c * 1000 + r;
  const h   = (c: number, r: number) => Math.abs(c - toCol) + Math.abs(r - toRow);

  const open: ANode[]      = [];
  const closed             = new Set<number>();
  const openMap            = new Map<number, ANode>();

  const start: ANode = { col: fromCol, row: fromRow, g: 0, h: h(fromCol, fromRow), parent: null };
  open.push(start);
  openMap.set(key(fromCol, fromRow), start);

  const DIRS = [
    { dc: 0, dr: -1 }, { dc: 1, dr: 0 },
    { dc: 0, dr:  1 }, { dc: -1, dr: 0 },
  ];

  while (open.length > 0) {
    // Pop node with lowest f = g + h
    let bi = 0, bf = open[0].g + open[0].h;
    for (let i = 1; i < open.length; i++) {
      const f = open[i].g + open[i].h;
      if (f < bf) { bf = f; bi = i; }
    }
    const cur = open.splice(bi, 1)[0];
    openMap.delete(key(cur.col, cur.row));

    if (cur.col === toCol && cur.row === toRow) {
      const path: Array<{ col: number; row: number }> = [];
      let n: ANode | null = cur;
      while (n) { path.unshift({ col: n.col, row: n.row }); n = n.parent; }
      return path.slice(1); // exclude starting tile
    }

    closed.add(key(cur.col, cur.row));

    for (const { dc, dr } of DIRS) {
      const nc = cur.col + dc, nr = cur.row + dr;
      if (nr < 0 || nr >= MAP_ROWS || nc < 0 || nc >= MAP_COLS) continue;
      if (map[nr][nc] === 1) continue; // wall only
      const k = key(nc, nr);
      if (closed.has(k)) continue;
      const g = cur.g + 1;
      const existing = openMap.get(k);
      if (!existing || g < existing.g) {
        const node: ANode = { col: nc, row: nr, g, h: h(nc, nr), parent: cur };
        if (!existing) open.push(node);
        openMap.set(k, node);
      }
    }
  }
  return []; // no path found
}

// ─── Line of sight ────────────────────────────────────────────────────────────

function hasLOS(
  x1: number, y1: number,
  x2: number, y2: number,
  map: number[][]
): boolean {
  const dx = x2 - x1, dy = y2 - y1;
  const steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) / (TILE * 0.25));
  for (let i = 1; i < steps; i++) {
    const t   = i / steps;
    const col = Math.floor((x1 + dx * t) / TILE);
    const row = Math.floor((y1 + dy * t) / TILE);
    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return false;
    if (map[row][col] === 1) return false;
  }
  return true;
}

// ─── View-cone detection ───────────────────────────────────────────────────────

function normalizeAngle(a: number): number {
  while (a >  Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

interface ConeResult {
  inCone: boolean;
  /** Distance from observer to target in grid units */
  distance: number;
}

function checkCone(
  observerX: number, observerY: number,
  mathFacing: number, halfAngle: number, rangeTiles: number,
  targetX: number, targetY: number,
  map: number[][]
): ConeResult {
  const dx = targetX - observerX, dy = targetY - observerY;
  const distance = Math.sqrt(dx * dx + dy * dy) / TILE;
  if (distance > rangeTiles) return { inCone: false, distance };
  const diff = Math.abs(normalizeAngle(Math.atan2(dy, dx) - mathFacing));
  if (diff > halfAngle)    return { inCone: false, distance };
  if (!hasLOS(observerX, observerY, targetX, targetY, map))
    return { inCone: false, distance };
  return { inCone: true, distance };
}

// ─── Movement helper ──────────────────────────────────────────────────────────

function moveToward(
  unit: { x: number; y: number; mathFacing: number },
  targetX: number, targetY: number,
  speed: number, dt: number
): boolean {
  const dx = targetX - unit.x, dy = targetY - unit.y;
  const d  = Math.sqrt(dx * dx + dy * dy);
  if (d < 2) return true;
  unit.mathFacing = Math.atan2(dy, dx);
  const step = Math.min(speed * dt, d);
  unit.x += (dx / d) * step;
  unit.y += (dy / d) * step;
  return false;
}

// ─── Initialization ───────────────────────────────────────────────────────────

export function initGuards(): Guard[] {
  return GUARD_PATROLS.map((waypoints, idx) => {
    const start  = waypoints[0];
    const target = waypoints[1] ?? start;
    return {
      id: idx,
      waypoints,
      waypointIdx: 0,
      waypointDir: 1,
      x: start.col * TILE + TILE / 2,
      y: start.row * TILE + TILE / 2,
      mathFacing: Math.atan2(target.row - start.row, target.col - start.col),
      state: "patrol" as GuardState,
      dispatched: false,
    };
  });
}

export function spawnPolice(
  suspicionCol: number, suspicionRow: number,
  map: number[][]
): Police {
  const { col: sc, row: sr } = POLICE_SPAWN_POINT;
  const path = aStar(sc, sr, suspicionCol, suspicionRow, map);
  return {
    id: Date.now(),
    x:  sc * TILE + TILE / 2,
    y:  sr * TILE + TILE / 2,
    mathFacing: 0,
    state: "approaching",
    path,
    suspicionCol,
    suspicionRow,
    lastKnownPlayerCol: suspicionCol,
    lastKnownPlayerRow: suspicionRow,
    searchCooldown: 0,
    timeSinceLastSighting: 0,
  };
}

// ─── Update: Guards ───────────────────────────────────────────────────────────

export interface GuardUpdateResult {
  shouldSpawnPolice: boolean;
  suspicionCol: number;
  suspicionRow: number;
  playerSeenByGuard: boolean;
}

export function updateGuards(
  guards: Guard[],
  playerX: number, playerY: number,
  map: number[][],
  dt: number
): GuardUpdateResult {
  let shouldSpawnPolice = false;
  let suspicionCol = 0, suspicionRow = 0;
  let playerSeenByGuard = false;

  for (const guard of guards) {
    const { inCone, distance } = checkCone(
      guard.x, guard.y,
      guard.mathFacing,
      AI_CONFIG.GUARD_VIEW_HALF_ANGLE,
      AI_CONFIG.GUARD_VIEW_RANGE,
      playerX, playerY, map
    );

    // ── State machine ────────────────────────────────────────────────────────
    if (inCone && distance <= AI_CONFIG.GUARD_IMMEDIATE_RANGE) {
      playerSeenByGuard = true;
      guard.state = "spotted";
      if (!guard.dispatched) {
        guard.dispatched     = true;
        shouldSpawnPolice    = true;
        suspicionCol = Math.floor(playerX / TILE);
        suspicionRow = Math.floor(playerY / TILE);
      }
    } else if (inCone && distance <= AI_CONFIG.GUARD_SUSPICIOUS_RANGE) {
      playerSeenByGuard = true;
      guard.state = "suspicious";
    } else {
      // Player not in cone — return to patrol and reset dispatch flag
      guard.state      = "patrol";
      guard.dispatched = false;
    }

    // ── Spotted: face player, stop moving ─────────────────────────────────
    if (guard.state === "spotted") {
      guard.mathFacing = Math.atan2(playerY - guard.y, playerX - guard.x);
      continue;
    }

    // ── Patrol movement ───────────────────────────────────────────────────
    const target = guard.waypoints[guard.waypointIdx];
    const tx = target.col * TILE + TILE / 2;
    const ty = target.row * TILE + TILE / 2;
    const reached = moveToward(guard, tx, ty, AI_CONFIG.GUARD_SPEED, dt);

    if (reached) {
      guard.x = tx; guard.y = ty;
      const next = guard.waypointIdx + guard.waypointDir;
      if (next < 0 || next >= guard.waypoints.length) {
        guard.waypointDir = guard.waypointDir === 1 ? -1 : 1;
        guard.waypointIdx += guard.waypointDir;
      } else {
        guard.waypointIdx = next;
      }
    }
  }

  return { shouldSpawnPolice, suspicionCol, suspicionRow, playerSeenByGuard };
}

// ─── Update: Police ───────────────────────────────────────────────────────────

export interface PoliceUpdateResult {
  arrested: boolean;
}

export function updatePolice(
  policeList: Police[],
  playerX: number, playerY: number,
  map: number[][],
  dt: number,
  playerSeenByGuard: boolean
): PoliceUpdateResult {
  let arrested = false;

  // Per-police sight check so each unit can decide independently whether to chase
  const seenByAnyPolice = policeList.some(p =>
    checkCone(p.x, p.y, p.mathFacing,
      AI_CONFIG.POLICE_VIEW_HALF_ANGLE,
      AI_CONFIG.POLICE_VIEW_RANGE,
      playerX, playerY, map
    ).inCone
  );
  const anySighting = playerSeenByGuard || seenByAnyPolice;

  for (let i = policeList.length - 1; i >= 0; i--) {
    const police = policeList[i];
    const policeSees = checkCone(
      police.x, police.y, police.mathFacing,
      AI_CONFIG.POLICE_VIEW_HALF_ANGLE,
      AI_CONFIG.POLICE_VIEW_RANGE,
      playerX, playerY, map
    ).inCone;

    // ── Arrest check (always active) ────────────────────────────────────
    const distPx = Math.sqrt((playerX - police.x) ** 2 + (playerY - police.y) ** 2);
    if (distPx / TILE <= AI_CONFIG.POLICE_ARREST_RANGE) {
      arrested = true;
    }

    // ── Chasing: police sees player → drop everything, run directly ─────
    if (policeSees) {
      police.state = "chasing";
      police.lastKnownPlayerCol = Math.floor(playerX / TILE);
      police.lastKnownPlayerRow = Math.floor(playerY / TILE);
      police.path = []; // abandon path
      moveToward(police, playerX, playerY, AI_CONFIG.POLICE_SPEED, dt);
      // Despawn timer resets every frame while seeing
      police.timeSinceLastSighting = 0;
      continue;
    }

    // ── Lost sight during chase → path to last known spot, then search ──
    if (police.state === "chasing" && !policeSees) {
      const curCol = Math.round((police.x - TILE / 2) / TILE);
      const curRow = Math.round((police.y - TILE / 2) / TILE);
      const path = aStar(curCol, curRow, police.lastKnownPlayerCol, police.lastKnownPlayerRow, map);
      if (path.length > 0) {
        police.state = "approaching";
        police.path = path;
      } else {
        // Already at last known spot — search
        police.state = "searching";
        police.searchCooldown = AI_CONFIG.POLICE_SEARCH_COOLDOWN;
      }
    }

    // ── Despawn timer (only counts when NOT chasing) ─────────────────────
    if (police.state !== "chasing") {
      if (anySighting) {
        police.timeSinceLastSighting = 0;
      } else {
        police.timeSinceLastSighting += dt;
        if (police.timeSinceLastSighting >= AI_CONFIG.POLICE_DESPAWN_TIME) {
          policeList.splice(i, 1);
          continue;
        }
      }
    }

    // ── Path following (approaching to last known or to search tile) ────
    if (police.path.length > 0) {
      const next = police.path[0];
      const tx = next.col * TILE + TILE / 2;
      const ty = next.row * TILE + TILE / 2;
      const reached = moveToward(police, tx, ty, AI_CONFIG.POLICE_SPEED, dt);
      if (reached) {
        police.x = tx; police.y = ty;
        police.path.shift();
        if (police.path.length === 0) {
          // Arrived
          if (police.state === "approaching") {
            police.state = "searching";
          }
          police.searchCooldown = AI_CONFIG.POLICE_SEARCH_COOLDOWN;
        }
      }
    } else if (police.state === "approaching") {
      // Already at destination
      police.state = "searching";
      police.searchCooldown = AI_CONFIG.POLICE_SEARCH_COOLDOWN;
    } else if (police.state === "searching") {
      // Waiting at current location
      police.searchCooldown -= dt;
      if (police.searchCooldown <= 0) {
        const curCol = Math.round((police.x - TILE / 2) / TILE);
        const curRow = Math.round((police.y - TILE / 2) / TILE);
        let chosen = false;
        for (let attempt = 0; attempt < 25 && !chosen; attempt++) {
          const angle = Math.random() * Math.PI * 2;
          const radius = 2 + Math.random() * (AI_CONFIG.POLICE_SEARCH_RADIUS - 2);
          const nc = Math.round(police.suspicionCol + Math.cos(angle) * radius);
          const nr = Math.round(police.suspicionRow + Math.sin(angle) * radius);
          if (nc < 1 || nc >= MAP_COLS - 1 || nr < 1 || nr >= MAP_ROWS - 1) continue;
          if (map[nr][nc] === 1) continue;
          const path = aStar(curCol, curRow, nc, nr, map);
          if (path.length > 0) {
            police.path = path;
            police.searchCooldown = AI_CONFIG.POLICE_SEARCH_COOLDOWN;
            chosen = true;
          }
        }
        if (!chosen) {
          police.searchCooldown = AI_CONFIG.POLICE_SEARCH_RETRY;
        }
      }
    }
  }

  return { arrested };
}

// ─── Screen projection ────────────────────────────────────────────────────────

function toScreen(wx: number, wy: number, camX: number, camY: number, W: number, H: number) {
  return { sx: wx - camX + W / 2, sy: wy - camY + H / 2 };
}

// ─── Draw: view cone ──────────────────────────────────────────────────────────

function drawViewCone(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  mathFacing: number, halfAngle: number, rangeUnits: number,
  color: string
) {
  const r = rangeUnits * TILE;
  ctx.save();
  // Filled sector
  ctx.globalAlpha = 0.15;
  ctx.fillStyle   = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, mathFacing - halfAngle, mathFacing + halfAngle);
  ctx.closePath();
  ctx.fill();
  // Edge lines
  ctx.globalAlpha  = 0.35;
  ctx.strokeStyle  = color;
  ctx.lineWidth    = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(mathFacing - halfAngle) * r,
             cy + Math.sin(mathFacing - halfAngle) * r);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(mathFacing + halfAngle) * r,
             cy + Math.sin(mathFacing + halfAngle) * r);
  ctx.stroke();
  ctx.restore();
}

// ─── Draw: NPC body ───────────────────────────────────────────────────────────

function drawNPCBody(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  mathFacing: number,
  fill: string, border: string, dot: string,
  label: string
) {
  const r = TILE * 0.38;
  ctx.save();
  // Shadow
  ctx.globalAlpha = 0.28;
  ctx.fillStyle   = "#000";
  ctx.beginPath(); ctx.ellipse(cx + 2, cy + 3, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  // Body
  ctx.fillStyle   = fill;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth   = 2;
  ctx.stroke();
  // Direction dot
  const fx = cx + Math.cos(mathFacing) * r * 0.55;
  const fy = cy + Math.sin(mathFacing) * r * 0.55;
  ctx.fillStyle   = dot;
  ctx.beginPath(); ctx.arc(fx, fy, r * 0.22, 0, Math.PI * 2); ctx.fill();
  // Label
  ctx.fillStyle    = "#fff";
  ctx.font         = "bold 9px monospace";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 1);
  ctx.restore();
}

// ─── Draw: Guards ─────────────────────────────────────────────────────────────

export function drawGuards(
  ctx: CanvasRenderingContext2D,
  guards: Guard[],
  camX: number, camY: number, W: number, H: number,
  now: number
) {
  for (const guard of guards) {
    const { sx, sy } = toScreen(guard.x, guard.y, camX, camY, W, H);

    const stateColor =
      guard.state === "spotted"    ? "#ff3333" :
      guard.state === "suspicious" ? "#ffcc00" : "#33dd77";
    const coneColor  =
      guard.state === "spotted"    ? "#ff4444" :
      guard.state === "suspicious" ? "#ffdd00" : "#44ff88";

    // Alert pulse ring when spotted
    if (guard.state === "spotted") {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.2 * pulse;
      ctx.fillStyle   = "#ff3333";
      ctx.beginPath(); ctx.arc(sx, sy, TILE * 0.65 + pulse * 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    drawViewCone(ctx, sx, sy, guard.mathFacing,
      AI_CONFIG.GUARD_VIEW_HALF_ANGLE, AI_CONFIG.GUARD_VIEW_RANGE, coneColor);
    drawNPCBody(ctx, sx, sy, guard.mathFacing, stateColor, "#ffffff", "#111", "G");

    // Exclamation mark above guard when spotted
    if (guard.state === "spotted") {
      const pulse = 0.6 + 0.4 * Math.sin(now * 0.009);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle   = "#ff4444";
      ctx.font        = "bold 14px sans-serif";
      ctx.textAlign   = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("!", sx, sy - TILE * 0.5);
      ctx.restore();
    }
    if (guard.state === "suspicious") {
      const pulse = 0.6 + 0.4 * Math.sin(now * 0.007);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle   = "#ffcc00";
      ctx.font        = "bold 13px sans-serif";
      ctx.textAlign   = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("?", sx, sy - TILE * 0.5);
      ctx.restore();
    }
  }
}

// ─── Draw: Police ─────────────────────────────────────────────────────────────

export function drawPolice(
  ctx: CanvasRenderingContext2D,
  policeList: Police[],
  camX: number, camY: number, W: number, H: number
) {
  for (const police of policeList) {
    const { sx, sy } = toScreen(police.x, police.y, camX, camY, W, H);

    drawViewCone(ctx, sx, sy, police.mathFacing,
      AI_CONFIG.POLICE_VIEW_HALF_ANGLE, AI_CONFIG.POLICE_VIEW_RANGE, "#4488ff");
    drawNPCBody(ctx, sx, sy, police.mathFacing, "#1a50cc", "#88aaff", "#eef", "P");

    // Despawn progress indicator when timer > 80% elapsed
    if (police.timeSinceLastSighting > AI_CONFIG.POLICE_DESPAWN_TIME * 0.8) {
      const t = 1 - police.timeSinceLastSighting / AI_CONFIG.POLICE_DESPAWN_TIME;
      ctx.save();
      ctx.strokeStyle = "rgba(136,170,255,0.5)";
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, TILE * 0.52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ─── Draw: Suspicion markers ──────────────────────────────────────────────────

export function drawSuspicionMarkers(
  ctx: CanvasRenderingContext2D,
  markers: SuspicionMarker[],
  camX: number, camY: number, W: number, H: number,
  now: number
) {
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
  for (const m of markers) {
    const { sx, sy } = toScreen(
      m.col * TILE + TILE / 2,
      m.row * TILE + TILE / 2,
      camX, camY, W, H
    );
    ctx.save();
    // Glow fill
    ctx.globalAlpha = 0.07 + 0.05 * pulse;
    ctx.fillStyle   = "#ffee00";
    ctx.fillRect(sx - TILE / 2 + 2, sy - TILE / 2 + 2, TILE - 4, TILE - 4);
    // Dashed border
    ctx.globalAlpha = 0.5 + 0.3 * pulse;
    ctx.strokeStyle = "#ffee00";
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(sx - TILE / 2 + 2, sy - TILE / 2 + 2, TILE - 4, TILE - 4);
    ctx.setLineDash([]);
    // "?" label
    ctx.globalAlpha  = 0.7 + 0.25 * pulse;
    ctx.fillStyle    = "#ffee00";
    ctx.font         = "bold 13px monospace";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", sx, sy);
    ctx.restore();
  }
}

// ─── Draw: Caught overlay ─────────────────────────────────────────────────────

export function drawCaughtOverlay(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  now: number
) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(0, 0, W, H);

  const pulse = 0.8 + 0.2 * Math.sin(now * 0.004);
  ctx.globalAlpha = pulse;
  ctx.fillStyle   = "#cc2222";
  ctx.font        = "bold 64px monospace";
  ctx.textAlign   = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("CAUGHT", W / 2, H / 2 - 24);

  ctx.globalAlpha = 0.7;
  ctx.fillStyle   = "#ff9999";
  ctx.font        = "18px sans-serif";
  ctx.fillText("The police have arrested you.", W / 2, H / 2 + 36);
  ctx.fillStyle   = "#888";
  ctx.font        = "13px sans-serif";
  ctx.fillText("Press R to return to the main menu.", W / 2, H / 2 + 64);
  ctx.restore();
}
