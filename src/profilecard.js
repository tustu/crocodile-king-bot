'use strict';
/**
 * The Crocodile King PROFILE SYSTEM - visual swamp profile cards.
 *
 * The card is a GENERATED IMAGE (800x400, @napi-rs/canvas), layered
 * bottom to top, no exceptions:
 *   (1) background banner (owned theme / custom URL / time-of-day gradient)
 *       + habitat strip along the bottom
 *   (2) user avatar (circular clip, top-left) + equipped frame ring
 *   (3) pet base sprite, bottom-right (64x64 grid, mood variant)
 *   (4) text & UI (username, level, bio, XP bar, stats, pet name + level,
 *       speech bubble, stamps, aura ring)
 * All layers load in parallel (Promise.all); export is canvas.encode('png')
 * as an AttachmentBuilder named profile.png. No pet cosmetics exist.
 *
 * The Discord reply pairs the image with a compact embed carrying the
 * showcase slots and the guestbook notes (text lives better there).
 * Pure logic (privacy, showcase, wall, timezone, rarity, moods) is
 * dependency-free and unit-tested; only renderProfileCard needs canvas.
 */
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const xpLib = require('./xp');
const lootLib = require('./loot');
const titlesLib = require('./titles');
const avatarLib = require('./avatarframe');
const backgroundsLib = require('./backgrounds');
const petsLib = require('./pets');
const { ladderTitleFor } = require('./config');

const CARD_W = 800;
const CARD_H = 400;
const BIO_MAX = 160;
const MOOD_MAX = 40;
const WALL_MAX = 20;
const WALL_NOTE_MAX = 200;
const SHOWCASE_MAX = 4;

/* ---------------- profile record ---------------- */
function blankProfile() {
  return {
    bio: '',
    favColor: null,        // '#RRGGBB' card accent, or null
    privacy: { rank: true, inventory: true, activity: true, balance: true },
    banner: null,          // owned background id, or null (equipped default)
    bannerUrl: null,       // custom banner image URL, or null
    style: 'trading',      // 'trading' | 'passport'
    timezone: 'America/Halifax',
    mood: null,            // mood id from MOODS, or null
    showcase: [],          // [{ kind, value }] max 4, pinned order
    pet: null,             // { species, name, xp, fedAt, adoptedAt }
    wall: [],              // [{ by, name, text, stamp, at }] newest first, max 20
    habitat: 'bayou',      // habitat strip theme
    layout: { preset: 'classic', petCorner: 'bottom-right', bioPos: 'top', badgesPos: 'top-right' },
    postedMessageId: null, // the permanent card post (Save & post), or null
    postedChannelId: null, // channel holding that post
  };
}

function ensureProfile(rec) {
  if (!rec.profile || typeof rec.profile !== 'object') rec.profile = blankProfile();
  // Fill missing keys IN PLACE - callers hold a reference to rec.profile
  // and must see later writes (never replace the object identity).
  const p = rec.profile;
  const d = blankProfile();
  for (const k of Object.keys(d)) if (p[k] === undefined) p[k] = d[k];
  p.privacy = Object.assign({ rank: true, inventory: true, activity: true, balance: true }, p.privacy || {});
  if (!Array.isArray(p.showcase)) p.showcase = [];
  if (!Array.isArray(p.wall)) p.wall = [];
  if (!['trading', 'passport'].includes(p.style)) p.style = 'trading';
  p.layout = Object.assign({ preset: 'classic', petCorner: 'bottom-right', bioPos: 'top', badgesPos: 'top-right' }, p.layout || {});
  if (!LAYOUT_PRESETS.some(pr => pr.id === p.layout.preset)) p.layout.preset = 'classic';
  if (!['bottom-right', 'bottom-left', 'top-right'].includes(p.layout.petCorner)) p.layout.petCorner = 'bottom-right';
  if (!['top', 'bottom'].includes(p.layout.bioPos)) p.layout.bioPos = 'top';
  if (!['top-right', 'bottom-left', 'hidden'].includes(p.layout.badgesPos)) p.layout.badgesPos = 'top-right';
  return p;
}

/* ---------------- card layout (interactive editor) ----------------
 * Discord has no mouse-drag on a card, so the layout editor is
 * buttons/selects on the owner's own card: three named presets plus
 * per-element slot picks. Every pick re-renders the card live and saves
 * to rec.profile.layout. Collision rules live in the renderer: a pet in
 * the top-right pushes badges to the bottom-left, and bottom-left badges
 * slide right when the pet sits bottom-left. */
