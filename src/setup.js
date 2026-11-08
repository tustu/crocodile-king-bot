'use strict';
/** In-server setup - HOME EDITION (v2.2).
 *  The King is wired up from INSIDE Discord after he joins:
 *    /setup panel  - dropdowns: pick the server's EXISTING roles/channels
 *                    (whatever their names - "Server ✦ Mod" and friends
 *                    are welcome). Every pick saves instantly.
 *    /setup show   - the wiring at a glance + what is still missing.
 *    /setup create - builds ONLY the missing pieces, with default names
 *                    and the agreed permission overwrites.
 *    /setup reset  - stored wiring back to the env seed.
 *  Config lives in store.json (see store.js). Env IDs are only a seed.
 *  All panel routing is by stateless customId - no collectors - so a
 *  panel (or an old panel message) keeps working across restarts.
 */
const {
  ActionRowBuilder, EmbedBuilder, RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder, StringSelectMenuBuilder, ChannelType,
} = require('discord.js');
const { LEVEL_LADDER } = require('./config');
const { FACTIONS } = require('./factions');

/* ---------------- stored config shape ---------------- */
function blankHomeConfig() {
  return {
    welcomeChannelId: null,   // greetings + 30-min verification reminder + Welcome Pack post
    verifyChannelId: null,    // the get-verified channel; welcome/reminder text points here
    verifiedRoleId: null,     // role a member gets when verified; gates the reminder system
    modRoleId: null,          // pinged in modChannelId for nudges; can run mod commands
    modChannelId: null,       // PRIVATE mod channel - 2h / 24h nudges go here only
    royaltyRoleId: null,      // OPTIONAL: Swamp Royalty Pass role (x1.5 XP line, +1 loot roll, 8 action points)
    boosterRoleId: null,      // OPTIONAL: booster role (boosters are also detected via Discord boost status)
    questChannelId: null,     // daily quest announcement (+ Booster Pack fallback)
    levelUpChannelId: null,   // level-up announcements (falls back to announce/king/quest)
    announceChannelId: null,  // announcements / auto-events / Booster Pack posts
    kingChannelId: null,      // main King channel (storefront home); announce fallback
    artChannelId: null,       // OPTIONAL: Swamp Art channel (posts there count toward the art quest)
    levelRoleIds: {},         // OPTIONAL: { level: roleId } ladder roles
    factionRoleIds: {},       // OPTIONAL: { factionId: roleId }
  };
}
const CONFIG_KEYS = Object.keys(blankHomeConfig());

/** Merge a patch into a config: known keys only, undefined ignored. Pure. */
function mergeHomeConfig(cfg, patch) {
  const out = Object.assign(blankHomeConfig(), cfg && typeof cfg === 'object' ? cfg : {});
  if (patch && typeof patch === 'object') {
    for (const k of CONFIG_KEYS) if (patch[k] !== undefined) out[k] = patch[k];
  }
  if (!out.levelRoleIds || typeof out.levelRoleIds !== 'object') out.levelRoleIds = {};
  if (!out.factionRoleIds || typeof out.factionRoleIds !== 'object') out.factionRoleIds = {};
  return out;
}

/** Fill only the EMPTY fields of cfg from a seed (the env seed). Never
 *  overwrites a value set in-server. Pure. Returns a new object. */
function seedHomeConfig(cfg, seed) {
  const out = mergeHomeConfig(cfg, {});
  if (!seed || typeof seed !== 'object') return out;
  for (const k of CONFIG_KEYS) {
    if (seed[k] === undefined || seed[k] === null || seed[k] === '') continue;
    if (k === 'levelRoleIds' || k === 'factionRoleIds') {
      if (Object.keys(out[k]).length === 0 && Object.keys(seed[k] || {}).length > 0) out[k] = { ...seed[k] };
    } else if (out[k] === null || out[k] === '') {
      out[k] = seed[k];
    }
  }
  return out;
}

