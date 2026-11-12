'use strict';
/** Local JSON persistence. No external DB, no Firebase, no Supabase.
 *  Atomic writes: write to .tmp then rename over the real file.
 *  v2.2: the store also carries the server CONFIG (data.config) - the
 *  /setup wiring written from inside Discord (see src/setup.js). Env IDs
 *  only seed it; in-server picks live here and survive restarts. */
const fs = require('fs');
const path = require('path');
const { blankHomeConfig, mergeHomeConfig, seedHomeConfig } = require('./setup');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

function blankStore() {
  return {
    config: blankHomeConfig(), // /setup wiring (channels/roles) - src/setup.js owns the shape
    users: {},          // userId -> user record (see blankUser)
    sponsorQuests: [],  // { id, title, sponsor, description, rewardXp, rewardBucks, roleId, keys:[{key, used, awardedTo}], createdAt, active, awards:[{userId, at, roleGranted, keyAwarded}] }
    linkCodes: {},      // Swamp Bucks Bridge: code -> { discordId, seedBucks, expiresAt, createdAt } (see src/bucksbridge.js; codes also live on the website once pushed)
    factions: { weekly: {}, allTime: {} }, // weekly: { '2026-W45': { factionName: baseXp } }, allTime: { factionName: baseXp }
    channelRaidLastAt: {}, // channelId -> ms epoch of last member-triggered /raid (30 min cooldown)
    createdAt: new Date().toISOString(),
  };
}

function blankUser(userId) {
  return {
    userId,
    xp: 0,
    level: 1,
    swampBucks: 0,
    streak: 0,
    lastDailyKey: null,      // Halifax date key of last /daily
    lastMessageXpAt: 0,      // ms epoch, 60s message-XP cooldown
    joinedAt: null,          // ms epoch (guild join)
    verified: false,
    verifiedAt: null,
    reminderStage: 0,        // 0 none sent, 1 = 30min sent, 2 = 2h mod nudge sent, 3 = 24h re-nudge sent
    questDayKey: null,       // Halifax date key the quest progress belongs to
    questProgress: { messages: 0, voiceMinutes: 0, reactions: 0, artPosts: 0, triviaCorrect: 0 },
    questClaimedKey: null,
    totalMessages: 0,
    totalVoiceMinutes: 0,
    // --- v2 systems ---
    faction: null,             // faction id (see factions.js) or null until joined
    factionJoinedAt: null,     // ms epoch of first join
    factionLastSwitchAt: 0,    // ms epoch of last join/switch (7-day switch cooldown)
    rep: 0,                    // reputation, its own stat (see factions.js REP_RANKS)
    inventory: {},             // loot: item name -> count (see loot.js)
    unlockedTitles: [],        // achievement cosmetic titles owned
    activeTitle: null,         // cosmetic title currently shown
    generatedTitle: null,      // level-5 generated cosmetic title
    titleGenLevel: 0,          // level at which the generated title was last (re)rolled
    passUntil: 0,              // ms epoch: timed VIP Pass expiry (0 = no pass)
    actionPoints: 5,           // daily action points left (trivia / gator cost 1)
    actionDayKey: null,        // Halifax date key the action points belong to
    sideQuest: null,           // active generated side quest { type, target, progress, label, theme, rewardXp, rewardBucks, createdAt }
    lastBoostPackMonth: null,  // 'YYYY-MM' (Halifax) of the last Booster Pack paid - once-per-month gate
    // --- v2.1 store ---
    tonicDayKey: null,         // Halifax date key of the last Firefly Tonic bought - 1/day gate
    frames: [],                // wardrobe: avatar frame ids owned (see avatarframe.js) - permanent
    equippedFrame: null,       // avatar frame id currently decorating the /profile card
    backgrounds: [],           // profile background ids owned (see backgrounds.js) - permanent
    equippedBackground: null,  // background id shown on the /profile card (newest owned)
    consumables: {},           // Swamp Specials counts: 'streak-shield' | 'double-down' | 'event-lure' -> count
    // --- Swamp Bucks Bridge (src/bucksbridge.js) ---
    websiteUserId: null,       // Swampology account id once /link lands; null = local book only
    bucksOutbox: [],           // signed changes queued while the website was unreachable: { delta, reason, idempotencyKey, at }
    pendingLinkCode: null,     // last /link code issued, while it can still be redeemed
    pendingLinkAt: 0,          // ms epoch the pending code was issued
    pendingKeys: [],           // sponsor prize keys held for this member, viewed with /prize (never DM'd)
    // --- profile system (src/profilecard.js) ---
    profile: null,             // { bio, favColor, privacy, banner, bannerUrl, style, timezone, mood, showcase, pet, wall, habitat } - backfilled by ensureProfile
  };
}

