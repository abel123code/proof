import "dotenv/config";
import OpenAI from "openai";
import Exa from "exa-js";

const MODEL = "gpt-5.5";

async function testOpenAI() {
  const c = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const r = await c.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: 'Return JSON {"ok": true}.' }],
    });
    console.log(`[openai] ${MODEL} OK ->`, r.choices[0].message.content);
    return true;
  } catch (e) {
    console.log(`[openai] ${MODEL} FAILED ->`, e.status, e.message);
    return false;
  }
}

async function testExa() {
  const exa = new Exa(process.env.EXA_API_KEY);
  const schema = {
    type: "object",
    properties: {
      trends: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            topic: { type: "string" },
            whyTrending: { type: "string" },
            whereDiscussed: { type: "string" },
            sourceUrls: { type: "array", maxItems: 3, items: { type: "string", format: "uri" } },
            suggestedAngle: { type: "string" },
          },
          required: ["topic", "whyTrending", "whereDiscussed", "sourceUrls", "suggestedAngle"],
        },
      },
    },
    required: ["trends"],
  };
  try {
    const created = await exa.agent.runs.create({
      query:
        "Find 2-3 topics the web-dev / indie-maker community is discussing this week. For each: topic, whyTrending, whereDiscussed, 1-3 real sourceUrls, and a one-line suggestedAngle.",
      outputSchema: schema,
      effort: "low",
    });
    console.log("[exa] run created:", created.id, "status:", created.status);
    const run = await exa.agent.runs.pollUntilFinished(created.id, { pollInterval: 4000, timeoutMs: 240000 });
    console.log("[exa] final status:", run.status);
    const structured = run.output?.structured;
    const trends = structured?.trends ?? [];
    console.log("[exa] trends:", trends.length);
    for (const t of trends) {
      console.log("  -", t.topic, "| sources:", (t.sourceUrls || []).join(", "));
    }
    return run.status === "completed" && trends.length > 0;
  } catch (e) {
    console.log("[exa] FAILED ->", e.status, e.message);
    return false;
  }
}

const which = process.argv[2] ?? "all";
let ok = true;
if (which === "openai" || which === "all") ok = (await testOpenAI()) && ok;
if (which === "exa" || which === "all") ok = (await testExa()) && ok;
process.exit(ok ? 0 : 1);
