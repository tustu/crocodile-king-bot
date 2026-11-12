'use strict';
/**
 * Crocodile King - host, referee and engagement engine for THE SWAMP.
 * Not a generic AI-chat bot: he greets, verifies, runs quests/events,
 * tracks XP with bonuses, and hosts sponsor quests.
 */
const http = require('http');
const {
  Client, GatewayIntentBits, Partials, Events, EmbedBuilder,
  PermissionFlagsBits, ActivityType, AttachmentBuilder, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  REST, Routes,
} = require('discord.js');
const { buildCommands } = require('./deploy-commands');
const { config, ladderTitleFor, envSeedConfig } = require('./config');
const { Store } = require('./store');
const setupLib = require('./setup');
const xpLib = require('./xp');
const { line } = require('./lines');
const content = require('./content');
const { termsHtml, privacyHtml } = require('./legal');
const factionsLib = require('./factions');
const lootLib = require('./loot');
const titlesLib = require('./titles');
const questgenLib = require('./questgen');
const shopLib = require('./shop');
const avatarLib = require('./avatarframe');
const backgroundsLib = require('./backgrounds');
const storefrontLib = require('./storefront');
const profileLib = require('./profilecard');
const petsLib = require('./pets');
const bucksMod = require('./bucksbridge');
const bucksBridge = bucksMod.bridge; // Swamp Bucks Bridge (off unless SWAMP_BUCKS_API_BASE + SWAMP_BUCKS_SECRET are set)

const store = new Store();
const tz = config.timezone;

/* ---------------- v2.2 stored config: env seeds, /setup rules ----------------
 * The wiring (channels/roles) lives in store.json. At boot the env IDs
 * fill only the fields still blank; every helper below reads the imported
 * `config` object, so applyEffectiveConfig() copies the stored (winning)
 * values over it - once at boot, and again after every /setup change so
 * picks take effect live, no restart. */
const ENV_SEED = envSeedConfig();
store.seedConfig(ENV_SEED);
store.save();
function applyEffectiveConfig() {
  const eff = store.getConfig();
  for (const k of setupLib.CONFIG_KEYS) config[k] = eff[k];
  return eff;
}
applyEffectiveConfig();

/* ---------------- health server (Hugging Face Spaces style) ---------------- */
const health = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, bot: 'Crocodile King', uptime: process.uptime() }));
  } else if (req.url === '/terms') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(termsHtml);
  } else if (req.url === '/privacy') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(privacyHtml);
  } else { res.writeHead(404); res.end('not found'); }
});
health.listen(config.port, () => console.log(`[health] listening on ${config.port}`));

/* ---------------- boot-time network probe (diagnostic) ----------------
 * Fire-and-forget: runs once shortly after startup to show, from inside
 * the hosting network, exactly which hosts are reachable. Discord login
 * kept dying with "Client network socket disconnected before secure TLS
 * connection was established" - this probe names which hosts fail and
 * which answer, so the dead hop identifies itself. It must never block
 * or delay the login retry loop, and it can never crash the process:
 * everything is wrapped, and per-request failures are logged, not thrown. */
setTimeout(() => {
  (async () => {
    const probeUrls = [
      'https://discord.com/api/v10/gateway',
      'https://canary.discord.com/api/v10/gateway',
      'https://ptb.discord.com/api/v10/gateway',
      'https://gateway.discord.gg',
      'https://cdn.discordapp.com',
      'https://example.com',
      'https://api.github.com',
    ];
    try {
      console.log('[netprobe] starting');
      for (const url of probeUrls) {
        const startedAt = Date.now();
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 15000);
          try {
            const res = await fetch(url, { signal: ctrl.signal });
            console.log(`[netprobe] ${url} -> HTTP ${res.status} in ${Date.now() - startedAt}ms`);
            try { await res.body?.cancel(); } catch { /* socket cleanup only */ }
          } finally {
            clearTimeout(timer);
          }
        } catch (e) {
          const msg = (e && e.cause && e.cause.message) ? e.cause.message : ((e && e.message) || String(e));
          console.log(`[netprobe] ${url} FAILED: ${msg}`);
        }
      }
      console.log('[netprobe] done');
    } catch (e) {
      try { console.log(`[netprobe] FAILED: ${(e && e.message) || e}`); } catch { /* never crash */ }
    }
  })().catch(() => {});
}, 1000).unref?.();

/* ---------------- helpers ---------------- */
const warn = (what, idName) => console.warn(`[crocodile-king] ${what} skipped: ${idName} is not set - wire it in the server with /setup panel (or seed it in .env)`);

async function fetchChannel(id, idName) {
  if (!id) { warn('channel fetch', idName); return null; }
  try { return await client.channels.fetch(id); } catch (e) { console.warn(`[crocodile-king] could not fetch channel ${idName}: ${e.message}`); return null; }
}

/* ------- welcome channel resolution (owner fix 2026-11-11) -------
 * The wired welcome channel can exist yet refuse the King's posts
 * (DiscordAPIError 50001 Missing Access: a locked channel keeps its
 * own permission list, separate from his server-wide role). Resolving
 * "a channel is set" was never the same as "he can post there", so
 * resolve a channel he can ACTUALLY post in, in this order:
 *   1. the /setup-wired channel, if postable
 *   2. the server's own system channel (where Discord posts joins)
 *   3. an existing channel named like the welcome door (new-members / welcome)
 *   4. the channel the command was run in (admin standing in the door)
 * No channel is ever created or renamed here - existing rooms only. */
function canPostTo(channel, guild) {
  try {
    if (!channel || !channel.isTextBased || !channel.isTextBased()) return false;
    const me = guild && guild.members ? guild.members.me : null;
    if (!me) return false;
    const perms = channel.permissionsFor(me);
    return !!(perms && perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages));
  } catch (e) { return false; }
}

async function resolveWelcomeChannel(guild, currentChannel) {
  if (!guild) return null;
  const tried = new Set();
  const attempt = async (channel, source) => {
    if (!channel || tried.has(channel.id)) return null;
    tried.add(channel.id);
    if (canPostTo(channel, guild)) return { channel, source };
    console.warn(`[crocodile-king] welcome candidate #${channel.name || '?'} (${channel.id}) via ${source}: King cannot post there - trying next`);
    return null;
  };
  if (config.welcomeChannelId) {
    const wired = await fetchChannel(config.welcomeChannelId, 'WELCOME_CHANNEL_ID').catch(() => null);
    const hit = await attempt(wired, 'setup pick');
    if (hit) return hit;
  }
  { const hit = await attempt(guild.systemChannel, 'server system channel'); if (hit) return hit; }
  const named = guild.channels.cache
    .filter(c => c && c.isTextBased && c.isTextBased() && /new[- ]?members|welcome/i.test(c.name || ''))
    .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
    .first();
  { const hit = await attempt(named, 'name match'); if (hit) return hit; }
  if (currentChannel) { const hit = await attempt(currentChannel, 'command channel'); if (hit) return hit; }
  return null;
}

/* If a fallback found the working door, write it back as the wiring so
 * the next boot and the next join use it directly. */
function healWelcomeChannel(resolved) {
  if (!resolved || !resolved.channel) return;
  if (config.welcomeChannelId === resolved.channel.id) return;
  try {
    store.setConfig({ welcomeChannelId: resolved.channel.id });
    applyEffectiveConfig();
    console.log(`[crocodile-king] welcome channel wiring set to #${resolved.channel.name} (${resolved.channel.id}) via ${resolved.source}`);
  } catch (e) { console.warn('[crocodile-king] welcome channel self-heal failed:', e.message); }
}

function hasRole(member, roleId) {
  if (!member || !roleId) return false;
  return member.roles.cache.has(roleId);
}
function isVerifiedMember(member) {
  if (!member) return false;
  if (config.verifiedRoleId) return hasRole(member, config.verifiedRoleId);
  const rec = store.data.users[member.id];
  return !!(rec && rec.verified); // fallback if no role configured
}
function isBoosterMember(member) {
  if (!member) return false;
  if (config.boosterRoleId && hasRole(member, config.boosterRoleId)) return true;
  return !!member.premiumSince; // Discord sets this for server boosters
}
/* --- v2 premium: Swamp Royalty Pass role OR an active timed VIP Pass --- */
function isPassActive(userRec) { return !!(userRec && userRec.passUntil && userRec.passUntil > Date.now()); }
function isRoyaltyRole(member) { return hasRole(member, config.royaltyRoleId); }
/** Premium = royalty role or timed pass. Drives the x1.5 XP line, +1 loot roll, 8 action points. */
function isPremium(member, userRec) { return isRoyaltyRole(member) || isPassActive(userRec); }

function memberContext(member, userRec, channelId) {
  const pass = isPassActive(userRec);
  return {
    isVerified: isVerifiedMember(member),
    isBooster: isBoosterMember(member),
    isRoyalty: isRoyaltyRole(member),
    hasPass: pass, // xp.js: same x1.5 as royalty, own label, never stacks with royalty
    joinedAt: member && member.joinedAt ? member.joinedAt : (userRec.joinedAt || undefined),
    streak: userRec.streak || 0,
    eventActive: isChannelBonusActive(channelId),
  };
}

/* --- v2 action points: base 5/day, premium (role or timed pass) 8/day, Halifax reset.
       Only /trivia and /gator cost points (1 each). Everything else is free. --- */
const ACTION_POINTS_BASE = 5;
const ACTION_POINTS_PREMIUM = 8;
function ensureActionPoints(rec, member) {
  const today = xpLib.dateKeyInHalifax(new Date(), tz);
  const max = isPremium(member, rec) ? ACTION_POINTS_PREMIUM : ACTION_POINTS_BASE;
  if (rec.actionDayKey !== today) { rec.actionDayKey = today; rec.actionPoints = max; }
  if (typeof rec.actionPoints !== 'number') rec.actionPoints = max;
  return rec.actionPoints;
}
function spendActionPoint(rec, member) {
  ensureActionPoints(rec, member);
  if (rec.actionPoints <= 0) return false;
  rec.actionPoints -= 1;
  return true;
}
function actionPointRefillLine(rec, member) {
  return isPremium(member, rec)
    ? 'You are out of action points for today, and you get the big refill (8, pass perks) at Halifax midnight.'
    : 'You are out of action points for today. They refill at Halifax midnight - and pass holders (Swamp Royalty role or a timed VIP Pass) get 8 a day instead of 5.';
}

/* --- v2 small helpers: rep, loot, side-quest progress --- */
function addRep(rec, amount) { rec.rep = (rec.rep || 0) + (amount || 0); return rec.rep; }
/** Roll loot into a record's inventory. Premium members get +1 extra roll wherever a roll happens. */
function grantLoot(rec, member, rolls = 1) {
  const total = Math.max(0, rolls) + (isPremium(member, rec) ? 1 : 0);
  const items = lootLib.rollLootMany(total);
  for (const name of items) lootLib.addItem(rec, name);
  return items;
}
function lootText(items) { return items.length ? items.join(', ') : 'nothing but mud'; }
/* --- Booster Pack: once per Halifax calendar month while boosting ---
 * Contents: +100 Bucks, +1 Raid Pass, 2 loot rolls, +5 Rep, and the one-time
 * "Swamp Booster" cosmetic title. Detection happens on member update and in
 * the scheduler sweep; the lastBoostPackMonth gate makes double-pay impossible. */
const BOOSTER_PACK = { bucks: 100, raidPasses: 1, lootRolls: 2, rep: 5 };
async function maybeAwardBoosterPack(member) {
  if (!member || member.user.bot) return false;
  if (!isBoosterMember(member)) return false;
  const rec = store.user(member.id);
  if (!lootLib.boosterPackEligible(rec, true, new Date(), tz)) return false;
  rec.lastBoostPackMonth = lootLib.monthKeyInHalifax(new Date(), tz);
  const monthName = lootLib.monthNameInHalifax(new Date(), tz);
  await bucksBridge.adjust(rec, BOOSTER_PACK.bucks, 'booster pack');
  lootLib.addItem(rec, lootLib.RAID_PASS, BOOSTER_PACK.raidPasses);
  const items = lootLib.rollLootMany(BOOSTER_PACK.lootRolls);
  for (const name of items) lootLib.addItem(rec, name);
  addRep(rec, BOOSTER_PACK.rep);
  const newTitle = titlesLib.unlockAchievement(rec, 'booster');
  store.save();
  const packText = line('boosterPack', { member: `<@${member.id}>`, month: monthName }, Date.now())
    + `\n🎁 **Loot:** ${lootText(items)}${newTitle ? `\n✨ Cosmetic title unlocked: **${newTitle}**` : ''}`;
  const chId = config.announceChannelId || config.kingChannelId || config.questChannelId;
  const ch = chId ? await fetchChannel(chId, 'ANNOUNCE_CHANNEL_ID') : null;
  if (ch && ch.isTextBased()) await ch.send(packText).catch(() => {});
  // NO DMS, EVER (owner rule, 2026-11-08): the King lives in the server only.
  // He never messages members privately - the pack is announced in the
  // server above and shows on /profile. There is no DM code path in this bot.
  return true;
}

async function boosterSweep() {
  if (!config.guildId) return;
  let guild;
  try { guild = await client.guilds.fetch(config.guildId); } catch { return; }
  try { await guild.members.fetch(); } catch { /* cache may be partial - still workable */ }
  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;
    await maybeAwardBoosterPack(member).catch(() => {});
  }
}

function bumpSideQuest(rec, type, amount = 1) {
  if (rec.sideQuest && rec.sideQuest.type === type) {
    rec.sideQuest.progress = Math.min(rec.sideQuest.target, (rec.sideQuest.progress || 0) + amount);
  }
}
function multiplierFor(member, userRec, channelId) {
  return xpLib.computeMultiplier(memberContext(member, userRec, channelId));
}
function breakdownText(m) {
  if (!m.breakdown.length) return 'No bonuses active - base x1. (Verify for +25%, it\'s free mud.)';
  const parts = m.breakdown.map(b => `${b.label} x${b.factor}`);
  return parts.join(' · ') + ` = **x${m.multiplier}**` + (m.capped ? ` (raw x${m.rawMultiplier.toFixed(2)}, capped at x3, the King's house cap)` : '');
}

