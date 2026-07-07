#!/usr/bin/env npx tsx
/**
 * Compare two face images using Authentica and print the match result.
 * Useful for confirming the face verification flow before wiring it into your app.
 *
 * Usage:
 *   AUTHENTICA_API_KEY=xxx npx tsx .claude/skills/authentica-face-verification/scripts/verify-face.ts \
 *     --registered path/to/reference.jpg \
 *     --query path/to/realtime.jpg \
 *     --user-id any-string
 *
 * Accepts JPEG or PNG. Raw base64 encoding — no data URI prefix needed.
 * Cost: 1 credit per call.
 */

import { readFileSync } from "fs";

const API_KEY = process.env.AUTHENTICA_API_KEY;

if (!API_KEY) {
  console.error("Error: AUTHENTICA_API_KEY is not set.");
  process.exit(1);
}

const args = process.argv.slice(2);
const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };

const registeredPath = get("--registered");
const queryPath = get("--query");
const userId = get("--user-id") ?? "script-test";

if (!registeredPath || !queryPath) {
  console.error("Usage: verify-face.ts --registered <path> --query <path> [--user-id <id>]");
  process.exit(1);
}

function readBase64(path: string): string {
  try {
    return readFileSync(path).toString("base64");
  } catch {
    console.error(`Error reading file: ${path}`);
    process.exit(1);
  }
}

async function main() {
  const registeredFaceImage = readBase64(registeredPath!);
  const queryFaceImage = readBase64(queryPath!);

  console.log(`Comparing faces (user_id: ${userId}) ...`);
  console.log(`  registered: ${registeredPath} (${Math.round(registeredFaceImage.length * 0.75 / 1024)} KB)`);
  console.log(`  query:      ${queryPath} (${Math.round(queryFaceImage.length * 0.75 / 1024)} KB)`);

  let res: Response;
  try {
    res = await fetch("https://api.authentica.sa/api/v2/verify-by-face", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Authorization": API_KEY! },
      body: JSON.stringify({ user_id: userId, registered_face_image: registeredFaceImage, query_face_image: queryFaceImage }),
    });
  } catch (err) {
    console.error("Network error:", err);
    process.exit(1);
  }

  const raw = await res.text();

  if (res.status === 401) {
    console.error("Error: API key rejected (401).");
    process.exit(1);
  }

  // 302 = bad input (wrong format, missing field)
  if (res.status === 302) {
    console.error("Error: request rejected by server (302 redirect — check image format/size).");
    process.exit(1);
  }

  let body: { success?: boolean; data?: { user_id?: string; result?: boolean }; message?: string };
  try { body = JSON.parse(raw); }
  catch { console.error(`Non-JSON response (HTTP ${res.status}):`, raw.slice(0, 200)); process.exit(1); }

  // 422 from face endpoint = non-match or face detection failure
  if (res.status === 422 || body.success === false) {
    console.log("Result: NO MATCH (or face not detected)");
    console.log("  API message:", body.message ?? "(none)");
    console.log("  Note: the API returns 422 for non-match; this is expected behaviour.");
    process.exit(0);
  }

  if (body.success && body.data?.result === true) {
    console.log("✓ Result: MATCH — same person");
  } else if (body.success && body.data?.result === false) {
    console.log("Result: NO MATCH");
  } else {
    console.error("Unexpected response:", JSON.stringify(body));
    process.exit(1);
  }
}

main();
