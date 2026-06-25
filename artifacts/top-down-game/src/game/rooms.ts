import { ItemCategory, ItemTemplate, WorldItem, CATEGORY_COLOR } from "./loot";
import { MAP_ROWS, MAP_COLS, TILE_MAP } from "./constants";
import { T } from "./textures";

// ── Room types ────────────────────────────────────────────────────────────────

export type RoomType = "bedroom" | "kitchen" | "office" | "living_room" | "garage";

export interface LootTableEntry {
  name: string;
  symbol: string;
  category: ItemCategory;
  valueRange: [number, number];
  weightRange: [number, number];
  spawnChance?: number;
}

export interface RoomDef {
  type: RoomType;
  label: string;
  accentColor: string;
  floorTexture: string | null;
  floorColor?: string;
  lootTable: LootTableEntry[];
}

// ── Orientation types & helpers ───────────────────────────────────────────────
//
// Each texture family has a measured "naturalFront" — the side of the raw image
// where the bright/white pixel lies.  Rotation is derived from that value so the
// front always faces into the room (away from the wall the piece is placed against).
//
// Derivation uses the ctx.rotate(θ) clockwise formula:
//   θ=0:     directions unchanged
//   θ=PI/2:  TOP→RIGHT, RIGHT→BOTTOM, BOTTOM→LEFT, LEFT→TOP
//   θ=PI:    TOP→BOTTOM, RIGHT→LEFT, BOTTOM→TOP, LEFT→RIGHT
//   θ=-PI/2: TOP→LEFT, RIGHT→TOP, BOTTOM→RIGHT, LEFT→BOTTOM
//
// Measured natural fronts (confirmed by observing the rendered texture):
//   Counter / Stove / Sink family → naturalFront = "bottom"
//   Couch (L, M, R) family        → naturalFront = "right"
//   Table / Lamp / Laptop         → naturalFront = "top"
//
// Counter corner piece (Counter(Corn)) has TWO natural fronts: BOTTOM + LEFT.
// That means at rotation 0 it fits a top-right room corner (backs against top+right walls).
// The four 90° rotations map each corner type:
//   "top-right":    0       (natural B+L, back T+R)
//   "bottom-right": PI/2    (B→LEFT, L→TOP → fronts L+T, back R+B)
//   "bottom-left":  PI      (B→TOP, L→RIGHT → fronts T+R, back B+L)
//   "top-left":     -PI/2   (B→RIGHT, L→BOTTOM → fronts R+B, back L+T)
//
// Couch L / R swap:
//   With the couch's naturalFront on the RIGHT, a 90° CW rotation (for top wall)
//   maps RIGHT→BOTTOM so the seating faces down.  In this orientation the cap in
//   Couch(L).png (which is on the TOP) rotates to the RIGHT, and the cap in
//   Couch(R).png (BOTTOM) rotates to the LEFT.  So to get a LEFT-facing end cap
//   in the rendered scene, use the R texture, and vice-versa.

export type WallSide   = "top" | "right" | "bottom" | "left";
export type CornerType = "top-left" | "top-right" | "bottom-left" | "bottom-right";

// Per-texture measured natural front direction
const TEXTURE_NATURAL_FRONT: Partial<Record<string, WallSide>> = {
  // Counter family
  [T.kCounterBase]: "bottom",
  [T.kCounterCB]:   "bottom",
  [T.kCounterCorn]: "bottom",
  [T.kCounterDirt]: "bottom",
  [T.kStove]:       "bottom",
  [T.kSink]:        "bottom",
  // Couch family (L, M, R are all oriented the same way in the sheet)
  [T.hCouchL]: "left",
  [T.hCouchM]: "left",
  [T.hCouchR]: "left",
  // Table / lamp / misc → "top"  (default, no override needed)
};

function rotationForWall(texture: string, wallSide: WallSide): number {
  const naturalFront: WallSide = TEXTURE_NATURAL_FRONT[texture] ?? "top";
  const sides: WallSide[] = ["top", "right", "bottom", "left"];
  const fi = sides.indexOf(naturalFront);
  // Front must face OPPOSITE of wallSide (into the room)
  const opposite: Record<WallSide, WallSide> = { top:"bottom", bottom:"top", left:"right", right:"left" };
  const ti = sides.indexOf(opposite[wallSide]);
  const steps = (ti - fi + 4) % 4; // clockwise steps needed
  return steps === 3 ? -Math.PI / 2 : steps * Math.PI / 2;
}