const LAYOUT_PRESETS = [
  { id: 'classic', name: 'Classic', blurb: 'Pet bottom-right, bio under your name, badges top-right.', layout: { petCorner: 'bottom-right', bioPos: 'top', badgesPos: 'top-right' } },
  { id: 'pet-first', name: 'Pet First', blurb: 'Pet bottom-left in the spotlight, bio along the bottom, badges tucked away.', layout: { petCorner: 'bottom-left', bioPos: 'bottom', badgesPos: 'hidden' } },
  { id: 'badges-front', name: 'Badges Up Front', blurb: 'Your milestone badges ride the bottom of the card, pet bottom-right.', layout: { petCorner: 'bottom-right', bioPos: 'top', badgesPos: 'bottom-left' } },
];
function layoutPresetById(id) { return LAYOUT_PRESETS.find(pr => pr.id === id) || null; }
/** Apply a preset: sets all three slot picks at once. */
function applyLayoutPreset(profile, presetId) {
  const pr = layoutPresetById(presetId);
  if (!pr) return { ok: false, reason: 'That preset is not on the shelf.' };
  profile.layout = Object.assign({}, profile.layout, pr.layout, { preset: pr.id });
  return { ok: true, preset: pr };
}
const LAYOUT_FIELDS = {
  pet: { key: 'petCorner', values: ['bottom-right', 'bottom-left', 'top-right'] },
  bio: { key: 'bioPos', values: ['top', 'bottom'] },
  badges: { key: 'badgesPos', values: ['top-right', 'bottom-left', 'hidden'] },
};
/** Set one slot pick. A manual pick clears the preset name (it is custom now). */
function setLayoutField(profile, field, value) {
  const def = LAYOUT_FIELDS[field];
  if (!def) return { ok: false, reason: 'That is not a layout slot.' };
  if (!def.values.includes(value)) return { ok: false, reason: 'That is not a slot for this element.' };
  profile.layout[def.key] = value;
  profile.layout.preset = 'custom';
  return { ok: true };
}
function layoutPresetLabel(profile) {
  const pr = layoutPresetById(profile.layout && profile.layout.preset);
  return pr ? pr.name : 'Custom';
}

/* ---------------- privacy ----------------
 * The owner always sees everything. Anyone else sees only the fields
 * the owner left visible. Privacy applies to the PROFILE CARD only. */
function canView(rec, viewerId, field) {
  if (!rec || rec.userId === viewerId) return true;
  const p = ensureProfile(rec);
  return p.privacy[field] !== false;
}

/* ---------------- moods (/moodpick) ---------------- */
const MOODS = [
  { id: 'chill', name: 'Chill', color: 0x26a69a, css: '#26a69a', pet: 'happy', blurb: 'Drifting slow on still water.' },
  { id: 'hyped', name: 'Hyped', color: 0xff7043, css: '#ff7043', pet: 'streak', blurb: 'The swamp is LOUD today.' },
  { id: 'lurking', name: 'Lurking', color: 0x5c6bc0, css: '#5c6bc0', pet: 'happy', blurb: 'Watching from the reeds.' },
  { id: 'salty', name: 'Salty', color: 0x9ccc65, css: '#9ccc65', pet: 'streak', blurb: 'Seasoned by the murk.' },
  { id: 'royal', name: 'Royal', color: 0xffb300, css: '#ffb300', pet: 'streak', blurb: 'The throne notices you.' },
  { id: 'sleepy', name: 'Sleepy', color: 0x3949ab, css: '#3949ab', pet: 'sleeping', blurb: 'Half sunk in the mud, dreaming.' },
];
function moodById(id) { return MOODS.find(m => m.id === id) || null; }

const PRESENCE_COLORS = { online: 0x43b581, idle: 0xfaa61a, dnd: 0xf04747, offline: 0x747f8d };
/** The aura color: picked mood wins, else live presence, else swamp green. */
function auraColor(profile, presenceStatus) {
  const mood = moodById(profile && profile.mood);
  if (mood) return { color: mood.color, css: mood.css, label: mood.name, source: 'mood' };
  if (presenceStatus && PRESENCE_COLORS[presenceStatus]) {
    return { color: PRESENCE_COLORS[presenceStatus], css: '#' + PRESENCE_COLORS[presenceStatus].toString(16).padStart(6, '0'), label: presenceStatus, source: 'presence' };
  }
  return { color: 0x2e7d32, css: '#2e7d32', label: 'swamp', source: 'default' };
}

/** Pet mood resolution: a recent feeding wins; else the owner's picked
 *  mood maps to a sprite; else the derived state (offline/streak/happy). */
function resolvePetMood(pet, profile, ctx = {}) {
  const now = ctx.now || Date.now();
  if (pet && pet.fedAt && now - pet.fedAt < petsLib.EATING_WINDOW_MS) return 'eating';
  const mood = moodById(profile && profile.mood);
  if (mood) return mood.pet;
  return petsLib.petMood(pet, ctx);
}

/* ---------------- time of day ---------------- */
function timeOfDay(date = new Date(), timeZone = 'America/Halifax') {
  let hour = 12;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    hour = parseInt((parts.find(p => p.type === 'hour') || {}).value || '12', 10) % 24;
  } catch { /* invalid zone -> noon */ }
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}
const TIME_LABELS = { dawn: 'Dawn over the bayou', day: 'High sun on the water', dusk: 'Dusk in the reeds', night: 'Neon night in the murk' };
function validTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
function localTimeString(date = new Date(), timeZone = 'America/Halifax') {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
  } catch { return ''; }
}

/* ---------------- rarity (trading card border, by level) ---------------- */
const RARITIES = [
  { min: 50, name: 'Crocodile King', color: '#ef5350', int: 0xef5350 },
  { min: 35, name: 'Murk Royalty', color: '#ffb300', int: 0xffb300 },
  { min: 20, name: 'Cypress Guard', color: '#ab47bc', int: 0xab47bc },
  { min: 10, name: 'Gator Friend', color: '#42a5f5', int: 0x42a5f5 },
  { min: 5, name: 'Mud Runner', color: '#26a69a', int: 0x26a69a },
  { min: 1, name: 'Cypress Sprout', color: '#66bb6a', int: 0x66bb6a },
];
function rarityFor(level) {
  return RARITIES.find(r => level >= r.min) || RARITIES[RARITIES.length - 1];
}

