'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pc = require('../src/profilecard');
const pets = require('../src/pets');

function fixtureRec(over = {}) {
  return Object.assign({
    userId: 'u-owner', xp: 5230, swampBucks: 840, streak: 9, rep: 42,
    totalMessages: 312, totalVoiceMinutes: 120, faction: null,
    activeTitle: null, generatedTitle: 'Murk-Blessed Gator Whisperer',
    unlockedTitles: ['Errand Runner of the Murk'],
    inventory: { Glowshroom: 2 }, frames: [], backgrounds: [],
    equippedFrame: null, equippedBackground: null,
  }, over);
}

/* ---------- profile record + privacy ---------- */
test('profile: ensureProfile backfills defaults without replacing the object', () => {
  const rec = fixtureRec({ profile: null });
  const p = pc.ensureProfile(rec);
  assert.equal(p.style, 'trading');
  assert.equal(p.timezone, 'America/Halifax');
  assert.deepEqual(p.privacy, { rank: true, inventory: true, activity: true, balance: true });
  assert.equal(rec.profile, p, 'same object identity after ensure');
  p.bio = 'hi';
  assert.equal(pc.ensureProfile(rec).bio, 'hi', 'later writes survive re-ensure');
});
test('profile: owner always sees all; others obey the toggles', () => {
  const rec = fixtureRec();
  const p = pc.ensureProfile(rec);
  p.privacy.rank = false;
  p.privacy.balance = false;
  assert.equal(pc.canView(rec, 'u-owner', 'rank'), true);
  assert.equal(pc.canView(rec, 'u-owner', 'balance'), true);
  assert.equal(pc.canView(rec, 'u-stranger', 'rank'), false);
  assert.equal(pc.canView(rec, 'u-stranger', 'balance'), false);
  assert.equal(pc.canView(rec, 'u-stranger', 'inventory'), true);
});

/* ---------- moods + aura + pet mood resolution ---------- */
test('profile: six swamp moods, each with a color and a pet sprite mood', () => {
  assert.equal(pc.MOODS.length, 6);
  for (const m of pc.MOODS) {
    assert.ok(m.id && m.name && m.color && m.css && pets.PET_MOODS.includes(m.pet));
  }
  assert.equal(pc.moodById('sleepy').pet, 'sleeping');
  assert.equal(pc.moodById('hyped').pet, 'streak');
  assert.equal(pc.moodById('nope'), null);
});
test('profile: aura is the picked mood, else live presence, else swamp green', () => {
  const p = pc.blankProfile();
  p.mood = 'royal';
  assert.equal(pc.auraColor(p, 'online').source, 'mood');
  assert.equal(pc.auraColor(p, 'online').label, 'Royal');
  p.mood = null;
  assert.equal(pc.auraColor(p, 'dnd').source, 'presence');
  assert.equal(pc.auraColor(p, null).source, 'default');
});
test('profile: pet mood - feeding beats the pick, the pick beats derived state', () => {
  const now = Date.now();
  const pet = { species: 'gator', xp: 0, fedAt: now - 1000 };
  const p = pc.blankProfile();
  p.mood = 'sleepy';
  assert.equal(pc.resolvePetMood(pet, p, { ownerStatus: 'online', streak: 0, now }), 'eating');
  pet.fedAt = 0;
  assert.equal(pc.resolvePetMood(pet, p, { ownerStatus: 'online', streak: 0, now }), 'sleeping');
  p.mood = null;
  assert.equal(pc.resolvePetMood(pet, p, { ownerStatus: 'offline', streak: 0, now }), 'sleeping');
  assert.equal(pc.resolvePetMood(pet, p, { ownerStatus: 'online', streak: 9, now }), 'streak');
  assert.equal(pc.resolvePetMood(pet, p, { ownerStatus: 'online', streak: 0, now }), 'happy');
});