/* ---------------- field catalogue ----------------
 * kind: 'role' | 'channel'. Pages group fields for the panel so no
 * message ever exceeds Discord's 5 component rows (selects + nav). */
const SETUP_FIELDS = [
  { key: 'verifiedRoleId', label: 'Verified role', kind: 'role', page: 'core' },
  { key: 'modRoleId', label: 'Mod role', kind: 'role', page: 'core' },
  { key: 'royaltyRoleId', label: 'Swamp Royalty Pass role', kind: 'role', page: 'core' },
  { key: 'boosterRoleId', label: 'Booster role (optional)', kind: 'role', page: 'core' },
  { key: 'welcomeChannelId', label: 'Welcome channel', kind: 'channel', page: 'channels' },
  { key: 'verifyChannelId', label: 'Get-verified channel', kind: 'channel', page: 'channels' },
  { key: 'modChannelId', label: 'Mod-chat channel (private)', kind: 'channel', page: 'channels' },
  { key: 'kingChannelId', label: 'Main King channel', kind: 'channel', page: 'channels' },
  { key: 'announceChannelId', label: 'Announce channel', kind: 'channel', page: 'more' },
  { key: 'questChannelId', label: 'Daily-quest channel', kind: 'channel', page: 'more' },
  { key: 'levelUpChannelId', label: 'Level-up channel', kind: 'channel', page: 'more' },
  { key: 'artChannelId', label: 'Swamp Art channel', kind: 'channel', page: 'more' },
];
const PANEL_PAGES = [
  { id: 'core', label: 'Roles' },
  { id: 'channels', label: 'Gate + court channels' },
  { id: 'more', label: 'Posting channels' },
  { id: 'levels', label: 'Level roles' },
  { id: 'levels2', label: 'Level roles (top end)' },
  { id: 'factions', label: 'Faction roles' },
];
const fieldByKey = (key) => SETUP_FIELDS.find(f => f.key === key) || null;

/** Config keys still unset (level/faction maps count by their entries). */
function missingFields(cfg) {
  const c = mergeHomeConfig(cfg, {});
  const missing = SETUP_FIELDS.filter(f => !c[f.key]).map(f => f.label);
  for (const rung of LEVEL_LADDER) if (!c.levelRoleIds[String(rung.level)]) missing.push(`Level role: ${rung.name} (${rung.level})`);
  for (const f of FACTIONS) if (!c.factionRoleIds[f.id]) missing.push(`Faction role: ${f.name}`);
  return missing;
}

/** The verification-reminder system is live only when BOTH halves exist. */
function verificationEnabled(cfg) {
  return !!(cfg && cfg.verifiedRoleId && cfg.modChannelId);
}

/* ---------------- /setup show summary ---------------- */
function setupSummary(cfg) {
  const c = mergeHomeConfig(cfg, {});
  const fmt = (f) => !c[f.key] ? '`not set`' : (f.kind === 'role' ? `<@&${c[f.key]}>` : `<#${c[f.key]}>`);
  const rows = SETUP_FIELDS.map(f => `• **${f.label}:** ${fmt(f)}`);
  const lvlRows = LEVEL_LADDER.map(r => `• **Level ${r.level} - ${r.name}:** ${c.levelRoleIds[String(r.level)] ? `<@&${c.levelRoleIds[String(r.level)]}>` : '`not set`'}`);
  const facRows = FACTIONS.map(f => `• **${f.name}:** ${c.factionRoleIds[f.id] ? `<@&${c.factionRoleIds[f.id]}>` : '`not set`'}`);
  return [
    '🐊 **Crocodile King setup for THE SWAMP**',
    ...rows,
    '',
    '**Level roles**',
    ...lvlRows,
    '',
    '**Faction roles**',
    ...facRows,
    '',
    `**Verification reminders:** ${verificationEnabled(c) ? 'ON - 30 min (member), 2h + 24h (private mod nudges), Welcome Pack on verify' : 'OFF - set BOTH the Verified role and the Mod-chat channel to switch it on'}`,
    '**Core commands** (/profile, /daily, /quest, /store, /trivia...) work with zero setup - unset pieces just skip quietly.',
    'Wire more any time with **/setup panel** (pick what the server already has) or **/setup create** (the King builds only what is missing).',
  ].join('\n');
}

