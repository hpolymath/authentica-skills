---
name: authentica-otp
description: >
  Send and verify one-time passcodes (OTP) via Authentica — SMS, WhatsApp, or email.
  Use whenever the user is adding phone or email OTP verification, two-factor codes,
  passwordless login, "send a code to the user" flows, or any step-up authentication —
  even if they don't say "Authentica" but the project already uses it.
---

# Authentica OTP

Send a numeric OTP to a user's phone (SMS or WhatsApp) or email, then verify the code they enter. This skill covers the full flow.

**Stack:** Next.js App Router, TypeScript, server-side only (route handlers or server actions). The API key never reaches the browser.

---

## Gotchas — read first

### 1. verify-otp uses `status`, not `success`
`send-otp` returns `{ "success": true }`. `verify-otp` returns `{ "status": true }` — different field, same concept, different key. Any code that reads `body.success` for verify-otp will silently pass on a failed verification. Always read `body.status`.

### 2. Wrong OTP = HTTP 422, not 200 with status:false
A wrong or expired OTP returns HTTP 422 with `{ "status": false, "message": "Failed to verify OTP" }`. Handle this as a normal user-facing outcome ("wrong code"), not a crash.

### 3. HTTP 200 from send-otp doesn't guarantee the message was delivered
The API returns 200 when it accepted the request. Delivery failures (e.g., bad phone number that passes the regex) may succeed at the API layer but not deliver. Check your Authentica dashboard for delivery status.

### 4. Bad phone → 302 redirect (not a JSON error)
A phone number not in E.164 format (`+[country][number]`) causes the API to return HTTP 302 → homepage. `fetch()` will follow it and get non-JSON HTML. Validate E.164 before calling — the client does this automatically.

### 5. `template_id` defaults to 1
Use `template_id: 1` unless you've created custom templates in the Authentica portal. The default template delivers a generic OTP message.

---

## Setup

### 1. Environment variable
```
AUTHENTICA_API_KEY=your_key_here   # server-side only, never client-side
```

### 2. Install the client
Copy `references/client.ts` into your project at e.g. `lib/authentica/client.ts`.

### 3. Smoke test (verify setup before writing feature code)
```typescript
// app/api/authentica-check/route.ts
import { checkBalance } from "@/lib/authentica/client";

export async function GET() {
  const { balance } = await checkBalance();
  return Response.json({ ok: true, balance });
}
```
Visit `/api/authentica-check`. If it returns `{"ok":true,"balance":"..."}`, the key is valid and you have credits. If it throws, the key is missing or invalid.

---

## Implementation

**Before building an OTP flow, ask the developer which channel(s) to support — SMS, WhatsApp, email, or a choice of several.** It changes the UI and the required user input (phone vs. email). Do not silently default to SMS.

### Route handler: send OTP

```typescript
// app/api/auth/send-otp/route.ts
import { sendOtp, AuthenticaError } from "@/lib/authentica/client";

export async function POST(request: Request) {
  const { phone, method = "sms" } = await request.json();

  try {
    await sendOtp({ method, phone, templateId: 1 });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthenticaError) {
      // E.164 validation failure, bad auth, or API rejection
      return Response.json(
        { error: err.message },
        { status: err.status === 401 ? 401 : 400 }
      );
    }
    throw err;
  }
}
```

**For email OTP,** pass `method: "email"` and `email` instead of `phone`:
```typescript
await sendOtp({ method: "email", email: "user@example.com", templateId: 1 });
```

### Route handler: verify OTP

```typescript
// app/api/auth/verify-otp/route.ts
import { verifyOtp, AuthenticaError } from "@/lib/authentica/client";

export async function POST(request: Request) {
  const { phone, otp } = await request.json();

  try {
    const result = await verifyOtp({ phone, otp });
    // result.verified is true (correct code) or false (wrong/expired)
    if (!result.verified) {
      return Response.json({ error: "Invalid or expired code" }, { status: 400 });
    }

    // Verification succeeded — issue your own session here
    // e.g. await createSession(userId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthenticaError) {
      return Response.json({ error: err.message }, { status: 500 });
    }
    throw err;
  }
}
```

**For email OTP verify,** pass `email` instead of `phone`:
```typescript
const result = await verifyOtp({ email: "user@example.com", otp });
```

### Server action variant

```typescript
// app/actions/verify-otp.ts
"use server";
import { verifyOtp, AuthenticaError } from "@/lib/authentica/client";

export async function verifyOtpAction(phone: string, otp: string) {
  const result = await verifyOtp({ phone, otp });
  if (!result.verified) {
    return { success: false, error: "Invalid or expired code" };
  }
  // Issue your own session here
  return { success: true };
}
```

---

## Observed API responses

**Send success (HTTP 200):**
```json
{"success":true,"data":null,"message":"OTP sent successfully."}
```

**Verify success (HTTP 200):**
```json
{"status":true,"message":"OTP verified successfully"}
```

**Verify failure — wrong OTP (HTTP 422):**
```json
{"status":false,"message":"Failed to verify OTP"}
```

**Bad auth (HTTP 401):**
```json
{"errors":[{"message":"Unauthorized"}]}
```

**Bad phone / missing field (HTTP 302 → HTTP 405 HTML, non-JSON):**
No JSON body. The `redirect:'error'` setting in the client converts this to an AuthenticaError before it reaches your code.

---

## Scripts

`scripts/send-test-otp.ts` — sends a real OTP and interactively verifies it. Use this to confirm the full flow works before wiring it into the app.

```bash
# SMS
AUTHENTICA_API_KEY=your_key npx tsx .claude/skills/authentica-otp/scripts/send-test-otp.ts \
  --method sms --phone +966551234567

# Email
AUTHENTICA_API_KEY=your_key npx tsx .claude/skills/authentica-otp/scripts/send-test-otp.ts \
  --method email --email you@example.com
```

The script sends the OTP, prompts for the code, verifies it, and prints `✓ Code verified` on success. Cost: 1 credit per run. Enter the code quickly — OTPs expire within ~2 minutes.

---

## Client reference

→ Read `references/client.ts` for the complete `sendOtp`, `verifyOtp`, `AuthenticaError`, and `validateE164` implementations.
