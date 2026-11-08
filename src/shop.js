'use strict';
/**
 * The King's Little Store - a Swamp Bucks shop for Crocodile King.
 * Dependency-free transaction logic (unit-tested): every function here
 * validates EVERYTHING before touching the record, then mutates once, so
 * a refused sale never charges and never half-grants. index.js does the
 * Discord talking and the store.save(); the one effect that cannot live
 * here - the XP Feast - is handed back as `xpToGrant` for index.js to run
 * through the normal awardXp pipeline with a flat x1 multiplier object
 * (purchases are never multiplied by bonuses, and the King says so).
 *
 * Virtual goods only. Swamp Bucks only. Swamp Bucks cannot be bought with
 * real money anywhere in this bot, and nothing here has any cash value.
 */
const lootLib = require('./loot');
const titlesLib = require('./titles');
const xpLib = require('./xp');
const avatarLib = require('./avatarframe');
const backgroundsLib = require('./backgrounds');

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTION_POINTS_BASE = 5;    // mirrors index.js - pass holders get 8
const ACTION_POINTS_PREMIUM = 8;

const SHOP_ITEMS = [
  { id: 'raid-pass', name: 'Raid Pass', price: 150, kind: 'loot', lootName: 'Raid Pass', blurb: 'The event ticket. Spend it with /raid to summon a server-wide event.' },
  { id: 'mystery-loot', name: 'Murk Mystery Loot', price: 75, kind: 'mystery', blurb: 'One roll of the King\'s loot table, revealed the moment you buy.' },
  { id: 'title-shuffle', name: 'Title Shuffle', price: 50, kind: 'title', blurb: 'One extra roll of your generated cosmetic title - beyond the free once-per-level re-roll.' },
  { id: 'firefly-tonic', name: 'Firefly Tonic', price: 40, kind: 'tonic', blurb: 'Refills today\'s action points to full. One per day, the fireflies union insists.' },
  { id: 'fresh-scroll', name: 'Fresh Scroll', price: 30, kind: 'scroll', blurb: 'Wipes your current side quest clean, no penalty, so you can pull a new one.' },
  { id: 'xp-feast', name: 'King\'s XP Feast', price: 200, kind: 'feast', xp: 100, blurb: '+100 XP, flat. Bonuses do NOT multiply a purchase - the King\'s rule, no exceptions.' },
  { id: 'day-pass', name: '1-Day Swamp Pass', price: 500, kind: 'pass', days: 1, blurb: '24 hours of pass perks: the x1.5 XP line, +1 loot roll, 8 action points a day.' },
  { id: 'golden-glowshroom', name: 'Golden Glowshroom', price: 1000, kind: 'loot', lootName: 'Golden Glowshroom', blurb: 'The rarest fungus in the murk, no dice required. Pure flex, sits in your bag.' },
  // Avatar decorations: buy once, owned forever, never consumable, never sellable.
  ...avatarLib.FRAMES.map(f => ({
    id: f.id, name: f.name, price: f.price, kind: 'frame', frameId: f.id,
    blurb: `${f.blurb} Avatar decoration - /avatarframe apply wears it.`,
  })),
  // Profile card backgrounds: permanent decorations, auto-equip on buy.
  ...backgroundsLib.BACKGROUNDS.map(b => ({
    id: b.id, name: b.name, price: b.price, kind: 'background', backgroundId: b.id,
    blurb: `${b.blurb} Profile background - shows on your /profile card, newest owned is worn.`,
  })),
  // Swamp Specials: consumables, held as counts on the record (rec.consumables).
  { id: 'streak-shield', name: 'Streak Shield', price: 180, kind: 'consumable', consumable: 'streak-shield', maxOwn: 2, blurb: 'Auto-spent to save your daily streak the first time you would miss a day. Max own 2.' },
  { id: 'double-down', name: 'Double-Down Token', price: 120, kind: 'consumable', consumable: 'double-down', maxOwn: 3, blurb: 'Your next quest or side-quest claim pays DOUBLE Swamp Bucks (not XP, not loot). Auto-spent on that claim. Max own 3.' },
  { id: 'event-lure', name: 'Event Lure', price: 250, kind: 'consumable', consumable: 'event-lure', blurb: 'Spend it with /event lure to call a random event into your channel (the 30-minute channel cooldown still rules).' },
];