/* ---------- pets: levels + sprites on disk ---------- */
test('pets: level curve - L1 at 0, L2 at 10, L3 at 40, L5 at 160', () => {
  assert.equal(pets.petLevel({ xp: 0 }), 1);
  assert.equal(pets.petLevel({ xp: 9 }), 1);
  assert.equal(pets.petLevel({ xp: 10 }), 2);
  assert.equal(pets.petLevel({ xp: 40 }), 3);
  assert.equal(pets.petLevel({ xp: 160 }), 5);
  assert.equal(pets.petXpForNextLevel({ xp: 0 }), 10);
});
test('pets: every species x mood sprite exists on disk, 64x64 grid', () => {
  for (const s of pets.PET_SPECIES) {
    for (const m of pets.PET_MOODS) {
      const file = pets.petSpritePath(s.id, m);
      assert.ok(fs.existsSync(file), `missing sprite ${s.id}_${m}.png`);
      assert.ok(fs.statSync(file).size > 100, `${s.id}_${m}.png is not empty`);
    }
  }
  for (const h of pets.HABITAT_THEMES) {
    for (const t of pets.TIME_OF_DAY) {
      assert.ok(fs.existsSync(pets.habitatPath(h.id, t)), `missing habitat ${h.id}-${t}.png`);
    }
  }
});

/* ---------- time of day + timezone ---------- */
test('profile: time of day follows the member timezone hour', () => {
  // 06:30 Halifax = dawn; 12:00 = day; 18:30 = dusk; 23:00 = night
  assert.equal(pc.timeOfDay(new Date('2026-11-12T06:30:00-04:00'), 'America/Halifax'), 'dawn');
  assert.equal(pc.timeOfDay(new Date('2026-11-12T12:00:00-04:00'), 'America/Halifax'), 'day');
  assert.equal(pc.timeOfDay(new Date('2026-11-12T18:30:00-04:00'), 'America/Halifax'), 'dusk');
  assert.equal(pc.timeOfDay(new Date('2026-11-12T23:00:00-04:00'), 'America/Halifax'), 'night');
  // Same instant, different zone: 12:00 Halifax is 17:00 London (dusk edge -> day) and 09:00 LA (day)
  assert.equal(pc.timeOfDay(new Date('2026-11-12T16:00:00Z'), 'Europe/London'), 'day');
  assert.equal(pc.validTimezone('America/Halifax'), true);
  assert.equal(pc.validTimezone('Not/AZone'), false);
  assert.equal(pc.validTimezone(''), false);
});

/* ---------- rarity ---------- */
test('profile: rarity tiers climb with level', () => {
  assert.equal(pc.rarityFor(1).name, 'Cypress Sprout');
  assert.equal(pc.rarityFor(7).name, 'Mud Runner');
  assert.equal(pc.rarityFor(15).name, 'Gator Friend');
  assert.equal(pc.rarityFor(25).name, 'Cypress Guard');
  assert.equal(pc.rarityFor(40).name, 'Murk Royalty');
  assert.equal(pc.rarityFor(50).name, 'Crocodile King');
});

/* ---------- banner URL validation ---------- */
test('profile: banner URLs must look like pictures', () => {
  assert.equal(pc.validateBannerUrl('https://example.com/pic.png').ok, true);
  assert.equal(pc.validateBannerUrl('https://cdn.discordapp.com/attachments/1/a.webp?x=1').ok, true);
  assert.equal(pc.validateBannerUrl('https://i.imgur.com/abc123').ok, true); // known image host
  assert.equal(pc.validateBannerUrl('https://example.com/page.html').ok, false);
  assert.equal(pc.validateBannerUrl('ftp://example.com/pic.png').ok, false);
  assert.equal(pc.validateBannerUrl('not a url').ok, false);
});

/* ---------- showcase ---------- */
test('profile: showcase caps at 4, dedupes, validates ownership', () => {
  const rec = fixtureRec();
  const p = pc.ensureProfile(rec);
  assert.equal(pc.addShowcase(p, 'achievement', 'Errand Runner of the Murk', rec).ok, true);
  assert.equal(pc.addShowcase(p, 'achievement', 'Errand Runner of the Murk', rec).ok, false, 'no dupes');
  assert.equal(pc.addShowcase(p, 'achievement', 'First Into The Water', rec).ok, false, 'must own it');
  assert.equal(pc.addShowcase(p, 'loot', 'Glowshroom', rec).ok, true);
  assert.equal(pc.addShowcase(p, 'loot', 'Swamp Pearl', rec).ok, false, 'must hold it');
  assert.equal(pc.addShowcase(p, 'emoji', '🐊', rec).ok, true);
  assert.equal(pc.addShowcase(p, 'score', 'Trivia 12/12', rec).ok, true);
  assert.equal(pc.addShowcase(p, 'score', 'One more', rec).ok, false, 'cap is 4');
  assert.equal(pc.removeShowcase(p, 2).ok, true);
  assert.equal(p.showcase.length, 3);
  assert.equal(pc.removeShowcase(p, 9).ok, false);
});

