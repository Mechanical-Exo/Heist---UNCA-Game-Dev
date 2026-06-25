import { useEffect, useRef } from "react";
import {
  TILE_MAP, TILE, WORLD_W, WORLD_H,
  PLAYER_SPEED, PLAYER_SIZE, MAP_COLS, MAP_ROWS, INTERACT_RANGE,
  WEIGHT_LOW, WEIGHT_MED, WEIGHT_HIGH,
  SPRITE_COLS, SPRITE_ROWS_ANIM, ANIM_FRAME_MS,
  ANIM_ROW_DOWN, ANIM_ROW_UP, ANIM_ROW_LEFT, ANIM_ROW_RIGHT,
  WALL_COLOR, GARAGE_FLOOR_COLOR,
  PLAYER_SPAWN_COL, PLAYER_SPAWN_ROW,
} from "./constants";
import { WorldItem, ItemTemplate } from "./loot";
import { buildWorldItems, buildFurnitureMap, ALL_FURNITURE, getRoomFloorTexture } from "./rooms";
import { preloadAllTextures, drawTextureFit, drawTextureTile, ITEM_TEXTURE_MAP } from "./textures";
import {
  Guard, Police, SuspicionMarker,
  initGuards, spawnPolice,
  updateGuards, updatePolice,
  drawGuards, drawPolice, drawSuspicionMarkers, drawCaughtOverlay,
} from "./ai";

// ─── Types ───────────────────────────────────────────────────────────────────

type GameScreen = "menu" | "level-select" | "shop" | "playing" | "caught" | "extracted";

interface Player { x: number; y: number; facing: number }

interface Keys {
  w: boolean; a: boolean; s: boolean; d: boolean;
  e: boolean; i: boolean; x: boolean; r: boolean;
  ArrowUp: boolean; ArrowDown: boolean; ArrowLeft: boolean; ArrowRight: boolean;
  Escape: boolean;
  [key: string]: boolean;
}

interface Door { col: number; row: number; open: boolean }

interface AnimState { row: number; frame: number; timer: number }

type Interactable =
  | { kind: "item"; item: WorldItem }
  | { kind: "door"; door: Door };

// ─── Speed ───────────────────────────────────────────────────────────────────

function effectiveSpeed(lbs: number): number {
  if (lbs < WEIGHT_LOW)  return PLAYER_SPEED;
  if (lbs < WEIGHT_MED)  return PLAYER_SPEED * 0.85;
  if (lbs < WEIGHT_HIGH) return PLAYER_SPEED * 0.65;
  return PLAYER_SPEED * 0.45;
}

// ─── Map helpers ──────────────────────────────────────────────────────────────

function buildMutableMap(): number[][] { return TILE_MAP.map(r => [...r]); }

function buildDoors(map: number[][]): Door[] {
  const doors: Door[] = [];
  for (let row = 0; row < MAP_ROWS; row++)
    for (let col = 0; col < MAP_COLS; col++)
      if (map[row][col] === 2) doors.push({ col, row, open: false });
  return doors;
}

function isBlocking(map: number[][], col: number, row: number): boolean {
  if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return true;
  const t = map[row][col];
  return t === 1 || t === 2 || t === 3;
}

function resolveCollision(player: Player, map: number[][], furnitureMap: number[][]): void {
  const half = PLAYER_SIZE;
  const L = player.x - half, R = player.x + half;
  const T = player.y - half, B = player.y + half;
  const c0 = Math.floor(L / TILE), c1 = Math.floor((R - 1) / TILE);
  const r0 = Math.floor(T / TILE), r1 = Math.floor((B - 1) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      // Check walls/doors in map + furniture in furnitureMap
      if (!isBlocking(map, c, r) && !isBlocking(furnitureMap, c, r)) continue;
      const wx = c * TILE, wy = r * TILE;
      const oL = R - wx, oR = wx + TILE - L, oT = B - wy, oB = wy + TILE - T;
      if (oL > 0 && oR > 0 && oT > 0 && oB > 0) {
        if (Math.min(oL, oR) < Math.min(oT, oB))
          player.x += oL < oR ? -oL : oR;
        else
          player.y += oT < oB ? -oT : oB;
      }
    }
  }
}

function tileCenterPx(col: number, row: number) {
  return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
}
function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

// ─── Draw: world tiles ────────────────────────────────────────────────────────

