'use strict';
/**
 * Swamp Bucks Bridge - the ONE link between the Crocodile King's local
 * books and Swampology.com. Swamp Bucks only: nothing else crosses.
 *
 * THE SHAPE OF IT
 * - OFF by default. The bridge only wakes when BOTH env vars are set:
 *     SWAMP_BUCKS_API_BASE  e.g. https://swampology.com
 *     SWAMP_BUCKS_SECRET    the shared secret (same value on the website)
 *   With either missing, every function below is a local no-op wrapper:
 *   balances behave exactly as they did before the bridge existed.
 * - LINKED members (rec.websiteUserId set, see the /link flow) have their
 *   balance owned by the website. Every change is posted to the website
 *   (POST /api/swamp-bucks/adjust, idempotency keyed) and the local
 *   rec.swampBucks becomes a MIRROR of the website's answer.
 * - UNLINKED members stay purely local, forever, until they /link.
 * - If the website cannot be reached mid-change, the change is applied
 *   locally AND queued on the record (rec.bucksOutbox) with the SAME
 *   idempotency key, then replayed on the member's next sync. Retries
 *   can never double-pay: the website dedupes on the key.
 * - Swamp Bucks are play money: earned in the server, spent in the
 *   /store. The bridge moves balances between the King's book and the
 *   same member's website book - it adds no way to buy, sell or cash
 *   out Bucks, on either side, ever.
 *
 * THE /link FLOW (bot half)
 * 1. Member runs /link. issueLinkCode() writes a one-time 6 character
 *    code (15 minute life) into store.data.linkCodes and onto the
 *    record as a pending link.
 * 2. registerLinkCode() pushes the code to the website
 *    (POST /api/swamp-bucks/link-code) with the member's current local
 *    balance as the seed.
 * 3. The member enters the code on their Swampology profile; the
 *    website binds their website account to the Discord ID and opens
 *    the website balance at the seed value.
 * 4. On the member's next interaction, syncRecord() discovers the link
 *    (the balance endpoint only answers for linked members), records
 *    rec.websiteUserId, and from then on the website owns the balance.
 */
const crypto = require('crypto');
const { config } = require('./config');

/* Unambiguous alphabet: no 0/O, no 1/I/L - a code read aloud or typed
 * off a phone screen cannot be mis-copied. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LINK_CODE_LENGTH = 6;
const LINK_CODE_TTL_MS = 15 * 60 * 1000;
const PENDING_LINK_WINDOW_MS = 20 * 60 * 1000; // discovery grace after the 15 min code life
const DEFAULT_TIMEOUT_MS = 4000;

function generateLinkCode(rng) {
  const pick = rng || ((n) => crypto.randomInt(n));
  let code = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i++) code += CODE_ALPHABET[pick(CODE_ALPHABET.length)];
  return code;
}

/** Drop expired codes from the store-level code book. Returns count removed. */
function pruneLinkCodes(storeData, now = Date.now()) {
  if (!storeData || typeof storeData !== 'object') return 0;
  if (!storeData.linkCodes || typeof storeData.linkCodes !== 'object') storeData.linkCodes = {};
  let removed = 0;
  for (const [code, entry] of Object.entries(storeData.linkCodes)) {
    if (!entry || typeof entry.expiresAt !== 'number' || entry.expiresAt <= now) {
      delete storeData.linkCodes[code];
      removed++;
    }
  }
  return removed;
}

/**
 * Issue a fresh code for a member. Any earlier unused code of theirs is
 * replaced (one live code per member). The code entry snapshots the
 * member's current local balance - that snapshot is the seed the
 * website balance opens with when the code is redeemed, so linking
 * never loses a single Buck.
 * Mutates storeData.linkCodes and the record's pending-link fields.
 * Returns { code, expiresAt }.
 */
function issueLinkCode(storeData, rec, now = Date.now(), rng) {
  pruneLinkCodes(storeData, now);
  for (const [code, entry] of Object.entries(storeData.linkCodes)) {
    if (entry && entry.discordId === rec.userId) delete storeData.linkCodes[code];
  }
  let code = generateLinkCode(rng);
  while (storeData.linkCodes[code]) code = generateLinkCode(rng);
  const expiresAt = now + LINK_CODE_TTL_MS;
  storeData.linkCodes[code] = {
    discordId: rec.userId,
    seedBucks: Math.max(0, Math.floor(rec.swampBucks || 0)),
    expiresAt,
    createdAt: now,
  };
  rec.pendingLinkCode = code;
  rec.pendingLinkAt = now;
  return { code, expiresAt };
}

