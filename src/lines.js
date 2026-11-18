'use strict';
/** The Crocodile King's voice. Masculine, sly, ruling. King of THE SWAMP.
 *  Funny, straightforward, swamp. Every stage has 3+ variants.
 *  Placeholders: {member} {name} {level} {title} {xp} {bucks} {quest} {sponsor} */
function pick(lines, seed) {
  const i = seed !== undefined ? Math.abs(seed) % lines.length : Math.floor(Math.random() * lines.length);
  return lines[i];
}
function fill(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}
function line(stage, vars = {}, seed) {
  return fill(pick(LINES[stage] || [''], seed), vars);
}

const LINES = {
  // No 'welcome' stage: the join greeting was cut 2026-11-18 by the
  // owner - joins get the full WELCOME_POST only (src/content.js).
  // No 'reminder30' stage: the 30-min member reminder was cut the same
  // day - it posted into the welcome channel, which carries ONLY the
  // WELCOME_POST now. The 2h/24h mod nudges below are mod-channel only.
  modNudge2h: [
    "Mods. {name} has been unverified for 2 hours. Somebody stamp their swamp pass before they turn into a lurker statue in my kingdom.",
    "Heads up, mods: {name} joined 2 hours ago and is still at the gate. Quick verify and they are in. Do not leave them to the mosquitoes. The King does not like waitin'.",
    "Mod call: {name}, unverified, 2 hours and countin'. Whoever is free, run the verify before the King starts namin' names.",
  ],
  modRenudge24h: [
    "Mods, day two bell: {name} is STILL unverified after 24 hours. Verify them or let them drift, but somebody pick one. Royal orders.",
    "24 hours, mods. {name} remains at the gate. The King has reminded, nudged, and now he is showin' teeth.",
    "Last call on {name}. Unverified for a full day. One of you stamp it today. The throne thanks you. The teeth do not.",
  ],
  // No 'verified' stage: the verified announcement was cut 2026-11-18 -
  // the Welcome Pack still lands silently, but nothing posts in the
  // welcome channel except the WELCOME_POST.
  levelUp: [
    "{member} just hit Level {level}: {title}! The swamp notices. +{bucks} Swamp Bucks in your pocket. Keep sloshin'. The King approves.",
    "LEVEL UP: {member} is now Level {level} ({title}). +{bucks} Swamp Bucks. Smile wide. Even the throne tipped its crown.",
    "The King sees you, {member}. Level {level}, {title}, +{bucks} Swamp Bucks richer. This is how legends get muddy.",
  ],
  dailyQuest: [
    "Mornin', swamp. The King's quest of the day: **{quest}**. Finish it, run /quest claim, and the XP (with YOUR bonus multiplier) and Swamp Bucks are yours.",
    "New day, new mud. Today's royal quest: **{quest}**. /quest shows your progress. No quest, no glory. That is the rule and I did not make it. (I did. I am the King. I made it.)",
    "The swamp provides a quest: **{quest}**. Knock it out today and claim with /quest claim before the Halifax midnight bell. The King pays his debts.",
  ],
  eventSpawn: [
    "SOMETHIN' STIRRED THE WATER. A swamp event just spawned in this channel. React 🐊 to get your hits in. Participants eat XP and Swamp Bucks. King's orders.",
    "The Crocodile King sounds the horn: EVENT IN THE SWAMP. React 🐊 to join the fight. Every hit counts, everybody who swings gets paid.",
    "Chest, beast, or both. It just surfaced right here, in the King's water. React 🐊 to jump in before it sinks again.",
  ],
  boosterPack: [
    "🚀 BOOSTER PACK on the dock for {member}! The King rewards those who lift his swamp: +100 Swamp Bucks, +1 Raid Pass, a fistful of loot and +5 Rep for {month}. Boosters eat first here. That is the rule, and it is also just manners.",
    "Hear that splash? That is {member}'s {month} BOOSTER PACK hittin' the water: +100 Swamp Bucks, +1 Raid Pass, 2 loot rolls and +5 Rep. The King remembers who carries his banner. Every month you boost, every month he pays.",
    "The throne provides. {member} boosted THE SWAMP, so the {month} Booster Pack is theirs: +100 Swamp Bucks, +1 Raid Pass, loot from the deep shelf and +5 Rep. Smile wide - boosted is a beautiful look on you.",
  ],
  sponsorQuest: [
    "**Sponsored** - {sponsor} is runnin' a quest in THE SWAMP: **{title}**. {description} Reward: {xp} XP and {bucks} Swamp Bucks, and this channel carries a 2x XP bonus while it is live. Marked Sponsored, always. That is the King's house rule.",
  ],
};

module.exports = { LINES, line, pick, fill };
