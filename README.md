# Crocodile King - Host Bot for THE SWAMP

The Crocodile King is not a chat-with-an-AI bot. He is the **host, referee and engine** of THE SWAMP Discord server: he greets new members, chases verification in a funny, straightforward swamp voice, runs daily quests, trivia, events and Sponsored quests, and keeps the XP books - with XP bonuses.

Built with Node.js + discord.js v14, same family as Swamp Tunes. No Firebase, no Supabase, no external database - all data lives in a local JSON store (`data/store.json`, atomic writes).

## What he does

**Welcome + verification**
- New member joins -> recorded as unverified, welcomed by name in the welcome channel, told exactly where to verify in one step.
- Still unverified at **30 minutes** -> Crocodile King reminds *them* in the welcome channel (3 rotating lines).
- Still unverified at **2 hours** -> private nudge to the **mod channel only**, pinging the mod role. Never public shame.
- Still unverified at **24 hours** -> one more private mod re-nudge, then he stops.
- The moment the Verified role appears (checked on member update and every sweep), reminders stop, and the member gets a Welcome Pack: +50 XP, +25 Swamp Bucks and **1 Raid Pass** (see Raid Passes below).

**XP with XP BONUSES (the core system)**
- Base XP: 10 XP per message (60-second per-user cooldown, anti-spam), 2 XP per minute in voice, plus quest / daily / trivia / event / admin awards.
- Bonuses stack multiplicatively, total **capped at x3**:
  - Verified member x1.25
  - Server Booster x2 (boost status or booster role)
  - Swamp Royalty Pass role x1.5
  - New member, first 7 days x1.5
  - Daily streak of 7+ days x1.2
  - Weekend (Sat/Sun, America/Halifax) x2
  - Night Owl (00:00-04:00, America/Halifax) x1.25
  - Event / sponsor bonus live in the channel x2
- `/profile` and `/bonus` show the live breakdown, so members can *see* why verifying and boosting pay.
- Level curve: XP to advance from level L = `floor(100 * L^1.5)` (L1->2: 100, L2->3: 282, L10->11: 3162). Level-ups are announced and pay **10 x new level Swamp Bucks**.
- Level role ladder (names in config; role IDs optional - wire them in `/setup panel`, or seed via `LEVEL_ROLE_IDS` env; bot never crashes if unset):
  Level 1 Tadpole · 5 Swamp Sprout · 10 Mud Runner · 20 Gator Friend · 35 Cypress Guard · 50 Murk Royalty

**Factions + reputation (v2)**
- Three factions: **King's Court**, **Cypress Clan**, **Glowshroom Circle**. `/faction join` picks a banner (first join free). Switching costs **50 Swamp Bucks** with a **7-day cooldown** and clears nothing - XP, Rep, loot and titles all stay with the member.
- The King is the faction referee: every XP award also feeds the member's faction pool with the award's **raw base XP (pre-multiplier)**, counted per ISO week and all-time. `/faction standings` shows the war table with the King's commentary on whoever leads.
- Faction Discord roles are optional: wire them in `/setup panel` (or seed `FACTION_ROLE_IDS` env) and join/switch swaps them best-effort. Unset, factions work fine without roles.
- **Reputation (Rep)** is its own stat, shown in `/profile` with a rank name: 0 Unknown · 10 Known in the Murk · 30 Swamp Trusted · 75 King's Favourite · 150 Legend of THE SWAMP. Rep pays for deeds, not chatter: daily quest claim +5, generated side quest +3, event participation +2, sponsor quest completion +4, right trivia answer +1, every 7-day streak milestone +5.

**Loot + inventory (v2)**
- Loot table (weights out of 100): Glowshroom 30, Firefly Jar 22, Gator Tooth 20, Cypress Charm 14, Swamp Pearl 8, **Raid Pass 4**, **Golden Glowshroom 2** (rare).
- Rolls happen on: `/daily` (1 roll), every level-up (1 roll per level), and event participation (1 roll when the event falls). **Royalty role / timed VIP Pass holders get +1 extra roll wherever a roll happens.**
- `/inventory` shows the bag with a use hint per item. `/profile` shows an item-count summary.

**Raid Passes (v2)**
- The **Raid Pass** is a loot item in your inventory. `/raid` spends one to trigger a server-wide event in the current channel, reusing the normal event engine (2x channel XP bonus, boss/chest participation, Rep and loot on the kill). Per-channel cooldown: 30 minutes.
- Passes come from loot rolls (daily, level-ups, events), sponsor quests, admin `/giveitem`, and the Welcome Pack (1 on first verify). No pass, no raid - the King tells you exactly that, and where they come from.

