export const PLAYER_SPEED = 180;
export const PLAYER_SIZE  = 14;
export const TILE         = 40;
export const INTERACT_RANGE = 52;

// Map size: 26 cols × 13 rows
// Layout:
//   Row  0    : top outer wall
//   Rows 1-4  : top rooms (bedroom | wall | kitchen | wall | office)
//   Row  5    : wall with doors to hallway
//   Row  6    : hallway (no loot zone)
//   Row  7    : wall with doors to lower rooms
//   Rows 8-11 : lower rooms (garage | wall | living_room | exterior walls)
//   Row  12   : bottom outer wall
//
// Columns:
//   0        : left outer wall (or garage left door at row 10)
//   1-7      : Bedroom (green)
//   8        : wall (bedroom | kitchen)
//   9-16     : Kitchen (blue)  [no internal wall – dotted line is not a wall]
//   17       : wall (kitchen | office)
//   18-24    : Office (yellow)
//   25       : right outer wall
//
//   Bottom (rows 8-11):
//   0        : left outer wall (door at row 10 = garage exterior door)
//   1-9      : Garage (orange)
//   10       : wall (garage | living_room)
//   11-20    : Living room (brown)
//   21       : right outer wall of living room
//   22-25    : solid exterior walls

export const MAP_COLS = 26;
export const MAP_ROWS = 13;

// 0=floor, 1=wall, 2=door(closed), 3=furniture(collision)
export const TILE_MAP: number[][] = [
  // col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25
  /* 0 */ [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  /* 1 */ [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
  /* 2 */ [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
  /* 3 */ [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
  /* 4 */ [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
  /* 5 */ [1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1],
  /* 6 */ [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  /* 7 */ [1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  /* 8 */ [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  /* 9 */ [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  /*10 */ [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  /*11 */ [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  /*12 */ [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

export const WORLD_W = MAP_COLS * TILE;
export const WORLD_H = MAP_ROWS * TILE;

// Player spawn: inside garage, near left side
export const PLAYER_SPAWN_COL = 3;
export const PLAYER_SPAWN_ROW = 10;

// Wall & floor colors
export const WALL_COLOR    = "#0e1014";
export const FLOOR_COLOR   = "#1a1e25";
export const GARAGE_FLOOR_COLOR = "#555c66";

// Weight thresholds (lbs)
export const WEIGHT_LOW  = 8;
export const WEIGHT_MED  = 20;
export const WEIGHT_HIGH = 40;

// Sprite animation
export const SPRITE_COLS      = 3;
export const SPRITE_ROWS_ANIM = 4;
export const ANIM_FRAME_MS    = 130;

export const ANIM_ROW_DOWN  = 0;
export const ANIM_ROW_UP    = 1;
export const ANIM_ROW_LEFT  = 2;
export const ANIM_ROW_RIGHT = 3;

// Guard path waypoints (for future use) — hallway row 6
export const GUARD_PATH_WAYPOINTS = [
  { col: 2,  row: 6 },
  { col: 23, row: 6 },
  { col: 23, row: 6 },
  { col: 2,  row: 6 },
];