/* Active channel bonuses: events + sponsor quests */
const activeEvents = new Map(); // channelId -> { kind, hp, maxHp, participants:Set, messageId, startedBy }
let activeSponsorQuestId = null;
function isChannelBonusActive(channelId) {
  if (channelId && activeEvents.has(channelId)) return true;
  const sq = store.data.sponsorQuests.find(q => q.id === activeSponsorQuestId && q.active);
  return !!sq; // an active sponsor quest turns on the 2x bonus swamp-wide until completed/stopped
}

/* Pending mini-games: key `${channelId}:${userId}` -> { type:'trivia'|'gator', answer(s), expiresAt } */
const pendingGames = new Map();

/* ---------------- XP awarding (single path for everything) ---------------- */
async function awardXp(userId, baseXp, opts = {}) {
  const rec = store.user(userId);
  let member = opts.member || null;
  if (!member && config.guildId) {
    try { const g = await client.guilds.fetch(config.guildId); member = await g.members.fetch(userId).catch(() => null); } catch { /* ignore */ }
  }
  const m = opts.multiplierObj || multiplierFor(member, rec, opts.channelId);
  const gained = xpLib.applyMultiplier(baseXp, m.multiplier);
  const before = xpLib.levelFromXp(rec.xp).level;
  rec.xp += gained;
  const after = xpLib.levelFromXp(rec.xp).level;
  rec.level = after;
  // Faction pool: the award's RAW BASE XP (pre-multiplier) feeds the member's
  // faction for this ISO week + all-time. See factions.js for the ruling.
  if (rec.faction) factionsLib.addFactionXp(store.data, rec.faction, baseXp);
  let bucksGained = 0;
  const levelsGained = [];
  for (let l = before + 1; l <= after; l++) { bucksGained += xpLib.bucksForLevel(l); levelsGained.push(l); }
  if (bucksGained) await bucksBridge.adjust(rec, bucksGained, 'level up');
  // v2: one loot roll per level gained (premium members roll one extra), and
  // the level-5 generated cosmetic title mints itself when first reached.
  let lootGained = [];
  if (levelsGained.length) {
    lootGained = grantLoot(rec, member, levelsGained.length);
    titlesLib.mintGeneratedTitle(rec, after);
  }
  store.save();

  if (levelsGained.length) {
    // Level roles (only if IDs configured - never crash if unset)
    if (member) {
      for (const l of levelsGained) {
        const roleId = config.levelRoleIds[String(l)];
        if (roleId) { try { await member.roles.add(roleId); } catch (e) { console.warn('[crocodile-king] level role add failed:', e.message); } }
      }
    }
    const chId = config.levelUpChannelId || config.announceChannelId || config.kingChannelId || opts.channelId;
    const ch = chId ? await fetchChannel(chId, 'LEVELUP_CHANNEL_ID') : null;
    if (ch && ch.isTextBased()) {
      for (const l of levelsGained) {
        await ch.send(line('levelUp', {
          member: `<@${userId}>`, level: l, title: ladderTitleFor(l), bucks: xpLib.bucksForLevel(l),
        }, l) + (lootGained.length ? `\n🎁 **Loot from the level-up chest:** ${lootText(lootGained)}` : '')
        + (l === 5 && rec.generatedTitle ? `\n✨ Level 5 mints your personal cosmetic title: **${rec.generatedTitle}**. See /title.` : '')).catch(() => {});
      }
    }
  }
  return { gained, multiplier: m, newLevel: after, levelsGained, bucksGained, lootGained };
}

function resetQuestIfNewDay(rec) {
  const today = xpLib.dateKeyInHalifax(new Date(), tz);
  if (rec.questDayKey !== today) {
    rec.questDayKey = today;
    rec.questProgress = { messages: 0, voiceMinutes: 0, reactions: 0, artPosts: 0, triviaCorrect: 0 };
  }
  return content.questForDate(today);
}

/* ---------------- network: Discord connect timeout ----------------
 * undici (the fetch stack discord.js rides on) defaults to a 10s
 * connect timeout, which proved too tight on the hosting network:
 * login failed with "Connect Timeout Error" on every boot even with
 * a good token. Give the global dispatcher a 60s connect timeout
 * BEFORE the client exists. Guarded on purpose: a failure here must
 * never stop the bot, it just falls back to the defaults. */
try {
  const { setGlobalDispatcher, Agent } = require('undici');
  setGlobalDispatcher(new Agent({ connect: { timeout: 60000 }, keepAliveTimeout: 30000 }));
  console.log('[crocodile-king] network dispatcher set (60s connect timeout)');
} catch (e) {
  console.error('[crocodile-king] could not set network dispatcher, continuing with defaults:', e.message);
}

/* ---------------- REST API base (switchable by env) ----------------
 * discord.js rides on https://discord.com/api by default for the login
 * gateway fetch, command registration and every API call. The live
 * probe showed discord.com itself hangs/resets from the hosting
 * network while Discord's official alternate API hosts
 * (canary.discord.com, ptb.discord.com) answer - so the base is
 * switchable with no code change: REST_API_BASE=https://canary.discord.com/api */
const REST_API_BASE = (process.env.REST_API_BASE || 'https://discord.com/api').replace(/\/+$/, '');
console.log(`[crocodile-king] REST API base: ${REST_API_BASE}`);

/* ---------------- client ---------------- */
const client = new Client({
  rest: { api: REST_API_BASE },
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,      // privileged: Server Members
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,    // privileged: Message Content
    GatewayIntentBits.GuildPresences,    // privileged: Presence (portal: ON) - profile mood aura + pet sleep state
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

/* ---------------- slash commands: auto-register on boot ----------------
 * Hosted deploys (Hugging Face) have no shell to run deploy-commands.js,
 * so the King registers his own commands on first login - guild-scoped
 * when GUILD_ID is set (instant, suits launch testing). Idempotent (PUT
 * replaces the guild set). If registration fails it retries every 60s
 * until it lands, for as long as the client stays logged in; a failure
 * is logged, never fatal. */
let commandsRegistered = false;
let registrationLoopRunning = false;
async function autoRegisterCommands() {
  if (commandsRegistered || registrationLoopRunning) return;
  if (!config.guildId) {
    console.log('[crocodile-king] GUILD_ID is not set - slash commands NOT registered this boot. Set GUILD_ID and restart, or run: npm run deploy-commands');
    return;
  }
  if (!config.clientId) {
    console.error('[crocodile-king] CLIENT_ID is not set - slash commands NOT registered (registration needs the application ID).');
    return;
  }
  registrationLoopRunning = true;
  try {
    const body = buildCommands();
    const rest = new REST({ version: '10', timeout: 60000, api: REST_API_BASE }).setToken(config.token);
    let attempt = 0;
    while (!commandsRegistered) {
      if (!client.isReady()) return;
      attempt++;
      try {
        await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
        commandsRegistered = true;
        console.log(`[crocodile-king] registered ${body.length} slash commands to guild ${config.guildId}`);
      } catch (e) {
        console.error(`[crocodile-king] slash command registration attempt ${attempt} FAILED (bot stays online, retrying in 60s):`, e.message);
        await new Promise(r => setTimeout(r, 60000));
      }
    }
  } catch (e) {
    console.error('[crocodile-king] slash command registration FAILED (bot stays online):', e.message);
  } finally {
    registrationLoopRunning = false;
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[crocodile-king] online as ${c.user.tag}`);
  c.user.setActivity('the swamp gate | /profile', { type: ActivityType.Watching });
  // Profile banner: if his profile has none, set it from the bundled banner
  // art (assets/profile-banner.jpg, the King on his throne). One attempt per
  // boot, failures only logged - a missing banner must never stop the King.
  if (!c.user.banner) {
    try {
      const path = require('path');
      await c.user.setBanner(path.join(__dirname, '..', 'assets', 'profile-banner.jpg'));
      console.log('[crocodile-king] profile banner set from assets/profile-banner.jpg');
    } catch (e) { console.warn('[crocodile-king] profile banner set failed:', e.message); }
  }
  await autoRegisterCommands();
  if (!config.verifiedRoleId) warn('verification tracking (role mode)', 'VERIFIED_ROLE_ID');
  if (!config.modChannelId) warn('mod nudges', 'MOD_CHANNEL_ID');
  if (!config.welcomeChannelId) warn('welcome messages', 'WELCOME_CHANNEL_ID');
  setInterval(unverifiedSweep, 60 * 1000);
  setInterval(boosterSweep, 60 * 1000);
  setInterval(voiceTick, 60 * 1000);
  setInterval(questAnnouncementSweep, 60 * 1000);
  if (config.autoEvents) setInterval(autoEventSweep, 30 * 60 * 1000);
});

/* ---------------- joined a server: point the admins at /setup ---------------- */
client.on(Events.GuildCreate, async (guild) => {
  // Home edition: the court greeting belongs to THE SWAMP. If GUILD_ID is
  // seeded and this is some other pond, stay silent.
  if (config.guildId && guild.id !== config.guildId) return;
  const text = [
    '🐊 **The Crocodile King has taken the throne in this swamp.** Smile wide - the swamp is watching.',
    '',
    '🎉 **Members:** /profile, /daily, /quest, /store, /trivia and /gator already work. No setup needed to play.',
    '',
    '👑 **Admins, wire the court in - right here, no ID copying, no renaming anything:**',
    '• **/setup panel** - pick this server\'s OWN roles and channels from dropdowns (your funky names are safe - "Server ✦ Mod" and friends plug straight in).',
    '• **/setup create** - missing a Verified role, a mod-chat, a daily-quests channel? The King builds ONLY what is missing, with the right permissions, and leaves everything existing untouched.',
    '• **/setup show** - the whole wiring at a glance, any time.',
    '',
    'Until the Verified role + mod-chat are wired, the gate reminders stay quiet. I did not come to splash. I came to rule.',
  ].join('\n');
  try {
    let target = guild.systemChannel || null;
    if (!target || !target.isTextBased()) {
      target = guild.channels.cache.find(c => c && c.isTextBased() && c.permissionsFor(guild.members.me) && c.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)) || null;
    }
    if (target) await target.send(text).catch(() => {});
  } catch (e) { console.warn('[crocodile-king] guildCreate greeting failed:', e.message); }
});

/* ---------------- welcome + verification ---------------- */
client.on(Events.GuildMemberAdd, async (member) => {
  const rec = store.user(member.id);
  rec.joinedAt = member.joinedAt ? member.joinedAt.getTime() : Date.now();
  rec.verified = isVerifiedMember(member);
  rec.reminderStage = 0;
  store.save();
  const resolvedWelcome = await resolveWelcomeChannel(member.guild, null);
  healWelcomeChannel(resolvedWelcome);
  const ch = resolvedWelcome ? resolvedWelcome.channel : null;
  if (ch) {
    const verifyText = config.verifyChannelId
      ? `head to <#${config.verifyChannelId}> and follow the pinned steps - one step, takes a minute`
      : config.verifyInstructions;
    await ch.send(line('welcome', { member: `<@${member.id}>`, verify: verifyText }, member.id.charCodeAt(0))).catch(() => {});
    // The owner's standing welcome text, word for word, on EVERY join
    // (owner's order 2026-11-10: the /welcomepost route did not land for
    // them, so the text rides the join greeting). A failed send is logged
    // loudly - a silent miss here looks like the King ignoring joins.
    await ch.send(content.WELCOME_POST).catch((e) => console.error('[crocodile-king] welcome post on join failed:', e.message));
  }
});

client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
  if (!isVerifiedMember(oldM) && isVerifiedMember(newM)) await markVerified(newM);
  // Boost detection path 1 of 2: premiumSince just set/changed, or the
  // booster role just appeared. The month gate inside keeps it to one pack.
  const boostStarted = (!oldM.premiumSince && !!newM.premiumSince) || oldM.premiumSinceTime !== newM.premiumSinceTime
    || (config.boosterRoleId && !oldM.roles.cache.has(config.boosterRoleId) && newM.roles.cache.has(config.boosterRoleId));
  if (boostStarted || isBoosterMember(newM)) await maybeAwardBoosterPack(newM).catch(() => {});
});

async function markVerified(member) {
  const rec = store.user(member.id);
  if (rec.verified) return;
  rec.verified = true;
  rec.verifiedAt = Date.now();
  store.save();
  await awardXp(member.id, 50, { member, channelId: config.welcomeChannelId }); // Welcome Pack XP
  await bucksBridge.adjust(rec, 25, 'welcome pack');
  lootLib.addItem(rec, lootLib.RAID_PASS, 1); // Welcome Pack now also carries 1 Raid Pass
  store.save();
  const ch = await fetchChannel(config.welcomeChannelId, 'WELCOME_CHANNEL_ID');
  if (ch && ch.isTextBased()) {
    await ch.send(line('verified', { member: `<@${member.id}>` }, Date.now()) +
      '\n🎁 **Welcome Pack:** +50 XP, +25 Swamp Bucks and **1 Raid Pass** (spend it with /raid to summon an event). Run /daily every day to build your streak.').catch(() => {});
  }
}

