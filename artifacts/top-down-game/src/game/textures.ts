// ─── Texture loading & drawing system ────────────────────────────────────────

const textureCache: Map<string, HTMLImageElement> = new Map();

export function preloadTexture(url: string): HTMLImageElement {
  if (textureCache.has(url)) return textureCache.get(url)!;
  const img = new Image();
  img.src = url;
  textureCache.set(url, img);
  return img;
}

export function preloadTextures(urls: string[]) {
  for (const url of urls) preloadTexture(url);
}

function getTexture(url: string): HTMLImageElement | null {
  const img = textureCache.get(url);
  if (!img) return null;
  return img.complete && img.naturalWidth > 0 ? img : null;
}

// Draw a texture at exactly w×h (for floors — tile-sized, no stretching issue)
export function drawTextureTile(
  ctx: CanvasRenderingContext2D,
  url: string,
  x: number, y: number,
  w: number, h: number
): boolean {
  const img = getTexture(url);
  if (!img) return false;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
  return true;
}

// Draw a texture centered in the cell, preserving aspect ratio (letterboxed inside w×h)
// Used for furniture and items so they are never distorted
export function drawTextureFit(
  ctx: CanvasRenderingContext2D,
  url: string,
  x: number, y: number,
  w: number, h: number,
  rotation = 0,
  flipX = false,
  flipY = false
): boolean {
  const img = getTexture(url);
  if (!img) return false;

  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw === 0 || nh === 0) return false;

  // Fit inside w×h keeping aspect ratio
  const scale = Math.min(w / nw, h / nh);
  const dw = nw * scale;
  const dh = nh * scale;

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (rotation) ctx.rotate(rotation);
  if (flipX) ctx.scale(-1, 1);
  if (flipY) ctx.scale(1, -1);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  return true;
}

// ─── Texture URL constants ─────────────────────────────────────────────────

export const T = {
  // Kitchen floors
  kFloorWhite:   "textures/Kitchen/Floor/Kitchen-Floor-White(Base).png",
  kFloorWhiteS1: "textures/Kitchen/Floor/Kitchen-Floor-White(s1).png",
  kFloorWhiteS2: "textures/Kitchen/Floor/Kitchen-Floor-White(s2).png",
  kFloorBlack:   "textures/Kitchen/Floor/Kitchen-Floor-Black(Base).png",
  kFloorBlackS1: "textures/Kitchen/Floor/Kitchen-Floor-Black(s1).png",
  kFloorBlackS2: "textures/Kitchen/Floor/Kitchen-Floor-Black(s2).png",

  // Home floors
  hFloor: "textures/Home/Floor/Home-Floor.png",

  // Kitchen counters
  kCounterBase: "textures/Kitchen/Counter/Kitchen-Counter(Base).png",
  kCounterCB:   "textures/Kitchen/Counter/Kitchen-Counter(CB).png",
  kCounterCorn: "textures/Kitchen/Counter/Kitchen-Counter(Corn).png",
  kCounterDirt: "textures/Kitchen/Counter/Kitchen-Counter(Dirt).png",
  kStove:        "textures/Kitchen/Counter/Kitchen-Stove.png",
  kSink:         "textures/Kitchen/Counter/Kitchen-Sink.png",

  // Home furniture
  hTableBase: "textures/Home/Furniture/Home-Table(Base).png",
  hTableCig:  "textures/Home/Furniture/Home-Table(Cig).png",
  hLamp:      "textures/Home/Furniture/Home-Lamp.png",
  hCouchL:    "textures/Home/Furniture/Home-Couch(L).png",
  hCouchM:    "textures/Home/Furniture/Home-Couch(M).png",
  hCouchR:    "textures/Home/Furniture/Home-Couch(R).png",

  // Tech items
  techTV:         "textures/Tech/Items/TV.png.png",
  techSpeaker:    "textures/Tech/Items/Speaker.png.png",
  techRadio:      "textures/Tech/Items/Radio.png.png",
  techPhone:      "textures/Tech/Items/Phone.png.png",
  techLaptop:     "textures/Tech/Items/Laptop.png.png",
  techKeyboard:   "textures/Tech/Items/Keyboard.png.png",
  techHeadphones: "textures/Tech/Items/Headphones.png.png",

  // Kitchen items
  kPlate: "textures/Kitchen/Items/Plate.png.png",
  kPan:   "textures/Kitchen/Items/Pan.png.png",
  kKnife: "textures/Kitchen/Items/Knife.png.png",

  // Jewelry items
  jScarf:       "textures/Jewelry/Items/Scarf.png.png",
  jGoldNecklace:"textures/Jewelry/Items/Gold-necklace.png.png",
  jDiamondRing: "textures/Jewelry/Items/Diamond-Ring.png.png",

  // Home items
  hTV:      "textures/Home/Items/TV.png.png",
  hRadio:   "textures/Home/Items/Radio.png.png",
  hPhone:   "textures/Home/Items/Phone.png.png",
  hLaptop:  "textures/Home/Items/Laptop.png.png",
  hKeyboard:"textures/Home/Items/Keyboard.png.png",
};

export function preloadAllTextures() {
  preloadTextures(Object.values(T));
}

// ─── Item name → texture URL ──────────────────────────────────────────────

export const ITEM_TEXTURE_MAP: Record<string, string> = {
  // Kitchen
  "Cast Iron Pan":    T.kPan,
  "Chef's Knife":     T.kKnife,
  "Espresso Machine": T.techSpeaker,
  "Blender":          T.kPan,
  "Toaster Oven":     T.techRadio,
  "Knife Set":        T.kKnife,
  "Ceramic Bowl Set": T.kPlate,
  "Coffee Maker":     T.techPhone,
  // Jewelry / bedroom
  "Diamond Ring":     T.jDiamondRing,
  "Gold Necklace":    T.jGoldNecklace,
  "Pearl Earrings":   T.jGoldNecklace,
  "Luxury Watch":     T.jScarf,
  "Jewelry Box":      T.jDiamondRing,
  "Vintage Coin":     T.jScarf,
  "Silk Scarf":       T.jScarf,
  "Leather Wallet":   T.jScarf,
  // Tech / office
  "Laptop":               T.techLaptop,
  "Tablet":               T.techLaptop,
  "Smartphone":           T.techPhone,
  "Camera":               T.techHeadphones,
  "Wireless Headphones":  T.techHeadphones,
  "External Hard Drive":  T.techKeyboard,
  "Smart Speaker":        T.techSpeaker,
  "Mechanical Keyboard":  T.techKeyboard,
  // Living room
  "Flatscreen TV":    T.techTV,
  "Gaming Console":   T.techKeyboard,
  "Oil Painting":     T.jGoldNecklace,
  "Bronze Vase":      T.jDiamondRing,
  "Antique Clock":    T.techRadio,
  "Bluetooth Speaker":T.techSpeaker,
  "Leather Jacket":   T.jScarf,
  "Silk Dress":       T.jScarf,
  // Garage
  "Power Drill":      T.techKeyboard,
  "Toolbox":          T.techKeyboard,
  "Air Compressor":   T.techSpeaker,
  "Angle Grinder":    T.techRadio,
};
