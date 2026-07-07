/**
 * Authentica shared client — single source of truth.
 *
 * CONTRIBUTING: This file is the canonical copy. The three workflow skills
 * (authentica-otp, authentica-face-verification, authentica-voice-verification)
 * each bundle a copy at references/client.ts so they work standalone without
 * authentica-core loaded. If you change this file, copy it verbatim into the
 * other three skill references/ directories. Verify the copies are byte-identical:
 *   diff authentica-core/references/client.ts authentica-otp/references/client.ts
 *   diff authentica-core/references/client.ts authentica-face-verification/references/client.ts
 *   diff authentica-core/references/client.ts authentica-voice-verification/references/client.ts
 */

const BASE_URL = "https://api.authentica.sa/api/v2";

export class AuthenticaError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiMessages: string[],
    public readonly rawBody: string
  ) {
    super(
      apiMessages.length > 0
        ? apiMessages.join("; ")
        : `Authentica request failed (HTTP ${status})`
    );
    this.name = "AuthenticaError";
  }
}

/**
 * Core fetch helper. Never trusts a 200 alone — the caller passes a
 * `checkSuccess` fn that extracts the endpoint-specific success flag
 * from the parsed body.
 *
 * Handles the three failure modes this API actually produces:
 *   1. HTTP 401 → JSON { errors: [{ message }] }
 *   2. HTTP 422 → JSON { status: false, message } (verify-otp wrong code)
 *              or JSON { success: false, message } (face non-match / error)
 *   3. HTTP 302 → redirect to homepage (bad input — fetch follows it,
 *                 lands on a non-JSON 405 HTML page)
 */
async function authenticaRequest<T>(
  path: string,
  options: RequestInit,
  checkSuccess: (body: unknown) => boolean
): Promise<T> {
  const apiKey = process.env.AUTHENTICA_API_KEY;
  if (!apiKey) {
    throw new AuthenticaError(0, ["AUTHENTICA_API_KEY env var is not set"], "");
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      redirect: "error", // treat any redirect as an error — bad input causes a 302
      headers: {
        "Content-Type": "application/json",
        "X-Authorization": apiKey,
        ...(options.headers ?? {}),
      },
    });
  } catch (err) {
    // fetch throws a TypeError when redirect:'error' encounters a redirect,
    // or on network failure. The redirect case means the server rejected our
    // request as bad input (it redirects invalid requests to its homepage).
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("redirect") || msg.includes("Redirect")) {
      throw new AuthenticaError(
        302,
        ["Request rejected by server (redirect on bad input — check your request fields)"],
        ""
      );
    }
    throw new AuthenticaError(0, [`Network error: ${msg}`], "");
  }

  const rawBody = await response.text();

  // Parse JSON — or surface the raw body if non-JSON
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new AuthenticaError(
      response.status,
      [`Non-JSON response (HTTP ${response.status})`],
      rawBody
    );
  }

  // Extract API-level error messages if present
  const apiMessages: string[] = [];
  if (
    body &&
    typeof body === "object" &&
    "errors" in body &&
    Array.isArray((body as { errors: unknown }).errors)
  ) {
    for (const e of (body as { errors: { message?: string }[] }).errors) {
      if (e.message) apiMessages.push(e.message);
    }
  }

  // HTTP-level failure
  if (!response.ok) {
    throw new AuthenticaError(response.status, apiMessages, rawBody);
  }

  // Application-level failure (HTTP 200 but success flag is false)
  if (!checkSuccess(body)) {
    const msg =
      (body as { message?: string }).message ?? "Authentica returned success=false";
    throw new AuthenticaError(response.status, [msg], rawBody);
  }

  return body as T;
}

// ─── E.164 validation ────────────────────────────────────────────────────────

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export function validateE164(phone: string): void {
  if (!E164_REGEX.test(phone)) {
    throw new Error(
      `Phone number "${phone}" is not valid E.164 format. ` +
        `Use the international format with country code, e.g. "+966551234567".`
    );
  }
}

// ─── Public API functions ────────────────────────────────────────────────────

export interface BalanceResult {
  balance: string; // the API returns this as a string, e.g. "91.00"
}

export async function checkBalance(): Promise<BalanceResult> {
  const result = await authenticaRequest<{
    success: boolean;
    data: { balance: string };
  }>(
    "/balance",
    { method: "GET" },
    (b) => (b as { success: boolean }).success === true
  );
  return result.data;
}

export type OtpMethod = "sms" | "whatsapp" | "email";

export interface SendOtpOptions {
  method: OtpMethod;
  /** Required for method sms or whatsapp. Must be E.164 format, e.g. "+966551234567". */
  phone?: string;
  /** Required for method email. */
  email?: string;
  /** Template ID. Defaults to 1. Configure additional templates in the Authentica portal. */
  templateId?: number;
}

