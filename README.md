# Brain-Up bot

Daily routine bot for the Telegram group Brain-Up Поток-1. It is not a chatbot.

Each day it posts a morning "Uyg'ondim" button in the group, DMs one shared topic to people who have pressed Start, posts their voice or round-video reply back to the group, and posts a short evening recap. No rankings and no web dashboard.

## Setup

```bash
cd brain-up-bot
cp example.env .env
# fill in .env — example.env explains every variable and where to get it
npm install
npm run dev
```

`.env.example` is the same keys without the long comments. `.env` is gitignored. Do not put real tokens in either example file.

`npm run dev` applies SQL migrations, then long-polls Telegram. Do not set a webhook.

## Scripts

- `npm run dev` — run TypeScript with tsx
- `npm run build` — compile to `dist/`
- `npm start` — `node dist/index.js` (run `npm run build` first)
- `npm run migrate` — apply migrations and exit
- `npm run typecheck` — `tsc --noEmit`

Startup also migrates, so a separate migrate step is optional.

## Env

See `example.env` for the click-path of each value.

| Variable | Required | Purpose |
| --- | --- | --- |
| `BOT_TOKEN` | yes | BotFather token |
| `DATABASE_URL` | yes | Neon Postgres connection string (pooled) |
| `GROUP_CHAT_ID` | yes | Numeric group id, usually `-100...` |
| `ADMIN_TELEGRAM_IDS` | no | Comma-separated numeric admin user ids |
| `BOT_USERNAME` | yes | Bot username without `@` (the wake button link) |
| `TIMEZONE` | no | Default `Asia/Tashkent` |

The process exits if `BOT_TOKEN`, `DATABASE_URL`, `GROUP_CHAT_ID`, or `BOT_USERNAME` is missing.

## Group setup

1. Add the bot to Brain-Up Поток-1 and make it an admin so it can post.
2. Each member opens the bot once (`/start`, or the morning button). Telegram only allows the bot to DM people who have started it.
3. Admins fill the topic bank: `/topics add your prompt` (the rest of the message can be multi-line).

Privacy mode can stay on. Check-ins happen in private via `https://t.me/<bot>?start=wake`, and replies are sent to the bot in private.

## Admin commands

English help. Member-facing text is Uzbek Latin.

- `/settings` — show times. `/settings wake 05:30`, `/settings topic 08:00`, `/settings report 21:30`
- `/topics` — list recent topics. `/topics add <text>` or `/topicadd <text>`
- `/report` — post today's recap now
- `/members` — started / not started, today's wake-ups, today's replies

## Notes

- The `N / M` counts use members who have pressed Start, not a fixed group size. The bot cannot list every group member.
- One shared topic per day (the bank is marked `last_used_on`). It is stored on each person's day row.
- Round videos cannot carry a caption in Telegram. The group gets a text line, then the video note. Voice and audio use a caption.
- Cron runs on the minute in `Asia/Tashkent`. If the process is down at that minute, that run is skipped (no catch-up).
- Someone who presses Start after the topic job does not get today's topic.
