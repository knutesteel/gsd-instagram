import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  FiArchive,
  FiArrowLeft,
  FiArrowRight,
  FiBarChart2,
  FiBookmark,
  FiCheck,
  FiChevronDown,
  FiClock,
  FiCompass,
  FiCopy,
  FiEdit3,
  FiExternalLink,
  FiFileText,
  FiGrid,
  FiHelpCircle,
  FiMoreHorizontal,
  FiPlus,
  FiRefreshCw,
  FiSearch,
  FiStar,
  FiTrash2,
  FiUpload,
  FiUsers,
  FiX,
} from "react-icons/fi";
import "./styles.css";
import "./dashboard.css";
import "./toast.css";
import "./auth.css";
import { supabase, supabaseConfigured } from "./lib/supabase";

type Screen =
  | "dashboard"
  | "articles"
  | "discover"
  | "detail"
  | "insights"
  | "archive";
type Toast = { message: string; kind: "success" | "error" };
type StatusMismatch = { identifier: string; appStatus: string; sheetStatus: string };
type Notify = (message: string, kind?: Toast["kind"]) => void;
type Story = {
  id: string;
  title: string;
  createdAt: string | null;
  postedAt: string | null;
  overview: string;
  category: string;
  source: string;
  postHandoffAt: string | null;
  isFavorite: boolean;
  score: number;
  url?: string;
  type: string;
  status: "New" | "Auto-Added" | "Sent to Sheets" | "Generated" | "Approved" | "Posted" | "Archived";
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
    postedAt: row.posted_at ?? null,
    generationIdentifier: row.generation_identifier ?? null,
    generationSheetRow: row.generation_sheet_row ?? null,
    url: isTextOverview ? "" : row.source_url ?? row.canonical_url ?? "",
    overview: postConcept?.summary ?? "",
    category: row.category ?? "Uncategorized",
    source: row.source ?? "",
    postHandoffAt: row.post_handoff_at ?? null,
    isFavorite: Boolean(row.is_favorite),
    score: row.rank ?? 0,
    type: postConcept?.post_type ?? "carousel",
    featuredImage: featuredImageOverride || embeddedImage || (sheetImage ? displayImageUrl(sheetImage) : null),
    featuredImageFallback: sheetImage ? directImageFallback(sheetImage) : null,
    status: (row.status === "discarded" ? "Archived" : row.status === "auto_added" ? "Auto-Added" : row.status === "sent_to_sheets" ? "Sent to Sheets" : row.status === "generated" ? "Generated" : row.status === "approved_to_post" ? "Approved" : row.status === "posted" ? "Posted" : "New") as Story["status"],
  };
}

function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    new URLSearchParams(window.location.search).get("view") === "insights" ? "insights" : "dashboard"
  );
  const [items, setItems] = useState<Story[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [articleStatusFilter, setArticleStatusFilter] = useState<"all" | Story["status"]>("all");
  const [searching, setSearching] = useState(false);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [statusMismatches, setStatusMismatches] = useState<StatusMismatch[]>([]);
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
      .select("id,title,created_at,posted_at,generation_identifier,generation_sheet_row,source_url,canonical_url,source,post_handoff_at,is_favorite,category,rank,status,post_concepts(id,post_type,summary,image_summary)")
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
    // One-time repair for any legacy app record. New and Archived records also
    // require durable identifiers even when they never reach Google Sheets.
    const needsIdentifierRepair = items.some((item) =>
      !/^\d+(?:-\d+)?$/.test(String(item.generationIdentifier ?? "").trim()),
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
  const updateStatus = async (id: string, status: "discarded" | "new" | "auto_added" | "sent_to_sheets" | "generated" | "approved_to_post" | "posted") => {
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
  const saveDetail = async (articleId: string, values: DetailValues) => {
    if (!supabase) return;
    const hashtags = normalizeHashtags(values.hashtags);
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    const response = await fetch("/api/update-sheet-detail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ articleId, values: { ...values, hashtags } }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Couldn’t synchronize article changes.");
    setItems((old) => old.map((item) => item.id === articleId ? { ...item, title: values.title, url: values.url, source: values.source, score: values.score, type: values.postType } : item));
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
    if (!supabase || syncingGeneratedContent.current) return { updatedArticleIds: [], statuses: {}, statusMismatches: [], imagesByArticleId: {} };
    syncingGeneratedContent.current = true;
    try {
    const { data } = await supabase.auth.getSession(); if (!data.session) return;
    const response = await fetch("/api/sync-sheet-generation", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } });
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Couldn’t sync generated content.");
    setStatusMismatches(Array.isArray(result.statusMismatches) ? result.statusMismatches : []);
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
    if (Array.isArray(result.syncErrors) && result.syncErrors.length) {
      const details = result.syncErrors
        .map((item: { identifier?: string; error?: string }) => `#${item.identifier ?? "?"}: ${item.error ?? "Synchronization failed."}`)
        .join(" ");
      throw new Error(`Sheet synchronization completed with errors. ${details}`);
    }
    return result;
    } finally {
      syncingGeneratedContent.current = false;
    }
  };
  const markPostHandoff = async (articleId: string) => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const postHandoffAt = new Date().toISOString();
    const { error } = await supabase.from("articles").update({ post_handoff_at: postHandoffAt }).eq("id", articleId);
    if (error) throw new Error(`Couldn’t record the Instagram handoff: ${error.message}`);
    setItems((old) => old.map((item) => item.id === articleId ? { ...item, postHandoffAt } : item));
  };
  const toggleFavorite = async (articleId: string, isFavorite: boolean) => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.from("articles").update({ is_favorite: isFavorite }).eq("id", articleId);
    if (error) throw new Error(`Couldn’t update favorite: ${error.message}`);
    setItems((old) => old.map((item) => item.id === articleId ? { ...item, isFavorite } : item));
  };
  const duplicateIdea = async (articleId: string) => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await supabase.rpc("duplicate_article_idea", { source_article_id: articleId });
    if (error) throw new Error(`Couldn’t duplicate this idea: ${error.message}`);
    const duplicate = Array.isArray(data) ? data[0] : data;
    if (!duplicate?.article_id) throw new Error("The duplicate was created without a record identifier.");
    await loadStories();
    setSelected(duplicate.article_id);
    await loadConcept(duplicate.article_id);
    setScreen("detail");
    return duplicate as { article_id: string; generation_identifier: string };
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
      void syncGeneratedContent().catch((error) => notify(error instanceof Error ? error.message : "Automatic sheet synchronization failed.", "error"));
    };
    const initialRefresh = window.setTimeout(refreshFromSheet, 750);
    const refreshInterval = window.setInterval(refreshFromSheet, 10_000);
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
              { key: "insights", icon: <FiBarChart2 />, label: "Instagram Insights" },
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
          <a
            className="nav-item"
            href="https://hank-squirrel-collaborations.knutesteel.chatgpt.site/"
            target="_blank"
            rel="noreferrer"
          >
            <FiUsers />
            <span>Collaborations</span>
          </a>
          <button
            className={screen === "archive" ? "nav-item nav-archive active" : "nav-item nav-archive"}
            onClick={() => setScreen("archive")}
          >
            <FiArchive />
            <span>Archive</span>
          </button>
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
            statusMismatches={statusMismatches}
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
            toggleFavorite={(id, isFavorite) => void toggleFavorite(id, isFavorite).catch((error) => notify(error instanceof Error ? error.message : "Couldn’t update favorite.", "error"))}
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
            markPostHandoff={markPostHandoff}
            toggleFavorite={(isFavorite) => toggleFavorite(active.id, isFavorite)}
            duplicateIdea={() => duplicateIdea(active.id)}
          />
        )}
        {screen === "insights" && <InstagramInsights notify={notify} />}
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

type InstagramConnection = {
  instagram_username: string | null;
  facebook_page_name: string | null;
  followers_count: number | null;
  last_synced_at: string | null;
  last_following_import_at: string | null;
  last_followers_import_at: string | null;
  token_expires_at: string | null;
};

type InstagramPost = {
  id: string;
  article_id: string | null;
  caption: string;
  media_type: string | null;
  media_product_type: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  permalink: string | null;
  posted_at: string | null;
  views: number;
  reach: number;
  like_count: number;
  comments_count: number;
  saved: number;
  shares: number;
  total_interactions: number;
  engagement_rate: number;
};

type InstagramSortField =
  | "post"
  | "views"
  | "reach"
  | "like_count"
  | "comments_count"
  | "saved"
  | "shares"
  | "engagement_rate";

type InstagramCollaborationProspect = {
  id: string;
  username: string;
  display_name: string | null;
  biography: string | null;
  profile_url: string | null;
  profile_picture_url: string | null;
  followers_count: number | null;
  profile_data_available: boolean;
  fit_score: number;
  fit_label: string;
  fit_analysis: string;
  enriched_at: string | null;
  collaboration_status: CollaborationStatus;
  content_analysis: string;
  brand_fit_analysis: string;
  existing_collaborations: string;
  recommended_outreach: string;
  researched_at: string | null;
  analysis_status: AnalysisStatus;
};

