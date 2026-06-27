import { StudioHeader } from "@/components/studio/studio-header";
import { ProjectPanel } from "@/components/studio/project-panel";

export default function ConnectPage() {
  return (
    <div className="flex flex-1 flex-col">
      <StudioHeader />
      <main className="flex-1">
        <ProjectPanel />
      </main>
    </div>
  );
}
