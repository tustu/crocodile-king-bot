'use strict';
/** Slash command definitions - the single source: buildCommands().
 *  The bot auto-registers these on boot (src/index.js) whenever GUILD_ID
 *  is set, so hosted deploys (Hugging Face) need no manual step. This CLI
 *  still works for manual registration:
 *    node src/deploy-commands.js
 *  Needs DISCORD_TOKEN, CLIENT_ID and GUILD_ID in .env (guild commands = instant). */
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { config } = require('./config');
const { FACTIONS } = require('./factions');
const { LOOT_TABLE } = require('./loot');
const { SHOP_ITEMS, SELLABLE, SELL_PRICES } = require('./shop');
const { FRAMES } = require('./avatarframe');
const { BACKGROUNDS } = require('./backgrounds');
const { MOODS } = require('./profilecard');
const { PET_SPECIES, HABITAT_THEMES } = require('./pets');

const admin = (c) => c.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const setupPerms = (c) => c.setDefaultMemberPermissions(PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild);

function buildCommands() {
  return [
  setupPerms(new SlashCommandBuilder().setName('setup').setDescription('Admin: wire the Crocodile King into this server - from inside the server')
    .addSubcommand(s => s.setName('panel').setDescription('Dropdown panel: pick this server\'s existing roles + channels (saves instantly)'))
    .addSubcommand(s => s.setName('show').setDescription('The whole wiring at a glance, plus what is still missing'))
    .addSubcommand(s => s.setName('create').setDescription('The King builds ONLY the missing pieces (roles/channels), defaults + right permissions'))
    .addSubcommand(s => s.setName('reset').setDescription('Clear the stored wiring back to the env seed (member books NOT touched)'))),
  new SlashCommandBuilder().setName('profile').setDescription('Your swamp profile card: bio, banner, style, pet, showcase, guestbook')
    .addSubcommand(s => s.setName('view').setDescription('Show a member\'s visual swamp card')
      .addUserOption(o => o.setName('member').setDescription('Whose card (default: you)')))
    .addSubcommand(s => s.setName('bio').setDescription('Write your short bio / status (160 characters max)')
      .addStringOption(o => o.setName('text').setDescription('Your bio').setRequired(true).setMaxLength(160)))
    .addSubcommand(s => s.setName('banner').setDescription('Pick an owned background theme, or set a custom banner image URL')
      .addStringOption(o => o.setName('theme').setDescription('An owned background theme')
        .addChoices(...BACKGROUNDS.map(b => ({ name: b.name, value: b.id }))))
      .addStringOption(o => o.setName('url').setDescription('Custom banner image URL (.png/.jpg/.gif/.webp)'))
      .addBooleanOption(o => o.setName('clear').setDescription('Clear the custom banner back to your equipped theme')))
    .addSubcommand(s => s.setName('privacy').setDescription('Hide or show parts of your card to other members (your own view always shows all)')
      .addBooleanOption(o => o.setName('rank').setDescription('Show your level + XP to others'))
      .addBooleanOption(o => o.setName('inventory').setDescription('Show your loot bag to others'))
      .addBooleanOption(o => o.setName('activity').setDescription('Show your streak + messages to others'))
      .addBooleanOption(o => o.setName('balance').setDescription('Show your Swamp Bucks to others')))
    .addSubcommand(s => s.setName('style').setDescription('Card style: swamp trading card or swamp passport')
      .addStringOption(o => o.setName('style').setDescription('Card style').setRequired(true)
        .addChoices({ name: 'Swamp Trading Card', value: 'trading' }, { name: 'Swamp Passport', value: 'passport' })))
    .addSubcommand(s => s.setName('color').setDescription('Your favorite color - the card accent')
      .addStringOption(o => o.setName('hex').setDescription('A hex color, e.g. #ff7043').setRequired(true)))
    .addSubcommand(s => s.setName('timezone').setDescription('Your timezone - the card lighting shifts with your local hour')
      .addStringOption(o => o.setName('zone').setDescription('IANA name, e.g. America/Halifax').setRequired(true)))
    .addSubcommand(s => s.setName('showcase').setDescription('Pin your best to the card - up to 4 slots')
      .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true)
        .addChoices({ name: 'Add a pin', value: 'add' }, { name: 'Remove a pin', value: 'remove' }, { name: 'List pins', value: 'list' }))
      .addStringOption(o => o.setName('kind').setDescription('What kind of pin')
        .addChoices({ name: 'Achievement title', value: 'achievement' }, { name: 'Title', value: 'title' }, { name: 'Loot item', value: 'loot' }, { name: 'Emoji', value: 'emoji' }, { name: 'Score', value: 'score' }))
      .addStringOption(o => o.setName('value').setDescription('The title, loot name, emoji or score to pin').setMaxLength(40))
      .addIntegerOption(o => o.setName('slot').setDescription('Slot number to remove (1-4)')))
    .addSubcommand(s => s.setName('pet').setDescription('Your swamp pixel pet - adopt, feed, rename, pick its habitat')
      .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true)
        .addChoices({ name: 'Adopt a pet', value: 'adopt' }, { name: 'Feed your pet', value: 'feed' }, { name: 'Rename your pet', value: 'rename' }, { name: 'Pet habitat strip', value: 'habitat' }, { name: 'Pet info', value: 'info' }))
      .addStringOption(o => o.setName('species').setDescription('Which critter to adopt')
        .addChoices(...PET_SPECIES.map(p => ({ name: `${p.emoji} ${p.name}`, value: p.id }))))
      .addStringOption(o => o.setName('name').setDescription('Your pet\'s name').setMaxLength(20))
      .addStringOption(o => o.setName('habitat').setDescription('Habitat strip theme')
        .addChoices(...HABITAT_THEMES.map(h => ({ name: h.name, value: h.id })))))
    .addSubcommand(s => s.setName('wall').setDescription('Your guestbook wall - list notes, or remove one (owner or mod)')
      .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true)
        .addChoices({ name: 'List notes', value: 'list' }, { name: 'Remove a note', value: 'remove' }))
      .addIntegerOption(o => o.setName('note').setDescription('Note number to remove'))),
  new SlashCommandBuilder().setName('moodpick').setDescription('Pick your swamp mood - sets your card aura and your pet\'s mood')
    .addStringOption(o => o.setName('mood').setDescription('Your mood').setRequired(true)
      .addChoices(...MOODS.map(m => ({ name: `${m.name} - ${m.blurb}`, value: m.id })), { name: 'Clear my mood', value: 'clear' })),
  new SlashCommandBuilder().setName('rank').setDescription('Same card as /profile view - your level, XP and title')
    .addUserOption(o => o.setName('member').setDescription('Whose rank (default: you)')),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 members of THE SWAMP by XP'),
  new SlashCommandBuilder().setName('bonus').setDescription('Show a member\'s current XP bonus breakdown')
    .addUserOption(o => o.setName('member').setDescription('Whose bonuses (default: you)')),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily XP + Swamp Bucks and build your streak'),
  new SlashCommandBuilder().setName('link').setDescription('Link your Discord to your Swampology profile so your Swamp Bucks match on both'),
  new SlashCommandBuilder().setName('prize').setDescription('See prize keys waiting for you - the reply shows only to you'),
  new SlashCommandBuilder().setName('quest').setDescription('Daily quest of THE SWAMP')
    .addSubcommand(s => s.setName('show').setDescription('Show today\'s quest and your progress'))
    .addSubcommand(s => s.setName('claim').setDescription('Claim today\'s quest reward when finished')),
  new SlashCommandBuilder().setName('faction').setDescription('The three banners of THE SWAMP - join one, see the war standings')
    .addSubcommand(s => s.setName('join').setDescription('Join a faction (first join free; switching costs 50 Bucks, 7-day cooldown)')
      .addStringOption(o => o.setName('faction').setDescription('Your banner').setRequired(true)
        .addChoices(...FACTIONS.map(f => ({ name: f.name, value: f.id })))))
    .addSubcommand(s => s.setName('standings').setDescription('This week\'s faction XP pools + all-time'))
    .addSubcommand(s => s.setName('info').setDescription('The three factions, and which banner you fly')),
  new SlashCommandBuilder().setName('inventory').setDescription('Show a member\'s loot bag')
    .addUserOption(o => o.setName('member').setDescription('Whose bag (default: you)')),
  new SlashCommandBuilder().setName('raid').setDescription('Spend a Raid Pass from your inventory to summon a server-wide event here'),
  new SlashCommandBuilder().setName('title').setDescription('Your cosmetic titles - generated at Level 5, unlocked by deeds')
    .addSubcommand(s => s.setName('show').setDescription('Your active title, generated title and the achievement list'))
    .addSubcommand(s => s.setName('set').setDescription('Switch your active cosmetic title to one you own')
      .addStringOption(o => o.setName('title').setDescription('Exact title name from /title show').setRequired(true)))
    .addSubcommand(s => s.setName('generate').setDescription('Re-roll your generated title (once per level, Level 5+)')),
  new SlashCommandBuilder().setName('sidequest').setDescription('Side quests composed on the fly by the King\'s quest generator')
    .addSubcommand(s => s.setName('get').setDescription('Get a fresh generated side quest (one at a time)'))
    .addSubcommand(s => s.setName('show').setDescription('Your active side quest and progress'))
    .addSubcommand(s => s.setName('claim').setDescription('Claim a finished side quest: XP, Bucks, Rep, maybe loot'))
    .addSubcommand(s => s.setName('drop').setDescription('Drop your active side quest, no penalty')),
  new SlashCommandBuilder().setName('store').setDescription('The King\'s Little Store - spend Swamp Bucks, sell loot back (virtual goods only)')
    .addSubcommand(s => s.setName('open').setDescription('Open your personal storefront: paged board, buttons, your balance'))
    .addSubcommand(s => s.setName('post').setDescription('Mods: post the persistent storefront board in this channel (then pin it)'))
    .addSubcommand(s => s.setName('show').setDescription('The shop board: shelf, prices, decorations, sell-back prices, your balance'))
    .addSubcommand(s => s.setName('buy').setDescription('Buy one item from the shelf with Swamp Bucks')
      .addStringOption(o => o.setName('item').setDescription('What you are buying').setRequired(true)
        .addChoices(...SHOP_ITEMS.map(i => ({ name: `${i.name} - ${i.price} Bucks`, value: i.id })))))
    .addSubcommand(s => s.setName('sell').setDescription('Sell one loot item back to the King for Swamp Bucks')
      .addStringOption(o => o.setName('item').setDescription('Loot you are selling').setRequired(true)
        .addChoices(...SELLABLE.map(n => ({ name: `${n} - sells for ${SELL_PRICES[n]} Bucks`, value: n }))))),
  new SlashCommandBuilder().setName('avatarframe').setDescription('Your avatar frame wardrobe - bought in /store, worn on your picture')
    .addSubcommand(s => s.setName('list').setDescription('Frames you own, frames you do not, and how wearing one works'))
    .addSubcommand(s => s.setName('apply').setDescription('Build your current Discord avatar inside an owned frame and get the PNG (free, forever)')
      .addStringOption(o => o.setName('frame').setDescription('Frame to wear').setRequired(true)
        .addChoices(...FRAMES.map(f => ({ name: f.name, value: f.id }))))),
  new SlashCommandBuilder().setName('trivia').setDescription('Swamp trivia - answer right in chat, earn XP (costs 1 action point)'),
  new SlashCommandBuilder().setName('gator').setDescription('Gator Ate My Answer - guess the word the gator swallowed (costs 1 action point)'),
  // NOTE: no builder-level admin gate on /event - start/stop check Administrator
  // in the handler (as they always did), because /event lure is a MEMBER action.
  new SlashCommandBuilder().setName('event').setDescription('Swamp events (2x XP while live) - start/stop are admin, lure is for lure holders')
    .addSubcommand(s => s.setName('start').setDescription('Admin: spawn a chest/boss event in this channel')
      .addStringOption(o => o.setName('kind').setDescription('Event kind, e.g. swamp boss, treasure chest')))
    .addSubcommand(s => s.setName('stop').setDescription('Admin: end the live event in this channel'))
    .addSubcommand(s => s.setName('lure').setDescription('Spend an Event Lure (from /store) to call a random event into this channel')),
  admin(new SlashCommandBuilder().setName('sponsorquest').setDescription('Admin: Sponsored quests - always labelled Sponsored')
    .addSubcommand(s => s.setName('create').setDescription('Create and announce a Sponsored quest')
      .addStringOption(o => o.setName('title').setDescription('Quest title').setRequired(true))
      .addStringOption(o => o.setName('sponsor').setDescription('Sponsor name').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('What members do'))
      .addIntegerOption(o => o.setName('rewardxp').setDescription('Reward XP (default 100)'))
      .addIntegerOption(o => o.setName('rewardbucks').setDescription('Reward Swamp Bucks (default 25)'))
      .addStringOption(o => o.setName('role_id').setDescription('Optional Discord role ID granted to winners')))
    .addSubcommand(s => s.setName('addkey').setDescription('Store a sponsor prize key (never printed; the winner claims it with /prize)')
      .addStringOption(o => o.setName('key').setDescription('The prize key / code').setRequired(true)))
    .addSubcommand(s => s.setName('complete').setDescription('Award a member: XP, Bucks, Rep, winner role + prize key held for /prize if set')
      .addUserOption(o => o.setName('member').setDescription('Member to award').setRequired(true)))
    .addSubcommand(s => s.setName('report').setDescription('Monthly sponsor report - counts only, no private info'))),
  new SlashCommandBuilder().setName('unverified').setDescription('Mods: list unverified members and how long they have waited'),
  admin(new SlashCommandBuilder().setName('givexp').setDescription('Admin: give a member XP (multiplier applies)')
    .addUserOption(o => o.setName('member').setDescription('Member to award').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Base XP amount').setRequired(true))),
  admin(new SlashCommandBuilder().setName('giveitem').setDescription('Admin: grant a loot item (including Raid Pass) to a member')
    .addUserOption(o => o.setName('member').setDescription('Member to grant').setRequired(true))
    .addStringOption(o => o.setName('item').setDescription('Loot item').setRequired(true)
      .addChoices(...LOOT_TABLE.map(i => ({ name: i.name, value: i.name }))))
    .addIntegerOption(o => o.setName('count').setDescription('How many (default 1)'))),
  admin(new SlashCommandBuilder().setName('givepass').setDescription('Admin: grant or extend a timed VIP Pass (x1.5 XP, +1 loot roll, 8 action points/day)')
    .addUserOption(o => o.setName('member').setDescription('Member to grant').setRequired(true))
    .addIntegerOption(o => o.setName('days').setDescription('Pass length in days (default 30)'))),
  admin(new SlashCommandBuilder().setName('hostsay').setDescription('Admin: Crocodile King posts a message in character')
    .addStringOption(o => o.setName('message').setDescription('What he says').setRequired(true))),
  admin(new SlashCommandBuilder().setName('welcomepost').setDescription('Admin: Crocodile King posts the big welcome message in the welcome channel and pins it')),
  ].map(c => c.toJSON());
}

/** The current command set, built once - the same JSON the CLI registers
 *  and the bot auto-registers on boot (src/index.js). */
const commands = buildCommands();

async function main() {
  if (!config.token || !config.clientId || !config.guildId) {
    console.error('Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID in .env - cannot register commands.');
    process.exit(1);
  }
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = buildCommands();
  console.log(`Registering ${body.length} commands to guild ${config.guildId}...`);
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  console.log('Done. Commands:', body.map(c => '/' + c.name).join(', '));
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { commands, buildCommands };
