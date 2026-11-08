'use strict';
/**
 * Avatar decorations (frames) for Crocodile King. Dependency-light: the
 * wardrobe helpers are pure record functions (unit-tested); the PNG
 * compositing uses jimp (pure JS, no native builds) and is loaded lazily
 * so the rest of the bot never depends on image code to boot.
 *
 * HONEST MECHANICS (also stated in README + legal): Discord does not let
 * any bot grant Discord's own avatar decorations or change a member's
 * Discord profile. So a frame here means two real things:
 *   1. the frame sits in the member's in-bot WARDROBE (record.frames) and
 *      decorates their /profile card in the bot once equipped, and
 *   2. /avatarframe apply composites the member's CURRENT Discord avatar
 *      into the frame ring and hands them the finished PNG file, which
 *      THEY upload as their own Discord avatar if they want it live.
 * Buying charges Swamp Bucks once; applying is free, forever, repeatable.
 */
const path = require('path');

const FRAMES_DIR = path.join(__dirname, '..', 'assets', 'frames');

/* hole = the avatar circle diameter as a fraction of the 1024 output.
 * Tuned per frame from the artwork: avatar sits UNDER the ring, must cover
 * the frame's dark centre opening with a little overlap to spare. */
const FRAMES = [
  { id: 'cypress-vine', name: 'Cypress Vine Frame', file: 'cypress-vine.png', price: 200, hole: 0.55, blurb: 'Twisted cypress vines and hanging moss, dripping swamp green.' },
  { id: 'glowshroom-ring', name: 'Glowshroom Ring', file: 'glowshroom-ring.png', price: 250, hole: 0.55, blurb: 'A ring of glowing glowshrooms and fireflies.' },
  { id: 'gator-tooth-ring', name: 'Gator Tooth Ring', file: 'gator-tooth-ring.png', price: 300, hole: 0.60, blurb: 'The King\'s own teeth, in a circle. He has spares.' },
  { id: 'crown-frame', name: 'Crocodile King Crown Frame', file: 'crown-frame.png', price: 750, hole: 0.62, blurb: 'A golden crown over gator scales. Royal by association.' },
  { id: 'murk-royalty', name: 'Murk Royalty Frame', file: 'murk-royalty.png', price: 1500, hole: 0.56, blurb: 'Gold, emeralds and swamp pearls. The most ornate ring in the murk.' },
];

function frameById(id) { return FRAMES.find(f => f.id === id) || null; }
function framePath(id) {
  const f = frameById(id);
  return f ? path.join(FRAMES_DIR, f.file) : null;
}

/* ---------------- wardrobe on a user record ---------------- */
function ensureWardrobe(rec) {
  if (!Array.isArray(rec.frames)) rec.frames = [];
  if (rec.equippedFrame === undefined) rec.equippedFrame = null;
  return rec;
}
function ownsFrame(rec, frameId) {
  ensureWardrobe(rec);
  return rec.frames.includes(frameId);
}
/** Add a frame to the wardrobe. Returns false (no change) if already owned. */
function grantFrame(rec, frameId) {
  if (!frameById(frameId)) return false;
  ensureWardrobe(rec);
  if (rec.frames.includes(frameId)) return false;
  rec.frames.push(frameId);
  return true;
}
function equipFrame(rec, frameId) {
  if (!ownsFrame(rec, frameId)) return false;
  rec.equippedFrame = frameId;
  return true;
}
function equippedFrame(rec) {
  ensureWardrobe(rec);
  return rec.equippedFrame ? frameById(rec.equippedFrame) : null;
}

/* ---------------- compositing (jimp, lazy) ---------------- */
/**
 * Composite an avatar image buffer into a frame ring.
 * Output: 1024x1024 PNG buffer. The frame's centre is cut to a circle just
 * smaller than the avatar circle, so no gap can show; the avatar itself is
 * circle-cropped; frame art outside the ring is kept as generated (dark).
 * @param {Buffer} avatarBuffer PNG/JPEG bytes of the member's avatar
 * @param {string} frameId one of FRAMES
 * @returns {Promise<Buffer>} PNG bytes
 */
async function compositeFramedAvatar(avatarBuffer, frameId) {
  const def = frameById(frameId);
  if (!def) throw new Error(`unknown frame: ${frameId}`);
  let Jimp;
  try { Jimp = require('jimp'); } catch (e) { throw new Error('image engine (jimp) is not installed'); }

  const SIZE = 1024;
  const avatarD = Math.round(SIZE * def.hole);
  const centre = SIZE / 2;
  const avatarR = avatarD / 2;
  const cutR = avatarR - 6; // frame hole cut slightly smaller than the avatar: guaranteed overlap

  const frame = await Jimp.read(framePath(frameId));
  frame.resize(SIZE, SIZE);
  // Cut the frame's centre out in a circle (the generated centre is plain
  // dark art, not transparent - without this it would cover the avatar).
  frame.scan(0, 0, SIZE, SIZE, function (x, y, idx) {
    const dx = x - centre + 0.5, dy = y - centre + 0.5;
    if (dx * dx + dy * dy < cutR * cutR) this.bitmap.data[idx + 3] = 0;
  });

  const avatar = await Jimp.read(avatarBuffer);
  avatar.resize(avatarD, avatarD);
  avatar.scan(0, 0, avatarD, avatarD, function (x, y, idx) {
    const dx = x - avatarR + 0.5, dy = y - avatarR + 0.5;
    if (dx * dx + dy * dy > avatarR * avatarR) this.bitmap.data[idx + 3] = 0;
  });

  const out = new Jimp(SIZE, SIZE, 0x00000000);
  const off = Math.round((SIZE - avatarD) / 2);
  out.composite(avatar, off, off);
  out.composite(frame, 0, 0);
  return out.getBufferAsync(Jimp.MIME_PNG);
}

module.exports = {
  FRAMES, FRAMES_DIR,
  frameById, framePath,
  ensureWardrobe, ownsFrame, grantFrame, equipFrame, equippedFrame,
  compositeFramedAvatar,
};
