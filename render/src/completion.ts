import { updateDurableJob } from "./durable.js";

interface CompletionDeps {
  updateDurable: (id: string, outputUrl: string) => Promise<void>;
  log: (message: string) => void;
}

const DEFAULT_DEPS: CompletionDeps = {
  updateDurable: (id, outputUrl) => updateDurableJob(id, "done", { outputUrl }),
  log: (message) => console.log(message),
};

/** Emit the operator marker only after the durable job is authoritatively complete. */
export async function markJobDone(
  id: string,
  outputUrl: string,
  deps: CompletionDeps = DEFAULT_DEPS,
): Promise<void> {
  await deps.updateDurable(id, outputUrl);
  deps.log(`DONE ${id}`);
}
