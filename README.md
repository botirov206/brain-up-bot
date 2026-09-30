# Brain-Up bot

Daily routine bot for the Brain-Up forum. It is not a chatbot, and it has no web dashboard.

Forum membership is what allows participation. The bot posts a morning "Uyg'ondim" button, gives each eligible person their own topic, accepts voice, audio, video, round-video, video-file, and YouTube replies, and posts an evening recap. Members publish a daily to-do list; checking tasks and writing an end-of-day note are optional and never create a penalty. The behavioral contract and rollout notes are in `HANDOFF.md`.

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
- `npm test` — compile and run `test/*.test.mjs` with fake Telegram and database values. An isolated migration check runs only when `TEST_DATABASE_URL` points at a non-production database.

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

1. Add the bot to the forum supergroup and make it an administrator that can post, delete messages, and restrict members.
2. An admin sends `/group` inside that forum, or `/group -100…` in private. The saved connection is then the only group the bot uses.
3. Inside each destination topic, an admin sends `/bindtopic daily`, `/bindtopic unusual`, `/bindtopic reminders`, or `/bindtopic exercises`. The bot stores that update’s `message_thread_id`. Nothing is posted to General when a topic is missing.
4. Each member opens the bot once if they want private copies. Participation still requires a current forum membership check.

Privacy mode can stay on. Check-ins use a dated `https://t.me/<bot>?start=wake_YYYYMMDD` link. A legacy `start=wake` link is rejected. Tracked morning posts are removed at noon, on restart after noon, or before the next morning post. Rows whose original chat is unknown are left in place.

## Admin commands

English admin help with emoji labels. Member-facing text is Uzbek Latin.

The admin keyboard includes Check-ins, Today's progress, 7-day view, Topics, Schedule Settings, Feedback, Users, and Accountability, plus the member plan and topic buttons. `/members` opens Users. Check-ins stays a separate list. Users shows people the bot has verified, not a complete Telegram roster, and the live waitlist count sits under that list.

- `/settings` — times, grace period, topic schedule, bindings, and delivery problems. `/settings wake 05:30`, `/settings plan 09:00`, `/settings response 20:00`, `/settings grace 60`, `/settings topics on`.
- `/topics` — five previews per page. `/topics add <text>` or `/topicadd <text>` still add a prompt.
- `/report` — post today's totals into the daily topic. The scheduled recap does not post twice; a manual `/report` is a separate action.
- `/bindtopic daily|unusual|reminders|exercises` — run inside the topic to bind.
- `/group` — connect a forum supergroup. Switching groups clears the four topic bindings.
- `/feedback` — a member suggestion. Group feedback is accepted only in the connected forum.

## Notes

- Configured `ADMIN_TELEGRAM_IDS` are the only administrators. A stored role does not grant admin access. Participant actions still require forum membership.
- Each eligible person gets one saved topic per day. Later runs reuse it. A person who joins after distribution starts receives that day’s assignment and is not penalized for deadlines that already passed.
- A published plan satisfies the daily-plan requirement. Unchecked tasks do not open accountability cases.
- Install and deploy with npm and `package-lock.json`.