class Store {
  constructor(filePath = STORE_PATH) {
    this.path = filePath;
    this.data = blankStore();
    this.load();
  }
  load() {
    try {
      if (fs.existsSync(this.path)) {
        const parsed = JSON.parse(fs.readFileSync(this.path, 'utf8'));
        if (parsed && typeof parsed === 'object') this.data = Object.assign(blankStore(), parsed);
        // Backfill v2 top-level pools for stores written by v1
        if (!this.data.factions || typeof this.data.factions !== 'object') this.data.factions = { weekly: {}, allTime: {} };
        if (!this.data.factions.weekly) this.data.factions.weekly = {};
        if (!this.data.factions.allTime) this.data.factions.allTime = {};
        if (!this.data.channelRaidLastAt) this.data.channelRaidLastAt = {};
        if (!this.data.linkCodes || typeof this.data.linkCodes !== 'object') this.data.linkCodes = {};
        // v2.2: backfill/normalize the stored /setup config for older stores
        this.data.config = mergeHomeConfig(this.data.config, {});
      }
    } catch (e) {
      console.warn('[store] could not read store.json, starting fresh:', e.message);
      this.data = blankStore();
    }
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      const tmp = this.path + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.path);
    } catch (e) {
      console.warn('[store] save failed:', e.message);
    }
  }
  /* -------- stored /setup config (v2.2) -------- */
  /** The stored server config, normalized. Never null. */
  getConfig() {
    this.data.config = mergeHomeConfig(this.data.config, {});
    return this.data.config;
  }
  /** Apply a /setup patch (known keys only). Nested level/faction role
   *  maps are merged key-by-key so one panel pick never wipes the rest.
   *  Returns the new config. Caller saves. */
  setConfig(patch) {
    const cur = this.getConfig();
    const merged = mergeHomeConfig(cur, patch);
    if (patch && typeof patch === 'object') {
      if (patch.levelRoleIds && typeof patch.levelRoleIds === 'object') {
        merged.levelRoleIds = { ...cur.levelRoleIds, ...patch.levelRoleIds };
      }
      if (patch.factionRoleIds && typeof patch.factionRoleIds === 'object') {
        merged.factionRoleIds = { ...cur.factionRoleIds, ...patch.factionRoleIds };
      }
    }
    this.data.config = merged;
    return this.data.config;
  }
  /** Seed blank config fields from env (boot). Never overwrites /setup picks. */
  seedConfig(seed) {
    this.data.config = seedHomeConfig(this.getConfig(), seed);
    return this.data.config;
  }
  /** /setup reset: stored config back to the env seed, nothing else touched. */
  resetConfig(seed) {
    this.data.config = seedHomeConfig(blankHomeConfig(), seed);
    return this.data.config;
  }

  user(userId) {
    if (!this.data.users[userId]) {
      this.data.users[userId] = blankUser(userId);
    }
    // Backfill any fields added in later versions. Nested v2 containers are
    // shallow-merged by the assign, so re-check their shapes defensively.
    this.data.users[userId] = Object.assign(blankUser(userId), this.data.users[userId]);
    const u = this.data.users[userId];
    if (!u.inventory || typeof u.inventory !== 'object') u.inventory = {};
    if (!Array.isArray(u.unlockedTitles)) u.unlockedTitles = [];
    if (!Array.isArray(u.frames)) u.frames = [];
    if (!Array.isArray(u.backgrounds)) u.backgrounds = [];
    if (!u.consumables || typeof u.consumables !== 'object') u.consumables = {};
    if (!Array.isArray(u.bucksOutbox)) u.bucksOutbox = [];
    if (u.profile !== null && (typeof u.profile !== 'object' || Array.isArray(u.profile))) u.profile = null;
    return u;
  }
}

module.exports = { Store, blankUser, blankStore, STORE_PATH };
