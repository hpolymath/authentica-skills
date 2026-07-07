#!/usr/bin/env npx tsx
/**
 * Send a real OTP and interactively verify the code you receive.
 * Confirms the full OTP flow before wiring it into your app.
 *
 * Usage (SMS):
 *   AUTHENTICA_API_KEY=xxx npx tsx .claude/skills/authentica-otp/scripts/send-test-otp.ts \
 *     --method sms --phone +966551234567
 *
 * Usage (email):
 *   AUTHENTICA_API_KEY=xxx npx tsx .claude/skills/authentica-otp/scripts/send-test-otp.ts \
 *     --method email --email you@example.com
 *
 * Cost: 1 credit per send. Verify is free.
 */

import * as readline from "readline";

const API_KEY = process.env.AUTHENTICA_API_KEY;
const BASE = "https://api.authentica.sa/api/v2";

if (!API_KEY) {
  console.error("Error: AUTHENTICA_API_KEY is not set.");
  process.exit(1);
}

const args = process.argv.slice(2);
const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };

const method = (get("--method") ?? "sms") as "sms" | "whatsapp" | "email";
const phone = get("--phone");
const email = get("--email");

if ((method === "sms" || method === "whatsapp") && !phone) {
  console.error(`Error: --phone is required for method "${method}"`);
  process.exit(1);
}
if (method === "email" && !email) {
  console.error("Error: --email is required for method email");
  process.exit(1);
}
if (phone && !/^\+[1-9]\d{1,14}$/.test(phone)) {
  console.error(`Error: "${phone}" is not valid E.164 format (e.g. +966551234567)`);
  process.exit(1);
}

async function apiPost(path: string, body: object) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Authorization": API_KEY! },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  try { return { status: res.status, body: JSON.parse(raw) }; }
  catch { return { status: res.status, body: raw }; }
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  const destination = phone ?? email;
  console.log(`Sending OTP via ${method} to ${destination} ...`);

  const sendBody: Record<string, unknown> = { method, template_id: 1 };
  if (phone) sendBody.phone = phone;
  if (email) sendBody.email = email;

  const sent = await apiPost("/send-otp", sendBody);

  if (sent.status !== 200 || (typeof sent.body === "object" && !sent.body.success)) {
    console.error("Send failed:", JSON.stringify(sent.body));
    process.exit(1);
  }
  console.log("✓ OTP sent:", sent.body.message ?? "success");

  const otp = await prompt("Enter the code you received: ");
  if (!otp) { console.error("No code entered."); process.exit(1); }

  const verifyBody: Record<string, unknown> = { otp };
  if (phone) verifyBody.phone = phone;
  if (email) verifyBody.email = email;

  const verified = await apiPost("/verify-otp", verifyBody);

  // verify-otp uses `status`, not `success` — different envelope from send-otp
  if (verified.status === 200 && typeof verified.body === "object" && verified.body.status === true) {
    console.log("✓ Code verified — OTP flow is working end-to-end.");
  } else {
    console.error("Verification failed:", JSON.stringify(verified.body));
    console.error("  (If the code expired, re-run and enter it faster.)");
    process.exit(1);
  }
}

main();
