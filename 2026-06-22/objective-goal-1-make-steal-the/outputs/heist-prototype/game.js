import * as THREE from "./vendor/three.module.js";

const canvas = document.getElementById("game");

const ui = {
  basePanel: document.getElementById("basePanel"),
  heistPanel: document.getElementById("heistPanel"),
  cashLabel: document.getElementById("cashLabel"),
  debtLabel: document.getElementById("debtLabel"),
  bagLabel: document.getElementById("bagLabel"),
  statusLine: document.getElementById("statusLine"),
  prompt: document.getElementById("prompt"),
  toast: document.getElementById("toast"),
  shopList: document.getElementById("shopList"),
  furnitureList: document.getElementById("furnitureList"),
  inventoryList: document.getElementById("inventoryList"),
  toolGrid: document.getElementById("toolGrid"),
  startHeistBtn: document.getElementById("startHeistBtn"),
  payDebtBtn: document.getElementById("payDebtBtn"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalText: document.getElementById("modalText"),
  modalBtn: document.getElementById("modalBtn"),
  heatMeter: document.getElementById("heatMeter"),
  sightMeter: document.getElementById("sightMeter"),
  noiseMeter: document.getElementById("noiseMeter")
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 140);
const clock = new THREE.Clock();

const colors = {
  floor: 0x1b292a,
  floorAlt: 0x26393a,
  wall: 0x182123,
  trim: 0x44605d,
  player: 0x62d49f,
  guard: 0xec6f67,
  alerted: 0xf0c66e,
  exit: 0x62d49f,
  sight: 0xec6f67,
  sound: 0xf0c66e
};

const world = {
  halfW: 22,
  halfD: 16,
  exit: { x: -20.2, z: 14.1, r: 1.25 }
};

const shop = [
  { id: "lockpick", name: "Lockpick", cost: 300, desc: "Open display locks" },
  { id: "diffuser", name: "Alarm Diffuser", cost: 650, desc: "Silence one alarm" },
  { id: "noisemaker", name: "Noisemaker", cost: 225, desc: "Throw a lure" },
  { id: "duplicate", name: "Duplicate Item", cost: 450, desc: "Slow low-noise swap" },
  { id: "bag", name: "Better Bag", cost: 1200, desc: "+$1,250 capacity" }
];

const furniture = [
  { id: "cot", name: "Cot", cost: 500, bonus: "Base comfort" },
  { id: "map", name: "Wall Map", cost: 900, bonus: "+10% item intel" },
  { id: "bench", name: "Workbench", cost: 1300, bonus: "Tools are $50 cheaper" },
  { id: "radio", name: "Police Scanner", cost: 1800, bonus: "-10 starting heat" }
];

const lootTypes = [
  { name: "Silverware", base: 260, risk: 1, weight: 1, color: 0xc8d6d7, shape: "box" },
  { name: "Laptop", base: 520, risk: 2, weight: 1, color: 0x78a7ff, shape: "slab" },
  { name: "Painting", base: 880, risk: 3, weight: 2, color: 0xf0c66e, shape: "frame" },
  { name: "Rare Watch", base: 1180, risk: 3, weight: 1, color: 0xadf0cb, shape: "cylinder" },
  { name: "Display Jewels", base: 1720, risk: 4, weight: 2, color: 0xff8cd3, locked: true, shape: "gem" },
  { name: "Safe Cash", base: 2250, risk: 5, weight: 3, color: 0x72e0b0, locked: true, alarm: true, shape: "safe" }
];

const state = {
  mode: "base",
  cash: 0,
  debt: 25000,
  heat: 0,
  tools: { lockpick: 1, diffuser: 0, noisemaker: 1, duplicate: 1, bag: 0 },
  furniture: {},
  heistNumber: 0
};

let run = null;
let toastTimer = 0;
const keys = new Set();
const pressed = new Set();
const scratch = new THREE.Vector3();

const mats = {};
function mat(name, color, opts = {}) {
  if (!mats[name]) {
    mats[name] = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.72,
      metalness: opts.metalness ?? 0.02,
      transparent: Boolean(opts.transparent),
      opacity: opts.opacity ?? 1,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0
    });
  }
  return mats[name];
}

function money(value) {
  return `$${Math.round(value).toLocaleString()}`;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist2(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clearScene() {
  while (scene.children.length) scene.remove(scene.children[0]);
}

function addLights() {
  scene.background = new THREE.Color(0x0b1517);
  scene.fog = new THREE.Fog(0x0b1517, 18, 52);
  const hemi = new THREE.HemisphereLight(0xd8fff2, 0x263534, 1.7);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.85);
  key.position.set(-10, 16, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -34;
  key.shadow.camera.right = 34;
  key.shadow.camera.top = 28;
  key.shadow.camera.bottom = -28;
  scene.add(key);
}

function addBox(x, y, z, w, h, d, material, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addFloor() {
  addBox(0, -0.08, 0, world.halfW * 2, 0.16, world.halfD * 2, mat("floor", colors.floor), false);
  for (let x = -world.halfW; x < world.halfW; x += 4) {
    for (let z = -world.halfD; z < world.halfD; z += 4) {
      if ((Math.round((x + world.halfW) / 4) + Math.round((z + world.halfD) / 4)) % 2 === 0) {
        addBox(x + 2, -0.06, z + 2, 3.9, 0.04, 3.9, mat(`floorAlt${x}${z}`, colors.floorAlt), false);
      }
    }
  }
}

function buildPlayerMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 1.05, 8), mat("player", colors.player));
  body.position.y = 0.6;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat("playerHead", 0xa2ffd0));
  head.position.y = 1.28;
  head.castShadow = true;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 6), mat("playerNose", 0x0d1514));
  nose.position.set(0, 1.19, -0.36);
  nose.rotation.x = -Math.PI / 2;
  group.add(body, head, nose);
  return group;
}

function buildGuardMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.15, 7), mat("guard", colors.guard));
  body.position.y = 0.62;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 10, 8), mat("guardHead", 0xffb0a8));
  head.position.y = 1.32;
  head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.14, 0.5), mat("guardCap", 0x121719));
  cap.position.y = 1.58;
  cap.castShadow = true;
  group.add(body, head, cap);
  return group;
}

function buildVisionCone() {
  const length = 9.8;
  const half = 0.62;
  const points = [0, 0.035, 0];
  const segments = 16;
  for (let i = 0; i <= segments; i += 1) {
    const angle = -half + (half * 2 * i) / segments;
    points.push(Math.sin(angle) * length, 0.035, -Math.cos(angle) * length);
  }
  const indices = [];
  for (let i = 1; i <= segments; i += 1) indices.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: colors.sight,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
}

function buildLootMesh(item) {
  const group = new THREE.Group();
  let mesh;
  const material = new THREE.MeshStandardMaterial({
    color: item.color,
    roughness: 0.42,
    metalness: item.risk > 2 ? 0.28 : 0.04,
    emissive: item.alarm ? 0x3a0000 : 0x000000,
    emissiveIntensity: item.alarm ? 0.35 : 0
  });
  if (item.shape === "cylinder") mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 14), material);
  else if (item.shape === "gem") mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), material);
  else if (item.shape === "safe") mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.72), material);
  else if (item.shape === "frame") mesh = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.1, 0.12), material);
  else if (item.shape === "slab") mesh = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 0.56), material);
  else mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.5), material);
  mesh.position.y = item.shape === "frame" ? 0.9 : 0.48;
  mesh.castShadow = true;
  group.add(mesh);
  if (item.locked) {
    const caseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.08, 1.15),
      new THREE.MeshStandardMaterial({ color: 0xd6e2e1, transparent: true, opacity: 0.42, roughness: 0.18 })
    );
    caseMesh.position.y = 0.18;
    group.add(caseMesh);
  }
  if (item.alarm) {
    const alarm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat("alarmLight", 0xff5149, { emissive: 0xff2c24, emissiveIntensity: 1.6 }));
    alarm.position.set(0.56, 0.58, 0.56);
    group.add(alarm);
  }
  group.position.set(item.x, 0, item.z);
  return group;
}

function rectMinX(r) { return r.x - r.w / 2; }
function rectMaxX(r) { return r.x + r.w / 2; }
function rectMinZ(r) { return r.z - r.d / 2; }
function rectMaxZ(r) { return r.z + r.d / 2; }

function circleHitsRect(entity, wall, pad = 0) {
  const nearestX = clamp(entity.x, rectMinX(wall) - pad, rectMaxX(wall) + pad);
  const nearestZ = clamp(entity.z, rectMinZ(wall) - pad, rectMaxZ(wall) + pad);
  return Math.hypot(entity.x - nearestX, entity.z - nearestZ) < entity.r;
}

function collides(entity) {
  if (
    entity.x < -world.halfW + entity.r ||
    entity.x > world.halfW - entity.r ||
    entity.z < -world.halfD + entity.r ||
    entity.z > world.halfD - entity.r
  ) return true;
  return run?.walls.some((wall) => circleHitsRect(entity, wall)) ?? false;
}

function moveEntity(entity, dx, dz) {
  let moved = 0;
  const oldX = entity.x;
  const oldZ = entity.z;
  entity.x += dx;
  if (collides(entity)) entity.x = oldX;
  entity.z += dz;
  if (collides(entity)) entity.z = oldZ;
  moved = Math.hypot(entity.x - oldX, entity.z - oldZ);
  return moved;
}

function lineHitsRect(a, b, wall, pad = 0.06) {
  const steps = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 0.18);
  if (steps <= 0) return false;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (x >= rectMinX(wall) - pad && x <= rectMaxX(wall) + pad && z >= rectMinZ(wall) - pad && z <= rectMaxZ(wall) + pad) return true;
  }
  return false;
}

function hasLineOfSight(a, b) {
  return !run.walls.some((wall) => lineHitsRect(a, b, wall));
}

