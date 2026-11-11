'use strict';
/** v2.2 in-server setup: stored config, panel routing, create planner. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const setup = require('../src/setup');
const { Store } = require('../src/store');
const { commands } = require('../src/deploy-commands');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-setup-'));
  return new Store(path.join(dir, 'store.json'));
}
const SEED = {
  welcomeChannelId: 'env-welcome', verifiedRoleId: 'env-verified',
  modChannelId: null, questChannelId: 'env-quest',
  levelRoleIds: { '1': 'env-lvl1' }, factionRoleIds: {},
};

/* ---------- stored config: seed precedence ---------- */
test('seed fills only blank fields; in-server picks are never stomped', () => {
  const blank = setup.blankHomeConfig();
  const seeded = setup.seedHomeConfig(blank, SEED);
  assert.equal(seeded.welcomeChannelId, 'env-welcome');
  assert.equal(seeded.levelRoleIds['1'], 'env-lvl1');
  assert.equal(seeded.modChannelId, null, 'null seed values do not fill');
  const picked = setup.mergeHomeConfig(seeded, { welcomeChannelId: 'panel-welcome' });
  const reseeded = setup.seedHomeConfig(picked, SEED);
  assert.equal(reseeded.welcomeChannelId, 'panel-welcome', '/setup pick wins over env on restart');
  assert.equal(blank.welcomeChannelId, null, 'seed is pure - input untouched');
});

test('store: config round-trips through save + reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-setup-'));
  const file = path.join(dir, 'store.json');
  const s1 = new Store(file);
  s1.seedConfig(SEED);
  s1.setConfig({ modRoleId: 'role-server-mod', kingChannelId: 'chan-king' });
  s1.save();
  const s2 = new Store(file);
  assert.equal(s2.getConfig().modRoleId, 'role-server-mod');
  assert.equal(s2.getConfig().kingChannelId, 'chan-king');
  assert.equal(s2.getConfig().welcomeChannelId, 'env-welcome', 'seed persisted too');
});

test('store: /setup reset returns wiring to the env seed only', () => {
  const s = tmpStore();
  s.seedConfig(SEED);
  s.setConfig({ welcomeChannelId: 'panel-x', verifiedRoleId: 'panel-v' });
  const after = s.resetConfig(SEED);
  assert.equal(after.welcomeChannelId, 'env-welcome');
  assert.equal(after.verifiedRoleId, 'env-verified');
  assert.equal(after.modRoleId, null);
});

test('store: an old store.json without a config field loads with a blank config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-setup-'));
  const file = path.join(dir, 'store.json');
  fs.writeFileSync(file, JSON.stringify({ users: {}, sponsorQuests: [], factions: { weekly: {}, allTime: {} }, channelRaidLastAt: {} }));
  const s = new Store(file);
  const cfg = s.getConfig();
  assert.equal(cfg.verifiedRoleId, null);
  assert.deepEqual(cfg.levelRoleIds, {});
});

test('store: unknown config keys are refused by setConfig', () => {
  const s = tmpStore();
  s.setConfig({ nopeNotAField: 'x', verifiedRoleId: 'ok-role' });
  assert.equal(s.getConfig().verifiedRoleId, 'ok-role');
  assert.equal(s.getConfig().nopeNotAField, undefined);
});

/* ---------- panel routing (pure handlers) ---------- */
test('panel customIds parse: pages, roles, channels, levels, factions', () => {
  assert.deepEqual(setup.parseSetupCustomId('setup:page'), { type: 'page' });
  assert.deepEqual(setup.parseSetupCustomId('setup:role:verifiedRoleId'), { type: 'pick', kind: 'role', key: 'verifiedRoleId' });
  assert.deepEqual(setup.parseSetupCustomId('setup:chan:modChannelId'), { type: 'pick', kind: 'channel', key: 'modChannelId' });
  assert.deepEqual(setup.parseSetupCustomId('setup:lvl:35'), { type: 'pick', kind: 'level', level: '35' });
  assert.deepEqual(setup.parseSetupCustomId('setup:fac:glowshroom-circle'), { type: 'pick', kind: 'faction', factionId: 'glowshroom-circle' });
});