/* ---------------- consumables on a user record ---------------- */
function ensureConsumables(rec) {
  if (!rec.consumables || typeof rec.consumables !== 'object') rec.consumables = {};
  return rec.consumables;
}
function countConsumable(rec, key) { return ensureConsumables(rec)[key] || 0; }
function addConsumable(rec, key, count = 1) {
  const c = ensureConsumables(rec);
  c[key] = (c[key] || 0) + Math.max(0, Math.floor(count) || 0);
  if (c[key] <= 0) delete c[key];
  return c[key] || 0;
}
function consumeConsumable(rec, key) {
  const c = ensureConsumables(rec);
  if ((c[key] || 0) < 1) return false;
  c[key] -= 1;
  if (c[key] <= 0) delete c[key];
  return true;
}

/** Sell-back prices for LOOT only. Raid Pass deliberately absent: not sellable. */
const SELL_PRICES = {
  'Glowshroom': 20,
  'Gator Tooth': 35,
  'Swamp Pearl': 60,
  'Cypress Charm': 45,
  'Firefly Jar': 55,
  'Golden Glowshroom': 400,
};
const SELLABLE = Object.keys(SELL_PRICES);

function shopItem(id) { return SHOP_ITEMS.find(i => i.id === id) || null; }
function balanceOf(rec) { return Math.max(0, Math.floor(rec.swampBucks || 0)); }

function fail(reason) { return { ok: false, reason }; }

/**
 * Buy a shelf item. Validates all gates first; on success deducts once and
 * applies the record-level effect in the same step.
 * ctx: { now (ms), todayKey (Halifax date key), rng, premium (member has
 *        Royalty role or an active timed pass), actionCap (5 or 8) }
 */
function buy(rec, itemId, ctx = {}) {
  const item = shopItem(itemId);
  if (!item) return fail('That is not on the King\'s shelf. Run /store show and pick from the board.');
  const now = ctx.now || Date.now();
  const todayKey = ctx.todayKey || xpLib.dateKeyInHalifax(new Date(now));
  const rng = ctx.rng || Math.random;
  const level = xpLib.levelFromXp(rec.xp || 0).level;

  /* ---- item gates, all checked BEFORE any money moves ---- */
  if (item.kind === 'frame' && avatarLib.ownsFrame(rec, item.frameId)) {
    return fail(`**${item.name}** is already in your wardrobe. The King does not sell a gator the same frame twice. /avatarframe apply and wear it.`);
  }
  if (item.kind === 'background' && backgroundsLib.ownsBackground(rec, item.backgroundId)) {
    return fail(`**${item.name}** already hangs behind your /profile card. Decorations are bought once - the King does not sell the same swamp twice.`);
  }
  if (item.kind === 'consumable' && item.maxOwn && countConsumable(rec, item.consumable) >= item.maxOwn) {
    return fail(`You already hold the max **${item.maxOwn} x ${item.name}**. The King rations the good stuff - spend one first.`);
  }
  if (item.kind === 'tonic') {
    if (rec.tonicDayKey === todayKey) return fail('One Firefly Tonic a day. The fireflies union negotiated hard for that clause. Tomorrow, first light.');
    const cap = ctx.actionCap != null ? ctx.actionCap : (ctx.premium ? ACTION_POINTS_PREMIUM : ACTION_POINTS_BASE);
    const current = rec.actionDayKey === todayKey && typeof rec.actionPoints === 'number' ? rec.actionPoints : cap;
    if (current >= cap) return fail(`Your action points are already full (${cap}/${cap}). A tonic now would be swamp water down the drain - the King refuses the waste.`);
  }
  if (item.kind === 'scroll' && !rec.sideQuest) {
    return fail('No side quest on your hook to wipe. A Fresh Scroll with nothing written on your slate is just... a scroll. /sidequest get first.');
  }
  if (item.kind === 'pass' && (ctx.premium || (rec.passUntil || 0) > now)) {
    return fail('Pass benefits are already running on your name - the Royalty role or a live timed pass. The same x1.5 never stacks with itself, so the King will not sell you a second helping of the same line. Wait for it to run out.');
  }
  if (item.kind === 'title' && level < 5) {
    return fail(`Generated titles mint at Level 5 - you are Level ${level}. Nothing to shuffle yet. Keep sloshin'.`);
  }
  if (balanceOf(rec) < item.price) {
    return fail(`**${item.name}** costs **${item.price} Swamp Bucks** and you hold **${balanceOf(rec)}**. Short is short - the King takes no IOUs. Earn more: /daily, quests, events, or sell loot back with /store sell.`);
  }

  /* ---- the one atomic step: deduct, then apply ---- */
  rec.swampBucks = balanceOf(rec) - item.price;
  const out = { ok: true, item, price: item.price, balance: rec.swampBucks };
  switch (item.kind) {
    case 'loot':
      lootLib.addItem(rec, item.lootName, 1);
      out.grantedItem = item.lootName;
      break;
    case 'mystery': {
      const name = lootLib.rollLoot(rng);
      lootLib.addItem(rec, name, 1);
      out.grantedItem = name;
      out.revealed = true;
      break;
    }
    case 'frame':
      avatarLib.grantFrame(rec, item.frameId);
      out.frameId = item.frameId;
      break;
    case 'background':
      backgroundsLib.grantBackground(rec, item.backgroundId); // auto-equips (newest owned is worn)
      out.backgroundId = item.backgroundId;
      break;
    case 'consumable':
      out.consumableCount = addConsumable(rec, item.consumable, 1);
      out.consumable = item.consumable;
      break;
    case 'tonic': {
      const cap = ctx.actionCap != null ? ctx.actionCap : (ctx.premium ? ACTION_POINTS_PREMIUM : ACTION_POINTS_BASE);
      rec.actionDayKey = todayKey;
      rec.actionPoints = cap;
      rec.tonicDayKey = todayKey;
      out.actionPoints = cap;
      break;
    }
    case 'scroll':
      out.clearedQuest = rec.sideQuest.label || 'side quest';
      rec.sideQuest = null;
      break;
    case 'feast':
      out.xpToGrant = item.xp; // index.js grants via awardXp with a flat x1 multiplier object
      break;
    case 'pass':
      rec.passUntil = now + item.days * DAY_MS;
      out.passUntil = rec.passUntil;
      break;
    case 'title':
      if (!rec.generatedTitle) {
        out.newTitle = titlesLib.mintGeneratedTitle(rec, level);
      } else {
        const t = titlesLib.generateTitle(`${rec.userId}:shop:${now}:${Math.floor(rng() * 1e9)}`);
        rec.generatedTitle = t;
        rec.activeTitle = t;
        out.newTitle = t;
      }
      break;
  }
  return out;
}