const navNodes = [
  { id: "exit", x: -20, z: 14 }, { id: "southA", x: -14, z: 12 }, { id: "southB", x: -5, z: 12 },
  { id: "southC", x: 6, z: 12 }, { id: "southD", x: 16, z: 12 }, { id: "westMid", x: -18, z: 1 },
  { id: "midA", x: -10, z: 1 }, { id: "midB", x: 1, z: 1 }, { id: "midC", x: 12, z: 1 },
  { id: "eastMid", x: 20, z: 1 }, { id: "westNorth", x: -18, z: -11 }, { id: "northA", x: -10, z: -11 },
  { id: "northB", x: 1, z: -11 }, { id: "northC", x: 12, z: -11 }, { id: "eastNorth", x: 20, z: -11 },
  { id: "gallery", x: 18, z: -4 }, { id: "vault", x: 18, z: 8 }
];

const navEdges = [
  ["exit", "southA"], ["southA", "southB"], ["southB", "southC"], ["southC", "southD"], ["southD", "vault"],
  ["southA", "westMid"], ["southB", "midB"], ["southC", "midC"], ["southD", "eastMid"],
  ["westMid", "midA"], ["midA", "midB"], ["midB", "midC"], ["midC", "eastMid"],
  ["westMid", "westNorth"], ["midA", "northA"], ["midB", "northB"], ["midC", "northC"], ["eastMid", "eastNorth"],
  ["westNorth", "northA"], ["northA", "northB"], ["northB", "northC"], ["northC", "eastNorth"], ["eastNorth", "gallery"], ["gallery", "eastMid"]
];

const navGraph = new Map(navNodes.map((node) => [node.id, []]));
for (const [a, b] of navEdges) {
  navGraph.get(a).push(b);
  navGraph.get(b).push(a);
}

function nearestNode(point) {
  return navNodes.reduce((best, node) => (Math.hypot(point.x - node.x, point.z - node.z) < best.d ? { node, d: Math.hypot(point.x - node.x, point.z - node.z) } : best), { node: navNodes[0], d: Infinity }).node;
}

function pathBetween(startPoint, endPoint) {
  const start = nearestNode(startPoint).id;
  const goal = nearestNode(endPoint).id;
  const queue = [start];
  const came = new Map([[start, null]]);
  while (queue.length) {
    const current = queue.shift();
    if (current === goal) break;
    for (const next of navGraph.get(current)) {
      if (!came.has(next)) {
        came.set(next, current);
        queue.push(next);
      }
    }
  }
  if (!came.has(goal)) return [{ x: endPoint.x, z: endPoint.z }];
  const ids = [];
  let cur = goal;
  while (cur) {
    ids.push(cur);
    cur = came.get(cur);
  }
  return ids.reverse().map((id) => {
    const node = navNodes.find((candidate) => candidate.id === id);
    return { x: node.x, z: node.z };
  }).concat({ x: endPoint.x, z: endPoint.z });
}

function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add("show");
  toastTimer = 2.4;
}

function setPrompt(text) {
  ui.prompt.textContent = text;
  ui.prompt.classList.toggle("show", Boolean(text));
}

function showModal(title, text, button) {
  ui.modalTitle.textContent = title;
  ui.modalText.textContent = text;
  ui.modalBtn.textContent = button;
  ui.modal.classList.remove("hidden");
}

function hideModal() {
  ui.modal.classList.add("hidden");
}

function renderShop() {
  const discount = state.furniture.bench ? 50 : 0;
  ui.shopList.innerHTML = "";
  for (const item of shop) {
    const cost = Math.max(50, item.cost - discount);
    const count = state.tools[item.id] || 0;
    const row = document.createElement("div");
    row.className = `shop-item ${count > 0 ? "owned" : ""}`;
    row.innerHTML = `<div><strong>${item.name}</strong><span>${item.desc}${count ? ` | owned ${count}` : ""}</span></div><button>${money(cost)}</button>`;
    row.querySelector("button").addEventListener("click", () => buy(item));
    ui.shopList.appendChild(row);
  }

  ui.furnitureList.innerHTML = "";
  for (const item of furniture) {
    const owned = Boolean(state.furniture[item.id]);
    const row = document.createElement("div");
    row.className = `shop-item ${owned ? "owned upgrade-pop" : ""}`;
    row.innerHTML = `<div><strong>${owned ? "Owned " : ""}${item.name}</strong><span>${owned ? item.bonus : money(item.cost)}</span></div><button>${owned ? "Owned" : "Buy"}</button>`;
    row.querySelector("button").disabled = owned;
    row.querySelector("button").addEventListener("click", () => buyFurniture(item));
    ui.furnitureList.appendChild(row);
  }
}