/* ---------------- the panel ----------------
 * Stateless customIds:
 *   setup:page                 (string select - page jump)
 *   setup:role:<configKey>     (RoleSelectMenu)
 *   setup:chan:<configKey>     (ChannelSelectMenu)
 *   setup:lvl:<level>          (RoleSelectMenu -> levelRoleIds[level])
 *   setup:fac:<factionId>      (RoleSelectMenu -> factionRoleIds[factionId])
 */
function parseSetupCustomId(customId) {
  if (!customId || typeof customId !== 'string') return null;
  const parts = customId.split(':');
  if (parts[0] !== 'setup' || parts.length < 2) return null;
  if (parts[1] === 'page' && parts.length === 2) return { type: 'page' };
  if (parts[1] === 'role' && parts.length === 3 && fieldByKey(parts[2]) && fieldByKey(parts[2]).kind === 'role') {
    return { type: 'pick', kind: 'role', key: parts[2] };
  }
  if (parts[1] === 'chan' && parts.length === 3 && fieldByKey(parts[2]) && fieldByKey(parts[2]).kind === 'channel') {
    return { type: 'pick', kind: 'channel', key: parts[2] };
  }
  if (parts[1] === 'lvl' && parts.length === 3 && LEVEL_LADDER.some(r => String(r.level) === parts[2])) {
    return { type: 'pick', kind: 'level', level: parts[2] };
  }
  if (parts[1] === 'fac' && parts.length === 3 && FACTIONS.some(f => f.id === parts[2])) {
    return { type: 'pick', kind: 'faction', factionId: parts[2] };
  }
  return null;
}

/** Turn a parsed panel pick + the picked Discord ID into a config patch. Pure. */
function patchForPick(parsed, pickedId) {
  if (!parsed || parsed.type !== 'pick' || !pickedId) return null;
  if (parsed.kind === 'role' || parsed.kind === 'channel') return { [parsed.key]: pickedId };
  if (parsed.kind === 'level') return { levelRoleIds: { [parsed.level]: pickedId } }; // merged by caller (nested)
  if (parsed.kind === 'faction') return { factionRoleIds: { [parsed.factionId]: pickedId } }; // merged by caller (nested)
  return null;
}

function statusLine(label, id, kind) {
  if (!id) return `⬜ **${label}:** not set`;
  return `✅ **${label}:** ${kind === 'role' ? `<@&${id}>` : `<#${id}>`}`;
}

function roleSelect(customId, label, currentId) {
  const m = new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(`Pick: ${label}`).setMinValues(1).setMaxValues(1);
  if (currentId) { try { m.setDefaultRoles([currentId]); } catch { /* stale ID - leave unset */ } }
  return new ActionRowBuilder().addComponents(m);
}
function channelSelect(customId, label, currentId) {
  const m = new ChannelSelectMenuBuilder().setCustomId(customId).setPlaceholder(`Pick: ${label}`)
    .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement]).setMinValues(1).setMaxValues(1);
  if (currentId) { try { m.setDefaultChannels([currentId]); } catch { /* stale ID - leave unset */ } }
  return new ActionRowBuilder().addComponents(m);
}
function pageNavRow(currentPage) {
  const sel = new StringSelectMenuBuilder().setCustomId('setup:page').setPlaceholder('Jump to another setup page')
    .addOptions(PANEL_PAGES.map(p => ({ label: p.label, value: p.id, default: p.id === currentPage })));
  return new ActionRowBuilder().addComponents(sel);
}

