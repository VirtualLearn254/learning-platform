# Producer gate — Claude agent working the human_review queue

The producer gate is a Claude Code agent (running on your Claude
subscription, not the API meter) that reviews beats waiting in
`human_review`: it looks at each beat's actual frames, judges them against
the script and the house rules, then approves, queues a visual correction,
sends the script back for revision, or escalates to you. Every run appends
a digest to `producer-digests/<date>.md`.

The behavior lives in `.claude/skills/producer-gate/SKILL.md` — edit that
file to change the judgment criteria or limits; the next run picks it up
(after `git pull` on the VPS).

## One-time VPS setup

```bash
# 1. Install Claude Code + authenticate with your Claude (Pro/Max) account
npm install -g @anthropic-ai/claude-code
claude setup-token          # prints a URL — complete login in your browser

# 2. Smoke-test one run from the repo root (skills load from cwd)
cd /root/learning-platform
LP_ADMIN_PASSWORD='<your admin password>' \
  claude -p "/producer-gate" --allowedTools "Bash,Read,Write,Glob,Grep" --max-turns 100

# 3. Schedule it (daily 06:15 UTC shown; add more lines during course runs)
crontab -e
```

```cron
15 6 * * * cd /root/learning-platform && LP_ADMIN_PASSWORD='<pw>' /usr/bin/env claude -p "/producer-gate" --allowedTools "Bash,Read,Write,Glob,Grep" --max-turns 100 >> /var/log/producer-gate.log 2>&1
```

Notes:
- `LP_ADMIN_PASSWORD` is only needed once API auth is enabled; while auth is
  disabled the agent proceeds without it.
- Subscription rate limits are shared with your interactive Claude Code use.
  A 12-beat run is modest; avoid scheduling more than a few runs/day.
- Digests accumulate in `producer-digests/` (gitignored). Check escalations
  first — those are the beats the agent deliberately left for you.
- To pause: comment out the crontab line. To review its decisions: every
  approve/revise carries a `[producer-gate]` prefix in the beat's feedback
  history.