function drawWorld(
  ctx: CanvasRenderingContext2D,
  map: number[][], doors: Door[],
  camX: number, camY: number, w: number, h: number
) {
  const ox = w / 2 - camX, oy = h / 2 - camY;

  ctx.fillStyle = "#060809";
  ctx.fillRect(0, 0, w, h);

  const r0 = Math.max(0, Math.floor((camY - h / 2) / TILE));
  const r1 = Math.min(MAP_ROWS - 1, Math.floor((camY + h / 2) / TILE));
  const c0 = Math.max(0, Math.floor((camX - w / 2) / TILE));
  const c1 = Math.min(MAP_COLS - 1, Math.floor((camX + w / 2) / TILE));

  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const wx = col * TILE + ox, wy = row * TILE + oy;
      const tile = map[row][col];

      if (tile === 1) {
        // Solid dark wall
        ctx.fillStyle = WALL_COLOR;
        ctx.fillRect(wx, wy, TILE, TILE);
        // Top edge highlight
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(wx, wy, TILE, 2);
      } else if (tile === 0 || tile === 2 || tile === 3) {
        // Floor
        const { texture, color } = getRoomFloorTexture(col, row);
        if (texture) {
          const drawn = drawTextureTile(ctx, texture, wx, wy, TILE, TILE);
          if (!drawn) {
            ctx.fillStyle = color ?? "#1a1e25";
            ctx.fillRect(wx, wy, TILE, TILE);
          }
        } else {
          // Solid color floor (garage = grey)
          ctx.fillStyle = color ?? GARAGE_FLOOR_COLOR;
          ctx.fillRect(wx, wy, TILE, TILE);
          // Grid line
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(wx + 0.25, wy + 0.25, TILE - 0.5, TILE - 0.5);
        }

        if (tile === 2) drawDoorTile(ctx, wx, wy, false);
      }
    }
  }

  // Open door overlays
  for (const d of doors) {
    if (!d.open) continue;
    const wx = d.col * TILE + ox, wy = d.row * TILE + oy;
    drawDoorTile(ctx, wx, wy, true);
  }
}

