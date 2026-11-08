'use strict';
/**
 * Legal pages for the Discord Developer Portal URL fields.
 * Served by the HTTP server in src/index.js at /terms and /privacy.
 * The same texts live in TERMS.md and PRIVACY.md at the repo root.
 * Keep the HTML and the markdown in step if these ever change.
 */

const style = `
  body { background:#0b120c; color:#e8f2e4; font-family: Georgia, 'Times New Roman', serif;
         max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; line-height: 1.6; }
  h1 { color:#7dd069; font-size: 28px; margin-bottom: 4px; }
  h2 { color:#7dd069; font-size: 19px; margin-top: 28px; }
  .updated { color:#9db894; font-size: 14px; margin-top: 0; }
  a { color:#a5dd8f; }
`;

const termsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terms of Service - Crocodile King</title>
<style>${style}</style>
</head>
<body>
<h1>Terms of Service - Crocodile King</h1>
<p class="updated">Last updated: November 7, 2026</p>

<p>Crocodile King is a free community host bot for THE SWAMP Discord server, run by the Swampology.com community owners. He greets members, helps with verification reminders, runs quests and games, and keeps XP and level books for the server. By using THE SWAMP and interacting with Crocodile King, you agree to these terms.</p>

<h2>1. A free entertainment system</h2>
<p>Crocodile King is a free entertainment and community system. There is no charge to use him, and no purchase is needed to earn XP, levels, or Swamp Bucks.</p>

<h2>2. Virtual points have no cash value</h2>
<p>XP, levels, titles, and Swamp Bucks are virtual only. They have no cash value, they are not money, and they cannot be exchanged or transferred for money or anything outside the server. Server admins may adjust, correct, or reset XP, levels, Swamp Bucks, streaks, and roles at any time, for example to fix a bug, undo farming, or restart a season.</p>

<h2>2a. Items, Raid Passes, factions, passes and action points</h2>
<p>Members who boost the server receive a monthly Booster Pack of virtual items (Swamp Bucks, a Raid Pass, loot and reputation) for as long as their boost is active, once per calendar month. Loot items - including Raid Passes - are virtual inventory items with no cash value, exactly like XP and Swamp Bucks. A Raid Pass can be spent in the bot to trigger a server-wide event; it is not a ticket to anything outside the server. Faction membership is a team label inside the server's games; switching factions can cost virtual Swamp Bucks and has a cooldown, both set by the bot's rules. A VIP Pass is either a server role or a timed grant given by server admins inside the bot; while active it raises a member's daily action points and adds a bonus XP line, and it ends when its time runs out. Action points are a daily play allowance for certain bot games: they refill each day and have no value outside the bot. Cosmetic titles are display text shown inside the bot only.</p>

