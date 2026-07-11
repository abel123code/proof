// Credit economy for the free tier. One lifetime balance per user; each paid
// action deducts a tuned amount roughly proportional to its real API cost.
// Everything is env-overridable so the economy can be retuned without a deploy.
//
// Rough guide at the defaults below: a from-scratch video costs ~200 credits
// (repo 5 + research 40 + angles 60 + brief 15 + render 80) and ~$0.32 of OpenAI,
// so 1000 credits is ~5 videos ≈ ~$1.5 of OpenAI spend per user. Exploring an
// extra angle on an already-researched repo is 60 credits.
// (That "~5 videos" assumes repo/research are cached after the first run.)

export const STARTING_CREDITS = Number(process.env.FREE_CREDITS ?? 1000);

export const CREDIT_COSTS = {
  /** Repo understanding (cheap tier). Charged only on a real analysis. */
  repoAnalysis: Number(process.env.CREDIT_REPO ?? 5),
  /** Topic research web-search run. Charged only when topics are freshly fetched. */
  research: Number(process.env.CREDIT_RESEARCH ?? 40),
  /** Reference mining + premium angle scoring. Charged on a cache miss. */
  angles: Number(process.env.CREDIT_ANGLES ?? 60),
  /** Brief draft (cheap tier). */
  brief: Number(process.env.CREDIT_BRIEF ?? 15),
  /** Video render (the most expensive action). */
  render: Number(process.env.CREDIT_RENDER ?? 80),
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;
