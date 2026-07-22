import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  FiArchive,
  FiArrowLeft,
  FiArrowRight,
  FiCheck,
  FiChevronDown,
  FiClock,
  FiCompass,
  FiCopy,
  FiEdit3,
  FiExternalLink,
  FiFileText,
  FiGrid,
  FiMoreHorizontal,
  FiPlus,
  FiRefreshCw,
  FiSearch,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import "./styles.css";
import "./dashboard.css";
import "./toast.css";
import { supabase, supabaseConfigured } from "./lib/supabase";

type Screen =
  | "dashboard"
  | "articles"
  | "discover"
  | "detail"
  | "archive";
type Toast = { message: string; kind: "success" | "error" };
type Notify = (message: string, kind?: Toast["kind"]) => void;
type Story = {
  id: string;
  title: string;
  createdAt: string | null;
  overview: string;
  category: string;
  score: number;
  url?: string;
  type: string;
  status: "New" | "Sent to Sheets" | "Generated" | "Approved" | "Posted" | "Archived";
  generationIdentifier?: string | null;
  generationSheetRow?: number | null;
  featuredImage?: string | null;
  featuredImageFallback?: string | null;
};
type Concept = { id?: string; summary?: string; post_type?: string; panel_count?: number; image_summary?: Record<string, any>; detailed_prompt?: string; caption?: string; hashtags?: string[]; assets?: Array<{ storage_path: string; sequence: number }> };
type TrendingTopic = { title: string; platform: string; summary: string; suggested_content: string; source_url?: string };

function conceptFromArticle(row: any) {
  const relation = row?.post_concepts;
  return Array.isArray(relation) ? relation[0] : relation;
}

const APP_VERSION = __APP_VERSION__;
const APP_LAST_UPDATED = __APP_UPDATED_AT__;

function driveFileIdFromUrl(value: unknown) {
  const url = String(value ?? "");
  return url.match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1]
    ?? url.match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1]
    ?? url.match(/\/d\/([A-Za-z0-9_-]+)(?:[=/?]|$)/)?.[1]
    ?? null;
}

function displayImageUrl(value: unknown) {
  const url = String(value ?? "").trim();
  const fileId = driveFileIdFromUrl(url);
  return fileId ? `/api/image?fileId=${encodeURIComponent(fileId)}` : url;
}

function directImageFallback(value: unknown) {
  const url = String(value ?? "").trim();
  const fileId = driveFileIdFromUrl(url);
  return fileId ? `https://lh3.googleusercontent.com/d/${fileId}=w2000` : url;
}

function storyFromRow(row: any, featuredImageOverride?: string | null): Story {
  const postConcept = conceptFromArticle(row);
  const imageSummary = postConcept?.image_summary ?? {};
  const embeddedImage = Array.isArray(imageSummary.embedded_images) ? imageSummary.embedded_images.find(Boolean) : null;
  const sheetImage = Array.isArray(imageSummary.sheet_images) ? imageSummary.sheet_images.find(Boolean) : null;
  const isTextOverview = imageSummary.origin === "text_overview";
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at ?? null,
    generationIdentifier: row.generation_identifier ?? null,
    generationSheetRow: row.generation_sheet_row ?? null,
    url: isTextOverview ? "" : row.source_url ?? row.canonical_url ?? "",
    overview: postConcept?.summary ?? "",
    category: row.category ?? "Uncategorized",
    score: row.rank ?? 0,
    type: postConcept?.post_type ?? "carousel",
    featuredImage: featuredImageOverride || embeddedImage || (sheetImage ? displayImageUrl(sheetImage) : null),
    featuredImageFallback: sheetImage ? directImageFallback(sheetImage) : null,
    status: (row.status === "discarded" ? "Archived" : row.status === "sent_to_sheets" ? "Sent to Sheets" : row.status === "generated" ? "Generated" : row.status === "approved_to_post" ? "Approved" : row.status === "posted" ? "Posted" : "New") as Story["status"],
  };
}

