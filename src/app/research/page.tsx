import { Suspense } from "react";
import { StudioHeader } from "@/components/studio/studio-header";
import { ResearchPanel } from "@/components/studio/research-panel";

export default function ResearchPage() {
  return (
    <div className="flex flex-1 flex-col">
      <StudioHeader />
      <main className="flex-1">
        <Suspense>
          <ResearchPanel />
        </Suspense>
      </main>
    </div>
  );
}
