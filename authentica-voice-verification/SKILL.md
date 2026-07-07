---
name: authentica-voice-verification
description: >
  Compare two voice recordings using Authentica's voice verification API — match a
  registered reference audio clip against a real-time recording. Use whenever the user
  wants voice biometric verification, audio identity matching, or speaker recognition —
  even if they don't say "Authentica" but the project already uses it.
---

# Authentica Voice Verification

Compare a registered (reference) voice recording against a real-time query recording. Returns `matched: true` if the recordings are from the same speaker, `matched: false` otherwise.

**Stack:** Next.js App Router, TypeScript, server-side only (route handlers or server actions). Audio payloads should never pass through client-side code.

---

## Gotchas — read first

### 1. WAV is the only confirmed working audio format
**M4A/AAC (`.m4a`) is NOT accepted** — the API silently returns a 302 redirect (bad-input pattern) for M4A payloads. This was confirmed by live testing.

**If your source audio is M4A, transcode to WAV first:**
```bash
# CLI (for testing or scripts)
ffmpeg -i input.m4a -ar 16000 -ac 1 -f wav output.wav
```
```typescript
// In Node.js (install fluent-ffmpeg + @ffmpeg-installer/ffmpeg)
import ffmpeg from "fluent-ffmpeg";
import { Readable } from "stream";

async function m4aToWav(m4aBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    ffmpeg(Readable.from(m4aBuffer))
      .audioFrequency(16000)
      .audioChannels(1)
      .format("wav")
      .on("error", reject)
      .pipe()
      .on("data", (c: Buffer) => chunks.push(c))
      .on("end", () => resolve(Buffer.concat(chunks)));
  });
}
```

If other formats are needed, test them against the live API before assuming they work; only WAV has been empirically verified.

### 2. Raw base64 — no data URI prefix
Pass raw base64 (`SUQzBA...`), **not** `data:audio/wav;base64,...`. Strip the prefix if your source provides a data URI.

### 3. Non-match returns HTTP 200 with result:false (not an error)
Unlike face verification, voice non-match returns a clean HTTP 200 with `{ "success": true, "data": { "result": false } }`. This is a normal outcome — don't throw on it.

### 4. Bad input → 302 redirect
Missing fields, wrong audio format, or invalid base64 cause HTTP 302 → homepage. The client's `redirect:'error'` converts this to an AuthenticaError.

### 5. `user_id` is required
Pass your internal user identifier. It's echoed back in the response.

---

## Setup

### 1. Environment variable
```
AUTHENTICA_API_KEY=your_key_here   # server-side only
```

### 2. Install the client
Copy `references/client.ts` into your project at e.g. `lib/authentica/client.ts`.

### 3. Smoke test
```typescript
// app/api/authentica-check/route.ts
import { checkBalance } from "@/lib/authentica/client";

export async function GET() {
  const { balance } = await checkBalance();
  return Response.json({ ok: true, balance });
}
```

---

## Implementation

### Route handler: verify voice

```typescript
// app/api/auth/verify-voice/route.ts
import { verifyByVoice, AuthenticaError } from "@/lib/authentica/client";

export async function POST(request: Request) {
  const { userId, registeredAudio, queryAudio } = await request.json();

  if (!userId || !registeredAudio || !queryAudio) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Strip data URI prefix if present
  const cleanRegistered = registeredAudio.replace(/^data:audio\/[^;]+;base64,/, "");
  const cleanQuery = queryAudio.replace(/^data:audio\/[^;]+;base64,/, "");

  try {
    const result = await verifyByVoice({
      userId,
      registeredAudio: cleanRegistered,
      queryAudio: cleanQuery,
    });

    if (!result.matched) {
      return Response.json({ verified: false, reason: "Voice does not match" });
    }

    // Voice matched — issue your own session here
    // e.g. await createSession(userId);
    return Response.json({ verified: true });
  } catch (err) {
    if (err instanceof AuthenticaError) {
      if (err.status === 302) {
        // Almost certainly a wrong audio format — M4A is not accepted
        return Response.json(
          { error: "Invalid audio format — ensure audio is WAV (PCM). M4A is not accepted." },
          { status: 400 }
        );
      }
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

### Handling audio uploads (server-side pattern)

If the user is uploading a live recording from the browser, receive it server-side as a `multipart/form-data` file, transcode if needed, then base64-encode:

```typescript
// app/api/auth/verify-voice/route.ts (upload variant)
import { verifyByVoice, AuthenticaError } from "@/lib/authentica/client";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("audio") as File;
  const userId = formData.get("userId") as string;

  if (!file || !userId) {
    return Response.json({ error: "Missing audio or userId" }, { status: 400 });
  }

  // Convert File to Buffer
  const audioBuffer = Buffer.from(await file.arrayBuffer());

  // If file is M4A, transcode to WAV first (see transcoding snippet above)
  // const wavBuffer = await m4aToWav(audioBuffer);
  // const queryAudio = wavBuffer.toString("base64");

  const queryAudio = audioBuffer.toString("base64"); // assumes WAV input

  // Load registered audio from storage
  // const registeredAudio = await loadRegisteredVoice(userId); // your storage logic

  try {
    const result = await verifyByVoice({ userId, registeredAudio, queryAudio });
    return Response.json({ verified: result.matched });
  } catch (err) {
    if (err instanceof AuthenticaError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

### Server action variant

```typescript
// app/actions/verify-voice.ts
"use server";
import { verifyByVoice, AuthenticaError } from "@/lib/authentica/client";

export async function verifyVoiceAction(
  userId: string,
  registeredAudio: string,
  queryAudio: string
) {
  const clean = (s: string) => s.replace(/^data:audio\/[^;]+;base64,/, "");
  try {
    const result = await verifyByVoice({
      userId,
      registeredAudio: clean(registeredAudio),
      queryAudio: clean(queryAudio),
    });
    return { success: result.matched };
  } catch (err) {
    if (err instanceof AuthenticaError) {
      return { success: false, error: err.message };
    }
    throw err;
  }
}
```

---

## Observed API responses

**Match (HTTP 200):**
```json
{"success":true,"data":{"user_id":"your-user-id","result":true}}
```

**Non-match (HTTP 200):**
```json
{"success":true,"data":{"user_id":"your-user-id","result":false}}
```

**Bad audio format / bad input (HTTP 302 → HTML, non-JSON):**
Confirmed for M4A input. Client converts to AuthenticaError with status 302.

**Bad auth (HTTP 401):**
```json
{"errors":[{"message":"Unauthorized"}]}
```

---

## Scripts

`scripts/verify-voice.ts` — compares two WAV files directly from disk. Use this to confirm the API accepts your audio and returns the expected result before wiring it into the app.

```bash
AUTHENTICA_API_KEY=your_key npx tsx .claude/skills/authentica-voice-verification/scripts/verify-voice.ts \
  --registered path/to/reference.wav \
  --query path/to/realtime.wav \
  --user-id test-user
```

Prints `✓ Result: MATCH` or `Result: NO MATCH`. WAV only — M4A will error with a clear message. Cost: 1 credit per run.

---

## Client reference

→ Read `references/client.ts` for the complete `verifyByVoice`, `AuthenticaError` implementations and inline comments.