/**
 * Sell one LOOT item back for Swamp Bucks. Only the sellable table; Raid
 * Passes, frames and effects are refused. One item per call.
 */
/** Resolve any reasonable spelling of a loot item ('Gator Tooth', 'gator tooth',
 *  'gator-tooth', or the shop id 'golden-glowshroom') to its table name, or null. */
function resolveLootName(input) {
  if (!input) return null;
  if (lootLib.lootItem(input)) return input;
  const wanted = String(input).trim().toLowerCase().replace(/-/g, ' ');
  const byName = lootLib.LOOT_TABLE.find(i => i.name.toLowerCase() === wanted);
  if (byName) return byName.name;
  const s = shopItem(input);
  return s && s.lootName ? s.lootName : null;
}

function sell(rec, input) {
  if (!input) return fail('Name the loot you are selling. The board is in /store show.');
  const name = resolveLootName(input);
  if (!name) return fail(`The King has never stocked "${input}". Loot items only - see /store show for what he buys back.`);
  const price = SELL_PRICES[name];
  if (!price) return fail(`**${name}** the King does not buy back. ${name === 'Raid Pass' ? 'A Raid Pass is spent with /raid, not sold - it is an event in a wrapper.' : 'It is yours to keep.'} Sellable loot: ${SELLABLE.join(', ')}.`);
  if (lootLib.countItem(rec, name) < 1) return fail(`No **${name}** in your bag to sell. The King buys loot, not stories about loot. /inventory shows what you actually hold.`);
  lootLib.consumeItem(rec, name, 1);
  rec.swampBucks = balanceOf(rec) + price;
  return { ok: true, itemName: name, price, balance: rec.swampBucks };
}

/* ---------------- Swamp Specials mechanics (pure, unit-tested) ---------------- */

/**
 * Daily streak resolution with the Streak Shield hook. Call BEFORE setting
 * rec.lastDailyKey to today. Mutates rec only when a shield is spent.
 * No shield: yesterday -> streak+1, anything older (or no history) -> 1.
 * Missed day + shield held: one shield is consumed, streak kept and +1
 * (today's claim still counts) - the shield saves the streak exactly once
 * per shield, and only on a genuine miss.
 */
