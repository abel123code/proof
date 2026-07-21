import { ImageResponse } from "next/og";

export const socialImageSize = { width: 1200, height: 630 };

export function createSocialCard() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#101014",
          color: "#f6f0e8",
          padding: "62px 72px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 58,
                height: 58,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 16,
                background: "#ef543d",
                color: "#101014",
                fontSize: 34,
                fontWeight: 800,
              }}
            >
              P
            </div>
            <span style={{ fontSize: 26, fontWeight: 700 }}>Proof</span>
          </div>
          <span style={{ color: "#ef543d", fontSize: 22 }}>tryproof.org</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ color: "#ef543d", fontSize: 22, letterSpacing: 3 }}>
            Built with Codex · Powered by OpenAI GPT-5.6
          </div>
          <div style={{ maxWidth: 970, fontSize: 68, lineHeight: 1.02, fontWeight: 750 }}>
            Turn your GitHub work into a product video people watch.
          </div>
        </div>

        <div style={{ display: "flex", gap: 18, color: "#aaa1b3", fontSize: 22 }}>
          <span>research</span>
          <span>→</span>
          <span>brief</span>
          <span>→</span>
          <span>Whisper cuts</span>
          <span>→</span>
          <span>motion graphics</span>
          <span>→</span>
          <span>Sol vision QA</span>
        </div>
      </div>
    ),
    socialImageSize,
  );
}