function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [items, setItems] = useState<Story[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [articleStatusFilter, setArticleStatusFilter] = useState<"all" | Story["status"]>("all");
  const [searching, setSearching] = useState(false);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [userId, setUserId] = useState<string | null>(null);
  const normalizingIdentifiers = useRef(false);
  const syncingGeneratedContent = useRef(false);
  const active = items.find((i) => i.id === selected) ?? items[0];
  const proposed = items.filter((i) => i.status !== "Archived");
  const detailNavigationItems = items.filter((item) => item.status !== "Archived" && (articleStatusFilter === "all" || item.status === articleStatusFilter));
  const hydrateConceptImages = async (data: any): Promise<Concept | null> => {
    if (!data) return null;
    const assets = (data.assets ?? []).filter((asset: any) => asset?.storage_path).sort((a: any, b: any) => a.sequence - b.sequence);
    const client = supabase;
    if (!assets.length || !client) return data as Concept;
    const signed = await Promise.all(assets.map(async (asset: any) => {
      const { data: link } = await client.storage.from("post-assets").createSignedUrl(asset.storage_path, 60 * 60);
      return link?.signedUrl;
    }));
    return { ...data, image_summary: { ...(data.image_summary ?? {}), rendered_images: signed.filter(Boolean) } } as Concept;
  };
  const loadStories = async () => {
    if (!supabase) return [] as Story[];
    const { data, error } = await supabase
      .from("articles")
      .select("id,title,created_at,generation_identifier,generation_sheet_row,source_url,canonical_url,category,rank,status,post_concepts(id,post_type,summary,image_summary)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Couldn’t load your queue: ${error.message}`);
    const conceptIds = (data ?? []).map((row: any) => conceptFromArticle(row)?.id).filter(Boolean);
    const firstAssetByConcept = new Map<string, string>();
    if (conceptIds.length) {
      const { data: assets } = await supabase
        .from("assets")
        .select("concept_id,storage_path,sequence")
        .in("concept_id", conceptIds)
        .eq("is_active", true)
        .order("sequence", { ascending: true });
      for (const asset of assets ?? []) {
        if (!asset.storage_path || firstAssetByConcept.has(asset.concept_id)) continue;
        const { data: link } = await supabase.storage.from("post-assets").createSignedUrl(asset.storage_path, 60 * 60);
        if (link?.signedUrl) firstAssetByConcept.set(asset.concept_id, link.signedUrl);
      }
    }
    const saved: Story[] = (data ?? []).map((row: any) => {
      const conceptId = conceptFromArticle(row)?.id;
      return storyFromRow(row, conceptId ? firstAssetByConcept.get(conceptId) : null);
    });
    setItems(saved);
    setSelected((current) => current && saved.some((story) => story.id === current) ? current : saved[0]?.id ?? "");
    return saved;
  };
  const loadConcept = async (articleId: string) => {
    if (!supabase || !articleId) return;
    const client = supabase;
    const { data, error } = await client.from("post_concepts").select("id,summary,post_type,panel_count,image_summary,detailed_prompt,caption,hashtags").eq("article_id", articleId).maybeSingle();
    if (error || !data) {
      setConcept(null);
      if (error) notify(`Couldn’t load generation suggestions: ${error.message}`);
      return;
    }
    const { data: assets } = await client.from("assets").select("storage_path,sequence").eq("concept_id", data.id).eq("is_active", true).order("sequence");
    setConcept(await hydrateConceptImages({ ...data, assets: assets ?? [] }));
  };
  const notify: Notify = (message, kind = "success") => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast({ message, kind });
    if (kind === "success") toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      setAuthReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!supabase || !userId) return;
    void loadStories().catch((error) => notify(error instanceof Error ? error.message : "Couldn’t load your queue."));
  }, [userId]);
  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    const refreshFromDatabase = () => {
      if (document.visibilityState === "hidden") return;
      void loadStories().catch((error) => notify(error instanceof Error ? error.message : "Couldn’t refresh your queue."));
    };
    const channel = client
      .channel(`articles-status-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "articles", filter: `user_id=eq.${userId}` }, refreshFromDatabase)
      .subscribe();
    window.addEventListener("focus", refreshFromDatabase);
    document.addEventListener("visibilitychange", refreshFromDatabase);
    return () => {
      window.removeEventListener("focus", refreshFromDatabase);
      document.removeEventListener("visibilitychange", refreshFromDatabase);
      void client.removeChannel(channel);
    };
  }, [userId]);
  useEffect(() => { void loadConcept(selected); }, [selected]);
  useEffect(() => {
    // A reload must not perform a write to Google Sheets when every record that
    // has reached the generation workflow already has its durable numeric ID.
    // Sending a new record still assigns its ID in the send endpoint; this is
    // only a one-time repair path for legacy/incomplete records.
    const needsIdentifierRepair = items.some((item) =>
      item.status !== "New" && item.status !== "Archived" && !/^\d+$/.test(String(item.generationIdentifier ?? "").trim()),
    );
    if (!supabase || !userId || !needsIdentifierRepair || normalizingIdentifiers.current) return;
    const client = supabase;
    normalizingIdentifiers.current = true;
    void client.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const response = await fetch("/api/normalize-identifiers", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) {
        // This is a background repair. Do not interrupt the user on reload;
        // generation actions surface their own precise Google Sheets errors.
        await response.json().catch(() => null);
        return;
      }
      const result = await response.json();
      if (result.changed) {
        notify("Identifiers were synchronized to one sequential sequence.");
        const { data: rows } = await client.from("articles").select("id,generation_identifier,generation_sheet_row").eq("user_id", userId);
        if (rows) setItems((current) => current.map((item) => {
          const refreshed = rows.find((row: any) => row.id === item.id);
          return refreshed ? { ...item, generationIdentifier: refreshed.generation_identifier, generationSheetRow: refreshed.generation_sheet_row } : item;
        }));
      }
    });
  }, [userId, items]);
  const updateStatus = async (id: string, status: "discarded" | "new" | "sent_to_sheets" | "generated" | "approved_to_post" | "posted") => {
    if (!supabase) return;
    const { error } = await supabase.from("articles").update({ status }).eq("id", id);
    if (error) throw new Error(`Couldn’t save change: ${error.message}`);
  };
  const setArticleStatus = async (id: string, status: Story["status"]) => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    const response = await fetch("/api/update-sheet-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ articleId: id, status }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Couldn’t update the status.");
    setItems((old) => old.map((item) => item.id === id ? { ...item, status } : item));
    if (id === selected) await loadConcept(id);
  };
  const saveDetail = async (articleId: string, values: { title: string; url: string; score: number; postType: string; panelCount: number; setting: string; content: string; caption: string; prompt: string; hashtags: string; summary: string }) => {
    if (!supabase) return;
    const articleUpdate = await supabase.from("articles").update({ title: values.title, source_url: values.url, canonical_url: values.url, rank: values.score }).eq("id", articleId);
    if (articleUpdate.error) throw new Error(articleUpdate.error.message);
    const hashtags = normalizeHashtags(values.hashtags);
    const conceptUpdate = await supabase.from("post_concepts").update({ summary: values.summary, post_type: values.postType, panel_count: values.panelCount, image_summary: { ...(concept?.image_summary ?? {}), setting: values.setting, content: values.content }, detailed_prompt: values.prompt, caption: values.caption, hashtags }).eq("article_id", articleId);
    if (conceptUpdate.error) throw new Error(conceptUpdate.error.message);
    setItems((old) => old.map((item) => item.id === articleId ? { ...item, title: values.title, url: values.url, score: values.score, type: values.postType } : item));
    await loadConcept(articleId);
  };
  const sendForGeneration = async (articleId: string, values: DetailValues) => {
    if (!supabase) throw new Error("Supabase is not configured.");
    await saveDetail(articleId, values);
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    const response = await fetch("/api/send-for-generation", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ articleId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Couldn’t send this article to the generation sheet.");
    await updateStatus(articleId, "sent_to_sheets");
    setItems((old) => old.map((item) => item.id === articleId ? { ...item, status: "Sent to Sheets" } : item));
    return result as { updatedRange?: string };
  };
  const syncGeneratedContent = async () => {
    if (!supabase || syncingGeneratedContent.current) return { updatedArticleIds: [], statuses: {}, imagesByArticleId: {} };
    syncingGeneratedContent.current = true;
    try {
    const { data } = await supabase.auth.getSession(); if (!data.session) return;
    const response = await fetch("/api/sync-sheet-generation", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } });
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Couldn’t sync generated content.");
    const ids: string[] = result.updatedArticleIds ?? [];
    await loadStories();
    const imagesByArticleId = (result.imagesByArticleId ?? {}) as Record<string, string[]>;
    // The sheet is the source of truth for generated media. Apply its current
    // links directly after loading database rows so an earlier incomplete sync
    // cannot leave the dashboard saying "No image yet."
    setItems((current) => current.map((item) => {
      const firstSheetImage = imagesByArticleId[item.id]?.find(Boolean);
      return firstSheetImage ? {
        ...item,
        featuredImage: displayImageUrl(firstSheetImage),
        featuredImageFallback: directImageFallback(firstSheetImage),
      } : item;
    }));
    if (selected && (ids.includes(selected) || imagesByArticleId[selected]?.length)) {
      await loadConcept(selected);
      const selectedImages = imagesByArticleId[selected]?.filter(Boolean) ?? [];
      if (selectedImages.length) setConcept((current) => current ? {
        ...current,
        image_summary: { ...(current.image_summary ?? {}), sheet_images: selectedImages },
      } : current);
    }
    return result;
    } finally {
      syncingGeneratedContent.current = false;
    }
  };
  const approveGeneratedContent = async (articleId: string) => {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession(); if (!data.session) throw new Error("Please sign in again.");
    const response = await fetch("/api/approve-generation", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ articleId }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Couldn’t approve this post.");
    setItems((old) => old.map((item) => item.id === articleId ? { ...item, status: "Approved" } : item));
  };
  const navigate = (next: number) => {
    if (!detailNavigationItems.length) return;
    const index = detailNavigationItems.findIndex((i) => i.id === selected);
    const safeIndex = index < 0 ? 0 : index;
    setSelected(detailNavigationItems[(safeIndex + next + detailNavigationItems.length) % detailNavigationItems.length].id);
  };
  const research = async (payload: Record<string, unknown>) => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    const response = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Research failed.");
    await loadStories();
    return result as { count: number; articleIds?: string[] };
  };
  useEffect(() => {
    if (!supabase || !userId) return;
    let disposed = false;
    const refreshFromSheet = () => {
      if (disposed || document.visibilityState === "hidden") return;
      void syncGeneratedContent().catch(() => undefined);
    };
    const initialRefresh = window.setTimeout(refreshFromSheet, 750);
    const refreshInterval = window.setInterval(refreshFromSheet, 60_000);
    window.addEventListener("focus", refreshFromSheet);
    return () => {
      disposed = true;
      window.clearTimeout(initialRefresh);
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", refreshFromSheet);
    };
  }, [userId, selected]);
  if (!authReady) return <div className="auth-page"><div className="auth-card">Loading your workspace…</div></div>;
  if (supabaseConfigured && !userId) return <AuthGate />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>GSD</span>
          <em>Instagram</em>
        </div>
        <p className="brand-note">Focus &gt; Fluff</p>
        <nav>
          {(
            [
              { key: "dashboard", icon: <FiGrid />, label: "Dashboard" },
              { key: "discover", icon: <FiCompass />, label: "Discover" },
              { key: "articles", icon: <FiFileText />, label: "Generation Details" },
              { key: "archive", icon: <FiArchive />, label: "Archive" },
            ] as const
          ).map((n) => (
            <button
              key={n.key}
              className={screen === n.key ? "nav-item active" : "nav-item"}
              onClick={() => setScreen(n.key)}
            >
              {n.icon}
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="voice-dot">G</div>
          <div>
            <b>GSD Voice v3</b>
            <small>Active</small>
          </div>
        </div>
      </aside>
      <main className="main-content">
        {toast && (
          <div className={`toast ${toast.kind === "error" ? "toast-error" : "toast-success"}`} role={toast.kind === "error" ? "alert" : "status"}>
            {toast.kind === "success" && <FiCheck />}
            <span>{toast.message}</span>
            {toast.kind === "error" && <button type="button" aria-label="Dismiss error" onClick={() => setToast(null)}><FiX /></button>}
          </div>
        )}
        {screen === "dashboard" && (
          <Dashboard
            items={proposed}
            discover={() => setScreen("discover")}
            select={(id) => {
              setArticleStatusFilter("all");
              setSelected(id);
              void loadConcept(id);
              setScreen("detail");
            }}
            onStatus={(id, status) => void setArticleStatus(id, status).then(() => notify(`Status changed to ${status} in the app and Google Sheet.`)).catch((error) => notify(error instanceof Error ? error.message : "Couldn’t update the status."))}
            approve={(id) => void setArticleStatus(id, "Approved").then(() => notify("Post approved in the app and Google Sheet.")).catch((error) => notify(error instanceof Error ? error.message : "Couldn’t approve this post."))}
            refreshStatus={() => void syncGeneratedContent().then(() => notify("Status and generated content refreshed from the Google Sheet.")).catch((error) => notify(error instanceof Error ? error.message : "Couldn’t refresh status."))}
            statusFilter={articleStatusFilter}
            setStatusFilter={setArticleStatusFilter}
          />
        )}
        {screen === "articles" && (
          <ArticleList
            items={items}
            statusFilter={articleStatusFilter}
            setStatusFilter={setArticleStatusFilter}
            select={(id) => { setArticleStatusFilter("all"); setSelected(id); void loadConcept(id); setScreen("detail"); }}
          />
        )}
        {screen === "discover" && (
          <Discover
            searching={searching}
            setSearching={setSearching}
            notify={notify}
            research={research}
            onManualComplete={(id) => { setSelected(id); void loadConcept(id); setScreen("detail"); }}
          />
        )}
        {screen === "detail" && (
          <Detail
            story={active}
            concept={concept}
            saveDetail={saveDetail}
            reanalyze={() => concept?.image_summary?.origin === "text_overview"
              ? research({ mode: "overview", overview: concept.image_summary.source_overview ?? concept.summary ?? active.overview }).then(() => loadConcept(active.id))
              : research({ mode: "manual", manualUrl: active.url }).then(() => loadConcept(active.id))}
            notify={notify}
            previous={() => navigate(-1)}
            next={() => navigate(1)}
            onStatus={(status) => void setArticleStatus(active.id, status).then(() => { notify(`Status changed to ${status} in the app and Google Sheet.`); if (status === "Archived") setScreen("archive"); }).catch((error) => notify(error instanceof Error ? error.message : "Couldn’t update the status."))}
            sendForGeneration={sendForGeneration}
            syncGeneratedContent={syncGeneratedContent}
            approveGeneratedContent={approveGeneratedContent}
          />
        )}
        {screen === "archive" && (
          <Archive
            items={items.filter((i) => i.status === "Archived")}
            restore={(id) => {
              void setArticleStatus(id, "New").then(() => notify("Restored to the story queue and Google Sheet.")).catch((error) => notify(error instanceof Error ? error.message : "Couldn’t restore the article."));
            }}
          />
        )}
      </main>
    </div>
  );
}

function AuthGate() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const sendLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    setMessage(error ? error.message : "Check your inbox for a secure sign-in link.");
  };
  const signInWithGoogle = async () => {
    if (!supabase) return;
    setSending(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) { setSending(false); setMessage(error.message); }
  };
  return <main className="auth-page"><form className="auth-card" onSubmit={sendLink}>
    <div className="brand"><span>GSD</span><em>Instagram</em></div>
    <h1>Your story desk</h1><p>Sign in to save research, concepts, and assets privately to your workspace.</p>
    <label className="field"><b>Email address</b><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
    <button className="button primary wide" disabled={sending}>{sending ? "Sending…" : "Email me a sign-in link"}</button>
    <div className="auth-divider"><span>or</span></div>
    <button type="button" className="button wide google-button" disabled={sending} onClick={() => void signInWithGoogle()}><span className="google-mark">G</span> Continue with Google</button>
    {message && <p className="auth-message">{message}</p>}
  </form></main>;
}

/* Retired prompt-guidance implementation. Generation is now owned by the Google Sheets workflow.
type PromptDocument = { id: string; kind: "icp" | "voice_guide" | "visual_guide"; file_name: string; storage_path: string; created_at: string; text_content?: string | null };
const bundledPromptAssets = {
  icp: { fileName: "ICP Prompt.md", text: icpPromptAsset },
  voice_guide: { fileName: "Voice Prompt.md", text: voicePromptAsset },
  visual_guide: { fileName: "Image Prompt.md", text: imagePromptAsset },
} as const;
const combinedPromptCharacterCount = Object.values(bundledPromptAssets).reduce((total, asset) => total + asset.text.length, 0);

function Guidance() {
  const [documents, setDocuments] = useState<PromptDocument[]>([]);
  const [uploading, setUploading] = useState<"icp" | "voice_guide" | "visual_guide" | null>(null);
  const [message, setMessage] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [icpText, setIcpText] = useState("");
  const [visualText, setVisualText] = useState("");
  const [savingVoice, setSavingVoice] = useState(false);
  const [viewing, setViewing] = useState<PromptDocument | null>(null);
  const [installing, setInstalling] = useState(false);
  const installBundledPrompts = async (existing: PromptDocument[] = documents) => {
    if (!supabase || installing) return;
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return setMessage("Please sign in again before installing the prompt assets.");
    const missing = (Object.entries(bundledPromptAssets) as Array<[PromptDocument["kind"], { fileName: string; text: string }]>).filter(([, asset]) => !existing.some((document) => document.file_name === asset.fileName));
    if (!missing.length) return;
    setInstalling(true);
    setMessage("");
    for (const [kind, asset] of missing) {
      const path = `${user.id}/${kind}/${crypto.randomUUID()}-${asset.fileName.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      const file = new File([asset.text], asset.fileName, { type: "text/markdown" });
      const { error: storageError } = await supabase.storage.from("prompt-documents").upload(path, file, { contentType: "text/markdown" });
      if (storageError) { setMessage(storageError.message); continue; }
      const { error: dbError } = await supabase.from("prompt_documents").insert({ user_id: user.id, kind, file_name: asset.fileName, storage_path: path, mime_type: "text/markdown", file_size: file.size, text_content: asset.text });
      if (dbError) { await supabase.storage.from("prompt-documents").remove([path]); setMessage(dbError.message); }
    }
    setInstalling(false);
    await loadDocuments(false);
  };
  const loadDocuments = async (installMissing = true) => {
    if (!supabase) return;
    const { data, error } = await supabase.from("prompt_documents").select("id,kind,file_name,storage_path,created_at,text_content").eq("is_active", true).order("created_at", { ascending: false });
    if (error) setMessage(error.message); else { const saved = (data ?? []) as PromptDocument[]; setDocuments(saved); setVoiceText(saved.find((doc) => doc.kind === "voice_guide")?.text_content ?? ""); setIcpText(saved.find((doc) => doc.kind === "icp")?.text_content ?? ""); setVisualText(saved.find((doc) => doc.kind === "visual_guide")?.text_content ?? ""); if (installMissing) void installBundledPrompts(saved); }
  };
  useEffect(() => { void loadDocuments(); }, []);
  const upload = async (kind: "icp" | "voice_guide" | "visual_guide", file?: File) => {
    if (!supabase || !file) return;
    if (file.size > 10 * 1024 * 1024) return setMessage("Please choose a file smaller than 10 MB.");
    setUploading(kind); setMessage("");
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) { setUploading(null); return setMessage("Please sign in again before uploading."); }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${user.id}/${kind}/${crypto.randomUUID()}-${safeName}`;
    const { error: storageError } = await supabase.storage.from("prompt-documents").upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (storageError) { setUploading(null); return setMessage(storageError.message); }
    const textContent = (file.name.endsWith(".md") || file.type.startsWith("text/") || file.type === "application/text") ? await file.text() : null;
    const { error: dbError } = await supabase.from("prompt_documents").insert({ user_id: user.id, kind, file_name: file.name, storage_path: path, mime_type: file.type || null, file_size: file.size, text_content: textContent });
    if (dbError) { await supabase.storage.from("prompt-documents").remove([path]); setMessage(dbError.message); } else { setMessage(`${file.name} is ready to guide future prompts.`); await loadDocuments(); }
    setUploading(null);
  };
  const saveGuide = async (kind: "icp" | "voice_guide" | "visual_guide", text: string, fallbackName: string) => { if (!supabase) return; setSavingVoice(true); const { data: userData } = await supabase.auth.getUser(); const existing = documents.find((doc) => doc.kind === kind); const payload = { text_content: text, file_name: existing?.file_name ?? fallbackName }; const { error } = existing ? await supabase.from("prompt_documents").update(payload).eq("id", existing.id) : await supabase.from("prompt_documents").insert({ user_id: userData.user?.id, kind, storage_path: `${userData.user?.id}/${kind}/${fallbackName}`, mime_type: "text/markdown", file_size: text.length, ...payload }); setSavingVoice(false); setMessage(error ? error.message : `${fallbackName} saved and ready for future prompts.`); await loadDocuments(); };
  const deleteDocument = async (document: PromptDocument) => {
    if (!supabase || !window.confirm(`Delete ${document.file_name}? This cannot be undone.`)) return;
    setMessage("");
    if (document.storage_path) await supabase.storage.from("prompt-documents").remove([document.storage_path]);
    const { error } = await supabase.from("prompt_documents").delete().eq("id", document.id);
    if (error) setMessage(error.message); else { if (viewing?.id === document.id) setViewing(null); setMessage(`${document.file_name} deleted.`); await loadDocuments(); }
  };
  const card = (kind: "icp" | "voice_guide" | "visual_guide", title: string, description: string) => {
    const docs = documents.filter((doc) => doc.kind === kind);
    const latest = docs[0];
    const text = kind === "voice_guide" ? voiceText : kind === "icp" ? icpText : visualText;
    const setText = kind === "voice_guide" ? setVoiceText : kind === "icp" ? setIcpText : setVisualText;
    const asset = bundledPromptAssets[kind];
    return <article className="guidance-card"><span className="guidance-icon"><FiBookOpen /></span><h2>{title}</h2><p>{description}</p>{kind === "voice_guide" && <p className="prompt-character-count">Combined prompt length: {combinedPromptCharacterCount.toLocaleString()} characters</p>}{latest && <p className="last-updated">Last Updated {new Date(latest.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} <button className="view-button" onClick={() => setViewing(latest)}>View</button></p>}<label className="button primary wide"><FiUploadCloud /> {uploading === kind ? "Uploading…" : `Upload replacement prompt`}<input hidden type="file" accept=".md,.txt,text/markdown,text/plain,application/text" disabled={Boolean(uploading)} onChange={(e) => { void upload(kind, e.target.files?.[0]); e.currentTarget.value = ""; }} /></label><small>Markdown or TXT · 10 MB max · private to your workspace</small><Field label="Editable prompt"><textarea className="voice-editor" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Paste or upload the ${title.toLowerCase()} here…`} /></Field><button className="button wide" onClick={() => void saveGuide(kind, text, asset.fileName)} disabled={savingVoice}>{savingVoice ? "Saving…" : "Save prompt"}</button>{docs.length > 0 ? <div className="document-list">{docs.map((doc) => <div key={doc.id}><FiFileText /> <span>{doc.file_name}</span><button aria-label={`Delete ${doc.file_name}`} className="text-danger" onClick={() => void deleteDocument(doc)}><FiTrash2 /></button></div>)}</div> : <div className="document-empty">Prompt asset is being installed…</div>}</article>;
  };
  return <section><header className="page-header"><div><h1>Prompt assets</h1><p>Your ICP, Voice, and Image prompts are the source of truth for research, prompt generation, and production. They are installed to your private workspace automatically.</p></div>{installing && <span className="chip"><FiRefreshCw className="spin" /> Installing prompts…</span>}</header><div className="guidance-grid">{card("icp", "ICP Prompt", "Defines the audience, emotional reality, and practical relevance every post should recognize.")}{card("voice_guide", "Voice Prompt", "Defines Hank and the squirrel’s writing voice, humor, dialogue, and brand guardrails.")}{card("visual_guide", "Image Prompt", "Defines character identity, scale, wardrobe, palette, composition, and continuity for generated assets.")}</div>{message && <p className="guidance-message">{message}</p>}{viewing && <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(24,28,22,.56)", zIndex: 20, display: "grid", placeItems: "center", padding: 24 }}><div style={{ position: "relative", width: "min(850px, 100%)", maxHeight: "82vh", overflow: "auto", background: "#fffdf9", borderRadius: 16, padding: 32, boxShadow: "0 22px 70px rgba(0,0,0,.28)" }}><button className="modal-close" style={{ position: "absolute", top: 16, right: 16, fontSize: 22 }} onClick={() => setViewing(null)}><FiX /></button><h2 style={{ fontFamily: "Playfair Display", fontSize: 32, margin: "0 0 6px" }}>{viewing.kind === "icp" ? "ICP Prompt" : viewing.kind === "voice_guide" ? "Voice Prompt" : "Image Prompt"}</h2><p style={{ color: "#777168", margin: "0 0 22px" }}>{viewing.file_name}</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 1.6, background: "#f5f2ea", padding: 20, borderRadius: 10, margin: 0 }}>{viewing.text_content || "This prompt asset does not contain viewable Markdown/text."}</pre></div></div>}<div className="panel guidance-note"><FiCheck /><div><b>Private prompt assets</b><p>These prompt assets are stored in your private Supabase bucket and used by future research and generation requests.</p></div></div></section>;
}