function resolveDailyStreak(rec, todayKey, yesterdayKey) {
  if (rec.lastDailyKey === todayKey) return { streak: rec.streak || 0, shieldUsed: false, already: true };
  const missed = !!rec.lastDailyKey && rec.lastDailyKey !== yesterdayKey;
  if (missed && countConsumable(rec, 'streak-shield') > 0) {
    consumeConsumable(rec, 'streak-shield');
    return { streak: (rec.streak || 0) + 1, shieldUsed: true };
  }
  return { streak: rec.lastDailyKey === yesterdayKey ? (rec.streak || 0) + 1 : 1, shieldUsed: false };
}

/**
 * Double-Down hook for quest / side-quest claims: if a token is held it is
 * consumed and the BUCKS (only the Bucks - never XP, never loot) double.
 */
function applyDoubleDown(rec, baseBucks) {
  const base = Math.max(0, Math.floor(baseBucks || 0));
  if (countConsumable(rec, 'double-down') > 0) {
    consumeConsumable(rec, 'double-down');
    return { bucks: base * 2, used: true };
  }
  return { bucks: base, used: false };
}

/** The 30-minute per-channel event cooldown shared by /raid and /event lure. */
const EVENT_CHANNEL_COOLDOWN_MS = 30 * 60 * 1000;
function eventCooldown(storeData, channelId, now = Date.now()) {
  const last = (storeData && storeData.channelRaidLastAt && storeData.channelRaidLastAt[channelId]) || 0;
  const waitMs = EVENT_CHANNEL_COOLDOWN_MS - (now - last);
  return last && waitMs > 0 ? { onCooldown: true, waitMs, readyAt: last + EVENT_CHANNEL_COOLDOWN_MS } : { onCooldown: false, waitMs: 0, readyAt: 0 };
}

/** The shop board for /store show, with the member's balance (and wardrobe ticks). */
function boardText(balance, rec) {
  const shelf = SHOP_ITEMS.filter(i => !['frame', 'background', 'consumable'].includes(i.kind))
    .map(i => `- **${i.name}** - ${i.price} Bucks · ${i.blurb}`).join('\n');
  const specials = SHOP_ITEMS.filter(i => i.kind === 'consumable')
    .map(i => `- **${i.name}** - ${i.price} Bucks${rec ? ` (you hold ${countConsumable(rec, i.consumable)})` : ''} · ${i.blurb}`).join('\n');
  const frames = SHOP_ITEMS.filter(i => i.kind === 'frame')
    .map(i => `- **${i.name}** - ${i.price} Bucks${rec && avatarLib.ownsFrame(rec, i.frameId) ? ' ✅ in your wardrobe' : ''} · ${avatarLib.frameById(i.frameId).blurb}`).join('\n');
  const bgs = SHOP_ITEMS.filter(i => i.kind === 'background')
    .map(i => `- **${i.name}** - ${i.price} Bucks${rec && backgroundsLib.ownsBackground(rec, i.backgroundId) ? ' ✅ owned' : ''} · ${backgroundsLib.backgroundById(i.backgroundId).blurb}`).join('\n');
  const sellLine = SELLABLE.map(n => `${n} ${SELL_PRICES[n]}`).join(' · ');
  return `🛒 **The King's Little Store** - everything priced in Swamp Bucks. Virtual goods only: Swamp Bucks are not money, cannot be bought with money, and nothing here has any cash value. Ever.\n💰 **Your balance: ${balance} Swamp Bucks**\n\n**On the shelf** (buy with /store buy, or browse the storefront with /store open)\n${shelf}\n\n**Swamp Specials** (consumables)\n${specials}\n\n**Avatar Decorations** (buy once, yours forever - /avatarframe list shows your wardrobe, /avatarframe apply puts one on your picture)\n${frames}\n\n**Profile Backgrounds** (buy once - the newest owned hangs behind your /profile card)\n${bgs}\n\n**The King buys back loot** (one at a time, /store sell)\n${sellLine} Bucks each.\nRaid Passes he does not buy back - spend those with /raid.`;
}

module.exports = {
  SHOP_ITEMS, SELL_PRICES, SELLABLE,
  ACTION_POINTS_BASE, ACTION_POINTS_PREMIUM,
  shopItem, balanceOf, buy, sell, boardText,
  resolveLootName,
  ensureConsumables, countConsumable, addConsumable, consumeConsumable,
  resolveDailyStreak, applyDoubleDown,
  EVENT_CHANNEL_COOLDOWN_MS, eventCooldown,
};