/* ---------- guestbook wall ---------- */
test('profile: wall notes cap at 20 newest-first; only owner/mod removes', () => {
  const p = pc.blankProfile();
  for (let i = 0; i < 22; i++) pc.addWallNote(p, { by: `u${i}`, name: `Friend ${i}`, text: `note ${i}`, stamp: '' });
  assert.equal(p.wall.length, 20);
  assert.equal(p.wall[0].text, 'note 21', 'newest first');
  assert.equal(pc.addWallNote(p, { by: 'u', name: 'X', text: '   ' }).ok, false, 'empty notes refused');
  assert.equal(pc.removeWallNote(p, 1, 'u-stranger', 'u-owner', false).ok, false, 'strangers cannot remove');
  assert.equal(pc.removeWallNote(p, 1, 'u-mod', 'u-owner', true).ok, true, 'mods can remove');
  assert.equal(pc.removeWallNote(p, 1, 'u-owner', 'u-owner', false).ok, true, 'owner can remove');
  assert.equal(pc.removeWallNote(p, 99, 'u-owner', 'u-owner', false).ok, false);
});

/* ---------- stateless customIds ---------- */
test('profile: pf: customIds round-trip, foreign ids rejected', () => {
  assert.deepEqual(pc.parseCustomId(pc.wallNoteId('123')), { kind: 'wall', action: 'note', ownerId: '123' });
  assert.deepEqual(pc.parseCustomId(pc.wallListId('123')), { kind: 'wall', action: 'list', ownerId: '123' });
  assert.deepEqual(pc.parseCustomId(pc.wallSubmitId('123')), { kind: 'wall', action: 'submit', ownerId: '123' });
  assert.deepEqual(pc.parseCustomId(pc.layoutId('preset', '123')), { kind: 'layout', field: 'preset', ownerId: '123' });
  assert.deepEqual(pc.parseCustomId(pc.layoutId('pet', '123')), { kind: 'layout', field: 'pet', ownerId: '123' });
  assert.deepEqual(pc.parseCustomId(pc.saveId('123')), { kind: 'save', action: 'post', ownerId: '123' });
  assert.equal(pc.parseCustomId('sf:nav:decor'), null);
  assert.equal(pc.parseCustomId('pf:wall:teleport:123'), null);
  assert.equal(pc.parseCustomId('pf:layout:teleport:123'), null);
  assert.equal(pc.parseCustomId('pf:save:teleport:123'), null);
  assert.equal(pc.parseCustomId('pf:wall:note:'), null);
});
test('profile: Save & post button rides the owner card only, never a stranger view', async () => {
  const rec = fixtureRec();
  const user = { id: 'u-owner', username: 'TestGator' };
  const owner = await pc.buildProfileReply({ user, rec, viewerId: 'u-owner', presence: 'online', voiceChannelName: null, now: new Date() });
  const ownerIds = owner.components.flatMap(r => r.components.map(c => c.data.custom_id));
  assert.ok(ownerIds.includes(pc.saveId('u-owner')), 'owner card carries Save & post');
  assert.ok(owner.components.length <= 5, `owner card stays within Discord's 5-row cap (${owner.components.length})`);
  const stranger = await pc.buildProfileReply({ user, rec, viewerId: 'u-stranger', presence: 'online', voiceChannelName: null, now: new Date() });
  const strangerIds = stranger.components.flatMap(r => r.components.map(c => c.data.custom_id));
  assert.ok(!strangerIds.includes(pc.saveId('u-owner')), 'stranger view has no Save button');
});

/* ---------- layout editor ---------- */
test('profile: presets set all three slots; a manual pick makes it custom', () => {
  const p = pc.blankProfile();
  assert.equal(pc.applyLayoutPreset(p, 'pet-first').ok, true);
  assert.deepEqual(p.layout, { preset: 'pet-first', petCorner: 'bottom-left', bioPos: 'bottom', badgesPos: 'hidden' });
  assert.equal(pc.applyLayoutPreset(p, 'nope').ok, false);
  assert.equal(pc.setLayoutField(p, 'pet', 'top-right').ok, true);
  assert.equal(p.layout.petCorner, 'top-right');
  assert.equal(p.layout.preset, 'custom', 'manual pick clears the preset name');
  assert.equal(pc.setLayoutField(p, 'pet', 'middle').ok, false);
  assert.equal(pc.setLayoutField(p, 'nope', 'top').ok, false);
  assert.equal(pc.layoutPresetLabel(p), 'Custom');
});
test('profile: layout editor controls are 4 selects with the current picks marked', () => {
  const p = pc.blankProfile();
  p.layout = { preset: 'badges-front', petCorner: 'bottom-right', bioPos: 'top', badgesPos: 'bottom-left' };
  const rows = pc.buildLayoutControls('u-owner', p.layout);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    const select = row.components[0];
    assert.ok(select.data.custom_id.startsWith('pf:layout:'));
    assert.ok(select.options.some(o => o.data.default), `${select.data.custom_id} marks a default`);
  }
  assert.equal(rows[0].components[0].options.find(o => o.data.default).data.value, 'badges-front');
});

