import { getSupabaseAdmin } from "@/lib/supabase";
import type {
  Brief,
  ContentBrief,
  Project,
  ProjectUnderstanding,
  ReferenceAnalysisStatus,
  ReferenceStructure,
  ReferenceVideo,
} from "@/lib/types";
import type { ScrapedClip } from "@/lib/apify";

// ---- row shapes (snake_case as stored) ----
interface ProjectRow {
  id: string;
  repo_url: string;
  name: string;
  understanding: ProjectUnderstanding | null;
  created_at: string;
}

interface ReferenceVideoRow {
  id: string;
  url: string;
  download_url: string | null;
  author: string | null;
  caption: string | null;
  views: number | null;
  likes: number | null;
  matched_query: string | null;
  status: ReferenceAnalysisStatus;
  structure: ReferenceStructure | null;
  created_at: string;
}

interface BriefRow {
  id: string;
  project_id: string;
  reference_video_id: string | null;
  content: ContentBrief | null;
  created_at: string;
}

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id,
    repoUrl: r.repo_url,
    name: r.name,
    understanding: r.understanding,
    createdAt: r.created_at,
  };
}

function mapReferenceVideo(r: ReferenceVideoRow): ReferenceVideo {
  return {
    id: r.id,
    url: r.url,
    downloadUrl: r.download_url,
    author: r.author,
    caption: r.caption,
    views: r.views,
    likes: r.likes,
    matchedQuery: r.matched_query,
    status: r.status,
    structure: r.structure,
    createdAt: r.created_at,
  };
}

function mapBrief(r: BriefRow): Brief {
  return {
    id: r.id,
    projectId: r.project_id,
    referenceVideoId: r.reference_video_id,
    content: r.content,
    createdAt: r.created_at,
  };
}

// ---- projects ----

export async function createProject(input: {
  repoUrl: string;
  name: string;
  understanding?: ProjectUnderstanding | null;
}): Promise<Project> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      repo_url: input.repoUrl,
      name: input.name,
      understanding: input.understanding ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`createProject failed: ${error.message}`);
  return mapProject(data as ProjectRow);
}

export async function listProjects(): Promise<Project[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("projects")
    .select()
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listProjects failed: ${error.message}`);
  return (data as ProjectRow[]).map(mapProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("projects")
    .select()
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getProject failed: ${error.message}`);
  return data ? mapProject(data as ProjectRow) : null;
}

// ---- reference videos ----

/** Upsert scraped clips (dedupe on url). Used by the seed script. */
export async function upsertReferenceVideos(
  clips: (ScrapedClip & { matchedQuery: string })[],
): Promise<number> {
  if (clips.length === 0) return 0;
  const supabase = getSupabaseAdmin();
  const rows = clips.map((c) => ({
    url: c.url,
    download_url: c.downloadUrl,
    author: c.author,
    caption: c.caption,
    views: c.views,
    likes: c.likes,
    matched_query: c.matchedQuery,
    status: "pending" as ReferenceAnalysisStatus,
  }));
  const { data, error } = await supabase
    .from("reference_videos")
    .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`upsertReferenceVideos failed: ${error.message}`);
  return data?.length ?? 0;
}

export async function listReferenceVideos(): Promise<ReferenceVideo[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("reference_videos")
    .select()
    .order("views", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`listReferenceVideos failed: ${error.message}`);
  return (data as ReferenceVideoRow[]).map(mapReferenceVideo);
}

export async function getReferenceVideo(id: string): Promise<ReferenceVideo | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("reference_videos")
    .select()
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getReferenceVideo failed: ${error.message}`);
  return data ? mapReferenceVideo(data as ReferenceVideoRow) : null;
}

export async function setReferenceStatus(
  id: string,
  status: ReferenceAnalysisStatus,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("reference_videos")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(`setReferenceStatus failed: ${error.message}`);
}

export async function deleteReferenceVideos(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("reference_videos").delete().in("id", ids);
  if (error) throw new Error(`deleteReferenceVideos failed: ${error.message}`);
  return ids.length;
}

export async function saveReferenceStructure(
  id: string,
  structure: ReferenceStructure,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("reference_videos")
    .update({ structure, status: "analyzed" as ReferenceAnalysisStatus })
    .eq("id", id);
  if (error) throw new Error(`saveReferenceStructure failed: ${error.message}`);
}

// ---- briefs ----

export async function createBrief(input: {
  projectId: string;
  referenceVideoId: string | null;
  content: ContentBrief;
}): Promise<Brief> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("briefs")
    .insert({
      project_id: input.projectId,
      reference_video_id: input.referenceVideoId,
      content: input.content,
    })
    .select()
    .single();
  if (error) throw new Error(`createBrief failed: ${error.message}`);
  return mapBrief(data as BriefRow);
}

export async function listBriefs(): Promise<Brief[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("briefs")
    .select()
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listBriefs failed: ${error.message}`);
  return (data as BriefRow[]).map(mapBrief);
}
