import Link from "next/link";
import { ProofMark } from "@/components/proof-mark";

export default function PendingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-md">
        <ProofMark className="mx-auto block size-10" />
        <h1 className="mt-6 font-display text-3xl leading-tight tracking-tight">
          You&apos;re on the list
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Proof is invite-only during early access and we&apos;re capped at 50 builders.
          Your account is pending approval — we&apos;ll email you the moment a spot opens
          up.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm text-foreground underline underline-offset-4"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