/** Scheduler: 30 min member reminder, 2h private mod nudge, 24h mod re-nudge. Mod stages are mod-channel only. */
async function unverifiedSweep() {
  if (!config.guildId) return;
  let guild;
  try { guild = await client.guilds.fetch(config.guildId); } catch { return; }
  const now = Date.now();
  let changed = false;
  for (const rec of Object.values(store.data.users)) {
    if (rec.verified || !rec.joinedAt) continue;
    let member;
    try { member = await guild.members.fetch(rec.userId); } catch { continue; }
    if (!member) continue;
    if (isVerifiedMember(member)) { await markVerified(member); continue; }
    const ageMs = now - rec.joinedAt;
    if (ageMs >= 30 * 60 * 1000 && rec.reminderStage < 1) {
      rec.reminderStage = 1; changed = true;
      const ch = await fetchChannel(config.welcomeChannelId, 'WELCOME_CHANNEL_ID');
      const verifyText = config.verifyChannelId ? `head to <#${config.verifyChannelId}> and follow the pinned steps` : config.verifyInstructions;
      if (ch && ch.isTextBased()) await ch.send(line('reminder30', { member: `<@${rec.userId}>`, verify: verifyText }, now)).catch(() => {});
    } else if (ageMs >= 2 * 60 * 60 * 1000 && rec.reminderStage < 2) {
      rec.reminderStage = 2; changed = true;
      await modNudge('modNudge2h', rec, guild);
    } else if (ageMs >= 24 * 60 * 60 * 1000 && rec.reminderStage < 3) {
      rec.reminderStage = 3; changed = true;
      await modNudge('modRenudge24h', rec, guild);
    }
  }
  if (changed) store.save();
}
async function modNudge(stage, rec, guild) {
  const ch = await fetchChannel(config.modChannelId, 'MOD_CHANNEL_ID');
  if (!ch || !ch.isTextBased()) return;
  let name = rec.userId;
  try { const m = await guild.members.fetch(rec.userId); if (m) name = m.user.username; } catch { /* id is fine */ }
  const ping = config.modRoleId ? `<@&${config.modRoleId}> ` : '';
  await ch.send(ping + line(stage, { name }, Date.now())).catch(() => {});
}

/* ---------------- messages: XP, quests, mini-game answers ---------------- */
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  const rec = store.user(message.author.id);
  if (!rec.joinedAt) rec.joinedAt = message.member && message.member.joinedAt ? message.member.joinedAt.getTime() : Date.now();
  if (!rec.verified && isVerifiedMember(message.member)) { rec.verified = true; }
  rec.totalMessages++;
  // Pet levels up as its owner chats (+1 XP per message while a pet exists)
  if (rec.profile && rec.profile.pet) rec.profile.pet.xp = (rec.profile.pet.xp || 0) + 1;
  const quest = resetQuestIfNewDay(rec);
  rec.questProgress.messages++;
  bumpSideQuest(rec, 'messages');
  const isArt = (config.artChannelId && message.channelId === config.artChannelId) || message.attachments.size > 0;
  if (isArt) { rec.questProgress.artPosts++; bumpSideQuest(rec, 'artPosts'); }

  // Mini-game answers (trivia / gator) take the message as the guess
  const key = `${message.channelId}:${message.author.id}`;
  const game = pendingGames.get(key);
  if (game && game.expiresAt > Date.now()) {
    const guess = message.content.trim().toLowerCase();
    const correct = game.answers.some(a => guess === a || guess.includes(a));
    pendingGames.delete(key);
    if (correct) {
      if (game.type === 'trivia') {
        rec.questProgress.triviaCorrect++;
        bumpSideQuest(rec, 'triviaCorrect');
        addRep(rec, factionsLib.REP_ACTIONS.trivia); // +1 rep for a right trivia answer
      }
      const r = await awardXp(message.author.id, game.type === 'trivia' ? 40 : 50, { member: message.member, channelId: message.channelId });
      await message.reply(`That's the one. The gator spits it back out. +${r.gained} XP (x${r.multiplier.multiplier} with your bonuses). 🐊`).catch(() => {});
    } else {
      await message.reply(game.type === 'trivia'
        ? `Nope. Answer was: **${game.display}**. The Crocodile King awards points for confidence, just not XP.`
        : `Wrong word - the gator keeps it. It was **${game.display}**. Better luck next splash.`).catch(() => {});
    }
    store.save();
    return;
  }

  // Message XP with 60s cooldown
  const now = Date.now();
  if (now - (rec.lastMessageXpAt || 0) >= 60 * 1000) {
    rec.lastMessageXpAt = now;
    await awardXp(message.author.id, 10, { member: message.member, channelId: message.channelId });
  }
  store.save();
});

/* ---------------- reactions: quests + events ---------------- */
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  try { if (reaction.partial) await reaction.fetch(); } catch { return; }
  const rec = store.user(user.id);
  resetQuestIfNewDay(rec);
  rec.questProgress.reactions++;
  bumpSideQuest(rec, 'reactions');
  store.save();

  const channelId = reaction.message.channelId;
  const ev = activeEvents.get(channelId);
  if (ev && reaction.message.id === ev.messageId && reaction.emoji.name === '🐊') {
    ev.participants.add(user.id);
    ev.hp -= 1;
    if (ev.hp <= 0) {
      activeEvents.delete(channelId);
      const names = [...ev.participants].map(id => `<@${id}>`).join(' ');
      const lootLines = [];
      for (const pid of ev.participants) {
        const r = await awardXp(pid, 75, { channelId });
        const pRec = store.user(pid);
        await bucksBridge.adjust(pRec, 30, 'event finish');
        addRep(pRec, factionsLib.REP_ACTIONS.event); // +2 rep for showing up and swinging
        const newTitle = titlesLib.unlockAchievement(pRec, 'firstEvent');
        // 1 loot roll for taking part (premium members roll one extra, in grantLoot)
        let pMember = null;
        try { pMember = reaction.message.guild ? await reaction.message.guild.members.fetch(pid).catch(() => null) : null; } catch { /* best effort */ }
        const items = grantLoot(pRec, pMember, 1);
        if (items.length) lootLines.push(`<@${pid}>: ${lootText(items)}`);
        if (newTitle) lootLines.push(`<@${pid}> unlocked a cosmetic title: **${newTitle}**`);
      }
      store.save();
      await reaction.message.channel.send(`💥 DOWN IT GOES. The ${ev.kind} is finished. ${names} - everybody who swung gets +XP, +30 Swamp Bucks and +2 Rep.${lootLines.length ? `\n🎁 **Event loot:** ${lootLines.join(' · ')}` : ''} The Crocodile King settles all debts.`).catch(() => {});
    }
  }
});

/* ---------------- voice XP tick (per minute) ---------------- */
async function voiceTick() {
  if (!config.guildId) return;
  let guild;
  try { guild = await client.guilds.fetch(config.guildId); } catch { return; }
  for (const [, channel] of guild.channels.cache) {
    if (!channel.isVoiceBased || !channel.isVoiceBased()) continue;
    for (const [, member] of channel.members) {
      if (member.user.bot) continue;
      const rec = store.user(member.id);
      resetQuestIfNewDay(rec);
      rec.questProgress.voiceMinutes++;
      bumpSideQuest(rec, 'voiceMinutes');
      rec.totalVoiceMinutes++;
      await awardXp(member.id, 2, { member, channelId: channel.id });
    }
  }
  store.save();
}

/* ---------------- daily quest announcement ---------------- */
let lastQuestAnnounceKey = null;
async function questAnnouncementSweep() {
  const today = xpLib.dateKeyInHalifax(new Date(), tz);
  if (lastQuestAnnounceKey === today) return;
  lastQuestAnnounceKey = today;
  if (!config.questChannelId) return; // silent if unset, checked once a day
  const ch = await fetchChannel(config.questChannelId, 'QUEST_CHANNEL_ID');
  if (ch && ch.isTextBased()) {
    const q = content.questForDate(today);
    await ch.send(line('dailyQuest', { quest: q.label }, today.length)).catch(() => {});
  }
}
async function autoEventSweep() {
  const chId = config.announceChannelId || config.kingChannelId || config.questChannelId;
  if (!chId || activeEvents.has(chId)) return;
  const ch = await fetchChannel(chId, 'ANNOUNCE_CHANNEL_ID');
  if (ch && ch.isTextBased()) await spawnEvent(ch, 'swamp boss', null);
}
async function spawnEvent(channel, kind, startedBy) {
  const msg = await channel.send(line('eventSpawn', {}, Date.now())).catch(() => null);
  if (!msg) return null;
  await msg.react('🐊').catch(() => {});
  const ev = { kind: kind || 'swamp boss', hp: 10, maxHp: 10, participants: new Set(), messageId: msg.id, startedBy };
  activeEvents.set(channel.id, ev);
  return ev;
}

/* ---------------- slash commands ---------------- */
/** Show a member's generated profile card (image + details embed).
 *  Deferred: the canvas render fetches the avatar/banner and can take a
 *  second or two, past the 3s interaction window. */
async function showProfileCard(interaction, target) {
  await interaction.deferReply();
  const tRec = store.user(target.id);
  titlesLib.ensureTitles(tRec);
  let tMember = null;
  if (interaction.guild) tMember = await interaction.guild.members.fetch(target.id).catch(() => null);
  const view = await profileLib.buildProfileReply({
    user: target, rec: tRec, member: tMember || interaction.member,
    viewerId: interaction.user.id,
    presence: tMember && tMember.presence ? tMember.presence.status : null,
    voiceChannelName: tMember && tMember.voice && tMember.voice.channel ? tMember.voice.channel.name : null,
    now: new Date(),
  });
  await interaction.editReply({ embeds: view.embeds, files: view.files, components: view.components });
}

/* ---------------- profile guestbook components (stateless, restart-proof) ----------------
 * Same durability rule as the storefront: routing is purely the customId
 * (pf:wall:note|list|submit:<ownerId>). No collectors, no sessions. */
