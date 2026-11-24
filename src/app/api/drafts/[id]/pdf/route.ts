import type { NextRequest } from "next/server";
import type { CvDraft, LetterDraft } from "@/lib/draft-types";
import { renderCvPdf, renderLetterPdf } from "@/lib/pdf/documents";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * A draft as a PDF (Pipeline → Drafts → PDF). Read with the person's own session, so
 * row-level security limits it to their drafts; the photo comes from their private folder.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/drafts/[id]/pdf">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: draft } = await supabase.from("drafts").select("kind, language, content, job_id").eq("id", id).maybeSingle();
  if (!draft?.content) return new Response("Not found", { status: 404 });
  const [{ data: profile }, { data: job }] = await Promise.all([
    supabase.from("profile").select("*").single(),
    supabase.from("my_jobs").select("title, company").eq("id", draft.job_id).maybeSingle(),
  ]);
  if (!profile) return new Response("Not found", { status: 404 });
  const p = profile as Profile;

  let pdf: Buffer;
  if (draft.kind === "cv") {
    let photo: { data: Buffer; format: "jpg" | "png" } | null = null;
    if (p.cv_photo && p.photo_path) {
      const { data: blob } = await supabase.storage.from("photos").download(p.photo_path);
      if (blob) photo = { data: Buffer.from(await blob.arrayBuffer()), format: p.photo_path.endsWith(".png") ? "png" : "jpg" };
    }
    pdf = await renderCvPdf(draft.content as CvDraft, p, draft.language, photo);
  } else {
    pdf = await renderLetterPdf(draft.content as LetterDraft, p, draft.language, job?.company ?? "", job?.title ?? "");
  }

  // "Levente Varga – CV – Larian.pdf"; the ASCII fallback for older clients.
  const name = [p.full_name || "Draft", draft.kind === "cv" ? "CV" : "Cover letter", job?.company].filter(Boolean).join(" – ") + ".pdf";
  const ascii = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
