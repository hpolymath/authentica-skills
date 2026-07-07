# authentica-skills

Agent Skills package for [Authentica](https://authentica.sa) — lets Claude Code and Replit Agent write correct Authentica integration code directly into your app, with no back-and-forth and no need to open the docs.

## Skills

| Skill | What it does |
|---|---|
| `authentica-core` | API client setup, env vars, `checkBalance`, shared error handling |
| `authentica-otp` | Send + verify OTP via SMS, WhatsApp, or email |
| `authentica-face-verification` | Compare two face images (biometric match) |
| `authentica-voice-verification` | Compare two voice recordings (speaker match) |

Each skill works standalone — you don't need `authentica-core` loaded to use the workflow skills.

---

## Install

### Claude Code

Copy each skill folder you want into `.claude/skills/` in your project root (or globally into `~/.claude/skills/`):

```bash
# From this repo — copy all four
cp -r authentica-core authentica-otp authentica-face-verification authentica-voice-verification \
  /path/to/your/project/.claude/skills/

# Or just the ones you need
cp -r authentica-otp /path/to/your/project/.claude/skills/
```

Claude Code lazy-loads skills by their `description` field — just start chatting and the right skill activates automatically.

### Replit Agent

Install into `/.agents/skills/` in your Replit project, or use the `npx skills` CLI:

```bash
# Install a specific skill into a Replit project
npx skills authentica-otp -a replit
npx skills authentica-face-verification -a replit
npx skills authentica-voice-verification -a replit
npx skills authentica-core -a replit
```

---

## 30-second quickstart

1. **Set your API key** — add to `.env.local`:
   ```
   AUTHENTICA_API_KEY=your_key_here
   ```

2. **Confirm setup** — ask the agent:
   > "Check my Authentica balance"

   The agent will create a route that calls `checkBalance()`. Visit it — you should see your credit balance. If you get an error, the key is missing or invalid.

3. **Add OTP** — ask the agent:
   > "Add phone OTP verification to my signup route"

   The agent will wire `sendOtp` and `verifyOtp` into route handlers, handling the E.164 validation, wrong-code 422, and envelope inconsistencies automatically.

---

## Requirements

- Next.js (App Router), TypeScript
- Node.js 18+ (native `fetch`)
- An [Authentica API key](https://portal.authentica.sa/applications/)

---

## Credit costs (as of July 2026)

| Operation | Cost |
|---|---|
| SMS OTP send | 1 credit |
| Face verification (per call) | 1 credit |
| Voice verification (per call) | 1 credit |
| Balance check / OTP verify | 0 |

---

## Contributing

The shared client lives at `authentica-core/references/client.ts`. If you edit it, copy it verbatim to all four skill `references/` directories and verify the copies are byte-identical:

```bash
diff authentica-core/references/client.ts authentica-otp/references/client.ts
diff authentica-core/references/client.ts authentica-face-verification/references/client.ts
diff authentica-core/references/client.ts authentica-voice-verification/references/client.ts
```
