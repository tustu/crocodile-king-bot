'use strict';
/**
 * The King's Little Store STOREFRONT - the persistent board mods post in
 * the main Crocodile King channel with /store post (and pin), plus the
 * personal ephemeral copy members open with /store open.
 *
 * DURABILITY RULE (the whole design): the storefront message stores
 * NOTHING. Every button and select is routed by a stateless customId that
 * encodes exactly what it does (sf:nav:<page>, sf:pick:<page>,
 * sf:buy:<itemId>, sf:sell:<loot-kebab>), and index.js handles those ids
 * centrally in interactionCreate. No message collectors, no in-memory
 * sessions - a storefront posted last month keeps working after any
 * number of bot restarts, and every purchase still runs through the ONE
 * transaction path in src/shop.js.
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const shopLib = require('./shop');
const avatarLib = require('./avatarframe');
const backgroundsLib = require('./backgrounds');

const LOOT_DIR = path.join(__dirname, '..', 'assets', 'loot');
/* Loot icons, by shop item id (buy shelf) and by loot table name (sell-back).
 * Only items with real artwork get a picture - anything without art stays a
 * text line, never a faked or wrong image. */
const LOOT_ICON_BY_ITEM = {
  'raid-pass': 'loot-raid-pass.png',
  'golden-glowshroom': 'loot-golden-glowshroom.png',
};
const LOOT_ICON_BY_NAME = {
  'Glowshroom': 'loot-glowshroom.png',
  'Gator Tooth': 'loot-gator-tooth.png',
  'Swamp Pearl': 'loot-swamp-pearl.png',
  'Cypress Charm': 'loot-cypress-charm.png',
  'Firefly Jar': 'loot-firefly-jar.png',
  'Golden Glowshroom': 'loot-golden-glowshroom.png',
  'Raid Pass': 'loot-raid-pass.png',
};

/** Artwork for a shop item: { filePath, fileName } or null. Missing files
 *  degrade to a text line - a missing picture must never break the store. */
function itemArt(item) {
  if (!item) return null;
  let filePath = null;
  if (item.kind === 'frame') filePath = avatarLib.framePath(item.frameId);
  else if (item.kind === 'background') filePath = backgroundsLib.backgroundPath(item.backgroundId);
  else if (LOOT_ICON_BY_ITEM[item.id]) filePath = path.join(LOOT_DIR, LOOT_ICON_BY_ITEM[item.id]);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return { filePath, fileName: path.basename(filePath) };
}
/** Artwork for a loot-table name (sell prompts): { filePath, fileName } or null. */
function lootArt(name) {
  const file = LOOT_ICON_BY_NAME[name];
  if (!file) return null;
  const filePath = path.join(LOOT_DIR, file);
  return fs.existsSync(filePath) ? { filePath, fileName: file } : null;
}

const PAGES = [
  {
    id: 'decor', title: 'Avatar Decorations', icon: '🎨',
    intro: 'Frames for your picture and backgrounds for your /profile card. Buy once, yours forever - decorations are never used up.',
    itemIds: [...avatarLib.FRAMES.map(f => f.id), ...backgroundsLib.BACKGROUNDS.map(b => b.id)],
    sell: false,
  },
  {
    id: 'boosts', title: 'Boosts & Passes', icon: '🚀',
    intro: 'Time and power, priced in Swamp Bucks. Remember the King\'s rule: bonuses never multiply a purchase, and a pass never stacks with itself.',
    itemIds: ['day-pass', 'xp-feast', 'firefly-tonic'],
    sell: false,
  },
  {
    id: 'loot', title: 'Loot & Sell-back', icon: '🎒',
    intro: 'Things for the bag - and the King buys loot back. Pick a sell line and he pays the listed price, one item at a time. Raid Passes he never buys back.',
    itemIds: ['raid-pass', 'mystery-loot', 'golden-glowshroom', 'title-shuffle', 'fresh-scroll'],
    sell: true,
  },
  {
    id: 'specials', title: 'Swamp Specials', icon: '🌟',
    intro: 'Single-use swamp trickery. Shields, tokens and lures - held in your record, spent automatically (or with /event lure) at the exact moment they matter.',
    itemIds: ['streak-shield', 'double-down', 'event-lure'],
    sell: false,
  },
];

