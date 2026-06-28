# AI roles — what they do, what to use, how to swap

The app routes every AI call through one of **6 named roles** (a.k.a. "profiles"). Each role bundles a default provider, a default model, and sensible temperature/token settings. The Settings UI lets you swap any of these without touching code.

This doc is the reference for **which role does what**, **which models are good substitutes** (across quality + cost tiers), and **how to actually change them**.

> **Quick links**
> - Code defaults: [`packages/ai-provider/src/profiles.ts`](../packages/ai-provider/src/profiles.ts)
> - Price catalog: [`packages/ai-provider/src/catalog.ts`](../packages/ai-provider/src/catalog.ts)
> - Swap them live: `http://<vps-ip>/settings` → "AI roles" card

---

## How role routing actually works

1. Code declares **default chain** per role, e.g. `author` defaults to `[anthropic → local → openai → deepseek]` with `claude-sonnet-4-6` on Anthropic.
2. The Settings UI lets you **override** any role's preferred provider, model, temperature, or max tokens. Overrides are stored in the `ai_profile_overrides` Postgres table.
3. At call time, the client takes the first **configured** provider from the (possibly-overridden) chain and uses the (possibly-overridden) model.
4. Every call logs to `ai_usage` so the same Settings page can show running spend.

The fallback chain matters: if your overridden provider is unreachable mid-render, the next entry in the chain takes over automatically. **No silent failures.**

---

## The 6 roles in detail

### 1. `author` — writes each beat

**Purpose:** Generate the HTML/CSS/JS that becomes a single beat (one ~30-second visual scene).

| Trait | Value |
|---|---|
| Input | ~3-5K tokens (system prompt + beat spec + style hints) |
| Output | ~2-3K tokens (full HTML document) |
| Quality bar | **High** — bad HTML breaks the render |
| Vision needed | No |
| Frequency | Once per beat (so 7-12× per lesson) |
| Cost contribution | **~60% of a lesson's AI bill** |

**Default:** `claude-sonnet-4-6` ($3 in / $15 out per 1M)

**Good substitutes (quality-ranked, premium first):**

| Tier | Model | $/1M in/out | Notes |
|---|---|---|---|
| Premium | `claude-opus-4-8` | $15 / $75 | Best HTML quality; 5× cost. Use if Sonnet outputs visual bugs. |
| **Default** | `claude-sonnet-4-6` | $3 / $15 | Solid for almost every lesson |
| Cheap | `gpt-4o` | $2.50 / $10 | OpenAI equivalent, slightly weaker on long structured HTML |
| Very cheap | `deepseek-chat` | $0.27 / $1.10 | ~10× cheaper than Sonnet. Watch for occasional malformed CSS |
| Free | `Qwen/Qwen2.5-32B-Instruct-AWQ` (vLLM) | $0 + GPU cost | Self-hosted; good if you have an A100/4090. Quality close to gpt-4o |

**Cheapest acceptable:** `deepseek-chat` — produces working HTML for ~80% of beats; the holistic/reviewer steps tend to catch the bad ones.

---

### 2. `reviewer` — per-beat critique

**Purpose:** Read a freshly-written beat (HTML + script) and return a JSON list of issues (typography, layout, timing).

| Trait | Value |
|---|---|
| Input | ~5K tokens (HTML + spec) |
| Output | ~500 tokens (structured JSON) |
| Quality bar | **Medium** — false positives are tolerable, missed issues just go to human review |
| Vision needed | No (text-only review) |
| Frequency | Once per beat |
| Cost contribution | **~10%** |

**Default:** `claude-haiku-4-5-20251001` ($1 / $5)

**Substitutes:**

| Tier | Model | $/1M in/out | Notes |
|---|---|---|---|
| Premium | `claude-sonnet-4-6` | $3 / $15 | Catches subtler issues; rarely worth 3× cost |
| **Default** | `claude-haiku-4-5` | $1 / $5 | Best price/quality for structured critique |
| Cheap | `gpt-4o-mini` | $0.15 / $0.60 | ~10× cheaper. JSON output is reliable |
| Very cheap | `deepseek-chat` | $0.27 / $1.10 | Fine for this workload |
| Free | `Qwen/Qwen2.5-14B-Instruct-AWQ` | $0 + GPU | Self-hosted Haiku-equivalent |

**Cheapest acceptable:** `gpt-4o-mini` — the absolute cheapest with reliable JSON output.

---

### 3. `holistic` — cross-beat lesson review

**Purpose:** Read **all beats of a lesson at once** and check for narrative continuity, repeated callouts, pacing problems, broken concept callbacks.

| Trait | Value |
|---|---|
| Input | ~30K tokens (every beat concatenated) |
| Output | ~2K tokens (cross-cutting issues) |
| Quality bar | **High** — this is the last gate before human review |
| Vision needed | No |
| Frequency | **Once per lesson** (not per beat) |
| Cost contribution | **~15%** |