function newIdempotencyKey(userId, reason) {
  const slug = String(reason || 'adjust').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'adjust';
  return `bk_${userId}_${slug}_${crypto.randomUUID()}`;
}

function createBridge(opts = {}) {
  const base = String(opts.base || '').replace(/\/+$/, '');
  const secret = String(opts.secret || '');
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const enabled = !!(base && secret && fetchImpl);

  async function call(pathname, init = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(base + pathname, {
        ...init,
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-swamp-bucks-secret': secret, ...(init.headers || {}) },
      });
      let body = null;
      try { body = await res.json(); } catch { /* empty or non-JSON body */ }
      return { ok: res.ok, status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  function isLinked(rec) { return !!(rec && rec.websiteUserId); }

  /** Push an issued code to the website so the profile page can redeem it. */
  async function registerLinkCode(discordId, code, expiresAt, bucks) {
    if (!enabled) return { ok: false, status: 0, reason: 'bridge off' };
    try {
      const r = await call('/api/swamp-bucks/link-code', {
        method: 'POST',
        body: JSON.stringify({ discordId, code, expiresAt, bucks: Math.max(0, Math.floor(bucks || 0)) }),
      });
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, status: 0, reason: e.message };
    }
  }

  /** The website's balance for a linked member. 404 = not linked there. */
  async function fetchBalance(discordId) {
    if (!enabled) return { ok: false, status: 0, reason: 'bridge off' };
    try {
      const r = await call(`/api/swamp-bucks/balance?discordId=${encodeURIComponent(discordId)}`);
      if (!r.ok) return { ok: false, status: r.status };
      const bucks = r.body && typeof r.body.bucks === 'number' ? Math.floor(r.body.bucks) : null;
      if (bucks === null) return { ok: false, status: r.status, reason: 'bad balance body' };
      return { ok: true, status: r.status, bucks, userId: (r.body && r.body.userId) || null };
    } catch (e) {
      return { ok: false, status: 0, reason: e.message };
    }
  }

  /** Post one signed change. The idempotency key makes every retry safe. */
  async function postAdjust(discordId, delta, reason, idempotencyKey) {
    if (!enabled) return { ok: false, status: 0, reason: 'bridge off' };
    try {
      const r = await call('/api/swamp-bucks/adjust', {
        method: 'POST',
        body: JSON.stringify({ discordId, delta: Math.floor(delta || 0), reason: String(reason || ''), idempotencyKey }),
      });
      if (!r.ok) return { ok: false, status: r.status };
      const bucks = r.body && typeof r.body.bucks === 'number' ? Math.floor(r.body.bucks) : null;
      if (bucks === null) return { ok: false, status: r.status, reason: 'bad adjust body' };
      return { ok: true, status: r.status, bucks };
    } catch (e) {
      return { ok: false, status: 0, reason: e.message };
    }
  }

  function applyLocal(rec, delta) {
    rec.swampBucks = Math.max(0, Math.floor(rec.swampBucks || 0) + Math.floor(delta || 0));
    return rec.swampBucks;
  }

  function queueOutbox(rec, delta, reason, idempotencyKey) {
    if (!Array.isArray(rec.bucksOutbox)) rec.bucksOutbox = [];
    rec.bucksOutbox.push({ delta: Math.floor(delta || 0), reason: String(reason || ''), idempotencyKey, at: Date.now() });
  }

  /**
   * THE change path. Every Bucks change in the bot that can await goes
   * through here. Linked + website reachable: the website moves first
   * and the local record mirrors its answer. Anything else: local move,
   * queued for replay when the member is linked (never queued when the
   * bridge is off or the member is unlinked - local IS the book then).
   */
  async function adjust(rec, delta, reason, idempotencyKey) {
    const d = Math.floor(delta || 0);
    if (d === 0) return { via: 'noop', balance: Math.floor(rec.swampBucks || 0) };
    if (!enabled || !isLinked(rec)) { applyLocal(rec, d); return { via: 'local', balance: rec.swampBucks }; }
    const key = idempotencyKey || newIdempotencyKey(rec.userId, reason);
    const r = await postAdjust(rec.userId, d, reason, key);
    if (r.ok) { rec.swampBucks = r.bucks; return { via: 'website', balance: r.bucks }; }
    applyLocal(rec, d);
    queueOutbox(rec, d, reason, key);
    return { via: 'queued', balance: rec.swampBucks };
  }

  /**
   * Settle a change that was ALREADY applied locally by synchronous
   * code (the /store shelf: shop.js buy/sell must stay synchronous).
   * `before` is the balance captured before the local change; only the
   * net difference is posted, so nothing is ever counted twice.
   */
  async function settleDelta(rec, before, reason, idempotencyKey) {
    const delta = Math.floor(rec.swampBucks || 0) - Math.floor(before || 0);
    if (delta === 0) return { via: 'noop', delta: 0, balance: Math.floor(rec.swampBucks || 0) };
    if (!enabled || !isLinked(rec)) return { via: 'local', delta, balance: rec.swampBucks };
    const key = idempotencyKey || newIdempotencyKey(rec.userId, reason);
    const r = await postAdjust(rec.userId, delta, reason, key);
    if (r.ok) { rec.swampBucks = r.bucks; return { via: 'website', delta, balance: r.bucks }; }
    queueOutbox(rec, delta, reason, key);
    return { via: 'queued', delta, balance: rec.swampBucks };
  }

  /**
   * Bring a record's mirror up to date. Discovers a fresh link (a
   * pending code redeemed on the website since the last interaction),
   * replays the outbox in order with the original idempotency keys,
   * then pulls the authoritative balance. Never throws; a dead website
   * just means the local mirror carries on.
   * Returns { changed, linked, replayed, balance }.
   */
  async function syncRecord(rec, now = Date.now()) {
    const out = { changed: false, linked: isLinked(rec), replayed: 0, balance: Math.floor((rec && rec.swampBucks) || 0) };
    if (!enabled || !rec) return out;
    if (!isLinked(rec)) {
      const pendingFresh = rec.pendingLinkAt && (now - rec.pendingLinkAt) <= PENDING_LINK_WINDOW_MS;
      if (!pendingFresh) return out;
      const probe = await fetchBalance(rec.userId);
      if (!probe.ok) return out; // not redeemed yet (or website down) - stay local
      rec.websiteUserId = probe.userId || 'linked';
      rec.pendingLinkCode = null;
      rec.pendingLinkAt = 0;
      out.changed = true;
      out.linked = true;
    }
    if (Array.isArray(rec.bucksOutbox)) {
      while (rec.bucksOutbox.length) {
        const entry = rec.bucksOutbox[0];
        const r = await postAdjust(rec.userId, entry.delta, entry.reason, entry.idempotencyKey);
        if (!r.ok) break; // website still unreachable - keep the rest queued
        rec.bucksOutbox.shift();
        out.replayed++;
        out.changed = true;
      }
    }
    const bal = await fetchBalance(rec.userId);
    if (bal.ok) {
      if (bal.bucks !== Math.floor(rec.swampBucks || 0)) out.changed = true;
      rec.swampBucks = bal.bucks;
      out.balance = bal.bucks;
      if (bal.userId && rec.websiteUserId !== bal.userId) { rec.websiteUserId = bal.userId; out.changed = true; }
    } else if (bal.status === 404) {
      // The website no longer has this link (unlinked there, or its
      // books were reset). Fall back to the local book cleanly: stop
      // queueing against a link that does not exist over there.
      rec.websiteUserId = null;
      rec.bucksOutbox = [];
      out.linked = false;
      out.changed = true;
    }
    return out;
  }

  return {
    enabled, base, isLinked,
    registerLinkCode, fetchBalance, postAdjust,
    adjust, settleDelta, syncRecord,
  };
}

/** The live singleton, built from env (src/config.js). Off unless both
 *  SWAMP_BUCKS_API_BASE and SWAMP_BUCKS_SECRET are set. */
const bridge = createBridge({ base: config.bucksApiBase, secret: config.bucksSecret });

module.exports = {
  CODE_ALPHABET, LINK_CODE_LENGTH, LINK_CODE_TTL_MS, PENDING_LINK_WINDOW_MS,
  generateLinkCode, pruneLinkCodes, issueLinkCode, newIdempotencyKey,
  createBridge, bridge,
};