function updateUi() {
  ui.basePanel.style.display = state.mode === "base" ? "block" : "none";
  ui.heistPanel.style.display = state.mode === "heist" ? "grid" : "none";
  ui.cashLabel.textContent = money(state.cash);
  ui.debtLabel.textContent = money(state.debt);
  ui.statusLine.textContent = state.debt > 0 ? `Boss debt: ${money(state.debt)}` : "Free, but the vaults still glitter";

  if (run) {
    ui.bagLabel.textContent = `${money(run.bagValue)} / ${money(run.bagCap)}`;
    ui.heatMeter.value = run.heat;
    ui.sightMeter.value = run.sight;
    ui.noiseMeter.value = run.noise;
    ui.inventoryList.innerHTML = run.inventory.length
      ? run.inventory.map((item) => `<div class="inv-item"><div><strong>${item.name}</strong><span>${item.swapped ? "duplicate left" : "missing"}</span></div><strong>${money(item.value)}</strong></div>`).join("")
      : `<div class="empty">Bag empty</div>`;
    ui.toolGrid.innerHTML = [
      ["lockpick", "F", "Lockpick"],
      ["diffuser", "Z", "Diffuser"],
      ["noisemaker", "Q", "Noisemaker"],
      ["duplicate", "Shift+E", "Duplicate"]
    ].map(([id, key, label]) => `<div class="tool-pill ${state.tools[id] ? "owned" : ""}"><span>${key} ${label}</span><strong>${state.tools[id] || 0}</strong></div>`).join("");
  } else {
    ui.heatMeter.value = state.heat;
    ui.sightMeter.value = 0;
    ui.noiseMeter.value = 0;
  }
  renderShop();
}

function buy(item) {
  const discount = state.furniture.bench ? 50 : 0;
  const cost = Math.max(50, item.cost - discount);
  if (state.cash < cost) {
    showToast("You need more cash.");
    return;
  }
  state.cash -= cost;
  state.tools[item.id] = (state.tools[item.id] || 0) + 1;
  updateUi();
}

function buyFurniture(item) {
  if (state.furniture[item.id]) return;
  if (state.cash < item.cost) {
    showToast("That upgrade is still out of reach.");
    return;
  }
  state.cash -= item.cost;
  state.furniture[item.id] = true;
  buildBaseScene();
  showToast(`${item.name} installed.`);
  updateUi();
}

function payDebt() {
  if (state.cash <= 0) return;
  const paid = Math.min(state.cash, state.debt);
  state.cash -= paid;
  state.debt -= paid;
  if (state.debt <= 0) {
    state.debt = 0;
    showModal("You Bought Your Way Out", "The boss tears up the ledger. Keep running heists for high scores, but the debt is gone.", "Keep Playing");
  } else {
    showToast(`${money(paid)} sent to the boss.`);
  }
  updateUi();
}

function buildWalls() {
  const walls = [
    //{ x: 0, z: -16.3, w: 44, d: 0.6 }, { x: 0, z: 16.3, w: 44, d: 0.6 },
    //{ x: -22.3, z: 0, w: 0.6, d: 32 }, { x: 22.3, z: 0, w: 0.6, d: 32 },
    //{ x: -14, z: -7.6, w: 0.7, d: 15.2 }, { x: -14, z: 10.7, w: 0.7, d: 6.6 },
    //{ x: -4.5, z: -10.4, w: 0.7, d: 11.2 }, { x: -4.5, z: 9.2, w: 0.7, d: 9.6 },
    //{ x: 7, z: -5.6, w: 0.7, d: 12.8 }, { x: 7, z: 11.1, w: 0.7, d: 6.6 },
    //{ x: 17, z: -10.6, w: 0.7, d: 10.8 }, { x: 17, z: 6.1, w: 0.7, d: 12.2 },
    //{ x: -16.8, z: -6, w: 10.4, d: 0.7 }, { x: -0.6, z: -6, w: 7.8, d: 0.7 }, { x: 12.4, z: -6, w: 8.2, d: 0.7 },
    //{ x: -16.4, z: 5, w: 11.2, d: 0.7 }, { x: -0.2, z: 5, w: 8.4, d: 0.7 }, { x: 14.5, z: 5, w: 7.2, d: 0.7 }
  ];
  for (const wall of walls) {
    addBox(wall.x, 1.15, wall.z, wall.w, 2.3, wall.d, mat("wall", colors.wall));
    addBox(wall.x, 2.32, wall.z, wall.w, 0.08, wall.d, mat("trim", colors.trim), false);
  }
  return walls;
}

function buildBaseScene() {
  run = null;
  state.mode = "base";
  clearScene();
  addLights();
  scene.fog = new THREE.Fog(0x081012, 18, 42);
  addBox(0, -0.08, 0, 24, 0.16, 16, mat("baseFloor", 0x1b2627), false);
  addBox(0, 1.4, -8.2, 24, 2.8, 0.5, mat("wall", colors.wall));
  addBox(-12.2, 1.4, 0, 0.5, 2.8, 16, mat("wall", colors.wall));
  addBox(12.2, 1.4, 0, 0.5, 2.8, 16, mat("wall", colors.wall));
  addBox(0, 0.28, 4.4, 5.4, 0.56, 1.5, mat("table", 0x4d5e56));
  addBox(-4.8, 0.45, -2.5, 2.1, 0.9, 1.3, mat("crate", 0x73563f));
  addBox(4.8, 0.45, -2.5, 2.1, 0.9, 1.3, mat("crate2", 0x2b4d62));
  const owned = Object.keys(state.furniture);
  owned.forEach((id, i) => {
    const x = -7.5 + i * 5;
    const pedestal = addBox(x, 0.22, 0.4, 1.4, 0.44, 1.4, mat(`ped${id}`, [0x62d49f, 0x78a7ff, 0xf0c66e, 0xec6f67][i % 4]));
    pedestal.userData.spin = true;
    const icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), mat(`icon${id}`, 0xffffff, { emissive: [0x1f6f50, 0x1d3a77, 0x665020, 0x772921][i % 4], emissiveIntensity: 0.5 }));
    icon.position.set(x, 1.05, 0.4);
    icon.castShadow = true;
    icon.userData.spin = true;
    scene.add(icon);
  });
  camera.position.set(0, 9, 14);
  camera.lookAt(0, 0.4, 0);
  hideModal();
  updateUi();
}

