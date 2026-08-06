import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { assertBriefOwnedBy, setBriefAssets } from "@/lib/db";
import { validateAssetUrls } from "@/lib/brand-assets";

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

    const images = validateAssetUrls(body?.images, process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!images.ok) {
      return NextResponse.json({ error: images.error }, { status: 400 });
    }
    if (brandColor !== undefined && (typeof brandColor !== "string" || !HEX_COLOR.test(brandColor))) {
      return NextResponse.json({ error: "brandColor must be a 6-digit hex code" }, { status: 400 });
    }

    await setBriefAssets(briefId, {
      images: images.urls,
      brandColor: brandColor as string | undefined,
    });
    return NextResponse.json({ ok: true, images: images.urls });
  } catch (err) {
    console.error("save brand assets failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
