# Brain-Up bot handoff

Baseline commit before this work: `ade040e33deb8072500247a7c110d25469a2e65b` (`new update`). The working tree was clean. Existing migrations were `001` through `005`. The topic bank is not seeded by those migrations and must not be reseeded.

Stack stays TypeScript, grammY, PostgreSQL, and node-cron. There is no web dashboard, Telegram Mini App, or second database. Install with npm. `package-lock.json` is the lockfile.

Tests use fake Telegram and database values. `TEST_DATABASE_URL` is optional and must point at an isolated database. The test harness does not read production credentials.

## Membership

`checkForumMembership` returns `member`, `non_member`, or `unavailable`. `member`, `administrator`, `creator`, and `restricted` with `is_member=true` can participate. `left`, `kicked`, and restricted non-members cannot. A timeout, missing bot rights, or an inaccessible group is unavailable: the action is refused and the person is not waitlisted.

An application block overrides membership. `ADMIN_TELEGRAM_IDS` is the only admin authority. Admins can open setup before the forum is connected. Their participant actions still require membership. Private Start records permission to contact and is separate from eligibility.

The bot subscribes to `message`, `callback_query`, `chat_member`, and `my_chat_member`. Known users are reconciled at startup and before the daily catch-up. Bots and anonymous `sender_chat` messages are ignored for personal accountability. Group submissions must come from the connected chat.

Verified non-members see:

> Hozirgi challenge davom etmoqda, bu oqimga qo‘shilish vaqti tugagan. Keyingi oqim haqida xabar olish uchun kutish ro‘yxatiga yozilishingiz mumkin.

Buttons: `Kutish ro‘yxatiga yozilish` and `A’zolikni qayta tekshirish`. Joining is explicit and does not duplicate an active row or change the original time. Withdrawal is allowed. Waitlisted people receive no assignments and are excluded from participant totals. Verified membership closes the active waitlist entry unless the person is blocked. Announcements are previewed, confirmed, and recorded per recipient. Notification does not remove anyone from the waitlist.

## Users and removal

`👥 Users` is on the admin keyboard. `/members` opens it. Check-ins stays separate. The list is built from verified users, Start, observed forum messages, and membership updates. The Bot API cannot return the full roster. Pages hold at most 10 people. `Waitlist (N)` uses the live count.

Remove persists the application block, then bans the person in the connected forum. Confirmation states that a supergroup ban can delete their message history. The bot, configured admins, and Telegram administrators or the owner cannot be removed. A ban failure stays visible and can be retried. Restore clears the block and unbans when Telegram allows it. It does not invent membership or re-add the person. Activity rows are kept.

## Forum routing

Proposed topic ids from old links are not hardcoded. An admin binds them with `/bindtopic daily|unusual|reminders|exercises` inside the topic. The chat must be a forum supergroup. Settings shows the bindings. Missing destinations are reported and are not posted into General. Tracked posts store chat, topic, and part index. Cleanup uses those stored destinations. Unknown historical origins are not deleted.

## Topics, plans, and responses

The bank shows five previews per page, newest first, with full text behind `View #ID`. Navigation edits the same message. `Send today’s topics` uses the same dispatcher as the schedule.

Each eligible person gets one saved random topic per forum day. Selection avoids that person’s previous seven prompts when another prompt exists, and prefers a prompt not yet used that day. Assignments are saved before sending. Forum and private delivery are independent. A newly admitted member receives today’s assignment if distribution has already started and is not penalized for earlier deadlines.

Accepted unusual-topic responses are voice, audio, round video, regular video, a document that is a video, or an HTTPS YouTube video, Shorts, or live link on `youtube.com`, `www.youtube.com`, `m.youtube.com`, or `youtu.be`. One accepted response is kept per person per day. Acceptance and publication are separate. A direct forum submission is not reposted.

A published daily plan is required. Checkbox completion and the end-of-day note are optional. Incomplete tasks do not create cases. Plans are parsed one task per line, previewed, and published in the daily topic. `/todo` in that topic and a reply while the bot is waiting for a list are the only ways a message becomes a plan. Checkbox actions send the desired state plus a revision. The database is updated before Telegram copies are edited.

## Schedule and judgments

Defaults for a fresh install, in `Asia/Tashkent`: morning button 05:00, on-time wake 06:00, topics 07:00, wake reason 08:00, plan deadline 09:00, response deadline 20:00, recap 21:00, grace 60 minutes. Existing saved times are kept. The recap may show checklist progress and does not penalize incomplete tasks.

Reminders go to the reminders topic. Cases open only for eligible members whose obligation was actually available. Late valid plan or topic submissions resolve the open requirement and keep the lateness. A wake explanation answers the reason request; the missed or late wake remains for an admin to excuse or judge. Judgments are published in the exercises topic. Evidence from the assigned member is stored and does not auto-complete the case.

Restart catch-up runs due jobs for the current local day. Wake recovery runs only before noon. Completed deliveries are not repeated. Sends that time out are marked uncertain.

## Schema

`migrations/006_challenge_flow.sql` adds forum memberships, waitlist, plans, tasks, accountability cases, judgments, announcements, and outbound deliveries. It extends users, days, day posts, and settings. Telegram ids stay `bigint` in PostgreSQL and strings in the application. Dates use the configured timezone, not `CURRENT_DATE`.

Shared operations used by private and forum handlers: `checkForumMembership`, `requireParticipantAccess`, `assignDailyTopics`, `dispatchDailyTopics`, `recordTopicResponse`, `publishPlan`, `setTaskCompletion`, and `collectDueAccountabilityCases`.
