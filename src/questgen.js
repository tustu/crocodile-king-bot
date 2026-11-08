'use strict';
/**
 * The King's quest generator: side quests composed on the fly from parts.
 * PROCEDURAL generation from the bot's own tables - no LLM, no external API,
 * no API key, no cost. Activity types are only ones the bot already tracks,
 * so progress is counted by the same counters as the daily quest.
 */
const { mulberry32 } = require('./loot');

/** Per-type scaling: target = base + level step, randomised inside a band. */
const TYPE_SPECS = {
  messages: { label: 'chat messages', base: 8, perLevel: 1.5, band: 8, xpPerUnit: 6, min: 5, max: 40 },
  voiceMinutes: { label: 'minutes in voice', base: 8, perLevel: 1.2, band: 8, xpPerUnit: 8, min: 5, max: 35 },
  reactions: { label: 'reactions dropped', base: 4, perLevel: 0.8, band: 5, xpPerUnit: 9, min: 3, max: 20 },
  artPosts: { label: 'art posts (image attached)', base: 1, perLevel: 0.08, band: 1, xpPerUnit: 60, min: 1, max: 2 },
  triviaCorrect: { label: 'trivia answers right', base: 1, perLevel: 0.15, band: 1, xpPerUnit: 50, min: 1, max: 3 },
};
const TYPES = Object.keys(TYPE_SPECS);

const THEMES = {
  messages: [
    'The dock gossips have gone quiet and the King hates a quiet dock.',
    'Rumour says a rival gator is talkin\' big two channels over.',
    'The fireflies are takin\' attendance and your name keeps comin\' up short.',
    'Court business needs voices in it, and yours carries.',
  ],
  voiceMinutes: [
    'The King wants ears in the voice channels - a court that only types is half a court.',
    'Stories told out loud weigh more in the swamp. Go weigh in.',
    'The cypresses lean in to listen. Give them somethin\' worth the lean.',
  ],
  reactions: [
    'Morale in the murk runs on little green hearts and fire. Spread some.',
    'The King is countin\' who cheers for their own. It is a short list and a long memory.',
    'A quiet swamp is a suspicious swamp. Make some noise, the emoji kind.',
  ],
  artPosts: [
    'The gallery wall in the King\'s head has a bare patch shaped exactly like your work.',
    'Swamp Art is the court\'s portrait hall. Hang somethin\' in it.',
    'The glowshrooms are showin\' off again. Answer them with art.',
  ],
  triviaCorrect: [
    'A heron at the gate is askin\' questions above its station. Out-answer it.',
    'The King keeps his crowns polished and his facts sharper. Prove yours are too.',
    'Trivia night is a blood sport here. The blood is metaphorical. Mostly.',
  ],
};

function pickFrom(arr, rng) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

/**
 * Compose a side quest for a member.
 * @param {object} opts
 * @param {number} [opts.level] member level (targets scale with it, clamped to spec min/max)
 * @param {number} [opts.seed] deterministic seed (defaults to random)
 * @returns {{type:string, typeLabel:string, target:number, theme:string, label:string, rewardXp:number, rewardBucks:number}}
 */
function generateSideQuest(opts = {}) {
  const level = Math.max(1, Math.floor(opts.level) || 1);
  const rng = opts.rng || (opts.seed !== undefined ? mulberry32(opts.seed) : Math.random);
  const type = opts.type && TYPE_SPECS[opts.type] ? opts.type : pickFrom(TYPES, rng);
  const spec = TYPE_SPECS[type];
  const jitter = Math.floor(rng() * (spec.band + 1));
  let target = Math.round(spec.base + spec.perLevel * (level - 1) + jitter);
  target = Math.max(spec.min, Math.min(spec.max, target));
  const rewardXp = Math.round(target * spec.xpPerUnit * (1 + (level - 1) * 0.05));
  const rewardBucks = Math.max(5, Math.floor(rewardXp / 4));
  const theme = pickFrom(THEMES[type], rng);
  return {
    type, typeLabel: spec.label, target, theme,
    label: `${theme} Do: ${target} x ${spec.label}.`,
    rewardXp, rewardBucks,
  };
}

module.exports = { TYPE_SPECS, TYPES, THEMES, generateSideQuest };
