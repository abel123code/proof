/**
 * "A few minutes" set the wrong expectation: a real render measured 8 minutes end to end, so
 * people assumed it had hung and re-ran it, paying twice. Naming the number is the cheapest fix.
 */
export function renderConfirmationDescription(cost: number): string {
  return `Your footage will be sent to the editor for ${cost} credits. This usually takes about 8 minutes, and the credits are charged when the job starts.`;
}
