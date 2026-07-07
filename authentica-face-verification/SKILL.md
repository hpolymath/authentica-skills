---
name: authentica-face-verification
description: >
  Compare two face images using Authentica's face verification API — match a
  registered reference photo against a real-time capture. Use whenever the user
  wants face biometric verification, photo ID matching, liveness-adjacent face
  comparison, or "verify the user is who their profile photo shows" — even if
  they don't say "Authentica" but the project already uses it.
---

# Authentica Face Verification

Compare a reference (registered) face image against a real-time query image. Returns `matched: true` if the faces belong to the same person, `matched: false` otherwise.

**Stack:** Next.js App Router, TypeScript, server-side only (route handlers or server actions). Large image payloads must never go through a client-side fetch — the API key would be exposed.

---

## Gotchas — read first

### 1. Non-match may return HTTP 422, not 200 with result:false
The OpenAPI spec documents non-match as `{ "success": true, "data": { "result": false } }` (HTTP 200). Live testing observed HTTP 422 with `{ "success": false, "message": "Something went wrong" }` for non-matching or undetectable faces. The client handles both: a 422 from verify-by-face is treated as `matched: false`, not an error.

### 2. `data.result` is the match flag — not top-level `success`
`success: true` means "the API call itself worked." The actual match verdict is in `data.result`. A call that returns `success:true` but `data.result:false` means the call succeeded but the faces didn't match.

### 3. Raw base64 — no data URI prefix
The API expects raw base64 (`/9j/4AAQ...`), **not** `data:image/jpeg;base64,...`. Strip the prefix if your source gives you a data URI.

### 4. Bad input → 302 redirect (not JSON)
Missing `user_id`, invalid base64, or missing fields cause HTTP 302 → homepage. The client's `redirect:'error'` converts this to an AuthenticaError.

### 5. `user_id` is required
Pass your internal user identifier. It's returned in the response — useful for logging, not for matching logic.

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

### Route handler: verify face

The key design decision: images are large (often 100KB–2MB as base64). Receive them as base64 strings from the client — don't proxy raw files through the route handler. Alternatively, read them from server-side storage (S3, Supabase) using the registered image's path.

```typescript
// app/api/auth/verify-face/route.ts
import { verifyByFace, AuthenticaError } from "@/lib/authentica/client";

export async function POST(request: Request) {
  const { userId, registeredFaceImage, queryFaceImage } = await request.json();

  // Validate inputs before sending
  if (!userId || !registeredFaceImage || !queryFaceImage) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Strip data URI prefix if present
  const cleanRegistered = registeredFaceImage.replace(/^data:image\/[^;]+;base64,/, "");
  const cleanQuery = queryFaceImage.replace(/^data:image\/[^;]+;base64,/, "");

  try {
    const result = await verifyByFace({
      userId,
      registeredFaceImage: cleanRegistered,
      queryFaceImage: cleanQuery,
    });

    if (!result.matched) {
      return Response.json({ verified: false, reason: "Faces do not match" });
    }

    // Face matched — issue your own session here
    // e.g. await createSession(userId);
    return Response.json({ verified: true });
  } catch (err) {
    if (err instanceof AuthenticaError) {
      if (err.status === 401) {
        return Response.json({ error: "Authentication error" }, { status: 500 });
      }
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

### Reading images from storage (server-side pattern)

If the registered image lives in storage, read it server-side — don't expose the storage URL to the client:

```typescript
import { readFile } from "fs/promises";

// Example: reading from local storage (adapt to S3/Supabase as needed)
const registeredBuffer = await readFile(`/storage/faces/${userId}.jpg`);
const registeredFaceImage = registeredBuffer.toString("base64");
```

### Server action variant

```typescript
// app/actions/verify-face.ts
"use server";
import { verifyByFace, AuthenticaError } from "@/lib/authentica/client";

export async function verifyFaceAction(
  userId: string,
  registeredFaceImage: string,
  queryFaceImage: string
) {
  const clean = (s: string) => s.replace(/^data:image\/[^;]+;base64,/, "");
  try {
    const result = await verifyByFace({
      userId,
      registeredFaceImage: clean(registeredFaceImage),
      queryFaceImage: clean(queryFaceImage),
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

**Non-match or face detection failure (HTTP 422):**
```json
{"success":false,"message":"Something went wrong"}
```
Note: this differs from the OpenAPI spec, which documents non-match as a 200 with `result:false`. The client treats 422 as `matched:false`.

**Bad auth (HTTP 401):**
```json
{"errors":[{"message":"Unauthorized"}]}
```

**Bad input — missing fields or invalid base64 (HTTP 302 → HTML, non-JSON):**
Handled by the client's `redirect:'error'` setting.

---

## End-to-end proof (optional, costs ~1 credit)

To confirm your integration works before shipping:

1. Ask the dev for a path to two face images of the same person (registered + query).
2. Read both as base64 (no data URI prefix).
3. Call `verifyByFace({ userId: "test-user", registeredFaceImage, queryFaceImage })`.
4. Confirm `result.matched === true`.

This costs 1 credit and runs a real biometric comparison.

---

## Client reference

→ Read `references/client.ts` for the complete `verifyByFace`, `AuthenticaError` implementations and inline comments.
