import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import {
  assertBriefOwnedBy,
  getBriefAssetDescriptions,
  getBriefAssets,
  removeBrandAssetObjects,
  setBriefAssets,
} from "@/lib/db";
import { validateAssetUrls } from "@/lib/brand-assets";
import { describeAssets } from "@/lib/asset-caption";
import { describeImageUrl } from "@/lib/describe-image";

export const runtime = "nodejs";

// A brand colour lands straight in generated CSS (see render/), so it must be a strict
// hex triple and not free text - anything looser is a CSS-injection surface.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Save the screenshots/logos and accent colour a brief carries into its own scenes.
 * Body: { briefId, images: string[], brandColor? } -> { ok: true, images }.
 * Every image URL must already live in our own `brand-assets` bucket (see
 * createAssetUploadTicket / /api/assets/sign) - the render worker fetches whatever
 * URLs it's handed, so this is the last gate before that.
 */
export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const briefId: unknown = body?.briefId;
    const brandColor: unknown = body?.brandColor;

    if (typeof briefId !== "string") {
      return NextResponse.json({ error: "briefId is required" }, { status: 400 });
    }
    if (!(await assertBriefOwnedBy(briefId, auth.userId))) {
      return NextResponse.json({ error: "Not your brief." }, { status: 403 });
    }

    // An explicit empty array is a real "remove everything", not a malformed request. A brief
    // with no brand assets is a legitimate state, and without this the UI could only pretend to
    // delete: the row kept the image and /api/render, which reads assets from the brief, would
    // put it back in the next video. A MISSING images field is still a 400, so only a deliberate
    // empty array clears.
    if (Array.isArray(body?.images) && body.images.length === 0) {
      const previous = await getBriefAssets(briefId);
      const previousImages = Array.isArray(previous?.images) ? (previous.images as string[]) : [];
      await setBriefAssets(briefId, { images: [], imageDescriptions: {} });
      // After the row, so a storage failure cannot leave the brief pointing at objects that are
      // already gone. Best-effort: the user's intent is recorded either way.
      await removeBrandAssetObjects(previousImages).catch((err) =>
        console.error("brand asset cleanup failed:", err),
      );
      return NextResponse.json({ ok: true, images: [] });
    }

    const images = validateAssetUrls(body?.images, process.env.NEXT_PUBLIC_SUPABASE_URL, briefId);
    if (!images.ok) {
      return NextResponse.json({ error: images.error }, { status: 400 });
    }
    if (brandColor !== undefined && (typeof brandColor !== "string" || !HEX_COLOR.test(brandColor))) {
      return NextResponse.json({ error: "brandColor must be a 6-digit hex code" }, { status: 400 });
    }

    // Describe each image so the render planner knows what it actually has. Without this it
    // sees only UUID filenames, cannot tell whether an asset proves a given claim, and has
    // asked for visuals that were never uploaded. A caption failure is non-fatal: a missing
    // entry reads as "unknown", which keeps the planner conservative.
    const descriptions = await describeAssets(
      images.urls,
      { describe: describeImageUrl },
      await getBriefAssetDescriptions(briefId),
    );

    await setBriefAssets(briefId, {
      images: images.urls,
      brandColor: brandColor as string | undefined,
      imageDescriptions: descriptions,
    });
    return NextResponse.json({ ok: true, images: images.urls });
  } catch (err) {
    console.error("save brand assets failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