test('panel customIds reject junk, cross-kind and storefront ids', () => {
  assert.equal(setup.parseSetupCustomId('sf:nav:decor'), null, 'storefront ids are not setup ids');
  assert.equal(setup.parseSetupCustomId('setup:role:welcomeChannelId'), null, 'channel key in a role menu is invalid');
  assert.equal(setup.parseSetupCustomId('setup:chan:verifiedRoleId'), null, 'role key in a channel menu is invalid');
  assert.equal(setup.parseSetupCustomId('setup:lvl:99'), null);
  assert.equal(setup.parseSetupCustomId('setup:fac:nope'), null);
  assert.equal(setup.parseSetupCustomId('setup:'), null);
  assert.equal(setup.parseSetupCustomId(''), null);
  assert.equal(setup.parseSetupCustomId(null), null);
});

test('panel pick -> patch -> store save (the handler flow, pure)', () => {
  const s = tmpStore();
  const save = (customId, pickedId) => {
    const parsed = setup.parseSetupCustomId(customId);
    const patch = setup.patchForPick(parsed, pickedId);
    assert.ok(patch, `patch for ${customId}`);
    s.setConfig(patch);
  };
  save('setup:role:modRoleId', 'role-server-mod');        // e.g. "Server ✦ Mod" picked from the dropdown
  save('setup:chan:modChannelId', 'chan-mod');
  save('setup:lvl:50', 'role-murk-royalty');
  save('setup:lvl:1', 'role-tadpole');
  save('setup:fac:kings-court', 'role-court');
  const cfg = s.getConfig();
  assert.equal(cfg.modRoleId, 'role-server-mod');
  assert.equal(cfg.levelRoleIds['50'], 'role-murk-royalty');
  assert.equal(cfg.levelRoleIds['1'], 'role-tadpole', 'second level pick did not wipe the first');
  assert.equal(cfg.factionRoleIds['kings-court'], 'role-court');
  assert.equal(setup.verificationEnabled(cfg), false, 'verifiedRoleId still missing -> reminders stay off');
  save('setup:role:verifiedRoleId', 'role-verified');
  assert.equal(setup.verificationEnabled(s.getConfig()), true);
});

test('panel builds all six pages, never more than 5 component rows', () => {
  const cfg = setup.mergeHomeConfig(null, { verifiedRoleId: 'r1', welcomeChannelId: 'c1' });
  for (const p of setup.PANEL_PAGES) {
    const view = setup.buildPanel(cfg, p.id);
    assert.ok(view.embeds.length === 1, p.id);
    assert.ok(view.components.length <= 5, `${p.id} has ${view.components.length} rows - Discord caps at 5`);
    const json = view.components.map(r => r.toJSON());
    assert.ok(JSON.stringify(json).includes('setup:page'), `${p.id} carries the page-jump menu`);
  }
  const bogus = setup.buildPanel(cfg, 'not-a-page');
  assert.ok(bogus.embeds[0].toJSON().title.includes('Roles'), 'unknown page falls back to core');
});

/* ---------- /setup create planner ---------- */
const ALL_FIELDS = setup.CREATE_DEFAULTS.map(d => d.field);
test('create planner: empty server + empty config -> create everything, roles first', () => {
  const steps = setup.planSetupCreations(setup.blankHomeConfig(), { rolesByName: {}, channelsByName: {} });
  assert.equal(steps.length, ALL_FIELDS.length);
  assert.ok(steps.every(s => s.action === 'create'));
  assert.ok(steps.findIndex(s => s.kind === 'channel') > steps.findLastIndex(s => s.kind === 'role'), 'roles planned before channels');
});

