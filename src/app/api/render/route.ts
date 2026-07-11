import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireApprovedUser } from "@/lib/auth";
import {
  assertBriefOwnedBy,
  getBriefById,
  refundCredits,
  saveBriefRender,
  spendCredits,
} from "@/lib/db";
import { CREDIT_COSTS } from "@/lib/pricing";

export const runtime = "nodejs";
export const maxDuration = 120;

// The Zo-hosted render service. Set RENDER_SERVICE_URL in the deployed env.
const RENDER_SERVICE_URL = process.env.RENDER_SERVICE_URL ?? "http://localhost:8080";
const RENDER_TOKEN = process.env.RENDER_TOKEN;
const FOOTAGE_BUCKET = "footage";

/**
 * Kick off a render. Body: { briefId, videoUrls: string[], brief }.
 * Forwards the clips + brief to the Zo service and records the job on the brief.
 */
export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
  // Service-role bypasses RLS, so confirm the caller owns this brief before rendering
  // it (and before spending anyone's credits).
  if (!(await assertBriefOwnedBy(briefId, auth.userId))) {
    return NextResponse.json({ error: "Not your brief." }, { status: 403 });
  }

  // Reserve credits before kicking off the render; refund if it never starts.
  const spend = await spendCredits(auth.userId, CREDIT_COSTS.render);
  if (!spend.ok) {
    return NextResponse.json(
      { error: "You're out of credits.", creditsRemaining: 0 },
      { status: 402 },
    );
  }

  try {
    // Send BOTH so it works regardless of whether the Zo box was redeployed:
    // - updated box prefers `videoUrls` and concatenates all clips
    // - old box ignores `videoUrls` and renders the single `videoUrl` (first clip)
    const res = await fetch(`${RENDER_SERVICE_URL}/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(RENDER_TOKEN ? { "x-render-token": RENDER_TOKEN } : {}),
      },
      body: JSON.stringify({ videoUrls, videoUrl: videoUrls[0], brief }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await refundCredits(auth.userId, CREDIT_COSTS.render).catch(() => {});
      return NextResponse.json(
        { error: data?.error ?? `render service returned ${res.status}` },
        { status: res.status },
      );
    }

    const jobId: string | undefined = data?.jobId;
    if (!jobId) {
      // Nothing was queued - don't charge for a no-op.
      await refundCredits(auth.userId, CREDIT_COSTS.render).catch(() => {});
      return NextResponse.json({ jobId: null, creditsRemaining: spend.remaining + CREDIT_COSTS.render });
    }
    await saveBriefRender(briefId, { jobId, status: "queued", url: "" }).catch(() => {});
    return NextResponse.json({ jobId, creditsRemaining: spend.remaining });
  } catch (err) {
    await refundCredits(auth.userId, CREDIT_COSTS.render).catch(() => {});
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
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");
    const briefId = searchParams.get("briefId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }
    if (briefId && !(await assertBriefOwnedBy(briefId, auth.userId))) {
      return NextResponse.json({ error: "Not your brief." }, { status: 403 });
    }

    // If we already persisted this brief's render, short-circuit.
    if (briefId) {
      const existing = await getBriefById(briefId).catch(() => null);
      if (existing?.renderUrl) {
        return NextResponse.json({ status: "done", url: existing.renderUrl });
      }
    }

    const res = await fetch(`${RENDER_SERVICE_URL}/render/${encodeURIComponent(jobId)}`, {
      headers: RENDER_TOKEN ? { "x-render-token": RENDER_TOKEN } : {},
    });
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
