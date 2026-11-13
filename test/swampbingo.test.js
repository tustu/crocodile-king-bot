'use strict';
/* Swamp Bingo link: the win webhook, the /link mapping reuse, and the
 * /swampbingo command shape. The endpoint must never fail silently:
 * every rejection carries a machine-readable reason the site can act on. */
const test = require('node:test');
const assert = require('node:assert/strict');
const bingo = require('../src/swampbingo');
const { mergeHomeConfig } = require('../src/setup');
const { buildCommands } = require('../src/deploy-commands');

const SECRET = 'test-webhook-secret-do-not-use-in-prod';

function enabledConfig(overrides = {}) {
  return mergeHomeConfig({}, {
    swampBingoEnabled: true,
    swampBingoRoleId: 'role-chomp-daub',
    swampBingoChannelId: 'chan-announce',
    swampBingoUrl: 'https://swampology.com/swamp-bingo',
    ...overrides,
  });
}

function storeDataWith(users, config) {
  return { users, config: config || enabledConfig() };
}

/** Minimal discord.js-shaped guild fake. `state` records what happened. */
function fakeGuild(opts = {}) {
  const state = { added: [], sent: [] };
  const roleId = opts.roleId || 'role-chomp-daub';
  const role = { id: roleId, name: 'Chomp & Daub' };
  const members = new Map();
  for (const [id, hasRole] of Object.entries(opts.members || {})) {
    members.set(id, {
      id,
      roles: {
        cache: { has: (rid) => !!hasRole && rid === roleId },
        add: async (rid) => {
          if (opts.failGrant) throw new Error('Missing Permissions');
          state.added.push(rid);
        },
      },
    });
  }
  return {
    state,
    guild: {
      roles: {
        fetch: async (id) => (opts.staleRoleId ? null : (id === roleId ? role : null)),
        cache: {
          find: (fn) => {
            if (opts.noRoleByName) return undefined;
            return fn(role, role.id) ? role : undefined;
          },
        },
      },
      members: {
        fetch: async (id) => {
          if (opts.failMemberFetch) throw new Error('Unknown Member');
          const m = members.get(id);
          if (!m) throw new Error('Unknown Member');
          return m;
        },
      },
      channels: {
        fetch: async (id) => {
          if (opts.failChannel) throw new Error('Unknown Channel');
          if (id !== 'chan-announce') return null;
          return {
            isTextBased: () => true,
            send: async (msg) => { state.sent.push(msg); return { id: 'msg-1' }; },
          };
        },
      },
    },
  };
}

const HEADERS = { [bingo.SECRET_HEADER]: SECRET };

test('constants: role name, hot pink color, webhook path, default URL', () => {
  assert.equal(bingo.ROLE_NAME, 'Chomp & Daub');
  assert.equal(bingo.ROLE_COLOR, 0xff1493);
  assert.equal(bingo.WEBHOOK_PATH, '/swampbingo/win');
  assert.equal(bingo.SECRET_HEADER, 'x-swamp-bingo-secret');
  assert.equal(bingo.DEFAULT_SWAMP_BINGO_URL, 'https://swampology.com/swamp-bingo');
});

test('getPlayUrl: configured URL wins, blank means coming soon', () => {
  assert.equal(bingo.getPlayUrl(enabledConfig()), 'https://swampology.com/swamp-bingo');
  assert.equal(bingo.getPlayUrl(enabledConfig({ swampBingoUrl: '  https://example.com/bingo ' })), 'https://example.com/bingo');
  assert.equal(bingo.getPlayUrl(enabledConfig({ swampBingoUrl: null })), null);
  assert.equal(bingo.getPlayUrl(enabledConfig({ swampBingoUrl: '   ' })), null);
  assert.equal(bingo.getPlayUrl(null), null);
});

test('isEnabled needs the flag AND a stored role id', () => {
  assert.equal(bingo.isEnabled(enabledConfig()), true);
  assert.equal(bingo.isEnabled(enabledConfig({ swampBingoEnabled: false })), false);
  assert.equal(bingo.isEnabled(enabledConfig({ swampBingoRoleId: null })), false);
  assert.equal(bingo.isEnabled(mergeHomeConfig({}, {})), false);
});

