'use strict';
/**
 * Loot table + inventory helpers for Crocodile King. Dependency-free, tested.
 * Rolls take an injectable RNG (function returning [0,1)) so tests are deterministic.
 * The Raid Pass is a normal inventory item with a special use: /raid spends one
 * to trigger a server-wide event.
 */

/** Deterministic RNG (mulberry32) - handy for tests and seeded rolls. */
function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOOT_TABLE = [
  { name: 'Glowshroom', rarity: 'common', weight: 30, hint: 'Glows. Probably safe. The King eats them like popcorn.' },
  { name: 'Firefly Jar', rarity: 'common', weight: 22, hint: 'A jar of swamp lanterns. Lets you see the path at night.' },
  { name: 'Gator Tooth', rarity: 'common', weight: 20, hint: 'He has thousands. He will not miss one. Probably.' },
  { name: 'Cypress Charm', rarity: 'uncommon', weight: 14, hint: 'Carved from a cypress knee. Old roots, old luck.' },
  { name: 'Swamp Pearl', rarity: 'uncommon', weight: 8, hint: 'Born in black water. Worth a nod from the throne.' },
  { name: 'Raid Pass', rarity: 'special', weight: 4, hint: 'Spend it with /raid to summon a server-wide event in your channel.' },
  { name: 'Golden Glowshroom', rarity: 'rare', weight: 2, hint: 'The rarest fungus in the murk. Flex responsibly.' },
];
const TOTAL_WEIGHT = LOOT_TABLE.reduce((a, i) => a + i.weight, 0);

function lootItem(name) { return LOOT_TABLE.find(i => i.name === name) || null; }

/** One loot roll. rng defaults to Math.random; pass mulberry32(seed) for determinism. */
function rollLoot(rng = Math.random) {
  let roll = rng() * TOTAL_WEIGHT;
  for (const item of LOOT_TABLE) {
    roll -= item.weight;
    if (roll < 0) return item.name;
  }
  return LOOT_TABLE[LOOT_TABLE.length - 1].name;
}

function rollLootMany(count, rng = Math.random) {
  const out = [];
  for (let i = 0; i < Math.max(0, Math.floor(count) || 0); i++) out.push(rollLoot(rng));
  return out;
}

/* ---------------- inventory on a user record (map item -> count) ---------------- */
function ensureInventory(rec) {
  if (!rec.inventory || typeof rec.inventory !== 'object') rec.inventory = {};
  return rec.inventory;
}
function countItem(rec, name) { return (ensureInventory(rec)[name] || 0); }
function addItem(rec, name, count = 1) {
  if (!lootItem(name)) return false;
  const inv = ensureInventory(rec);
  inv[name] = (inv[name] || 0) + Math.max(0, Math.floor(count) || 0);
  if (inv[name] <= 0) delete inv[name];
  return true;
}
function consumeItem(rec, name, count = 1) {
  const inv = ensureInventory(rec);
  if ((inv[name] || 0) < count) return false;
  inv[name] -= count;
  if (inv[name] <= 0) delete inv[name];
  return true;
}
function inventoryCount(rec) {
  return Object.values(ensureInventory(rec)).reduce((a, n) => a + (n || 0), 0);
}
function inventoryList(rec) {
  const inv = ensureInventory(rec);
  return LOOT_TABLE.filter(i => inv[i.name] > 0).map(i => ({ ...i, count: inv[i.name] }));
}

/* ---------------- Booster Pack month gate (dependency-free, tested) ----------------
 * A booster earns one Booster Pack per Halifax calendar month for as long as
 * they keep boosting. The gate is just: boosting NOW, and the record's
 * lastBoostPackMonth is not the current month key. A lapse month simply
 * fails the "boosting now" half; returning in a later month passes again. */
function monthKeyInHalifax(date = new Date(), timeZone = 'America/Halifax') {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit' });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}`; // YYYY-MM
}
function monthNameInHalifax(date = new Date(), timeZone = 'America/Halifax') {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'long' }).format(date);
}
function boosterPackEligible(rec, isBoosting, date = new Date(), timeZone = 'America/Halifax') {
  if (!isBoosting) return false;
  return (rec && rec.lastBoostPackMonth) !== monthKeyInHalifax(date, timeZone);
}

module.exports = {
  LOOT_TABLE, TOTAL_WEIGHT, RAID_PASS: 'Raid Pass',
  mulberry32, lootItem, rollLoot, rollLootMany,
  ensureInventory, countItem, addItem, consumeItem, inventoryCount, inventoryList,
  monthKeyInHalifax, monthNameInHalifax, boosterPackEligible,
};
