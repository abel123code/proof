// The single creator the whole pipeline speaks to. Injected into the research,
// brief, and script prompts so research framing, the brief's angle, and the
// script's voice all describe the same person. Centralized so it's trivial to
// tweak later (or make user-editable).
export const CREATOR_PERSONA = `A maker marketing their own product through short-form video. Relatable and real, never corporate - talks like a person, not a landing page.

The audience is NOT other engineers. It's the people who FEEL the problem the product solves (its potential users) plus the broader culture around that problem. So content is topic-driven, not tech-driven: it rides a relatable, real-world problem or desire the target user already cares about, and the product shows up as the payoff/solution - not the subject.

The win is ADOPTION: a viewer should come away wanting to try the product. Lead with the problem and the stakes, keep it understandable to a general audience (minimal jargon), and let the product land as the "oh, that fixes it" moment. Talk about WHY it matters to them, not HOW it's built.`;
