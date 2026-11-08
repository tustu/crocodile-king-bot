'use strict';
/** Central config - HOME EDITION (v2.2).
 *  Env is now a SEED, not the final word: at boot the env IDs fill the
 *  stored config in store.json only where the stored config is still
 *  blank, and afterwards the server is wired from inside Discord with
 *  /setup panel (pick the server's own roles/channels from dropdowns) and
 *  /setup create (fill only the gaps). In-server picks always win over
 *  env and survive restarts. See src/setup.js.
 *  Everything is optional except the token. Optional IDs unset => the
 *  feature that needs them logs a warning and skips. Never crashes. */

// Tiny .env loader (no dependency): KEY=VALUE lines, # comments.
const fs = require('fs');
const path = require('path');
(function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  try {
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* env file is optional */ }
})();

const env = (k, d = '') => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const envOrNull = (k) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : null);

function parseLevelRoleIds() {
  // LEVEL_ROLE_IDS='{"5":"123","10":"456"}'  level -> Discord role ID
  try { return JSON.parse(env('LEVEL_ROLE_IDS', '{}')); } catch { return {}; }
}

function parseFactionRoleIds() {
  // FACTION_ROLE_IDS='{"kings-court":"123","cypress-clan":"456","glowshroom-circle":"789"}'
  // faction id -> Discord role ID. Optional: unset = factions work without roles.
  try { return JSON.parse(env('FACTION_ROLE_IDS', '{}')); } catch { return {}; }
}

const config = {
  token: env('DISCORD_TOKEN'),
  clientId: env('CLIENT_ID'),
  guildId: env('GUILD_ID'),
  welcomeChannelId: env('WELCOME_CHANNEL_ID'),
  verifyChannelId: env('VERIFY_CHANNEL_ID'),
  verifiedRoleId: env('VERIFIED_ROLE_ID'),
  modRoleId: env('MOD_ROLE_ID'),
  modChannelId: env('MOD_CHANNEL_ID'),
  royaltyRoleId: env('ROYALTY_ROLE_ID'),
  boosterRoleId: env('BOOSTER_ROLE_ID'),
  questChannelId: env('QUEST_CHANNEL_ID'),
  levelUpChannelId: env('LEVELUP_CHANNEL_ID'),
  announceChannelId: env('ANNOUNCE_CHANNEL_ID'),
  kingChannelId: env('KING_CHANNEL_ID'), // main King channel (storefront home); announce fallback
  artChannelId: env('ART_CHANNEL_ID'), // optional: Swamp Art channel for the art quest
  timezone: env('TIMEZONE', 'America/Halifax'),
  port: parseInt(env('PORT', '7860'), 10) || 7860,
  verifyInstructions: env('VERIFY_INSTRUCTIONS',
    'head to the verify channel and follow the pinned steps - one step, takes a minute'),
  autoEvents: env('AUTO_EVENTS', 'false').toLowerCase() === 'true',
  levelRoleIds: parseLevelRoleIds(),
  factionRoleIds: parseFactionRoleIds(),
};

/** The env seed for the STORED config, in blankHomeConfig() shape
 *  (see src/setup.js). Nulls mean "env does not seed this field". At boot
 *  these fill only fields the stored config still has blank, so an admin's
 *  /setup pick is never stomped by env on a restart. */
function envSeedConfig() {
  return {
    welcomeChannelId: envOrNull('WELCOME_CHANNEL_ID'),
    verifyChannelId: envOrNull('VERIFY_CHANNEL_ID'),
    verifiedRoleId: envOrNull('VERIFIED_ROLE_ID'),
    modRoleId: envOrNull('MOD_ROLE_ID'),
    modChannelId: envOrNull('MOD_CHANNEL_ID'),
    royaltyRoleId: envOrNull('ROYALTY_ROLE_ID'),
    boosterRoleId: envOrNull('BOOSTER_ROLE_ID'),
    questChannelId: envOrNull('QUEST_CHANNEL_ID'),
    levelUpChannelId: envOrNull('LEVELUP_CHANNEL_ID'),
    announceChannelId: envOrNull('ANNOUNCE_CHANNEL_ID'),
    kingChannelId: envOrNull('KING_CHANNEL_ID'),
    artChannelId: envOrNull('ART_CHANNEL_ID'),
    levelRoleIds: parseLevelRoleIds(),
    factionRoleIds: parseFactionRoleIds(),
  };
}

/** Level -> role NAME ladder (names for humans; IDs come from LEVEL_ROLE_IDS env). */
const LEVEL_LADDER = [
  { level: 1, name: 'Tadpole' },
  { level: 5, name: 'Swamp Sprout' },
  { level: 10, name: 'Mud Runner' },
  { level: 20, name: 'Gator Friend' },
  { level: 35, name: 'Cypress Guard' },
  { level: 50, name: 'Murk Royalty' },
];

function ladderTitleFor(level) {
  let title = LEVEL_LADDER[0].name;
  for (const rung of LEVEL_LADDER) if (level >= rung.level) title = rung.name;
  return title;
}

module.exports = { config, LEVEL_LADDER, ladderTitleFor, envSeedConfig };