*/

function Dashboard({
  items,
  discover,
  select,
  onStatus,
  approve,
  refreshStatus,
  statusFilter,
  setStatusFilter,
}: {
  items: Story[];
  discover: () => void;
  select: (id: string) => void;
  onStatus: (id: string, status: Story["status"]) => void;
  approve: (id: string) => void;
  refreshStatus: () => void;
  statusFilter: "all" | Story["status"];
  setStatusFilter: (value: "all" | Story["status"]) => void;
}) {
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("all");
  const [type, setType] = useState("all");
  const [minimumScore, setMinimumScore] = useState("0");
  const [dateSort, setDateSort] = useState<"newest" | "oldest">("newest");
  const shown = items
    .filter((i) => i.title.toLowerCase().includes(filter.toLowerCase()) && (category === "all" || i.category === category) && (type === "all" || i.type === type) && i.score >= Number(minimumScore) && (statusFilter === "all" || i.status === statusFilter))
    .sort((a, b) => {
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateSort === "newest" ? bDate - aDate : aDate - bDate;
    });
  const categories = [...new Set(items.map((item) => item.category))];
  const types = [...new Set(items.map((item) => item.type))];
  const statusOrder: Array<Story["status"]> = ["New", "Sent to Sheets", "Generated", "Approved", "Posted", "Archived"];
  const groupedStories = Array.from(
    shown.reduce((groups, item) => {
      const stories = groups.get(item.status) ?? [];
      stories.push(item);
      groups.set(item.status, stories);
      return groups;
    }, new Map<Story["status"], Story[]>()),
  ).sort(([firstStatus], [secondStatus]) => statusOrder.indexOf(firstStatus) - statusOrder.indexOf(secondStatus));
  return (
    <section>
      <header className="page-header">
        <div>
          <h1>Your story queue</h1>
          <p>High-potential stories, ranked for the GSD audience.</p>
          <p className="app-build-meta">Version {APP_VERSION} · Last updated {formatAppUpdated(APP_LAST_UPDATED)}</p>
        </div>
        <div className="page-actions">
          <button onClick={refreshStatus}><FiRefreshCw /> Refresh status</button>
          <button className="button primary" onClick={discover}><FiPlus /> Find fresh stories</button>
        </div>
      </header>
      <div className="filter-row">
        <label>
          <FiSearch />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search stories"
          />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={minimumScore} onChange={(e) => setMinimumScore(e.target.value)}><option value="0">Any score</option><option value="90">90+</option><option value="75">75+</option><option value="60">60+</option></select>
        <select value={type} onChange={(e) => setType(e.target.value)}><option value="all">All post types</option>{types.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | Story["status"])} aria-label="Filter by status"><option value="all">All statuses</option><option>New</option><option>Sent to Sheets</option><option>Generated</option><option>Approved</option><option>Posted</option></select>
        <select value={dateSort} onChange={(e) => setDateSort(e.target.value as "newest" | "oldest")} aria-label="Sort by date added"><option value="newest">Date added: Newest first</option><option value="oldest">Date added: Oldest first</option></select>
      </div>
      <div className="story-table">
        <div className="story-head">
          <span>Story</span>
          <span>Identifier</span>
          <span>Date added</span>
          <span>Category</span>
          <span>Score</span>
          <span>Post type</span>
          <span>Status</span>
          <span>Actions</span>
        </div>
        {shown.length === 0 && <div className="empty-queue"><FiCompass /><h2>No stories in your queue yet</h2><p>Use Discover to find fresh, high-fit stories. Your discarded items remain protected from duplicates.</p><button className="button primary" onClick={discover}>Find fresh stories</button></div>}
        {groupedStories.map(([categoryName, stories]) => <React.Fragment key={categoryName}>
          <div className="category-group-heading"><b>{categoryName}</b><span>{stories.length} {stories.length === 1 ? "story" : "stories"}</span></div>
          {stories.map((item) => (
            <div className="story-row" key={item.id}>
              <div>
                <h3><button className="story-title-link" onClick={() => select(item.id)}>{item.title}</button></h3>
                <p>{item.overview}</p>
              </div>
              {item.generationIdentifier && item.generationSheetRow ? <a className="identifier-link" href={`https://docs.google.com/spreadsheets/d/1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ/edit#gid=0&range=D${item.generationSheetRow}`} target="_blank" rel="noreferrer">{item.generationIdentifier}</a> : <span className="identifier-empty">—</span>}
              <time className="date-added" dateTime={item.createdAt ?? undefined}>{formatAddedDate(item.createdAt)}</time>
              <span className="chip">{item.category}</span>
              <span className="score">{item.score}</span>
              <span className="type">{item.type}</span>
              <select className="status-select" value={item.status} onChange={(e) => onStatus(item.id, e.target.value as Story["status"])}><option>New</option><option>Sent to Sheets</option><option>Generated</option><option>Approved</option><option>Posted</option><option>Archived</option></select>
              <div className="actions">
                {item.status === "Generated" && <button className="button compact primary" onClick={() => approve(item.id)}><FiCheck /> Approve</button>}
              </div>
            </div>
          ))}
        </React.Fragment>)}
      </div>
    </section>
  );
}