function rotationForCorner(cornerType: CornerType): number {
  // Corner piece measured natural fronts = [BOTTOM, LEFT] → fits top-right room corner at 0°
  switch (cornerType) {
    case "top-right":    return 0;
    case "bottom-right": return Math.PI / 2;
    case "bottom-left":  return Math.PI;
    case "top-left":     return -Math.PI / 2;
  }
}

// ── Furniture definition ───────────────────────────────────────────────────────

export interface FurnitureDef {
  kind: string;
  col: number;
  row: number;
  w: number;
  h: number;
  texture: string;
  rotation: number;        // always computed — do NOT set manually
  wallSide?: WallSide;     // straight pieces
  cornerType?: CornerType; // corner pieces
  flipX?: boolean;
  flipY?: boolean;
  hasCollision: boolean;
  noLoot?: boolean;        // lamps and decorative items — excluded from loot spawning
}

// ── Builder helpers ────────────────────────────────────────────────────────────

function wall(
  kind: string, col: number, row: number, w: number, h: number,
  texture: string, wallSide: WallSide,
  opts: { noLoot?: boolean; flipX?: boolean; flipY?: boolean } = {}
): FurnitureDef {
  return {
    kind, col, row, w, h, texture,
    wallSide,
    rotation: rotationForWall(texture, wallSide),
    hasCollision: true,
    ...opts,
  };
}

function corner(
  kind: string, col: number, row: number,
  texture: string, cornerType: CornerType
): FurnitureDef {
  return {
    kind, col, row, w: 1, h: 1, texture,
    cornerType,
    rotation: rotationForCorner(cornerType),
    hasCollision: true,
  };
}

function lamp(col: number, row: number): FurnitureDef {
  return {
    kind: "lamp", col, row, w: 1, h: 1,
    texture: T.hLamp,
    rotation: 0,
    hasCollision: true,
    noLoot: true,
  };
}

// ── Room boundaries ────────────────────────────────────────────────────────────
//
//  Bedroom    : cols 1-7,   rows 1-4
//  Kitchen    : cols 9-16,  rows 1-4
//  Office     : cols 18-24, rows 1-4
//  Hallway    : row 6       (no loot)
//  Garage     : cols 1-9,   rows 8-11
//  Living room: cols 11-20, rows 8-11

export function getRoomType(col: number, row: number): RoomType | null {
  if (col >= 1  && col <= 7  && row >= 1 && row <= 4) return "bedroom";
  if (col >= 9  && col <= 16 && row >= 1 && row <= 4) return "kitchen";
  if (col >= 18 && col <= 24 && row >= 1 && row <= 4) return "office";
  if (col >= 1  && col <= 9  && row >= 8 && row <= 11) return "garage";
  if (col >= 11 && col <= 20 && row >= 8 && row <= 11) return "living_room";
  return null;
}

export function getRoomFloorTexture(col: number, row: number): { texture: string | null; color?: string } {
  const room = getRoomType(col, row);
  if (!room) return { texture: null, color: "#1a2030" };
  const def = ROOM_DEFS[room];
  return { texture: def.floorTexture, color: def.floorColor };
}

// ── Room definitions ───────────────────────────────────────────────────────────