/* ---------------- banner URL validation ---------------- */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;
const IMAGE_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net', 'i.imgur.com', 'images.unsplash.com'];
function validateBannerUrl(url) {
  if (!url || typeof url !== 'string') return { ok: false, reason: 'Give me a link to a picture.' };
  let parsed;
  try { parsed = new URL(url.trim()); } catch { return { ok: false, reason: 'That is not a link I can open.' }; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, reason: 'The banner link must start with http(s).' };
  if (IMAGE_EXT.test(parsed.pathname) || IMAGE_HOSTS.includes(parsed.hostname)) return { ok: true, url: parsed.toString() };
  return { ok: false, reason: 'That link does not look like a picture - it needs to end in .png, .jpg, .gif or .webp (or come from Discord/Imgur).' };
}

/* ---------------- showcase slots ---------------- */
const SHOWCASE_KINDS = ['achievement', 'title', 'loot', 'emoji', 'score'];
function addShowcase(profile, kind, value, rec) {
  if (!SHOWCASE_KINDS.includes(kind)) return { ok: false, reason: `Kind must be one of: ${SHOWCASE_KINDS.join(', ')}.` };
  const v = String(value || '').trim();
  if (!v) return { ok: false, reason: 'Say what you are pinning.' };
  if (profile.showcase.length >= SHOWCASE_MAX) return { ok: false, reason: `All ${SHOWCASE_MAX} showcase slots are pinned. Remove one first with /profile showcase remove.` };
  if (profile.showcase.some(s => s.kind === kind && s.value.toLowerCase() === v.toLowerCase())) {
    return { ok: false, reason: 'That one is already pinned.' };
  }
  if (kind === 'achievement' || kind === 'title') {
    const owned = titlesLib.ownedTitles(rec);
    if (!owned.some(t => t.toLowerCase() === v.toLowerCase())) {
      return { ok: false, reason: `You do not own the title "${v}". /title show lists what you actually hold.` };
    }
  }
  if (kind === 'loot') {
    const name = lootLib.LOOT_TABLE.find(i => i.name.toLowerCase() === v.toLowerCase());
    if (!name || lootLib.countItem(rec, name.name) < 1) {
      return { ok: false, reason: `No "${v}" in your bag to pin. Loot drops from /daily, level-ups and events.` };
    }
  }
  if (kind === 'emoji' && v.length > 10) return { ok: false, reason: 'One emoji per slot - keep it short.' };
  if (kind === 'score' && v.length > 40) return { ok: false, reason: 'Scores fit 40 characters. Keep it tight.' };
  profile.showcase.push({ kind, value: v });
  return { ok: true, slot: profile.showcase.length };
}
function removeShowcase(profile, slot) {
  const i = Math.floor(slot) - 1;
  if (i < 0 || i >= profile.showcase.length) return { ok: false, reason: `Slot ${slot} is empty. You have ${profile.showcase.length} pinned.` };
  const removed = profile.showcase.splice(i, 1)[0];
  return { ok: true, removed };
}
const SHOWCASE_ICONS = { achievement: '🏆', title: '✨', loot: '🎒', emoji: '', score: '🎯' };
function showcaseLines(profile) {
  if (!profile.showcase.length) return 'Nothing pinned yet - /profile showcase add puts your best on display.';
  return profile.showcase.map((s, i) => `${i + 1}. ${SHOWCASE_ICONS[s.kind] || '📌'} ${s.value}`).join('\n');
}

/* ---------------- guestbook / wall ---------------- */
function addWallNote(profile, note) {
  const text = String(note.text || '').trim().slice(0, WALL_NOTE_MAX);
  if (!text) return { ok: false, reason: 'The note is empty - write something first.' };
  profile.wall.unshift({
    by: note.by, name: String(note.name || 'A swamp friend').slice(0, 32),
    text, stamp: String(note.stamp || '').trim().slice(0, 10), at: Date.now(),
  });
  if (profile.wall.length > WALL_MAX) profile.wall.length = WALL_MAX;
  return { ok: true };
}
function removeWallNote(profile, index, requesterId, ownerId, isMod) {
  if (requesterId !== ownerId && !isMod) return { ok: false, reason: 'Only the card owner or a mod can pull a note off the wall.' };
  const i = Math.floor(index) - 1;
  if (i < 0 || i >= profile.wall.length) return { ok: false, reason: `Note ${index} is not on the wall. There are ${profile.wall.length}.` };
  const removed = profile.wall.splice(i, 1)[0];
  return { ok: true, removed };
}
function wallLines(profile, count = 3) {
  if (!profile.wall.length) return 'No notes yet - friends can leave one with the button under the card.';
  return profile.wall.slice(0, count).map((n, i) => {
    const stamp = n.stamp ? ` ${n.stamp}` : '';
    return `${i + 1}. "${n.text}" - ${n.name}${stamp}`;
  }).join('\n');
}

/* ---------------- stateless customIds (pf:...) ----------------
 * Same durability rule as the storefront: nothing stored on the message,
 * routing is purely the customId.
 * Guestbook buttons: pf:wall:note:<ownerId>, pf:wall:list:<ownerId>.
 * Guestbook modal: pf:wall:submit:<ownerId>.
 * Layout editor selects: pf:layout:preset|pet|bio|badges:<ownerId>.
 * Save & post button: pf:save:post:<ownerId>. */
