'use strict';
/**
 * Swamp Bingo link - the bridge between Swamp Bingo wins on
 * Swampology.com and THE SWAMP Discord server.
 *
 * THE SHAPE OF IT
 * - An admin runs /swampbingo start once. That creates the
 *   "Chomp & Daub" role (hot pink, to match the badge), records the
 *   announcement channel, and switches linking ON.
 * - /swampbingo play brings up the games: an embed with a Play button
 *   to the Swamp Bingo page on Swampology.com. Until a play URL is
 *   configured (the url option on /swampbingo start, or the
 *   SWAMP_BINGO_URL env var), it says the games open on the website
 *   soon instead of showing a dead link.
 * - When a player wins on the website, the site calls
 *   POST /swampbingo/win with a shared secret (env
 *   SWAMPBINGO_WEBHOOK_SECRET, same value on the website). The bot
 *   resolves the winner's Swampology profile to a linked Discord
 *   member through the SAME mapping the /link flow built
 *   (rec.websiteUserId - see src/bucksbridge.js), grants the
 *   Chomp & Daub role, and announces the win in the announcement
 *   channel. Server channels only - the King never DMs anyone.
 * - If the winner has no linked Discord account, the endpoint answers
 *   404 { ok:false, reason:'unlinked' } so the site can tell the
 *   player to /link. It never fails silently.
 *
 * Identity note: the site knows the Discord ID for every linked
 * profile (it bound them when the /link code was redeemed), so the
 * payload may carry discordId as well as websiteUserId. Resolution
 * prefers a linked discordId and falls back to a websiteUserId
 * lookup, because a record whose websiteUserId is only the
 * placeholder 'linked' cannot be found by website id alone.
 */
const crypto = require('crypto');

const ROLE_NAME = 'Chomp & Daub';
const ROLE_COLOR = 0xff1493; // hot pink, to match the Chomp & Daub badge
const WEBHOOK_PATH = '/swampbingo/win';
const SECRET_HEADER = 'x-swamp-bingo-secret';
const DEFAULT_SWAMP_BINGO_URL = 'https://swampology.com/swamp-bingo';
const MAX_BODY_BYTES = 64 * 1024;
const DEDUPE_CAP = 200;

/** The play URL the /swampbingo play button points at, or null when
 *  none is configured yet (then play says "coming soon"). */
function getPlayUrl(cfg) {
  const u = cfg && typeof cfg.swampBingoUrl === 'string' ? cfg.swampBingoUrl.trim() : '';
  return u || null;
}

/** Linking is ON once an admin has run /swampbingo start. */
function isEnabled(cfg) {
  return !!(cfg && cfg.swampBingoEnabled && cfg.swampBingoRoleId);
}

/** Timing-safe secret comparison. Empty expected secret never matches. */
function checkSecret(provided, expected) {
  if (typeof expected !== 'string' || expected.length === 0) return false;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Validate a win payload. Needs a websiteUserId OR a discordId (either
 * identifies the winner); pattern/mode/eventId are optional strings.
 * Returns { ok:true, data } or { ok:false, reason:'bad_payload' }.
 */
function validateWinPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'bad_payload' };
  }
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const websiteUserId = str(body.websiteUserId);
  const discordId = str(body.discordId);
  if (!websiteUserId && !discordId) return { ok: false, reason: 'bad_payload' };
  if (body.pattern !== undefined && typeof body.pattern !== 'string') return { ok: false, reason: 'bad_payload' };
  if (body.mode !== undefined && typeof body.mode !== 'string') return { ok: false, reason: 'bad_payload' };
  if (body.eventId !== undefined && typeof body.eventId !== 'string') return { ok: false, reason: 'bad_payload' };
  return {
    ok: true,
    data: {
      websiteUserId: websiteUserId || null,
      discordId: discordId || null,
      pattern: str(body.pattern) || null,
      mode: str(body.mode) || null,
      eventId: str(body.eventId) || null,
    },
  };
}

/**
 * Resolve a winner to a Discord member id through the /link mapping
 * (rec.websiteUserId). Prefers a discordId the site already knows,
 * but only when that member is actually linked; otherwise finds the
 * member whose websiteUserId matches. Returns the Discord id, or null.
 */
function resolveWinner(storeData, { websiteUserId, discordId }) {
  const users = (storeData && storeData.users) || {};
  if (discordId && users[discordId] && users[discordId].websiteUserId) return discordId;
  if (websiteUserId) {
    for (const [id, rec] of Object.entries(users)) {
      if (rec && rec.websiteUserId && rec.websiteUserId === websiteUserId) return id;
    }
  }
  return null;
}

/** The win announcement, posted in the announcement channel only. */
function buildWinAnnouncement({ discordId, pattern, mode }) {
  const detail = [pattern, mode].filter(Boolean).join(' · ');
  return [
    `🏆 **<@${discordId}> just won Swamp Bingo!**`,
    detail ? `_${detail}_` : null,
    `The **${ROLE_NAME}** role is theirs - chomp, daub, repeat. Play the next round with **/swampbingo play**.`,
  ].filter(Boolean).join('\n');
}

/** Small bounded in-memory set of recently seen win eventIds, so a
 *  site retry never double-announces the same win. */
function createWinDedupe(cap = DEDUPE_CAP) {
  const seen = new Set();
  return {
    has(id) { return !!id && seen.has(id); },
    add(id) {
      if (!id) return;
      seen.add(id);
      if (seen.size > cap) {
        const oldest = seen.values().next().value;
        seen.delete(oldest);
      }
    },
    size() { return seen.size; },
  };
}

