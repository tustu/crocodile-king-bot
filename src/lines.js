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
  welcome: [
    "Well look what the river dragged in. Welcome to THE SWAMP, {member}. Smile wide. The swamp is watching. You are in the mud now, but you are not family till you are verified: {verify}. One minute, no bite, King's word.",
    "{member} just climbed up on my dock. Welcome to THE SWAMP. I am the Crocodile King, and I did not come to splash. I came to rule. First order from the throne: get verified: {verify}. Do that and the good channels, the drops and your XP bonus all unlock.",
    "New feet on the boardwalk. Welcome, {member}. The King sees every new face in his swamp. Get yourself verified: {verify}, and we will get you fed, levelled and paid in Swamp Bucks.",
  ],
  reminder30: [
    "{member}, you are still standin' at the gate with wet feet. 30 minutes in and no verification. Even a king loses patience. Get it done: {verify}, or you keep missin' drops, quests and your +25% verified XP bonus.",
    "Hey {member}. Straight talk from the throne: unverified folks get the bench, verified folks get the swamp. {verify}. Takes a minute. The King checked.",
    "{member}, the gators are circlin' and you are still unverified. I should know, I sent them. Stamp that pass: {verify}, and come get your Welcome Pack before someone else eats it.",
  ],
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
  verified: [
    "Stamped and swamp legal, {member}. Welcome to the family proper. Your +25% verified XP bonus is live, your Welcome Pack is below, now go make some noise in the King's swamp.",
    "That is the spirit, {member}. Verified. The whole swamp just unlocked for you. XP bonus on, quests open, gators friendly-ish. Even the King.",
    "{member} is verified and officially one of ours. Go say hi, grab /daily, and do not let the Tadpoles out-level you. The King is watchin' the board.",
  ],
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