function drawDoorTile(ctx: CanvasRenderingContext2D, wx: number, wy: number, open: boolean) {
  const I = 6;
  if (open) {
    ctx.strokeStyle = "rgba(139,90,43,0.35)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(wx + I, wy + I, TILE - I * 2, TILE - I * 2);
  } else {
    ctx.fillStyle = "#5a3e2b"; ctx.fillRect(wx + I, wy + I, TILE - I * 2, TILE - I * 2);
    ctx.fillStyle = "#7a5640"; ctx.fillRect(wx + I, wy + I, TILE - I * 2, 3);
    ctx.fillStyle = "#ffd54f";
    ctx.beginPath(); ctx.arc(wx + TILE - I - 5, wy + TILE / 2, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "bold 7px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("DOOR", wx + TILE / 2, wy + TILE / 2);
  }
}

// ─── Draw: furniture ──────────────────────────────────────────────────────────

function drawFurniture(
  ctx: CanvasRenderingContext2D,
  camX: number, camY: number, w: number, h: number
) {
  const ox = w / 2 - camX, oy = h / 2 - camY;

  for (const f of ALL_FURNITURE) {
    const fx = f.col * TILE + ox;
    const fy = f.row * TILE + oy;

    // Skip if off-screen
    if (fx + f.w * TILE < 0 || fx > w || fy + f.h * TILE < 0 || fy > h) continue;

    // Draw each tile of the furniture individually (no stretching)
    for (let r = 0; r < f.h; r++) {
      for (let c = 0; c < f.w; c++) {
        const tx = fx + c * TILE;
        const ty = fy + r * TILE;
        drawTextureFit(ctx, f.texture, tx, ty, TILE, TILE, f.rotation ?? 0, f.flipX ?? false, f.flipY ?? false);
      }
    }
  }
}

// ─── Draw: items ──────────────────────────────────────────────────────────────

function drawItems(
  ctx: CanvasRenderingContext2D,
  items: WorldItem[], nearest: Interactable | null,
  camX: number, camY: number, w: number, h: number, now: number
) {
  for (const item of items) {
    if (item.collected) continue;
    const { x, y } = tileCenterPx(item.col, item.row);
    const sx = x - camX + w / 2, sy = y - camY + h / 2;
    const isNear = nearest?.kind === "item" && nearest.item.id === item.id;
    const pulse = isNear ? 0.7 + 0.3 * Math.sin(now / 280) : 0;

    if (isNear) {
      ctx.save();
      ctx.shadowColor = item.template.color; ctx.shadowBlur = 12 + 8 * pulse;
      ctx.strokeStyle = item.template.color; ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5 + 0.4 * pulse;
      ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(sx + 1, sy + 2, 9, 6, 0, 0, Math.PI * 2); ctx.fill();

    // Item texture (natural aspect ratio, max 20×20)
    const texUrl = ITEM_TEXTURE_MAP[item.template.name];
    const itemSz = 20;
    if (texUrl) {
      const drawn = drawTextureFit(ctx, texUrl, sx - itemSz, sy - itemSz, itemSz * 2, itemSz * 2);
      if (!drawn) drawItemFallback(ctx, sx, sy, item, isNear);
    } else {
      drawItemFallback(ctx, sx, sy, item, isNear);
    }

    if (isNear) drawInteractPrompt(ctx, sx, sy - 24, "item", item.template.name);
  }
}

function drawItemFallback(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  item: WorldItem,
  isNear: boolean
) {
  const sz = 11;
  ctx.fillStyle = item.template.color;
  ctx.beginPath(); ctx.roundRect(sx - sz, sy - sz, sz * 2, sz * 2, 4); ctx.fill();
  ctx.strokeStyle = isNear ? "#ffffff" : "rgba(255,255,255,0.3)";
  ctx.lineWidth = isNear ? 1.5 : 1; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = `bold ${sz}px monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(item.template.symbol, sx, sy + 1);
}

function drawDoorInteractables(
  ctx: CanvasRenderingContext2D, doors: Door[], nearest: Interactable | null,
  camX: number, camY: number, w: number, h: number, now: number
) {
  for (const door of doors) {
    if (nearest?.kind !== "door" || nearest.door !== door) continue;
    const { x, y } = tileCenterPx(door.col, door.row);
    const sx = x - camX + w / 2, sy = y - camY + h / 2;
    const pulse = 0.7 + 0.3 * Math.sin(now / 280);
    ctx.save();
    ctx.shadowColor = "#ffd54f"; ctx.shadowBlur = 14 + 6 * pulse;
    ctx.strokeStyle = "#ffd54f"; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6 + 0.3 * pulse;
    ctx.beginPath(); ctx.arc(sx, sy, 18, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    drawInteractPrompt(ctx, sx, sy - 26, "door", door.open ? "Close Door" : "Open Door");
  }
}

function drawInteractPrompt(
  ctx: CanvasRenderingContext2D, sx: number, sy: number,
  kind: "item" | "door", label: string
) {
  const verb = kind === "item" ? "Pick up" : "";
  const text = verb ? `${verb}: ${label}` : label;
  const eText = "[E]";
  ctx.save();
  ctx.font = "bold 11px sans-serif";
  const tw = ctx.measureText(text).width + ctx.measureText(eText).width + 14;
  const ph = 18;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(sx - tw / 2 - 4, sy - ph / 2, tw + 8, ph, 4);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#f9e04b"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(eText, sx - tw / 2, sy);
  ctx.fillStyle = "#e0e0e0";
  ctx.fillText(text, sx - tw / 2 + ctx.measureText(eText).width + 6, sy);
  ctx.restore();
}

// ─── Draw: player ────────────────────────────────────────────────────────────

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: Player, w: number, h: number,
  anim: AnimState, img: HTMLImageElement | null
) {
  const sx = w / 2, sy = h / 2;

  if (img && img.complete && img.naturalWidth > 0) {
    const fW = img.naturalWidth / SPRITE_COLS;
    const fH = img.naturalHeight / SPRITE_ROWS_ANIM;
    const ds = TILE * 1.1;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(player.facing);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, anim.frame * fW, anim.row * fH, fW, fH, -ds / 2, -ds / 2, ds, ds);
    ctx.restore();
    return;
  }

  // Fallback circle character
  const r = PLAYER_SIZE;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(player.facing);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath(); ctx.ellipse(2, 2, r, r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, "#64d9ff"); g.addColorStop(1, "#0d7bbf");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#4fc3f7"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = "#0288d1";
  ctx.beginPath(); ctx.arc(0, -r * 0.55, r * 0.33, 0, Math.PI * 2); ctx.fill();
  for (const ex of [-0.28, 0.28]) {
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(r * ex, -r * 0.3, r * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#0a0a1a"; ctx.beginPath(); ctx.arc(r * ex, -r * 0.32, r * 0.08, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowColor = "#4fc3f7"; ctx.shadowBlur = 12;
  ctx.strokeStyle = "rgba(79,195,247,0.35)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ─── Draw: HUD ────────────────────────────────────────────────────────────────

function drawHUD(
  ctx: CanvasRenderingContext2D, inventory: ItemTemplate[],
  w: number, h: number, inventoryOpen: boolean
) {
  // Controls bar
  const cy = h - 52, cx = w / 2;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.strokeStyle = "rgba(79,195,247,0.2)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(cx - 140, cy - 12, 280, 70, 10); ctx.fill(); ctx.stroke();
  const wasd: [string, number, number][] = [
    ["W",0,0],["A",-30,30],["S",0,30],["D",30,30],
  ];
  for (const [l, dx, dy] of wasd) drawKey(ctx, cx - 85 + dx, cy + dy, l);
  ctx.fillStyle = "#546e7a"; ctx.font = "10px sans-serif";
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("Move", cx - 85 + 44 + 5, cy + 43);
  drawKey(ctx, cx + 10, cy + 15, "E");
  ctx.fillStyle = "#546e7a"; ctx.font = "10px sans-serif";
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("Interact", cx + 24 + 6, cy + 28);
  drawKey(ctx, cx + 80, cy + 15, "I");
  ctx.fillStyle = inventoryOpen ? "#4fc3f7" : "#546e7a";
  ctx.font = "10px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("Inventory", cx + 94 + 6, cy + 28);
  ctx.restore();

  // Weight bar
  const totalWeight = inventory.reduce((s, it) => s + it.weight, 0);
  const totalValue  = inventory.reduce((s, it) => s + it.value,  0);
  drawWeightBar(ctx, totalWeight, totalValue, inventory.length);
}

function drawWeightBar(ctx: CanvasRenderingContext2D, weight: number, value: number, count: number) {
  const px = 14, py = 14, bw = 160, bh = 52;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.strokeStyle = "rgba(79,195,247,0.2)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(px, py, bw, bh, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#90caf9"; ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText(`BAG  ×${count}`, px + 10, py + 8);
  ctx.fillStyle = "#aed581"; ctx.textAlign = "right";
  ctx.fillText(`$${value}`, px + bw - 10, py + 8);
  const barW = bw - 20, ratio = Math.min(weight / (WEIGHT_HIGH + 10), 1);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath(); ctx.roundRect(px + 10, py + 26, barW, 10, 4); ctx.fill();
  const barColor = weight < WEIGHT_LOW ? "#66bb6a" : weight < WEIGHT_MED ? "#ffca28" : weight < WEIGHT_HIGH ? "#ff7043" : "#ef5350";
  ctx.fillStyle = barColor;
  if (ratio > 0) { ctx.beginPath(); ctx.roundRect(px + 10, py + 26, barW * ratio, 10, 4); ctx.fill(); }
  const lbl = weight < WEIGHT_LOW ? "Light" : weight < WEIGHT_MED ? "Medium" : weight < WEIGHT_HIGH ? "Heavy" : "Overloaded";
  ctx.fillStyle = barColor; ctx.font = "10px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText(`${weight.toFixed(1)}lb — ${lbl}`, px + 10, py + 39);
  ctx.restore();
}

function drawKey(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  const bw = 26, bh = 26;
  ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.strokeStyle = "rgba(79,195,247,0.4)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#90caf9"; ctx.font = "bold 12px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, x + bw / 2, y + bh / 2);
}

// ─── Draw: inventory overlay ──────────────────────────────────────────────────

function drawInventoryOverlay(
  ctx: CanvasRenderingContext2D, inventory: ItemTemplate[],
  selected: number, w: number, h: number
) {
  ctx.fillStyle = "rgba(0,0,0,0.78)"; ctx.fillRect(0, 0, w, h);
  const panW = Math.min(520, w - 40);
  const rowH = 36, headerH = 48, footerH = 52;
  const panH = Math.min(headerH + inventory.length * rowH + footerH + 20, h - 60);
  const panX = (w - panW) / 2, panY = (h - panH) / 2;

  ctx.fillStyle = "#0e1825"; ctx.strokeStyle = "rgba(79,195,247,0.4)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(panX, panY, panW, panH, 12); ctx.fill(); ctx.stroke();

  ctx.fillStyle = "#4fc3f7"; ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("INVENTORY", panX + 20, panY + headerH / 2);
  const totalW = inventory.reduce((s, it) => s + it.weight, 0);
  const totalV = inventory.reduce((s, it) => s + it.value,  0);
  ctx.fillStyle = "#546e7a"; ctx.font = "12px sans-serif"; ctx.textAlign = "right";
  ctx.fillText(inventory.length === 0 ? "Empty" : `${inventory.length} items`, panX + panW - 20, panY + headerH / 2);

  ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(panX + 12, panY + headerH); ctx.lineTo(panX + panW - 12, panY + headerH); ctx.stroke();

  if (inventory.length === 0) {
    ctx.fillStyle = "#37474f"; ctx.font = "14px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Your bag is empty.", panX + panW / 2, panY + panH / 2 - 10);
  }

  const cols = { icon: panX + 24, name: panX + 52, cat: panX + panW * 0.48, val: panX + panW * 0.68, wgt: panX + panW * 0.82, drop: panX + panW - 20 };
  const hy = panY + headerH + 10;
  ctx.fillStyle = "#546e7a"; ctx.font = "10px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("NAME", cols.name, hy); ctx.fillText("CATEGORY", cols.cat, hy);
  ctx.textAlign = "right";
  ctx.fillText("VALUE", cols.val + 10, hy); ctx.fillText("WEIGHT", cols.wgt + 10, hy);

  const listTop = panY + headerH + 22;
  const visCount = Math.floor((panH - headerH - footerH - 22) / rowH);
  const scrollOff = Math.max(0, selected - visCount + 1);

  for (let vi = 0; vi < visCount; vi++) {
    const i = vi + scrollOff;
    if (i >= inventory.length) break;
    const item = inventory[i];
    const ry = listTop + vi * rowH;
    const isSel = i === selected;
    if (isSel) {
      ctx.fillStyle = "rgba(79,195,247,0.12)";
      ctx.beginPath(); ctx.roundRect(panX + 8, ry, panW - 16, rowH - 4, 6); ctx.fill();
      ctx.strokeStyle = "rgba(79,195,247,0.4)"; ctx.lineWidth = 1; ctx.stroke();
    }
    // Item texture in inventory
    const texUrl = ITEM_TEXTURE_MAP[item.name];
    if (texUrl) {
      const drawn = drawTextureFit(ctx, texUrl, cols.icon - 10, ry + rowH / 2 - 10, 20, 20);
      if (!drawn) { ctx.fillStyle = item.color; ctx.beginPath(); ctx.arc(cols.icon, ry + rowH / 2 - 2, 6, 0, Math.PI * 2); ctx.fill(); }
    } else {
      ctx.fillStyle = item.color; ctx.beginPath(); ctx.arc(cols.icon, ry + rowH / 2 - 2, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = isSel ? "#ffffff" : "#cfd8dc";
    ctx.font = `${isSel ? "bold " : ""}13px sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(item.name, cols.name, ry + rowH / 2 - 2);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath(); ctx.roundRect(cols.cat, ry + rowH / 2 - 9, 70, 18, 4); ctx.fill();
    ctx.fillStyle = item.color; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(item.category, cols.cat + 5, ry + rowH / 2 - 2);
    ctx.fillStyle = "#aed581"; ctx.font = "12px sans-serif"; ctx.textAlign = "right";
    ctx.fillText(`$${item.value}`, cols.val + 10, ry + rowH / 2 - 2);
    ctx.fillStyle = "#78909c";
    ctx.fillText(`${item.weight}lb`, cols.wgt + 10, ry + rowH / 2 - 2);
    if (isSel) { ctx.fillStyle = "#ef9a9a"; ctx.font = "bold 10px sans-serif"; ctx.fillText("[X] Drop", cols.drop, ry + rowH / 2 - 2); }
  }

  const fy = panY + panH - footerH;
  ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(panX + 12, fy); ctx.lineTo(panX + panW - 12, fy); ctx.stroke();
  ctx.fillStyle = "#b0bec5"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("TOTAL", panX + 20, fy + footerH / 2);
  ctx.fillStyle = "#aed581"; ctx.textAlign = "right";
  ctx.fillText(`$${totalV.toLocaleString()}`, panX + panW * 0.78, fy + footerH / 2);
  ctx.fillStyle = "#78909c";
  ctx.fillText(`${totalW.toFixed(1)} lb`, panX + panW - 20, fy + footerH / 2);
  ctx.fillStyle = "#455a64"; ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("↑ ↓  Navigate    [X]  Drop    [I / Esc]  Close", panX + panW / 2, panY + panH - 6);
}

// ─── UI: button primitive ─────────────────────────────────────────────────────

interface UIBtn {
  label: string; x: number; y: number; w: number; h: number;
  style?: "default" | "danger" | "back";
}

function drawUIBtn(ctx: CanvasRenderingContext2D, btn: UIBtn) {
  const { x, y, w, h, label, style = "default" } = btn;
  const fill   = style === "danger" ? "#991111" : style === "back" ? "#263238" : "#0d47a1";
  const border = style === "danger" ? "#ff5555" : style === "back" ? "#546e7a" : "#4fc3f7";
  ctx.save();
  ctx.fillStyle = fill; ctx.strokeStyle = border; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.restore();
}

function hitUIBtn(btn: UIBtn, mx: number, my: number): boolean {
  return mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h;
}

// ─── Draw: extraction zone ────────────────────────────────────────────────────

function drawExtractionZone(
  ctx: CanvasRenderingContext2D,
  camX: number, camY: number, W: number, H: number, now: number
) {
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
  const sx = PLAYER_SPAWN_COL * TILE - camX + W / 2;
  const sy = PLAYER_SPAWN_ROW * TILE - camY + H / 2;
  ctx.save();
  ctx.globalAlpha  = 0.14 + 0.08 * pulse;
  ctx.fillStyle    = "#4caf50";
  ctx.fillRect(sx, sy, TILE, TILE);
  ctx.globalAlpha  = 0.65 + 0.25 * pulse;
  ctx.strokeStyle  = "#66bb6a";
  ctx.lineWidth    = 2;
  ctx.strokeRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
  ctx.globalAlpha  = 0.75 + 0.2 * pulse;
  ctx.fillStyle    = "#a5d6a7";
  ctx.font         = "bold 8px monospace";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("EXIT", sx + TILE / 2, sy + TILE / 2);
  ctx.restore();
}

// ─── Draw: extracted overlay ──────────────────────────────────────────────────

function drawExtractedOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, now: number) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.72)"; ctx.fillRect(0, 0, W, H);
  const pulse = 0.8 + 0.2 * Math.sin(now * 0.004);
  ctx.globalAlpha  = pulse;
  ctx.fillStyle    = "#66bb6a";
  ctx.font         = "bold 64px monospace";
  ctx.textAlign    = "center"; ctx.textBaseline = "middle";
  ctx.fillText("EXTRACTED!", W / 2, H / 2 - 24);
  ctx.globalAlpha  = 0.8;
  ctx.fillStyle    = "#a5d6a7"; ctx.font = "18px sans-serif";
  ctx.fillText("You got away with the loot!", W / 2, H / 2 + 36);
  ctx.fillStyle    = "#888"; ctx.font = "13px sans-serif";
  ctx.fillText("Press R to return to the main menu.", W / 2, H / 2 + 64);
  ctx.restore();
}