function ArticleList({
  items,
  statusFilter,
  setStatusFilter,
  select,
}: {
  items: Story[];
  statusFilter: "all" | Story["status"];
  setStatusFilter: (value: "all" | Story["status"]) => void;
  select: (id: string) => void;
}) {
  const statusOrder: Array<Story["status"]> = ["New", "Sent to Sheets", "Generated", "Approved", "Posted"];
  const shown = items.filter((item) => item.status !== "Archived" && (statusFilter === "all" || item.status === statusFilter));
  const groups = Array.from(shown.reduce((all, item) => {
    const group = all.get(item.status) ?? [];
    group.push(item);
    all.set(item.status, group);
    return all;
  }, new Map<Story["status"], Story[]>()),).sort(([a], [b]) => statusOrder.indexOf(a) - statusOrder.indexOf(b));
  return <section>
    <header className="page-header">
      <div><h1>Generation Details</h1><p>Browse active items by status, then open any title to review its generation suggestions.</p></div>
    </header>
    <div className="filter-row article-list-filter">
      <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | Story["status"])} aria-label="Filter articles by status">
        <option value="all">All active statuses</option><option>New</option><option>Sent to Sheets</option><option>Generated</option><option>Approved</option><option>Posted</option>
      </select>
    </div>
    <div className="article-list">
      {!shown.length && <div className="empty-queue"><FiFileText /><h2>No matching articles</h2><p>Try a different status filter.</p></div>}
      {groups.map(([status, stories]) => <section className="article-status-group" key={status}>
        <header><h2>{status}</h2><span>{stories.length} {stories.length === 1 ? "article" : "articles"}</span></header>
        <div className="article-list-grid">{stories.map((item) => <article className="article-list-card" key={item.id}>
          <div className="article-list-copy"><button className="article-list-title" onClick={() => select(item.id)}>{item.title}</button><p>{item.overview}</p><span className="status-pill">{item.status}</span></div>
          <ArticleThumbnail item={item} />
        </article>)}</div>
      </section>)}
    </div>
  </section>;
}

