#!/usr/bin/env npx tsx
/**
 * Compare two voice recordings using Authentica and print the match result.
 * Useful for confirming the voice verification flow before wiring it into your app.
 *
 * Usage:
 *   AUTHENTICA_API_KEY=xxx npx tsx .claude/skills/authentica-voice-verification/scripts/verify-voice.ts \
 *     --registered path/to/reference.wav \
 *     --query path/to/realtime.wav \
 *     --user-id any-string
 *
 * IMPORTANT: WAV format only. M4A/AAC is rejected by the API.
 * To convert: ffmpeg -i input.m4a -ar 16000 -ac 1 -f wav output.wav
 *
 * Cost: 1 credit per call.
 */

import { readFileSync } from "fs";
import { extname } from "path";

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
  console.error("Usage: verify-voice.ts --registered <path.wav> --query <path.wav> [--user-id <id>]");
  process.exit(1);
}

for (const p of [registeredPath!, queryPath!]) {
  if (extname(p).toLowerCase() !== ".wav") {
    console.error(`Error: "${p}" is not a .wav file.`);
    console.error("  Convert with: ffmpeg -i input.m4a -ar 16000 -ac 1 -f wav output.wav");
    process.exit(1);
  }
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
  const registeredAudio = readBase64(registeredPath!);
  const queryAudio = readBase64(queryPath!);

  console.log(`Comparing voices (user_id: ${userId}) ...`);
  console.log(`  registered: ${registeredPath} (${Math.round(registeredAudio.length * 0.75 / 1024)} KB)`);
  console.log(`  query:      ${queryPath} (${Math.round(queryAudio.length * 0.75 / 1024)} KB)`);

  let res: Response;
  try {
    res = await fetch("https://api.authentica.sa/api/v2/verify-by-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Authorization": API_KEY! },
      body: JSON.stringify({ user_id: userId, registered_audio: registeredAudio, query_audio: queryAudio }),
    });
  } catch (err) {
    // A TypeError here almost certainly means the server returned a redirect
    // (302 = bad input, e.g. wrong audio format)
    console.error("Request failed:", err);
    console.error("  If this is a redirect error, the audio format is likely wrong.");
    console.error("  Ensure files are WAV (PCM). Convert: ffmpeg -i input.m4a -ar 16000 -ac 1 -f wav out.wav");
    process.exit(1);
  }

  const raw = await res.text();

  if (res.status === 401) { console.error("Error: API key rejected (401)."); process.exit(1); }
  if (res.status === 302) {
    console.error("Error: request rejected (302 redirect) — almost certainly wrong audio format.");
    console.error("  WAV is the only confirmed working format. M4A is NOT accepted.");
    process.exit(1);
  }

  let body: { success?: boolean; data?: { user_id?: string; result?: boolean }; message?: string };
  try { body = JSON.parse(raw); }
  catch { console.error(`Non-JSON response (HTTP ${res.status}):`, raw.slice(0, 200)); process.exit(1); }

  if (!body.success) {
    console.error("API error:", JSON.stringify(body));
    process.exit(1);
  }

  if (body.data?.result === true) {
    console.log("✓ Result: MATCH — same speaker");
  } else {
    console.log("Result: NO MATCH");
  }
}

main();