**Default:** `claude-opus-4-8` ($15 / $75 — yes, expensive)

**Substitutes:**

| Tier | Model | $/1M in/out | Notes |
|---|---|---|---|
| **Default** | `claude-opus-4-8` | $15 / $75 | Best at synthesis. ~$0.50/lesson on a 7-beat lesson |
| Recommended affordable | `claude-sonnet-4-6` | $3 / $15 | 80% of Opus quality at 1/5 cost. Strong default |
| Cheap | `gpt-4o` | $2.50 / $10 | Decent at long-context synthesis |
| Reasoning | `deepseek-reasoner` | $0.55 / $2.19 | Cheapest with strong synthesis. Slower. |
| Free | `Qwen/Qwen2.5-32B-Instruct-AWQ` (long ctx) | $0 + GPU | Works if your local model supports 32K+ context |

**Cost-tuned recommendation:** Swap to `claude-sonnet-4-6` for holistic and you'll cut lesson cost by ~15% with minimal quality loss.

---

### 4. `verifier` — vision check on rendered screenshots

**Purpose:** Look at a hero-frame screenshot of the rendered beat and confirm the visual matches the intent (layout correct, no overlapping text, exponents render right).

| Trait | Value |
|---|---|
| Input | ~1K text + 1 image (per beat) |
| Output | ~500 tokens (issue list or "looks good") |
| Quality bar | **High** — catches the visual regressions text review can't see |
| Vision needed | **YES** (must be vision-capable) |
| Frequency | 1-3× per beat (per hero frame extracted) |
| Cost contribution | **~10%** |

**Default:** `claude-sonnet-4-6` ($3 / $15, vision-capable)

**Substitutes:**

| Tier | Model | $/1M in/out | Vision? | Notes |
|---|---|---|---|---|
| Premium | `claude-opus-4-8` | $15 / $75 | ✓ | Best visual reasoning. Overkill unless you see frequent visual misses |
| **Default** | `claude-sonnet-4-6` | $3 / $15 | ✓ | Balanced |
| Cheap | `gpt-4o` | $2.50 / $10 | ✓ | Comparable vision quality |
| Very cheap | `gpt-4o-mini` | $0.15 / $0.60 | ✓ | ~20× cheaper. Acceptable for layout checks, weaker on text-in-image |
| Free | `Qwen/Qwen2-VL-7B-Instruct` (vLLM) | $0 + GPU | ✓ | Self-hosted vision. Quality varies |

⚠️ **Don't swap to** `deepseek-chat`, `o1`, or `o1-mini` — none support vision. The UI dropdown disables non-vision models for this role automatically.

**Cheapest acceptable:** `gpt-4o-mini` — surprisingly capable for the price, but watch first 5 lessons for missed issues.

---

### 5. `ingest` — parse uploaded course material

**Purpose:** Take an uploaded PDF/doc, parse it, and produce a structured course outline (modules → sections → lessons → beats).

| Trait | Value |
|---|---|
| Input | ~10-20K tokens (extracted PDF text) |
| Output | ~4-6K tokens (nested JSON outline) |
| Quality bar | **High** — wrong outline means every downstream step is wasted |
| Vision needed | No (PDF text is extracted before the call) |
| Frequency | Once per uploaded material |
| Cost contribution | **N/A** (one-time, not per-lesson) |

**Default:** `claude-sonnet-4-6` ($3 / $15)

**Substitutes:**

| Tier | Model | $/1M in/out | Notes |
|---|---|---|---|
| Premium | `claude-opus-4-8` | $15 / $75 | If your source material is unusually messy |
| **Default** | `claude-sonnet-4-6` | $3 / $15 | Great at structured output from long context |
| Cheap | `gpt-4o` | $2.50 / $10 | Reliable JSON output |
| Very cheap | `gpt-4o-mini` | $0.15 / $0.60 | Works for clean PDFs; struggles with scanned/messy ones |
| Free | `Qwen/Qwen2.5-32B-Instruct-AWQ` | $0 + GPU | Long-context version recommended |

**Pragmatic note:** Since ingest runs once per upload (not per beat), even using Opus here only adds ~$0.30 per *course*. Not worth penny-pinching.

---

### 6. `utility` — cheap classification + extraction

**Purpose:** Small one-off tasks — classifying a beat type, extracting a single value from text, tagging concepts. Used by various background jobs.

| Trait | Value |
|---|---|
| Input | ~500-1K tokens |
| Output | ~100-500 tokens |
| Quality bar | **Low** — single-token answers, easy to validate |
| Vision needed | No |
| Frequency | Variable; can be 20-100× per lesson |
| Cost contribution | **~5%** but high call volume |

**Default:** `claude-haiku-4-5-20251001` ($1 / $5)

**Substitutes:**