<h2>2b. The King's store, consumables and decorations</h2>
<p>The bot includes a store (The King's Little Store) where members spend Swamp Bucks - and only Swamp Bucks. Swamp Bucks cannot be bought with real money anywhere in the bot, and real money is never accepted for store goods. Everything in the store is virtual and has no cash value: loot items, a one-day pass, an XP feast, single-use consumables (a Streak Shield that protects a daily streak once, a Double-Down Token that doubles the Swamp Bucks of one quest claim, and an Event Lure that triggers an event), and decorations. Members may also sell loot items back to the store; selling pays Swamp Bucks only, never money. Avatar frames and profile backgrounds are decorations: buying one adds it to the member's in-bot wardrobe, and the equipped background and frame decorate the member's profile card inside the bot. The bot can also generate a picture file that composites the member's own current Discord avatar inside a purchased frame; the member may download that file and upload it as their own Discord avatar. The bot cannot and does not modify anyone's Discord account or profile, and it does not grant or sell Discord's own avatar decorations or shop items - only the member can change their own Discord avatar.</p>

<h2>3. Fair play</h2>
<p>Play straight. Do not spam, use bots or scripts, or use alternate accounts to farm XP, Swamp Bucks, quest rewards, or event prizes. Admins and mods may remove XP, Swamp Bucks, levels, or roles gained by farming or cheating, and may limit or remove a member's access to bot features for breaking this rule.</p>

<h2>4. Sponsor quests</h2>
<p>Some quests are sponsored. Every sponsor quest is always clearly labelled "Sponsored". Taking part is always optional. Sponsor quest prizes are virtual (XP and Swamp Bucks) unless the quest's own text says otherwise. A sponsor quest may also award a server role, or a digital prize key provided by the sponsor; keys are delivered to the winning member by direct message only and are never posted in a public channel. Sponsors receive participation counts only, never member lists or private information.</p>

<h2>5. Changes to the bot</h2>
<p>The owners and admins may change, pause, or remove any bot feature, quest, event, reward, or bonus at any time, with or without notice.</p>

<h2>6. Provided as-is</h2>
<p>Crocodile King is provided "as is", without warranties of any kind. The owners are not responsible for lost XP, Swamp Bucks, streaks, or progress if data is lost, for example if the hosting service resets its storage, or for downtime while the bot is offline.</p>

<h2>7. Discord's terms also apply</h2>
<p>Using Crocodile King also means following Discord's own Terms of Service and Community Guidelines. If Discord or the server admins remove a member from THE SWAMP, their bot record may be removed too.</p>

<h2>8. Questions</h2>
<p>Questions about these terms: ask a server admin or mod in THE SWAMP Discord server.</p>
</body>
</html>
`;

const privacyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy - Crocodile King</title>
<style>${style}</style>
</head>
<body>
<h1>Privacy Policy - Crocodile King</h1>
<p class="updated">Last updated: November 7, 2026</p>

<p>Crocodile King is a free community host bot for THE SWAMP Discord server, run by the Swampology.com community owners. This policy says plainly what the bot stores, why, and how to have your record deleted.</p>

<h2>What the bot stores</h2>
<p>For each member who uses THE SWAMP, the bot stores a record tied to their Discord user ID with only these things:</p>
<ul>
<li>XP, level, and Swamp Bucks balance</li>
<li>Daily streak and the date of the last daily claim</li>
<li>The date the member joined the server</li>
<li>Whether the member is verified, the date they were verified, and which verification reminder stage they have reached</li>
<li>Quest progress for the day (counts of messages, voice minutes, reactions, Swamp Art posts, and correct trivia answers) and which day's quest was claimed</li>
<li>Activity counters: total messages counted, total voice minutes, and a timestamp used for the message XP cooldown</li>
<li>Sponsor quest award records: member user ID and the time of the award, nothing else</li>
<li>Faction membership, and the member's faction XP contributions counted into weekly and all-time faction pools</li>
<li>Reputation (Rep) score</li>
<li>Loot inventory: which virtual items the member holds and how many of each</li>
<li>Cosmetic titles the member has unlocked or had generated, and which one is active</li>
<li>VIP Pass state: whether a timed pass is active and the time it expires</li>
<li>Action points left for the day and the date they belong to</li>
<li>Generated side quest state: the member's current side quest (type, target and progress) until it is claimed or dropped</li>
<li>Sponsor-provided digital prize keys for a sponsor quest, held in the quest's key pool only until they are awarded to a winning member by direct message</li>
<li>For server boosters, the month (year and month only) of their last Booster Pack, used only to pay the pack once per month</li>
<li>Store state: the date (day only) of the member's last Firefly Tonic purchase, which avatar frames and profile backgrounds the member owns and which are equipped, and how many store consumables (Streak Shields, Double-Down Tokens, Event Lures) the member holds</li>
</ul>
<p>The bot does not collect or store email addresses, real names, payment information, or location.</p>

<h2>Why it is stored</h2>
<p>This information is used only to run the bot's own features: working out XP, levels, and XP bonuses, paying daily and quest rewards, tracking streaks, sending verification reminders, running trivia and Gator Ate My Answer games, keeping faction standings, reputation, loot inventories, cosmetic titles, action points and generated side quests, running the Swamp Bucks store (balances are never charged in real money - no payment information exists to store), and counting sponsor quest participation. Sponsor prize keys are used for one thing only: delivery to the member who won them.</p>

<h2>Message content</h2>
<p>The bot reads message text in the moment only, to count activity and to check trivia and Gator Ate My Answer guesses against the answer. Message text is not stored, not logged to the data file, and never sold or shared.</p>

<h2>Voice</h2>
<p>Voice activity is counted as minutes only: the bot counts a member who is sitting in a voice channel as present for that minute. No audio is recorded, listened to, or stored, ever.</p>

<h2>Where the data lives</h2>
<p>Records are kept in a local data file on the machine that hosts the bot (data/store.json). It is not kept in an outside database service.</p>

<h2>Sharing</h2>
<p>Personal data is not sold, rented, or shared. Sponsors of sponsor quests receive aggregate participation counts only (for example, how many awards were given in a month). They never receive member lists, user records, or any private information.</p>

<h2>Deleting your data</h2>
<p>Any member can ask for their bot record to be deleted. Contact a server admin or mod in THE SWAMP Discord server and ask them to remove your Crocodile King record; your entry will be removed from the bot's data file. Deleting the record removes your XP, levels, Swamp Bucks, and streak permanently.</p>

<h2>Children</h2>
<p>Discord's own age rules apply to THE SWAMP and to this bot. Anyone who is not old enough to use Discord under Discord's Terms of Service should not use the server or the bot.</p>

<h2>Changes to this policy</h2>
<p>If this policy changes, the updated version will be posted on this page and the "Last updated" date at the top will change.</p>

<h2>Questions</h2>
<p>Questions about this policy or your data: ask a server admin or mod in THE SWAMP Discord server.</p>
</body>
</html>
`;

module.exports = { termsHtml, privacyHtml };
