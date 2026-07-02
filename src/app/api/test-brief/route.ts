import { NextResponse } from "next/server";
import { createProject, saveBriefDoc } from "@/lib/db";
import type { BriefDoc } from "@/lib/types";

export const runtime = "nodejs";

// A single-scene brief used only to smoke-test the record -> upload -> Zo render
// path without running the full Connect/Trends/Clips pipeline. Hit via /brief?test=1.
const TEST_DOC: BriefDoc = {
  title: "Render pipeline test",
  hook: "Testing the Zo renderer end-to-end.",
  angle: "One scene: film it, send to editor, get a captioned cut back.",
  scenes: [
    {
      scene: 1,
      label: "Talk to camera",
      spokenLine:
        "Hey, I built Proof. It turns your boring GitHub repos into viral TikTok videos. This is a quick test of the render pipeline running end to end.",
      onScreenText: "Proof",
      brollCue: "Face to camera, upbeat energy.",
      durationSeconds: 12,
    },
  ],
  assumptions: [],
  sources: [],
};

export async function POST() {
  try {
    const project = await createProject({
      repoUrl: "https://github.com/test/render-smoke-test",
      name: "Render Test",
    });
    const brief = await saveBriefDoc({
      projectId: project.id,
      referenceVideoId: null,
      doc: TEST_DOC,
      gaps: [],
      answers: {},
    });
    return NextResponse.json({ briefId: brief.id, doc: TEST_DOC });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
