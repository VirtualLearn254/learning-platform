# Render-engineer — Claude owns the render engine, ships through a gate

The render step produces every pixel a learner sees, so it is the most
important code in the app. Claude (on your subscription, via Claude Code)
**authors** the render-engine code and continuously reviews what it produces;
it opens pull requests for engine bugs it finds. It never merges its own work
and never deploys — you hold the merge.

Two skills:
- `.claude/skills/render-engineer/SKILL.md` — reviews renders, fixes engine
  bugs on a branch, proves them green locally, opens a PR. Edits are confined
  to an **allowlist** (render-engine, scorm-packager, the render/stitch/scorm/
  notes/audit workers, and the render-related `apps/api/src/lib/*.ts`); auth,
  secrets, billing, DB schema, `.env*`, docker, and `.github/` are off-limits.
- `.claude/skills/render-reviewer/SKILL.md` — an independent, adversarial PR
  reviewer (separation of duties). Built and ready, but **dormant** until you
  choose to hand it the merge gate.

## The gate — starts human-merge

You review a clean, evidenced PR (root cause → reproduction → fix → before/
after frames → blast radius → green CI) instead of watching renders. Merge or
request changes as you would any teammate's PR. After roughly ten PRs, once its
judgment has matched yours, you can switch the gate to the reviewer agent (run
`render-reviewer` as the approver) for hands-off routine fixes — the engineer
agent still can't approve its own work.

## One-time VPS (or workstation) setup

```bash
npm install -g @anthropic-ai/claude-code
claude setup-token                       # your Claude subscription (OAuth)
cd /root/learning-platform && git pull
# gh must be authenticated with rights to push branches + open PRs on the repo:
gh auth status

# Smoke-test one run:
LP_ADMIN_PASSWORD='<pw>' claude -p "/render-engineer" \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep" --max-turns 200
```

Schedule it lighter than producer-gate — engine bugs are rarer than beats
needing review, and each run may open a PR you must read:

```cron
30 6 * * 1,4  cd /root/learning-platform && LP_ADMIN_PASSWORD='<pw>' /usr/bin/env claude -p "/render-engineer" --allowedTools "Bash,Read,Write,Edit,Glob,Grep" --max-turns 200 >> /var/log/render-engineer.log 2>&1
```
(Twice a week shown. It opens at most one PR per run.)

## Guardrails (enforced by the skill)

- **Blast-radius ladder**: re-render a one-off bad beat (data) or propose a
  Hermes rule (prompt) BEFORE reaching for a code change. Code PRs are reserved
  for genuine systemic engine bugs.
- **Allowlist**: edits confined to render code; anything else → escalate, not edit.
- **PR-only**: branch + `gh pr create`; never merge, never push to main, never deploy.
- **Green before review**: local typechecks (`@lp/scorm-packager`, `@lp/api`,
  `@lp/ai-provider`, web tsc) must pass; CI must be green on the PR.
- **Evidence-mandatory**: no reproduction + before/after → not review-ready.
- **One concern per PR**, small diff.

## Watching it

- PRs land as branches `render-fix/*` — `gh pr list` or the GitHub UI.
- Per-run digest in `render-engineer-log/<date>.md` (gitignored): what it
  reviewed, whether it opened a PR, and any escalations.
- To pause: comment out the cron line. Nothing it does reaches production until
  you merge and run the normal deploy.
