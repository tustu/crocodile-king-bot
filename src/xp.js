'use strict';
/**
 * Dependency-free XP math for Crocodile King.
 * Kept separate from discord.js so unit tests run with zero installs.
 *
 * MULTIPLIER RULES (all stack multiplicatively, total capped at x3):
 *  Verified role          x1.25
 *  Server Booster         x2
 *  Swamp Royalty Pass     x1.5 (role, OR a timed VIP Pass via hasPass - same
 *                          x1.5 line, never both; the two never stack)
 *  New member (< 7 days)  x1.5
 *  Daily streak >= 7 days x1.2
 *  Weekend (Sat/Sun, America/Halifax) x2
 *  Night Owl (00:00-04:00 America/Halifax) x1.25
 *  Event / sponsor bonus active in channel x2
 *
 * LEVEL CURVE:
 *  XP needed to go from level L to L+1 = floor(100 * L^1.5)
 *  Level 1 -> 2: 100, 2 -> 3: 282, 3 -> 4: 519, 5 -> 6: 1118, 10 -> 11: 3162 ...
 *  Swamp Bucks on level up: 10 x new level, per level gained.
 */

const TIMEZONE = process.env.TIMEZONE || 'America/Halifax';
const MULTIPLIER_CAP = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parts of `date` in the configured timezone: { weekdayShort, hour, dateKey } */
function halifaxParts(date = new Date(), timeZone = TIMEZONE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    weekdayShort: parts.weekday, // Mon, Tue, Wed, Thu, Fri, Sat, Sun
    hour: parseInt(parts.hour, 10) % 24,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`, // Halifax calendar day
  };
}

function isWeekendInHalifax(date = new Date(), timeZone = TIMEZONE) {
  const { weekdayShort } = halifaxParts(date, timeZone);
  return weekdayShort === 'Sat' || weekdayShort === 'Sun';
}

function isNightOwlInHalifax(date = new Date(), timeZone = TIMEZONE) {
  const { hour } = halifaxParts(date, timeZone);
  return hour >= 0 && hour < 4;
}

function dateKeyInHalifax(date = new Date(), timeZone = TIMEZONE) {
  return halifaxParts(date, timeZone).dateKey;
}

/**
 * Pure multiplier calculation.
 * @param {object} opts
 * @param {boolean} [opts.isVerified]
 * @param {boolean} [opts.isBooster]
 * @param {boolean} [opts.isRoyalty]     holds the Swamp Royalty Pass role
 * @param {boolean} [opts.hasPass]        holds an active timed VIP Pass - same x1.5 as
 *                                        isRoyalty, reported under its own label, and
 *                                        ignored (no double count) when isRoyalty is set
 * @param {string}  [opts.passLabel]      label for the hasPass line (default 'VIP Pass')
 * @param {number|Date} [opts.joinedAt]   member join time (for new-member bonus)
 * @param {number} [opts.streak]          current daily streak in days
 * @param {boolean} [opts.eventActive]    an event / sponsor bonus is live in this channel
 * @param {boolean} [opts.isWeekend]      override (tests); default derived from `now`
 * @param {boolean} [opts.isNightOwl]     override (tests); default derived from `now`
 * @param {Date} [opts.now]
 * @returns {{ multiplier:number, capped:boolean, rawMultiplier:number, breakdown:Array<{key:string,label:string,factor:number}> }}
 */
function computeMultiplier(opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const breakdown = [];
  const add = (key, label, factor) => breakdown.push({ key, label, factor });

  if (opts.isVerified) add('verified', 'Verified member', 1.25);
  if (opts.isBooster) add('booster', 'Server Booster', 2);
  if (opts.isRoyalty) add('royalty', 'Swamp Royalty Pass', 1.5);
  else if (opts.hasPass) add('pass', opts.passLabel || 'VIP Pass (timed)', 1.5);
  if (opts.joinedAt) {
    const ageMs = now.getTime() - new Date(opts.joinedAt).getTime();
    if (ageMs >= 0 && ageMs < 7 * DAY_MS) add('newMember', 'New member (first 7 days)', 1.5);
  }
  if ((opts.streak || 0) >= 7) add('streak', '7+ day streak', 1.2);

  const weekend = opts.isWeekend !== undefined ? opts.isWeekend : isWeekendInHalifax(now);
  if (weekend) add('weekend', 'Weekend in the Swamp', 2);

  const nightOwl = opts.isNightOwl !== undefined ? opts.isNightOwl : isNightOwlInHalifax(now);
  if (nightOwl) add('nightOwl', 'Night Owl (12am-4am)', 1.25);

  if (opts.eventActive) add('event', 'Event / sponsor bonus in this channel', 2);

  const rawMultiplier = breakdown.reduce((acc, b) => acc * b.factor, 1);
  const multiplier = Math.min(rawMultiplier, MULTIPLIER_CAP);
  return { multiplier, rawMultiplier, capped: rawMultiplier > MULTIPLIER_CAP, breakdown };
}

/** Apply a multiplier to a base XP amount (always at least 1 XP for positive base). */
function applyMultiplier(baseXp, multiplier) {
  if (!baseXp || baseXp <= 0) return 0;
  return Math.max(1, Math.floor(baseXp * multiplier));
}

/** XP needed to advance from `level` to `level + 1`. */
function xpForNextLevel(level) {
  const l = Math.max(1, Math.floor(level));
  return Math.floor(100 * Math.pow(l, 1.5));
}

/** Total cumulative XP required to *reach* `level` (level 1 = 0). */
function totalXpForLevel(level) {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpForNextLevel(l);
  return total;
}

/** Derive level + progress from a total XP amount. */
function levelFromXp(totalXp) {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (remaining >= xpForNextLevel(level)) {
    remaining -= xpForNextLevel(level);
    level++;
  }
  return {
    level,
    xpIntoLevel: remaining,
    xpForNext: xpForNextLevel(level),
    xpToGo: xpForNextLevel(level) - remaining,
  };
}

/** Swamp Bucks awarded when reaching `newLevel`. */
function bucksForLevel(newLevel) {
  return 10 * Math.max(1, Math.floor(newLevel));
}

module.exports = {
  TIMEZONE, MULTIPLIER_CAP, DAY_MS,
  halifaxParts, isWeekendInHalifax, isNightOwlInHalifax, dateKeyInHalifax,
  computeMultiplier, applyMultiplier,
  xpForNextLevel, totalXpForLevel, levelFromXp, bucksForLevel,
};
