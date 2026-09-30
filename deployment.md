# Deploy Brain-Up bot on a small Ubuntu VPS

The bot uses long polling (`bot.start()`). It opens outbound connections to Telegram and to Neon. It does not listen on a port. Do not put nginx in front of it, and do not set a Telegram webhook.

Nothing below contains a real token or database password. Those live only in `.env` on the server.

## 1. Packages and Node.js 22

SSH in, then:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v22.x
npm -v
```

If that setup script is no longer published, install Node.js 22 from https://nodejs.org so `node` and `npm` are on the PATH used by systemd (usually `/usr/bin/node`).

## 2. App user and directory

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin brainup || true
sudo mkdir -p /opt/brain-up-bot
sudo chown "$USER":"$USER" /opt/brain-up-bot
git clone <your-repo-url> /opt/brain-up-bot
cd /opt/brain-up-bot
npm ci
npm run build
```

`npm ci` needs `package-lock.json` from the repo. Do not set `NODE_ENV=production` before this step, or npm will skip the TypeScript compiler and `npm run build` will fail. The systemd unit below does not set `NODE_ENV`.

## 3. Environment

```bash
cp example.env .env
chmod 600 .env
```

Edit `.env` and fill in every value. `example.env` says where each one comes from. Short version:

- `BOT_TOKEN` from @BotFather (`/newbot`)
- `BOT_USERNAME` without `@`
- `DATABASE_URL` from Neon: console.neon.tech → your project → Connect → pooled connection string (`postgresql://...`, host usually contains `-pooler`, `sslmode=require`)
- `GROUP_CHAT_ID` optional. Leave it empty, add the bot as a group admin, then an admin sends `/group -100...` in the bot (or `/group` inside the group). A value here is used only until `/group` saves one.
- `ADMIN_TELEGRAM_IDS` comma-separated numeric user ids from @userinfobot
- `TIMEZONE=Asia/Tashkent`

Neon is outside the VPS. The server only needs outbound access to the Neon host on port 5432 (and to `api.telegram.org` on 443). On the Neon free tier you usually do not allow-list IPs. If you later turn that on (Neon console → Project Settings → IP Allow), add this VPS's public IP or the bot cannot connect.

Give `.env` to the service user:

```bash
sudo chown -R brainup:brainup /opt/brain-up-bot
```

## 4. systemd

`/etc/systemd/system/brain-up-bot.service`:

```ini
[Unit]
Description=Brain-Up Telegram bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=brainup
Group=brainup
WorkingDirectory=/opt/brain-up-bot
EnvironmentFile=/opt/brain-up-bot/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`ExecStart` must be the absolute path to `node` (`command -v node`). The process stays in the foreground and long-polls; `Restart=always` brings it back after a crash or reboot.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now brain-up-bot
sudo systemctl status brain-up-bot
```

Migrations run on startup. You do not need a separate migrate service.

## 5. Firewall

No inbound port is required. SSH is the only port you should open.

```bash
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

Do not allow 80 or 443 for this bot. UFW allows outbound traffic by default, which is what long polling and Neon need.

## 6. Logs

```bash
journalctl -u brain-up-bot -f
journalctl -u brain-up-bot -n 200 --no-pager
```

A healthy start logs the timezone, `Applied migration` or `Migrations already up to date`, the daily schedule (including 12:00 wake-button cleanup), and `Long polling as @your_bot`.

Failed Telegram sends are logged and the process keeps running. A missing `BOT_TOKEN`, `DATABASE_URL`, or `BOT_USERNAME` makes the process exit; systemd will restart it until `.env` is fixed. `GROUP_CHAT_ID` can stay empty until an admin connects a group with `/group`.

## 7. Updating

```bash
cd /opt/brain-up-bot
sudo -u brainup git pull
sudo -u brainup npm ci
sudo -u brainup npm run build
sudo systemctl restart brain-up-bot
journalctl -u brain-up-bot -n 50 --no-pager
```

If `git pull` cannot run as `brainup` because of SSH keys, pull as your own user and then `sudo chown -R brainup:brainup /opt/brain-up-bot` before restart.

## 8. Rollout of the forum challenge

1. Back up the production database and record the deployed commit.
2. Stop the old polling process so two pollers do not run together.
3. Build this version and let startup apply the additive migrations. Do not reseed topics.
4. Start with topic scheduling off: `/settings topics off`.
5. Confirm the bot is a forum administrator with `can_restrict_members`. Bind all four topics from inside the real topics with `/bindtopic`.
6. Open Users and confirm known people were reconciled. Do not treat an old Start row as membership until Telegram confirms it.
7. Smoke-test one admin, one member, and one outsider. The outsider should see the waitlist text and must not receive a topic.
8. Turn scheduling back on with `/settings topics on`.
9. Watch failed and uncertain deliveries in `/settings` through one full day.
10. Keep the database backup and the previous build. Do not drop the new tables to roll back, and do not run the old build against the live bot token.

## 9. First day checklist

- The connected chat is a forum supergroup and all four `/bindtopic` commands have been run.
- `/settings` shows the saved times, grace period, bindings, and delivery counts.
- `/report` posts into the daily topic, not General.
