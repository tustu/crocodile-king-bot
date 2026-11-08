'use strict';
/**
 * Factions + reputation for Crocodile King. Dependency-free, unit-tested.
 *
 * FACTION XP POOL RULE (documented choice): every XP award also adds the
 * award's RAW BASE XP (pre-multiplier) to the earner's faction pool.
 * Base XP is used so rich bonus stacks do not let one member swing a war
 * single-handed; the pool measures showing up, not stacking coupons.
 * Pools are kept per ISO week (for /faction standings) and all-time.
 *
 * SWITCHING: first join is free. Switching later costs 50 Swamp Bucks and
 * has a 7-day cooldown from the last join/switch. Switching clears nothing:
 * XP, rep, loot and titles all stay with the member.
 */

const FACTIONS = [
  { id: 'kings-court', name: "King's Court", blurb: 'The throne\'s own. Loyal, loud, and first to the table when the King calls.' },
  { id: 'cypress-clan', name: 'Cypress Clan', blurb: 'Rooted and patient. The old trees have seen every flood and outlasted them all.' },
  { id: 'glowshroom-circle', name: 'Glowshroom Circle', blurb: 'Night folk of the glowing deep murk. Quiet, strange, and brighter than they look.' },
];
const SWITCH_COST_BUCKS = 50;
const SWITCH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function factionById(id) { return FACTIONS.find(f => f.id === id) || null; }
function factionByName(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  return FACTIONS.find(f => f.id === n || f.name.toLowerCase() === n) || null;
}
function resolveFaction(idOrName) { return factionById(idOrName) || factionByName(idOrName); }

/** ISO-8601 week key like 2026-W45 (UTC-based, standard ISO algorithm). */
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // shift to Thursday of this week
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const fDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDayNum + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

function ensurePools(storeData) {
  if (!storeData.factions || typeof storeData.factions !== 'object') storeData.factions = { weekly: {}, allTime: {} };
  if (!storeData.factions.weekly) storeData.factions.weekly = {};
  if (!storeData.factions.allTime) storeData.factions.allTime = {};
  return storeData.factions;
}

/** Add base XP to a faction's weekly + all-time pools. No-op for no faction / bad amount. */
function addFactionXp(storeData, factionIdOrName, baseXp, date = new Date()) {
  const f = resolveFaction(factionIdOrName);
  const amount = Math.floor(baseXp) || 0;
  if (!f || amount <= 0) return null;
  const pools = ensurePools(storeData);
  const wk = isoWeekKey(date);
  if (!pools.weekly[wk]) pools.weekly[wk] = {};
  pools.weekly[wk][f.name] = (pools.weekly[wk][f.name] || 0) + amount;
  pools.allTime[f.name] = (pools.allTime[f.name] || 0) + amount;
  return { faction: f, weekKey: wk, weekTotal: pools.weekly[wk][f.name], allTimeTotal: pools.allTime[f.name] };
}

function sortedPool(poolObj) {
  return FACTIONS
    .map(f => ({ id: f.id, name: f.name, xp: (poolObj && poolObj[f.name]) || 0 }))
    .sort((a, b) => b.xp - a.xp);
}

function standings(storeData, date = new Date()) {
  const pools = ensurePools(storeData);
  const wk = isoWeekKey(date);
  return { weekKey: wk, week: sortedPool(pools.weekly[wk] || {}), allTime: sortedPool(pools.allTime) };
}

/**
 * Can this record join/switch to factionId right now?
 * @returns {{ok:boolean, reason?:string, cost:number, isSwitch:boolean}}
 */
function checkFactionChange(rec, factionId, now = Date.now()) {
  const f = resolveFaction(factionId);
  if (!f) return { ok: false, reason: 'unknown faction', cost: 0, isSwitch: false };
  if (rec.faction === f.id) return { ok: false, reason: 'already in that faction', cost: 0, isSwitch: false };
  const isSwitch = !!rec.faction;
  if (isSwitch) {
    const last = rec.factionLastSwitchAt || rec.factionJoinedAt || 0;
    if (last && now - last < SWITCH_COOLDOWN_MS) {
      const daysLeft = Math.ceil((SWITCH_COOLDOWN_MS - (now - last)) / (24 * 60 * 60 * 1000));
      return { ok: false, reason: `switch cooldown: ${daysLeft} day(s) left`, cost: SWITCH_COST_BUCKS, isSwitch };
    }
    if ((rec.swampBucks || 0) < SWITCH_COST_BUCKS) {
      return { ok: false, reason: `switching costs ${SWITCH_COST_BUCKS} Swamp Bucks`, cost: SWITCH_COST_BUCKS, isSwitch };
    }
  }
  return { ok: true, cost: isSwitch ? SWITCH_COST_BUCKS : 0, isSwitch };
}

/* ---------------- reputation ---------------- */
const REP_RANKS = [
  { min: 150, name: 'Legend of THE SWAMP' },
  { min: 75, name: "King's Favourite" },
  { min: 30, name: 'Swamp Trusted' },
  { min: 10, name: 'Known in the Murk' },
  { min: 0, name: 'Unknown' },
];
function repRankFor(rep) {
  const r = Math.max(0, Math.floor(rep) || 0);
  for (const rank of REP_RANKS) if (r >= rank.min) return rank.name;
  return 'Unknown';
}
/** Rep paid for each kind of deed (single source of truth). */
const REP_ACTIONS = { questClaim: 5, sideQuest: 3, event: 2, sponsorQuest: 4, trivia: 1, streakMilestone: 5 };

module.exports = {
  FACTIONS, SWITCH_COST_BUCKS, SWITCH_COOLDOWN_MS,
  factionById, factionByName, resolveFaction,
  isoWeekKey, ensurePools, addFactionXp, standings, checkFactionChange,
  REP_RANKS, repRankFor, REP_ACTIONS,
};