function parseCustomId(customId) {
  if (typeof customId !== 'string') return null;
  const parts = customId.split(':');
  if (parts.length !== 4 || parts[0] !== 'pf' || !parts[3]) return null;
  if (parts[1] === 'wall' && ['note', 'list', 'submit'].includes(parts[2])) {
    return { kind: 'wall', action: parts[2], ownerId: parts[3] };
  }
  if (parts[1] === 'layout' && ['preset', 'pet', 'bio', 'badges'].includes(parts[2])) {
    return { kind: 'layout', field: parts[2], ownerId: parts[3] };
  }
  if (parts[1] === 'save' && parts[2] === 'post') {
    return { kind: 'save', action: 'post', ownerId: parts[3] };
  }
  return null;
}
const wallNoteId = (ownerId) => `pf:wall:note:${ownerId}`;
const wallListId = (ownerId) => `pf:wall:list:${ownerId}`;
const wallSubmitId = (ownerId) => `pf:wall:submit:${ownerId}`;
const layoutId = (field, ownerId) => `pf:layout:${field}:${ownerId}`;
const saveId = (ownerId) => `pf:save:post:${ownerId}`;

/* ---------------- layout editor controls ----------------
 * Four select menus, one per row (Discord: one select per row). Only ever
 * attached to the OWNER's own card - strangers get the note button only.
 * Current picks are marked default. */
function buildLayoutControls(ownerId, layout) {
  const { StringSelectMenuBuilder } = require('discord.js');
  const row = (field, placeholder, options) => {
    const select = new StringSelectMenuBuilder()
      .setCustomId(layoutId(field, ownerId))
      .setPlaceholder(placeholder);
    for (const o of options) select.addOptions(o);
    return new ActionRowBuilder().addComponents(select);
  };
  const preset = layout.preset === 'custom' ? null : layout.preset;
  return [
    row('preset', '🎨 Layout preset', LAYOUT_PRESETS.map(pr => ({
      label: pr.name, value: pr.id, description: pr.blurb.slice(0, 100),
      default: preset === pr.id,
    }))),
    row('pet', '🐾 Pet corner', [
      { label: 'Pet: bottom-right', value: 'bottom-right', default: layout.petCorner === 'bottom-right' },
      { label: 'Pet: bottom-left', value: 'bottom-left', default: layout.petCorner === 'bottom-left' },
      { label: 'Pet: top-right', value: 'top-right', default: layout.petCorner === 'top-right' },
    ]),
    row('bio', '✍️ Bio position', [
      { label: 'Bio: under your name', value: 'top', default: layout.bioPos === 'top' },
      { label: 'Bio: along the bottom', value: 'bottom', default: layout.bioPos === 'bottom' },
    ]),
    row('badges', '🏅 Badges position', [
      { label: 'Badges: top-right', value: 'top-right', default: layout.badgesPos === 'top-right' },
      { label: 'Badges: bottom-left', value: 'bottom-left', default: layout.badgesPos === 'bottom-left' },
      { label: 'Badges: hidden', value: 'hidden', default: layout.badgesPos === 'hidden' },
    ]),
  ];
}

/* ---------------- canvas helpers ---------------- */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
async function safeLoad(loadImage, src) {
  if (!src) return null;
  try { return await loadImage(src); } catch { return null; }
}

/* ---------------- the card renderer ----------------
 * ctx: { user, rec, member, viewerId, presence, voiceChannelName, now }
 * Returns an AttachmentBuilder (profile.png). Never throws for missing
 * art - every layer degrades (gradient banner, initial avatar, no pet). */