test('create planner: fully configured -> skip everything (never overwrites)', () => {
  const cfg = setup.blankHomeConfig();
  for (const f of ALL_FIELDS) cfg[f] = 'already-set';
  const steps = setup.planSetupCreations(cfg, { rolesByName: {}, channelsByName: {} });
  assert.ok(steps.every(s => s.action === 'skip'));
});

test('create planner: existing pieces (funky server) are adopted, not recreated', () => {
  const steps = setup.planSetupCreations(setup.blankHomeConfig(), {
    rolesByName: { Verified: 'existing-verified-role' },
    channelsByName: { 'mod-chat': 'existing-mod-chat', 'daily-quests': 'existing-quests' },
  });
  const byField = Object.fromEntries(steps.map(s => [s.field, s]));
  assert.deepEqual({ a: byField.verifiedRoleId.action, id: byField.verifiedRoleId.id }, { a: 'adopt', id: 'existing-verified-role' });
  assert.equal(byField.modChannelId.action, 'adopt');
  assert.equal(byField.questChannelId.action, 'adopt');
  assert.equal(byField.royaltyRoleId.action, 'create', 'missing royalty role still creates');
  assert.equal(byField.kingChannelId.action, 'create');
  assert.equal(byField.verifyChannelId.action, 'create');
});

test('create defaults carry the agreed settings sheet', () => {
  const byField = Object.fromEntries(setup.CREATE_DEFAULTS.map(d => [d.field, d]));
  assert.equal(byField.verifiedRoleId.roleSpec.color, 0x2e7d32, 'Verified is swamp green');
  assert.equal(byField.royaltyRoleId.roleSpec.color, 0xf1c40f, 'Royalty is gold');
  assert.equal(byField.verifyChannelId.channelSpec.rateLimitPerUser, 60, 'get-verified slowmode 1 minute');
  const modChat = byField.modChannelId.channelSpec.overwrites;
  assert.ok(modChat.find(o => o.who === 'everyone' && o.deny.includes('ViewChannel')), 'mod-chat is private');
  const king = byField.kingChannelId.channelSpec.overwrites;
  const everyone = king.find(o => o.who === 'everyone');
  assert.ok(everyone.allow.includes('ViewChannel') && everyone.deny.includes('SendMessages'), 'crocodile-king: everyone sees, only Verified post');
  const quests = byField.questChannelId.channelSpec.overwrites;
  assert.ok(quests.find(o => o.who === 'verified' && o.deny.includes('SendMessages')), 'daily-quests is view-only for Verified');
});

/* ---------- zero-config graceful behaviour ---------- */
test('zero-config: summary + missing list work on a blank config', () => {
  const blank = setup.blankHomeConfig();
  const text = setup.setupSummary(blank);
  assert.ok(text.includes('not set'));
  assert.ok(text.includes('Verification reminders:** OFF'));
  const missing = setup.missingFields(blank);
  assert.equal(missing.length, setup.SETUP_FIELDS.length + 6 + 3, 'every field + 6 level roles + 3 faction roles missing');
  const full = setup.seedHomeConfig(blank, {
    ...Object.fromEntries(setup.SETUP_FIELDS.map(f => [f.key, 'x'])),
    levelRoleIds: { '1': 'a', '5': 'a', '10': 'a', '20': 'a', '35': 'a', '50': 'a' },
    factionRoleIds: { 'kings-court': 'a', 'cypress-clan': 'a', 'glowshroom-circle': 'a' },
  });
  assert.equal(setup.missingFields(full).length, 0);
  assert.ok(setup.setupSummary(full).includes('ON'));
});

/* ---------- registration shape ---------- */
test('/setup is registered (25 top-level commands) with panel/show/create/reset', () => {
  assert.equal(commands.length, 26);
  const setupCmd = commands.find(c => c.name === 'setup');
  assert.ok(setupCmd, 'setup command exists');
  const subs = setupCmd.options.map(o => o.name).sort();
  assert.deepEqual(subs, ['create', 'panel', 'reset', 'show']);
});