function generateHeist() {
  state.heistNumber += 1;
  clearScene();
  addLights();
  addFloor();
  const walls = buildWalls();
  const itemSpots = [
    { x: -18.4, z: -11.4 }, { x: -9.7, z: -11.2 }, { x: 1.4, z: -10.4 }, { x: 12.8, z: -11.2 },
    { x: 19.2, z: -8.2 }, { x: -18.4, z: 1.0 }, { x: -9.6, z: 1.1 }, { x: 1.2, z: 1.2 },
    { x: 12.7, z: 1.0 }, { x: 19.2, z: 8.8 }, { x: -8.6, z: 12.0 }, { x: 8.2, z: 12.2 }
  ];
  const itemIntel = state.furniture.map ? 1.1 : 1;
  const items = itemSpots.map((spot, index) => {
    const type = lootTypes[Math.min(lootTypes.length - 1, Math.floor(Math.random() ** 1.25 * lootTypes.length))];
    const item = {
      ...type,
      id: `loot-${index}`,
      x: spot.x + rand(-0.35, 0.35),
      z: spot.z + rand(-0.35, 0.35),
      r: 0.55,
      value: Math.round(type.base * rand(0.72, 1.38) * itemIntel / 10) * 10,
      stolen: false,
      swapped: false
    };
    item.mesh = buildLootMesh(item);
    scene.add(item.mesh);
    return item;
  });

  const guardRoutes = [
    [{ x: -18, z: -12 }, { x: -10, z: -12 }, { x: -10, z: 1 }, { x: -18, z: 1 }],
    [{ x: 0, z: -12 }, { x: 12, z: -12 }, { x: 12, z: 1 }, { x: 0, z: 1 }],
    [{ x: 19, z: -10 }, { x: 19, z: 1 }, { x: 19, z: 10 }, { x: 12, z: 10 }],
    [{ x: -16, z: 12 }, { x: -5, z: 12 }, { x: 6, z: 12 }, { x: 16, z: 12 }]
  ];
  const extra = Math.floor(clamp(state.heat / 35, 0, 2));
  const guards = guardRoutes.slice(0, 3 + extra).map((route, index) => {
    const guard = {
      id: index,
      x: route[0].x,
      z: route[0].z,
      r: 0.45,
      route,
      routeIndex: 1,
      path: [],
      state: "patrol",
      focus: null,
      dir: 0,
      speed: 2.25 + state.heat * 0.006,
      suspicion: 0,
      radio: 0,
      chaseMemory: 0,
      stuck: 0,
      lastX: route[0].x,
      lastZ: route[0].z,
      mesh: buildGuardMesh(),
      cone: buildVisionCone()
    };
    guard.mesh.position.set(guard.x, 0, guard.z);
    guard.cone.position.set(guard.x, 0, guard.z);
    scene.add(guard.cone, guard.mesh);
    return guard;
  });

  const exitRing = new THREE.Mesh(
    new THREE.TorusGeometry(world.exit.r, 0.08, 8, 48),
    mat("exit", colors.exit, { emissive: colors.exit, emissiveIntensity: 0.45 })
  );
  exitRing.position.set(world.exit.x, 0.08, world.exit.z);
  exitRing.rotation.x = Math.PI / 2;
  scene.add(exitRing);

  const playerMesh = buildPlayerMesh();
  scene.add(playerMesh);
  const startHeat = clamp(state.heat - (state.furniture.radio ? 10 : 0), 0, 100);
  run = {
    walls,
    items,
    guards,
    noises: [],
    inventory: [],
    bagValue: 0,
    bagCap: 2500 + state.tools.bag * 1250,
    noise: 0,
    sight: 0,
    heat: startHeat,
    alarm: 0,
    player: { x: world.exit.x, z: world.exit.z, r: 0.42, speed: 3.8, facing: Math.PI, mesh: playerMesh },
    action: null,
    actionTime: 0,
    actionMax: 0
  };
  playerMesh.position.set(run.player.x, 0, run.player.z);
  state.mode = "heist";
  hideModal();
  updateUi();
  showToast("The crew drops you at the service exit.");
}

function createNoise(x, z, power, label) {
  if (!run) return;
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.42, 36),
    new THREE.MeshBasicMaterial({ color: colors.sound, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
  );
  pulse.rotation.x = Math.PI / 2;
  pulse.position.set(x, 0.08, z);
  scene.add(pulse);
  run.noises.push({ x, z, power, label, age: 0, life: 1.6, mesh: pulse });
  run.noise = clamp(Math.max(run.noise, power), 0, 100);
  for (const guard of run.guards) {
    if (guard.state === "chase") continue;
    const d = Math.hypot(guard.x - x, guard.z - z);
    const range = 5 + power * 0.13;
    if (d < range) {
      guard.state = "investigate";
      guard.focus = { x, z };
      guard.path = pathBetween(guard, guard.focus);
      guard.suspicion = clamp(guard.suspicion + power * (1 - d / range) * 0.38, 0, 95);
    }
  }
}

