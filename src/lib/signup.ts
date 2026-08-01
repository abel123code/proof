/**
 * Whether anyone with a Google account can sign in, or only allowlisted people.
 *
 * Added so judges can test without waiting to be approved. It is a flag rather than a
 * deletion for three reasons: merging the code changes nothing until the env var is set,
 * so the cutover is independent of the deploy; it flips back after judging with one env
 * change and no rebuild; and the allowlist, the access-request log and the existing users
 * all keep working untouched underneath.
 *
 * NEXT_PUBLIC_ because the login page needs it to stop saying "invite-only" while the
 * server needs it to decide admission. There is nothing secret about it: whether signup is
 * open is obvious from trying to sign up.
 *
 * IMPORTANT: this does NOT lift USER_CAP. Open signup without a ceiling would let a
 * stranger drain the OpenAI budget and the 1GB of Supabase storage. The cap stays as the
 * spend bound, and a user arriving past it gets the "early access is full" page.
 */
export function openSignupEnabled(raw: string | undefined = process.env.NEXT_PUBLIC_OPEN_SIGNUP): boolean {
  return raw === "true" || raw === "1";
}