/**
 * THE win path. Pure-ish: Discord access comes through `guild`
 * (discord.js Guild, or a test fake with roles/members/channels),
 * persistence through `storeData` + `save`.
 *
 * @param {object} deps
 *   storeData - store.data ({ users, config })
 *   save      - () => void, persists storeData (optional in tests)
 *   guild     - the guild, or null when the bot is not ready
 *   secret    - the expected webhook secret ('' = not configured)
 *   headers   - request headers (lower-cased keys)
 *   body      - parsed JSON payload
 *   dedupe    - a createWinDedupe() set (optional)
 * @returns {Promise<{status:number, body:object}>}
 */
async function processWin(deps) {
  const { storeData, save, guild, secret, headers, body, dedupe } = deps || {};
  const fail = (status, reason) => ({ status, body: { ok: false, reason } });
  if (!secret) return fail(503, 'not_configured');
  if (!checkSecret(headers && headers[SECRET_HEADER], secret)) return fail(401, 'unauthorized');
  const v = validateWinPayload(body);
  if (!v.ok) return fail(400, v.reason);
  const cfg = (storeData && storeData.config) || {};
  if (!isEnabled(cfg)) return fail(503, 'not_enabled');
  if (dedupe && v.data.eventId && dedupe.has(v.data.eventId)) {
    return { status: 200, body: { ok: true, duplicate: true } };
  }
  if (!guild) return fail(503, 'bot_not_ready');
  const discordId = resolveWinner(storeData, v.data);
  if (!discordId) return fail(404, 'unlinked');

  // The role: stored id first, then by name (in case the stored id
  // went stale). Missing entirely means start was never run properly.
  let role = null;
  if (cfg.swampBingoRoleId) {
    try { role = await guild.roles.fetch(cfg.swampBingoRoleId); } catch { role = null; }
  }
  if (!role) {
    try { role = guild.roles.cache.find((r) => r && r.name === ROLE_NAME) || null; } catch { role = null; }
  }
  if (!role) return fail(503, 'not_enabled');

  let member;
  try {
    member = await guild.members.fetch(discordId);
  } catch {
    return fail(404, 'member_not_found');
  }
  if (!member) return fail(404, 'member_not_found');

  const alreadyHadRole = !!(member.roles && member.roles.cache && member.roles.cache.has(role.id));
  if (!alreadyHadRole) {
    try {
      await member.roles.add(role.id, 'Swamp Bingo win on Swampology.com');
    } catch (e) {
      console.warn('[swampbingo] role grant failed:', e.message);
      return fail(500, 'grant_failed');
    }
  }

  // Remember the win on the member's record (backfilled fields in
  // store.js blankUser: bingoWins / lastBingoWinAt).
  const rec = storeData.users && storeData.users[discordId];
  if (rec) {
    rec.bingoWins = Math.floor(rec.bingoWins || 0) + 1;
    rec.lastBingoWinAt = Date.now();
    if (typeof save === 'function') { try { save(); } catch { /* record kept in memory */ } }
  }
  if (dedupe && v.data.eventId) dedupe.add(v.data.eventId);

  // Announce in the channel. A dead channel never fails the win: the
  // role is already granted, so the answer just says announced:false.
  let announced = false;
  const channelId = cfg.swampBingoChannelId;
  if (channelId) {
    try {
      const channel = await guild.channels.fetch(channelId);
      if (channel && channel.isTextBased && channel.isTextBased()) {
        await channel.send(buildWinAnnouncement({ discordId, pattern: v.data.pattern, mode: v.data.mode }));
        announced = true;
      }
    } catch (e) {
      console.warn('[swampbingo] win announcement failed:', e.message);
    }
  }
  return {
    status: 200,
    body: { ok: true, granted: !alreadyHadRole, alreadyHadRole, announced, discordId },
  };
}

/** The /swampbingo status view. Never includes the secret value. */
function statusText(cfg, { secretSet, publicBase }) {
  const enabled = isEnabled(cfg);
  const url = getPlayUrl(cfg);
  return [
    '🐊 **Swamp Bingo link**',
    `• **Linking:** ${enabled ? 'ON - wins on Swampology.com earn the role' : 'OFF - run /swampbingo start to switch it on'}`,
    `• **Role:** ${cfg.swampBingoRoleId ? `<@&${cfg.swampBingoRoleId}>` : '`not set`'}`,
    `• **Win announcements:** ${cfg.swampBingoChannelId ? `<#${cfg.swampBingoChannelId}>` : '`not set`'}`,
    `• **Play link:** ${url || `\`not set yet\` - the games open at ${DEFAULT_SWAMP_BINGO_URL} once the page is live`}`,
    `• **Win webhook:** ${publicBase}${WEBHOOK_PATH} - secret ${secretSet ? 'set ✅' : 'NOT SET ⚠️ (set SWAMPBINGO_WEBHOOK_SECRET in Render or wins cannot land)'}`,
  ].join('\n');
}

module.exports = {
  ROLE_NAME, ROLE_COLOR, WEBHOOK_PATH, SECRET_HEADER,
  DEFAULT_SWAMP_BINGO_URL, MAX_BODY_BYTES,
  getPlayUrl, isEnabled, checkSecret, validateWinPayload,
  resolveWinner, buildWinAnnouncement, createWinDedupe,
  processWin, statusText,
};
