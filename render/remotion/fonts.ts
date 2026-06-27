import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// Only the weights we actually use + latin subset — keeps font fetches small and fast.
export const { fontFamily } = loadInter("normal", {
  weights: ["600", "700"],
  subsets: ["latin"],
});
export const { fontFamily: monoFamily } = loadMono("normal", {
  weights: ["600"],
  subsets: ["latin"],
});
