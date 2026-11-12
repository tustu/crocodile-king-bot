'use strict';
/* Auto-registration contract: buildCommands() is the single source used by
 * BOTH the deploy-commands CLI and the bot's boot-time registration, so a
 * hosted deploy (no shell) can never log in with missing commands. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCommands, commands } = require('../src/deploy-commands');

test('buildCommands returns 25 valid command JSONs', () => {
  const body = buildCommands();
  assert.equal(body.length, 27); // 26 + /moodpick (profile system)
  for (const c of body) {
    assert.equal(typeof c.name, 'string');
    assert.match(c.name, /^[a-z0-9_-]{1,32}$/);
    assert.equal(typeof c.description, 'string');
    assert.ok(c.description.length >= 1 && c.description.length <= 100);
  }
});

test('command names are unique and include setup/store/avatarframe', () => {
  const names = buildCommands().map(c => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const need of ['setup', 'store', 'avatarframe']) assert.ok(names.includes(need), `missing /${need}`);
});

test('the Swamp Bucks Bridge adds /link, and its wording carries no dash characters', () => {
  const names = buildCommands().map(c => c.name);
  assert.ok(names.includes('link'), 'missing /link');
  const link = buildCommands().find(c => c.name === 'link');
  assert.ok(!link.description.includes('-'), 'link description must be dash free');
});

test('buildCommands is stable, and the CLI export matches it (dry import)', () => {
  assert.deepEqual(buildCommands(), buildCommands());
  assert.deepEqual(commands, buildCommands());
});