function ArticleThumbnail({ item }: { item: Story }) {
  const candidates = Array.from(new Set([item.featuredImage, item.featuredImageFallback].filter(Boolean))) as string[];
  const [candidateIndex, setCandidateIndex] = useState(0);
  useEffect(() => setCandidateIndex(0), [item.id, item.featuredImage, item.featuredImageFallback]);
  const source = candidates[candidateIndex];
  return <div className="article-thumbnail">
    {source
      ? <img
          src={source}
          alt={`First generated image for ${item.title}`}
          referrerPolicy="no-referrer"
          onError={() => setCandidateIndex((index) => index + 1)}
        />
      : <span>No image yet</span>}
  </div>;
}

function formatAddedDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatAppUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function Metric({
  number,
  label,
  icon,
}: {
  number: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="metric">
      <div>
        <strong>{number}</strong>
        <span>{label}</span>
      </div>
      <i>{icon}</i>
    </div>
  );
}
function Discover({
  searching,
  setSearching,
  notify,
  research,
  onManualComplete,
}: {
  searching: boolean;
  setSearching: (v: boolean) => void;
  notify: (m: string) => void;
  research: (payload: Record<string, unknown>) => Promise<{ count: number; articleIds?: string[] }>;
  onManualComplete: (id: string) => void;
}) {
  const [mode, setMode] = useState<"system" | "manual" | "overview">("system");
  const [manualUrl, setManualUrl] = useState("");
  const [overview, setOverview] = useState("");
  const [searchText, setSearchText] = useState("");
  const [topicInput, setTopicInput] = useState("");
  const [topics, setTopics] = useState(["Attention & Brain", "Animal Behavior", "Weird Human News", "Productivity Tips", "Science & Space"]);
  const [queued, setQueued] = useState<string[]>([]);
  const [trends, setTrends] = useState<TrendingTopic[]>([]);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [trendsError, setTrendsError] = useState("");
  const trendsCacheKey = "gsd-trending-now-v1";
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const loadTrends = async () => {
    // Trends are intentionally fetched once per calendar day.  Navigating away
    // from Discover or reloading the app uses the saved daily result instead.
    const cached = window.localStorage.getItem(trendsCacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.date === today() && Array.isArray(parsed.topics) && parsed.topics.length) {
          setTrends(parsed.topics);
          setTrendsLoading(false);
          return;
        }
      } catch { window.localStorage.removeItem(trendsCacheKey); }
    }
    setTrendsLoading(true);
    setTrendsError("");
    try {
      const session = await supabase?.auth.getSession();
      const token = session?.data.session?.access_token;
      if (!token) throw new Error("Sign in required.");
      const response = await fetch("/api/trending", { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load current trends.");
      const topics = body.topics ?? [];
      setTrends(topics);
      window.localStorage.setItem(trendsCacheKey, JSON.stringify({ date: today(), topics }));
    } catch (error) {
      setTrendsError(error instanceof Error ? error.message : "Could not load current trends.");
    } finally {
      setTrendsLoading(false);
    }
  };
  useEffect(() => { void loadTrends(); }, []);
  const addTopic = () => { const value = topicInput.trim(); if (value && !topics.includes(value)) setTopics([...topics, value]); setTopicInput(""); };
  const run = async () => {
    if (mode === "manual" && !/^https?:\/\//i.test(manualUrl.trim())) return notify("Paste a complete article URL, starting with https://.");
    if (mode === "overview" && !overview.trim()) return notify("Add a text overview to generate a suggested post.");
    if (mode === "system" && !searchText.trim() && topics.length === 0) return notify("Add a search phrase or at least one topic.");
    setSearching(true);
    try {
      const result = await research({ mode, manualUrl: manualUrl.trim(), overview: overview.trim(), searchText: searchText.trim(), topics });
      setQueued(mode === "manual" || mode === "overview" ? [mode === "overview" ? "Overview interpreted" : "Article analyzed", "GSD fit scored", "Post concept saved"] : ["Searching trusted, accessible sources", "Ranking GSD audience fit", "Building post concepts"]);
      notify(`${result.count} ${result.count === 1 ? "story" : "stories"} added to your dashboard.`);
      if ((mode === "manual" || mode === "overview") && result.articleIds?.[0]) onManualComplete(result.articleIds[0]);
    } catch (error) { notify(error instanceof Error ? error.message : "Research failed."); }
    finally { setSearching(false); }
  };
  return (
    <section>
      <header className="page-header">
        <div>
          <h1>Find fresh stories</h1>
          <p>
            Find high-potential stories, analyze a specific URL, or turn your own
            text overview into a Hank-and-the-squirrel post suggestion without an article.
          </p>
        </div>
      </header>
      <div className="discover-grid">
        <div className="panel search-panel">
          <div className="segmented">
            <button className={mode === "manual" ? "selected" : ""} onClick={() => setMode("manual")}>Manual URL</button>
            <button className={mode === "overview" ? "selected" : ""} onClick={() => setMode("overview")}>Text overview</button>
            <button className={mode === "system" ? "selected" : ""} onClick={() => setMode("system")}>System Search</button>
          </div>
          {mode === "manual" ? <Field label="Direct article URL"><input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://example.com/article" /></Field> : mode === "overview" ? <Field label="Text overview"><textarea className="overview-editor" value={overview} onChange={(e) => setOverview(e.target.value)} placeholder="Describe the observation, idea, situation, or theme. No news article is required." /></Field> : <><Field label="What should we search for?"><input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="e.g. surprising focus research or clever animal behavior" /></Field>
          <p className="field-label">Topics</p>
          <div className="chips">
            {topics.map((topic) => <span key={topic}>{topic} <button aria-label={`Remove ${topic}`} onClick={() => setTopics(topics.filter((item) => item !== topic))}><FiX /></button></span>)}
          </div>
          <div className="topic-add"><input value={topicInput} onChange={(e) => setTopicInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTopic(); } }} placeholder="Add a topic" /><button onClick={addTopic}><FiPlus /> Add</button></div></>}
          <button className="button primary wide" onClick={run}>
            {searching ? (
              <>
                <FiRefreshCw className="spin" /> {mode === "overview" ? "Generating suggestion" : "Researching stories"}
              </>
            ) : (
              <>
                {mode === "overview" ? <><FiEdit3 /> Generate Suggested Post</> : <><FiSearch /> Search for stories</>}
              </>
            )}
          </button>
        </div>
        <aside className="panel trending-panel">
          <div className="trending-header">
            <div><h2>Trending now</h2><p>Fresh social conversations, selected for GSD-friendly storytelling. Updated daily.</p></div>
          </div>
          {trendsLoading && <p className="trending-status">Finding current conversations…</p>}
          {trendsError && <p className="trending-status">{trendsError}</p>}
          {!trendsLoading && !trendsError && <div className="trending-list">
            {trends.map((trend, index) => <article className="trending-item" key={`${trend.title}-${index}`}>
              <span className="trending-number">{index + 1}</span>
              <div>
                <div className="trending-item-head">
                  {trend.source_url ? <a href={trend.source_url} target="_blank" rel="noreferrer"><h3>{trend.title} <span className="trending-platform">({trend.platform})</span></h3></a> : <h3>{trend.title} <span className="trending-platform">({trend.platform})</span></h3>}
                  <button className="trending-delete" aria-label={`Remove ${trend.title}`} title="Remove trend" onClick={() => setTrends((items) => items.filter((_, itemIndex) => itemIndex !== index))}><FiTrash2 /></button>
                </div>
                <p>{trend.summary}</p>
                <b>Suggested commentary</b>
                <p className="trending-angle">{trend.suggested_content}</p>
              </div>
            </article>)}
          </div>}
        </aside>
      </div>
      <div className="panel progress">
        <h2>{searching ? "Preparing research" : queued.length ? "Queued research" : "Ready to research"}</h2>
        {(queued.length ? queued : []).map(
          (t, i) => (
            <div className="progress-row" key={t}>
              <span className="round">{i + 1}</span>
              <b>{t}</b>
              <p>
                {i === 0
                  ? "How attention spans change with smartphone use"
                  : i === 1
                    ? "Unexpected animal problem solving"
                    : "Practical tactics to protect your focus"}
              </p>
              <small>{searching ? "Searching" : queued.length ? "Queued" : "Ready"}</small>
            </div>
          ),
        )}
        {!searching && queued.length === 0 && <p className="empty-progress">Start a search to create research jobs. No sample stories are shown.</p>}
      </div>
    </section>
  );
}
function Requirement({ title, text }: { title: string; text: string }) {
  return (
    <div className="requirement">
      <i>
        <FiCheck />
      </i>
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Detail({
  story,
  concept,
  previous,
  next,
  onStatus,
  saveDetail,
  reanalyze,
  sendForGeneration,
  syncGeneratedContent,
  approveGeneratedContent,
  notify,
}: {
  story: Story;
  concept: Concept | null;
  previous: () => void;
  next: () => void;
  onStatus: (status: Story["status"]) => void;
  saveDetail: (id: string, values: DetailValues) => Promise<void>;
  reanalyze: () => Promise<unknown>;
  sendForGeneration: (articleId: string, values: DetailValues) => Promise<{ updatedRange?: string }>;
  syncGeneratedContent: () => Promise<void>;
  approveGeneratedContent: (articleId: string) => Promise<void>;
  notify: Notify;
}) {
  const [values, setValues] = useState<DetailValues>(() => detailValues(story, concept));
  const [busy, setBusy] = useState("");
  const [activeImage, setActiveImage] = useState(0);
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptLoadError, setPromptLoadError] = useState("");
  // Prefer app-storage copies. If any cannot be signed, retain the Drive image
  // URLs as a fallback instead of rendering an empty gallery.
  const renderedImages = Array.isArray(concept?.image_summary?.rendered_images) ? concept.image_summary.rendered_images.filter(Boolean) : [];
  const embeddedImages = Array.isArray(concept?.image_summary?.embedded_images) ? concept.image_summary.embedded_images.filter(Boolean) : [];
  const rawSheetImages = Array.isArray(concept?.image_summary?.sheet_images) ? concept.image_summary.sheet_images.filter(Boolean) : [];
  const sheetImages = rawSheetImages.map(displayImageUrl);
  const images = (renderedImages.length ? renderedImages : embeddedImages.length ? embeddedImages : sheetImages) as string[];
  const fallbackImage = (index: number) => directImageFallback(rawSheetImages[index]);
  const lockedAfterSheetSend = ["Sent to Sheets", "Generated", "Approved", "Posted"].includes(story.status);
  const isTextOverview = concept?.image_summary?.origin === "text_overview";
  useEffect(() => setValues(detailValues(story, concept)), [story.id, concept]);
  useEffect(() => setActiveImage(0), [story.id, images.length]);
  useEffect(() => {
    let cancelled = false;
    setGenerationPrompt("");
    setPromptLoadError("");
    setPromptLoading(true);
    void (async () => {
      try {
        if (!supabase) throw new Error("Supabase is not configured.");
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error("Please sign in again.");
        const response = await fetch("/api/generation-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify({ articleId: story.id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Couldn’t retrieve the generation prompt.");
        if (!cancelled) setGenerationPrompt(String(result.prompt ?? ""));
      } catch (error) {
        if (!cancelled) setPromptLoadError(error instanceof Error ? error.message : "Couldn’t retrieve the generation prompt.");
      } finally {
        if (!cancelled) setPromptLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [story.id]);
  const update = (key: keyof DetailValues, value: string | number) => setValues((old) => ({ ...old, [key]: value }));
  const save = async () => { setBusy("save"); try { await saveDetail(story.id, values); notify("Article detail saved."); } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t save article detail.", "error"); } finally { setBusy(""); } };
  const rerun = async () => { setBusy("analysis"); try { await reanalyze(); notify("Article analysis refreshed with a new version."); } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t rerun analysis.", "error"); } finally { setBusy(""); } };
  const send = async () => { setBusy("sheet"); try { const result = await sendForGeneration(story.id, values) as { warnings?: string[] }; notify(result.warnings?.length ? `Article saved. ${result.warnings.join(" ")}` : "Article sent to the Google Sheet for generation.", result.warnings?.length ? "error" : "success"); } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t send this article to the generation sheet.", "error"); } finally { setBusy(""); } };
  const generateContent = async () => {
    setBusy("generate");
    try {
      if (promptLoading) throw new Error("Column J is still loading. Please try again in a moment.");
      if (!generationPrompt) throw new Error(promptLoadError || "Column J is empty for this article.");
      let copied = false;
      if (navigator.clipboard?.writeText && document.hasFocus()) {
        try {
          // The prompt is preloaded so this call begins directly inside the
          // button click's user-activation window.
          await navigator.clipboard.writeText(generationPrompt);
          copied = true;
        } catch {
          // Fall through to the synchronous fallback when supported.
        }
      }
      if (!copied) {
        const textarea = document.createElement("textarea");
        textarea.value = generationPrompt;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        copied = document.execCommand("copy");
        textarea.remove();
      }
      if (!copied) throw new Error("The browser blocked clipboard access. Keep this page active and click Generate Content again.");
      const chatWindow = window.open("https://chatgpt.com/g/g-p-69e8effb73588191acaccbaed49a9d96/c/6a5fd350-e1f8-83ea-a391-a1e3cd4b4dcb", "_blank", "noopener,noreferrer");
      notify(chatWindow ? "Column J copied to the clipboard and ChatGPT opened." : "Column J copied. Your browser blocked the new ChatGPT window.", chatWindow ? "success" : "error");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn’t copy the generation prompt.", "error");
    } finally {
      setBusy("");
    }
  };
  const refresh = async () => { setBusy("refresh"); try { await syncGeneratedContent(); notify("Content refreshed from the Google Sheet."); } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t refresh generated content.", "error"); } finally { setBusy(""); } };
  const approve = async () => { setBusy("approve"); try { await approveGeneratedContent(story.id); notify("Post approved in the app and Google Sheet."); } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t approve this post.", "error"); } finally { setBusy(""); } };
  return (
    <section>
      <header className="page-header generation-suggestions-header">
        <div><h1>Generation Suggestions</h1><p>Review the suggested content, generated images, caption, and hashtags before approval.</p></div>
      </header>
      <div className="detail-top">
        <div className="detail-actions">
          <div className="detail-navigation">
          <button onClick={previous}>
            <FiArrowLeft /> Previous
          </button>
          <button onClick={next}>
            Next <FiArrowRight />
          </button>
          </div>
          <label className="detail-status-control">Status<select value={story.status} onChange={(e) => onStatus(e.target.value as Story["status"])}><option>New</option><option>Sent to Sheets</option><option>Generated</option><option>Approved</option><option>Posted</option><option>Archived</option></select></label>
          <button onClick={() => void refresh()} disabled={Boolean(busy)}><FiRefreshCw className={busy === "refresh" ? "spin" : ""} /> {busy === "refresh" ? "Refreshing…" : "Refresh data"}</button>
          {story.status === "Generated" && <button className="button primary" onClick={() => void approve()} disabled={Boolean(busy)}><FiCheck /> {busy === "approve" ? "Approving…" : "Approve"}</button>}
          <button onClick={rerun} disabled={Boolean(busy) || lockedAfterSheetSend}><FiRefreshCw /> {busy === "analysis" ? "Analyzing…" : isTextOverview ? "Regenerate suggestion" : "Regenerate analysis"}</button>
          <button onClick={save} disabled={Boolean(busy) || lockedAfterSheetSend}><FiCheck /> {busy === "save" ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
      <div className="detail-fields">
        <div className="left-fields detail-editor-fields">
          <Field label={isTextOverview ? "Suggestion title" : "Article title"}><input value={values.title} onChange={(e) => update("title", e.target.value)} /></Field>
          <Field label={isTextOverview ? "Overview summary" : "Article Summary"}><textarea className="summary-editor" value={values.summary} onChange={(e) => update("summary", e.target.value)} placeholder={isTextOverview ? "A concise summary of the post idea" : "A two-to-three sentence article summary"} /></Field>
          <div className="detail-metadata-row">
            <Field label="Source URL"><input type="url" value={values.url} onChange={(e) => update("url", e.target.value)} placeholder={isTextOverview ? "No article linked" : "https://example.com/article"} disabled={isTextOverview} /></Field>
            <Field label="Type"><select value={values.postType} onChange={(e) => update("postType", e.target.value)}><option value="carousel">Carousel</option><option value="single_image">Single Image</option><option value="multi_pane_cartoon">Multi-pane Cartoon</option><option value="reel">Reel</option></select></Field>
            <Field label="Score"><input type="number" min="1" max="100" value={values.score} onChange={(e) => update("score", Number(e.target.value))} /></Field>
            <Field label="Panel Count"><input type="number" min="1" max="10" value={values.panelCount} onChange={(e) => update("panelCount", Number(e.target.value))} /></Field>
          </div>
          <Field label="Caption"><textarea className="caption-editor" value={values.caption} onChange={(e) => update("caption", e.target.value)} /></Field>
          <Field label="Recommended hashtags · 3–5"><textarea className="hashtags-editor" value={values.hashtags} onChange={(e) => update("hashtags", e.target.value)} placeholder="#gsd-book #focus #productivity" /></Field>
        </div>
      </div>
      <section className="detail-content-section">
        <div className="detail-content-heading"><h2>Content</h2><span /></div>
        {images.length > 0 ? <div className="detail-generated-content">
          <div className="detail-asset-gallery">
            <div className="detail-asset-stage">
              <img src={images[activeImage]} alt={`Generated panel ${activeImage + 1}`} referrerPolicy="no-referrer" onError={(event) => {
                const fallback = fallbackImage(activeImage);
                event.currentTarget.onerror = null;
                if (fallback) event.currentTarget.src = fallback;
              }} />
              {images.length > 1 && <>
                <button className="asset-arrow previous" aria-label="Previous image" onClick={() => setActiveImage((index) => (index - 1 + images.length) % images.length)}><FiArrowLeft /></button>
                <button className="asset-arrow next" aria-label="Next image" onClick={() => setActiveImage((index) => (index + 1) % images.length)}><FiArrowRight /></button>
              </>}
            </div>
            {images.length > 1 && <div className="detail-asset-thumbnails">{images.map((url, index) => <button key={url} className={index === activeImage ? "active" : ""} aria-label={`Show panel ${index + 1}`} onClick={() => setActiveImage(index)}><img src={url} alt={`Panel ${index + 1}`} referrerPolicy="no-referrer" onError={(event) => {
              const fallback = fallbackImage(index);
              event.currentTarget.onerror = null;
              if (fallback) event.currentTarget.src = fallback;
            }} /></button>)}</div>}
          </div>
          <div className="generated-post-copy"><b>Post Comment</b><p>{values.caption || "No post comment provided."}</p><b>Hashtags</b><p>{values.hashtags || "No hashtags provided."}</p></div>
        </div> : <>
          <Field label="Content (Suggested Prompt)"><textarea className="tall" style={{ minHeight: 720, lineHeight: 1.7 }} value={values.content} onChange={(e) => update("content", e.target.value)} /></Field>
          <button className={story.status === "Sent to Sheets" ? "button complete wide" : "button primary wide"} onClick={() => void send()} disabled={Boolean(busy) || story.status === "Sent to Sheets"}><FiExternalLink /> {story.status === "Sent to Sheets" ? "Sent to Sheets Complete" : busy === "sheet" ? "Sending…" : "Send for Generation"}</button>
          <button className="button wide" onClick={() => void generateContent()} disabled={Boolean(busy) || promptLoading}><FiCopy /> {promptLoading ? "Loading Column J…" : busy === "generate" ? "Copying…" : "Generate Content"}</button>
        </>}
      </section>
    </section>
  );
}
type DetailValues = { title: string; url: string; score: number; postType: string; panelCount: number; setting: string; content: string; prompt: string; caption: string; hashtags: string; summary: string };
function normalizeHashtags(value: string) {
  const cleaned = value.split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean).map((tag) => `#${tag.replace(/^#/, "").toLowerCase()}`);
  return Array.from(new Set(["#gsd-book", ...cleaned.filter((tag) => tag !== "#gsd-book"), "#focus", "#productivity"])).slice(0, 5);
}
function formatPanelContent(value: string) {
  const firstPanel = value.search(/\bPanel\s*1\b/i);
  const panelOnly = firstPanel >= 0 ? value.slice(firstPanel) : value;
  return panelOnly
    .replace(/\bHank\s*\(human\)/gi, "Hank")
    .replace(/(?:^|\n)\s*(?:Style|Voice)\s*:[\s\S]*?(?=\n\s*Panel\s+\d+\b|$)/gi, "")
    .replace(/\s+(?:Style|Voice)\s*:[\s\S]*$/gi, "")
    .replace(/\s+(Panel\s+\d+\s*[—:-])/gi, "\n\n$1")
    .replace(/\s+(Text overlay:)/gi, "\n\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function detailValues(story: Story, concept: Concept | null): DetailValues {
  const image = concept?.image_summary ?? {};
  const panelContent = formatPanelContent(image.content ?? concept?.detailed_prompt ?? "");
  const settingLine = image.setting ? `Setting: ${image.setting}` : "";
  const content = /^\s*Setting\s*:/i.test(panelContent) ? panelContent : [settingLine, panelContent].filter(Boolean).join("\n\n");
  return { title: story.title, url: story.url ?? "", score: story.score, postType: concept?.post_type ?? story.type, panelCount: concept?.panel_count ?? 5, setting: image.setting ?? [image.location, image.time_of_day].filter(Boolean).join(" · "), content, prompt: concept?.detailed_prompt ?? "", caption: concept?.caption ?? "", hashtags: normalizeHashtags((concept?.hashtags ?? []).join(" ")).join(" "), summary: concept?.summary ?? story.overview ?? "" };
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <b>{label}</b>
      {children}
    </label>
  );
}
/* Retired in-app OpenAI asset generation and preview. Assets are generated through Google Sheets.
function Produce({
  story,
  productionRequest,
  generateAssets,
  loadAssets,
  caption,
  setCaption,
  change,
  setChange,
  onPreview,
  notify,
}: {
  story: Story;
  productionRequest: number;
  generateAssets: (articleId: string, requestedChange?: string, sequence?: number) => Promise<GeneratedAsset[]>;
  loadAssets: (articleId: string) => Promise<GeneratedAsset[]>;
  caption: string;
  setCaption: (value: string) => void;
  change: string;
  setChange: (s: string) => void;
  onPreview: () => void;
  notify: (m: string) => void;
}) {
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    loadAssets(story.id).then((saved) => { if (saved.length) { setAssets(saved); setActive(0); } }).catch(() => undefined);
  }, [story.id]);
  useEffect(() => {
    if (!productionRequest) return;
    setLoading(true);
    setError("");
    setAssets([]);
    setActive(0);
    generateAssets(story.id)
      .then((created) => {
        setAssets(created.sort((a, b) => a.sequence - b.sequence));
        notify(`${created.length} carousel asset${created.length === 1 ? "" : "s"} generated.`);
      })
      .catch((generationError: Error) => setError(generationError.message))
      .finally(() => setLoading(false));
  }, [productionRequest, story.id]);
  const current = assets[active];
  const regenerate = async () => {
    if (!current) return;
    setLoading(true);
    setError("");
    try {
      const [replacement] = await generateAssets(story.id, change, current.sequence);
      if (!replacement) throw new Error("No replacement image was returned.");
      setAssets((previous) => previous.map((asset) => asset.sequence === replacement.sequence ? replacement : asset));
      setChange("");
      notify(`Panel ${current.sequence} regenerated.`);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Couldn’t regenerate this panel.");
    } finally {
      setLoading(false);
    }
  };
  const previous = () => setActive((index) => (index - 1 + assets.length) % assets.length);
  const next = () => setActive((index) => (index + 1) % assets.length);
  return (
    <section>
      <header className="produce-head">
        <div>
          <h1>
            Content{" "}
            <span className="ready">
              {loading ? <FiRefreshCw /> : <FiCheck />} {loading ? "Generating assets…" : assets.length ? "Assets ready" : "Preparing assets"}
            </span>
          </h1>
          <p>
            <FiFileText /> {story.title}
          </p>
        </div>
        <div className="produce-actions">
          <span className="big-score">
            92<small>GSD score</small>
          </span>
          <button className="button primary" onClick={onPreview}>
            Preview on Instagram <FiExternalLink />
          </button>
          <button>
            <FiMoreHorizontal />
          </button>
        </div>
      </header>
      <div className="production-layout">
        <div>
          <div style={{ position: "relative", minHeight: 460, borderRadius: 18, overflow: "hidden", background: "#e9e8df", display: "grid", placeItems: "center" }}>
            {current ? <img src={current.url} alt={`Generated carousel panel ${current.sequence}`} style={{ display: "block", width: "100%", height: 520, objectFit: "contain", background: "#171a16" }} /> : <p style={{ color: "#5c604f" }}>{loading ? "Creating your Hank and squirrel carousel…" : "No generated assets yet."}</p>}
            {assets.length > 1 && <>
              <button aria-label="Previous image" onClick={previous} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", width: 42, height: 42, borderRadius: "50%", border: 0, background: "rgba(255,255,255,.92)", fontSize: 22 }}><FiArrowLeft /></button>
              <button aria-label="Next image" onClick={next} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", width: 42, height: 42, borderRadius: "50%", border: 0, background: "rgba(255,255,255,.92)", fontSize: 22 }}><FiArrowRight /></button>
              <span style={{ position: "absolute", right: 16, bottom: 14, padding: "5px 10px", borderRadius: 999, background: "rgba(0,0,0,.7)", color: "white", fontSize: 13 }}>{active + 1} / {assets.length}</span>
            </>}
          </div>
          <div style={{ display: "flex", gap: 10, paddingTop: 12, overflowX: "auto" }}>
            {assets.map((asset, index) => <button key={asset.id} aria-label={`Show panel ${asset.sequence}`} onClick={() => setActive(index)} style={{ padding: 0, border: index === active ? "3px solid #d05335" : "3px solid transparent", background: "transparent", borderRadius: 8, height: 82, width: 62, flex: "0 0 auto", overflow: "hidden" }}><img src={asset.url} alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} /></button>)}
          </div>
          {error && <p style={{ color: "#b5362b", margin: "12px 0 0" }}>{error}</p>}
          <div className="copy-grid">
            <Field label="Post text">
              <textarea value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Generated post text will appear here." />
            </Field>
            <div className="field hash-field">
              <b>Suggested hashtags</b>
              <div className="hashes">
                {[].map((x) => (
                  <span key={x}>
                    {x} <FiPlus />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <aside className="asset-editor">
          <h2>Asset {assets.length ? active + 1 : 0} of {assets.length || "—"}</h2>
          <div className="tabs">
            <button className="on">Generated</button>
            <button>Upload replacement</button>
          </div>
          <Field label="What would you like to change?">
            <textarea
              placeholder="Describe the change you want to see…"
              value={change}
              onChange={(e) => setChange(e.target.value)}
            />
          </Field>
          <button
            className="button primary wide"
            onClick={regenerate}
            disabled={loading || !current}
          >
            <FiRefreshCw /> {loading ? "Generating…" : "Regenerate"}
          </button>
          <button className="button wide">
            <FiUploadCloud /> Replace with upload
          </button>
          <h3>Prompt history</h3>
          <div className="history">
            <p>
              Hank has an idea moment with a lightbulb. <small>Just now</small>
            </p>
            <p>
              More emphasis on the lightbulb idea. <small>2m ago</small>
            </p>
            <p>
              Hank pointing up, squirrel looks up. <small>5m ago</small>
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
function Preview({
  story,
  concept,
  caption,
  loadAssets,
  back,
  notify,
}: {
  story: Story;
  concept: Concept | null;
  caption: string;
  loadAssets: (articleId: string) => Promise<GeneratedAsset[]>;
  back: () => void;
  notify: (m: string) => void;
}) {
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); void loadAssets(story.id).then((saved) => setAssets(saved)).catch(() => setAssets([])); }, [story.id, loadAssets]);
  const current = assets[active];
  return (
    <section>
      <header className="preview-header">
        <button onClick={back}>
          <FiArrowLeft /> Return to editor
        </button>
        <h1>Instagram preview</h1>
        <div>
          <button>
            Carousel · 5 panels <FiChevronDown />
          </button>
          <button
            className="button primary"
            onClick={() => notify("Assets approved and ready for export.")}
          >
            <FiCheck /> Approve assets
          </button>
        </div>
      </header>
      <div className="preview-layout">
        <div className="post-frame">
          <div className="post-user">
            <span className="avatar">H</span>
            <b>Hank and the squirrel</b>
            <FiMoreHorizontal />
          </div>
          <div className="post-image">
            {current ? <img src={current.url} alt={`${story.title} panel ${current.sequence}`} /> : <p style={{ padding: 28 }}>No generated images for this article yet.</p>}
          </div>
          <div className="post-controls">
            <span>♡</span>
            <span>◯</span>
            <span>↗</span>
            <span className="save">♧</span>
          </div>
          <div className="dots">
            {assets.map((asset, index) => <button key={asset.id} aria-label={`Show panel ${asset.sequence}`} onClick={() => setActive(index)}><i className={index === active ? "on" : ""} /></button>)}
          </div>
        </div>
        <aside className="post-details">
          <h2>Post details</h2>
          <b>Caption</b>
          <p>{caption || concept?.caption || "No caption has been generated for this article yet."}</p>
          <b>Hashtags</b>
          <div className="hashtags">
            {(concept?.hashtags ?? []).map(
              (x) => (
                <span key={x}>
                  {x} <FiX />
                </span>
              ),
            )}
          </div>
          <div className="preview-tabs">
            <button className="on">Feed preview</button>
            <button>Grid preview</button>
          </div>
          <div className="mini-grid">
            {assets.map((asset) => (
              <img
                key={asset.id}
                src={asset.url}
                alt={`Panel ${asset.sequence}`}
              />
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
*/

function Archive({
  items,
  restore,
}: {
  items: Story[];
  restore: (id: string) => void;
}) {
  const rows = useMemo(() => items, [items]);
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("all");
  const shownRows = rows.filter((row) => row.title.toLowerCase().includes(filter.toLowerCase()) && (category === "all" || row.category === category));
  const categories = [...new Set(rows.map((row) => row.category))];
  return (
    <section>
      <header className="page-header">
        <div>
          <h1>Archive</h1>
          <p>Kept out of your queue. Never shown again unless restored.</p>
        </div>
      </header>
      <div className="archive-layout">
        <div>
          <div className="filter-row">
            <label>
              <FiSearch />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search archive" />
            </label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
          </div>
          <div className="archive-table">
            {shownRows.length === 0 && <div className="empty-queue"><FiArchive /><h2>Your archive is empty</h2><p>Discarded stories will stay here so they are not suggested again.</p></div>}
            {shownRows.map((r, i) => (
              <div className="archive-row" key={r.id}>
                <div>
                  <h3>{r.title}</h3>
                  <small>Direct source article · Jul {16 - i}, 2026</small>
                </div>
                <span className="chip">{r.category}</span>
                <span className="reason">
                  {i % 2 ? "Duplicate coverage" : "Discarded by editor"}
                </span>
                <button onClick={() => restore(r.id)}>
                  <FiRefreshCw /> Restore
                </button>
              </div>
            ))}
          </div>
        </div>
        <aside className="duplicate-card">
          <h2>Duplicate protection</h2>
          <p>
            We automatically identify and exclude content that’s too similar to
            what you’ve already queued or published.
          </p>
          <Requirement
            title="Canonical URLs"
            text="Exact sources are blocked across all future searches."
          />
          <Requirement
            title="Title similarity"
            text="Semantic matching avoids near-duplicates."
          />
          <Requirement
            title="Saved exclusions"
            text="Every removal has a clear reason and can be restored."
          />
        </aside>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