test('checkSecret: exact match only, timing-safe, empty never matches', () => {
  assert.equal(bingo.checkSecret('abc', 'abc'), true);
  assert.equal(bingo.checkSecret('abd', 'abc'), false);
  assert.equal(bingo.checkSecret('ab', 'abc'), false);
  assert.equal(bingo.checkSecret('', 'abc'), false);
  assert.equal(bingo.checkSecret('abc', ''), false);
  assert.equal(bingo.checkSecret(undefined, 'abc'), false);
});

test('validateWinPayload: websiteUserId or discordId, optional details', () => {
  assert.deepEqual(bingo.validateWinPayload({ websiteUserId: 'site-7' }).data,
    { websiteUserId: 'site-7', discordId: null, pattern: null, mode: null, eventId: null });
  assert.equal(bingo.validateWinPayload({ discordId: '123', pattern: 'Blackout Bayou', mode: 'Live Watch Party', eventId: 'e1' }).ok, true);
  assert.equal(bingo.validateWinPayload({ websiteUserId: '  site-7  ' }).data.websiteUserId, 'site-7');
  assert.equal(bingo.validateWinPayload({}).ok, false);
  assert.equal(bingo.validateWinPayload({ websiteUserId: '   ' }).ok, false);
  assert.equal(bingo.validateWinPayload(null).ok, false);
  assert.equal(bingo.validateWinPayload([]).ok, false);
  assert.equal(bingo.validateWinPayload('x').ok, false);
  assert.equal(bingo.validateWinPayload({ websiteUserId: 's', pattern: 42 }).ok, false);
  assert.equal(bingo.validateWinPayload({ websiteUserId: 's', eventId: 9 }).ok, false);
});

test('resolveWinner reuses the /link mapping (websiteUserId)', () => {
  const users = {
    '111': { userId: '111', websiteUserId: 'site-7' },
    '222': { userId: '222', websiteUserId: null },
    '333': { userId: '333', websiteUserId: 'linked' }, // placeholder, not a real site id
  };
  const data = { users };
  assert.equal(bingo.resolveWinner(data, { websiteUserId: 'site-7' }), '111');
  assert.equal(bingo.resolveWinner(data, { discordId: '111' }), '111');
  // discordId the site knows, but that member never linked: no match
  assert.equal(bingo.resolveWinner(data, { discordId: '222' }), null);
  // the 'linked' placeholder never matches a real site id
  assert.equal(bingo.resolveWinner(data, { websiteUserId: 'site-9' }), null);
  // discordId present AND linked beats a website lookup
  assert.equal(bingo.resolveWinner(data, { websiteUserId: 'site-7', discordId: '111' }), '111');
  // unlinked discordId falls through to the website lookup
  assert.equal(bingo.resolveWinner(data, { websiteUserId: 'site-7', discordId: '222' }), '111');
  assert.equal(bingo.resolveWinner({ users: {} }, { websiteUserId: 'site-7' }), null);
  assert.equal(bingo.resolveWinner(null, { websiteUserId: 'site-7' }), null);
});

test('buildWinAnnouncement names the winner, pattern and mode', () => {
  const text = bingo.buildWinAnnouncement({ discordId: '111', pattern: 'Blackout Bayou', mode: 'Live Watch Party' });
  assert.match(text, /<@111>/);
  assert.match(text, /Blackout Bayou/);
  assert.match(text, /Live Watch Party/);
  assert.match(text, /Chomp & Daub/);
  const plain = bingo.buildWinAnnouncement({ discordId: '111', pattern: null, mode: null });
  assert.match(plain, /<@111>/);
  assert.ok(!plain.includes('null'));
});

test('createWinDedupe caps its memory', () => {
  const d = bingo.createWinDedupe(3);
  d.add('a'); d.add('b'); d.add('c');
  assert.equal(d.has('a'), true);
  d.add('d');
  assert.equal(d.size(), 3);
  assert.equal(d.has('a'), false);
  assert.equal(d.has('d'), true);
  assert.equal(d.has(null), false);
});

