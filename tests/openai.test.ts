import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENAI_MINI_MODEL,
  DEFAULT_OPENAI_TEXT_MODEL,
  chatReasoningForModel,
  parseJSONLoose,
} from "@/lib/openai";

describe("OpenAI model roles", () => {
  it("maps premium and mechanical work to the requested GPT-5.6 tiers", () => {
    expect(DEFAULT_OPENAI_TEXT_MODEL).toBe("gpt-5.6-sol");
    expect(DEFAULT_OPENAI_MINI_MODEL).toBe("gpt-5.6-luna");
  });

  it("preserves no-reasoning behavior for the mechanical Chat Completions tier", () => {
    expect(chatReasoningForModel("gpt-5.6-luna", "gpt-5.6-luna")).toEqual({
      reasoning_effort: "none",
    });
    expect(chatReasoningForModel("gpt-5.6-sol", "gpt-5.6-luna")).toEqual({});
    expect(chatReasoningForModel("gpt-4o", "gpt-5.6-luna")).toEqual({});
  });
});

describe("parseJSONLoose", () => {
  it("parses plain JSON", () => {
    expect(parseJSONLoose('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  it("parses JSON wrapped in a ```json fence", () => {
    const raw = "```json\n{ \"ok\": true }\n```";
    expect(parseJSONLoose(raw)).toEqual({ ok: true });
  });

  it("parses JSON wrapped in a bare ``` fence", () => {
    const raw = "```\n[1, 2, 3]\n```";
    expect(parseJSONLoose(raw)).toEqual([1, 2, 3]);
  });

  it("extracts an object embedded in prose", () => {
    const raw = 'Sure! Here you go: {"topic":"x"} — hope that helps.';
    expect(parseJSONLoose(raw)).toEqual({ topic: "x" });
  });

  it("parses a top-level array", () => {
    expect(parseJSONLoose("[{\"n\":1}]")).toEqual([{ n: 1 }]);
  });

  it("throws on unparseable input", () => {
    expect(() => parseJSONLoose("no json here at all")).toThrow();
  });
});