| Tier | Model | $/1M in/out | Notes |
|---|---|---|---|
| **Default** | `claude-haiku-4-5` | $1 / $5 | Fast + good at structured short answers |
| Cheap | `gpt-4o-mini` | $0.15 / $0.60 | ~7× cheaper; quality essentially identical for utility tasks |
| Very cheap | `deepseek-chat` | $0.27 / $1.10 | Fine here |
| Free | `Qwen/Qwen2.5-7B` or `14B` (vLLM) | $0 + GPU | Self-hosted; cheapest if GPU available |

**Cheapest acceptable:** `gpt-4o-mini` — drop-in replacement.

---

## Cost scenarios — same 7-beat lesson, different role assignments

These are estimates for a typical 5-minute, ~7-beat lesson at end-to-end run time (author + reviewer + holistic + verifier per beat, plus utility calls).

| Config | author | reviewer | holistic | verifier | utility | **Est. cost** |
|---|---|---|---|---|---|---|
| **All Claude (default)** | Sonnet | Haiku | Opus | Sonnet | Haiku | **~$0.60** |
| **All Sonnet** | Sonnet | Sonnet | Sonnet | Sonnet | Sonnet | ~$0.80 |
| **Premium** | Opus | Sonnet | Opus | Opus | Sonnet | ~$2.00 |
| **Cost-tuned Claude** | Sonnet | Haiku | **Sonnet** | Sonnet | Haiku | **~$0.45** ⭐ |
| **OpenAI mix** | gpt-4o | gpt-4o-mini | gpt-4o | gpt-4o | gpt-4o-mini | ~$0.40 |
| **Bargain OpenAI** | gpt-4o-mini | gpt-4o-mini | gpt-4o | gpt-4o-mini | gpt-4o-mini | **~$0.10** |
| **DeepSeek-heavy** | deepseek-chat | deepseek-chat | deepseek-reasoner | gpt-4o-mini ¹ | deepseek-chat | **~$0.06** |
| **Local (self-hosted)** | Qwen-32B | Qwen-14B | Qwen-32B | Qwen2-VL-7B | Qwen-14B | **$0** + GPU cost |

¹ DeepSeek has no vision model, so verifier needs to stay on OpenAI/Anthropic.

⭐ = recommended starting point if cost matters but you don't want to leave the Claude ecosystem.

---

## How to swap (UI steps)

1. **http://`<vps-ip>`/settings** → scroll to the **"AI roles"** card
2. Find the role you want to change
3. Use the **Provider** dropdown to switch to a different vendor
   - Providers you haven't configured an API key for show as "(not configured)" and can't be picked
4. Use the **Model** dropdown to pick a specific model
   - Vision-required roles (verifier) hide non-vision models automatically
5. Optionally tweak **Temp** (higher = more varied) and **Max tokens** (caps output length)
6. Click **Save** — takes effect on the next AI call, no restart
7. A "custom" badge appears next to overridden roles. Click **Reset** to revert to the code default.

**Verifying a swap worked:**
- The "Active provider" + "Model" columns reflect your override
- Click **Test** on the provider card to fire a logged 1-token call
- Refresh the "AI usage" card — your test call appears in the breakdown by model

---

## How to add a model that isn't in the catalog

The dropdown is populated from `packages/ai-provider/src/catalog.ts`. To add a new model:

1. Edit that file, add the new entry under the right provider, with input/output prices per 1M tokens
2. Commit + push
3. Redeploy (`bash learning-platform/infra/contabo/bootstrap.sh` on the VPS)

For `local` (vLLM), the catalog is intentionally empty — you can type any model id directly in the UI's free-text field. That's how you specify whatever weights your GPU is currently serving.

---

## How to add a new provider

Bigger change. Three files touched:

1. **`packages/ai-provider/src/providers/<name>.ts`** — implement the `Provider` interface (chat + optional vision)
2. **`packages/ai-provider/src/profiles.ts`** — add the provider id to `ProviderId`, add a model id per profile in `modelByProvider`
3. **`packages/ai-provider/src/catalog.ts`** — add the model list + prices
4. **`packages/ai-provider/src/index.ts`** — wire it into `createAIClient`
5. **`apps/api/src/lib/secrets.ts`** — add the env-var name to `SECRET_NAMES` + `ENV_KEYS`
6. **`apps/api/src/routes/ai.ts`** — add to `PROVIDER_DOCS`

The pattern is identical to what `anthropic.ts` does — copy it.

---

## Token usage monitoring

Settings page → **AI usage** card → window selector at top right.

Shows for the chosen window (1h / 24h / 7d / 30d):

- **Total spend** + total call count
- **Avg cost per call** + total tokens
- **Avg latency**
- **Error count**
- Hourly (or daily) bar chart of cost
- Breakdown by role / by provider / by model with cost share bars

Every `chat()` and `vision()` call routed through `@lp/ai-provider` is logged automatically — including the **Test** button calls. No instrumentation needed in worker code.

**Cost is computed at log time** from `catalog.ts`. If you update prices in that file later, historical numbers stay frozen at whatever was charged when the call happened. To rebuild from scratch, truncate `ai_usage` and start fresh.