/** Build one panel page: { embeds, components }. */
function buildPanel(cfg, pageId = 'core') {
  const c = mergeHomeConfig(cfg, {});
  const page = PANEL_PAGES.some(p => p.id === pageId) ? pageId : 'core';
  const rows = [];
  const lines = [];
  if (page === 'levels' || page === 'levels2') {
    const rungs = page === 'levels' ? LEVEL_LADDER.slice(0, 4) : LEVEL_LADDER.slice(4);
    for (const r of rungs) {
      lines.push(statusLine(`Level ${r.level} - ${r.name} role`, c.levelRoleIds[String(r.level)], 'role'));
      rows.push(roleSelect(`setup:lvl:${r.level}`, `Level ${r.level} ${r.name} role`, c.levelRoleIds[String(r.level)]));
    }
  } else if (page === 'factions') {
    for (const f of FACTIONS) {
      lines.push(statusLine(`${f.name} role`, c.factionRoleIds[f.id], 'role'));
      rows.push(roleSelect(`setup:fac:${f.id}`, `${f.name} role`, c.factionRoleIds[f.id]));
    }
  } else {
    for (const f of SETUP_FIELDS.filter(x => x.page === page)) {
      lines.push(statusLine(f.label, c[f.key], f.kind));
      rows.push(f.kind === 'role'
        ? roleSelect(`setup:role:${f.key}`, f.label, c[f.key])
        : channelSelect(`setup:chan:${f.key}`, f.label, c[f.key]));
    }
  }
  const missing = missingFields(c);
  const pageDef = PANEL_PAGES.find(p => p.id === page);
  const embed = new EmbedBuilder()
    .setTitle(`🐊 Crocodile King setup - ${pageDef.label}`)
    .setColor(0x2e7d32)
    .setDescription([
      'Pick from what this server ALREADY has - funky names and all. Every pick saves the second you make it. Nothing gets renamed, nothing gets rebuilt.',
      '',
      ...lines,
      '',
      missing.length
        ? `**Still missing overall (${missing.length}):** ${missing.slice(0, 8).join(' · ')}${missing.length > 8 ? ' · …' : ''}\nMissing pieces just stay quiet - or run **/setup create** and the King builds only those, with default names.`
        : '**Everything is wired.** The swamp hums. 👑',
    ].join('\n'))
    .setFooter({ text: 'Setup lives in the bot\'s book - it survives restarts. /setup show lists the whole wiring.' });
  rows.push(pageNavRow(page));
  return { embeds: [embed], components: rows };
}

/* ---------------- /setup create planner (PURE) ----------------
 * Decides what create does, given the current config and what already
 * exists in the guild BY DEFAULT NAME. Returns ordered steps (roles
 * first, because channel overwrites reference them):
 *   { kind:'role'|'channel', field, name, action:'create'|'adopt'|'skip',
 *     id (for adopt), spec (for create) }
 * Configured fields skip. Existing-by-default-name get ADOPTED (their ID
 * is saved) - never renamed, never overwritten. Only true gaps create.
 * Channel overwrite descriptors are symbolic ({who:'everyone'|'verified'|
 * 'mod'|'bot'}) - the executor resolves them to real IDs at create time,
 * after the role steps have run. */
