import { Suspense } from "react";
import { StudioHeader } from "@/components/studio/studio-header";
import { TrendsPanel } from "@/components/studio/trends-panel";

export default function TrendsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <StudioHeader />
      <main className="flex-1">
        <Suspense>
          <TrendsPanel />
        </Suspense>
      </main>
    </div>
  );
}
