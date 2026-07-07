---
name: authentica-core
description: >
  Set up the Authentica API client, environment variables, and shared error handling;
  check account balance. Use this for any Authentica integration — setting up API keys,
  wiring the shared fetch helper, or answering "is my Authentica key working?" Use it
  before (or alongside) the OTP, face, or voice skills when the project doesn't already
  have Authentica configured.
---

# Authentica Core Setup

Authentica is a REST API for OTP, face, and voice verification. Base URL: `https://api.authentica.sa/api/v2`. Every request requires `X-Authorization: <API_KEY>`.

**This skill covers:** initial setup, the shared fetch client, environment variables, and balance checks. For OTP / face / voice workflows, load those skills directly — each bundles its own copy of the client and works standalone.

---

## Step 1 — Environment variable

Add to your `.env.local` (Next.js) or `.env`:

```
AUTHENTICA_API_KEY=your_key_here
```

Never expose this key client-side. All Authentica calls must run in route handlers or server actions.

Add `.env.local` to `.gitignore` if it isn't already. Create `.env.example` with:

```
AUTHENTICA_API_KEY=
```

---

## Step 2 — Install the shared client

Copy `references/client.ts` from this skill into your project at a path like `lib/authentica/client.ts`. It exports:

- `checkBalance()` — confirms the key works and returns your credit balance
- `sendOtp()` — send OTP via SMS, WhatsApp, or email
- `verifyOtp()` — verify the OTP a user entered
- `verifyByFace()` — compare two face images
- `verifyByVoice()` — compare two voice recordings
- `AuthenticaError` — typed error class (carries HTTP status, API messages, raw body)
- `validateE164()` — E.164 phone validator

Read `references/client.ts` for the full source — it's the implementation to copy.

---

## Step 3 — Smoke test (do this before wiring anything else)

**Option A — run the script** (fastest, no app code needed):

```bash
AUTHENTICA_API_KEY=your_key npx tsx .claude/skills/authentica-core/scripts/check-balance.ts
```

Expected output: `✓ API key valid` + your balance. If you see a 401 error, the key is wrong.

**Option B — add a route** (keeps it in the app for teammates):

```typescript
// app/api/authentica-check/route.ts
import { checkBalance } from "@/lib/authentica/client";

export async function GET() {
  const { balance } = await checkBalance();
  return Response.json({ ok: true, balance });
}
```

Visit `/api/authentica-check`. Expected: `{"ok":true,"balance":"86.00"}`.

---

## Scripts

`scripts/check-balance.ts` — standalone key validator. Run it any time you want to confirm the key is working or check remaining credits, without touching app code.

```bash
AUTHENTICA_API_KEY=your_key npx tsx .claude/skills/authentica-core/scripts/check-balance.ts
# or, if key is in .env.local:
npx dotenv -e .env.local -- npx tsx .claude/skills/authentica-core/scripts/check-balance.ts
```

---

## Key gotchas — read before writing any Authentica code

### 1. Three different success envelopes (the #1 bug source)

Each endpoint uses a different field to signal success:

| Endpoint | Success flag | Where |
|---|---|---|
| `GET /balance` | `success: true` | top-level |
| `POST /send-otp` | `success: true` | top-level |
| `POST /verify-otp` | **`status: true`** | top-level |
| `POST /verify-by-face` | `success: true` + `data.result` | nested |
| `POST /verify-by-voice` | `success: true` + `data.result` | nested |

**Never check `success` for verify-otp** — it will silently pass on failure because the field name is `status`, not `success`.

### 2. HTTP 200 does not mean success

A 200 response can contain `success: false` (face/voice) or `status: false` (verify-otp). Always open the body and check the correct flag. The bundled client handles this via its `checkSuccess` callback per endpoint.

### 3. Bad input returns a 302 redirect, not a JSON error

If you send a malformed phone number or missing required fields, the API returns HTTP 302 → redirect to `http://api.authentica.sa`. `fetch()` follows the redirect by default and lands on a non-JSON 405 HTML page. The client sets `redirect: 'error'` to catch this early and throw a clear `AuthenticaError`.

### 4. The only documented error shape is 401

```json
{"errors":[{"message":"Unauthorized"}]}
```

Everything else (wrong OTP, non-matching face, bad input) uses undocumented patterns. The client handles what was observed empirically — see `references/client.ts` comments and `research/observed-api-behavior.md`.

### 5. E.164 phone format required

Phone numbers must be in international format: `+[country code][number]`, e.g. `+966551234567`. The API silently redirects requests with non-E.164 phones (HTTP 302, no JSON error). The client validates before sending.

---

## Full client reference

→ Read `references/client.ts` for the complete implementation, all types, and inline comments explaining each gotcha.

→ See `research/observed-api-behavior.md` (in the build repo) for real API responses from live probing.