const SWAMP_GREEN = 0x2e7d32;
const ROYAL_GOLD = 0xf1c40f;
const CREATE_DEFAULTS = [
  {
    kind: 'role', field: 'verifiedRoleId', name: 'Verified',
    roleSpec: { color: SWAMP_GREEN, hoist: true, mentionable: false },
  },
  {
    kind: 'role', field: 'royaltyRoleId', name: 'Swamp Royalty Pass',
    roleSpec: { color: ROYAL_GOLD, hoist: true, mentionable: false },
  },
  {
    kind: 'channel', field: 'verifyChannelId', name: 'get-verified',
    channelSpec: {
      topic: 'Get verified here - a Server Mod stamps you, the King does the rest.',
      rateLimitPerUser: 60,
      overwrites: [
        { who: 'everyone', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], deny: ['AttachFiles'] },
        { who: 'verified', deny: ['ViewChannel'] }, // once stamped, the gate channel politely disappears
        { who: 'mod', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages'] },
        { who: 'bot', allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'] },
      ],
    },
  },
  {
    kind: 'channel', field: 'modChannelId', name: 'mod-chat',
    channelSpec: {
      topic: 'Mods only. The King\'s waiting-list nudges land here.',
      overwrites: [
        { who: 'everyone', deny: ['ViewChannel'] }, // PRIVATE - the whole point of this channel
        { who: 'mod', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
        { who: 'bot', allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'] },
      ],
    },
  },
  {
    kind: 'channel', field: 'questChannelId', name: 'daily-quests',
    channelSpec: {
      topic: 'The King\'s daily board. New quest every morning.',
      overwrites: [
        { who: 'everyone', deny: ['ViewChannel'] },
        { who: 'verified', allow: ['ViewChannel', 'ReadMessageHistory', 'AddReactions'], deny: ['SendMessages'] },
        { who: 'mod', allow: ['ViewChannel', 'SendMessages'] },
        { who: 'bot', allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory', 'AddReactions'] },
      ],
    },
  },
  {
    kind: 'channel', field: 'kingChannelId', name: 'crocodile-king',
    channelSpec: {
      topic: 'The King\'s court. Commands here; the storefront board gets posted and pinned here.',
      overwrites: [
        { who: 'everyone', allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] }, // see the shop, want in
        { who: 'verified', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'UseApplicationCommands', 'EmbedLinks', 'AttachFiles', 'AddReactions'] },
        { who: 'mod', allow: ['ViewChannel', 'SendMessages'] },
        { who: 'bot', allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions'] },
      ],
    },
  },
  {
    kind: 'channel', field: 'levelUpChannelId', name: 'level-ups',
    channelSpec: {
      topic: 'Level-up celebrations. The King keeps the receipts.',
      overwrites: [
        { who: 'everyone', deny: ['ViewChannel'] },
        { who: 'verified', allow: ['ViewChannel', 'ReadMessageHistory', 'AddReactions'], deny: ['SendMessages'] },
        { who: 'mod', allow: ['ViewChannel', 'SendMessages'] },
        { who: 'bot', allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory', 'AddReactions'] },
      ],
    },
  },
];

/**
 * @param {object} cfg current effective config
 * @param {object} existing { rolesByName: {name:id}, channelsByName: {name:id} }
 * @returns {Array} ordered steps, roles before channels
 */
function planSetupCreations(cfg, existing) {
  const c = mergeHomeConfig(cfg, {});
  const rolesByName = (existing && existing.rolesByName) || {};
  const channelsByName = (existing && existing.channelsByName) || {};
  const steps = [];
  for (const def of CREATE_DEFAULTS) {
    const step = { kind: def.kind, field: def.field, name: def.name };
    if (c[def.field]) {
      steps.push({ ...step, action: 'skip', reason: 'already configured' });
      continue;
    }
    const found = def.kind === 'role' ? rolesByName[def.name] : channelsByName[def.name];
    if (found) {
      steps.push({ ...step, action: 'adopt', id: found });
      continue;
    }
    steps.push({ ...step, action: 'create', spec: def.kind === 'role' ? def.roleSpec : def.channelSpec });
  }
  return steps;
}

module.exports = {
  blankHomeConfig, mergeHomeConfig, seedHomeConfig, CONFIG_KEYS,
  SETUP_FIELDS, PANEL_PAGES, fieldByKey, missingFields, verificationEnabled,
  setupSummary, parseSetupCustomId, patchForPick, buildPanel,
  CREATE_DEFAULTS, planSetupCreations,
};