export const ROOM_DEFS: Record<RoomType, RoomDef> = {
  bedroom: {
    type: "bedroom", label: "Bedroom", accentColor: "#ffd700",
    floorTexture: T.hFloor,
    lootTable: [
      { name: "Diamond Ring",   symbol: "◆", category: "jewelry",  valueRange: [400, 1500], weightRange: [0.05, 0.2],  spawnChance: 0.15 },
      { name: "Gold Necklace",  symbol: "N", category: "jewelry",  valueRange: [300,  900], weightRange: [0.1,  0.3],  spawnChance: 0.15 },
      { name: "Pearl Earrings", symbol: "O", category: "jewelry",  valueRange: [200,  600], weightRange: [0.05, 0.15], spawnChance: 0.20 },
      { name: "Luxury Watch",   symbol: "W", category: "jewelry",  valueRange: [500, 3000], weightRange: [0.3,  0.8],  spawnChance: 0.12 },
      { name: "Jewelry Box",    symbol: "J", category: "jewelry",  valueRange: [100,  400], weightRange: [0.5,  1.5],  spawnChance: 0.30 },
      { name: "Vintage Coin",   symbol: "V", category: "jewelry",  valueRange: [50,   400], weightRange: [0.1,  0.5],  spawnChance: 0.35 },
      { name: "Silk Scarf",     symbol: "S", category: "clothing", valueRange: [40,   200], weightRange: [0.3,  0.8],  spawnChance: 0.15 },
      { name: "Leather Wallet", symbol: "W", category: "clothing", valueRange: [30,   150], weightRange: [0.1,  0.3],  spawnChance: 0.35 },
    ],
  },

  kitchen: {
    type: "kitchen", label: "Kitchen", accentColor: "#ff8c42",
    floorTexture: T.kFloorWhite,
    lootTable: [
      { name: "Cast Iron Pan",    symbol: "P", category: "kitchen", valueRange: [30,   80],  weightRange: [6,  10], spawnChance: 0.40 },
      { name: "Chef's Knife",     symbol: "K", category: "kitchen", valueRange: [40,  150],  weightRange: [1,   3], spawnChance: 0.40 },
      { name: "Espresso Machine", symbol: "E", category: "kitchen", valueRange: [150, 400],  weightRange: [7,  12], spawnChance: 0.30 },
      { name: "Blender",          symbol: "B", category: "kitchen", valueRange: [50,  200],  weightRange: [5,   9], spawnChance: 0.35 },
      { name: "Toaster Oven",     symbol: "T", category: "kitchen", valueRange: [40,  120],  weightRange: [4,   7], spawnChance: 0.35 },
      { name: "Knife Set",        symbol: "K", category: "kitchen", valueRange: [60,  200],  weightRange: [2,   5], spawnChance: 0.40 },
      { name: "Ceramic Bowl Set", symbol: "C", category: "kitchen", valueRange: [20,   80],  weightRange: [3,   6], spawnChance: 0.45 },
      { name: "Coffee Maker",     symbol: "C", category: "kitchen", valueRange: [40,  180],  weightRange: [3,   6], spawnChance: 0.40 },
    ],
  },

  office: {
    type: "office", label: "Office", accentColor: "#00e5ff",
    floorTexture: T.hFloor,
    lootTable: [
      { name: "Laptop",              symbol: "L", category: "technology", valueRange: [600, 1200], weightRange: [3,   5],   spawnChance: 0.30 },
      { name: "Tablet",              symbol: "T", category: "technology", valueRange: [300,  800], weightRange: [0.8, 1.5], spawnChance: 0.30 },
      { name: "Smartphone",          symbol: "S", category: "technology", valueRange: [300,  900], weightRange: [0.3, 0.6], spawnChance: 0.35 },
      { name: "Camera",              symbol: "C", category: "technology", valueRange: [400, 1500], weightRange: [1.5, 3],   spawnChance: 0.25 },
      { name: "Wireless Headphones", symbol: "H", category: "technology", valueRange: [100,  500], weightRange: [0.5, 1],   spawnChance: 0.40 },
      { name: "External Hard Drive", symbol: "D", category: "technology", valueRange: [50,   300], weightRange: [0.5, 1],   spawnChance: 0.40 },
      { name: "Smart Speaker",       symbol: "A", category: "technology", valueRange: [80,   350], weightRange: [1,   2],   spawnChance: 0.40 },
      { name: "Mechanical Keyboard", symbol: "K", category: "technology", valueRange: [80,   250], weightRange: [1,   2.5], spawnChance: 0.40 },
    ],
  },

  living_room: {
    type: "living_room", label: "Living Room", accentColor: "#a5d6a7",
    floorTexture: T.hFloor,
    lootTable: [
      { name: "Flatscreen TV",     symbol: "T", category: "technology", valueRange: [200,  800], weightRange: [15, 30], spawnChance: 0.30 },
      { name: "Gaming Console",    symbol: "G", category: "technology", valueRange: [200,  500], weightRange: [4,   7], spawnChance: 0.35 },
      { name: "Oil Painting",      symbol: "A", category: "art",        valueRange: [100,  800], weightRange: [2,   6], spawnChance: 0.30 },
      { name: "Bronze Vase",       symbol: "V", category: "art",        valueRange: [80,   500], weightRange: [3,   8], spawnChance: 0.35 },
      { name: "Antique Clock",     symbol: "C", category: "art",        valueRange: [200,  900], weightRange: [4,  10], spawnChance: 0.30 },
      { name: "Bluetooth Speaker", symbol: "S", category: "technology", valueRange: [50,   300], weightRange: [1,   3], spawnChance: 0.40 },
      { name: "Leather Jacket",    symbol: "J", category: "clothing",   valueRange: [150,  400], weightRange: [2,   4], spawnChance: 0.35 },
      { name: "Silk Dress",        symbol: "D", category: "clothing",   valueRange: [100,  350], weightRange: [0.5, 1.5], spawnChance: 0.35 },
    ],
  },

  garage: {
    type: "garage", label: "Garage", accentColor: "#9e9e9e",
    floorTexture: null, floorColor: "#555c66",
    lootTable: [
      { name: "Power Drill",    symbol: "D", category: "technology", valueRange: [80,  250], weightRange: [3,   5], spawnChance: 0.40 },
      { name: "Toolbox",        symbol: "T", category: "technology", valueRange: [40,  150], weightRange: [5,   9], spawnChance: 0.45 },
      { name: "Air Compressor", symbol: "A", category: "technology", valueRange: [60,  200], weightRange: [8,  15], spawnChance: 0.30 },
      { name: "Angle Grinder",  symbol: "G", category: "technology", valueRange: [50,  180], weightRange: [4,   7], spawnChance: 0.35 },
    ],
  },
};