function pageById(id) { return PAGES.find(p => p.id === id) || null; }
function pageIndex(id) { return PAGES.findIndex(p => p.id === id); }
function neighbourPageId(id, dir) {
  const i = pageIndex(id);
  const from = i < 0 ? 0 : i;
  return PAGES[(from + dir + PAGES.length) % PAGES.length].id;
}
/** Every shop item id on exactly one page - the coverage contract, tested. */
function allPagedItemIds() { return PAGES.flatMap(p => p.itemIds); }

/* ---------------- stateless customIds ---------------- */
const kebab = (name) => String(name).toLowerCase().replace(/\s+/g, '-');
const navId = (pageId) => `sf:nav:${pageId}`;
const pickId = (pageId) => `sf:pick:${pageId}`;
const buyId = (itemId) => `sf:buy:${itemId}`;
const sellId = (lootName) => `sf:sell:${kebab(lootName)}`;

/** Parse a storefront customId. Returns { action, arg } or null for anything else. */
function parseCustomId(customId) {
  if (typeof customId !== 'string') return null;
  const parts = customId.split(':');
  if (parts.length !== 3 || parts[0] !== 'sf') return null;
  const [, action, arg] = parts;
  if (!['nav', 'pick', 'buy', 'sell'].includes(action) || !arg) return null;
  return { action, arg };
}

/* ---------------- board building ---------------- */
function ownedMark(item, rec) {
  if (!rec) return '';
  if (item.kind === 'frame') return avatarLib.ownsFrame(rec, item.frameId) ? ' ✅ in your wardrobe' : '';
  if (item.kind === 'background') {
    if (!backgroundsLib.ownsBackground(rec, item.backgroundId)) return '';
    return backgroundsLib.equippedBackground(rec) && backgroundsLib.equippedBackground(rec).id === item.backgroundId ? ' ✅ owned, worn now' : ' ✅ owned';
  }
  if (item.kind === 'consumable') return ` (you hold ${shopLib.countConsumable(rec, item.consumable)}${item.maxOwn ? `/${item.maxOwn}` : ''})`;
  return '';
}

