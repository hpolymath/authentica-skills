#!/usr/bin/env npx tsx
/**
 * Verify your Authentica API key and print your credit balance.
 *
 * Usage:
 *   AUTHENTICA_API_KEY=xxx npx tsx .claude/skills/authentica-core/scripts/check-balance.ts
 *
 * Or if AUTHENTICA_API_KEY is already in your .env.local:
 *   npx dotenv -e .env.local -- npx tsx .claude/skills/authentica-core/scripts/check-balance.ts
 */

const API_KEY = process.env.AUTHENTICA_API_KEY;

if (!API_KEY) {
  console.error("Error: AUTHENTICA_API_KEY is not set.");
  console.error("  Run: AUTHENTICA_API_KEY=your_key npx tsx <path-to-this-file>");
  process.exit(1);
}

async function main() {
  let res: Response;
  try {
    res = await fetch("https://api.authentica.sa/api/v2/balance", {
      headers: { "X-Authorization": API_KEY! },
    });
  } catch (err) {
    console.error("Network error:", err);
    process.exit(1);
  }

  const raw = await res.text();

  if (res.status === 401) {
    console.error("Error: API key rejected (401 Unauthorized).");
    console.error("  Check the value of AUTHENTICA_API_KEY.");
    process.exit(1);
  }

  let body: { success?: boolean; data?: { balance?: string }; message?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    console.error(`Non-JSON response (HTTP ${res.status}):`, raw.slice(0, 200));
    process.exit(1);
  }

  if (!body.success || !body.data?.balance) {
    console.error("Unexpected response:", JSON.stringify(body));
    process.exit(1);
  }

  console.log(`✓ API key valid`);
  console.log(`  Balance: ${body.data.balance} credits`);
}

main();
