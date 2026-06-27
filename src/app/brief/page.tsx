import { Suspense } from "react";
import { StudioHeader } from "@/components/studio/studio-header";
import { BriefPanel } from "@/components/studio/brief-panel";

export default function BriefPage() {
  return (
    <div className="flex flex-1 flex-col">
      <StudioHeader />
      <main className="flex-1">
        <Suspense>
          <BriefPanel />
        </Suspense>
      </main>
    </div>
  );
}