// ── Furniture definitions ──────────────────────────────────────────────────────
//
// All furniture uses `wall()` or `corner()` builders.
// Rotation is ALWAYS computed from wallSide / cornerType — never set manually.
//
// Same-class pieces in a run share the same wallSide, ensuring:
//   • Their bright/white edge (front) faces the room on every piece
//   • The edges between adjacent pieces (left/right of the run) are always dark (connection edges)
//
// Counter(Corn) corner pieces use cornerType to join two perpendicular counter runs.
// The Corner piece's natural fronts = BOTTOM + RIGHT (fits a top-left room corner at 0°).

// ── BEDROOM  (cols 1-7, rows 1-4) ─────────────────────────────────────────────
// Doors → row 5 at cols 3 and 6. Keep row 4 clear around cols 2-4 and 5-7.
const BEDROOM_FURNITURE: FurnitureDef[] = [
  // Bed (2×1) — against top wall, right side.
  // After 180° flip (naturalFront="left", rotation=-PI/2):
  //   hCouchL cap (at LEFT) → rotates to BOTTOM (front/room edge)
  //   hCouchR cap (at RIGHT)→ rotates to TOP    (back/wall edge)
  wall("bed-l",    5, 1, 1, 1, T.hCouchL,    "top"),
  wall("bed-r",    6, 1, 1, 1, T.hCouchR,    "top"),

  // Dresser (2×1) — against top wall, left side
  wall("dresser-l", 2, 1, 1, 1, T.hTableBase, "top"),
  wall("dresser-r", 3, 1, 1, 1, T.hTableBase, "top"),

  // Nightstand — top-left corner against top wall
  wall("nightstand", 1, 1, 1, 1, T.hTableBase, "top"),

  // Wardrobe — against left wall (col 0), back faces left, front faces right into room
  wall("wardrobe", 1, 2, 1, 1, T.hCouchL, "left"),

  // Lamp — floor corner, no loot
  lamp(7, 4),
  lamp(1, 4),
];

// ── KITCHEN  (cols 9-16, rows 1-4) ────────────────────────────────────────────
// Doors → row 5 at cols 10 and 14.  Keep row 4 cols 9-11 and 13-15 clear.
//
// Counter run layout:
//   TOP WALL  (wallSide "top")    → cols 11-15, row 1
//   CORNER    (cornerType)        → col 16, row 1  ("top-right": back to top+right walls)
//   RIGHT WALL (wallSide "right") → col 16, rows 2-3
//   LEFT WALL  (wallSide "left")  → col  9, rows 2-3
//   BOTTOM WALL (wallSide "bottom")→ cols 11-13, row 4
//
// The Corner piece at (16,1) connects the top-wall run (ending at col 15) to
// the right-wall run (starting at row 2).  Both runs share the same texture class
// (counter/kitchen), and the Corner's two bright edges face BOTTOM + LEFT,
// which seamlessly connect with:
//   • the top-wall run's bright (front) edge facing DOWN
//   • the right-wall run's bright (front) edge facing LEFT
const KITCHEN_FURNITURE: FurnitureDef[] = [
  // Top wall counter run — all "top" wallSide (bright edge faces DOWN into kitchen)
  wall("counter", 11, 1, 1, 1, T.kCounterBase, "top"),
  wall("counter", 12, 1, 1, 1, T.kCounterCB,   "top"),
  wall("counter", 13, 1, 1, 1, T.kCounterBase, "top"),
  wall("counter", 14, 1, 1, 1, T.kCounterDirt, "top"),
  wall("stove",   15, 1, 1, 1, T.kStove,        "top"),
  // Corner piece — "top-right" room corner (back against top wall + right wall at col 17)
  // After -PI/2 rotation: natural fronts [B, R] become [R, T]... let me recalc.
  // The corner at col16,row1 has:
  //   back → TOP wall (row 0) and RIGHT wall (col 17)
  //   front → BOTTOM (toward rows 2-4) and LEFT (toward col 15 counter run)
  // From table: fronts B+L → cornerType "top-right" → rotation -PI/2
  corner("counter-corn", 16, 1, T.kCounterCorn, "top-right"),

  // Right wall counter run — all "right" wallSide (bright edge faces LEFT into kitchen)
  wall("sink",    16, 2, 1, 1, T.kSink,        "right"),
  wall("counter", 16, 3, 1, 1, T.kCounterCB,   "right"),

  // Left wall counter run — all "left" wallSide (bright edge faces RIGHT into kitchen)
  wall("counter",  9, 2, 1, 1, T.kCounterBase, "left"),
  wall("counter",  9, 3, 1, 1, T.kCounterBase, "left"),

  // Bottom wall counter run — all "bottom" wallSide (bright edge faces UP into kitchen)
  wall("counter", 11, 4, 1, 1, T.kCounterBase, "bottom"),
  wall("counter", 12, 4, 1, 1, T.kCounterBase, "bottom"),
  wall("counter", 13, 4, 1, 1, T.kCounterDirt, "bottom"),

  // Lamp — top-left corner, floor only
  lamp(9, 1),
];