test('processWin: 503 when the webhook secret is not configured', async () => {
  const out = await bingo.processWin({
    storeData: storeDataWith({}), secret: '', headers: HEADERS,
    body: { websiteUserId: 'site-7' }, guild: fakeGuild().guild,
  });
  assert.equal(out.status, 503);
  assert.equal(out.body.reason, 'not_configured');
});

test('processWin: 401 without the secret, 401 with the wrong secret', async () => {
  const base = {
    storeData: storeDataWith({}), secret: SECRET,
    body: { websiteUserId: 'site-7' }, guild: fakeGuild().guild,
  };
  const noHeader = await bingo.processWin({ ...base, headers: {} });
  assert.equal(noHeader.status, 401);
  assert.equal(noHeader.body.reason, 'unauthorized');
  const wrong = await bingo.processWin({ ...base, headers: { [bingo.SECRET_HEADER]: 'nope' } });
  assert.equal(wrong.status, 401);
});

test('processWin: 400 on a bad payload', async () => {
  const out = await bingo.processWin({
    storeData: storeDataWith({}), secret: SECRET, headers: HEADERS,
    body: { pattern: 'Blackout Bayou' }, guild: fakeGuild().guild,
  });
  assert.equal(out.status, 400);
  assert.equal(out.body.reason, 'bad_payload');
});

test('processWin: 503 when linking was never started', async () => {
  const out = await bingo.processWin({
    storeData: storeDataWith({}, mergeHomeConfig({}, {})),
    secret: SECRET, headers: HEADERS,
    body: { websiteUserId: 'site-7' }, guild: fakeGuild().guild,
  });
  assert.equal(out.status, 503);
  assert.equal(out.body.reason, 'not_enabled');
});

test('processWin: 404 unlinked when the winner never /linked', async () => {
  const out = await bingo.processWin({
    storeData: storeDataWith({ '222': { userId: '222', websiteUserId: null } }),
    secret: SECRET, headers: HEADERS,
    body: { websiteUserId: 'site-7' }, guild: fakeGuild().guild,
  });
  assert.equal(out.status, 404);
  assert.equal(out.body.reason, 'unlinked');
});

test('processWin: 404 member_not_found when the linked member left the server', async () => {
  const out = await bingo.processWin({
    storeData: storeDataWith({ '111': { userId: '111', websiteUserId: 'site-7' } }),
    secret: SECRET, headers: HEADERS,
    body: { websiteUserId: 'site-7' }, guild: fakeGuild({ members: {} }).guild,
  });
  assert.equal(out.status, 404);
  assert.equal(out.body.reason, 'member_not_found');
});

test('processWin: 503 not_enabled when the role is gone entirely', async () => {
  const { guild } = fakeGuild({ noRoleByName: true, staleRoleId: true });
  const out = await bingo.processWin({
    storeData: storeDataWith({ '111': { userId: '111', websiteUserId: 'site-7' } }),
    secret: SECRET, headers: HEADERS,
    body: { websiteUserId: 'site-7' }, guild,
  });
  assert.equal(out.status, 503);
  assert.equal(out.body.reason, 'not_enabled');
});