function nearestItem(maxDist = 1.45) {
  let best = null;
  for (const item of run.items) {
    if (item.stolen) continue;
    const d = dist2(run.player, item);
    if (d < maxDist && (!best || d < best.d)) best = { item, d };
  }
  return best?.item || null;
}

function playerAtExit() {
  return dist2(run.player, world.exit) < world.exit.r + run.player.r;
}

function startAction(kind, item, seconds) {
  run.action = { kind, item };
  run.actionTime = 0;
  run.actionMax = seconds;
}

function finishAction() {
  const { kind, item } = run.action;
  run.action = null;
  if (run.bagValue + item.value > run.bagCap) {
    showToast("The bag cannot hold that score yet.");
    return;
  }
  item.stolen = true;
  item.swapped = kind === "swap";
  item.mesh.visible = kind === "swap";
  if (kind === "swap") {
    state.tools.duplicate -= 1;
    item.mesh.scale.setScalar(0.82);
  }
  if (item.locked && state.tools.lockpick > 0) state.tools.lockpick -= 1;
  if (item.alarm && state.tools.diffuser > 0) state.tools.diffuser -= 1;
  run.inventory.push(item);
  run.bagValue += item.value;
  createNoise(item.x, item.z, kind === "swap" ? 14 + item.risk * 3 : 34 + item.risk * 10, kind);
  run.heat = clamp(run.heat + (kind === "swap" ? item.risk : item.risk * 3.2), 0, 100);
  showToast(`${kind === "swap" ? "Swapped" : "Stole"} ${item.name} for ${money(item.value)}.`);
  updateUi();
}

function tryInteract() {
  if (state.mode !== "heist" || !run || run.action) return;
  const item = nearestItem();
  if (item) {
    if (item.locked && state.tools.lockpick <= 0) {
      showToast("Locked display. Bring a lockpick.");
      return;
    }
    if (item.alarm && state.tools.diffuser <= 0) {
      run.alarm = Math.max(run.alarm, 8);
      run.heat = clamp(run.heat + 26, 0, 100);
      showToast("Alarm tripped. Move.");
    }
    const swap = state.tools.duplicate > 0 && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
    startAction(swap ? "swap" : "steal", item, swap ? 2.15 + item.risk * 0.35 : 0.65 + item.weight * 0.2);
    return;
  }
  if (playerAtExit()) escapeHeist();
}

function useNoisemaker() {
  if (state.mode !== "heist" || !run || state.tools.noisemaker <= 0) return;
  state.tools.noisemaker -= 1;
  const x = run.player.x + Math.sin(run.player.facing) * 5;
  const z = run.player.z + Math.cos(run.player.facing) * 5;
  createNoise(clamp(x, -world.halfW + 1, world.halfW - 1), clamp(z, -world.halfD + 1, world.halfD - 1), 75, "noisemaker");
  showToast("Noisemaker tossed.");
  updateUi();
}

function useDiffuser() {
  if (!run || run.alarm <= 0 || state.tools.diffuser <= 0) return;
  state.tools.diffuser -= 1;
  run.alarm = 0;
  run.heat = clamp(run.heat - 10, 0, 100);
  showToast("Alarm diffuser burned.");
  updateUi();
}

function escapeHeist() {
  const sold = run.bagValue;
  const count = run.inventory.length;
  state.cash += sold;
  state.heat = clamp(run.heat * 0.42, 0, 100);
  buildBaseScene();
  showModal("Clean Exit", `${count} item${count === 1 ? "" : "s"} fenced for ${money(sold)}. Heat cools to ${Math.round(state.heat)}.`, "Back to Base");
}

function caught() {
  const penalty = Math.round((run?.bagValue || 0) * 0.3);
  state.cash = Math.max(0, state.cash - penalty);
  state.heat = clamp((run?.heat || state.heat) + 28, 0, 100);
  buildBaseScene();
  showModal("Caught", `The guards radioed you in. The haul is gone and cleanup costs ${money(penalty)}.`, "Regroup");
}

function updatePlayer(dt) {
  const p = run.player;
  let dx = 0;
  let dz = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) dz -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) dz += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) dx -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) dx += 1;
  const moving = dx || dz;
  if (moving && !run.action) {
    const len = Math.hypot(dx, dz);
    dx /= len;
    dz /= len;
    p.facing = Math.atan2(dx, dz);
    const sneaking = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const rushing = keys.has("Space");
    const speed = p.speed * (sneaking ? 0.48 : 1) * (rushing ? 1.35 : 1);
    moveEntity(p, dx * speed * dt, dz * speed * dt);
    const noise = sneaking ? 8 : rushing ? 52 : 24;
    run.noise = clamp(run.noise + noise * dt * 0.85, 0, 100);
    if (rushing && Math.random() < dt * 1.8) createNoise(p.x, p.z, 38, "running");
  }
  p.mesh.position.set(p.x, 0, p.z);
  p.mesh.rotation.y = p.facing;
  if (pressed.has("KeyE")) tryInteract();
  if (pressed.has("KeyQ")) useNoisemaker();
  if (pressed.has("KeyZ")) useDiffuser();
  if (pressed.has("KeyF")) {
    const item = nearestItem();
    if (item?.locked && state.tools.lockpick > 0) showToast("Lockpick ready. Take the item to spend it.");
  }
  pressed.clear();
}