// ── OFFICE  (cols 18-24, rows 1-4) ────────────────────────────────────────────
// Door → row 5 at col 21.  Keep row 4 cols 20-22 clear.
const OFFICE_FURNITURE: FurnitureDef[] = [
  // Main desk (3×1) — against top wall
  wall("desk",   18, 1, 1, 1, T.hTableBase, "top"),
  wall("desk",   19, 1, 1, 1, T.hTableBase, "top"),
  wall("desk",   20, 1, 1, 1, T.hTableBase, "top"),

  // Side desk (1×2) — against right wall (col 25)
  wall("desk2",  24, 1, 1, 1, T.hTableBase, "right"),
  wall("desk2",  24, 2, 1, 1, T.hTableBase, "right"),

  // Chair — faces top wall (toward main desk), uses "bottom" so front points UP
  wall("chair",  19, 3, 1, 1, T.hCouchM, "bottom"),

  // Bookshelf — against right wall
  wall("bookshelf", 24, 3, 1, 1, T.hCouchL, "right"),

  // Lamps — floor corners
  lamp(24, 4),
  lamp(18, 4),
];

// ── GARAGE  (cols 1-9, rows 8-11) ─────────────────────────────────────────────
// Door at row 7 col 5 (from hallway) → keep row 8 cols 4-6 clear.
// Door at col 0 row 10 (exterior) → keep col 1 row 10 clear.
const GARAGE_FURNITURE: FurnitureDef[] = [
  // Workbench (2×1) — against top wall, right side (clear of door at col 5)
  wall("workbench",  7, 8, 1, 1, T.hTableBase, "top"),
  wall("workbench",  8, 8, 1, 1, T.hTableBase, "top"),

  // Tool cabinet (1×2) — against right wall (col 10)
  wall("cabinet",  9, 9, 1, 1, T.hCouchL, "right"),
  wall("cabinet",  9, 10, 1, 1, T.hCouchL, "right"),

  // Workbench (3×1) — against bottom wall (row 12)
  wall("workbench2", 2, 11, 1, 1, T.hTableBase, "bottom"),
  wall("workbench2", 3, 11, 1, 1, T.hTableBase, "bottom"),
  wall("workbench2", 4, 11, 1, 1, T.hTableBase, "bottom"),

  // Lamps — floor corners (no loot)
  lamp(1, 8),
  lamp(9, 11),
];