test('processWin: success grants the role, announces, and records the win', async () => {
  const { guild, state } = fakeGuild({ members: { '111': false } });
  const users = { '111': { userId: '111', websiteUserId: 'site-7', bingoWins: 2 } };
  let saved = 0;
  const out = await bingo.processWin({
    storeData: storeDataWith(users), save: () => { saved++; },
    secret: SECRET, headers: HEADERS, guild,
    body: { websiteUserId: 'site-7', pattern: 'Blackout Bayou', mode: 'Live Watch Party' },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.granted, true);
  assert.equal(out.body.alreadyHadRole, false);
  assert.equal(out.body.announced, true);
  assert.equal(out.body.discordId, '111');
  assert.deepEqual(state.added, ['role-chomp-daub']);
  assert.equal(state.sent.length, 1);
  assert.match(state.sent[0], /<@111>/);
  assert.match(state.sent[0], /Blackout Bayou/);
  assert.equal(users['111'].bingoWins, 3);
  assert.ok(users['111'].lastBingoWinAt > 0);
  assert.equal(saved, 1);
});

test('processWin: a stale stored role id falls back to finding the role by name', async () => {
  const { guild, state } = fakeGuild({ members: { '111': false }, staleRoleId: true });
  const out = await bingo.processWin({
    storeData: storeDataWith({ '111': { userId: '111', websiteUserId: 'site-7' } }),
    secret: SECRET, headers: HEADERS, guild,
    body: { discordId: '111' },
  });
  assert.equal(out.status, 200);
  assert.deepEqual(state.added, ['role-chomp-daub']);
});

test('processWin: already holding the role still wins, just no double grant', async () => {
  const { guild, state } = fakeGuild({ members: { '111': true } });
  const out = await bingo.processWin({
    storeData: storeDataWith({ '111': { userId: '111', websiteUserId: 'site-7' } }),
    secret: SECRET, headers: HEADERS, guild,
    body: { websiteUserId: 'site-7', pattern: 'Standard Line' },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.granted, false);
  assert.equal(out.body.alreadyHadRole, true);
  assert.equal(out.body.announced, true);
  assert.deepEqual(state.added, []);
  assert.equal(state.sent.length, 1);
});

test('processWin: a repeated eventId answers duplicate and does nothing twice', async () => {
  const { guild, state } = fakeGuild({ members: { '111': false } });
  const dedupe = bingo.createWinDedupe();
  const base = {
    storeData: storeDataWith({ '111': { userId: '111', websiteUserId: 'site-7' } }),
    secret: SECRET, headers: HEADERS, guild, dedupe,
    body: { websiteUserId: 'site-7', eventId: 'win-99' },
  };
  const first = await bingo.processWin(base);
  assert.equal(first.status, 200);
  assert.equal(first.body.duplicate, undefined);
  const second = await bingo.processWin(base);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(state.added.length, 1);
  assert.equal(state.sent.length, 1);
});

test('processWin: 500 grant_failed when Discord refuses the role add', async () => {
  const { guild } = fakeGuild({ members: { '111': false }, failGrant: true });
  const out = await bingo.processWin({
    storeData: storeDataWith({ '111': { userId: '111', websiteUserId: 'site-7' } }),
    secret: SECRET, headers: HEADERS, guild,
    body: { websiteUserId: 'site-7' },
  });
  assert.equal(out.status, 500);
  assert.equal(out.body.reason, 'grant_failed');
});

test('processWin: a dead announcement channel never fails the win', async () => {
  const { guild, state } = fakeGuild({ members: { '111': false }, failChannel: true });
  const out = await bingo.processWin({
    storeData: storeDataWith({ '111': { userId: '111', websiteUserId: 'site-7' } }),
    secret: SECRET, headers: HEADERS, guild,
    body: { websiteUserId: 'site-7' },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.granted, true);
  assert.equal(out.body.announced, false);
  assert.deepEqual(state.added, ['role-chomp-daub']);
});

test('statusText shows wiring and never leaks the secret value', () => {
  const text = bingo.statusText(enabledConfig(), { secretSet: true, publicBase: 'https://crocodile-king.onrender.com' });
  assert.match(text, /ON/);
  assert.match(text, /<@&role-chomp-daub>/);
  assert.match(text, /<#chan-announce>/);
  assert.match(text, /swampology\.com\/swamp-bingo/);
  assert.match(text, /\/swampbingo\/win/);
  assert.ok(!text.includes(SECRET));
  const off = bingo.statusText(mergeHomeConfig({}, {}), { secretSet: false, publicBase: 'https://crocodile-king.onrender.com' });
  assert.match(off, /OFF/);
  assert.match(off, /SWAMPBINGO_WEBHOOK_SECRET/);
  assert.match(off, /not set yet/);
});

test('/swampbingo exists with start, play and status subcommands', () => {
  const cmd = buildCommands().find((c) => c.name === 'swampbingo');
  assert.ok(cmd, 'missing /swampbingo');
  const subs = (cmd.options || []).map((o) => o.name);
  assert.deepEqual(subs, ['start', 'play', 'status']);
  const start = cmd.options.find((o) => o.name === 'start');
  const startOpts = (start.options || []).map((o) => o.name);
  assert.ok(startOpts.includes('channel'), 'start needs a channel option');
  assert.ok(startOpts.includes('url'), 'start needs a url option');
});
