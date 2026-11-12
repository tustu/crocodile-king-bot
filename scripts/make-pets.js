'use strict';
/**
 * Build-time pixel art for the profile system - run once, commit the PNGs:
 *   node scripts/make-pets.js
 * Renders, with @napi-rs/canvas (no smoothing, crisp pixels):
 *   assets/pets/<species>_<mood>.png   3 species x 4 moods, 64x64 grid
 *   assets/habitat/<theme>-<time>.png  3 themes x 4 times of day, 800x80
 * No downloaded art, no network. Re-run any time the maps change.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const PETS_DIR = path.join(ROOT, 'assets', 'pets');
const HABITAT_DIR = path.join(ROOT, 'assets', 'habitat');

/* ---------- palette ---------- */
const PALETTE = {
  k: '#14231a', // outline dark
  g: '#43a047', // gator green
  G: '#2e7d32', // dark green
  l: '#a5d6a7', // light green / belly
  w: '#ffffff', // white
  e: '#111111', // eye black
  y: '#ffee58', // glow yellow
  Y: '#fdd835', // deep yellow
  o: '#ff9800', // orange
  b: '#5d4037', // brown
  c: '#9be7f0', // wing cyan
  p: '#f48fb1', // pink blush
  z: '#b3e5fc', // sleep blue
};

/* ---------- pet pixel maps: 20x20 grids, one char per pixel ---------- */
const MAPS = {
  gator: [
    '....................',
    '....................',
    '....kk......kk......',
    '...kggk....kggk.....',
    '...kwwk....kwwk.....',
    '...kwek....kwek.....',
    '...kwwk....kwwk.....',
    '....kk......kk......',
    '..gggggggggggggg....',
    '.gggggggggggggggg...',
    '.gggggggggggggggg...',
    '.gggllllllllllggg...',
    '.ggglkkllllkklggg...',
    '.gggllllllllllggg...',
    '..gggggggggggggg....',
    '...gggggggggggg.....',
    '....kk......kk......',
    '....................',
    '....................',
    '....................',
  ],
  frog: [
    '....................',
    '....................',
    '....kkkk....kkkk....',
    '...kwwwwk..kwwwwk...',
    '...kwekwk..kwekwk...',
    '...kwwwwk..kwwwwk...',
    '....kkkk....kkkk....',
    '..gggggggggggggg....',
    '.gggggggggggggggg...',
    '.gggggggggggggggg...',
    '.gggggggggggggggg...',
    '.gggppggggggppggg...',
    '..gggkkkkkkkkggg....',
    '..gggggggggggggg....',
    '...gggggggggggg.....',
    '....kk......kk......',
    '....................',
    '....................',
    '....................',
    '....................',
  ],
  firefly: [
    '....................',
    '......k......k......',
    '.......k....k.......',
    '....cccccccccc......',
    '..cccccccccccccc....',
    '..cckkkkkkkkkkcc....',
    '.cckkkkkkkkkkkkcc...',
    '.ckkwwkkkkkkwwkkc...',
    '.ckkwekkkkkkewkkc...',
    '.cckkkkkkkkkkkkcc...',
    '..cckkkkkkkkkkcc....',
    '...ccyyyyyyyycc.....',
    '....cyyyyyyyyc......',
    '.....cyyyyyyc.......',
    '......cccccc........',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
  ],
};

/* Eye rows for the sunglasses bar, mouth row for the eating morsel. */
const FEATURES = {
  gator: { shadesRows: [4, 5], mouthRow: 12 },
  frog: { shadesRows: [3, 4], mouthRow: 12 },
  firefly: { shadesRows: [7, 8], mouthRow: 9 },
};

const CELL = 3; // 20x20 grid -> 60x60, centred in the 64x64 canvas
const OFFSET = 2;

function drawMap(ctx, map) {
  for (let y = 0; y < map.length; y++) {
    const row = map[y];
    if (row.length !== 20) throw new Error(`pet map row ${y} is ${row.length} wide, must be 20`);
    for (let x = 0; x < 20; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      ctx.fillStyle = PALETTE[ch] || '#ff00ff';
      ctx.fillRect(OFFSET + x * CELL, OFFSET + y * CELL, CELL, CELL);
    }
  }
}

function px(ctx, gx, gy, color, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(OFFSET + gx * CELL, OFFSET + gy * CELL, w * CELL, h * CELL);
}

function drawZzz(ctx) {
  // Three Z letters climbing up-right, light sleep blue.
  const z = (gx, gy, s) => {
    px(ctx, gx, gy, PALETTE.z, s, 1);
    px(ctx, gx + s - 1, gy + 1, PALETTE.z, 1, 1);
    px(ctx, gx, gy + 2, PALETTE.z, s, 1);
  };
  z(13, 5, 2);
  z(15, 2, 3);
  z(16, 0, 2);
}

function drawShades(ctx, species) {
  const { shadesRows } = FEATURES[species];
  for (const r of shadesRows) px(ctx, 2, r, '#0d0d0d', 16, 1);
  px(ctx, 3, shadesRows[0], '#ffffff', 1, 1); // shine
  px(ctx, 13, shadesRows[0], '#ffffff', 1, 1);
}

function drawEating(ctx, species) {
  const { mouthRow } = FEATURES[species];
  px(ctx, 15, mouthRow - 2, '#3e2723', 2, 2); // morsel
  px(ctx, 14, mouthRow - 3, '#ffffff', 1, 1); // wing glint
  px(ctx, 17, mouthRow - 1, '#3e2723', 1, 1); // crumb
  px(ctx, 13, mouthRow, '#3e2723', 1, 1);
}