// ── LIVING ROOM  (cols 11-20, rows 8-11) ─────────────────────────────────────
// Door at row 7 col 16 → keep row 8 cols 15-17 clear.
//
// Couch run split around the door:
//   LEFT segment:  cols 11-13, wallSide "top" (bright edge faces DOWN into room)
//   RIGHT segment: cols 18-19, wallSide "top"
// All couch pieces share wallSide "top" → seamless connection edges (dark sides) touch,
// bright (front) edges all face the room interior consistently.
const LIVING_FURNITURE: FurnitureDef[] = [
  // Left couch segment — LEFT-end | M | M  (cols 11-13, against top wall)
  // After 180° flip (naturalFront="left", rotation=-PI/2):
  //   hCouchL cap (LEFT) → rotates to BOTTOM (front/room edge) = visible left cap
  wall("couch-l",  11, 8, 1, 1, T.hCouchL, "top"),
  wall("couch-m1", 12, 8, 1, 1, T.hCouchM, "top"),
  wall("couch-m2", 13, 8, 1, 1, T.hCouchM, "top"),

  // Right couch segment — M | RIGHT-end  (cols 18-19, same wallSide "top")
  wall("couch-m3", 18, 8, 1, 1, T.hCouchM, "top"),
  wall("couch-r",  19, 8, 1, 1, T.hCouchR, "top"),  // R cap → rotates to TOP (front/room edge)

  // TV stand (3×1) — against bottom wall
  wall("tv-stand-l", 13, 11, 1, 1, T.hTableBase, "bottom"),
  wall("tv-stand-m", 14, 11, 1, 1, T.hTableBase, "bottom"),
  wall("tv-stand-r", 15, 11, 1, 1, T.hTableBase, "bottom"),

  // Coffee table — center of room (faces bottom = front points up, accessible from below)
  wall("coffee-l", 14, 9, 1, 1, T.hTableCig, "bottom"),
  wall("coffee-r", 15, 9, 1, 1, T.hTableCig, "bottom"),

  // Side table — against right wall (col 21)
  wall("side-table", 20, 10, 1, 1, T.hTableBase, "right"),

  // Lamps — floor corners (no loot)
  lamp(11, 11),
  lamp(20, 11),
];

export const ALL_FURNITURE: FurnitureDef[] = [
  ...BEDROOM_FURNITURE,
  ...KITCHEN_FURNITURE,
  ...OFFICE_FURNITURE,
  ...GARAGE_FURNITURE,
  ...LIVING_FURNITURE,
];

// ── Furniture collision map ────────────────────────────────────────────────────

export function buildFurnitureMap(): number[][] {
  const map: number[][] = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(0));
  for (const f of ALL_FURNITURE) {
    if (!f.hasCollision) continue;
    for (let r = 0; r < f.h; r++) {
      for (let c = 0; c < f.w; c++) {
        const mc = f.col + c, mr = f.row + r;
        if (mr >= 0 && mr < MAP_ROWS && mc >= 0 && mc < MAP_COLS)
          map[mr][mc] = 3;
      }
    }
  }
  return map;
}

// ── Loot spawning ──────────────────────────────────────────────────────────────
//
// Loot spawns ONLY on tiles that furniture physically occupies.
// • noLoot pieces (lamps, decor) are skipped entirely.
// • Each furniture tile gets an independent roll against the room's loot table.
// • Items are positioned at the furniture tile → player picks them up from adjacent tiles
//   (INTERACT_RANGE = 52 px, TILE = 40 px, so one tile away is always reachable).

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export function buildWorldItems(seed = 42): WorldItem[] {
  const rng = seededRng(seed);
  const items: WorldItem[] = [];
  let id = 0;

  for (const f of ALL_FURNITURE) {
    // Skip lamps and any decorative piece explicitly marked noLoot
    if (f.noLoot) continue;

    // Try to spawn loot on each tile the furniture occupies
    for (let dr = 0; dr < f.h; dr++) {
      for (let dc = 0; dc < f.w; dc++) {
        const col = f.col + dc;
        const row = f.row + dr;

        // Only spawn in valid, mapped rooms (never in hallway or exterior)
        const room = getRoomType(col, row);
        if (!room) continue;

        const roomDef = ROOM_DEFS[room];
        // Pick a random item from this room's loot table
        const entry = roomDef.lootTable[Math.floor(rng() * roomDef.lootTable.length)];
        const chance = entry.spawnChance ?? 0.35;

        // Roll against spawn chance — rarer items will usually fail this check
        if (rng() > chance) continue;

        const value  = Math.round(lerp(entry.valueRange[0],  entry.valueRange[1],  rng()));
        const weight = parseFloat(lerp(entry.weightRange[0], entry.weightRange[1], rng()).toFixed(1));

        const template: ItemTemplate = {
          name: entry.name, symbol: entry.symbol, category: entry.category,
          value, weight, color: CATEGORY_COLOR[entry.category],
        };

        // Item is placed at the furniture tile itself
        items.push({ id: id++, template, col, row, collected: false });
      }
    }
  }

  return items;
}