function guardCanSeePlayer(guard) {
  const d = dist2(guard, run.player);
  if (d > 10.5) return { sees: false, score: 0 };
  const toPlayer = Math.atan2(run.player.x - guard.x, run.player.z - guard.z);
  const delta = Math.atan2(Math.sin(toPlayer - guard.dir), Math.cos(toPlayer - guard.dir));
  const inCone = Math.abs(delta) < 0.68;
  const nearVision = d < 2.4;
  if (!(inCone || nearVision) || !hasLineOfSight(guard, run.player)) return { sees: false, score: 0 };
  const score = d < 2.6 ? 100 : d < 5.5 ? 72 : 42;
  return { sees: true, score };
}

function guardTarget(guard) {
  if (guard.state === "chase") return { x: run.player.x, z: run.player.z };
  if (guard.state === "investigate" && guard.focus) return guard.focus;
  return guard.route[guard.routeIndex];
}

function moveGuardToward(guard, target, dt) {
  if (!target) return;
  if ((guard.state === "chase" || guard.state === "investigate") && !hasLineOfSight(guard, target)) {
    if (!guard.path.length || dist2(guard.path[guard.path.length - 1], target) > 1.2) guard.path = pathBetween(guard, target);
    if (guard.path.length && dist2(guard, guard.path[0]) < 0.6) guard.path.shift();
    target = guard.path[0] || target;
  } else if (guard.state !== "patrol") {
    guard.path = [];
  }

  const angle = Math.atan2(target.x - guard.x, target.z - guard.z);
  guard.dir = angle;
  const speed = guard.speed * (guard.state === "chase" ? 1.34 : guard.state === "investigate" ? 1.06 : 1);
  const moved = moveEntity(guard, Math.sin(angle) * speed * dt, Math.cos(angle) * speed * dt);
  if (moved < 0.015 && dist2(guard, target) > 0.8) {
    guard.stuck += dt;
    if (guard.stuck > 0.55) {
      guard.path = pathBetween(guard, guard.state === "chase" ? run.player : target);
      guard.stuck = 0;
    }
  } else {
    guard.stuck = 0;
  }

  if (guard.state === "patrol" && dist2(guard, target) < 0.55) guard.routeIndex = (guard.routeIndex + 1) % guard.route.length;
  if (guard.state === "investigate" && dist2(guard, target) < 0.65) {
    guard.state = "patrol";
    guard.focus = null;
    guard.path = [];
  }
}

function radioBackup(guard) {
  if (guard.radio > 0 || run.guards.length >= 6) return;
  guard.radio = 4.8;
  run.heat = clamp(run.heat + 11, 0, 100);
  showToast("A guard radios in a sighting.");
}

function spawnBackup() {
  const route = [{ x: -20, z: 13 }, { x: -14, z: 12 }, { x: -5, z: 12 }, { x: 7, z: 12 }, { x: 17, z: 8 }];
  const guard = {
    id: run.guards.length,
    x: route[0].x,
    z: route[0].z,
    r: 0.45,
    route,
    routeIndex: 1,
    path: [],
    state: "investigate",
    focus: { x: run.player.x, z: run.player.z },
    dir: 0,
    speed: 2.45,
    suspicion: 28,
    radio: 0,
    chaseMemory: 5,
    stuck: 0,
    mesh: buildGuardMesh(),
    cone: buildVisionCone()
  };
  guard.mesh.position.set(guard.x, 0, guard.z);
  guard.cone.position.set(guard.x, 0, guard.z);
  scene.add(guard.cone, guard.mesh);
  run.guards.push(guard);
  showToast("Backup enters through the service wing.");
}

function updateGuards(dt) {
  let strongestSight = 0;
  for (const guard of [...run.guards]) {
    const vision = guardCanSeePlayer(guard);
    if (vision.sees) {
      strongestSight = Math.max(strongestSight, vision.score);
      guard.suspicion = clamp(guard.suspicion + vision.score * dt * 0.82, 0, 130);
      guard.focus = { x: run.player.x, z: run.player.z };
      guard.chaseMemory = 5.5;
      if (guard.suspicion > 42) radioBackup(guard);
      if (guard.suspicion > 68) guard.state = "chase";
    } else {
      guard.chaseMemory -= dt;
      guard.suspicion = clamp(guard.suspicion - (guard.state === "chase" ? 3 : 9) * dt, 0, 130);
      if (guard.state === "chase" && guard.chaseMemory <= 0) {
        guard.state = "investigate";
        guard.focus = { ...guard.focus };
      }
    }

    if (guard.radio > 0) {
      guard.radio -= dt;
      if (guard.radio <= 0) spawnBackup();
    }

    const target = guardTarget(guard);
    moveGuardToward(guard, target, dt);
    guard.mesh.position.set(guard.x, 0, guard.z);
    guard.mesh.rotation.y = guard.dir;
    guard.cone.position.set(guard.x, 0.01, guard.z);
    guard.cone.rotation.y = guard.dir;
    const body = guard.mesh.children[0];
    body.material = mat(guard.state === "patrol" ? "guard" : "alertGuard", guard.state === "patrol" ? colors.guard : colors.alerted);

    if (dist2(guard, run.player) < 0.7 || guard.suspicion >= 110) {
      caught();
      return;
    }
  }
  run.sight = clamp(run.sight + (strongestSight - run.sight) * dt * 4, 0, 100);
}

