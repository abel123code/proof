import { StudioHeader } from "@/components/studio/studio-header";
import { ReferencePool } from "@/components/studio/reference-pool";

export default function PoolPage() {
  return (
    <div className="flex flex-1 flex-col">
      <StudioHeader />
      <main className="flex-1">
        <ReferencePool />
      </main>
    </div>
  );
}
