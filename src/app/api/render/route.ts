import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireApprovedUser } from "@/lib/auth";
import { canEdit, consumeEdit, getBriefById, saveBriefRender } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

// The Zo-hosted render service. Set RENDER_SERVICE_URL in the deployed env.
const RENDER_SERVICE_URL = process.env.RENDER_SERVICE_URL ?? "http://localhost:8080";
const FOOTAGE_BUCKET = "footage";

/**
 * Kick off a render. Body: { briefId, videoUrls: string[], brief }.
 * Forwards the clips + brief to the Zo service and records the job on the brief.
 */
export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Lifetime edit cap (default 3). Check before doing any work.
  const gate = await canEdit(auth.userId);
  if (!gate.ok) {
    return NextResponse.json(
      { error: `You've used all ${gate.cap} of your video edits.` },
      { status: 429 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const briefId: unknown = body?.briefId;
    const videoUrls: unknown = body?.videoUrls;
    const brief: unknown = body?.brief;

    if (typeof briefId !== "string") {
      return NextResponse.json({ error: "briefId is required" }, { status: 400 });
    }
    if (!Array.isArray(videoUrls) || videoUrls.length === 0 || !brief) {
      return NextResponse.json(
        { error: "videoUrls (non-empty) and brief are required" },
        { status: 400 },
      );
    }

    // Send BOTH so it works regardless of whether the Zo box was redeployed:
    // - updated box prefers `videoUrls` and concatenates all clips
    // - old box ignores `videoUrls` and renders the single `videoUrl` (first clip)
    const res = await fetch(`${RENDER_SERVICE_URL}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoUrls, videoUrl: videoUrls[0], brief }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error ?? `render service returned ${res.status}` },
        { status: res.status },
      );
    }

    const jobId: string | undefined = data?.jobId;
    if (jobId) {
      await saveBriefRender(briefId, { jobId, status: "queued", url: "" }).catch(() => {});
      // Count the edit once the job is accepted by the render service.
      await consumeEdit(auth.userId).catch(() => {});
    }
    return NextResponse.json({ jobId, editsRemaining: Math.max(0, gate.cap - gate.used - 1) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `render service unreachable: ${message}` },
      { status: 502 },
    );
  }
}

/**
 * Poll a render job: GET /api/render?jobId=...&briefId=...
 * When the job is done, the finished MP4 (served by the Zo box at /out) is downloaded
 * and re-uploaded to our Storage so it persists, then saved on the brief.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");
    const briefId = searchParams.get("briefId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    // If we already persisted this brief's render, short-circuit.
    if (briefId) {
      const existing = await getBriefById(briefId).catch(() => null);
      if (existing?.renderUrl) {
        return NextResponse.json({ status: "done", url: existing.renderUrl });
      }
    }

    const res = await fetch(`${RENDER_SERVICE_URL}/render/${encodeURIComponent(jobId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error ?? `render service returned ${res.status}` },
        { status: res.status },
      );
    }

    const status: string = data?.status ?? "unknown";

    if (status === "done") {
      const sourceUrl = `${RENDER_SERVICE_URL}/out/edited-${encodeURIComponent(jobId)}.mp4`;
      let persistedUrl: string | null = null;
      if (briefId) {
        try {
          persistedUrl = await persistRender(briefId, sourceUrl);
        } catch (e) {
          console.error("persistRender failed, falling back to Zo URL:", e);
          persistedUrl = sourceUrl;
        }
        await saveBriefRender(briefId, { status: "done", url: persistedUrl }).catch(() => {});
      }
      return NextResponse.json({ status: "done", url: persistedUrl ?? sourceUrl });
    }

    if (briefId) {
      await saveBriefRender(briefId, { status }).catch(() => {});
    }
    return NextResponse.json({ status, error: data?.error });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `render service unreachable: ${message}` },
      { status: 502 },
    );
  }
}

/** Download the finished MP4 from the Zo box and re-upload to our Storage. */
async function persistRender(briefId: string, sourceUrl: string): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`download edited.mp4 failed (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  const supabase = getSupabaseAdmin();
  const path = `renders/${briefId}.mp4`;
  const { error: upErr } = await supabase.storage
    .from(FOOTAGE_BUCKET)
    .upload(path, bytes, { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error(`upload edited.mp4 failed: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(FOOTAGE_BUCKET).getPublicUrl(path);
  return `${pub.publicUrl}?v=${Date.now()}`;
}