// ─── Draw: main menu ──────────────────────────────────────────────────────────

function drawMainMenu(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  click: { x: number; y: number } | null,
  img: HTMLImageElement | null
): GameScreen | null {
  ctx.fillStyle = "#060c14"; ctx.fillRect(0, 0, W, H);
  const mid = W / 2;
  ctx.strokeStyle = "rgba(79,195,247,0.18)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(mid, H * 0.07); ctx.lineTo(mid, H * 0.93); ctx.stroke();

  // Left: title + buttons
  const lx = mid / 2;
  ctx.save();
  ctx.fillStyle   = "#4fc3f7"; ctx.font = "bold 52px monospace";
  ctx.textAlign   = "center";  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(79,195,247,0.4)"; ctx.shadowBlur = 18;
  ctx.fillText("Hit 'em Quick", lx, H * 0.27);
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = "rgba(144,202,249,0.65)"; ctx.font = "italic 22px sans-serif";
  ctx.fillText("get out fast.", lx, H * 0.27 + 54);
  ctx.restore();

  const BW = 220, BH = 52, bx = lx - BW / 2;
  const playBtn: UIBtn = { label: "Play", x: bx, y: H * 0.5,               w: BW, h: BH };
  const shopBtn: UIBtn = { label: "Shop", x: bx, y: H * 0.5 + BH + 16,     w: BW, h: BH };
  const quitBtn: UIBtn = { label: "Quit", x: bx, y: H * 0.5 + (BH+16)*2,   w: BW, h: BH, style: "danger" };
  for (const btn of [playBtn, shopBtn, quitBtn]) drawUIBtn(ctx, btn);

  // Right: artwork panel
  const rx = mid + (W - mid) / 2, ry = H / 2;
  const sz = Math.min(W - mid, H) * 0.52;
  ctx.save();
  ctx.globalAlpha = 0.1; ctx.fillStyle = "#4fc3f7";
  ctx.beginPath(); ctx.arc(rx, ry, sz * 0.54, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  if (img && img.complete && img.naturalWidth > 0) {
    const fW = img.naturalWidth / SPRITE_COLS, fH = img.naturalHeight / SPRITE_ROWS_ANIM;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, fW, fH, rx - sz / 2, ry - sz / 2, sz, sz);
  } else {
    ctx.font = `${sz * 0.6}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🕵️", rx, ry);
  }
  ctx.restore();

  if (click) {
    if (hitUIBtn(playBtn, click.x, click.y)) return "level-select";
    if (hitUIBtn(shopBtn, click.x, click.y)) return "shop";
    if (hitUIBtn(quitBtn, click.x, click.y)) { window.close(); return null; }
  }
  return null;
}

// ─── Draw: level select ───────────────────────────────────────────────────────

function drawLevelSelect(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  click: { x: number; y: number } | null
): GameScreen | null {
  ctx.fillStyle = "#060c14"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#4fc3f7"; ctx.font = "bold 36px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("Select Level", W / 2, H * 0.2);

  const BW = 220, BH = 52, bx = W / 2 - BW / 2;
  const LEVELS = ["Small", "Medium", "Large"];
  const levelBtns: UIBtn[] = LEVELS.map((lbl, i) => ({
    label: lbl, x: bx, y: H * 0.36 + i * (BH + 18), w: BW, h: BH,
  }));
  const backBtn: UIBtn = { label: "← Back", x: bx, y: H * 0.72, w: BW, h: BH, style: "back" };
  for (const btn of [...levelBtns, backBtn]) drawUIBtn(ctx, btn);

  ctx.fillStyle = "rgba(100,130,160,0.55)"; ctx.font = "12px sans-serif";
  ctx.fillText("All levels use the current map.", W / 2, H * 0.83);

  if (click) {
    for (const btn of levelBtns) if (hitUIBtn(btn, click.x, click.y)) return "playing";
    if (hitUIBtn(backBtn, click.x, click.y)) return "menu";
  }
  return null;
}

// ─── Draw: shop ───────────────────────────────────────────────────────────────

const SHOP_CATALOG = [
  { name: "Lockpicks",   desc: "Open locked doors silently.",   price: 150 },
  { name: "Noisemakers", desc: "Distract guards temporarily.",  price: 200 },
  { name: "Bag Upgrade", desc: "Carry 10 more lbs of loot.",    price: 300 },
] as const;

function drawShop(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  click: { x: number; y: number } | null
): GameScreen | null {
  ctx.fillStyle = "#060c14"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#4fc3f7"; ctx.font = "bold 36px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("Shop", W / 2, H * 0.12);
  ctx.fillStyle = "rgba(100,130,160,0.55)"; ctx.font = "13px sans-serif";
  ctx.fillText("Items and currency coming soon.", W / 2, H * 0.12 + 38);

  const PW = Math.min(520, W - 80), itemH = 68, startY = H * 0.24, px = W / 2 - PW / 2;
  for (let i = 0; i < SHOP_CATALOG.length; i++) {
    const item = SHOP_CATALOG[i], iy = startY + i * (itemH + 12);
    ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.strokeStyle = "rgba(79,195,247,0.13)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(px, iy, PW, itemH, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#cfd8dc"; ctx.font = "bold 15px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(item.name, px + 16, iy + itemH * 0.36);
    ctx.fillStyle = "#546e7a"; ctx.font = "12px sans-serif";
    ctx.fillText(item.desc, px + 16, iy + itemH * 0.7);
    ctx.fillStyle = "#aed581"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "right";
    ctx.fillText(`$${item.price}`, px + PW - 100, iy + itemH / 2);
    drawUIBtn(ctx, { label: "Buy", x: px + PW - 88, y: iy + (itemH - 32) / 2, w: 72, h: 32 });
  }

  const BW = 220;
  const backBtn: UIBtn = {
    label: "← Back", x: W / 2 - BW / 2,
    y: startY + SHOP_CATALOG.length * (itemH + 12) + 20,
    w: BW, h: 48, style: "back",
  };
  drawUIBtn(ctx, backBtn);
  if (click && hitUIBtn(backBtn, click.x, click.y)) return "menu";
  return null;
}

// ─── Game component ───────────────────────────────────────────────────────────

export default function Game() {
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const mapRef           = useRef<number[][]>(buildMutableMap());
  const furnitureMapRef  = useRef<number[][]>(buildFurnitureMap());
  const doorsRef         = useRef<Door[]>(buildDoors(mapRef.current));
  const itemsRef         = useRef<WorldItem[]>(buildWorldItems());
  const inventoryRef     = useRef<ItemTemplate[]>([]);
  const playerRef        = useRef<Player>({
    x: PLAYER_SPAWN_COL * TILE + TILE / 2,
    y: PLAYER_SPAWN_ROW * TILE + TILE / 2,
    facing: 0,
  });
  const keysRef = useRef<Keys>({
    w:false, a:false, s:false, d:false, e:false, i:false, x:false,
    ArrowUp:false, ArrowDown:false, ArrowLeft:false, ArrowRight:false, Escape:false,
  });
  const animRef          = useRef<AnimState>({ row: ANIM_ROW_DOWN, frame: 0, timer: 0 });
  const imgRef           = useRef<HTMLImageElement | null>(null);
  const inventoryOpenRef = useRef(false);
  const inventorySelRef  = useRef(0);
  const ePrev    = useRef(false);
  const iPrev    = useRef(false);
  const xPrev    = useRef(false);
  const upPrev   = useRef(false);
  const downPrev = useRef(false);
  const rafRef      = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const guardsRef   = useRef<Guard[]>(initGuards());
  const policeRef   = useRef<Police[]>([]);
  const suspicionRef = useRef<SuspicionMarker[]>([]);
  const caughtRef   = useRef<boolean>(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    preloadAllTextures();

    const img = new Image();
    img.src = "/sprites/player.png";
    img.onload = () => { imgRef.current = img; };

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.code.replace("Key", "").toLowerCase();
      if (k in keysRef.current)      keysRef.current[k] = true;
      if (e.code in keysRef.current) keysRef.current[e.code] = true;
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space","KeyE","KeyI","KeyX"].includes(e.code)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.code.replace("Key", "").toLowerCase();
      if (k in keysRef.current)      keysRef.current[k] = false;
      if (e.code in keysRef.current) keysRef.current[e.code] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup",   onKeyUp);
    canvas.focus();

    const loop = (now: number) => {
      const dt     = Math.min((now - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = now;

      const keys         = keysRef.current;
      const player       = playerRef.current;
      const map          = mapRef.current;
      const furnitureMap = furnitureMapRef.current;
      const anim         = animRef.current;

      // Inventory toggle
      const iDown = keys.i || keys.Escape;
      if (iDown && !iPrev.current) {
        inventoryOpenRef.current = !inventoryOpenRef.current;
        if (!inventoryOpenRef.current) inventorySelRef.current = 0;
      }
      iPrev.current = iDown;

      // Inventory navigation
      if (inventoryOpenRef.current) {
        const len = inventoryRef.current.length;
        if (keys.ArrowUp   && !upPrev.current   && len > 0) inventorySelRef.current = Math.max(0, inventorySelRef.current - 1);
        if (keys.ArrowDown && !downPrev.current && len > 0) inventorySelRef.current = Math.min(len - 1, inventorySelRef.current + 1);
        const xDown = keys.x;
        if (xDown && !xPrev.current && len > 0) {
          inventoryRef.current = inventoryRef.current.filter((_, i) => i !== inventorySelRef.current);
          inventorySelRef.current = Math.min(inventorySelRef.current, inventoryRef.current.length - 1);
          if (inventorySelRef.current < 0) inventorySelRef.current = 0;
        }
        xPrev.current = xDown; upPrev.current = keys.ArrowUp; downPrev.current = keys.ArrowDown;
      } else {
        xPrev.current = false; upPrev.current = downPrev.current = false;
      }

      // Freeze everything if caught
      if (caughtRef.current) {
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const camX = playerRef.current.x, camY = playerRef.current.y;
        drawWorld(ctx, mapRef.current, doorsRef.current, camX, camY, W, H);
        drawFurniture(ctx, camX, camY, W, H);
        drawItems(ctx, itemsRef.current, null, camX, camY, W, H, now);
        drawGuards(ctx, guardsRef.current, camX, camY, W, H, now);
        drawPolice(ctx, policeRef.current, camX, camY, W, H);
        drawPlayer(ctx, playerRef.current, W, H, animRef.current, imgRef.current);
        drawCaughtOverlay(ctx, W, H, now);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Movement
      let vx = 0, vy = 0;
      if (!inventoryOpenRef.current) {
        if (keys.w || keys.ArrowUp)    vy -= 1;
        if (keys.s || keys.ArrowDown)  vy += 1;
        if (keys.a || keys.ArrowLeft)  vx -= 1;
        if (keys.d || keys.ArrowRight) vx += 1;
      }

      const totalWeight = inventoryRef.current.reduce((s, it) => s + it.weight, 0);
      const speed = effectiveSpeed(totalWeight);

      if (vx !== 0 || vy !== 0) {
        const len = Math.sqrt(vx * vx + vy * vy);
        vx = (vx / len) * speed; vy = (vy / len) * speed;
        // Rotate character with direction
        player.facing = Math.atan2(vy, vx) + Math.PI / 2;

        if (Math.abs(vy) >= Math.abs(vx))
          anim.row = vy > 0 ? ANIM_ROW_DOWN : ANIM_ROW_UP;
        else
          anim.row = vx > 0 ? ANIM_ROW_RIGHT : ANIM_ROW_LEFT;

        anim.timer += dt * 1000;
        if (anim.timer >= ANIM_FRAME_MS) {
          anim.frame  = (anim.frame + 1) % SPRITE_COLS;
          anim.timer -= ANIM_FRAME_MS;
        }
      } else {
        anim.frame = 0; anim.timer = 0;
      }

      player.x += vx * dt; resolveCollision(player, map, furnitureMap);
      player.y += vy * dt; resolveCollision(player, map, furnitureMap);
      player.x = Math.max(PLAYER_SIZE, Math.min(WORLD_W - PLAYER_SIZE, player.x));
      player.y = Math.max(PLAYER_SIZE, Math.min(WORLD_H - PLAYER_SIZE, player.y));

      // ── AI update ──────────────────────────────────────────────────────────
      const guardResult = updateGuards(
        guardsRef.current, player.x, player.y, map, dt
      );
      if (guardResult.shouldSpawnPolice && policeRef.current.length === 0) {
        // Place / update the suspicion marker
        suspicionRef.current = [{
          col: guardResult.suspicionCol,
          row: guardResult.suspicionRow,
        }];
        policeRef.current.push(
          spawnPolice(guardResult.suspicionCol, guardResult.suspicionRow, map)
        );
      }
      const policeResult = updatePolice(
        policeRef.current, player.x, player.y, map, dt,
        guardResult.playerSeenByGuard
      );
      if (policeResult.arrested) {
        caughtRef.current = true;
      }
      // Clear suspicion markers once all police have despawned
      if (policeRef.current.length === 0) {
        suspicionRef.current = [];
      }

      // Find nearest interactable
      let nearest: Interactable | null = null;
      let nearDist = INTERACT_RANGE;
      if (!inventoryOpenRef.current) {
        for (const item of itemsRef.current) {
          if (item.collected) continue;
          const { x, y } = tileCenterPx(item.col, item.row);
          const d = dist(player.x, player.y, x, y);
          if (d < nearDist) { nearDist = d; nearest = { kind: "item", item }; }
        }
        for (const door of doorsRef.current) {
          const { x, y } = tileCenterPx(door.col, door.row);
          const d = dist(player.x, player.y, x, y);
          if (d < nearDist) { nearDist = d; nearest = { kind: "door", door }; }
        }
      }

      // E key interaction
      const eDown = keys.e;
      if (eDown && !ePrev.current && nearest && !inventoryOpenRef.current) {
        if (nearest.kind === "item") {
          nearest.item.collected = true;
          inventoryRef.current = [...inventoryRef.current, nearest.item.template];
          if (inventorySelRef.current >= inventoryRef.current.length)
            inventorySelRef.current = Math.max(0, inventoryRef.current.length - 1);
        } else {
          nearest.door.open = !nearest.door.open;
          map[nearest.door.row][nearest.door.col] = nearest.door.open ? 0 : 2;
        }
      }
      ePrev.current = eDown;

      // Render
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const camX = player.x, camY = player.y;

      drawWorld(ctx, map, doorsRef.current, camX, camY, W, H);
      drawFurniture(ctx, camX, camY, W, H);
      drawItems(ctx, itemsRef.current, nearest, camX, camY, W, H, now);
      drawDoorInteractables(ctx, doorsRef.current, nearest, camX, camY, W, H, now);
      drawSuspicionMarkers(ctx, suspicionRef.current, camX, camY, W, H, now);
      drawGuards(ctx, guardsRef.current, camX, camY, W, H, now);
      drawPolice(ctx, policeRef.current, camX, camY, W, H);
      drawPlayer(ctx, player, W, H, anim, imgRef.current);
      drawHUD(ctx, inventoryRef.current, W, H, inventoryOpenRef.current);
      if (inventoryOpenRef.current)
        drawInventoryOverlay(ctx, inventoryRef.current, inventorySelRef.current, W, H);

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(now => {
      lastTimeRef.current = now;
      rafRef.current = requestAnimationFrame(loop);
    });

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup",   onKeyUp);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      style={{ display:"block", width:"100vw", height:"100vh",
               outline:"none", cursor:"default", background:"#060809" }}
    />
  );
}
