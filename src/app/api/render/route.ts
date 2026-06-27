import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// The Zo-hosted render service. Set RENDER_SERVICE_URL in the deployed env to the box's
// public URL; defaults to the local service for dev.
const RENDER_SERVICE_URL = process.env.RENDER_SERVICE_URL ?? "http://localhost:8080";

/** Kick off a render. Body: { captureId } OR { videoUrl, brief }. Returns { jobId }. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!body?.captureId && (!body?.videoUrl || !body?.brief)) {
      return NextResponse.json(
        { error: "Provide captureId, or both videoUrl and brief." },
        { status: 400 },
      );
    }
    const res = await fetch(`${RENDER_SERVICE_URL}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `render service unreachable: ${message}` },
      { status: 502 },
    );
  }
}

/** Poll a render job: GET /api/render?jobId=... -> { status, mp4Url?, error? }. */
export async function GET(req: Request) {
  try {
    const jobId = new URL(req.url).searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId query param required." }, { status: 400 });
    }
    const res = await fetch(`${RENDER_SERVICE_URL}/render/${encodeURIComponent(jobId)}`);
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `render service unreachable: ${message}` },
      { status: 502 },
    );
  }
}