type InstagramSavedItem = {
  id: string;
  instagram_url: string;
  shortcode: string | null;
  media_type: string;
  title: string;
  content_overview: string;
  saved_at: string | null;
  imported_at: string;
  review_status: SavedItemStatus;
};

type CollaborationStatus = "explore" | "reached_out" | "in_discussions" | "in_place" | "disqualified";
type AnalysisStatus = "not_reviewed" | "automated_review" | "deep_review" | "unavailable";
type SavedItemStatus = "not_reviewed" | "keep" | "delete";

const COLLABORATION_STATUS_LABELS: Record<CollaborationStatus, string> = {
  explore: "Explore",
  reached_out: "Reached Out",
  in_discussions: "In Discussions",
  in_place: "In Place",
  disqualified: "Disqualified",
};

const ANALYSIS_STATUS_LABELS: Record<AnalysisStatus, string> = {
  not_reviewed: "Not Reviewed",
  automated_review: "Automated Review",
  deep_review: "Deep Review",
  unavailable: "Unavailable",
};

const SAVED_ITEM_STATUS_LABELS: Record<SavedItemStatus, string> = {
  not_reviewed: "Not Reviewed",
  keep: "Keep",
  delete: "Delete",
};

function InstagramInsights({ notify }: { notify: Notify }) {
  const [tab, setTab] = useState<"performance" | "saved" | "following" | "followers">("performance");
  const [connection, setConnection] = useState<InstagramConnection | null>(null);
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [prospects, setProspects] = useState<InstagramCollaborationProspect[]>([]);
  const [followers, setFollowers] = useState<InstagramCollaborationProspect[]>([]);
  const [savedItems, setSavedItems] = useState<InstagramSavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [showExportInstructions, setShowExportInstructions] = useState(false);
  const followingFileRef = useRef<HTMLInputElement>(null);
  const followersFileRef = useRef<HTMLInputElement>(null);
  const savedFileRef = useRef<HTMLInputElement>(null);
  const [sortField, setSortField] = useState<InstagramSortField>("post");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const load = async (retryConnection = false) => {
    if (!supabase) return;
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error("Please sign in again.");
    let status: { connection: InstagramConnection | null; posts: any[]; savedItems?: InstagramSavedItem[]; prospects?: InstagramCollaborationProspect[]; following?: InstagramCollaborationProspect[]; followers?: InstagramCollaborationProspect[] } | null = null;
    const attempts = retryConnection ? [0, 250, 500, 1000] : [0];
    for (const delay of attempts) {
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
      const response = await fetch("/api/instagram-status", {
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn’t load Instagram insights.");
      status = result;
      if (status?.connection || !retryConnection) break;
    }
    if (!status) throw new Error("Couldn’t load Instagram insights.");
    setConnection(status.connection);
    setPosts((status.posts ?? []).map((row: any) => {
      const latest = [...(row.instagram_media_insights ?? [])].sort((a, b) => String(b.captured_on).localeCompare(String(a.captured_on)))[0] ?? {};
      const raw = latest.raw_metrics ?? {};
      const reach = Number(latest.reach || 0);
      const interactions = Number(latest.total_interactions || (Number(row.like_count || 0) + Number(row.comments_count || 0) + Number(latest.saved || 0) + Number(latest.shares || 0)));
      return {
        ...row,
        posted_at: row.published_at,
        views: Number(latest.views || 0),
        reach,
        saved: Number(latest.saved || 0),
        shares: Number(latest.shares || 0),
        total_interactions: interactions,
        engagement_rate: Number(raw.engagement_rate ?? (reach ? (interactions / reach) * 100 : 0)),
      };
    }) as InstagramPost[]);
    setProspects((status.following ?? status.prospects ?? []) as InstagramCollaborationProspect[]);
    setFollowers((status.followers ?? []) as InstagramCollaborationProspect[]);
    setSavedItems((status.savedItems ?? []) as InstagramSavedItem[]);
    setLoading(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("instagram") === "connected";
    if (connected) {
      notify("Instagram connected successfully.");
      window.history.replaceState({}, "", `${window.location.pathname}?view=insights`);
    } else if (params.get("instagram") === "error") {
      notify(params.get("message") || "Instagram authorization failed.", "error");
      window.history.replaceState({}, "", `${window.location.pathname}?view=insights`);
    }
    if (connected) {
      void sync().catch(async (error) => {
        try {
          await load(true);
        } catch {
          setLoading(false);
        }
        notify(error instanceof Error ? error.message : "Instagram connected, but the first insights refresh failed.", "error");
      });
    } else {
      void load().catch((error) => {
        setLoading(false);
        notify(error instanceof Error ? error.message : "Couldn’t load Instagram insights.", "error");
      });
    }
  }, []);

  const connect = async () => {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    const response = await fetch("/api/instagram-connect", {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
    const result = await response.json();
    if (!response.ok || !result.authorizationUrl) throw new Error(result.error || "Couldn’t start Instagram authorization.");
    window.location.assign(result.authorizationUrl);
  };

  const sync = async () => {
    if (!supabase) return;
    setSyncing(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Please sign in again.");
      const response = await fetch("/api/instagram-sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Instagram refresh failed.");
      await load();
      notify(`Instagram refreshed: ${result.imported} posts, ${result.matched} matched to app records.`);
    } finally {
      setSyncing(false);
    }
  };

  const enrichFollowing = async () => {
    if (!supabase) return;
    setEnriching(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Please sign in again.");
      let remaining = 1;
      let processed = 0;
      let enriched = 0;
      while (remaining > 0) {
        const response = await fetch("/api/instagram-following-enrich", {
          method: "POST",
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Couldn’t refresh collaboration profiles.");
        processed += Number(result.processed || 0);
        enriched += Number(result.enriched || 0);
        remaining = Number(result.remaining || 0);
        if (!result.processed) break;
      }
      await load();
      notify(`Reviewed ${processed} followed accounts; Meta supplied follower data for ${enriched} professional profiles.`);
    } finally {
      setEnriching(false);
    }
  };

  const importRelationship = async (event: React.ChangeEvent<HTMLInputElement>, relationshipType: "following" | "followers") => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !supabase) return;
    setImporting(true);
    try {
      const html = await file.text();
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Please sign in again.");
      const response = await fetch("/api/instagram-following-import", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ html, relationship_type: relationshipType }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Couldn’t import the Instagram ${relationshipType} list.`);
      await load();
      notify(`Imported ${result.imported} ${relationshipType === "followers" ? "followers" : "followed accounts"}. Refreshing available professional-profile data now.`);
      await enrichFollowing();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn’t import the Instagram HTML export.", "error");
    } finally {
      setImporting(false);
    }
  };

  const importSavedItems = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !supabase) return;
    setImporting(true);
    try {
      const html = await file.text();
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Please sign in again.");
      const response = await fetch("/api/instagram-saved-import", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ html }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn’t import saved Instagram items.");
      await load();
      notify(`Imported ${Number(result.imported || 0).toLocaleString()} saved Instagram items.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn’t import the saved-items HTML export.", "error");
    } finally {
      setImporting(false);
    }
  };

  const updateCollaborationStatus = async (ids: string[], status: CollaborationStatus) => {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    const response = await fetch("/api/instagram-collaboration-status", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids, status }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Couldn’t update the selected accounts.");
    const changed = new Set(ids);
    const applyStatus = (rows: InstagramCollaborationProspect[]) => rows.map((row) =>
      changed.has(row.id) ? { ...row, collaboration_status: status } : row);
    setProspects(applyStatus);
    setFollowers(applyStatus);
    notify(`Moved ${Number(result.updated || ids.length).toLocaleString()} account${ids.length === 1 ? "" : "s"} to ${COLLABORATION_STATUS_LABELS[status]}.`);
  };

  const updateSavedItemStatus = async (id: string, status: SavedItemStatus) => {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    const response = await fetch("/api/instagram-saved-status", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, status }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Couldn’t update the saved item.");
    setSavedItems((rows) => rows.map((row) => row.id === id ? { ...row, review_status: status } : row));
    notify(status === "delete" ? "Saved item removed from view." : `Saved item marked ${SAVED_ITEM_STATUS_LABELS[status]}.`);
  };

  const sum = (field: keyof Pick<InstagramPost, "views" | "reach" | "total_interactions" | "saved" | "shares">) =>
    posts.reduce((total, post) => total + Number(post[field] || 0), 0);
  const totalReach = sum("reach");
  const totalInteractions = sum("total_interactions") || posts.reduce((total, post) =>
    total + Number(post.like_count || 0) + Number(post.comments_count || 0) + Number(post.saved || 0) + Number(post.shares || 0), 0);
  const overallEngagement = totalReach ? ((totalInteractions / totalReach) * 100).toFixed(2) : "0.00";
  const sortedPosts = useMemo(() => [...posts].sort((a, b) => {
    let comparison = 0;
    if (sortField === "post") {
      comparison = (a.posted_at ? new Date(a.posted_at).getTime() : 0) - (b.posted_at ? new Date(b.posted_at).getTime() : 0);
      if (!comparison) comparison = a.caption.localeCompare(b.caption);
    } else {
      comparison = Number(a[sortField] || 0) - Number(b[sortField] || 0);
    }
    if (!comparison) comparison = a.id.localeCompare(b.id);
    return sortDirection === "asc" ? comparison : -comparison;
  }), [posts, sortDirection, sortField]);

  const changeSort = (field: InstagramSortField) => {
    if (field === sortField) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortField(field);
    setSortDirection("desc");
  };

  const SortHeader = ({ field, children }: { field: InstagramSortField; children: React.ReactNode }) => {
    const active = sortField === field;
    return <button
      type="button"
      className={`instagram-sort-header${active ? " active" : ""}`}
      onClick={() => changeSort(field)}
      aria-label={`Sort by ${String(children)} ${active && sortDirection === "desc" ? "ascending" : "descending"}`}
    >
      <span>{children}</span>
      <span className="instagram-sort-indicator" aria-hidden="true">{active ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}</span>
    </button>;
  };

  return <section>
    <header className="page-header">
      <div>
        <h1>Instagram Insights</h1>
        <p>{tab === "performance" ? "Post views, reach, engagement, and performance for your connected business account." : tab === "saved" ? "Instagram posts and Reels you saved for future Hank and the Squirrel ideas." : tab === "following" ? "Accounts you follow, audience size, and collaboration fit for Hank and the Squirrel." : "Accounts that follow you, audience size, and collaboration fit for Hank and the Squirrel."}</p>
      </div>
      <div className="page-actions">
        {connection && (tab === "following" || tab === "followers") && <>
          <input ref={followingFileRef} type="file" accept=".html,text/html" hidden onChange={(event) => void importRelationship(event, "following")} />
          <input ref={followersFileRef} type="file" accept=".html,text/html" hidden onChange={(event) => void importRelationship(event, "followers")} />
          <button className="button" onClick={() => setShowExportInstructions(true)}><FiHelpCircle /> Export instructions</button>
          <button className="button" disabled={importing || enriching} onClick={() => (tab === "following" ? followingFileRef : followersFileRef).current?.click()}><FiUpload /> {importing ? "Importing…" : `Import ${tab} HTML`}</button>
          {!!(tab === "following" ? prospects : followers).length && <button className="button primary" disabled={enriching || importing} onClick={() => void enrichFollowing().catch((error) => notify(error instanceof Error ? error.message : "Couldn’t refresh profiles.", "error"))}><FiRefreshCw className={enriching ? "spin" : ""} /> {enriching ? "Analyzing…" : "Refresh profiles"}</button>}
        </>}
        {connection && tab === "saved" && <>
          <input ref={savedFileRef} type="file" accept=".html,text/html" hidden onChange={(event) => void importSavedItems(event)} />
          <button className="button" onClick={() => setShowExportInstructions(true)}><FiHelpCircle /> Export instructions</button>
          <button className="button primary" disabled={importing} onClick={() => savedFileRef.current?.click()}><FiUpload /> {importing ? "Importing…" : "Import saved HTML"}</button>
        </>}
        {tab === "performance" && (connection
          ? <button className="button primary" disabled={syncing} onClick={() => void sync().catch((error) => notify(error instanceof Error ? error.message : "Instagram refresh failed.", "error"))}><FiRefreshCw className={syncing ? "spin" : ""} /> {syncing ? "Refreshing…" : "Refresh insights"}</button>
          : <button className="button primary" onClick={() => void connect().catch((error) => notify(error instanceof Error ? error.message : "Couldn’t connect Instagram.", "error"))}>Connect Instagram</button>)}
      </div>
    </header>
    {showExportInstructions && <InstagramExportInstructions onClose={() => setShowExportInstructions(false)} />}
    <div className="instagram-tabs" role="tablist" aria-label="Instagram insight views">
      <button type="button" role="tab" aria-selected={tab === "performance"} className={tab === "performance" ? "active" : ""} onClick={() => setTab("performance")}><FiBarChart2 /> Post performance</button>
      <button type="button" role="tab" aria-selected={tab === "saved"} className={tab === "saved" ? "active" : ""} onClick={() => setTab("saved")}><FiBookmark /> Saved Items</button>
      <button type="button" role="tab" aria-selected={tab === "following"} className={tab === "following" ? "active" : ""} onClick={() => setTab("following")}><FiUsers /> Following</button>
      <button type="button" role="tab" aria-selected={tab === "followers"} className={tab === "followers" ? "active" : ""} onClick={() => setTab("followers")}><FiUsers /> Followers</button>
    </div>
    {loading ? <div className="panel">Loading Instagram insights…</div> : !connection ? <div className="panel instagram-connect-card">
      <FiBarChart2 />
      <h2>Connect @hankandthesquirrel</h2>
      <p>Authorize the Facebook Page connected to your Instagram Business account. Meta credentials remain server-side.</p>
      <button className="button primary" onClick={() => void connect().catch((error) => notify(error instanceof Error ? error.message : "Couldn’t connect Instagram.", "error"))}>Connect Instagram</button>
    </div> : tab === "saved" ? <InstagramSavedItems items={savedItems} importing={importing} onImport={() => savedFileRef.current?.click()} onStatusChange={updateSavedItemStatus} notify={notify} /> : tab === "following" ? <InstagramCollaborationTab relationshipType="following" prospects={prospects} lastImportedAt={connection.last_following_import_at} onImport={() => followingFileRef.current?.click()} importing={importing} onStatusChange={updateCollaborationStatus} notify={notify} /> : tab === "followers" ? <InstagramCollaborationTab relationshipType="followers" prospects={followers} lastImportedAt={connection.last_followers_import_at} onImport={() => followersFileRef.current?.click()} importing={importing} onStatusChange={updateCollaborationStatus} notify={notify} /> : <>
      <div className="instagram-account-bar">
        <div><b>@{connection.instagram_username || "Instagram account"}</b><span>{connection.facebook_page_name || "Connected Facebook Page"}</span></div>
        <span>{connection.last_synced_at ? `Last refreshed ${new Date(connection.last_synced_at).toLocaleString()}` : "Ready for first refresh"}</span>
      </div>
      <div className="insights-metrics">
        <InsightMetric label="Followers" value={Number(connection.followers_count || 0).toLocaleString()} />
        <InsightMetric label="Posts collected" value={posts.length.toLocaleString()} />
        <InsightMetric label="Views" value={sum("views").toLocaleString()} />
        <InsightMetric label="Reach" value={totalReach.toLocaleString()} />
        <InsightMetric label="Interactions" value={totalInteractions.toLocaleString()} />
        <InsightMetric label="Engagement rate" value={`${overallEngagement}%`} />
      </div>
      <div className="instagram-post-table">
        <div className="instagram-post-head">
          <SortHeader field="post">Post</SortHeader>
          <SortHeader field="views">Views</SortHeader>
          <SortHeader field="reach">Reach</SortHeader>
          <SortHeader field="like_count">Likes</SortHeader>
          <SortHeader field="comments_count">Comments</SortHeader>
          <SortHeader field="saved">Saves</SortHeader>
          <SortHeader field="shares">Shares</SortHeader>
          <SortHeader field="engagement_rate">Engagement</SortHeader>
        </div>
        {!posts.length && <div className="empty-queue"><FiBarChart2 /><h2>No posts collected yet</h2><p>Select Refresh insights to import your recent Instagram posts.</p></div>}
        {sortedPosts.map((post) => <div className="instagram-post-row" key={post.id}>
          <div className="instagram-post-summary">
            {post.thumbnail_url || post.media_url ? <img src={post.thumbnail_url || post.media_url || ""} alt="" /> : <span className="instagram-post-placeholder"><FiBarChart2 /></span>}
            <div>
              {post.permalink ? <a href={post.permalink} target="_blank" rel="noreferrer">{post.caption.slice(0, 100) || "Instagram post"} <FiExternalLink /></a> : <b>{post.caption.slice(0, 100) || "Instagram post"}</b>}
              <small>{post.posted_at ? new Date(post.posted_at).toLocaleDateString() : "Date unavailable"} · {post.media_product_type || post.media_type || "Post"}{post.article_id ? " · Matched" : ""}</small>
            </div>
          </div>
          <span>{Number(post.views || 0).toLocaleString()}</span><span>{Number(post.reach || 0).toLocaleString()}</span><span>{Number(post.like_count || 0).toLocaleString()}</span><span>{Number(post.comments_count || 0).toLocaleString()}</span><span>{Number(post.saved || 0).toLocaleString()}</span><span>{Number(post.shares || 0).toLocaleString()}</span><span>{Number(post.engagement_rate || 0).toFixed(2)}%</span>
        </div>)}
      </div>
    </>}
  </section>;
}

function InstagramSavedItems({ items, importing, onImport, onStatusChange, notify }: { items: InstagramSavedItem[]; importing: boolean; onImport: () => void; onStatusChange: (id: string, status: SavedItemStatus) => Promise<void>; notify: Notify }) {
  const [statusFilter, setStatusFilter] = useState<SavedItemStatus | "all">("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const visibleItems = items.filter((item) =>
    item.review_status !== "delete" && (statusFilter === "all" || item.review_status === statusFilter));

  const changeStatus = async (id: string, status: SavedItemStatus) => {
    setUpdatingId(id);
    try {
      await onStatusChange(id, status);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn’t update the saved item.", "error");
    } finally {
      setUpdatingId(null);
    }
  };

  if (!items.length) return <div className="panel instagram-following-empty">
    <FiBookmark />
    <h2>Import your saved Instagram items</h2>
    <p>Instagram does not include personal saves in its connected-account API. Download your Instagram information in HTML format, then upload the saved-posts file here.</p>
    <button className="button primary" disabled={importing} onClick={onImport}><FiUpload /> {importing ? "Importing…" : "Import saved HTML"}</button>
  </div>;
  return <>
    <div className="instagram-saved-toolbar">
      <div className="instagram-collaboration-note">Showing {visibleItems.length.toLocaleString()} saved posts and Reels. Items marked Delete are hidden.</div>
      <label>Status
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SavedItemStatus | "all")}>
          <option value="all">All active</option>
          <option value="not_reviewed">Not Reviewed</option>
          <option value="keep">Keep</option>
        </select>
      </label>
    </div>
    <div className="instagram-saved-table">
      <div className="instagram-saved-row instagram-saved-header">
        <span>Title</span><span>Content overview</span><span>Status</span>
      </div>
      {visibleItems.map((item) => <div className="instagram-saved-row" key={item.id}>
        <a href={item.instagram_url} target="_blank" rel="noreferrer">{item.title || (item.media_type === "reel" ? "Instagram Reel" : "Instagram Post")} <FiExternalLink /></a>
        <span className="instagram-saved-overview">{item.content_overview || "No content overview is available."}</span>
        <select aria-label={`Status for ${item.title || "saved Instagram item"}`} value={item.review_status} disabled={updatingId === item.id} onChange={(event) => void changeStatus(item.id, event.target.value as SavedItemStatus)}>
          {Object.entries(SAVED_ITEM_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>)}
      {!visibleItems.length && <div className="empty-queue"><FiBookmark /><h2>No matching saved items</h2><p>Choose another status or import a newer Instagram export.</p></div>}
    </div>
  </>;
}

function InstagramExportInstructions({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <div className="instagram-export-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div className="instagram-export-dialog" role="dialog" aria-modal="true" aria-labelledby="instagram-export-title">
      <button className="modal-close instagram-export-close" aria-label="Close export instructions" onClick={onClose}><FiX /></button>
      <FiUpload className="instagram-export-icon" />
      <h2 id="instagram-export-title">Export Instagram account data</h2>
      <p>Instagram does not share followers, following, or personal saved items through its API, so download the official HTML export and import each file into its matching tab.</p>
      <ol>
        <li>Open Instagram, then go to <b>Settings and activity → Accounts Center</b>.</li>
        <li>Select <b>Your information and permissions → Export your information → Create export</b>.</li>
        <li>Choose your <b>@hankandthesquirrel</b> profile, select <b>Export to device</b>, then choose <b>Some of your information</b>.</li>
        <li>Select <b>Followers and following</b> for the relationship tabs and <b>Saved</b> or <b>Saved posts</b> for Saved Items. Set the date range to <b>All time</b> and the format to <b>HTML</b>.</li>
        <li>Create the export. Instagram will notify you when the ZIP file is ready; download and unzip it.</li>
        <li>Return here and upload <code>following.html</code> in Following, <code>followers_1.html</code> in Followers, and the saved-posts HTML file in Saved Items. If Instagram splits an export across multiple files, upload each file.</li>
      </ol>
      <div className="instagram-export-actions">
        <a className="button" href="https://www.facebook.com/help/instagram/181231772500920" target="_blank" rel="noreferrer">Open Meta help <FiExternalLink /></a>
        <button className="button primary" onClick={onClose}>Got it</button>
      </div>
    </div>
  </div>;
}

function InstagramCollaborationTab({ relationshipType, prospects, lastImportedAt, onImport, importing, onStatusChange, notify }: { relationshipType: "following" | "followers"; prospects: InstagramCollaborationProspect[]; lastImportedAt: string | null; onImport: () => void; importing: boolean; onStatusChange: (ids: string[], status: CollaborationStatus) => Promise<void>; notify: Notify }) {
  const [sort, setSort] = useState<"username" | "followers_count" | "fit_score">("fit_score");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<CollaborationStatus | "all">("all");
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisStatus | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<CollaborationStatus>("explore");
  const [updating, setUpdating] = useState(false);
  const [updatingStatusIds, setUpdatingStatusIds] = useState<Set<string>>(new Set());
  const activeProspects = useMemo(() => prospects.filter((prospect) =>
    (prospect.collaboration_status || "explore") !== "disqualified"
  ), [prospects]);
  const visibleProspects = useMemo(() => activeProspects.filter((prospect) =>
    (statusFilter === "all" || (prospect.collaboration_status || "explore") === statusFilter)
    && (analysisFilter === "all" || (prospect.analysis_status || "not_reviewed") === analysisFilter)
  ), [activeProspects, analysisFilter, statusFilter]);
  const sorted = useMemo(() => [...visibleProspects].sort((a, b) => {
    const comparison = sort === "username"
      ? a.username.localeCompare(b.username)
      : Number(a[sort] ?? -1) - Number(b[sort] ?? -1);
    return direction === "asc" ? comparison : -comparison;
  }), [direction, sort, visibleProspects]);
  useEffect(() => {
    const available = new Set(activeProspects.map((prospect) => prospect.id));
    setSelected((current) => new Set([...current].filter((id) => available.has(id))));
  }, [activeProspects]);
  const changeSort = (field: typeof sort) => {
    if (field === sort) setDirection((value) => value === "asc" ? "desc" : "asc");
    else {
      setSort(field);
      setDirection(field === "username" ? "asc" : "desc");
    }
  };
  const Header = ({ field, children }: { field: typeof sort; children: React.ReactNode }) => <button type="button" className={`instagram-sort-header${sort === field ? " active" : ""}`} onClick={() => changeSort(field)}>
    <span>{children}</span><span className="instagram-sort-indicator">{sort === field ? (direction === "asc" ? "▲" : "▼") : "↕"}</span>
  </button>;
  const toggleSelected = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleExpanded = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allVisibleSelected = sorted.length > 0 && sorted.every((prospect) => selected.has(prospect.id));
  const applyBulkStatus = async () => {
    if (!selected.size) return;
    setUpdating(true);
    try {
      await onStatusChange([...selected], bulkStatus);
      setSelected(new Set());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn’t update the selected accounts.", "error");
    } finally {
      setUpdating(false);
    }
  };
  const applyInlineStatus = async (id: string, status: CollaborationStatus) => {
    setUpdatingStatusIds((current) => new Set(current).add(id));
    try {
      await onStatusChange([id], status);
      if (status === "disqualified") {
        setSelected((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setExpanded((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn’t update this account.", "error");
    } finally {
      setUpdatingStatusIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };
  if (!prospects.length) return <div className="panel instagram-following-empty">
    <FiUsers />
    <h2>Import {relationshipType === "followers" ? "your followers" : "the accounts you follow"}</h2>
    <p>Download your Instagram information in HTML format, then upload the matching <code>{relationshipType === "followers" ? "followers_1.html" : "following.html"}</code> file here. Professional profiles will be enriched with follower totals; personal and private profiles will be marked unavailable.</p>
    <button className="button primary" disabled={importing} onClick={onImport}><FiUpload /> {importing ? "Importing…" : `Import ${relationshipType} HTML`}</button>
  </div>;
  const refreshDue = !lastImportedAt || Date.now() - new Date(lastImportedAt).getTime() >= 3 * 24 * 60 * 60 * 1000;
  return <>
    {refreshDue && <div className="instagram-following-reminder" role="status">
      <div><FiRefreshCw /><span><strong>Time to update your {relationshipType}</strong><small>Import a fresh Instagram {relationshipType} HTML file. This reminder appears every three days after your last update.</small></span></div>
      <button className="button primary" disabled={importing} onClick={onImport}><FiUpload /> {importing ? "Importing…" : "Update now"}</button>
    </div>}
    <div className="instagram-collaboration-note">Showing {visibleProspects.length.toLocaleString()} of {activeProspects.length.toLocaleString()} active {relationshipType === "followers" ? "followers" : "followed accounts"}. Select an account to open its content review, Hank and the Squirrel fit, collaboration evidence, and recommended outreach.</div>
    <div className="instagram-collaboration-controls">
      <div className="instagram-collaboration-filters">
        <label>Pipeline status <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CollaborationStatus | "all")}>
          <option value="all">All pipeline statuses</option>
          {Object.entries(COLLABORATION_STATUS_LABELS).filter(([value]) => value !== "disqualified").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Analysis status <select value={analysisFilter} onChange={(event) => setAnalysisFilter(event.target.value as AnalysisStatus | "all")}>
          <option value="all">All analysis statuses</option>
          {Object.entries(ANALYSIS_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
      <div className="instagram-bulk-actions">
        <span>{selected.size.toLocaleString()} selected</span>
        <select aria-label="New status for selected accounts" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as CollaborationStatus)}>
          {Object.entries(COLLABORATION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className="button primary" disabled={!selected.size || updating} onClick={() => void applyBulkStatus()}>{updating ? "Updating…" : "Change status"}</button>
      </div>
    </div>
    <div className="instagram-collaboration-table">
      <div className="instagram-collaboration-head">
        <input type="checkbox" aria-label="Select all visible accounts" checked={allVisibleSelected} onChange={(event) => setSelected((current) => {
          const next = new Set(current);
          sorted.forEach((prospect) => event.target.checked ? next.add(prospect.id) : next.delete(prospect.id));
          return next;
        })} />
        <Header field="username">Account</Header>
        <Header field="followers_count">Followers</Header>
        <Header field="fit_score">Fit</Header>
        <span>Analysis</span>
        <span>Status</span>
        <span aria-hidden="true" />
      </div>
      {sorted.map((prospect) => <div className={`instagram-collaboration-record${expanded.has(prospect.id) ? " expanded" : ""}`} key={prospect.id}>
        <div className="instagram-collaboration-row">
          <input type="checkbox" aria-label={`Select @${prospect.username}`} checked={selected.has(prospect.id)} onChange={() => toggleSelected(prospect.id)} />
          <button className="instagram-prospect instagram-prospect-button" type="button" aria-expanded={expanded.has(prospect.id)} onClick={() => toggleExpanded(prospect.id)}>
            {prospect.profile_picture_url ? <img src={prospect.profile_picture_url} alt="" /> : <span className="instagram-prospect-avatar"><FiUsers /></span>}
            <span><b>@{prospect.username}</b>{prospect.display_name && <small>{prospect.display_name}</small>}</span>
          </button>
          <span>{prospect.profile_data_available && prospect.followers_count !== null ? Number(prospect.followers_count).toLocaleString() : "Unavailable"}</span>
          <span className={`fit-badge fit-${prospect.fit_label.toLowerCase()}`}>{prospect.fit_label} · {prospect.fit_score}</span>
          <span className={`analysis-status analysis-${prospect.analysis_status || "not_reviewed"}`}>{ANALYSIS_STATUS_LABELS[prospect.analysis_status || "not_reviewed"]}</span>
          <select
            className={`collaboration-status-select status-${prospect.collaboration_status || "explore"}`}
            aria-label={`Status for @${prospect.username}`}
            value={prospect.collaboration_status || "explore"}
            disabled={updatingStatusIds.has(prospect.id)}
            onChange={(event) => void applyInlineStatus(prospect.id, event.target.value as CollaborationStatus)}
          >
            {Object.entries(COLLABORATION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button type="button" className="instagram-expand-button" aria-label={`${expanded.has(prospect.id) ? "Collapse" : "Expand"} @${prospect.username}`} onClick={() => toggleExpanded(prospect.id)}><FiChevronDown /></button>
        </div>
        {expanded.has(prospect.id) && <div className="instagram-collaboration-details">
          <div className="instagram-detail-heading">
            <div><h3>@{prospect.username}</h3><p>{prospect.biography || "No biography available."}</p></div>
            <a className="button" href={prospect.profile_url || `https://www.instagram.com/${prospect.username}/`} target="_blank" rel="noreferrer">Open Instagram <FiExternalLink /></a>
          </div>
          <div className="instagram-research-grid">
            <article><h4>Content review</h4><p>{prospect.content_analysis || "Detailed content review is pending."}</p></article>
            <article><h4>Fit with Hank and the Squirrel</h4><p>{prospect.brand_fit_analysis || prospect.fit_analysis}</p></article>
            <article><h4>Existing collaborations</h4><p>{prospect.existing_collaborations || "No visible collaboration evidence recorded yet."}</p></article>
            <article><h4>Recommended outreach</h4><p>{prospect.recommended_outreach || "Review recent posts before choosing a personalized outreach angle."}</p></article>
          </div>
          <small className="instagram-researched-at">Analysis status: {ANALYSIS_STATUS_LABELS[prospect.analysis_status || "not_reviewed"]}{prospect.researched_at ? ` · Profile reviewed ${new Date(prospect.researched_at).toLocaleDateString()}` : ""}</small>
        </div>}
      </div>)}
    </div>
  </>;
}

function InsightMetric({ label, value }: { label: string; value: string }) {
  return <div className="insight-metric"><strong>{value}</strong><span>{label}</span></div>;
}

function AuthGate() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"status" | "error">("status");
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const sendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    if (!email.trim()) {
      setMessageKind("error");
      setMessage("Enter your email address first.");
      return;
    }
    setSending(true);
    setMessage("");
    setMessageKind("status");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: false,
        },
      });
      if (error) throw error;
      setCode("");
      setCodeSent(true);
      setMessage("We emailed you a new sign-in code. Use the newest email—requesting another code invalidates the previous one.");
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "We couldn’t send a sign-in code. Please try again.");
    } finally {
      setSending(false);
    }
  };
  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    if (code.length < 6 || code.length > 8) {
      setMessageKind("error");
      setMessage("Enter the complete 6–8 digit code from the newest sign-in email.");
      return;
    }
    setSending(true);
    setMessage("");
    setMessageKind("status");
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code,
        type: "email",
      });
      if (error) throw error;
      if (!data.session) throw new Error("The code was accepted, but no session was created. Request a new code and try again.");
      setMessage("Signed in. Loading your workspace…");
      window.location.replace(window.location.origin);
    } catch (error) {
      setMessageKind("error");
      const detail = error instanceof Error ? error.message : "";
      const invalidCode = /expired|invalid|otp_expired/i.test(detail);
      setMessage(invalidCode
        ? "That code is expired or was replaced by a newer one. Click “Send a new code,” then use the code from the newest email."
        : detail || "We couldn’t verify that code. Please request a new one and try again.");
    } finally {
      setSending(false);
    }
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
  return <main className="auth-page"><form className="auth-card" noValidate onSubmit={codeSent ? verifyCode : sendCode}>
    <div className="brand"><span>GSD</span><em>Instagram</em></div>
    <h1>Your story desk</h1><p>Sign in to save research, concepts, and assets privately to your workspace.</p>
    <label className="field"><b>Email address</b><input required disabled={codeSent || sending} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
    {codeSent && <label className="field"><b>Sign-in code</b><input className="auth-code-input" required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="Enter 6–8 digits" /></label>}
    <button type="submit" className="button primary wide" disabled={sending}>{sending ? (codeSent ? "Signing in…" : "Sending…") : (codeSent ? "Sign in with code" : "Email me a sign-in code")}</button>
    {codeSent && <div className="auth-code-actions">
      <button type="button" disabled={sending} onClick={() => { setCodeSent(false); setCode(""); setMessage(""); setMessageKind("status"); }}>Use a different email</button>
      <button type="button" disabled={sending} onClick={(event) => void sendCode(event)}>Send a new code</button>
    </div>}
    <div className="auth-divider"><span>or</span></div>
    <button type="button" className="button wide google-button" disabled={sending} onClick={() => void signInWithGoogle()}><span className="google-mark">G</span> Continue with Google</button>
    {message && <p className={`auth-message auth-message-${messageKind}`} role={messageKind === "error" ? "alert" : "status"}>{message}</p>}
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
  statusMismatches,
  discover,
  select,
  onStatus,
  approve,
  refreshStatus,
  statusFilter,
  setStatusFilter,
  toggleFavorite,
}: {
  items: Story[];
  statusMismatches: StatusMismatch[];
  discover: () => void;
  select: (id: string) => void;
  onStatus: (id: string, status: Story["status"]) => void;
  approve: (id: string) => void;
  refreshStatus: () => void;
  statusFilter: "all" | Story["status"];
  setStatusFilter: (value: "all" | Story["status"]) => void;
  toggleFavorite: (id: string, isFavorite: boolean) => void;
}) {
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("all");
  const [type, setType] = useState("all");
  const [minimumScore, setMinimumScore] = useState("0");
  const [sortField, setSortField] = useState<"identifier" | "date" | "status" | "score">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [favoriteFilter, setFavoriteFilter] = useState<"all" | "favorites" | "not-favorites">("all");
  const shown = items
    .filter((i) => i.title.toLowerCase().includes(filter.toLowerCase()) && (category === "all" || i.category === category) && (type === "all" || i.type === type) && i.score >= Number(minimumScore) && (statusFilter === "all" || i.status === statusFilter) && (favoriteFilter === "all" || (favoriteFilter === "favorites" ? i.isFavorite : !i.isFavorite)))
    .sort((a, b) => {
      const statusOrder: Array<Story["status"]> = ["Auto-Added", "New", "Sent to Sheets", "Generated", "Approved", "Posted", "Archived"];
      const comparison = sortField === "identifier"
        ? String(a.generationIdentifier ?? "").localeCompare(String(b.generationIdentifier ?? ""), undefined, { numeric: true })
        : sortField === "date"
          ? (a.createdAt ? new Date(a.createdAt).getTime() : 0) - (b.createdAt ? new Date(b.createdAt).getTime() : 0)
          : sortField === "status"
            ? statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
            : a.score - b.score;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  const categories = [...new Set(items.map((item) => item.category))];
  const types = [...new Set(items.map((item) => item.type))];
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
      {statusMismatches.length > 0 && (
        <div className="status-mismatch-banner" role="alert">
          <div>
            <b>Google Sheet status mismatch detected</b>
            {statusMismatches.map((mismatch) => (
              <p key={mismatch.identifier}>Item #{mismatch.identifier} is {mismatch.appStatus} in the app, but {mismatch.sheetStatus} in the spreadsheet.</p>
            ))}
          </div>
          <button type="button" onClick={refreshStatus}><FiRefreshCw /> Recheck now</button>
        </div>
      )}
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
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | Story["status"])} aria-label="Filter by status"><option value="all">All statuses</option><option>Auto-Added</option><option>New</option><option>Sent to Sheets</option><option>Generated</option><option>Approved</option><option>Posted</option></select>
        <select value={favoriteFilter} onChange={(e) => setFavoriteFilter(e.target.value as "all" | "favorites" | "not-favorites")} aria-label="Filter by favorite"><option value="all">All items</option><option value="favorites">Favorites</option><option value="not-favorites">Not favorites</option></select>
        <select value={sortField} onChange={(e) => setSortField(e.target.value as typeof sortField)} aria-label="Sort dashboard"><option value="identifier">Sort by identifier</option><option value="date">Sort by date added</option><option value="status">Sort by status</option><option value="score">Sort by score</option></select>
        <select value={sortDirection} onChange={(e) => setSortDirection(e.target.value as "asc" | "desc")} aria-label="Sort direction"><option value="desc">Descending</option><option value="asc">Ascending</option></select>
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
        {shown.map((item) => (
            <div className="story-row" key={item.id}>
              <div>
                <h3><button type="button" className={`favorite-star ${item.isFavorite ? "active" : ""}`} aria-label={item.isFavorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={item.isFavorite} onClick={() => toggleFavorite(item.id, !item.isFavorite)}><FiStar /></button><button className="story-title-link" onClick={() => select(item.id)}>{item.title}</button></h3>
                <p>{item.overview}</p>
              </div>
              {item.generationIdentifier ? (item.generationSheetRow ? <a className="identifier-link" href={`https://docs.google.com/spreadsheets/d/1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ/edit#gid=0&range=D${item.generationSheetRow}`} target="_blank" rel="noreferrer">{item.generationIdentifier}</a> : <span>{item.generationIdentifier}</span>) : <span className="identifier-empty">—</span>}
              <time className="date-added" dateTime={item.createdAt ?? undefined}>{formatAddedDate(item.createdAt)}</time>
              <div><span className="chip">{item.category}</span>{item.source && <small className="story-source">{item.source}</small>}{item.postHandoffAt && item.status !== "Posted" && <span className="posted-question-pill">Posted?</span>}</div>
              <span className="score">{item.score}</span>
              <span className="type">{item.type}</span>
              <select className="status-select" value={item.status} onChange={(e) => onStatus(item.id, e.target.value as Story["status"])}><option>Auto-Added</option><option>New</option><option>Sent to Sheets</option><option>Generated</option><option>Approved</option><option>Posted</option><option>Archived</option></select>
              <div className="actions">
                {item.status === "Generated" && <button className="button compact primary" onClick={() => approve(item.id)}><FiCheck /> Approve</button>}
              </div>
            </div>
          ))}
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
  const statusOrder: Array<Story["status"]> = ["Auto-Added", "New", "Sent to Sheets", "Generated", "Approved", "Posted"];
  const shown = items.filter((item) => item.status !== "Archived" && (statusFilter === "all" || item.status === statusFilter));
  const groups = Array.from(shown.reduce((all, item) => {
    const group = all.get(item.status) ?? [];
    group.push(item);
    all.set(item.status, group);
    return all;
  }, new Map<Story["status"], Story[]>()),)
    .map(([status, stories]) => [status, status === "Posted" ? [...stories].sort((a, b) => {
      const aTime = a.postedAt ? new Date(a.postedAt).getTime() : 0;
      const bTime = b.postedAt ? new Date(b.postedAt).getTime() : 0;
      return bTime - aTime;
    }) : stories] as [Story["status"], Story[]])
    .sort(([a], [b]) => statusOrder.indexOf(a) - statusOrder.indexOf(b));
  return <section>
    <header className="page-header">
      <div><h1>Generation Details</h1><p>Browse active items by status, then open any title to review its generation suggestions.</p></div>
    </header>
    <div className="filter-row article-list-filter">
      <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | Story["status"])} aria-label="Filter articles by status">
        <option value="all">All active statuses</option><option>Auto-Added</option><option>New</option><option>Sent to Sheets</option><option>Generated</option><option>Approved</option><option>Posted</option>
      </select>
    </div>
    <div className="article-list">
      {!shown.length && <div className="empty-queue"><FiFileText /><h2>No matching articles</h2><p>Try a different status filter.</p></div>}
      {groups.map(([status, stories]) => <section className="article-status-group" key={status}>
        <header><h2>{status}</h2><span>{stories.length} {stories.length === 1 ? "article" : "articles"}</span></header>
        <div className="article-list-grid">{stories.map((item) => <article className="article-list-card" key={item.id}>
          <div className="article-list-copy"><button className="article-list-title" onClick={() => select(item.id)}>{item.title}{item.generationIdentifier ? ` (${item.generationIdentifier})` : ""}</button><p>{item.overview}</p><span className="status-pill">{item.status}</span>{item.source && <span className="status-pill source-pill">{item.source}</span>}{item.postHandoffAt && item.status !== "Posted" && <span className="status-pill posted-question-pill">Posted?</span>}</div>
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
  const defaultSystemSearchPrompt = "Find accessible stories published within the last 90 days about neuroscience and behavior, surprising animals, science and space, archaeology, offbeat human stories, attention technology, and immediately useful productivity. Exclude politics, celebrity gossip, routine sports, paywalls, aggregators, and sensational misinformation. Return up to three high-fit stories for the GSD audience. If fewer than three qualify, widen the search to the last year.";
  const defaultTopics = ["Attention & Brain", "Animal Behavior", "Weird Human News", "Productivity Tips", "Science & Space"];
  const savedPromptKey = "gsd-system-search-prompt-v1";
  const savedTopicsKey = "gsd-system-search-topics-v1";
  const loadSavedPrompt = () => window.localStorage.getItem(savedPromptKey) ?? defaultSystemSearchPrompt;
  const loadSavedTopics = () => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(savedTopicsKey) ?? "null");
      return Array.isArray(saved) && saved.every((topic) => typeof topic === "string") ? saved : defaultTopics;
    } catch { return defaultTopics; }
  };
  const [mode, setMode] = useState<"system" | "manual" | "overview">("overview");
  const [manualUrl, setManualUrl] = useState("");
  const [overview, setOverview] = useState("");
  const [source, setSource] = useState("");
  const [savedSearchPrompt, setSavedSearchPrompt] = useState(loadSavedPrompt);
  const [searchText, setSearchText] = useState(loadSavedPrompt);
  const [topicInput, setTopicInput] = useState("");
  const [topics, setTopics] = useState<string[]>(loadSavedTopics);
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
  useEffect(() => { window.localStorage.setItem(savedTopicsKey, JSON.stringify(topics)); }, [topics]);
  const promptEdited = searchText.trim() !== savedSearchPrompt.trim();
  const addTopic = () => { const value = topicInput.trim(); if (value && !topics.includes(value)) setTopics([...topics, value]); setTopicInput(""); };
  const run = async (savePrompt = false) => {
    const manualUrls = Array.from(new Set(manualUrl.split(/[\s,]+/).map((url) => url.trim()).filter(Boolean)));
    if (mode === "manual" && manualUrls.length === 0) return notify("Paste at least one complete article URL, starting with https://.");
    const invalidManualUrls = manualUrls.filter((url) => !/^https:\/\//i.test(url));
    if (mode === "manual" && invalidManualUrls.length === manualUrls.length) return notify("Paste at least one complete HTTPS article URL.");
    if (mode === "overview" && !overview.trim()) return notify("Add a text overview to generate a suggested post.");
    if (mode === "system" && !searchText.trim() && topics.length === 0) return notify("Add a search prompt or at least one topic.");
    if (mode === "system" && savePrompt) {
      const nextPrompt = searchText.trim();
      window.localStorage.setItem(savedPromptKey, nextPrompt);
      setSavedSearchPrompt(nextPrompt);
    }
    setSearching(true);
    try {
      if (mode === "manual") {
        const validManualUrls = manualUrls.filter((url) => /^https:\/\//i.test(url));
        const results = await Promise.allSettled(validManualUrls.map((url) => research({ mode, manualUrl: url })));
        const successful = results
          .filter((result): result is PromiseFulfilledResult<{ count: number; articleIds?: string[] }> => result.status === "fulfilled")
          .map((result) => result.value);
        const failedCount = results.length - successful.length + invalidManualUrls.length;
        const addedCount = successful.reduce((sum, result) => sum + result.count, 0);
        const firstArticleId = successful.flatMap((result) => result.articleIds ?? [])[0];
        setQueued([`${validManualUrls.length} URLs processed`, `${addedCount} ${addedCount === 1 ? "story" : "stories"} added`, failedCount ? `${failedCount} failed or invalid` : "All URLs completed"]);
        if (firstArticleId) onManualComplete(firstArticleId);
        if (failedCount) notify(`${addedCount} ${addedCount === 1 ? "story" : "stories"} added; ${failedCount} URL${failedCount === 1 ? "" : "s"} could not be processed.`);
        else notify(`${addedCount} ${addedCount === 1 ? "story" : "stories"} added to your dashboard.`);
        return;
      }
      const result = await research({ mode, manualUrl: manualUrl.trim(), overview: overview.trim(), source: source.trim(), searchText: searchText.trim(), topics });
      setQueued(mode === "overview" ? ["Overview interpreted", "GSD fit scored", "Post concept saved"] : ["Searching trusted, accessible sources", "Ranking GSD audience fit", "Building post concepts"]);
      notify(`${result.count} ${result.count === 1 ? "story" : "stories"} added to your dashboard.`);
      if (mode === "overview" && result.articleIds?.[0]) onManualComplete(result.articleIds[0]);
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
          {mode === "manual" ? <Field label="Article URLs"><textarea className="overview-editor" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder={"https://example.com/article-one\nhttps://example.com/article-two"} /></Field> : mode === "overview" ? <><Field label="Text overview"><textarea className="overview-editor" value={overview} onChange={(e) => setOverview(e.target.value)} placeholder="Describe the observation, idea, situation, or theme. No news article is required." /></Field><Field label="Source"><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Where this idea came from" /></Field></> : <><Field label="What should we search for?"><textarea className="overview-editor" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Describe the stories the system should find." /></Field>
          <p className="field-label">Topics</p>
          <div className="chips">
            {topics.map((topic) => <span key={topic}>{topic} <button aria-label={`Remove ${topic}`} onClick={() => setTopics(topics.filter((item) => item !== topic))}><FiX /></button></span>)}
          </div>
          <div className="topic-add"><input value={topicInput} onChange={(e) => setTopicInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTopic(); } }} placeholder="Add a topic" /><button onClick={addTopic}><FiPlus /> Add</button></div></>}
          {mode === "system" && promptEdited ? <div className="discover-search-actions">
            <button className="button primary wide" onClick={() => void run(false)} disabled={searching}><FiSearch /> {searching ? "Finding stories…" : "Find Stories"}</button>
            <button className="button wide" onClick={() => void run(true)} disabled={searching}><FiCheck /> {searching ? "Finding stories…" : "Update Saved Prompt and Find Stories"}</button>
          </div> : <button className="button primary wide" onClick={() => void run(false)} disabled={searching}>
            {searching ? (
              <>
                <FiRefreshCw className="spin" /> {mode === "overview" ? "Generating suggestion" : "Researching stories"}
              </>
            ) : (
              <>
                {mode === "overview" ? <><FiEdit3 /> Generate Suggested Post</> : <><FiSearch /> Find Stories</>}
              </>
            )}
          </button>}
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
  markPostHandoff,
  toggleFavorite,
  duplicateIdea,
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
  markPostHandoff: (articleId: string) => Promise<void>;
  toggleFavorite: (isFavorite: boolean) => Promise<void>;
  duplicateIdea: () => Promise<{ article_id: string; generation_identifier: string }>;
  notify: Notify;
}) {
  const [values, setValues] = useState<DetailValues>(() => detailValues(story, concept));
  const [busy, setBusy] = useState("");
  const [activeImage, setActiveImage] = useState(0);
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptLoadError, setPromptLoadError] = useState("");
  const [promptRepairRequired, setPromptRepairRequired] = useState(false);
  const [promptReload, setPromptReload] = useState(0);
  const [dirty, setDirty] = useState(false);
  const valuesRef = useRef(values);
  const dirtyRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Prefer app-storage copies. If any cannot be signed, retain the Drive image
  // URLs as a fallback instead of rendering an empty gallery.
  const renderedImages = Array.isArray(concept?.image_summary?.rendered_images) ? concept.image_summary.rendered_images.filter(Boolean) : [];
  const embeddedImages = Array.isArray(concept?.image_summary?.embedded_images) ? concept.image_summary.embedded_images.filter(Boolean) : [];
  const rawSheetImages = Array.isArray(concept?.image_summary?.sheet_images) ? concept.image_summary.sheet_images.filter(Boolean) : [];
  const sheetImages = rawSheetImages.map(displayImageUrl);
  const images = (renderedImages.length ? renderedImages : embeddedImages.length ? embeddedImages : sheetImages) as string[];
  const fallbackImage = (index: number) => directImageFallback(rawSheetImages[index]);
  const workflowPastGeneration = ["Generated", "Approved", "Posted"].includes(story.status);
  const sendComplete = workflowPastGeneration || (story.status === "Sent to Sheets" && Boolean(generationPrompt) && !promptRepairRequired);
  const generationComplete = ["Generated", "Approved", "Posted"].includes(story.status) || images.length > 0;
  const postHandoffComplete = Boolean(story.postHandoffAt) || story.status === "Posted";
  const lockedAfterSheetSend = sendComplete;
  const isTextOverview = concept?.image_summary?.origin === "text_overview";
  useEffect(() => {
    const nextValues = detailValues(story, concept);
    setValues(nextValues);
    valuesRef.current = nextValues;
    dirtyRef.current = false;
    setDirty(false);
  }, [story.id]);
  useEffect(() => {
    if (!dirty) {
      const nextValues = detailValues(story, concept);
      setValues(nextValues);
      valuesRef.current = nextValues;
    }
  }, [story, concept, dirty]);
  useEffect(() => setActiveImage(0), [story.id, images.length]);
  useEffect(() => {
    let cancelled = false;
    setGenerationPrompt("");
    setPromptLoadError("");
    setPromptRepairRequired(false);
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
        if (!response.ok) {
          if (result.code === "SHEET_ROW_MISSING" || result.code === "GENERATION_PROMPT_MISSING") {
            setPromptRepairRequired(true);
          }
          throw new Error(result.error ?? "Couldn’t retrieve the generation prompt.");
        }
        if (!cancelled) setGenerationPrompt(String(result.prompt ?? ""));
      } catch (error) {
        if (!cancelled) setPromptLoadError(error instanceof Error ? error.message : "Couldn’t retrieve the generation prompt.");
      } finally {
        if (!cancelled) setPromptLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [story.id, story.status, promptReload]);
  const update = (key: keyof DetailValues, value: string | number) => {
    dirtyRef.current = true;
    setDirty(true);
    setValues((old) => {
      const nextValues = { ...old, [key]: value };
      valuesRef.current = nextValues;
      return nextValues;
    });
  };
  const save = async (quiet = false) => {
    if (!dirtyRef.current) return;
    const articleId = story.id;
    const snapshot = valuesRef.current;
    dirtyRef.current = false;
    setBusy("save");
    const operation = saveQueueRef.current.catch(() => undefined).then(async () => {
      try {
        await saveDetail(articleId, snapshot);
        if (valuesRef.current === snapshot) setDirty(false);
        if (!quiet) notify(story.generationIdentifier ? "Changes verified in the app and Google Sheet." : "Changes saved in the app.");
      } catch (error) {
        dirtyRef.current = true;
        setDirty(true);
        notify(error instanceof Error ? error.message : "Couldn’t save article detail.", "error");
        throw error;
      } finally {
        setBusy("");
      }
    });
    saveQueueRef.current = operation;
    return operation;
  };
  const saveOnBlur = () => { if (dirtyRef.current) void save(true); };
  const navigateAfterSave = async (navigate: () => void) => {
    try {
      if (dirtyRef.current) await save(true);
      else await saveQueueRef.current;
      navigate();
    } catch {
      // Stay on this record when the save could not be verified.
    }
  };
  const rerun = async () => { setBusy("analysis"); try { await reanalyze(); notify("Article analysis refreshed with a new version."); } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t rerun analysis.", "error"); } finally { setBusy(""); } };
  const send = async () => {
    setBusy("sheet");
    try {
      const result = await sendForGeneration(story.id, values) as { warnings?: string[] };
      setPromptRepairRequired(false);
      setPromptReload((value) => value + 1);
      notify(result.warnings?.length ? `Article saved. ${result.warnings.join(" ")}` : "Article row and generation prompt verified in Google Sheets.", result.warnings?.length ? "error" : "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn’t send this article to the generation sheet.", "error");
    } finally {
      setBusy("");
    }
  };
  const generateContent = async () => {
    setBusy("generate");
    let chatWindow: Window | null = null;
    try {
      if (promptLoading) throw new Error("Column J is still loading. Please try again in a moment.");
      if (!generationPrompt) throw new Error(promptLoadError || "Column J is empty for this article.");

      // Both permission-sensitive operations must begin directly inside the
      // click. Awaiting a session or network request first causes Chrome to
      // consume the page's user activation and block clipboard access.
      let copied = false;
      let clipboardWrite: Promise<void> | null = null;
      if (navigator.clipboard?.writeText && document.hasFocus()) {
        clipboardWrite = navigator.clipboard.writeText(generationPrompt);
      } else {
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

      chatWindow = window.open("about:blank", "_blank");
      if (!chatWindow) throw new Error("Your browser blocked the new ChatGPT window. Allow popups for this site and try again.");
      chatWindow.opener = null;
      if (clipboardWrite) copied = await clipboardWrite.then(() => true, () => false);
      if (!copied) throw new Error("The browser blocked clipboard access. Keep this page active and click Generate Content again.");

      chatWindow.location.href = "https://chatgpt.com/g/g-p-69e8effb73588191acaccbaed49a9d96/c/6a5fd350-e1f8-83ea-a391-a1e3cd4b4dcb";
      notify("Column J copied to the clipboard and ChatGPT opened.");
    } catch (error) {
      if (chatWindow && !chatWindow.closed) chatWindow.close();
      notify(error instanceof Error ? error.message : "Couldn’t copy the generation prompt.", "error");
    } finally {
      setBusy("");
    }
  };
  const generatePost = async () => {
    setBusy("post");
    let instagramWindow: Window | null = null;
    try {
      const caption = values.caption.trim();
      if (!caption) throw new Error("Caption is empty for this article.");
      if (!generationComplete) throw new Error("Generate the post content before opening Instagram.");

      let copied = false;
      let clipboardWrite: Promise<void> | null = null;
      if (navigator.clipboard?.writeText && document.hasFocus()) {
        clipboardWrite = navigator.clipboard.writeText(caption);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = caption;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        copied = document.execCommand("copy");
        textarea.remove();
      }

      instagramWindow = window.open("about:blank", "_blank");
      if (!instagramWindow) throw new Error("Your browser blocked the new Instagram window. Allow popups for this site and try again.");
      instagramWindow.opener = null;
      if (clipboardWrite) copied = await clipboardWrite.then(() => true, () => false);
      if (!copied) throw new Error("The browser blocked clipboard access. Keep this page active and click Generate Post again.");

      instagramWindow.location.href = "https://www.instagram.com/create/select/";
      await markPostHandoff(story.id);
      notify("Caption copied and Instagram post creation opened.");
    } catch (error) {
      if (instagramWindow && !instagramWindow.closed && instagramWindow.location.href === "about:blank") instagramWindow.close();
      notify(error instanceof Error ? error.message : "Couldn’t open Instagram post creation.", "error");
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
          <button onClick={() => void navigateAfterSave(previous)}>
            <FiArrowLeft /> Previous
          </button>
          <button onClick={() => void navigateAfterSave(next)}>
            Next <FiArrowRight />
          </button>
          </div>
          <button type="button" className={`favorite-star detail-favorite ${story.isFavorite ? "active" : ""}`} aria-label={story.isFavorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={story.isFavorite} onClick={() => void toggleFavorite(!story.isFavorite).catch((error) => notify(error instanceof Error ? error.message : "Couldn’t update favorite.", "error"))}><FiStar /> {story.isFavorite ? "Favorite" : "Add favorite"}</button>
          <button type="button" onClick={() => { setBusy("duplicate"); void duplicateIdea().then((created) => notify(`Duplicate #${created.generation_identifier} created.`)).catch((error) => notify(error instanceof Error ? error.message : "Couldn’t duplicate this idea.", "error")).finally(() => setBusy("")); }} disabled={Boolean(busy)}><FiCopy /> {busy === "duplicate" ? "Duplicating…" : "Duplicate idea"}</button>
          <label className="detail-status-control">Status<select value={story.status} onChange={(e) => onStatus(e.target.value as Story["status"])}><option>Auto-Added</option><option>New</option><option>Sent to Sheets</option><option>Generated</option><option>Approved</option><option>Posted</option><option>Archived</option></select></label>
          <button onClick={() => void refresh()} disabled={Boolean(busy)}><FiRefreshCw className={busy === "refresh" ? "spin" : ""} /> {busy === "refresh" ? "Refreshing…" : "Refresh data"}</button>
          {story.status === "Generated" && <button className="button primary" onClick={() => void approve()} disabled={Boolean(busy)}><FiCheck /> {busy === "approve" ? "Approving…" : "Approve"}</button>}
          <button onClick={rerun} disabled={Boolean(busy) || lockedAfterSheetSend}><FiRefreshCw /> {busy === "analysis" ? "Analyzing…" : isTextOverview ? "Regenerate suggestion" : "Regenerate analysis"}</button>
          <button onClick={() => void save()} disabled={Boolean(busy) || !dirty}><FiCheck /> {busy === "save" ? "Saving…" : dirty ? "Save changes" : "Changes saved"}</button>
        </div>
      </div>
      <div className="detail-fields">
        <div className="left-fields detail-editor-fields">
          <Field label={isTextOverview ? "Suggestion title" : "Article title"}><input value={values.title} onChange={(e) => update("title", e.target.value)} onBlur={saveOnBlur} /></Field>
          <Field label={isTextOverview ? "Overview summary" : "Article Summary"}><textarea className="summary-editor" value={values.summary} onChange={(e) => update("summary", e.target.value)} onBlur={saveOnBlur} placeholder={isTextOverview ? "A concise summary of the post idea" : "A two-to-three sentence article summary"} /></Field>
          <div className="detail-metadata-row">
            <Field label="Source URL"><input type="url" value={values.url} onChange={(e) => update("url", e.target.value)} onBlur={saveOnBlur} placeholder={isTextOverview ? "No article linked" : "https://example.com/article"} disabled={isTextOverview} /></Field>
            <Field label="Identifier"><input value={story.generationIdentifier ?? ""} placeholder="Not assigned" readOnly /></Field>
            <Field label="Type"><select value={values.postType} onChange={(e) => update("postType", e.target.value)} onBlur={saveOnBlur}><option value="carousel">Carousel</option><option value="single_image">Single Image</option><option value="multi_pane_cartoon">Multi-pane Cartoon</option><option value="reel">Reel</option></select></Field>
            <Field label="Score"><input type="number" min="1" max="100" value={values.score} onChange={(e) => update("score", Number(e.target.value))} onBlur={saveOnBlur} /></Field>
            <Field label="Panel Count"><input type="number" min="1" max="10" value={values.panelCount} onChange={(e) => update("panelCount", Number(e.target.value))} onBlur={saveOnBlur} /></Field>
          </div>
          <Field label="Caption"><textarea className="caption-editor" value={values.caption} onChange={(e) => update("caption", e.target.value)} onBlur={saveOnBlur} /></Field>
          <div className="detail-metadata-row"><Field label="Recommended hashtags · maximum 4"><textarea className="hashtags-editor" value={values.hashtags} onChange={(e) => update("hashtags", e.target.value)} onBlur={saveOnBlur} placeholder="#gsd-book #focus #productivity" /></Field><Field label="Source"><input value={values.source} onChange={(e) => update("source", e.target.value)} onBlur={saveOnBlur} placeholder="Source" /></Field></div>
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
        </div> : <Field label="Content (Suggested Prompt)"><textarea className="tall" style={{ minHeight: 720, lineHeight: 1.7 }} value={values.content} onChange={(e) => update("content", e.target.value)} onBlur={saveOnBlur} /></Field>}
        <div className="generation-step-actions">
          <button className={sendComplete ? "button complete wide" : "button primary wide"} onClick={() => void send()} disabled={Boolean(busy) || promptLoading || sendComplete}><FiExternalLink /> {sendComplete ? "Sent to Sheets Complete" : busy === "sheet" ? "Repairing…" : promptRepairRequired ? "Repair Sheet Row" : "Send for Generation"}</button>
          <button className={generationComplete ? "button complete wide" : "button wide"} onClick={() => void generateContent()} disabled={Boolean(busy) || promptLoading || promptRepairRequired || !generationPrompt || generationComplete || story.status !== "Sent to Sheets"}><FiCopy /> {generationComplete ? "Generate Content Complete" : promptLoading ? "Verifying Column J…" : promptRepairRequired ? "Repair Sheet Row First" : busy === "generate" ? "Copying…" : "Generate Content"}</button>
          <button className={postHandoffComplete ? "button complete wide" : "button primary wide"} onClick={() => void generatePost()} disabled={Boolean(busy) || !generationComplete || postHandoffComplete}><FiExternalLink /> {postHandoffComplete ? "Generate Post Complete" : busy === "post" ? "Opening Instagram…" : "Generate Post"}</button>
        </div>
      </section>
    </section>
  );
}
type DetailValues = { title: string; url: string; source: string; score: number; postType: string; panelCount: number; setting: string; content: string; prompt: string; caption: string; hashtags: string; summary: string };
function normalizeHashtags(value: string) {
  const cleaned = value.split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean).map((tag) => `#${tag.replace(/^#/, "").toLowerCase()}`);
  return Array.from(new Set(["#gsd-book", ...cleaned.filter((tag) => tag !== "#gsd-book"), "#focus", "#productivity"])).slice(0, 4);
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
  return { title: story.title, url: story.url ?? "", source: story.source ?? "", score: story.score, postType: concept?.post_type ?? story.type, panelCount: concept?.panel_count ?? 5, setting: image.setting ?? [image.location, image.time_of_day].filter(Boolean).join(" · "), content, prompt: concept?.detailed_prompt ?? "", caption: concept?.caption ?? "", hashtags: normalizeHashtags((concept?.hashtags ?? []).join(" ")).join(" "), summary: concept?.summary ?? story.overview ?? "" };
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
