'use strict';
/**
 * Profile card backgrounds for Crocodile King (decorations, permanent like
 * frames). Pure record helpers, unit-tested; the artwork lives in
 * assets/backgrounds/ (downscaled copies of the server's banner art).
 *
 * How they show: the equipped background is attached to the member's
 * /profile reply as the embed image, next to their equipped avatar frame
 * field. Equipping is deliberately simple (per the build spec): buying a
 * background auto-equips it - the newest owned background is the one worn.
 * Buying never un-equips a frame; frame and background show together.
 */
const path = require('path');

const BACKGROUNDS_DIR = path.join(__dirname, '..', 'assets', 'backgrounds');

const BACKGROUNDS = [
  { id: 'neon-bayou', name: 'Neon Bayou', file: 'neon-bayou.png', price: 350, blurb: 'The whole neon swamp panorama, spread behind your name.' },
  { id: 'murk-hollow', name: 'Murk Hollow', file: 'murk-hollow.png', price: 350, blurb: 'The King at the swamp gate, welcoming and warning in equal measure.' },
  { id: 'kings-throne-room', name: "King's Throne Room", file: 'kings-throne-room.png', price: 500, blurb: 'The throne itself, glowshroom court in attendance. Sit tall.' },
];

function backgroundById(id) { return BACKGROUNDS.find(b => b.id === id) || null; }
function backgroundPath(id) {
  const b = backgroundById(id);
  return b ? path.join(BACKGROUNDS_DIR, b.file) : null;
}

/* ---------------- ownership on a user record ---------------- */
function ensureBackgrounds(rec) {
  if (!Array.isArray(rec.backgrounds)) rec.backgrounds = [];
  if (rec.equippedBackground === undefined) rec.equippedBackground = null;
  return rec;
}
function ownsBackground(rec, bgId) {
  ensureBackgrounds(rec);
  return rec.backgrounds.includes(bgId);
}
/** Grant a background and auto-equip it (newest owned is worn). False if already owned. */
function grantBackground(rec, bgId) {
  if (!backgroundById(bgId)) return false;
  ensureBackgrounds(rec);
  if (rec.backgrounds.includes(bgId)) return false;
  rec.backgrounds.push(bgId);
  rec.equippedBackground = bgId;
  return true;
}
function equippedBackground(rec) {
  ensureBackgrounds(rec);
  return rec.equippedBackground ? backgroundById(rec.equippedBackground) : null;
}

module.exports = {
  BACKGROUNDS, BACKGROUNDS_DIR,
  backgroundById, backgroundPath,
  ensureBackgrounds, ownsBackground, grantBackground, equippedBackground,
};