function updateRun(dt) {
  if (!run) return;
  updatePlayer(dt);
  if (!run) return;

  if (run.action) {
    run.actionTime += dt;
    run.noise = clamp(run.noise + run.action.item.risk * dt * 5, 0, 100);
    run.player.mesh.scale.set(1, 1 - Math.sin(run.actionTime * 12) * 0.04, 1);
    if (run.actionTime >= run.actionMax) finishAction();
  } else {
    run.player.mesh.scale.lerp(scratch.set(1, 1, 1), 0.2);
  }
  if (!run) return;

  for (const item of run.items) {
    if (!item.stolen) {
      item.mesh.rotation.y += dt * (0.35 + item.risk * 0.08);
      item.mesh.position.y = Math.sin(performance.now() * 0.002 + item.risk) * 0.035;
    } else if (!item.swapped) {
      for (const guard of run.guards) {
        if (dist2(guard, item) < 1.2 && Math.random() < dt * item.risk * 0.35) {
          run.heat = clamp(run.heat + item.risk * 4, 0, 100);
          guard.state = "investigate";
          guard.focus = { x: item.x, z: item.z };
          guard.path = pathBetween(guard, guard.focus);
        }
      }
    }
  }

  if (run.alarm > 0) {
    run.alarm -= dt;
    run.heat = clamp(run.heat + dt * 8, 0, 100);
    if (Math.random() < dt * 2.8) createNoise(run.player.x + rand(-2, 2), run.player.z + rand(-2, 2), 62, "alarm");
  }

  run.noises = run.noises.filter((noise) => {
    noise.age += dt;
    const progress = noise.age / noise.life;
    noise.mesh.scale.setScalar(1 + progress * noise.power * 0.06);
    noise.mesh.material.opacity = Math.max(0, 0.72 * (1 - progress));
    if (noise.age >= noise.life) {
      scene.remove(noise.mesh);
      return false;
    }
    return true;
  });
  run.noise = clamp(run.noise - dt * 24, 0, 100);
  run.heat = clamp(run.heat + dt * 0.18, 0, 100);
  updateGuards(dt);
  if (run) updateUi();
}

function updateCamera(dt) {
  if (run && state.mode === "heist") {
    const p = run.player;
    const desired = scratch.set(p.x + 4.8, 11.8, p.z - 9.4);
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    camera.lookAt(p.x, 0.55, p.z + 1.4);
  } else {
    scene.children.forEach((child) => {
      if (child.userData.spin) {
        child.rotation.y += dt * 1.2;
        child.position.y += Math.sin(performance.now() * 0.003 + child.position.x) * 0.0008;
      }
    });
  }
}

function updatePrompt() {
  if (state.mode !== "heist" || !run) {
    setPrompt("");
    return;
  }
  if (run.action) {
    const pct = Math.round((run.actionTime / run.actionMax) * 100);
    setPrompt(`${run.action.kind === "swap" ? "Swapping duplicate" : "Lifting item"}... ${pct}%`);
    return;
  }
  const item = nearestItem();
  if (item) {
    const bits = [`E take ${item.name}`, money(item.value)];
    if (item.locked) bits.push("lockpick");
    if (item.alarm) bits.push("alarm");
    if (state.tools.duplicate > 0) bits.push("hold Shift+E to swap");
    setPrompt(bits.join(" | "));
    return;
  }
  if (playerAtExit()) {
    setPrompt(run.bagValue > 0 ? "E exit and fence the bag" : "E leave empty-handed");
    return;
  }
  setPrompt("");
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

function loop() {
  const dt = Math.min(0.033, clock.getDelta());
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) ui.toast.classList.remove("show");
  }
  updateRun(dt);
  updatePrompt();
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  if (!keys.has(event.code)) pressed.add(event.code);
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));

ui.startHeistBtn.addEventListener("click", generateHeist);
ui.payDebtBtn.addEventListener("click", payDebt);
ui.modalBtn.addEventListener("click", () => {
  hideModal();
  updateUi();
});

window.debugHeist = () => ({
  mode: state.mode,
  cash: state.cash,
  debt: state.debt,
  run: run && {
    guards: run.guards.map((guard) => ({ state: guard.state, x: guard.x, z: guard.z, suspicion: Math.round(guard.suspicion) })),
    items: run.items.length,
    bagValue: run.bagValue,
    player: { x: run.player.x, z: run.player.z },
    heat: Math.round(run.heat),
    sight: Math.round(run.sight)
  }
});

resize();
buildBaseScene();
requestAnimationFrame(loop);
