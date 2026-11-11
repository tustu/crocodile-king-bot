'use strict';
/** Quests, trivia and the Gator Ate My Answer bank. */

/** Daily quests rotate deterministically by Halifax day-of-year. */
const QUESTS = [
  { id: 'chat15', type: 'messages', target: 15, label: 'Chat 15 messages anywhere in THE SWAMP', rewardXp: 100, rewardBucks: 25 },
  { id: 'voice20', type: 'voiceMinutes', target: 20, label: 'Spend 20 minutes in a voice channel', rewardXp: 120, rewardBucks: 30 },
  { id: 'react10', type: 'reactions', target: 10, label: 'Drop 10 reactions on other members\' posts', rewardXp: 80, rewardBucks: 20 },
  { id: 'art1', type: 'artPosts', target: 1, label: 'Post 1 piece in Swamp Art (or any post with an image attached)', rewardXp: 150, rewardBucks: 40 },
  { id: 'chat30', type: 'messages', target: 30, label: 'Chat 30 messages anywhere in THE SWAMP', rewardXp: 160, rewardBucks: 40 },
  { id: 'trivia1', type: 'triviaCorrect', target: 1, label: 'Answer a /trivia question right', rewardXp: 90, rewardBucks: 25 },
  { id: 'voice10chat10', type: 'messages', target: 10, label: 'Chat 10 messages (then go touch some voice-channel grass too)', rewardXp: 90, rewardBucks: 20 },
];

function questForDate(dateKey, date = new Date()) {
  // day-of-year from the Halifax date key keeps every member on the same quest
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayOfYear = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  return QUESTS[dayOfYear % QUESTS.length];
}

const TRIVIA = [
  { q: 'How long can an American alligator grow?', a: ['about 13 feet', '13 feet', '13 ft', 'around 13 feet'], hint: 'Big. Longer than a car.' },
  { q: 'What do you call a group of alligators?', a: ['a congregation', 'congregation'], hint: 'Sounds like church. Fitting for the swamp.' },
  { q: 'Alligators are found wild in which two countries only?', a: ['america and china', 'usa and china', 'the us and china', 'united states and china'], hint: 'One big one across the Pacific.' },
  { q: 'What plant forms the giant floating mats and canopy in southern swamps - the big tree with knees and Spanish moss?', a: ['cypress', 'bald cypress', 'the cypress'], hint: 'It guards this server at level 35.' },
  { q: 'True or false: an alligator can run faster than a human in a straight line?', a: ['false'], hint: 'They burst, they do not marathon. Still do not test it.' },
  { q: 'What do alligators mostly use their tails for in the water?', a: ['swimming', 'propulsion', 'to swim'], hint: 'It is their engine.' },
  { q: 'Which season is peak gator mating (and fight) season?', a: ['spring', 'april to june', 'mating season', 'springtime'], hint: 'April to June - Gator Fight Night season.' },
  { q: 'What is the money of THE SWAMP called?', a: ['swamp bucks'], hint: 'You are earning it right now.' },
  { q: 'A baby alligator is called a what?', a: ['hatchling', 'a hatchling'], hint: 'Fresh out of the egg.' },
  { q: 'Gators have how many teeth, roughly, at any one time?', a: ['80', 'about 80', 'around 80'], hint: 'And they regrow them. Show-offs.' },
];

/** Gator Ate My Answer: the Crocodile King hides a word, the gator "ate" the middle. */
const GATOR_WORDS = [
  { word: 'alligator', clue: 'The king of this swamp, long snout, longer patience.' },
  { word: 'cypress', clue: 'The great swamp tree with knees in the water.' },
  { word: 'firefly', clue: 'Tiny lantern of the night swamp.' },
  { word: 'bayou', clue: 'Slow-moving swamp water, Louisiana style.' },
  { word: 'voodoo', clue: 'Swamp magic, dolls and pins. The King allows it. Barely.' },
  { word: 'catfish', clue: 'Whiskered bottom-dweller, fine eating, finer gossip.' },
  { word: 'moonshine', clue: 'Comes in a jar, glows in the Chronicle horoscope sky.' },
  { word: 'tadpole', clue: 'Every Murk Royalty started as one of these.' },
];

function hideWord(word) {
  if (word.length <= 3) return word[0] + '_'.repeat(word.length - 1);
  return word[0] + '_'.repeat(word.length - 2) + word[word.length - 1];
}

/** The big standing welcome post for the welcome channel, word for word the
 * owner's text (set 2026-11-10). Posted by /welcomepost to whichever channel
 * /setup assigned as the welcome channel, and pinned so it stays on top. */
const WELCOME_POST = `🐊 **WELCOME TO THE SWAMP!** 🍻💨🎮

Welcome to The Swamp, where we drink, smoke, game, talk shit, and have a good time!

Thanks for joining our community! Before you can access everything the server has to offer, you’ll need to complete a quick verification with one of our Moderators or Admins.

🔐 STEP 1: **JOIN THE WAITING ROOM**

👉 https://discord.com/channels/337050121717940232/1484649222111494314

Head into the waiting room and hang out until a staff member is available to verify you.

📢 STEP 2: NEED A STAFF MEMBER?

👉 https://discord.com/channels/337050121717940232/1498665398542008362

If you’ve been waiting a while, head into Verify Chat and ping a Moderator or Admin for assistance.

⏳ **PLEASE BE PATIENT**

Our staff aren’t always available immediately, but someone will get to you as soon as possible. Please avoid repeatedly pinging the team.

🎁 **AFTER VERIFICATION**

Once approved by staff, you’ll unlock access to the server and receive your welcome rewards!

🐊 **WELCOME TO THE FAMILY!**

We appreciate you joining The Swamp! Make yourself at home, meet some new people, and get ready for some good times.

Thanks for joining, and we look forward to smoking, gaming, and kicking back with you! 🍻💨🔥

**THE SWAMP | DRINK • SMOKE • GAME** 🐊`;

module.exports = { QUESTS, questForDate, TRIVIA, GATOR_WORDS, hideWord, WELCOME_POST };