async function renderProfileCard(ctx) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const { user, rec } = ctx;
  const profile = ensureProfile(rec);
  const now = ctx.now || new Date();
  const lvl = xpLib.levelFromXp(rec.xp || 0);
  const rarity = rarityFor(lvl.level);
  const tod = timeOfDay(now, profile.timezone);
  const aura = auraColor(profile, ctx.presence);
  const isOwner = ctx.viewerId === user.id;
  const show = (field) => isOwner || profile.privacy[field] !== false;
  const accent = profile.favColor || aura.css;
  const style = profile.style || 'trading';

  // ---- resolve the layers, all in parallel ----
  const bannerSrc = profile.bannerUrl
    || (profile.banner && backgroundsLib.backgroundPath(profile.banner))
    || (backgroundsLib.equippedBackground(rec) && backgroundsLib.backgroundPath(backgroundsLib.equippedBackground(rec).id))
    || null;
  const avatarSrc = user.displayAvatarURL ? user.displayAvatarURL({ extension: 'png', size: 256 }) : null;
  const frame = avatarLib.equippedFrame(rec);
  const pet = profile.pet;
  const petMood = pet ? resolvePetMood(pet, profile, { ownerStatus: ctx.presence, streak: rec.streak || 0, now: now.getTime() }) : null;
  const petSrc = pet && petsLib.speciesById(pet.species) ? petsLib.petSpritePath(pet.species, petMood) : null;
  const habitatSrc = petsLib.habitatPath(profile.habitat, tod);
  const [bannerImg, avatarImg, frameImg, petImg, habitatImg] = await Promise.all([
    safeLoad(loadImage, bannerSrc),
    safeLoad(loadImage, avatarSrc),
    safeLoad(loadImage, frame ? avatarLib.framePath(frame.id) : null),
    safeLoad(loadImage, petSrc),
    safeLoad(loadImage, habitatSrc),
  ]);

  const canvas = createCanvas(CARD_W, CARD_H);
  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = false;

  // ---- (1) background banner ----
  if (bannerImg) {
    drawCover(c, bannerImg, 0, 0, CARD_W, CARD_H);
    c.fillStyle = 'rgba(8, 20, 12, 0.55)';
    c.fillRect(0, 0, CARD_W, CARD_H);
  } else {
    const grad = c.createLinearGradient(0, 0, 0, CARD_H);
    const stops = {
      dawn: ['#2b3a67', '#7a4a63', '#1c2b22'],
      day: ['#1d5c4d', '#2e7d32', '#12291f'],
      dusk: ['#3b2d5e', '#6b3a52', '#1c2b22'],
      night: ['#0b1026', '#16213e', '#0a1a12'],
    }[tod];
    grad.addColorStop(0, stops[0]);
    grad.addColorStop(0.55, stops[1]);
    grad.addColorStop(1, stops[2]);
    c.fillStyle = grad;
    c.fillRect(0, 0, CARD_W, CARD_H);
  }
  // Habitat strip along the bottom
  if (habitatImg) c.drawImage(habitatImg, 0, CARD_H - 80, CARD_W, 80);

  // Passport header band
  const headerH = style === 'passport' ? 46 : 0;
  if (style === 'passport') {
    c.fillStyle = 'rgba(5, 15, 10, 0.88)';
    c.fillRect(0, 0, CARD_W, headerH);
    c.fillStyle = '#ffd54f';
    c.font = 'bold 20px sans-serif';
    c.textAlign = 'left';
    c.fillText('SWAMP PASSPORT', 28, 31);
    c.fillStyle = '#a5d6a7';
    c.font = '16px sans-serif';
    c.textAlign = 'right';
    c.fillText('THE SWAMP  •  EST. IN THE MURK', CARD_W - 28, 30);
    c.textAlign = 'left';
  }

  // ---- (2) avatar + frame ring ----
  // The frame PNGs are full squares with a dark centre (they are built for
  // compositing, not transparency), so the ring is cut out on an offscreen
  // canvas: keep the outer disc, punch the frame's own hole, draw the
  // clean ring over the avatar. No dark square ever reaches the card.
  const AV = 112, ax = 28, ay = 16 + headerH;
  const acx = ax + AV / 2, acy = ay + AV / 2;
  c.save();
  c.beginPath();
  c.arc(acx, acy, AV / 2, 0, Math.PI * 2);
  c.clip();
  if (avatarImg) c.drawImage(avatarImg, ax, ay, AV, AV);
  else {
    c.fillStyle = '#2e7d32';
    c.fillRect(ax, ay, AV, AV);
    c.fillStyle = '#ffffff';
    c.font = 'bold 52px sans-serif';
    c.textAlign = 'center';
    c.fillText((user.username || '?')[0].toUpperCase(), acx, acy + 18);
    c.textAlign = 'left';
  }
  c.restore();
  // Equipped frame ring over the avatar (outer 150px, hole per frame def)
  const RING = 150;
  if (frameImg && frame) {
    try {
      const ring = createCanvas(RING, RING);
      const rc = ring.getContext('2d');
      rc.imageSmoothingEnabled = false;
      rc.drawImage(frameImg, 0, 0, RING, RING);
      rc.globalCompositeOperation = 'destination-in';
      rc.beginPath();
      rc.arc(RING / 2, RING / 2, RING / 2, 0, Math.PI * 2);
      rc.fill();
      rc.globalCompositeOperation = 'destination-out';
      rc.beginPath();
      rc.arc(RING / 2, RING / 2, (frame.hole || 0.56) * RING / 2, 0, Math.PI * 2);
      rc.fill();
      c.drawImage(ring, acx - RING / 2, acy - RING / 2, RING, RING);
    } catch { /* a broken frame never breaks the card */ }
  }
  // Aura glow ring around the framed avatar
  c.save();
  c.strokeStyle = aura.css;
  c.lineWidth = 5;
  c.shadowColor = aura.css;
  c.shadowBlur = 16;
  c.beginPath();
  c.arc(acx, acy, (frameImg ? RING : AV) / 2 + 2, 0, Math.PI * 2);
  c.stroke();
  c.restore();

  // ---- (3) pet base sprite - corner from the layout editor ----
  const layout = profile.layout || { petCorner: 'bottom-right', bioPos: 'top', badgesPos: 'top-right' };
  const PET = 128;
  const petPos = {
    'bottom-right': { x: CARD_W - 28 - PET, y: CARD_H - 28 - PET, bubble: 'left', nameBelow: false },
    'bottom-left': { x: 28, y: CARD_H - 28 - PET, bubble: 'above', nameBelow: false },
    'top-right': { x: CARD_W - 28 - PET, y: 16 + headerH, bubble: 'left', nameBelow: true },
  }[layout.petCorner] || { x: CARD_W - 28 - PET, y: CARD_H - 28 - PET, bubble: 'left', nameBelow: false };
  const px0 = petPos.x, py0 = petPos.y;
  if (petImg) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = 12;
    c.shadowOffsetY = 4;
    c.drawImage(petImg, px0, py0, PET, PET);
    c.restore();
  }
  // Badges collision rule: a pet in the top-right pushes badges down.
  let badgesPos = layout.badgesPos;
  if (layout.petCorner === 'top-right' && badgesPos === 'top-right') badgesPos = 'bottom-left';
  const bioBottom = layout.bioPos === 'bottom';
  const bioShift = bioBottom ? 44 : 0; // text column rises when the bio moves down

  // ---- (4) text & UI ----
  const tx = ax + AV + 22; // text column
  const textColor = '#ffffff';
  const dimColor = 'rgba(255,255,255,0.78)';
  // Username
  c.fillStyle = textColor;
  c.font = 'bold 34px sans-serif';
  c.fillText((user.username || 'Swamp Member').slice(0, 24), tx, ay + 40);
  // Level + ladder title + rarity (trading) / passport number (passport)
  c.font = 'bold 20px sans-serif';
  c.fillStyle = style === 'trading' ? rarity.color : '#ffd54f';
  const levelLine = show('rank')
    ? `Level ${lvl.level} ${ladderTitleFor(lvl.level)}`
    : 'Level hidden';
  c.fillText(levelLine, tx, ay + 68);
  c.font = '16px sans-serif';
  c.fillStyle = dimColor;
  const subLine = style === 'trading'
    ? `${rarity.name} edition`
    : `NO. ${(user.id || '').slice(-6) || '000000'}  •  ${rarity.name}`;
  c.fillText(subLine, tx, ay + 92);
  // Bio - under the name, or along the bottom (layout editor)
  const bio = profile.bio || 'No bio yet - /profile bio writes yours.';
  c.font = '17px sans-serif';
  c.fillStyle = textColor;
  if (!bioBottom) {
    const bioLines = wrapText(c, bio, layout.petCorner === 'top-right' ? 460 : 560).slice(0, 2);
    bioLines.forEach((ln, i) => c.fillText(ln, tx, ay + 118 + i * 22));
  }
  // XP bar
  const barX = tx, barY = ay + 148 - bioShift, barW = 400, barH = 18;
  const pct = show('rank') ? Math.max(0, Math.min(1, lvl.xpIntoLevel / Math.max(1, lvl.xpForNext))) : 0;
  roundRectPath(c, barX, barY, barW, barH, 9);
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.fill();
  if (pct > 0) {
    roundRectPath(c, barX, barY, Math.max(18, barW * pct), barH, 9);
    c.fillStyle = accent;
    c.fill();
  }
  c.font = '14px sans-serif';
  c.fillStyle = dimColor;
  c.fillText(show('rank') ? `${lvl.xpIntoLevel}/${lvl.xpForNext} XP to Level ${lvl.level + 1}` : 'XP hidden by the owner', barX, barY + 36);
  // Stat blocks: three only - the fourth would sit under the pet's speech
  // bubble in the passport layout. Messages/voice live in the embed field.
  const stats = [
    { label: 'Bucks', value: show('balance') ? `${rec.swampBucks || 0}` : 'Hidden' },
    { label: 'Streak', value: show('activity') ? `${rec.streak || 0} days` : 'Hidden' },
    { label: 'Rep', value: `${rec.rep || 0}` },
  ];
  // A bottom-left pet's speech bubble sits above it - the stats slide right.
  const statsX = layout.petCorner === 'bottom-left' ? tx + 118 : tx;
  c.font = 'bold 19px sans-serif';
  stats.forEach((s, i) => {
    const sx = statsX + i * 132;
    c.fillStyle = textColor;
    c.fillText(s.value, sx, barY + 66);
    c.font = '13px sans-serif';
    c.fillStyle = dimColor;
    c.fillText(s.label, sx, barY + 84);
    c.font = 'bold 19px sans-serif';
  });
  // Faction + title line (capped before the speech bubble's airspace)
  c.font = '16px sans-serif';
  c.fillStyle = dimColor;
  const factionName = (() => {
    try { return require('./factions').factionById(rec.faction)?.name || 'No faction'; } catch { return 'No faction'; }
  })();
  let facLine = `${factionName}  •  ${rec.activeTitle || 'No title yet'}`;
  while (facLine.length > 4 && c.measureText(facLine).width > 232) facLine = facLine.slice(0, -4) + '...';
  c.fillText(facLine, tx, barY + 112);
  // Mood + voice + time line
  const mood = moodById(profile.mood);
  const moodText = mood ? `Mood: ${mood.name}` : (ctx.presence ? `Status: ${ctx.presence}` : '');
  const voiceText = ctx.voiceChannelName ? `In voice: ${ctx.voiceChannelName}` : '';
  const timeText = `${TIME_LABELS[tod]} • ${localTimeString(now, profile.timezone)}`;
  c.font = '15px sans-serif';
  c.fillStyle = aura.css;
  // Same 232px cap as the faction line - a long voice-channel name must
  // never run under the pet's speech bubble.
  let moodLine = [moodText, voiceText].filter(Boolean).join('  •  ') || 'Mood: not set - /moodpick';
  while (moodLine.length > 4 && c.measureText(moodLine).width > 232) moodLine = moodLine.slice(0, -4) + '...';
  c.fillText(moodLine, tx, barY + 136);
  c.fillStyle = dimColor;
  c.fillText(timeText, tx, barY + 158);

  // Pet name + level + speech bubble (corner-aware)
  if (pet) {
    const species = petsLib.speciesById(pet.species);
    const petName = (pet.name || (species && species.name) || 'Pet').slice(0, 20);
    const petLvl = petsLib.petLevel(pet);
    // Bottom-left pet: the name rides beside the sprite (the bubble is
    // above it); right-side pets keep the name above the sprite.
    const leftPet = layout.petCorner === 'bottom-left';
    const rightSide = !leftPet;
    const nameX = rightSide ? px0 + PET : px0 + PET + 12;
    c.textAlign = rightSide ? 'right' : 'left';
    const nameY = leftPet ? py0 + 64 : (petPos.nameBelow ? py0 + PET + 40 : py0 - 12);
    const subY = leftPet ? py0 + 44 : (petPos.nameBelow ? py0 + PET + 22 : py0 - 34);
    c.font = '14px sans-serif';
    c.fillStyle = dimColor;
    c.fillText(`${species ? species.name : ''}  •  ${petMood}`, nameX, subY);
    c.font = 'bold 19px sans-serif';
    c.fillStyle = textColor;
    c.fillText(`${petName} - Lv ${petLvl}`, nameX, nameY);
    c.textAlign = 'left';
    // Speech bubble: left of a right-side pet, above a bottom-left pet
    const speech = petsLib.petSpeech(pet, now.getTime());
    c.font = '15px sans-serif';
    const sLines = wrapText(c, speech, 210).slice(0, 2);
    const bw = 230, bh = 24 + sLines.length * 19;
    let bx, by;
    if (petPos.bubble === 'above') { bx = px0 + 6; by = py0 - bh - 20; }
    // Bottom-right pet: the bubble hugs the pet's lower half, clear of
    // the stats row - the passport header band pushes the text column
    // down into the old py0+6 spot and buried the Rep stat there.
    // A top-right pet keeps the old spot (its name rides below it).
    else if (petPos.nameBelow) { bx = px0 - bw - 12; by = py0 + 6; }
    else { bx = px0 - bw - 12; by = py0 + PET - bh - 6; }
    c.fillStyle = 'rgba(255,255,255,0.94)';
    roundRectPath(c, bx, by, bw, bh, 12);
    c.fill();
    c.beginPath(); // tail - the 'above' tail points down at the pet's head
    if (petPos.bubble === 'above') {
      c.moveTo(bx + 52, by + bh - 2);
      c.lineTo(bx + 66, by + bh + 14);
      c.lineTo(bx + 80, by + bh - 2);
    } else {
      c.moveTo(bx + bw - 8, by + bh - 14);
      c.lineTo(bx + bw + 10, by + bh + 2);
      c.lineTo(bx + bw - 22, by + bh - 2);
    }
    c.closePath();
    c.fill();
    c.fillStyle = '#1b2b1f';
    sLines.forEach((ln, i) => c.fillText(ln, bx + 12, by + 22 + i * 19));
  } else {
    c.textAlign = layout.petCorner === 'bottom-left' ? 'left' : 'right';
    c.font = '15px sans-serif';
    c.fillStyle = dimColor;
    const noPetX = layout.petCorner === 'bottom-left' ? px0 : px0 + PET;
    c.fillText('No pet yet - /profile pet adopt', noPetX, petPos.nameBelow ? py0 + PET + 22 : py0 - 14);
    c.textAlign = 'left';
  }

  // Bio along the bottom (layout editor) - clear of a bottom-left pet
  // (whose name rides beside the sprite) and its speech bubble
  if (bioBottom) {
    const bbx = layout.petCorner === 'bottom-left' ? 330 : 28;
    const bbw = layout.petCorner === 'bottom-left' ? 310 : 560;
    c.font = '17px sans-serif';
    c.fillStyle = textColor;
    const bioLines = wrapText(c, bio, bbw).slice(0, 2);
    bioLines.forEach((ln, i) => c.fillText(ln, bbx, 292 + i * 22));
  }

  // Badges row (layout editor): trading = gold text line, passport = stamp
  // circles. Bottom-left badges ride the habitat strip and slide right when
  // the pet sits bottom-left.
  const badgeTitles = (rec.unlockedTitles || []).slice(0, 4);
  if (badgesPos !== 'hidden' && badgeTitles.length) {
    if (style === 'trading') {
      let line = badgeTitles.join('  •  ');
      c.font = 'bold 14px sans-serif';
      c.fillStyle = '#ffd54f';
      if (badgesPos === 'top-right') {
        while (line.length > 4 && c.measureText(line).width > 300) line = line.slice(0, -4) + '...';
        c.textAlign = 'right';
        c.fillText(line, CARD_W - 28, ay + 24);
        c.textAlign = 'left';
      } else {
        const bx0 = layout.petCorner === 'bottom-left' ? 180 : 28;
        while (line.length > 4 && c.measureText(line).width > 400) line = line.slice(0, -4) + '...';
        c.fillText(line, bx0, 352);
      }
    }
  }

  // Style borders
  if (style === 'trading') {
    c.strokeStyle = rarity.color;
    c.lineWidth = 10;
    roundRectPath(c, 5, 5, CARD_W - 10, CARD_H - 10, 18);
    c.stroke();
    c.strokeStyle = 'rgba(255,215,0,0.55)';
    c.lineWidth = 2;
    roundRectPath(c, 14, 14, CARD_W - 28, CARD_H - 28, 12);
    c.stroke();
    // Holo shine: two diagonal translucent bands
    c.save();
    roundRectPath(c, 5, 5, CARD_W - 10, CARD_H - 10, 18);
    c.clip();
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.beginPath();
    c.moveTo(430, 0); c.lineTo(560, 0); c.lineTo(300, CARD_H); c.lineTo(170, CARD_H);
    c.closePath();
    c.fill();
    c.restore();
  } else {
    // Passport: double rule border + milestone stamps
    c.strokeStyle = '#ffd54f';
    c.lineWidth = 3;
    c.strokeRect(8, 8 + headerH, CARD_W - 16, CARD_H - 16 - headerH);
    c.lineWidth = 1;
    c.strokeRect(14, 14 + headerH, CARD_W - 28, CARD_H - 28 - headerH);
    // Milestone stamps (layout editor): top-right row, or bottom-left on
    // the habitat strip (slid right when the pet sits bottom-left).
    if (badgesPos !== 'hidden') {
      const stamps = (rec.unlockedTitles || []).slice(0, 4);
      const bottomRow = badgesPos === 'bottom-left';
      const startX = bottomRow ? (layout.petCorner === 'bottom-left' ? 180 : 28) : 612;
      const cy = bottomRow ? 360 : 46 + headerH + 34;
      const r = bottomRow ? 18 : 22;
      const gap = bottomRow ? 44 : 52;
      stamps.forEach((t, i) => {
        const cx = startX + r + i * gap;
        c.save();
        c.strokeStyle = 'rgba(255,213,79,0.85)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = 'rgba(255,213,79,0.9)';
        c.font = 'bold 10px sans-serif';
        c.textAlign = 'center';
        const words = String(t).split(' ').slice(0, 2);
        c.fillText(words[0] || '', cx, cy - 2);
        c.fillText(words[1] || '', cx, cy + 11);
        c.textAlign = 'left';
        c.restore();
      });
    }
  }

  const buf = await canvas.encode('png');
  return new AttachmentBuilder(buf, { name: 'profile.png' });
}

