import { Suspense } from "react";
import { StudioHeader } from "@/components/studio/studio-header";
import { ClipsPanel } from "@/components/studio/clips-panel";

export default function ClipsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <StudioHeader />
      <main className="flex-1">
        <Suspense>
          <ClipsPanel />
        </Suspense>
      </main>
    </div>
  );
}
