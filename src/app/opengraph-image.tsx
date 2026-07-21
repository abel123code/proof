import { createSocialCard, socialImageSize } from "./social-card";

export const alt = "Proof, built with Codex and powered by OpenAI GPT-5.6";
export const size = socialImageSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createSocialCard();
}