export async function sendOtp(opts: SendOtpOptions): Promise<void> {
  if ((opts.method === "sms" || opts.method === "whatsapp") && opts.phone) {
    validateE164(opts.phone);
  }

  // send-otp uses the `success` key
  await authenticaRequest<{ success: boolean }>(
    "/send-otp",
    {
      method: "POST",
      body: JSON.stringify({
        method: opts.method,
        ...(opts.phone ? { phone: opts.phone } : {}),
        ...(opts.email ? { email: opts.email } : {}),
        template_id: opts.templateId ?? 1,
      }),
    },
    (b) => (b as { success: boolean }).success === true
  );
}

export interface VerifyOtpOptions {
  /** Required if OTP was sent via sms or whatsapp. */
  phone?: string;
  /** Required if OTP was sent via email. */
  email?: string;
  otp: string;
}

export interface VerifyOtpResult {
  verified: boolean;
  message: string;
}

export async function verifyOtp(opts: VerifyOtpOptions): Promise<VerifyOtpResult> {
  // verify-otp uses `status` (not `success`) — this is the #1 envelope gotcha.
  // A wrong OTP returns HTTP 422 with status:false; do not swallow that as a
  // network error. We distinguish "wrong OTP" (422 + status:false) from a real
  // API failure by catching AuthenticaError and re-checking the parsed body.
  try {
    const result = await authenticaRequest<{ status: boolean; message: string }>(
      "/verify-otp",
      {
        method: "POST",
        body: JSON.stringify({
          ...(opts.phone ? { phone: opts.phone } : {}),
          ...(opts.email ? { email: opts.email } : {}),
          otp: opts.otp,
        }),
      },
      (b) => (b as { status: boolean }).status === true
    );
    return { verified: true, message: result.message };
  } catch (err) {
    if (err instanceof AuthenticaError && err.status === 422) {
      // 422 = wrong/expired OTP — this is a normal user-facing outcome, not a crash
      return { verified: false, message: err.apiMessages[0] ?? "OTP verification failed" };
    }
    throw err;
  }
}

export interface FaceVerificationOptions {
  userId: string;
  /** Raw base64-encoded JPEG/PNG — no "data:image/..." prefix. Max tested: ~2MB per image. */
  registeredFaceImage: string;
  /** Raw base64-encoded JPEG/PNG — no "data:image/..." prefix. */
  queryFaceImage: string;
}

export interface BiometricResult {
  userId: string;
  matched: boolean;
}

export async function verifyByFace(opts: FaceVerificationOptions): Promise<BiometricResult> {
  // Face verification: success=true + data.result is the match flag.
  // Non-match or face-detection failure may return HTTP 422 with success:false
  // instead of 200 + result:false (observed in live testing, contrary to docs).
  // We treat that 422 case as "did not match" rather than a fatal error.
  try {
    const result = await authenticaRequest<{
      success: boolean;
      data: { user_id: string; result: boolean };
    }>(
      "/verify-by-face",
      {
        method: "POST",
        body: JSON.stringify({
          user_id: opts.userId,
          registered_face_image: opts.registeredFaceImage,
          query_face_image: opts.queryFaceImage,
        }),
      },
      (b) => (b as { success: boolean }).success === true
    );
    return { userId: result.data.user_id, matched: result.data.result };
  } catch (err) {
    if (err instanceof AuthenticaError && err.status === 422) {
      return { userId: opts.userId, matched: false };
    }
    throw err;
  }
}

export interface VoiceVerificationOptions {
  userId: string;
  /**
   * Raw base64-encoded WAV audio. WAV (PCM) is the confirmed working format.
   * M4A/AAC is NOT accepted — transcode first:
   *   ffmpeg -i input.m4a -ar 16000 -ac 1 -f wav output.wav
   */
  registeredAudio: string;
  /** Raw base64-encoded WAV audio. */
  queryAudio: string;
}

export async function verifyByVoice(opts: VoiceVerificationOptions): Promise<BiometricResult> {
  // Voice verification: same envelope as face — success:true + data.result.
  // Non-match returns HTTP 200 with result:false (unlike face, no 422 observed).
  const result = await authenticaRequest<{
    success: boolean;
    data: { user_id: string; result: boolean };
  }>(
    "/verify-by-voice",
    {
      method: "POST",
      body: JSON.stringify({
        user_id: opts.userId,
        registered_audio: opts.registeredAudio,
        query_audio: opts.queryAudio,
      }),
    },
    (b) => (b as { success: boolean }).success === true
  );
  return { userId: result.data.user_id, matched: result.data.result };
}