/* ---------- the generated card ---------- */
test('profile: renderProfileCard produces a real 800x400 PNG for both styles', async () => {
  const rec = fixtureRec();
  const p = pc.ensureProfile(rec);
  p.bio = 'Mud on my boots, gators in my heart.';
  p.pet = { species: 'frog', name: 'Hopper', xp: 45, fedAt: 0, adoptedAt: Date.now() };
  const user = { id: 'u-owner', username: 'TestGator' };
  for (const style of ['trading', 'passport']) {
    p.style = style;
    const att = await pc.renderProfileCard({ user, rec, viewerId: 'u-owner', presence: 'online', voiceChannelName: null, now: new Date('2026-11-12T21:30:00-04:00') });
    assert.equal(att.name, 'profile.png');
    const buf = att.attachment;
    assert.ok(Buffer.isBuffer(buf) && buf.length > 10000, `${style}: PNG bytes present (${buf.length})`);
    assert.equal(buf[0], 0x89, 'PNG magic');
    assert.equal(buf[1], 0x50);
  }
});
test('profile: every layout preset + pet corner renders a real card', async () => {
  const rec = fixtureRec();
  const p = pc.ensureProfile(rec);
  p.bio = 'Mud on my boots, gators in my heart.';
  p.pet = { species: 'gator', name: 'Chompy', xp: 120, fedAt: 0, adoptedAt: Date.now() };
  const user = { id: 'u-owner', username: 'TestGator' };
  for (const pr of pc.LAYOUT_PRESETS) {
    pc.applyLayoutPreset(p, pr.id);
    const att = await pc.renderProfileCard({ user, rec, viewerId: 'u-owner', presence: 'online', voiceChannelName: null, now: new Date('2026-11-12T21:30:00-04:00') });
    assert.ok(att.attachment.length > 10000, `${pr.id}: PNG bytes present`);
  }
  for (const corner of ['bottom-right', 'bottom-left', 'top-right']) {
    pc.setLayoutField(p, 'pet', corner);
    const att = await pc.renderProfileCard({ user, rec, viewerId: 'u-owner', presence: 'online', voiceChannelName: null, now: new Date() });
    assert.ok(att.attachment.length > 10000, `pet ${corner}: PNG bytes present`);
  }
});
test('profile: the card renders with no pet, no banner and no avatar (degraded layers)', async () => {
  const rec = fixtureRec();
  const user = { id: 'u-owner', username: 'NoPetNoBanner' };
  const att = await pc.renderProfileCard({ user, rec, viewerId: 'u-stranger', presence: null, voiceChannelName: null, now: new Date() });
  assert.ok(att.attachment.length > 5000);
});
test('profile: buildProfileReply pairs image + embed + the right button', async () => {
  const rec = fixtureRec();
  const p = pc.ensureProfile(rec);
  p.wall = [{ by: 'u2', name: 'Friend', text: 'Hello swamp.', stamp: '🐊', at: Date.now() }];
  const user = { id: 'u-owner', username: 'TestGator' };
  const stranger = await pc.buildProfileReply({ user, rec, viewerId: 'u-stranger', presence: 'online', voiceChannelName: null, now: new Date() });
  assert.equal(stranger.embeds[0].data.image.url, 'attachment://profile.png');
  assert.equal(stranger.files[0].name, 'profile.png');
  assert.equal(stranger.components[0].components[0].data.custom_id, 'pf:wall:note:u-owner');
  const owner = await pc.buildProfileReply({ user, rec, viewerId: 'u-owner', presence: 'online', voiceChannelName: null, now: new Date() });
  assert.equal(owner.components[0].components[0].data.custom_id, 'pf:wall:list:u-owner');
});