async function renderPet(species, mood) {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawMap(ctx, MAPS[species]);
  if (mood === 'sleeping') drawZzz(ctx);
  else if (mood === 'streak') drawShades(ctx, species);
  else if (mood === 'eating') drawEating(ctx, species);
  const buf = await canvas.encode('png');
  fs.writeFileSync(path.join(PETS_DIR, `${species}_${mood}.png`), buf);
}

/* ---------- habitat strips: 800x80 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKIES = {
  dawn: { top: '#2b3a67', mid: '#e58e6d', low: '#ffd9a0', sun: '#fff3c4', sunY: 34, stars: false, fireflies: 4 },
  day: { top: '#7ec8e3', mid: '#a8e6cf', low: '#dcedc8', sun: '#fffde7', sunY: 14, stars: false, fireflies: 0 },
  dusk: { top: '#3b2d5e', mid: '#c65d7b', low: '#f6a97c', sun: '#ffcc80', sunY: 40, stars: true, fireflies: 8 },
  night: { top: '#0b1026', mid: '#16213e', low: '#1f2a44', sun: '#e8eaf6', sunY: 14, stars: true, fireflies: 16 },
};
const WATER = { dawn: '#4a3a5e', day: '#2e7d6b', dusk: '#4a2d52', night: '#0d1b2a' };
const SILHOUETTE = { dawn: '#241f2e', day: '#1b5e20', dusk: '#241f2e', night: '#05070f' };

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}
function circle(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawHabitat(theme, time) {
  const W = 800, H = 80;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const sky = SKIES[time];
  const sil = SILHOUETTE[time];
  const rand = mulberry32(theme.length * 131 + time.length * 17 + 7);

  // Sky bands
  rect(ctx, 0, 0, W, 28, sky.top);
  rect(ctx, 0, 28, W, 18, sky.mid);
  rect(ctx, 0, 46, W, 10, sky.low);
  // Stars
  if (sky.stars) {
    for (let i = 0; i < 40; i++) {
      rect(ctx, Math.floor(rand() * W), Math.floor(rand() * 26), 2, 2, '#ffffff');
    }
  }
  // Sun / moon
  circle(ctx, 690, sky.sunY, time === 'night' ? 11 : 13, sky.sun);
  if (time === 'night') circle(ctx, 686, sky.sunY - 3, 9, sky.top); // crescent bite
  // Water
  rect(ctx, 0, 56, W, 24, WATER[time]);
  for (let i = 0; i < 24; i++) {
    rect(ctx, Math.floor(rand() * W), 58 + Math.floor(rand() * 20), 14 + Math.floor(rand() * 22), 2, sky.low);
  }
  // Theme silhouettes
  if (theme === 'bayou') {
    // One proud cypress, left; reeds right
    rect(ctx, 96, 22, 10, 36, sil);
    rect(ctx, 70, 10, 62, 16, sil);
    rect(ctx, 82, 2, 38, 10, sil);
    for (let i = 0; i < 9; i++) rect(ctx, 560 + i * 14, 34 + (i % 3) * 4, 4, 24, sil);
  } else if (theme === 'cypress-knees') {
    // Knobby knees poking out of the water
    for (let i = 0; i < 7; i++) {
      const x = 40 + i * 110 + Math.floor(rand() * 30);
      const h = 12 + Math.floor(rand() * 14);
      rect(ctx, x, 56 - h, 12, h + 4, sil);
      rect(ctx, x + 3, 56 - h - 4, 6, 4, sil);
    }
    rect(ctx, 640, 18, 8, 40, sil); // one leaning tree
    rect(ctx, 620, 8, 48, 12, sil);
  } else {
    // Haunted hollow: bare twisted tree + fog band
    rect(ctx, 120, 12, 9, 46, sil);
    rect(ctx, 129, 20, 34, 4, sil);
    rect(ctx, 96, 28, 26, 4, sil);
    rect(ctx, 129, 32, 22, 4, sil);
    rect(ctx, 420, 26, 7, 32, sil);
    rect(ctx, 420, 30, 28, 3, sil);
    ctx.globalAlpha = 0.35;
    rect(ctx, 0, 44, W, 14, sky.low);
    ctx.globalAlpha = 1;
  }
  // Fireflies
  for (let i = 0; i < sky.fireflies; i++) {
    const x = Math.floor(rand() * W), y = 30 + Math.floor(rand() * 24);
    rect(ctx, x, y, 3, 3, '#ffee58');
    rect(ctx, x + 1, y + 1, 1, 1, '#ffffff');
  }
  return canvas;
}

async function main() {
  fs.mkdirSync(PETS_DIR, { recursive: true });
  fs.mkdirSync(HABITAT_DIR, { recursive: true });
  const species = ['gator', 'firefly', 'frog'];
  const moods = ['happy', 'sleeping', 'streak', 'eating'];
  for (const s of species) for (const m of moods) await renderPet(s, m);
  console.log(`pets: ${species.length * moods.length} sprites written to assets/pets/`);
  const themes = ['bayou', 'cypress-knees', 'haunted-hollow'];
  const times = ['dawn', 'day', 'dusk', 'night'];
  for (const t of themes) {
    for (const tm of times) {
      const canvas = drawHabitat(t, tm);
      fs.writeFileSync(path.join(HABITAT_DIR, `${t}-${tm}.png`), await canvas.encode('png'));
    }
  }
  console.log(`habitat: ${themes.length * times.length} strips written to assets/habitat/`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { renderPet, drawHabitat };
