'use strict';
/**
 * Cosmetic titles for Crocodile King. Dependency-free, unit-tested.
 * Bot-side display only - titles show in /profile and /leaderboard,
 * nicknames are never edited.
 *
 * GENERATED TITLE: minted when a member reaches level 5, a combination of
 * adjective x swamp noun derived deterministically from their user ID, so
 * the same member always mints the same first title. /title generate
 * re-rolls it, at most once per level (tracked by titleGenLevel).
 * ACHIEVEMENT TITLES: a fixed list unlocked by deeds, kept forever.
 */

const ADJECTIVES = [
  'Murk-Blessed', 'Bog-Born', 'Gator-Kissed', 'Cypress-Crowned', 'Moonlit',
  'Mud-Caked', 'Firefly-Lit', 'Throne-Touched', 'Deep-Water', 'Swamp-Slick',
  'Voodoo-Hummed', 'Pearl-Eyed', 'Night-Paddled', 'Root-Tangled',
];
const NOUNS = [
  'Gator Whisperer', 'Mud Runner', 'Cypress Walker', 'Glowshroom Keeper',
  'Bayou Drifter', 'Tooth Collector', 'Marsh Warden', 'King\'s Herald',
  'Firefly Charmer', 'Pearl Diver', 'Bog Knight', 'Swamp Storyteller',
];

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic generated title for a seed (userId, or userId:level for re-rolls). */
function generateTitle(seed) {
  const h = hashString(seed);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length];
  return `${adj} ${noun}`;
}

const ACHIEVEMENT_TITLES = {
  firstQuest: { name: 'Errand Runner of the Murk', how: 'Claim your first daily quest' },
  firstEvent: { name: 'First Into The Water', how: 'Take part in your first swamp event' },
  firstSponsor: { name: 'Brand-Friendly Buccaneer', how: 'Complete your first Sponsored quest' },
  streak7: { name: 'Seven-Day Swamp Fixture', how: 'Reach a 7-day daily streak' },
  factionJoin: { name: 'Sworn To A Banner', how: 'Join a faction' },
  booster: { name: 'Swamp Booster', how: 'Boost THE SWAMP (unlocks with your first Booster Pack)' },
};

/** Ensure title fields exist on a user record. */
function ensureTitles(rec) {
  if (!Array.isArray(rec.unlockedTitles)) rec.unlockedTitles = [];
  if (rec.activeTitle === undefined) rec.activeTitle = null;
  if (rec.generatedTitle === undefined) rec.generatedTitle = null;
  if (rec.titleGenLevel === undefined) rec.titleGenLevel = 0;
  return rec;
}

/** All titles this member owns: generated (if minted) + unlocked achievements. */
function ownedTitles(rec) {
  ensureTitles(rec);
  const out = [];
  if (rec.generatedTitle) out.push(rec.generatedTitle);
  for (const t of rec.unlockedTitles) if (!out.includes(t)) out.push(t);
  return out;
}

/** Unlock an achievement title by key. Returns the title name if newly unlocked, else null. */
function unlockAchievement(rec, key) {
  const entry = ACHIEVEMENT_TITLES[key];
  if (!entry) return null;
  ensureTitles(rec);
  if (rec.unlockedTitles.includes(entry.name)) return null;
  rec.unlockedTitles.push(entry.name);
  if (!rec.activeTitle) rec.activeTitle = entry.name;
  return entry.name;
}

/** Mint the level-5 generated title if due. Returns the title or null. */
function mintGeneratedTitle(rec, level) {
  ensureTitles(rec);
  if (level < 5 || rec.generatedTitle) return null;
  rec.generatedTitle = generateTitle(rec.userId);
  rec.titleGenLevel = level;
  if (!rec.activeTitle) rec.activeTitle = rec.generatedTitle;
  return rec.generatedTitle;
}

/**
 * Re-roll the generated title, at most once per level.
 * @returns {{ok:boolean, reason?:string, title?:string}}
 */
function regenerateTitle(rec, level) {
  ensureTitles(rec);
  if (level < 5) return { ok: false, reason: 'Generated titles mint at level 5. Keep sloshin\'.' };
  if (!rec.generatedTitle) { const t = mintGeneratedTitle(rec, level); return { ok: true, title: t }; }
  if ((rec.titleGenLevel || 0) >= level) {
    return { ok: false, reason: `Already re-rolled at level ${level}. One fresh title per level - next chance at level ${level + 1}.` };
  }
  rec.generatedTitle = generateTitle(`${rec.userId}:${level}:${Date.now() % 997}`);
  rec.titleGenLevel = level;
  return { ok: true, title: rec.generatedTitle };
}

module.exports = {
  ADJECTIVES, NOUNS, ACHIEVEMENT_TITLES,
  hashString, generateTitle,
  ensureTitles, ownedTitles, unlockAchievement, mintGeneratedTitle, regenerateTitle,
};