async function handleProfileComponent(interaction, parsed) {
  // Save & post: owner-only. Drops the clean card into this channel as a
  // permanent post (no pin needed - it just stays there). Saving again
  // refreshes the same post in place, so the channel never fills with
  // duplicates; if the old post was deleted, a fresh one goes up.
  if (parsed.kind === 'save') {
    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({ content: 'That card is not yours to save - open your own with /profile view.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const rec = store.user(interaction.user.id);
    const p = profileLib.ensureProfile(rec);
    const view = await profileLib.buildProfileReply({
      user: interaction.user, rec, member: interaction.member,
      viewerId: interaction.user.id,
      presence: interaction.member && interaction.member.presence ? interaction.member.presence.status : null,
      voiceChannelName: interaction.member && interaction.member.voice && interaction.member.voice.channel ? interaction.member.voice.channel.name : null,
      now: new Date(),
    });
    const payload = { embeds: view.embeds, files: view.files }; // clean: no editor controls on the permanent post
    const channel = interaction.channel || (interaction.guild ? await interaction.guild.channels.fetch(interaction.channelId).catch(() => null) : null);
    if (!channel || typeof channel.send !== 'function') {
      await interaction.editReply({ content: '💾 The King could not find this channel to post in - try /profile view in the profile channel and save there.' });
      return;
    }
    let posted = null;
    if (p.postedMessageId && p.postedChannelId) {
      const oldChannel = p.postedChannelId === channel.id ? channel : (interaction.guild ? await interaction.guild.channels.fetch(p.postedChannelId).catch(() => null) : null);
      if (oldChannel && oldChannel.messages) {
        const oldMsg = await oldChannel.messages.fetch(p.postedMessageId).catch(() => null);
        if (oldMsg) posted = await oldMsg.edit(payload).catch(() => null);
      }
    }
    if (!posted) {
      posted = await channel.send(payload).catch(() => null);
      if (!posted) {
        await interaction.editReply({ content: '💾 The King could not post your card here - check he can send messages in this channel, then try again.' });
        return;
      }
      p.postedMessageId = posted.id;
      p.postedChannelId = channel.id;
      store.save();
      await interaction.editReply({ content: `💾 Your card is posted in <#${channel.id}> - it stays there. Change anything and hit Save & post again to refresh the same post.` });
    } else {
      store.save();
      await interaction.editReply({ content: `💾 Your card in <#${p.postedChannelId}> is refreshed - same post, new look.` });
    }
    return;
  }
  // Layout editor selects: owner-only, re-render the card live.
  if (parsed.kind === 'layout') {
    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({ content: 'That card is not yours to rearrange - open your own with /profile view.', ephemeral: true });
      return;
    }
    const value = (interaction.values && interaction.values[0]) || '';
    const rec = store.user(interaction.user.id);
    const p = profileLib.ensureProfile(rec);
    let r;
    if (parsed.field === 'preset') r = profileLib.applyLayoutPreset(p, value);
    else r = profileLib.setLayoutField(p, parsed.field, value);
    if (!r.ok) { await interaction.reply({ content: `🎨 ${r.reason}`, ephemeral: true }); return; }
    store.save();
    await interaction.deferUpdate();
    const view = await profileLib.buildProfileReply({
      user: interaction.user, rec, member: interaction.member,
      viewerId: interaction.user.id,
      presence: interaction.member && interaction.member.presence ? interaction.member.presence.status : null,
      voiceChannelName: interaction.member && interaction.member.voice && interaction.member.voice.channel ? interaction.member.voice.channel.name : null,
      now: new Date(),
    });
    await interaction.editReply({ embeds: view.embeds, files: view.files, components: view.components });
    return;
  }
  if (parsed.action === 'note') {
    if (interaction.user.id === parsed.ownerId) {
      await interaction.reply({ content: 'You cannot leave a note on your own wall - that is what your bio is for.', ephemeral: true });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(profileLib.wallSubmitId(parsed.ownerId))
      .setTitle('Leave a note on the wall');
    const noteInput = new TextInputBuilder()
      .setCustomId('note').setLabel('Your note').setStyle(TextInputStyle.Paragraph)
      .setMaxLength(profileLib.WALL_NOTE_MAX).setRequired(true)
      .setPlaceholder('Short and sweet - the wall remembers.');
    const stampInput = new TextInputBuilder()
      .setCustomId('stamp').setLabel('Stamp (one emoji, optional)').setStyle(TextInputStyle.Short)
      .setMaxLength(10).setRequired(false).setPlaceholder('🐊');
    modal.addComponents(
      new ActionRowBuilder().addComponents(noteInput),
      new ActionRowBuilder().addComponents(stampInput),
    );
    await interaction.showModal(modal);
    return;
  }
  if (parsed.action === 'list') {
    const ownerRec = store.user(parsed.ownerId);
    const p = profileLib.ensureProfile(ownerRec);
    await interaction.reply({ content: `📖 **Guestbook** (${p.wall.length})\n${profileLib.wallLines(p, 20)}`, ephemeral: true });
    return;
  }
}

async function handleProfileModal(interaction, parsed) {
  if (parsed.action !== 'submit') return;
  const ownerRec = store.user(parsed.ownerId);
  const p = profileLib.ensureProfile(ownerRec);
  const text = interaction.fields.getTextInputValue('note');
  const stamp = interaction.fields.getTextInputValue('stamp') || '';
  const r = profileLib.addWallNote(p, { by: interaction.user.id, name: interaction.user.username, text, stamp });
  if (!r.ok) { await interaction.reply({ content: `📖 ${r.reason}`, ephemeral: true }); return; }
  store.save();
  await interaction.reply({ content: `📖 Note left on <@${parsed.ownerId}>'s wall. The swamp remembers kindness.`, ephemeral: true });
}

/* ---------------- the store: ONE purchase path ----------------
 * /store buy and every storefront Buy button land here. shop.js does the
 * transaction; this only translates its result into King's-voice text and
 * runs the one effect that lives outside shop.js (the XP Feast, through
 * awardXp with a flat x1 multiplier object - purchases are never bonused). */
async function storeBuyText(interaction, rec, itemId) {
  ensureActionPoints(rec, interaction.member); // settle today's points before a tonic reads them
  const bucksBefore = shopLib.balanceOf(rec); // Swamp Bucks Bridge: net-spend baseline
  const premium = isPremium(interaction.member, rec);
  const r = shopLib.buy(rec, itemId, {
    now: Date.now(),
    todayKey: xpLib.dateKeyInHalifax(new Date(), tz),
    premium,
    actionCap: premium ? ACTION_POINTS_PREMIUM : ACTION_POINTS_BASE,
  });
  if (!r.ok) return { ok: false, text: `🛒 ${r.reason}\n💰 Your balance: **${shopLib.balanceOf(rec)} Swamp Bucks**.` };
  // Swamp Bucks Bridge: shop.js moved the local mirror synchronously;
  // post just the net spend so a linked member's website book matches.
  // (The XP Feast path below grants XP through awardXp, whose own level
  // up Bucks go through the bridge separately - never counted here,
  // because the baseline was captured before the purchase.)
  await bucksBridge.settleDelta(rec, bucksBefore, 'store buy');
  if (r.xpToGrant) {
    const xr = await awardXp(interaction.user.id, r.xpToGrant, {
      member: interaction.member, channelId: interaction.channelId,
      multiplierObj: { multiplier: 1, rawMultiplier: 1, capped: false, breakdown: [] },
    });
    store.save();
    return { ok: true, text: `🛒 **${r.item.name}** - ${r.price} Swamp Bucks. The feast lands: **+${xr.gained} XP, flat** - bonuses do not multiply a purchase, not even for royalty. The King is firm on this one.${xr.levelsGained.length ? `\n🎉 Level up! You are now Level ${xr.newLevel} ${ladderTitleFor(xr.newLevel)}.` : ''}\n💰 New balance: **${shopLib.balanceOf(rec)} Swamp Bucks**.` };
  }
  store.save();
  let detail = '';
  if (r.grantedItem && r.revealed) detail = ` The murk gives up... **${r.grantedItem}**! Straight into your bag.`;
  else if (r.grantedItem) detail = ` **${r.grantedItem}** is in your bag.`;
  else if (r.frameId) detail = ` **${r.item.name}** is in your wardrobe, yours forever. Wear it: /avatarframe apply - pick **${r.item.name}**.`;
  else if (r.backgroundId) detail = ` **${r.item.name}** now hangs behind your /profile card. Say the word with /profile and look at you.`;
  else if (r.consumable) detail = ` **${r.item.name}** is in your pocket (you hold ${r.consumableCount}). ${r.consumable === 'event-lure' ? 'Spend it with /event lure.' : 'It spends itself at the exact moment it matters.'}`;
  else if (r.actionPoints != null) detail = ` Action points refilled to **${r.actionPoints}** for today. The fireflies report for duty.`;
  else if (r.clearedQuest) detail = ` "${r.clearedQuest}" is wiped clean, no penalty. /sidequest get pulls a fresh one whenever you are ready.`;
  else if (r.passUntil) detail = ` Your pass is live until **${new Date(r.passUntil).toISOString().slice(0, 10)}**: the x1.5 XP line, +1 loot roll wherever loot rolls, and 8 action points a day.`;
  else if (r.newTitle) detail = ` The crank turns and out comes... **${r.newTitle}**. Set as your active cosmetic title.`;
  return { ok: true, text: `🛒 **${r.item.name}** - ${r.price} Swamp Bucks, sold.${detail}\n💰 New balance: **${r.balance} Swamp Bucks**.`, frameItem: r.frameId ? r.item : null };
}

function storeSellText(rec, input) {
  const r = shopLib.sell(rec, input);
  if (!r.ok) return { ok: false, text: `🛒 ${r.reason}\n💰 Your balance: **${shopLib.balanceOf(rec)} Swamp Bucks**.` };
  store.save();
  return { ok: true, text: `🛒 Sold one **${r.itemName}** back to the King for **${r.price} Swamp Bucks**.\n💰 New balance: **${r.balance} Swamp Bucks**. He resells it at a markup and tells no one.` };
}

/* ---------------- storefront components (stateless, restart-proof) ----------------
 * Buttons/selects from ANY storefront message - posted yesterday or last
 * month, ephemeral or pinned - route here purely by customId. No
 * collectors, no sessions, nothing stored on the message. */
async function handleStorefrontComponent(interaction, parsed) {
  const rec = store.user(interaction.user.id);
  if (parsed.action === 'nav') {
    // Defer FIRST: the new page carries up to ~17MB of store art and the
    // upload regularly outruns Discord's 3s acknowledgement window
    // (Unknown interaction 10062). Deferring buys the full 15 minutes.
    await interaction.deferUpdate();
    const view = storefrontLib.buildStorefront(parsed.arg, rec);
    await interaction.editReply({ embeds: view.embeds, components: view.components, files: view.files });
    return;
  }
  if (parsed.action === 'pick') {
    const value = (interaction.values && interaction.values[0]) || '';
    const sep = value.indexOf(':');
    if (sep < 1) return;
    // Defer first for the same reason: the price check can carry a picture.
    await interaction.deferReply({ ephemeral: true });
    const prompt = storefrontLib.buildPickPrompt(value.slice(0, sep), value.slice(sep + 1), rec);
    if (!prompt) { await interaction.editReply({ content: 'That line of the shelf has moved. /store open for the fresh board.' }); return; }
    await interaction.editReply({ content: prompt.content, components: prompt.components, embeds: prompt.embeds, files: prompt.files });
    return;
  }
  if (parsed.action === 'buy') {
    const r = await storeBuyText(interaction, rec, parsed.arg);
    await interaction.reply({ content: r.text, ephemeral: true });
    if (r.ok && r.frameItem && interaction.channel && interaction.channel.isTextBased()) {
      await interaction.channel.send(`🖼️ <@${interaction.user.id}> just copped the **${r.frameItem.name}** from the King's Little Store. The swamp sees you. Flex approved.`).catch(() => {});
    }
    return;
  }
  if (parsed.action === 'sell') {
    const bucksBefore = shopLib.balanceOf(rec);
    const r = storeSellText(rec, parsed.arg);
    if (r.ok) { await bucksBridge.settleDelta(rec, bucksBefore, 'store sell'); store.save(); }
    await interaction.reply({ content: r.text, ephemeral: true });
  }
}

/* ---------------- /setup panel components (stateless, restart-proof) ----------------
 * Role/Channel/String selects from the /setup panel route purely by
 * customId (setup:...). No collectors: an old panel message keeps working
 * after restarts. Every pick saves immediately and re-renders the page. */
function isSetupAuthorized(interaction) {
  const perms = interaction.memberPermissions;
  if (perms && (perms.has(PermissionFlagsBits.Administrator) || perms.has(PermissionFlagsBits.ManageGuild))) return true;
  return !!(config.modRoleId && interaction.member && interaction.member.roles && interaction.member.roles.cache.has(config.modRoleId));
}
async function handleSetupComponent(interaction, parsed) {
  if (!isSetupAuthorized(interaction)) {
    await interaction.reply({ content: 'Server setup is crown business: admins, Manage Server holders, or the configured mod role only.', ephemeral: true });
    return;
  }
  if (parsed.type === 'page') {
    const page = (interaction.values && interaction.values[0]) || 'core';
    const view = setupLib.buildPanel(store.getConfig(), page);
    await interaction.update({ embeds: view.embeds, components: view.components });
    return;
  }
  const pickedId = interaction.values && interaction.values[0];
  const patch = setupLib.patchForPick(parsed, pickedId);
  if (!patch) return;
  store.setConfig(patch);
  store.save();
  applyEffectiveConfig();
  const page = parsed.kind === 'level'
    ? (['1', '5', '10', '20'].includes(parsed.level) ? 'levels' : 'levels2')
    : parsed.kind === 'faction' ? 'factions'
      : ((setupLib.fieldByKey(parsed.key) || {}).page || 'core');
  const view = setupLib.buildPanel(store.getConfig(), page);
  await interaction.update({ embeds: view.embeds, components: view.components });
}

/* ---------------- /setup create executor ----------------
 * Runs the pure planner's steps against the live guild: roles first
 * (channel overwrites reference them), symbolic overwrite holders
 * resolved to real IDs as they become known. Existing pieces are adopted
 * or skipped - never renamed, never overwritten. */
async function runSetupCreate(interaction) {
  const guild = interaction.guild;
  await interaction.deferReply({ ephemeral: true });
  const rolesByName = {};
  for (const [, r] of guild.roles.cache) { if (!rolesByName[r.name]) rolesByName[r.name] = r.id; }
  const channelsByName = {};
  for (const [, ch] of guild.channels.cache) {
    if (ch && ch.name && ch.isTextBased && ch.isTextBased() && !channelsByName[ch.name]) channelsByName[ch.name] = ch.id;
  }
  const steps = setupLib.planSetupCreations(store.getConfig(), { rolesByName, channelsByName });
  const patch = {};
  const created = [], adopted = [], skipped = [], failed = [];
  const roleIds = {
    verified: store.getConfig().verifiedRoleId || null,
    mod: store.getConfig().modRoleId || null,
  };
  for (const step of steps) {
    if (step.action === 'skip') { skipped.push(step.name); continue; }
    if (step.action === 'adopt') {
      patch[step.field] = step.id; adopted.push(step.name);
      if (step.field === 'verifiedRoleId') roleIds.verified = step.id;
      continue;
    }
    try {
      if (step.kind === 'role') {
        const role = await guild.roles.create({
          name: step.name, color: step.spec.color, hoist: step.spec.hoist,
          mentionable: step.spec.mentionable,
          reason: 'Crocodile King /setup create - filling a setup gap',
        });
        patch[step.field] = role.id; created.push(step.name);
        if (step.field === 'verifiedRoleId') roleIds.verified = role.id;
      } else {
        const permissionOverwrites = [];
        for (const ow of step.spec.overwrites) {
          const id = ow.who === 'everyone' ? guild.id
            : ow.who === 'bot' ? client.user.id
              : ow.who === 'verified' ? roleIds.verified
                : ow.who === 'mod' ? roleIds.mod : null;
          if (!id) continue; // holder unknown (e.g. no mod role wired) - skip that overwrite
          const o = { id };
          if (ow.allow) o.allow = ow.allow;
          if (ow.deny) o.deny = ow.deny;
          permissionOverwrites.push(o);
        }
        const ch = await guild.channels.create({
          name: step.name, type: ChannelType.GuildText, topic: step.spec.topic,
          rateLimitPerUser: step.spec.rateLimitPerUser || 0,
          permissionOverwrites,
          reason: 'Crocodile King /setup create - filling a setup gap',
        });
        patch[step.field] = ch.id; created.push(step.name);
      }
    } catch (e) {
      console.warn(`[crocodile-king] /setup create failed on ${step.name}:`, e.message);
      failed.push(step.name);
    }
  }
  if (Object.keys(patch).length) store.setConfig(patch);
  applyEffectiveConfig();
  store.save();
  const fmt = (arr) => arr.length ? arr.join(', ') : 'none';
  await interaction.editReply([
    '🐊 **/setup create - done.** The King only fills gaps; everything the server already had keeps its name, its settings and its dignity.',
    `🛠️ **Created:** ${fmt(created)}`,
    `📌 **Found and plugged in:** ${fmt(adopted)}`,
    `✅ **Already wired:** ${fmt(skipped)}`,
    ...(failed.length ? [`⚠️ **Could not create:** ${fmt(failed)} - the King needs Manage Roles + Manage Channels, and his own role above the pieces he builds. Nothing was half-saved for those.`] : []),
    '',
    setupLib.setupSummary(store.getConfig()),
    '',
    'One human touch left: in **Server Settings → Roles**, drag the **Crocodile King** role *above* the level and faction roles, so he is allowed to hand them out. Everything else is live.',
  ].join('\n'));
}

client.on(Events.InteractionCreate, async (interaction) => {
  const isSelect = (interaction.isAnySelectMenu && interaction.isAnySelectMenu())
    || interaction.isStringSelectMenu()
    || (interaction.isRoleSelectMenu && interaction.isRoleSelectMenu())
    || (interaction.isChannelSelectMenu && interaction.isChannelSelectMenu());
  if (isSelect) {
    const sp = setupLib.parseSetupCustomId(interaction.customId);
    if (sp) {
      try { await handleSetupComponent(interaction, sp); }
      catch (e) {
        console.error('[crocodile-king] setup panel error:', e);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'The setup panel hiccuped on that pick. Nothing was saved wrong - open /setup panel again.', ephemeral: true }).catch(() => {});
      }
      return;
    }
  }
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    const parsed = storefrontLib.parseCustomId(interaction.customId);
    if (parsed) {
      try { await handleStorefrontComponent(interaction, parsed); }
      catch (e) {
        console.error('[crocodile-king] storefront component error:', e);
        // Deferred already (nav/pick defer first): answer with an ephemeral
        // follow-up, never editReply - that would wipe the board itself.
        if (interaction.deferred) await interaction.followUp({ content: 'The storefront hiccuped on that tap. Nothing was charged - try again.', ephemeral: true }).catch(() => {});
        else if (!interaction.replied) await interaction.reply({ content: 'The storefront hiccuped on that tap. Nothing was charged - try again.', ephemeral: true }).catch(() => {});
      }
      return;
    }
    const pf = profileLib.parseCustomId(interaction.customId);
    if (pf) {
      try { await handleProfileComponent(interaction, pf); }
      catch (e) {
        console.error('[crocodile-king] profile component error:', e);
        if (interaction.deferred) await interaction.followUp({ content: 'The card hiccuped on that tap. Nothing was saved - try again.', ephemeral: true }).catch(() => {});
        else if (!interaction.replied) await interaction.reply({ content: 'The guestbook hiccuped on that tap. Nothing was saved - try again.', ephemeral: true }).catch(() => {});
      }
    }
    return;
  }
  if (interaction.isModalSubmit()) {
    const pf = profileLib.parseCustomId(interaction.customId);
    if (pf) {
      try { await handleProfileModal(interaction, pf); }
      catch (e) {
        console.error('[crocodile-king] profile modal error:', e);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'The note did not stick. Try again - the wall is patient.', ephemeral: true }).catch(() => {});
      }
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const rec = store.user(userId);
  // Swamp Bucks Bridge: for a linked member (or one whose /link code was
  // just redeemed on the website) the website book is the true one, so
  // refresh the local mirror before any command reads or moves Bucks.
  // Bridge off or unlinked: returns instantly, nothing changes.
  if (bucksBridge.enabled && (rec.websiteUserId || rec.pendingLinkAt)) {
    try { const sync = await bucksBridge.syncRecord(rec); if (sync.changed) store.save(); } catch { /* the local book carries on */ }
  }
  if (!rec.joinedAt && interaction.member && interaction.member.joinedAt) rec.joinedAt = interaction.member.joinedAt.getTime();
  const isAdmin = interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
  const isMod = isAdmin
    || (interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild))
    || (config.modRoleId && interaction.member && interaction.member.roles.cache.has(config.modRoleId));
  const cmd = interaction.commandName;

  try {
    if (cmd === 'setup') {
      const sub = interaction.options.getSubcommand();
      if (!isMod) { await interaction.reply({ content: 'Server setup is crown business: admins, Manage Server holders, or the configured mod role only.', ephemeral: true }); return; }
      if (sub === 'panel') {
        const view = setupLib.buildPanel(store.getConfig(), 'core');
        await interaction.reply({ embeds: view.embeds, components: view.components, ephemeral: true });
      } else if (sub === 'show') {
        await interaction.reply({ content: setupLib.setupSummary(store.getConfig()), ephemeral: true });
      } else if (sub === 'reset') {
        store.resetConfig(ENV_SEED);
        applyEffectiveConfig();
        store.save();
        await interaction.reply({ content: '🧹 Stored wiring wiped back to the env seed. Member books (XP, Bucks, loot, factions) were NOT touched - the King does not burn ledgers.\n\n' + setupLib.setupSummary(store.getConfig()), ephemeral: true });
      } else if (sub === 'create') {
        await runSetupCreate(interaction);
      }
    }

    else if (cmd === 'rank') {
      const target = interaction.options.getUser('member') || interaction.user;
      await showProfileCard(interaction, target);
    }

    else if (cmd === 'moodpick') {
      const pick = interaction.options.getString('mood');
      const p = profileLib.ensureProfile(rec);
      if (pick === 'clear') {
        p.mood = null;
        store.save();
        await interaction.reply({ content: '🌫️ Mood cleared - your aura follows your live status again, and your pet goes back to its own moods.', ephemeral: true });
        return;
      }
      const mood = profileLib.moodById(pick);
      if (!mood) { await interaction.reply({ content: 'That mood is not in the swamp. Pick one from the list.', ephemeral: true }); return; }
      p.mood = mood.id;
      store.save();
      await interaction.reply({ content: `🎭 Mood set: **${mood.name}** - ${mood.blurb}\nYour card's aura glows ${mood.name.toLowerCase()} now, and your pet wears the matching mood. /profile view to see it.`, ephemeral: true });
    }

    else if (cmd === 'profile') {
      const sub = interaction.options.getSubcommand();
      const p = profileLib.ensureProfile(rec);
      if (sub === 'view') {
        const target = interaction.options.getUser('member') || interaction.user;
        await showProfileCard(interaction, target);
      } else if (sub === 'bio') {
        p.bio = interaction.options.getString('text').trim().slice(0, profileLib.BIO_MAX);
        store.save();
        await interaction.reply({ content: `✍️ Bio set: "${p.bio}"\nIt rides on your card from now on. /profile view to admire it.`, ephemeral: true });
      } else if (sub === 'banner') {
        const theme = interaction.options.getString('theme');
        const url = interaction.options.getString('url');
        const clear = interaction.options.getBoolean('clear');
        if (clear) {
          p.banner = null; p.bannerUrl = null;
          store.save();
          await interaction.reply({ content: '🖼️ Custom banner cleared - your equipped theme hangs behind the card again.', ephemeral: true });
        } else if (url) {
          const v = profileLib.validateBannerUrl(url);
          if (!v.ok) { await interaction.reply({ content: `🖼️ ${v.reason}`, ephemeral: true }); return; }
          // Best-effort content check: a HEAD fetch that says image/* is
          // proof; a failed fetch is NOT proof of a bad link (hosting
          // networks lie), so the extension check above still carries it.
          let checked = false;
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 8000);
            try {
              const res = await fetch(v.url, { method: 'HEAD', signal: ctrl.signal });
              const ct = res.headers.get('content-type') || '';
              if (res.ok && ct && !ct.startsWith('image/')) {
                await interaction.reply({ content: '🖼️ That link answers, but it is not a picture - the King checked the label.', ephemeral: true });
                return;
              }
              if (res.ok) checked = true;
            } finally { clearTimeout(timer); }
          } catch { /* network shrug - extension check stands */ }
          p.bannerUrl = v.url; p.banner = null;
          store.save();
          await interaction.reply({ content: `🖼️ Custom banner set - it hangs behind your card now.${checked ? ' The King checked: it is a real picture.' : ' (The King could not reach the link to double-check it - if the card shows the fallback instead, the link may be dead.)'}`, ephemeral: true });
        } else if (theme) {
          if (!backgroundsLib.ownsBackground(rec, theme)) {
            const def = backgroundsLib.backgroundById(theme);
            await interaction.reply({ content: `🖼️ You do not own **${def ? def.name : theme}** yet - it sits in /store. Buy it once and it is yours forever.`, ephemeral: true });
            return;
          }
          p.banner = theme; p.bannerUrl = null;
          store.save();
          await interaction.reply({ content: `🖼️ Banner set: **${backgroundsLib.backgroundById(theme).name}**. /profile view to see it behind you.`, ephemeral: true });
        } else {
          const cur = p.bannerUrl ? `custom URL: ${p.bannerUrl}` : (p.banner ? backgroundsLib.backgroundById(p.banner).name : (backgroundsLib.equippedBackground(rec) ? `${backgroundsLib.equippedBackground(rec).name} (equipped)` : 'none yet'));
          await interaction.reply({ content: `🖼️ Current banner: **${cur}**\nOwned themes: ${backgroundsLib.BACKGROUNDS.filter(b => backgroundsLib.ownsBackground(rec, b.id)).map(b => b.name).join(', ') || 'none yet - /store sells them'}.`, ephemeral: true });
        }
      } else if (sub === 'privacy') {
        const fields = ['rank', 'inventory', 'activity', 'balance'];
        let changed = false;
        for (const f of fields) {
          const v = interaction.options.getBoolean(f);
          if (v !== null && v !== undefined) { p.privacy[f] = v; changed = true; }
        }
        if (changed) store.save();
        const tick = (v) => (v ? '👁️ shown' : '🔒 hidden');
        await interaction.reply({ content: `🔐 **Your card privacy** (other members viewing your card):\nRank: ${tick(p.privacy.rank)} · Inventory: ${tick(p.privacy.inventory)} · Activity: ${tick(p.privacy.activity)} · Balance: ${tick(p.privacy.balance)}\nYour own view always shows everything.`, ephemeral: true });
      } else if (sub === 'style') {
        p.style = interaction.options.getString('style');
        store.save();
        await interaction.reply({ content: `🎴 Card style set: **${p.style === 'passport' ? 'Swamp Passport' : 'Swamp Trading Card'}**. /profile view to see the new frame.`, ephemeral: true });
      } else if (sub === 'color') {
        const hex = interaction.options.getString('hex').trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
          await interaction.reply({ content: '🎨 That is not a hex color - give me six hex digits with a #, like #ff7043.', ephemeral: true });
          return;
        }
        p.favColor = hex.toLowerCase();
        store.save();
        await interaction.reply({ content: `🎨 Favorite color set: **${p.favColor}** - your card's accent now. /profile view to see it glow.`, ephemeral: true });
      } else if (sub === 'timezone') {
        const zone = interaction.options.getString('zone').trim();
        if (!profileLib.validTimezone(zone)) {
          await interaction.reply({ content: `🌍 "${zone}" is not a timezone the King knows - use an IANA name like America/Halifax, America/New_York or Europe/London.`, ephemeral: true });
          return;
        }
        p.timezone = zone;
        store.save();
        await interaction.reply({ content: `🌍 Timezone set: **${zone}** - your card's lighting now follows your local hour (${profileLib.TIME_LABELS[profileLib.timeOfDay(new Date(), zone)]}).`, ephemeral: true });
      } else if (sub === 'showcase') {
        const action = interaction.options.getString('action');
        if (action === 'list') {
          await interaction.reply({ content: `📌 **Your showcase** (${p.showcase.length}/${profileLib.SHOWCASE_MAX})\n${profileLib.showcaseLines(p)}`, ephemeral: true });
        } else if (action === 'add') {
          const r = profileLib.addShowcase(p, interaction.options.getString('kind'), interaction.options.getString('value'), rec);
          if (!r.ok) { await interaction.reply({ content: `📌 ${r.reason}`, ephemeral: true }); return; }
          store.save();
          await interaction.reply({ content: `📌 Pinned to slot ${r.slot}: **${interaction.options.getString('value')}**. It shows on your card now.`, ephemeral: true });
        } else {
          const slot = interaction.options.getInteger('slot');
          if (!slot) { await interaction.reply({ content: '📌 Say which slot to remove (1-4). /profile showcase list shows your pins.', ephemeral: true }); return; }
          const r = profileLib.removeShowcase(p, slot);
          if (!r.ok) { await interaction.reply({ content: `📌 ${r.reason}`, ephemeral: true }); return; }
          store.save();
          await interaction.reply({ content: `📌 Unpinned: **${r.removed.value}**. Slot ${slot} is free again.`, ephemeral: true });
        }
      } else if (sub === 'pet') {
        const action = interaction.options.getString('action');
        if (action === 'adopt') {
          if (p.pet) {
            await interaction.reply({ content: `🐾 You already have **${p.pet.name || petsLib.speciesById(p.pet.species).name}**. One critter per swamp member - feed it, name it, love it.`, ephemeral: true });
            return;
          }
          const speciesId = interaction.options.getString('species');
          const species = petsLib.speciesById(speciesId);
          if (!species) { await interaction.reply({ content: '🐾 Pick a critter from the list: Gator Pup, Firefly or Swamp Frog.', ephemeral: true }); return; }
          const name = (interaction.options.getString('name') || species.name).trim().slice(0, 20);
          p.pet = { species: species.id, name, xp: 0, fedAt: 0, adoptedAt: Date.now() };
          store.save();
          await interaction.reply({ content: `🐾 **${name}** the ${species.name} hops onto your card! ${species.blurb}\nIt levels up as you chat. Feed it with /profile pet feed, and /profile view to see it in the corner.`, ephemeral: true });
        } else if (action === 'feed') {
          if (!p.pet) { await interaction.reply({ content: '🐾 No pet to feed - /profile pet adopt first.', ephemeral: true }); return; }
          p.pet.fedAt = Date.now();
          store.save();
          await interaction.reply({ content: `🍖 You feed **${p.pet.name}**. It munches happily for the next half hour - catch it mid-snack on your card.`, ephemeral: true });
        } else if (action === 'rename') {
          if (!p.pet) { await interaction.reply({ content: '🐾 No pet to rename - /profile pet adopt first.', ephemeral: true }); return; }
          const name = (interaction.options.getString('name') || '').trim().slice(0, 20);
          if (!name) { await interaction.reply({ content: '🐾 Give your pet a name (up to 20 characters).', ephemeral: true }); return; }
          p.pet.name = name;
          store.save();
          await interaction.reply({ content: `🐾 Your pet answers to **${name}** now.`, ephemeral: true });
        } else if (action === 'habitat') {
          const theme = interaction.options.getString('habitat');
          const def = petsLib.habitatById(theme);
          if (!theme || !petsLib.HABITAT_THEMES.some(h => h.id === theme)) {
            await interaction.reply({ content: `🌿 Pick a habitat from the list: ${petsLib.HABITAT_THEMES.map(h => h.name).join(', ')}.`, ephemeral: true });
            return;
          }
          p.habitat = def.id;
          store.save();
          await interaction.reply({ content: `🌿 Habitat strip set: **${def.name}** - ${def.blurb}`, ephemeral: true });
        } else {
          if (!p.pet) { await interaction.reply({ content: '🐾 No pet yet - /profile pet adopt picks your critter.', ephemeral: true }); return; }
          const species = petsLib.speciesById(p.pet.species);
          const lvl = petsLib.petLevel(p.pet);
          await interaction.reply({ content: `🐾 **${p.pet.name}** the ${species.name} - Level ${lvl} (${p.pet.xp} XP, next at ${petsLib.petXpForNextLevel(p.pet)})\n"${petsLib.petSpeech(p.pet)}"\nHabitat: ${petsLib.habitatById(p.habitat).name}. It levels up as you chat.`, ephemeral: true });
        }
      } else if (sub === 'wall') {
        const action = interaction.options.getString('action');
        if (action === 'list') {
          await interaction.reply({ content: `📖 **Your guestbook** (${p.wall.length})\n${profileLib.wallLines(p, 20)}`, ephemeral: true });
        } else {
          const note = interaction.options.getInteger('note');
          if (!note) { await interaction.reply({ content: '📖 Say which note to remove. /profile wall list shows the numbers.', ephemeral: true }); return; }
          const r = profileLib.removeWallNote(p, note, interaction.user.id, interaction.user.id, isMod);
          if (!r.ok) { await interaction.reply({ content: `📖 ${r.reason}`, ephemeral: true }); return; }
          store.save();
          await interaction.reply({ content: `📖 Pulled note ${note} off the wall: "${r.removed.text}"`, ephemeral: true });
        }
      }
    }

    else if (cmd === 'leaderboard') {
      const rows = Object.values(store.data.users).sort((a, b) => b.xp - a.xp).slice(0, 10);
      const text = rows.length
        ? rows.map((r, i) => {
          const lv = xpLib.levelFromXp(r.xp).level;
          const cosmetic = r.activeTitle ? ` · cosmetic: *${r.activeTitle}*` : '';
          const fac = factionsLib.factionById(r.faction);
          return `${i + 1}. <@${r.userId}> - Level ${lv} ${ladderTitleFor(lv)}${cosmetic} · ${r.xp} XP · ${r.swampBucks} Bucks · ${r.rep || 0} Rep${fac ? ` · ${fac.name}` : ''}`;
        }).join('\n')
        : 'Nobody on the board yet. Sad swamp. Be first.';
      await interaction.reply(`🏆 **THE SWAMP Leaderboard**\n${text}`);
    }

    else if (cmd === 'bonus') {
      const target = interaction.options.getUser('member') || interaction.user;
      const tRec = store.user(target.id);
      let tMember = interaction.member;
      if (interaction.guild && target.id !== userId) tMember = await interaction.guild.members.fetch(target.id).catch(() => interaction.member);
      const m = multiplierFor(tMember, tRec, interaction.channelId);
      let sourceNote = '';
      if (isRoyaltyRole(tMember)) sourceNote = '\nThe x1.5 on the board comes from the **Swamp Royalty Pass role**.';
      else if (isPassActive(tRec)) sourceNote = `\nThe x1.5 on the board comes from a **timed VIP Pass**, live until ${new Date(tRec.passUntil).toISOString().slice(0, 10)}. (A pass and the Royalty role are the same x1.5 - they never stack with each other.)`;
      await interaction.reply(`**XP bonus for ${target.username}:** ${breakdownText(m)}${sourceNote}`);
    }

    else if (cmd === 'daily') {
      const today = xpLib.dateKeyInHalifax(new Date(), tz);
      if (rec.lastDailyKey === today) {
        await interaction.reply({ content: 'Already collected today. The King pays once a day. Come back tomorrow and keep that streak burnin\'.', ephemeral: true });
        return;
      }
      const yesterday = xpLib.dateKeyInHalifax(new Date(Date.now() - 24 * 60 * 60 * 1000), tz);
      // Streak Shield hook (shop.js): a missed day spends one shield to keep the streak, if held.
      const streakRes = shopLib.resolveDailyStreak(rec, today, yesterday);
      rec.streak = streakRes.streak;
      rec.lastDailyKey = today;
      ensureActionPoints(rec, interaction.member); // a fresh /daily also means a fresh Halifax day of points
      const r = await awardXp(userId, 50, { member: interaction.member, channelId: interaction.channelId });
      await bucksBridge.adjust(rec, 20, 'daily');
      const items = grantLoot(rec, interaction.member, 1); // 1 loot roll with every /daily (premium: +1 extra)
      let extras = `\n🎁 **Daily loot:** ${lootText(items)}`;
      if (rec.streak % 7 === 0) {
        addRep(rec, factionsLib.REP_ACTIONS.streakMilestone); // +5 rep at every 7-day streak milestone
        extras += `\n⭐ **${rec.streak}-day streak milestone:** +${factionsLib.REP_ACTIONS.streakMilestone} Rep.`;
      }
      if (rec.streak >= 7) {
        const t = titlesLib.unlockAchievement(rec, 'streak7');
        if (t) extras += `\n✨ Cosmetic title unlocked: **${t}**`;
      }
      store.save();
      await interaction.reply(`☀️ Daily claimed: +${r.gained} XP and +20 Swamp Bucks. Streak: **${rec.streak} day(s)**${rec.streak >= 7 ? ' - your +20% streak bonus is LIVE.' : ` - ${7 - rec.streak} more day(s) to the streak bonus.`}${streakRes.shieldUsed ? `\n🛡️ **Streak Shield spent:** you missed a day, and the shield cracked so your streak didn't. ${shopLib.countConsumable(rec, 'streak-shield')} shield(s) left in your pocket.` : ''}${extras}`);
    }

    else if (cmd === 'prize') {
      // Prize keys wait on the member's own record (never DM'd, server only
      // rule). Only the member sees this ephemeral reply.
      const keys = Array.isArray(rec.pendingKeys) ? rec.pendingKeys : [];
      if (!keys.length) {
        await interaction.reply({ content: '🔑 No prize keys are waiting for you right now. Win a sponsored quest and your key will be held here, where only you can see it.', ephemeral: true });
        return;
      }
      const list = keys.map(k => `• **${k.title}** (courtesy of ${k.sponsor}): \`${k.key}\``).join('\n');
      await interaction.reply({ content: `🔑 **Your prize keys** — this reply is visible only to you:\n${list}\nKeep them somewhere safe.`, ephemeral: true });
    }

    else if (cmd === 'link') {
      if (!bucksBridge.enabled) {
        await interaction.reply({ content: '🔗 Swampology linking is not switched on yet. Your Swamp Bucks live right here in the server for now, safe in the King\'s book. The moment the bridge opens, /link will tie them to your Swampology profile.', ephemeral: true });
        return;
      }
      if (rec.websiteUserId) {
        await interaction.reply({ content: `🔗 Already linked. Your Discord and your Swampology profile share one Swamp Bucks balance: **${shopLib.balanceOf(rec)} Bucks**, kept in step by the bridge. Earn or spend on either side and it is the same pile.`, ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const issued = bucksMod.issueLinkCode(store.data, rec, Date.now());
      const reg = await bucksBridge.registerLinkCode(userId, issued.code, issued.expiresAt, shopLib.balanceOf(rec));
      if (!reg.ok) {
        delete store.data.linkCodes[issued.code];
        rec.pendingLinkCode = null;
        rec.pendingLinkAt = 0;
        store.save();
        await interaction.editReply('🔗 The King tried to send your code to Swampology and the water was too rough just now. Nothing was linked and nothing moved. Wait a minute and run /link again.');
        return;
      }
      store.save();
      await interaction.editReply([
        `🔗 **Your Swampology link code is: ${issued.code}**`,
        '',
        'What to do with it:',
        '1. Sign in at Swampology.com and open your profile.',
        '2. Find the Swamp Bucks linking spot and type the code in.',
        '3. Come back here and run any command. The bridge spots the link and your balance follows you.',
        '',
        `The code lives for 15 minutes and works once. Your current balance of **${shopLib.balanceOf(rec)} Swamp Bucks** rides over with it, every last Buck. After linking, your Bucks in Discord and on Swampology are one and the same pile. Bucks stay play money: they cannot be bought, sold or cashed out, here or there.`,
      ].join('\n'));
    }

    else if (cmd === 'quest') {
      const sub = interaction.options.getSubcommand();
      const quest = resetQuestIfNewDay(rec);
      const progress = Math.min(rec.questProgress[quest.type] || 0, quest.target);
      if (sub === 'show') {
        await interaction.reply(`🎯 **Quest of the day:** ${quest.label}\nProgress: **${progress}/${quest.target}** · Reward: ${quest.rewardXp} XP + ${quest.rewardBucks} Bucks${rec.questClaimedKey === rec.questDayKey ? '\n✅ Already claimed today.' : ''}`);
      } else if (sub === 'claim') {
        if (rec.questClaimedKey === rec.questDayKey) { await interaction.reply({ content: 'Already claimed. One quest, one payday.', ephemeral: true }); return; }
        if ((rec.questProgress[quest.type] || 0) < quest.target) { await interaction.reply({ content: `Not done yet: ${progress}/${quest.target} on "${quest.label}". The swamp is patient. Mostly.`, ephemeral: true }); return; }
        rec.questClaimedKey = rec.questDayKey;
        const r = await awardXp(userId, quest.rewardXp, { member: interaction.member, channelId: interaction.channelId });
        const dd = shopLib.applyDoubleDown(rec, quest.rewardBucks); // Double-Down: Bucks only, auto-spent
        await bucksBridge.adjust(rec, dd.bucks, 'daily quest claim');
        addRep(rec, factionsLib.REP_ACTIONS.questClaim); // +5 rep for claiming the daily quest
        const newTitle = titlesLib.unlockAchievement(rec, 'firstQuest');
        store.save();
        await interaction.reply(`✅ Quest complete! +${r.gained} XP (x${r.multiplier.multiplier} with your bonuses), +${dd.bucks} Swamp Bucks${dd.used ? ' (**Double-Down Token spent** - Bucks doubled, XP untouched)' : ''} and +${factionsLib.REP_ACTIONS.questClaim} Rep.${newTitle ? `\n✨ Cosmetic title unlocked: **${newTitle}**` : ''} The King nods. That will do.`);
      }
    }

    else if (cmd === 'faction') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'join') {
        const choice = interaction.options.getString('faction');
        const target = factionsLib.resolveFaction(choice);
        if (!target) { await interaction.reply({ content: 'The King keeps three banners only. Pick one of the three.', ephemeral: true }); return; }
        const check = factionsLib.checkFactionChange(rec, target.id);
        if (!check.ok) { await interaction.reply({ content: `The King shakes his head: ${check.reason}.`, ephemeral: true }); return; }
        const old = factionsLib.factionById(rec.faction);
        if (check.cost) await bucksBridge.adjust(rec, 0 - check.cost, 'faction switch');
        rec.faction = target.id;
        if (!rec.factionJoinedAt) rec.factionJoinedAt = Date.now();
        rec.factionLastSwitchAt = Date.now();
        const newTitle = titlesLib.unlockAchievement(rec, 'factionJoin');
        store.save();
        // Faction roles (optional config): swap best-effort, never crash unset
        if (interaction.member && Object.keys(config.factionRoleIds || {}).length) {
          try {
            if (old && config.factionRoleIds[old.id]) await interaction.member.roles.remove(config.factionRoleIds[old.id]).catch(() => {});
            if (config.factionRoleIds[target.id]) await interaction.member.roles.add(config.factionRoleIds[target.id]).catch(() => {});
          } catch (e) { console.warn('[crocodile-king] faction role swap failed:', e.message); }
        }
        await interaction.reply(`⚔️ <@${userId}> now flies the banner of **${target.name}**. ${target.blurb}${check.isSwitch ? `\nSwitch fee paid: ${check.cost} Swamp Bucks. The old banner (${old ? old.name : 'none'}) gets folded, not burned - your XP, Rep and loot all came with you.` : ''}${newTitle ? `\n✨ Cosmetic title unlocked: **${newTitle}**` : ''}\nEvery point of XP you earn now feeds the ${target.name} war chest. The King is the referee, and the King is watching.`);
      } else if (sub === 'standings') {
        const s = factionsLib.standings(store.data);
        const fmt = (rows) => rows.map((r, i) => `${i + 1}. **${r.name}** - ${r.xp} XP`).join('\n');
        const leader = s.week[0] && s.week[0].xp > 0 ? s.week[0] : null;
        const kingLine = leader
          ? (leader.id === 'kings-court' ? 'The Court leads. Naturally. The King pretends to be surprised.' : `${leader.name} leads the week. The Court has been notified, and the King is enjoyin\' this more than he should.`)
          : 'No faction XP on the board this week yet. The war chest sits empty and the King drums his claws.';
        await interaction.reply(`⚔️ **Faction standings - week ${s.weekKey}**\n${fmt(s.week)}\n\n**All-time**\n${fmt(s.allTime)}\n\n🐊 ${kingLine}`);
      } else if (sub === 'info') {
        const mine = factionsLib.factionById(rec.faction);
        const list = factionsLib.FACTIONS.map(f => `**${f.name}** - ${f.blurb}`).join('\n');
        await interaction.reply(`⚔️ **The three banners of THE SWAMP**\n${list}\n\nYou fly: **${mine ? mine.name : 'no banner yet'}**. Join or switch with /faction join (first join free; switching costs ${factionsLib.SWITCH_COST_BUCKS} Swamp Bucks with a 7-day cooldown, and clears nothing).`);
      }
    }

    else if (cmd === 'inventory') {
      const target = interaction.options.getUser('member') || interaction.user;
      const tRec = store.user(target.id);
      const items = lootLib.inventoryList(tRec);
      if (!items.length) { await interaction.reply(`${target.username}'s bag is empty. Loot drops from /daily, level-ups and events - and pass holders roll one extra every time. Go get muddy.`); return; }
      const text = items.map(i => `- **${i.name}** x${i.count} (${i.rarity}) - ${i.hint}`).join('\n');
      await interaction.reply(`🎒 **${target.username}'s inventory** (${lootLib.inventoryCount(tRec)} items)\n${text}`);
    }

    else if (cmd === 'raid') {
      if (lootLib.countItem(rec, lootLib.RAID_PASS) < 1) {
        await interaction.reply({ content: 'No Raid Pass in your bag, no raid. Passes come from loot rolls (daily, level-ups, events), sponsor quests, and the Welcome Pack when you first verify. Check /inventory.', ephemeral: true });
        return;
      }
      if (activeEvents.has(interaction.channelId)) { await interaction.reply({ content: 'There is already an event live in this channel. Your pass stays in your bag - spend it where the water is quiet.', ephemeral: true }); return; }
      const last = (store.data.channelRaidLastAt && store.data.channelRaidLastAt[interaction.channelId]) || 0;
      const waitMs = 30 * 60 * 1000 - (Date.now() - last);
      if (last && waitMs > 0) { await interaction.reply({ content: `This channel just had a raid. The water needs ${Math.ceil(waitMs / 60000)} more minute(s) to settle before the next one. Your pass is unspent.`, ephemeral: true }); return; }
      lootLib.consumeItem(rec, lootLib.RAID_PASS, 1);
      if (!store.data.channelRaidLastAt) store.data.channelRaidLastAt = {};
      store.data.channelRaidLastAt[interaction.channelId] = Date.now();
      store.save();
      await interaction.reply(`🎟️ <@${userId}> slaps a **Raid Pass** on the dock table. The Crocodile King honours it: a server-wide event rises in this channel, and the **2x XP channel bonus** is live while it stands.`);
      await spawnEvent(interaction.channel, 'raid boss', userId);
    }

    else if (cmd === 'title') {
      const sub = interaction.options.getSubcommand();
      titlesLib.ensureTitles(rec);
      if (sub === 'show') {
        const owned = titlesLib.ownedTitles(rec);
        const lvl = xpLib.levelFromXp(rec.xp);
        const achiev = Object.entries(titlesLib.ACHIEVEMENT_TITLES)
          .map(([k, t]) => `- **${t.name}** - ${rec.unlockedTitles.includes(t.name) ? '✅ owned' : `locked: ${t.how}`}`).join('\n');
        await interaction.reply(`✨ **${interaction.user.username}'s cosmetic titles** (shown next to your ladder title, *${ladderTitleFor(lvl.level)}*)\nActive: **${rec.activeTitle || 'none set'}**\nGenerated title: ${rec.generatedTitle ? `**${rec.generatedTitle}**` : `not minted yet - it mints at Level 5 (you are ${lvl.level})`}\n\n**Achievement titles**\n${achiev}\n\nSwitch with /title set, re-roll the generated one with /title generate (once per level).`);
      } else if (sub === 'set') {
        const wanted = interaction.options.getString('title');
        const owned = titlesLib.ownedTitles(rec);
        const match = owned.find(t => t.toLowerCase() === wanted.trim().toLowerCase());
        if (!match) { await interaction.reply({ content: `That title is not in your collection. Yours: ${owned.length ? owned.join(' · ') : 'none yet'}.`, ephemeral: true }); return; }
        rec.activeTitle = match; store.save();
        await interaction.reply(`✨ Cosmetic title set: **${match}**. It rides next to your name on /profile and the /leaderboard from now on. The King approves of the tailoring.`);
      } else if (sub === 'generate') {
        const lvl = xpLib.levelFromXp(rec.xp);
        const r = titlesLib.regenerateTitle(rec, lvl.level);
        if (!r.ok) { await interaction.reply({ content: r.reason, ephemeral: true }); return; }
        rec.activeTitle = r.title; store.save();
        await interaction.reply(`✨ The King's title-maker turns its crank... your generated cosmetic title is now: **${r.title}**. Set active automatically. Next re-roll at level ${lvl.level + 1}.`);
      }
    }

    else if (cmd === 'sidequest') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'get') {
        if (rec.sideQuest) { await interaction.reply({ content: `You already carry a side quest: "${rec.sideQuest.label}" - progress ${rec.sideQuest.progress || 0}/${rec.sideQuest.target}. Finish it with /sidequest claim, or /sidequest drop it first. One at a time - the King's satchel is not a warehouse.`, ephemeral: true }); return; }
        const lvl = xpLib.levelFromXp(rec.xp);
        const q = questgenLib.generateSideQuest({ level: lvl.level, seed: (Date.now() % 100000) + lvl.level });
        rec.sideQuest = { ...q, progress: 0, createdAt: new Date().toISOString() };
        store.save();
        await interaction.reply(`🗺️ **A side quest from the King's own generator:**\n${q.label}\nReward: **${q.rewardXp} XP + ${q.rewardBucks} Swamp Bucks** (+${factionsLib.REP_ACTIONS.sideQuest} Rep, and a 25% chance at bonus loot on claim). Track it with /sidequest show - it rides the same counters as your daily quest.`);
      } else if (sub === 'show') {
        if (!rec.sideQuest) { await interaction.reply({ content: 'No side quest on your hook. Run /sidequest get and the King will compose one for you on the spot.', ephemeral: true }); return; }
        await interaction.reply(`🗺️ **Your side quest:** ${rec.sideQuest.label}\nProgress: **${rec.sideQuest.progress || 0}/${rec.sideQuest.target}** · Reward: ${rec.sideQuest.rewardXp} XP + ${rec.sideQuest.rewardBucks} Bucks`);
      } else if (sub === 'claim') {
        if (!rec.sideQuest) { await interaction.reply({ content: 'Nothing to claim. /sidequest get first.', ephemeral: true }); return; }
        if ((rec.sideQuest.progress || 0) < rec.sideQuest.target) { await interaction.reply({ content: `Not done: ${rec.sideQuest.progress || 0}/${rec.sideQuest.target} on "${rec.sideQuest.label}". The swamp provides, but it does not do the work for you.`, ephemeral: true }); return; }
        const q = rec.sideQuest;
        rec.sideQuest = null;
        const r = await awardXp(userId, q.rewardXp, { member: interaction.member, channelId: interaction.channelId });
        const dd = shopLib.applyDoubleDown(rec, q.rewardBucks); // Double-Down: Bucks only, auto-spent
        await bucksBridge.adjust(rec, dd.bucks, 'side quest claim');
        addRep(rec, factionsLib.REP_ACTIONS.sideQuest);
        let lootLine = '';
        if (Math.random() < 0.25) { const items = grantLoot(rec, interaction.member, 1); lootLine = `\n🎁 **Bonus loot (the 1-in-4 smiled):** ${lootText(items)}`; }
        store.save();
        await interaction.reply(`✅ Side quest complete! +${r.gained} XP (x${r.multiplier.multiplier} with your bonuses), +${dd.bucks} Swamp Bucks${dd.used ? ' (**Double-Down Token spent** - Bucks doubled, XP untouched)' : ''} and +${factionsLib.REP_ACTIONS.sideQuest} Rep.${lootLine}`);
      } else if (sub === 'drop') {
        if (!rec.sideQuest) { await interaction.reply({ content: 'No side quest to drop. Clean hook.', ephemeral: true }); return; }
        rec.sideQuest = null; store.save();
        await interaction.reply('Side quest dropped back in the water. No penalty - the King respects a clean retreat. /sidequest get whenever you want another.');
      }
    }

    else if (cmd === 'store') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'show') {
        await interaction.reply(shopLib.boardText(shopLib.balanceOf(rec), rec));
      } else if (sub === 'open') {
        // The member's own storefront: same pages/buttons as the pinned
        // board, ephemeral, with their balance and wardrobe on it.
        const view = storefrontLib.buildStorefront('decor', rec);
        await interaction.reply({ embeds: view.embeds, components: view.components, files: view.files, ephemeral: true });
      } else if (sub === 'post') {
        if (!isMod) { await interaction.reply({ content: 'Mods hang the storefront sign. The King likes his shopfront official.', ephemeral: true }); return; }
        const view = storefrontLib.buildStorefront('decor', null);
        const msg = await interaction.channel.send({ embeds: view.embeds, components: view.components, files: view.files });
        await interaction.reply({ content: `🛒 Storefront posted in this channel${msg ? ` (${msg.id})` : ''}. **Pin it** and it is the shop door for good - its buttons keep working across restarts, nothing is stored on the message. Members can also run /store open anywhere for a personal copy.`, ephemeral: true });
      } else if (sub === 'buy') {
        const r = await storeBuyText(interaction, rec, interaction.options.getString('item'));
        await interaction.reply(r.ok ? r.text : { content: r.text, ephemeral: true });
      } else if (sub === 'sell') {
        const bucksBefore = shopLib.balanceOf(rec);
        const r = storeSellText(rec, interaction.options.getString('item'));
        if (r.ok) { await bucksBridge.settleDelta(rec, bucksBefore, 'store sell'); store.save(); }
        await interaction.reply(r.ok ? r.text : { content: r.text, ephemeral: true });
      }
    }

    else if (cmd === 'avatarframe') {
      const sub = interaction.options.getSubcommand();
      avatarLib.ensureWardrobe(rec);
      if (sub === 'list') {
        const owned = avatarLib.FRAMES.filter(f => avatarLib.ownsFrame(rec, f.id));
        const worn = avatarLib.equippedFrame(rec);
        const ownedText = owned.length
          ? owned.map(f => `- **${f.name}**${worn && worn.id === f.id ? ' 🖼️ *worn on your /profile card*' : ''}`).join('\n')
          : 'Empty. The store shelf is that way: /store show - frames are bought with Swamp Bucks, owned forever.';
        const shopText = avatarLib.FRAMES.filter(f => !avatarLib.ownsFrame(rec, f.id))
          .map(f => `- **${f.name}** - ${f.price} Swamp Bucks`).join('\n');
        await interaction.reply(`🖼️ **${interaction.user.username}'s frame wardrobe** (${owned.length}/${avatarLib.FRAMES.length})\n${ownedText}\n\n**Straight talk from the King:** Discord does not let any bot put decorations on your Discord profile - not his, not anyone's. What he CAN do: /avatarframe apply builds your current Discord avatar inside the frame and hands you the finished picture, and you upload it as your own avatar. That is how it truly shows. Owned frames also ride on your /profile card here.${shopText ? `\n\n**Not yet owned** (buy with /store buy)\n${shopText}` : ''}`);
      } else if (sub === 'apply') {
        const frameId = interaction.options.getString('frame');
        const def = avatarLib.frameById(frameId);
        if (!def) { await interaction.reply({ content: 'That frame is not in the King\'s collection. /avatarframe list shows the real shelf.', ephemeral: true }); return; }
        if (!avatarLib.ownsFrame(rec, frameId)) { await interaction.reply({ content: `You do not own **${def.name}** yet. It sits in /store at ${def.price} Swamp Bucks - buy it once and it is yours forever, applying is always free.`, ephemeral: true }); return; }
        await interaction.deferReply({ ephemeral: true });
        try {
          const url = interaction.user.displayAvatarURL({ extension: 'png', size: 512 });
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`avatar fetch ${resp.status}`);
          const avatarBuf = Buffer.from(await resp.arrayBuffer());
          const png = await avatarLib.compositeFramedAvatar(avatarBuf, frameId);
          avatarLib.equipFrame(rec, frameId);
          store.save();
          const file = new AttachmentBuilder(png, { name: 'crocodile-king-framed-avatar.png' });
          await interaction.followUp({ content: `🖼️ **${def.name}**, fitted to your current face. Download this picture and upload it as your Discord avatar - that part only you can do, no bot can touch your profile. It is now also the frame worn on your /profile card here. Re-apply any time (new avatar picture, same frame), always free.`, files: [file], ephemeral: true });
        } catch (e) {
          console.warn('[crocodile-king] avatar frame composite failed:', e.message);
          await interaction.followUp({ content: 'The King\'s picture press jammed on that one - your frame is safe in your wardrobe and nothing was charged (applying never charges). Try again in a minute.', ephemeral: true });
        }
      }
    }

    else if (cmd === 'trivia') {
      if (!spendActionPoint(rec, interaction.member)) { store.save(); await interaction.reply({ content: `The King's games run on action points, and yours are spent. ${actionPointRefillLine(rec, interaction.member)}`, ephemeral: true }); return; }
      store.save();
      const t = content.TRIVIA[Math.floor(Math.random() * content.TRIVIA.length)];
      pendingGames.set(`${interaction.channelId}:${userId}`, { type: 'trivia', answers: t.a, display: t.a[0], expiresAt: Date.now() + 2 * 60 * 1000 });
      await interaction.reply(`❓ **Swamp Trivia:** ${t.q}\n*Hint: ${t.hint}* - type your answer in this channel within 2 minutes. Right answer pays XP and +1 Rep. *(1 action point spent, ${rec.actionPoints} left today.)*`);
    }

    else if (cmd === 'gator') {
      if (!spendActionPoint(rec, interaction.member)) { store.save(); await interaction.reply({ content: `The gator is full and so is your tab - no action points left. ${actionPointRefillLine(rec, interaction.member)}`, ephemeral: true }); return; }
      store.save();
      const g = content.GATOR_WORDS[Math.floor(Math.random() * content.GATOR_WORDS.length)];
      pendingGames.set(`${interaction.channelId}:${userId}`, { type: 'gator', answers: [g.word], display: g.word, expiresAt: Date.now() + 2 * 60 * 1000 });
      await interaction.reply(`🐊 **Gator Ate My Answer!** The gator swallowed the middle of a word. Clue: *${g.clue}*\nThe word looks like: **${content.hideWord(g.word)}** (${g.word.length} letters). Type the whole word here within 2 minutes to win XP. *(1 action point spent, ${rec.actionPoints} left today.)*`);
    }

    else if (cmd === 'event') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'start') {
        if (!isAdmin) { await interaction.reply({ content: 'Admins ring the event bell. Not you. Not today.', ephemeral: true }); return; }
        if (activeEvents.has(interaction.channelId)) { await interaction.reply({ content: 'There\'s already an event live in this channel. Finish that one first.', ephemeral: true }); return; }
        const kind = interaction.options.getString('kind') || 'swamp boss';
        await interaction.reply({ content: `The Crocodile King is summoning a **${kind}**... this channel now carries a **2x XP event bonus** while it lives.`, ephemeral: false });
        await spawnEvent(interaction.channel, kind, userId);
      } else if (sub === 'stop') {
        if (!isAdmin) { await interaction.reply({ content: 'Admins only.', ephemeral: true }); return; }
        if (!activeEvents.has(interaction.channelId)) { await interaction.reply({ content: 'No live event in this channel.', ephemeral: true }); return; }
        const ev = activeEvents.get(interaction.channelId);
        activeEvents.delete(interaction.channelId);
        await interaction.reply(`Event over. The ${ev.kind} sinks back under with ${ev.hp} HP left and ${ev.participants.size} participant(s) on the books. Channel bonus off.`);
      } else if (sub === 'lure') {
        // Event Lure (Swamp Specials consumable): member-spent, NOT admin.
        // Refusals never consume the lure; the 30-min channel cooldown rules.
        if (shopLib.countConsumable(rec, 'event-lure') < 1) { await interaction.reply({ content: 'No Event Lure in your pocket. The King sells them in /store - Swamp Specials page, 250 Swamp Bucks.', ephemeral: true }); return; }
        if (activeEvents.has(interaction.channelId)) { await interaction.reply({ content: 'There is already an event live in this channel - the water is occupied. Your lure stays in your pocket, unspent.', ephemeral: true }); return; }
        const cd = shopLib.eventCooldown(store.data, interaction.channelId);
        if (cd.onCooldown) { await interaction.reply({ content: `This channel's water is still settling from the last ruckus. It clears in about **${Math.ceil(cd.waitMs / 60000)} minute(s)** - your lure stays in your pocket, unspent, until then.`, ephemeral: true }); return; }
        shopLib.consumeConsumable(rec, 'event-lure');
        if (!store.data.channelRaidLastAt) store.data.channelRaidLastAt = {};
        store.data.channelRaidLastAt[interaction.channelId] = Date.now();
        store.save();
        const kinds = ['swamp boss', 'treasure chest', 'gator ambush', 'murk storm'];
        const kind = kinds[Math.floor(Math.random() * kinds.length)];
        await interaction.reply(`🪱 <@${userId}> drops an **Event Lure** in the water... something big turns toward the smell. A **${kind}** rises in this channel, and the **2x XP channel bonus** is live while it stands. (${shopLib.countConsumable(rec, 'event-lure')} lure(s) left in your pocket.)`);
        await spawnEvent(interaction.channel, kind, userId);
      }
    }

    else if (cmd === 'sponsorquest') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'create') {
        if (!isAdmin) { await interaction.reply({ content: 'Admins only - sponsor money is serious money.', ephemeral: true }); return; }
        const sq = {
          id: `sq_${Date.now()}`,
          title: interaction.options.getString('title'),
          sponsor: interaction.options.getString('sponsor'),
          description: interaction.options.getString('description') || '',
          rewardXp: interaction.options.getInteger('rewardxp') || 100,
          rewardBucks: interaction.options.getInteger('rewardbucks') || 25,
          roleId: interaction.options.getString('role_id') || null, // optional Discord role granted to winners
          keys: [], // sponsor-provided digital prize keys, held only until awarded - never printed anywhere
          createdAt: new Date().toISOString(), active: true, awards: [],
        };
        store.data.sponsorQuests.push(sq);
        activeSponsorQuestId = sq.id;
        store.save();
        await interaction.reply(line('sponsorQuest', { sponsor: sq.sponsor, title: sq.title, description: sq.description, xp: sq.rewardXp, bucks: sq.rewardBucks }, Date.now()));
      } else if (sub === 'addkey') {
        if (!isAdmin) { await interaction.reply({ content: 'Admins only.', ephemeral: true }); return; }
        const sq = store.data.sponsorQuests.find(q => q.id === activeSponsorQuestId && q.active) || store.data.sponsorQuests.filter(q => q.active).pop();
        if (!sq) { await interaction.reply({ content: 'No active sponsor quest to hold a key for. Create one first.', ephemeral: true }); return; }
        if (!Array.isArray(sq.keys)) sq.keys = [];
        sq.keys.push({ key: interaction.options.getString('key'), used: false, awardedTo: null });
        store.save();
        // Confirmation is counts only - the key itself is never echoed back anywhere.
        await interaction.reply({ content: `🔑 Key stored for "${sq.title}". Pool now holds ${sq.keys.filter(k => !k.used).length} unused key(s). It will only ever be shown to its winner, by /prize, in a reply only they can see.`, ephemeral: true });
      } else if (sub === 'complete') {
        if (!isAdmin) { await interaction.reply({ content: 'Admins only.', ephemeral: true }); return; }
        const sq = store.data.sponsorQuests.find(q => q.id === activeSponsorQuestId && q.active) || store.data.sponsorQuests.filter(q => q.active).pop();
        if (!sq) { await interaction.reply({ content: 'No active sponsor quest to complete against.', ephemeral: true }); return; }
        const target = interaction.options.getUser('member');
        const tRec = store.user(target.id);
        let tMember = interaction.guild ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;
        const r = await awardXp(target.id, sq.rewardXp, { member: tMember, channelId: interaction.channelId });
        await bucksBridge.adjust(tRec, sq.rewardBucks, 'sponsor quest');
        addRep(tRec, factionsLib.REP_ACTIONS.sponsorQuest); // +4 rep for a sponsor quest completion
        const newTitle = titlesLib.unlockAchievement(tRec, 'firstSponsor');
        // Optional winner role (best-effort: a bad role ID must never fail the award)
        let roleGranted = false;
        if (sq.roleId && tMember) {
          try { await tMember.roles.add(sq.roleId); roleGranted = true; } catch (e) { console.warn('[crocodile-king] sponsor role grant failed:', e.message); }
        }
        // Digital key: pop the next unused one and hold it on the winner's
        // record. NO DMS (owner rule, 2026-11-08): the winner views it with
        // /prize, an ephemeral reply only they can see, inside the server.
        // The key itself is never posted in a public channel.
        let keyAwarded = false;
        if (Array.isArray(sq.keys)) {
          const entry = sq.keys.find(k => !k.used);
          if (entry) {
            entry.used = true; entry.awardedTo = target.id;
            if (!Array.isArray(tRec.pendingKeys)) tRec.pendingKeys = [];
            tRec.pendingKeys.push({ title: sq.title, sponsor: sq.sponsor, key: entry.key, at: new Date().toISOString() });
            keyAwarded = true;
          }
        }
        sq.awards.push({ userId: target.id, at: new Date().toISOString(), roleGranted, keyAwarded }); // ID + timestamp + award flags only, no private info, never the key
        store.save();
        await interaction.reply(`**Sponsored** quest complete for <@${target.id}>: +${r.gained} XP, +${sq.rewardBucks} Swamp Bucks and +${factionsLib.REP_ACTIONS.sponsorQuest} Rep, courtesy of ${sq.sponsor}.${roleGranted ? ' Winner role granted.' : ''}${keyAwarded ? ' Their prize key is being held for them: it shows only to them when they run /prize.' : ''}${newTitle ? `\n✨ Cosmetic title unlocked for them: **${newTitle}**` : ''}`);
      } else if (sub === 'report') {
        if (!isAdmin) { await interaction.reply({ content: 'Admins only.', ephemeral: true }); return; }
        const month = new Date().toISOString().slice(0, 7);
        const rows = store.data.sponsorQuests.filter(q => (q.createdAt || '').startsWith(month));
        const totalAwards = rows.reduce((a, q) => a + q.awards.length, 0);
        const text = rows.length
          ? rows.map(q => `- ${q.sponsor}: "${q.title}" - ${q.awards.length} participant award(s), ${q.active ? 'active' : 'closed'}`).join('\n')
          : 'No sponsor quests this month.';
        await interaction.reply({ content: `📋 **Sponsor report for ${month}** (counts only, no member private info)\nQuests: ${rows.length} · Total participant awards: ${totalAwards}\n${text}`, ephemeral: true });
      }
    }

    else if (cmd === 'unverified') {
      if (!isMod) { await interaction.reply({ content: 'Mods only. The gate list is gate business.', ephemeral: true }); return; }
      const now = Date.now();
      const rows = Object.values(store.data.users).filter(u => !u.verified && u.joinedAt);
      if (!rows.length) { await interaction.reply({ content: 'Gate\'s clear - nobody unverified on the books. Beautiful day.', ephemeral: true }); return; }
      const text = rows.slice(0, 20).map(u => {
        const hrs = ((now - u.joinedAt) / 3600000).toFixed(1);
        return `- <@${u.userId}> - unverified for ${hrs}h (reminder stage ${u.reminderStage}/3)`;
      }).join('\n');
      await interaction.reply({ content: `🚪 **Unverified at the gate (${rows.length}):**\n${text}`, ephemeral: true });
    }

    else if (cmd === 'givexp') {
      if (!isAdmin) { await interaction.reply({ content: 'Admins only.', ephemeral: true }); return; }
      const target = interaction.options.getUser('member');
      const amount = interaction.options.getInteger('amount');
      let tMember = interaction.guild ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;
      const r = await awardXp(target.id, amount, { member: tMember, channelId: interaction.channelId });
      await interaction.reply(`The Crocodile King writes it in the book: <@${target.id}> gets +${r.gained} XP (base ${amount} x${r.multiplier.multiplier}). Done. No take-backs.`);
    }

    else if (cmd === 'giveitem') {
      if (!isAdmin) { await interaction.reply({ content: 'Admins only. The loot vault has one key and it is not yours.', ephemeral: true }); return; }
      const target = interaction.options.getUser('member');
      const item = interaction.options.getString('item');
      const count = interaction.options.getInteger('count') || 1;
      if (!lootLib.lootItem(item)) { await interaction.reply({ content: `No such loot in the King's table. Items: ${lootLib.LOOT_TABLE.map(i => i.name).join(', ')}.`, ephemeral: true }); return; }
      const tRec = store.user(target.id);
      lootLib.addItem(tRec, item, count);
      store.save();
      await interaction.reply(`🎁 The Crocodile King stocks <@${target.id}>'s bag: **${item} x${count}**. ${item === lootLib.RAID_PASS ? 'That is a live raid in a wrapper - /raid spends it.' : 'No receipt. Royal generosity.'}`);
    }

    else if (cmd === 'givepass') {
      if (!isAdmin) { await interaction.reply({ content: 'Admins only. Passes come from the throne, not from asking nicely.', ephemeral: true }); return; }
      const target = interaction.options.getUser('member');
      const days = interaction.options.getInteger('days') || 30;
      const tRec = store.user(target.id);
      const nowMs = Date.now();
      const base = isPassActive(tRec) ? tRec.passUntil : nowMs; // extend a live pass, never shorten it
      tRec.passUntil = base + days * 24 * 60 * 60 * 1000;
      ensureActionPoints(tRec, null);
      store.save();
      await interaction.reply(`🎫 **VIP Pass** written for <@${target.id}>: ${days} day(s), live until **${new Date(tRec.passUntil).toISOString().slice(0, 10)}**. While it runs they get the x1.5 XP line, +1 loot roll wherever loot rolls, and 8 action points a day. The King keeps the stamp.`);
    }

    else if (cmd === 'hostsay') {
      if (!isAdmin) { await interaction.reply({ content: 'Admins hold the King\'s microphone.', ephemeral: true }); return; }
      const text = interaction.options.getString('message');
      await interaction.channel.send(`🐊 **Crocodile King says:** ${text}`);
      await interaction.reply({ content: 'Said it. In character, obviously.', ephemeral: true });
    }

    else if (cmd === 'welcomepost') {
      if (!isAdmin) { await interaction.reply({ content: 'Admins hold the King\'s microphone.', ephemeral: true }); return; }
      const resolved = await resolveWelcomeChannel(interaction.guild, interaction.channel);
      if (!resolved) { await interaction.reply({ content: 'Discord would not let me post in the wired welcome channel, or in any welcome door I can find here. Locked channels keep their own guest list - check my role on that channel\'s own permissions, then run this again.', ephemeral: true }); return; }
      healWelcomeChannel(resolved);
      const ch = resolved.channel;
      const msg = await ch.send(content.WELCOME_POST);
      await msg.pin().catch(() => {});
      await interaction.reply({ content: `Posted in <#${ch.id}> - and pinned, so it stays on top.`, ephemeral: true });
    }
  } catch (e) {
    console.error('[crocodile-king] command error:', e);
    if (!interaction.replied) await interaction.reply({ content: 'The Crocodile King tripped on a cypress knee runnin\' that. Try again. He logged it.', ephemeral: true }).catch(() => {});
  }
});

/* ---------------- boot ----------------
 * Login runs in a retry loop, not a single shot: a transient connect
 * timeout on the hosting network used to kill the login for good
 * while the process (and health server) stayed up looking healthy.
 * Attempts back off 10s, 20s, 40s, then cap at 60s, forever, until
 * one lands; ClientReady then fires exactly as before. The loop is
 * strictly sequential - it can never race itself. */
let loginLoopStarted = false;
async function loginWithRetry() {
  if (loginLoopStarted) return;
  loginLoopStarted = true;
  const backoffs = [10 * 1000, 20 * 1000, 40 * 1000, 60 * 1000];
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      await client.login(config.token);
      console.log(`[crocodile-king] login succeeded on attempt ${attempt}`);
      return;
    } catch (e) {
      const delay = backoffs[Math.min(attempt - 1, backoffs.length - 1)];
      console.error(`[crocodile-king] login attempt ${attempt} failed: ${e.message} - retrying in ${delay / 1000}s`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

if (!config.token) {
  console.error('[crocodile-king] DISCORD_TOKEN is not set. Copy .env.example to .env, fill it in, then run: npm start');
  console.error('[crocodile-king] Health server is still running so hosting checks pass, but the bot cannot log in without a token.');
} else {
  loginWithRetry();
}
