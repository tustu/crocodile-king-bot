'use strict';
/**
 * Swamp pixel pets for Crocodile King - pure logic + sprite paths.
 * The PNG sprites are rendered at build time by scripts/make-pets.js
 * (@napi-rs/canvas, programmatic pixel maps - no downloaded art) into
 * assets/pets/<species>_<mood>.png on one fixed 64x64 transparent grid.
 * This module only resolves paths and decides levels / moods / speech;
 * it never touches canvas at runtime.
 *
 * PET RULES: a pet levels up as its owner chats (+1 XP per message while
 * the pet exists). Level curve: level = floor(sqrt(xp / 10)) + 1.
 * Mood (drives the sprite): eating (fed within 30 min) > sleeping
 * (owner offline) > streak (owner's daily streak >= 7) > happy.
 * There are NO pet items or cosmetics - the pet is the base sprite only.
 */
const path = require('path');

const PETS_DIR = path.join(__dirname, '..', 'assets', 'pets');
const HABITAT_DIR = path.join(__dirname, '..', 'assets', 'habitat');

const PET_SPECIES = [
  {
    id: 'gator', name: 'Gator Pup', emoji: '🐊',
    blurb: 'A baby gator with big plans and bigger teeth.',
    catchphrases: [
      'Chomp first, ask questions never.',
      'I am the swamp. The swamp is me.',
      'Feed me or I eat your streak.',
      'One day I will be the King. Today I nap.',
    ],
  },
  {
    id: 'firefly', name: 'Firefly', emoji: '✨',
    blurb: 'A tiny lantern with opinions about the dark.',
    catchphrases: [
      'I glow, therefore I am.',
      'The night shift is the best shift.',
      'Follow my light. Mind the mud.',
      'Blink twice if you brought snacks.',
    ],
  },
  {
    id: 'frog', name: 'Swamp Frog', emoji: '🐸',
    blurb: 'A frog of uncommon calm and uncommon hops.',
    catchphrases: [
      'Ribbit. That is all. That is the wisdom.',
      'The lily pad is my throne. You may visit.',
      'I have seen things in the reeds. Tasty things.',
      'Hop less, think more. Then hop.',
    ],
  },
];

const PET_MOODS = ['happy', 'sleeping', 'streak', 'eating'];
const EATING_WINDOW_MS = 30 * 60 * 1000; // fed within the last 30 minutes
const STREAK_THRESHOLD = 7;

function speciesById(id) { return PET_SPECIES.find(s => s.id === id) || null; }

/** Pet level from XP: floor(sqrt(xp / 10)) + 1. L1 at 0, L2 at 10, L3 at 40. */
function petLevel(pet) {
  const xp = Math.max(0, Math.floor((pet && pet.xp) || 0));
  return Math.floor(Math.sqrt(xp / 10)) + 1;
}
/** Cumulative XP at which the NEXT level starts. */
function petXpForNextLevel(pet) {
  const lvl = petLevel(pet);
  return 10 * lvl * lvl;
}

/**
 * The pet's current mood (drives which sprite renders).
 * @param {object} pet the pet record ({ fedAt })
 * @param {object} ctx { ownerStatus: 'online'|'idle'|'dnd'|'offline'|null, streak: number, now?: ms }
 */
function petMood(pet, ctx = {}) {
  const now = ctx.now || Date.now();
  if (pet && pet.fedAt && now - pet.fedAt < EATING_WINDOW_MS) return 'eating';
  if (ctx.ownerStatus === 'offline') return 'sleeping';
  if ((ctx.streak || 0) >= STREAK_THRESHOLD) return 'streak';
  return 'happy';
}

/** A catchphrase for the speech bubble - deterministic per day + pet XP,
 *  so it changes over time without re-rolling on every single view. */
function petSpeech(pet, now = Date.now()) {
  const species = speciesById(pet && pet.species);
  if (!species) return '...';
  const day = Math.floor(now / 86400000);
  const idx = (day + Math.floor((pet.xp || 0) / 5)) % species.catchphrases.length;
  return species.catchphrases[idx];
}

/** Sprite file for a species + mood: assets/pets/<species>_<mood>.png */
function petSpritePath(speciesId, mood) {
  const m = PET_MOODS.includes(mood) ? mood : 'happy';
  return path.join(PETS_DIR, `${speciesId}_${m}.png`);
}
function petSpriteFile(speciesId, mood) {
  const m = PET_MOODS.includes(mood) ? mood : 'happy';
  return `${speciesId}_${m}.png`;
}

/* ---------------- habitat strips ----------------
 * Mini scenic strips along the bottom of the card. Rendered at build
 * time by scripts/make-pets.js into assets/habitat/<theme>-<time>.png. */
const HABITAT_THEMES = [
  { id: 'bayou', name: 'Bayou', blurb: 'Open water, one proud cypress, reeds at the edge.' },
  { id: 'cypress-knees', name: 'Cypress Knees', blurb: 'Knobby knees poking out of the black water.' },
  { id: 'haunted-hollow', name: 'Haunted Hollow', blurb: 'Bare branches, low fog, and something watching.' },
];
const TIME_OF_DAY = ['dawn', 'day', 'dusk', 'night'];

function habitatById(id) { return HABITAT_THEMES.find(t => t.id === id) || HABITAT_THEMES[0]; }
function habitatPath(themeId, timeOfDay) {
  const theme = habitatById(themeId).id;
  const tod = TIME_OF_DAY.includes(timeOfDay) ? timeOfDay : 'day';
  return path.join(HABITAT_DIR, `${theme}-${tod}.png`);
}
function habitatFile(themeId, timeOfDay) {
  const theme = habitatById(themeId).id;
  const tod = TIME_OF_DAY.includes(timeOfDay) ? timeOfDay : 'day';
  return `${theme}-${tod}.png`;
}

module.exports = {
  PETS_DIR, HABITAT_DIR,
  PET_SPECIES, PET_MOODS, EATING_WINDOW_MS, STREAK_THRESHOLD,
  speciesById, petLevel, petXpForNextLevel, petMood, petSpeech,
  petSpritePath, petSpriteFile,
  HABITAT_THEMES, TIME_OF_DAY, habitatById, habitatPath, habitatFile,
};
