import "dotenv/config";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}

const client = new OpenAI({ apiKey, timeout: 90_000, maxRetries: 1 });

async function verifyLunaJson() {
  const response = await client.chat.completions.create({
    model: "gpt-5.6-luna",
    reasoning_effort: "none",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: 'Return only JSON: {"ok":true}' }],
  });

  const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
  if (parsed.ok !== true) throw new Error("Luna returned unexpected JSON");
  console.log("[pass] GPT-5.6 Luna JSON with reasoning_effort=none");
}

async function verifySolJson() {
  const response = await client.chat.completions.create({
    model: "gpt-5.6-sol",
    reasoning_effort: "low",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: 'Return only JSON: {"ok":true}' }],
  });

  const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
  if (parsed.ok !== true) throw new Error("Sol returned unexpected JSON");
  console.log("[pass] GPT-5.6 Sol JSON with reasoning_effort=low");
}

async function verifySolWebSearch() {
  const response = await client.responses.create({
    model: "gpt-5.6-sol",
    reasoning: { effort: "low" },
    tools: [{ type: "web_search" }],
    input: "Find the official OpenAI developer documentation homepage. Return its URL only.",
  });

  if (!response.output_text?.includes("openai.com")) {
    throw new Error("Sol web search returned no OpenAI URL");
  }
  console.log("[pass] GPT-5.6 Sol Responses web_search");
}

try {
  await verifyLunaJson();
  await verifySolJson();
  await verifySolWebSearch();
  console.log("OpenAI integration verified.");
} catch (error) {
  console.error("OpenAI integration verification failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