function buildStorefront(pageId, rec) {
  const page = pageById(pageId) || PAGES[0];
  const idx = pageIndex(page.id);
  // Items WITH artwork get their own picture embed; items without stay as
  // text lines in the header embed. One embed per picture (Discord allows
  // one image per embed, ten embeds per message: decor runs 1 + 8 = 9).
  const textLines = [];
  const itemEmbeds = [];
  const files = [];
  const seenFiles = new Set();
  for (const id of page.itemIds) {
    const item = shopLib.shopItem(id);
    const art = itemArt(item);
    if (art && !seenFiles.has(art.fileName)) {
      seenFiles.add(art.fileName);
      files.push(new AttachmentBuilder(art.filePath, { name: art.fileName }));
      itemEmbeds.push(new EmbedBuilder()
        .setTitle(`${item.name} - ${item.price} Swamp Bucks${ownedMark(item, rec)}`)
        .setColor(0x2e7d32)
        .setDescription(item.blurb)
        .setImage(`attachment://${art.fileName}`));
    } else {
      textLines.push(`**${item.name}** - ${item.price} Swamp Bucks${ownedMark(item, rec)}\n${item.blurb}`);
    }
  }
  if (page.sell) {
    textLines.push('**The King buys back:** ' + shopLib.SELLABLE.map(n => `${n} ${shopLib.SELL_PRICES[n]}`).join(' · ') + ' Bucks each.');
  }
  const embed = new EmbedBuilder()
    .setTitle(`🛒 The King's Little Store - ${page.icon} ${page.title}`)
    .setColor(0x2e7d32)
    .setDescription(textLines.length ? `${page.intro}\n\n${textLines.join('\n')}` : page.intro)
    .setFooter({
      text: rec
        ? `Your balance: ${shopLib.balanceOf(rec)} Swamp Bucks · Page ${idx + 1} of ${PAGES.length} · Virtual goods only - Swamp Bucks have no cash value`
        : `Page ${idx + 1} of ${PAGES.length} · Members: /store open for your personal board · Virtual goods only - Swamp Bucks have no cash value`,
    });

  const options = page.itemIds.map(id => {
    const item = shopLib.shopItem(id);
    return { label: `Buy · ${item.name}`.slice(0, 100), description: `${item.price} Swamp Bucks`.slice(0, 100), value: `buy:${id}` };
  });
  if (page.sell) {
    for (const name of shopLib.SELLABLE) {
      options.push({ label: `Sell · ${name}`.slice(0, 100), description: `The King pays ${shopLib.SELL_PRICES[name]} Swamp Bucks`.slice(0, 100), value: `sell:${kebab(name)}` });
    }
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(pickId(page.id))
    .setPlaceholder('Pick an item - the King shows your price check')
    .addOptions(options);
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(navId(neighbourPageId(page.id, -1))).setLabel('◀ Prev page').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sf:noop:page').setLabel(`${page.icon} ${page.title} · ${idx + 1}/${PAGES.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(navId(neighbourPageId(page.id, 1))).setLabel('Next page ▶').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed, ...itemEmbeds], components: [new ActionRowBuilder().addComponents(select), nav], files };
}

/**
 * The ephemeral price-check shown to ONE member after they pick an item:
 * their balance, the deal in plain words, and the single Buy/Sell button
 * (stateless customId, handled centrally like everything else).
 */
function buildPickPrompt(kind, key, rec) {
  if (kind === 'buy') {
    const item = shopLib.shopItem(key);
    if (!item) return null;
    const balance = shopLib.balanceOf(rec);
    const owned = item.kind === 'frame' ? avatarLib.ownsFrame(rec, item.frameId)
      : item.kind === 'background' ? backgroundsLib.ownsBackground(rec, item.backgroundId) : false;
    const note = owned ? '\nYou already own this one - decorations are bought once, the King will refuse a second sale.'
      : balance < item.price ? `\nYou are **${item.price - balance} Swamp Bucks short** - the Buy button will get a polite no.`
      : '\nYou can afford it. The button below is the till.';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(buyId(item.id)).setLabel(`Buy ${item.name} - ${item.price} Bucks`).setStyle(ButtonStyle.Primary).setDisabled(owned),
    );
    const art = itemArt(item);
    const out = { content: `🛒 **${item.name}** - **${item.price} Swamp Bucks**\n${item.blurb}\n💰 Your balance: **${balance} Swamp Bucks**${note}`, components: [row] };
    if (art) {
      out.embeds = [new EmbedBuilder().setTitle(item.name).setColor(0x2e7d32).setImage(`attachment://${art.fileName}`)];
      out.files = [new AttachmentBuilder(art.filePath, { name: art.fileName })];
    }
    return out;
  }
  // sell
  const name = shopLib.resolveLootName(key);
  if (!name || !shopLib.SELL_PRICES[name]) return null;
  const lootLib = require('./loot');
  const held = lootLib.countItem(rec, name);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(sellId(name)).setLabel(`Sell 1 ${name} - +${shopLib.SELL_PRICES[name]} Bucks`).setStyle(ButtonStyle.Primary).setDisabled(held < 1),
  );
  const art = lootArt(name);
  const out = {
    content: `🛒 **Sell ${name}** - the King pays **${shopLib.SELL_PRICES[name]} Swamp Bucks** each.\nYou hold: **${held}** · 💰 Your balance: **${shopLib.balanceOf(rec)} Swamp Bucks**${held < 1 ? '\nNone in the bag - the button stays grey until there is loot to sell.' : ''}`,
    components: [row],
  };
  if (art) {
    out.embeds = [new EmbedBuilder().setTitle(name).setColor(0x2e7d32).setImage(`attachment://${art.fileName}`)];
    out.files = [new AttachmentBuilder(art.filePath, { name: art.fileName })];
  }
  return out;
}

module.exports = {
  PAGES, pageById, pageIndex, neighbourPageId, allPagedItemIds,
  kebab, navId, pickId, buyId, sellId, parseCustomId,
  buildStorefront, buildPickPrompt, itemArt, lootArt,
};