**Cosmetic titles (v2)**
- At **Level 5** the bot mints your personal **generated title** (an adjective x swamp-noun combo, e.g. "Murk-Blessed Gator Whisperer", derived deterministically from your user ID).
- **Achievement titles** unlock by deed: first daily quest, first event, first sponsor quest, 7-day streak, joining a faction - each with its own name.
- `/title show` lists what you own and what is locked, `/title set` switches the active cosmetic title, `/title generate` re-rolls the generated title **once per level**.
- Titles are bot-side display only: they show beside your level-ladder title in `/profile` and on `/leaderboard` (both titles shown, labelled). Nicknames are never edited.

**Timed VIP Pass + action points (v2)**
- `/givepass member [days]` (admin, default 30 days) sets or extends a **timed VIP Pass** (`passUntil` on the member's record). Extending a live pass adds to its remaining time.
- An active pass counts **exactly like the Swamp Royalty Pass role** for XP: the same x1.5 line, labelled as the pass in `/bonus`. Role and pass never stack with each other. It also grants the +1 loot roll.
- **Daily action points** (this is a behaviour change, on purpose): every member gets **5 action points per Halifax day**; Royalty role / active pass holders get **8**. `/trivia` and `/gator` now **cost 1 action point each to play** (they were free and unlimited in v1). `/daily`, `/quest`, `/sidequest`, messages and voice cost none. Out of points, the King tells you they refill tomorrow and that pass holders get more.

**Daily + quests + events**
- `/daily` - once per Halifax calendar day: XP + 20 Swamp Bucks, builds your streak.
- **Quest of the day** - deterministic rotation (same quest for everyone that day): chat messages, voice minutes, reactions, a Swamp Art post, or a right trivia answer. Announced each morning if a quest channel is set. `/quest show`, `/quest claim` (claim applies your bonus multiplier).
- `/trivia` - swamp/gator trivia bank; answer by typing in the channel within 2 minutes. Costs 1 action point (see VIP Pass + action points above); a right answer also pays +1 Rep.
- `/gator` - **Gator Ate My Answer**: guess the word the gator swallowed from its clue and shape. Costs 1 action point.
- **Generated side quests** - `/sidequest get` composes a personal side quest **on the fly** from parts: an activity type the bot already tracks (messages, voice minutes, reactions, art posts, trivia correct), a swamp theme line, a target scaled to your level, and rewards scaled to the target. Progress rides the same counters as the daily quest. `/sidequest show`, `/sidequest claim` (+3 Rep, 25% chance of bonus loot), `/sidequest drop`. One active at a time. This is the **King's quest generator - procedural, from the bot's own tables. No LLM, no AI API, no API key, no cost.**
- **Events** - `/event start` (admin) spawns a chest/boss in the channel: react 🐊 to hit it, 10 hits bring it down, every participant gets XP + 30 Swamp Bucks, and the channel carries a 2x XP bonus while it lives. `/event stop` ends it. Auto-events every ~30 min if `AUTO_EVENTS=true` (default off).

**Booster Pack (v2)**
- Server boosters already get the **x2 XP bonus** in this bot, and - separately, off-bot - the 4 secret Swampology.com profile backgrounds for boosting THE SWAMP. The Booster Pack is the **in-bot** booster reward, on top of both.
- **Once per calendar month (America/Halifax)** for as long as they keep boosting, every booster automatically gets a pack: **+100 Swamp Bucks, +1 Raid Pass, 2 loot rolls, +5 Rep**, plus a one-time cosmetic title unlock: **"Swamp Booster"**.
- Detection is automatic two ways: on member update (`premiumSince` set/changing, or the booster role appearing) and in the scheduler sweep. The gate is `lastBoostPackMonth` (YYYY-MM) on the member's record, so a pack can never double-pay inside a month. If a boost lapses and returns in a later month, it pays again then.
- Each pack is announced in the announce/quest channel in the King's voice, The bot never DMs anyone (owner rule, server only): packs are announced in the server and show on /profile.
- `/profile` shows a booster a "Booster Pack: claimed for November" style status line for the current month.

**The King's Little Store (v2.1) - Swamp Bucks only, virtual goods only**
- Swamp Bucks finally have somewhere to go. **No real money anywhere**: Swamp Bucks cannot be bought with money, nothing in the store has any cash value, and selling loot back pays Swamp Bucks only. Every purchase/sale is a single validated transaction in `src/shop.js` - a refused sale never charges and never half-grants.
- **The storefront**: a mod runs `/store post` in the server's main Crocodile King channel and **pins the message** - it is the persistent shop door. Members open their own copy anywhere with `/store open`. Four paged boards - **Avatar Decorations / Boosts & Passes / Loot & Sell-back / Swamp Specials** - with Prev/Next buttons and a select menu per page; picking an item shows that member their balance and a Buy (or Sell) button, privately. All results are ephemeral to the buyer (one tasteful public flex line, for frame purchases only).
- **Restart-proof by design**: every button/select is routed by a *stateless customId* (`sf:nav:<page>`, `sf:pick:<page>`, `sf:buy:<itemId>`, `sf:sell:<loot>`) handled centrally in `interactionCreate`. **No message collectors, nothing stored on the message** - a storefront posted last month still works after any restart. `/store show` (text board), `/store buy` and `/store sell` reach the exact same shop.js path.
- **The shelf**: Raid Pass 150 · Murk Mystery Loot 75 (one loot-table roll, revealed on purchase) · Title Shuffle 50 (an extra generated-title roll beyond the free once-per-level one - it does not consume it) · Firefly Tonic 40 (refills today's action points to full - the cap respects pass holders' 8 vs base 5; max 1 per day, and the King refuses to sell one to a member already full) · Fresh Scroll 30 (drops the current side quest, no penalty) · King's XP Feast 200 (**+100 XP flat** - granted through the normal pipeline with a x1 multiplier object; bonuses never multiply a purchase) · 1-Day Swamp Pass 500 (24h of timed-pass perks; **refused if pass benefits are already running** - role or timed - because the x1.5 never stacks with itself) · Golden Glowshroom 1000.
- **Sell-back** (loot only, one at a time): Glowshroom 20 · Gator Tooth 35 · Swamp Pearl 60 · Cypress Charm 45 · Firefly Jar 55 · Golden Glowshroom 400. Raid Passes are never bought back.
- **Avatar Decorations - frames**: Cypress Vine Frame 200 · Glowshroom Ring 250 · Gator Tooth Ring 300 · Crocodile King Crown Frame 750 · Murk Royalty Frame 1500. Ring artwork lives in `assets/frames/`. **The honest mechanics**: Discord does not let any bot grant Discord's own avatar decorations or change a member's profile. So buying a frame puts it in the member's **wardrobe** (their record) and decorates their in-bot `/profile` card; `/avatarframe list` shows the wardrobe, and `/avatarframe apply` composites the member's *current* Discord avatar into the frame (jimp, pure JS) and hands them a finished **1024x1024 PNG** to upload as their own Discord avatar - which is what makes it actually show. Frames are permanent, applying is free and repeatable forever, and a failed composite never charges (frames are charged at buy time, never at apply).
- **Profile Backgrounds**: Neon Bayou 350 · Murk Hollow 350 · King's Throne Room 500 (art in `assets/backgrounds/`, downscaled from the server banner pack). Permanent like frames; buying **auto-equips** - the newest owned background is the one worn - and it shows as the image on the member's `/profile` card, alongside their equipped frame. Simple on purpose.
- **Swamp Specials (consumables, held as counts on the record)**: **Streak Shield** 180 (max own 2) - auto-consumed to save the daily streak the first time a member would miss a day; the shield cracks, the streak survives and still grows that day; **Double-Down Token** 120 (max own 3) - the next `/quest claim` or `/sidequest claim` pays **double Swamp Bucks** (not XP, not loot), auto-consumed on that claim; **Event Lure** 250 - spent with **`/event lure`**, calls a random event into the channel, respecting the same 30-minute per-channel cooldown as `/raid` (on cooldown it refuses and does **not** consume the lure). Because lure is a member action, `/event` no longer carries a builder-level admin gate - `/event start` and `/event stop` still check Administrator in the handler, as they always did.

**Sponsor quests**
- `/sponsorquest create` (admin): title, sponsor, description, reward XP/Bucks, plus an optional **role_id** - a Discord role granted to winners. The announcement is **always labelled "Sponsored"** - house rule, not optional.
- While a sponsor quest is active, the 2x XP channel bonus is on.
- `/sponsorquest addkey` (admin): stores a sponsor-provided **digital prize key** in the active quest's key pool. Keys are **never printed in any channel output or report** - they exist only in the data file until the winner views them with /prize.
- `/sponsorquest complete` (admin, picks the member) awards a participant: XP, Bucks, **+4 Rep**, the configured winner role (best-effort), the "first sponsor quest" cosmetic title, and the next unused key, held on the winner's record to view with /prize (an ephemeral reply only they see). Keys are never DM'd and never posted in a channel.
- `/sponsorquest report` (admin): monthly counts - quests run and number of participant awards. Counts only. **No member private info, no keys, no role internals are stored in the report or shown, ever** (awards log only a user ID + timestamp + grant flags inside your own data file).

## Final command list (exactly what the code registers)

```
/setup panel                 ADMIN - dropdown panel: pick the server's existing roles + channels (saves instantly)
/setup show                  ADMIN - the whole wiring at a glance + what is still missing
/setup create                ADMIN - King builds ONLY the missing roles/channels (defaults + right permissions)
/setup reset                 ADMIN - clear the stored wiring back to the env seed (books NOT touched)
/profile [member]            level, XP, Bucks, streak, Rep, faction, titles, bonuses
/rank [member]               same book as /profile
/leaderboard                 top 10 by XP (ladder title + cosmetic title shown)
/bonus [member]              current XP bonus breakdown (pass source labelled)
/daily                       daily XP + Bucks, streak, 1 loot roll
/quest show                  today's quest + your progress
/quest claim                 claim today's quest reward (+5 Rep)
/faction join <faction>      join King's Court / Cypress Clan / Glowshroom Circle
/faction standings           this week's faction XP pools + all-time
/faction info                the three banners, and yours
/inventory [member]          loot bag with use hints
/raid                        spend a Raid Pass: summon a server-wide event here
/title show                  your cosmetic titles: owned, locked, active
/title set <title>           switch your active cosmetic title
/title generate              re-roll your generated title (Level 5+, once per level)
/sidequest get               get a generated side quest (King's quest generator)
/sidequest show              your active side quest + progress
/sidequest claim             claim a finished side quest (+3 Rep, loot chance)
/sidequest drop              drop your side quest, no penalty
/store open                  your personal storefront (paged, buttons, your balance)
/store post                  MOD - post the persistent storefront board here (then pin it)
/store show                  text shop board + your balance
/store buy <item>            buy from the shelf with Swamp Bucks
/store sell <item>           sell one loot item back for Swamp Bucks
/avatarframe list            your frame wardrobe + how wearing one works
/avatarframe apply <frame>   get your avatar composited into an owned frame (PNG, free)
/trivia                      swamp trivia for XP (costs 1 action point)
/gator                       Gator Ate My Answer word game (costs 1 action point)
/event start [kind]          ADMIN - spawn an event in this channel
/event stop                  ADMIN - end this channel's event
/event lure                  spend an Event Lure: random event in this channel
/sponsorquest create ...     ADMIN - create a Sponsored quest (always labelled Sponsored)
/sponsorquest addkey <key>   ADMIN - store a prize key for the active quest (never printed)
/sponsorquest complete member ADMIN - award: XP/Bucks/Rep + role + DM key
/sponsorquest report         ADMIN - monthly sponsor counts only
/unverified                  MOD - who is unverified and for how long
/givexp member amount        ADMIN - grant XP (multiplier applies)
/giveitem member item [count] ADMIN - grant a loot item (incl. Raid Pass)
/givepass member [days]      ADMIN - grant/extend a timed VIP Pass (default 30 days)
/hostsay message             ADMIN - Crocodile King posts in character
```

That is **24 top-level commands**: setup, profile, rank, leaderboard, bonus, daily, link, quest, faction, inventory, raid, title, sidequest, store, avatarframe, trivia, gator, event, sponsorquest, unverified, givexp, giveitem, givepass, hostsay.

## Run it locally

```bash
cp .env.example .env   # fill in your values
npm install
npm run deploy-commands   # optional locally - on boot he registers his 24 commands himself when GUILD_ID is set
npm start
npm test                  # full unit suite: XP, v2 systems, store, storefront
```

Health check: the bot serves HTTP on `PORT` (default 7860) - `GET /` or `/health` returns `{"ok":true,...}`. That is what Hugging Face Spaces pings.

Legal pages: the same HTTP server also serves the bot's **Terms of Service** at `GET /terms` and **Privacy Policy** at `GET /privacy` (HTML, from `src/legal.js`; the same texts are in `TERMS.md` and `PRIVACY.md` at the repo root). These are the URLs the Discord Developer Portal asks for.

## Developer Portal URL fields

On the app's General Information page in the Discord Developer Portal, set the four URL fields exactly like this:

- **Interactions Endpoint URL** = leave blank (Gateway bot; setting one breaks slash commands)
- **Linked Roles Verification URL** = leave blank (feature not used)
- **Terms of Service URL** = https://YOUR-SPACE-URL/terms
- **Privacy Policy URL** = https://YOUR-SPACE-URL/privacy

Replace YOUR-SPACE-URL with the Space's real address once it is created (for example `https://your-name-crocodile-king-host.hf.space`).

## Config

**Setup happens inside the server now (v2.2).** Once the King has joined and is live, an admin runs:

- **`/setup panel`** - dropdown menus listing the server's OWN roles and channels. Pick what each job points at (Verified role, Mod role - e.g. a role literally named "Server ✦ Mod" - welcome, get-verified, mod-chat, daily-quests, the main King channel, level-ups, Swamp Art, plus optional level/faction roles on their own pages). Every pick saves instantly to the bot's stored config and survives restarts. Nothing is renamed, nothing is copied by ID.
- **`/setup show`** - the wiring at a glance, plus what is still missing.
- **`/setup create`** - anything still missing, the King builds himself: Verified role (swamp green), Swamp Royalty Pass role (gold), and get-verified / mod-chat (private) / daily-quests / crocodile-king / level-ups channels with the agreed permission overwrites. Pieces that already exist - by configuration or by default name - are plugged in or skipped, **never** overwritten or renamed.
- **`/setup reset`** - wipe the stored wiring back to the env seed (member books are never touched).

Core commands (XP, /profile, /daily, /quest, /store...) work with **zero setup**; features whose channels/roles are unset just skip quietly. Verification reminders switch on once BOTH the Verified role and the mod-chat channel are wired.

Env is now only a **seed**: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` are required to log in and register commands. Any channel/role IDs also present in env (see `.env.example`) fill the stored config's still-blank fields at boot - in-server picks always win afterwards. The old copy-IDs-into-.env route still works as a fallback; it is just no longer the gate.

Privileged intents to turn ON in the Developer Portal (Bot tab): **Server Members** and **Message Content**.

Invite URL template (replace YOUR_CLIENT_ID):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2416004176&scope=bot%20applications.commands
```

Permissions 2416004176 = View Channel, Send Messages, Embed Links, Add Reactions, Read Message History, Manage Roles (hands out level roles; lets /setup create build roles), Manage Channels (lets /setup create build channels), Use Application Commands. (2416004176 is the old 2416004160 + the Manage Channels bit - v2.1's invite lacked Manage Channels, so /setup create could not have built channels with it.)

## Deploy

See **DEPLOY.md** for the step-by-step: Discord app creation, intents, invite, and free Hugging Face Spaces hosting with the token as a Secret.

## Files

```
src/index.js           the bot: welcome/verification, XP hooks, scheduler, booster packs, all commands, health server
src/xp.js              dependency-free XP multiplier (incl. timed pass flag) + level curve (unit-tested)
src/store.js           local JSON store, atomic writes
src/config.js          env config + level ladder + faction role map
src/lines.js           The Crocodile King's lines (3+ variants per stage)
src/content.js         quest rotation, trivia bank, Gator Ate My Answer bank
src/factions.js        dependency-free factions, weekly pools, reputation ranks (unit-tested)
src/loot.js            dependency-free loot table, inventory helpers, booster pack month gate (unit-tested)
src/titles.js          dependency-free cosmetic title generator + achievements (unit-tested)
src/questgen.js        the King's quest generator: procedural side quests (unit-tested)
src/shop.js            the store: shelf, sell-back, consumables, streak/double-down/cooldown hooks (unit-tested)
src/avatarframe.js     avatar frame wardrobe + jimp compositing into 1024x1024 PNGs (unit-tested)
src/backgrounds.js     profile card backgrounds: ownership + auto-equip (unit-tested)
src/storefront.js      the paged storefront boards + stateless customId routing (unit-tested)
src/setup.js           in-server setup: stored config shape, /setup panel builder, create planner (unit-tested)
assets/frames/         the 5 frame ring artworks (PNG, generated in the swamp style)
assets/backgrounds/    the 3 profile background artworks (downscaled banner art)
src/legal.js           Terms of Service + Privacy Policy HTML served at /terms and /privacy
src/deploy-commands.js slash command registration (24 commands)
TERMS.md / PRIVACY.md  the same legal texts in markdown, at the repo root
test/xp.test.js        node:test unit tests for multiplier + level curve
test/v2.test.js        node:test unit tests for v2 systems (pass, factions, loot, titles, questgen, booster gate)
test/shop.test.js      node:test unit tests for the store, frames, backgrounds, specials, compositing
test/storefront.test.js node:test unit tests for storefront ids, page coverage, component purchase path
test/setup.test.js     node:test unit tests for stored config, env-seed precedence, panel routing, create planner
data/store.json        created at runtime (your server's books - back it up to keep levels)
```