/* ---------------- the Discord reply ----------------
 * Image card + a compact embed (showcase + guestbook + aura) + the
 * wall button. Privacy applies to the embed fields the same way. */
async function buildProfileReply(ctx) {
  const { user, rec } = ctx;
  const profile = ensureProfile(rec);
  const attachment = await renderProfileCard(ctx);
  const isOwner = ctx.viewerId === user.id;
  const show = (field) => isOwner || profile.privacy[field] !== false;
  const lvl = xpLib.levelFromXp(rec.xp || 0);
  const rarity = rarityFor(lvl.level);
  const aura = auraColor(profile, ctx.presence);
  const embedColor = profile.favColor
    ? parseInt(profile.favColor.replace('#', ''), 16)
    : aura.color;
  const booksLine = [
    show('activity') ? `💬 ${rec.totalMessages || 0} messages` : '💬 activity hidden',
    show('activity') ? `🎙️ ${rec.totalVoiceMinutes || 0} voice minutes` : null,
    show('inventory') ? `🎒 ${lootLib.inventoryCount(rec)} loot item(s)` : '🎒 bag hidden',
    rec.activeTitle ? `✨ ${rec.activeTitle}` : null,
  ].filter(Boolean).join('  •  ');
  const embed = new EmbedBuilder()
    .setTitle(`🐊 ${user.username}'s Swamp Card`)
    .setColor(embedColor)
    .setImage('attachment://profile.png')
    .addFields(
      { name: '📊 Swamp Books', value: booksLine || 'The books are quiet.', inline: false },
      { name: '📌 Showcase', value: showcaseLines(profile), inline: false },
      { name: '📖 Guestbook', value: wallLines(profile, 3), inline: false },
    )
    .setFooter({ text: `${rarity.name} edition • ${profile.style === 'passport' ? 'Swamp Passport' : 'Swamp Trading Card'} • Level ${lvl.level} ${ladderTitleFor(lvl.level)}${isOwner ? '' : ' • Some stats may be hidden by the owner'}` });

  const row = new ActionRowBuilder();
  if (!isOwner) {
    row.addComponents(new ButtonBuilder().setCustomId(wallNoteId(user.id)).setLabel('✏️ Leave a note').setStyle(ButtonStyle.Primary));
  } else {
    // The owner's card carries Save & post: it drops the clean card into
    // the channel as a permanent post (no pin needed - it just stays
    // there). Saving again updates the same post in place.
    if (profile.wall.length) row.addComponents(new ButtonBuilder().setCustomId(wallListId(user.id)).setLabel(`📖 Guestbook (${profile.wall.length})`).setStyle(ButtonStyle.Secondary));
    row.addComponents(new ButtonBuilder().setCustomId(saveId(user.id)).setLabel('💾 Save & post').setStyle(ButtonStyle.Success));
  }
  const components = row.components.length ? [row] : [];
  // The owner's own card carries the layout editor: preset + per-element
  // slot picks, re-rendering live on every pick. Strangers never see it.
  if (isOwner) components.push(...buildLayoutControls(user.id, profile.layout));
  return { embeds: [embed], files: [attachment], components };
}

module.exports = {
  CARD_W, CARD_H, BIO_MAX, MOOD_MAX, WALL_MAX, WALL_NOTE_MAX, SHOWCASE_MAX,
  blankProfile, ensureProfile, canView,
  MOODS, moodById, auraColor, resolvePetMood,
  timeOfDay, TIME_LABELS, validTimezone, localTimeString,
  RARITIES, rarityFor,
  validateBannerUrl,
  SHOWCASE_KINDS, addShowcase, removeShowcase, showcaseLines,
  addWallNote, removeWallNote, wallLines,
  parseCustomId, wallNoteId, wallListId, wallSubmitId, layoutId, saveId,
  LAYOUT_PRESETS, layoutPresetById, applyLayoutPreset, setLayoutField, layoutPresetLabel,
  buildLayoutControls,
  renderProfileCard, buildProfileReply,
};
