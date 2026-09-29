# Brain-Up bot

Daily routine bot for the Telegram group Brain-Up Поток-1. It is not a chatbot.

Each day it posts a morning "Uyg'ondim" button in the group, DMs one shared topic to people who have pressed Start, posts their voice or round-video reply back to the group, and posts a short evening recap. No rankings and no web dashboard. The bot deletes the morning post at 12:00 in the configured timezone; if Telegram no longer allows deletion, it removes the button. Each button is dated, so an old link cannot record today's check-in.

## Setup

```bash
cd brain-up-bot
cp example.env .env
# fill in .env — example.env explains every variable and where to get it
npm install
npm run dev
```

`.env.example` is the same keys without the long comments. `.env` is gitignored. Do not put real tokens in either example file.

`npm run dev` applies SQL migrations, then long-polls Telegram. It restarts when a source file changes. Do not set a webhook.

## Scripts

- `npm run dev` — run TypeScript with tsx and restart when files change
- `npm run build` — compile to `dist/`
- `npm start` — `node dist/index.js` (run `npm run build` first)
- `npm run migrate` — apply migrations and exit
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — build and run the dated-link, admin menu, schedule, group, report, cleanup, topic, and feedback checks with fake Telegram and database responses

Startup also migrates, so a separate migrate step is optional.

## Env

See `example.env` for the click-path of each value.

| Variable | Required | Purpose |
| --- | --- | --- |
| `BOT_TOKEN` | yes | BotFather token |
| `DATABASE_URL` | yes | Neon Postgres connection string (pooled) |
| `GROUP_CHAT_ID` | no | Optional numeric group id. Prefer `/group` in the bot |
| `ADMIN_TELEGRAM_IDS` | no | Comma-separated numeric admin user ids |
| `BOT_USERNAME` | yes | Bot username without `@` (the wake button link) |
| `TIMEZONE` | no | Default `Asia/Tashkent` |

The process exits if `BOT_TOKEN`, `DATABASE_URL`, or `BOT_USERNAME` is missing. It starts without a group. Morning posts, replies, and the recap wait until an admin sets one.

## Group setup

1. Add the bot to Brain-Up Поток-1 and make it an admin so it can post.
2. An admin opens the bot and sends `/group -100…` (the id from @userinfobot), or sends `/group` inside the group.
3. Each member opens the bot once (`/start`, or the morning button). Telegram only allows the bot to DM people who have started it.
4. Admins fill the topic bank: `/topics add your prompt` (the rest of the message can be multi-line).

Privacy mode can stay on. Check-ins happen in private via a dated `https://t.me/<bot>?start=wake_YYYYMMDD` link, and replies are sent to the bot in private. A legacy `start=wake` link is rejected. The bot removes tracked morning posts at noon, on restart after noon, or before the next morning post. Posts created before this change have no saved message ID and must be removed manually by a group admin; their links are still rejected.

## Admin commands

English admin help with emoji labels. Member-facing text is Uzbek Latin.

In a private chat, an admin gets six buttons: Check-ins, Today's progress, 7-day view, Topics, Schedule Settings, and Feedback. Check-ins lists wake times and people who have not checked in. Today's progress combines wake activity, topic delivery, replies, and explanations. 7-day view summarizes the last week. Schedule Settings also shows the connected group and how to change it.

The bot cannot list a forum group. It knows people who have pressed Start or sent `/feedback` in the group. Daily check-in counts and topic DMs include only people who opened the bot privately. At `explain` time it mentions those who missed or were late and asks why. Only members who opened the bot can submit an explanation by replying in the group. Check-in after `on time` also needs an explanation. Both clocks are `/settings ontime 06:00` and `/settings explain 08:00`.

Members send a suggestion with Taklif, `/feedback`, or `/feedback your text` in the group. A reply to the group's ask is saved as their explanation.

- `/settings` — show times and group setup. Change them with `/settings wake 05:30`, `/settings topic 08:00`, or `/settings report 21:30`. The morning button must arrive before the on-time deadline and before noon; the explanation request runs after that deadline, and the report runs after the topic.
- `/topics` — list recent topics. `/topics add <text>` or `/topicadd <text>`
- `/report` — post today's totals to the group immediately. The bot also posts them at the scheduled report time. Today's progress shows the current detail before you choose to post.
- `/members` — same list as Check-ins: check-in time, late labels, and tappable names, followed by people who have not checked in.
- `/feedback` — prompts a member for one suggestion. `/feedback your text` submits it immediately, including in a private chat. Admins read suggestions with Member feedback.
- `/group` — show the group id. `/group -100…` saves it after checking the bot is an admin there. `/group` inside the group uses that chat.

Admin reports and settings open in the private chat. Only `/group` is handled in the group itself, for connecting that group.

## Notes

- The wake `N / M` count uses members who pressed Start. Topic replies use members who received today's topic. The bot cannot list every group member.
- One shared topic per day (the bank is marked `last_used_on`). It is stored on each person's day row.
- Round videos cannot carry a caption in Telegram. The group gets a text line, then the video note. Voice and audio use a caption.
- Cron runs on the minute in `Asia/Tashkent`. If the process is down at that minute, that run is skipped. Morning-post cleanup catches up on restart; other jobs do not.
- Someone who presses Start after the topic job does not get today's topic.
