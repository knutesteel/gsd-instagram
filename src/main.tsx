import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  FiArchive,
  FiArrowLeft,
  FiArrowRight,
  FiBookOpen,
  FiCheck,
  FiChevronDown,
  FiClock,
  FiCompass,
  FiEdit3,
  FiExternalLink,
  FiFileText,
  FiGrid,
  FiImage,
  FiMoreHorizontal,
  FiPlus,
  FiRefreshCw,
  FiSearch,
  FiSettings,
  FiTrash2,
  FiUploadCloud,
  FiX,
} from "react-icons/fi";
import "./styles.css";
import { supabase, supabaseConfigured } from "./lib/supabase";
import icpPromptAsset from "./prompt-assets/icp-prompt.md?raw";
import voicePromptAsset from "./prompt-assets/voice-prompt.md?raw";
import imagePromptAsset from "./prompt-assets/image-prompt.md?raw";

type Screen =
  | "dashboard"
  | "discover"
  | "detail"
  | "produce"
  | "preview"
  | "archive"
  | "guidance";
type Story = {
  id: string;
  title: string;
  overview: string;
  category: string;
  score: number;
  url?: string;
  type: string;
  status: "New" | "Produced" | "Ready" | "Posted" | "Archived";
};
type Concept = { summary?: string; post_type?: string; panel_count?: number; image_summary?: Record<string, string>; detailed_prompt?: string; caption?: string; hashtags?: string[] };
type GeneratedAsset = { id: string; sequence: number; storage_path: string; url: string };

function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [items, setItems] = useState<Story[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [caption, setCaption] = useState("");
  const [concept, setConcept] = useState<Concept | null>(null);
  const [change, setChange] = useState("");
  const [productionRequest, setProductionRequest] = useState(0);
  const [toast, setToast] = useState("");
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [userId, setUserId] = useState<string | null>(null);
  const active = items.find((i) => i.id === selected) ?? items[0];
  const proposed = items.filter((i) => i.status !== "Archived");
  const loadConcept = async (articleId: string) => {
    if (!supabase || !articleId) return;
    const { data } = await supabase.from("post_concepts").select("summary,post_type,panel_count,image_summary,detailed_prompt,caption,hashtags").eq("article_id", articleId).maybeSingle();
    setConcept(data as Concept | null);
    setCaption(data?.caption ?? "");
  };
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };
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
    supabase.from("articles").select("id,title,source_url,canonical_url,category,rank,status,post_concepts(post_type,summary)").order("rank", { ascending: false }).then(({ data, error }) => {
      if (error) return notify(`Couldn’t load your queue: ${error.message}`);
      const saved: Story[] = (data ?? []).map((row: any) => ({ id: row.id, title: row.title, url: row.source_url ?? row.canonical_url ?? "", overview: row.post_concepts?.[0]?.summary ?? "No summary saved yet.", category: row.category ?? "Uncategorized", score: row.rank ?? 0, type: row.post_concepts?.[0]?.post_type ?? "Carousel", status: (row.status === "discarded" ? "Archived" : row.status === "produced" ? "Produced" : row.status === "ready" ? "Ready" : row.status === "posted" ? "Posted" : "New") as Story["status"] }));
      setItems(saved);
      if (saved[0]) setSelected(saved[0].id);
    });
  }, [userId]);
  useEffect(() => { void loadConcept(selected); }, [selected]);
  const updateStatus = async (id: string, status: "discarded" | "new" | "produced" | "ready" | "posted") => {
    if (!supabase) return;
    const { error } = await supabase.from("articles").update({ status }).eq("id", id);
    if (error) notify(`Couldn’t save change: ${error.message}`);
  };
  const discard = (id: string) => {
    setItems((old) =>
      old.map((i) => (i.id === id ? { ...i, status: "Archived" } : i)),
    );
    void updateStatus(id, "discarded");
    notify(
      "Article moved to Archive and protected from future duplicate searches.",
    );
    setScreen("dashboard");
  };
  const generateAssets = async (articleId: string, requestedChange = "", sequence?: number) => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const client = supabase;
    const { data } = await client.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    const response = await fetch("/api/produce", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ articleId, requestedChange, sequence }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Couldn’t generate assets.");
    const assets = await Promise.all((result.assets ?? []).map(async (asset: Omit<GeneratedAsset, "url">) => {
      const { data: signed, error } = await client.storage.from("post-assets").createSignedUrl(asset.storage_path, 60 * 60);
      if (error || !signed?.signedUrl) throw new Error(error?.message ?? "Couldn’t prepare generated image.");
      return { ...asset, url: signed.signedUrl } as GeneratedAsset;
    }));
    setItems((old) => old.map((item) => item.id === articleId ? { ...item, status: "Produced" } : item));
    void updateStatus(articleId, "produced");
    return assets as GeneratedAsset[];
  };
  const loadAssets = async (articleId: string) => {
    if (!supabase) return [] as GeneratedAsset[];
    const client = supabase;
    const { data: conceptRow } = await client.from("post_concepts").select("id").eq("article_id", articleId).maybeSingle();
    if (!conceptRow) return [] as GeneratedAsset[];
    const { data: rows } = await client.from("assets").select("id,sequence,storage_path").eq("concept_id", conceptRow.id).eq("is_active", true).order("sequence", { ascending: true });
    return Promise.all((rows ?? []).map(async (asset) => {
      const { data } = await client.storage.from("post-assets").createSignedUrl(asset.storage_path, 60 * 60);
      return { ...asset, url: data?.signedUrl ?? "" } as GeneratedAsset;
    }));
  };
  const produce = () => {
    setScreen("produce");
    setProductionRequest((request) => request + 1);
  };
  const saveDetail = async (articleId: string, values: { title: string; url: string; score: number; postType: string; panelCount: number; setting: string; content: string; caption: string; prompt: string; hashtags: string }) => {
    if (!supabase) return;
    const articleUpdate = await supabase.from("articles").update({ title: values.title, source_url: values.url, canonical_url: values.url, rank: values.score }).eq("id", articleId);
    if (articleUpdate.error) throw new Error(articleUpdate.error.message);
    const hashtags = normalizeHashtags(values.hashtags);
    const conceptUpdate = await supabase.from("post_concepts").update({ post_type: values.postType, panel_count: values.panelCount, image_summary: { setting: values.setting, content: values.content }, detailed_prompt: values.prompt, caption: values.caption, hashtags }).eq("article_id", articleId);
    if (conceptUpdate.error) throw new Error(conceptUpdate.error.message);
    setItems((old) => old.map((item) => item.id === articleId ? { ...item, title: values.title, url: values.url, score: values.score, type: values.postType } : item));
    setCaption(values.caption);
    await loadConcept(articleId);
  };
  const generatePrompt = async (articleId: string, values: Record<string, unknown>) => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    const response = await fetch("/api/generate-prompt", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ articleId, ...values }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Couldn’t generate the prompt.");
    await loadConcept(articleId);
    return result.prompt as string;
  };
  const navigate = (next: number) => {
    const index = items.findIndex((i) => i.id === selected);
    setSelected(items[(index + next + items.length) % items.length].id);
  };
  const research = async (payload: Record<string, unknown>) => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    const response = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Research failed.");
    await supabase.from("articles").select("id,title,source_url,canonical_url,category,rank,status,post_concepts(post_type,summary)").order("rank", { ascending: false }).then(({ data: rows }) => {
      const saved: Story[] = (rows ?? []).map((row: any) => ({ id: row.id, title: row.title, url: row.source_url ?? row.canonical_url ?? "", overview: row.post_concepts?.[0]?.summary ?? "No summary saved yet.", category: row.category ?? "Uncategorized", score: row.rank ?? 0, type: row.post_concepts?.[0]?.post_type ?? "Carousel", status: (row.status === "discarded" ? "Archived" : row.status === "produced" ? "Produced" : row.status === "ready" ? "Ready" : row.status === "posted" ? "Posted" : "New") as Story["status"] }));
      setItems(saved); if (saved[0]) setSelected(saved[0].id);
    });
    return result as { count: number; articleIds?: string[] };
  };
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
              { key: "archive", icon: <FiArchive />, label: "Archive" },
              { key: "guidance", icon: <FiBookOpen />, label: "Prompt guidance" },
              { key: "settings", icon: <FiSettings />, label: "Settings" },
            ] as const
          ).map((n) => (
            <button
              key={n.key}
              className={screen === n.key ? "nav-item active" : "nav-item"}
              onClick={() =>
                setScreen(n.key === "settings" ? "guidance" : n.key)
              }
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
          <div className="toast">
            <FiCheck />
            {toast}
          </div>
        )}
        {screen === "dashboard" && (
          <Dashboard
            items={proposed}
            discover={() => setScreen("discover")}
            select={(id) => {
              setSelected(id);
              void loadConcept(id);
              setScreen("detail");
            }}
            onProduce={(id) => {
              setSelected(id);
              produce();
            }}
            onViewAssets={(id) => { setSelected(id); setScreen("produce"); }}
            onDiscard={discard}
            onStatus={(id, status) => { setItems((old) => old.map((item) => item.id === id ? { ...item, status } : item)); void updateStatus(id, status.toLowerCase() as "new" | "produced" | "ready" | "posted"); }}
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
            generatePrompt={generatePrompt}
            reanalyze={() => research({ mode: "manual", manualUrl: active.url }).then(() => loadConcept(active.id))}
            notify={notify}
            previous={() => navigate(-1)}
            next={() => navigate(1)}
            produce={produce}
            discard={() => discard(active.id)}
          />
        )}
        {screen === "produce" && (
          <Produce
            story={active}
            productionRequest={productionRequest}
            generateAssets={generateAssets}
            loadAssets={loadAssets}
            caption={caption}
            setCaption={setCaption}
            change={change}
            setChange={setChange}
            onPreview={() => setScreen("preview")}
            notify={notify}
          />
        )}
        {screen === "preview" && (
          <Preview
            caption={caption}
            back={() => setScreen("produce")}
            notify={notify}
          />
        )}
        {screen === "archive" && (
          <Archive
            items={items.filter((i) => i.status === "Archived")}
            restore={(id) => {
              setItems((old) =>
                old.map((i) =>
                  i.id === id ? { ...i, status: "New" } : i,
                ),
              );
              notify("Restored to the story queue.");
            }}
          />
        )}
        {screen === "guidance" && <Guidance />}
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

function Dashboard({
  items,
  discover,
  select,
  onProduce,
  onViewAssets,
  onDiscard,
  onStatus,
}: {
  items: Story[];
  discover: () => void;
  select: (id: string) => void;
  onProduce: (id: string) => void;
  onViewAssets: (id: string) => void;
  onDiscard: (id: string) => void;
  onStatus: (id: string, status: Exclude<Story["status"], "Archived">) => void;
}) {
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("all");
  const [type, setType] = useState("all");
  const [minimumScore, setMinimumScore] = useState("0");
  const shown = items.filter((i) => i.title.toLowerCase().includes(filter.toLowerCase()) && (category === "all" || i.category === category) && (type === "all" || i.type === type) && i.score >= Number(minimumScore));
  const categories = [...new Set(items.map((item) => item.category))];
  const types = [...new Set(items.map((item) => item.type))];
  return (
    <section>
      <header className="page-header">
        <div>
          <h1>Your story queue</h1>
          <p>High-potential stories, ranked for the GSD audience.</p>
        </div>
        <button className="button primary" onClick={discover}>
          <FiPlus /> Find fresh stories
        </button>
      </header>
      <div className="metrics">
        <Metric number={String(items.length)} label="To review" icon={<FiFileText />} />
        <Metric number="0" label="Produced" icon={<FiCheck />} />
        <Metric number="0" label="Archived" icon={<FiArchive />} />
      </div>
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
      </div>
      <div className="story-table">
        <div className="story-head">
          <span>Story</span>
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
              <h3>{item.title}</h3>
              <p>{item.overview}</p>
            </div>
            <span className="chip">{item.category}</span>
            <span className="score">{item.score}</span>
            <span className="type">{item.type}</span>
            <select className="status-select" value={item.status} onChange={(e) => onStatus(item.id, e.target.value as Exclude<Story["status"], "Archived">)}><option>New</option><option>Produced</option><option>Ready</option><option>Posted</option></select>
            <div className="actions">
              <button onClick={() => select(item.id)}>Edit</button>
              <button className="outline" onClick={() => onProduce(item.id)}>
                Produce
              </button>
              {item.status !== "New" && <button onClick={() => onViewAssets(item.id)}>View Assets</button>}
              <button
                className="text-danger"
                onClick={() => onDiscard(item.id)}
              >
                Discard
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
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
  const [mode, setMode] = useState<"system" | "manual">("system");
  const [manualUrl, setManualUrl] = useState("");
  const [searchText, setSearchText] = useState("");
  const [topicInput, setTopicInput] = useState("");
  const [topics, setTopics] = useState(["Attention & Brain", "Animal Behavior", "Weird Human News", "Productivity Tips", "Science & Space"]);
  const [queued, setQueued] = useState<string[]>([]);
  const addTopic = () => { const value = topicInput.trim(); if (value && !topics.includes(value)) setTopics([...topics, value]); setTopicInput(""); };
  const run = async () => {
    if (mode === "manual" && !/^https?:\/\//i.test(manualUrl.trim())) return notify("Paste a complete article URL, starting with https://.");
    if (mode === "system" && !searchText.trim() && topics.length === 0) return notify("Add a search phrase or at least one topic.");
    setSearching(true);
    try {
      const result = await research({ mode, manualUrl: manualUrl.trim(), searchText: searchText.trim(), topics, timeframe: 48 });
      setQueued(mode === "manual" ? ["Article analyzed", "GSD fit scored", "Post concept saved"] : ["Searching trusted, accessible sources", "Ranking GSD audience fit", "Building post concepts"]);
      notify(`${result.count} ${result.count === 1 ? "story" : "stories"} added to your dashboard.`);
      if (mode === "manual" && result.articleIds?.[0]) onManualComplete(result.articleIds[0]);
    } catch (error) { notify(error instanceof Error ? error.message : "Research failed."); }
    finally { setSearching(false); }
  };
  return (
    <section>
      <header className="page-header">
        <div>
          <h1>Find fresh stories</h1>
          <p>
            Discover high-potential Instagram stories based on your topics and
            research requirements.
          </p>
        </div>
      </header>
      <div className="discover-grid">
        <div className="panel search-panel">
          <div className="segmented">
            <button className={mode === "manual" ? "selected" : ""} onClick={() => setMode("manual")}>Manual URL</button>
            <button className={mode === "system" ? "selected" : ""} onClick={() => setMode("system")}>System Search</button>
          </div>
          {mode === "manual" ? <Field label="Direct article URL"><input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://example.com/article" /></Field> : <><Field label="What should we search for?"><input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="e.g. surprising focus research or clever animal behavior" /></Field>
          <label className="field-label">
            Timeframe
            <select defaultValue="48">
              <option value="48">Last 48 hours</option>
              <option>Last 24 hours</option>
            </select>
          </label>
          <p className="field-label">Topics</p>
          <div className="chips">
            {topics.map((topic) => <span key={topic}>{topic} <button aria-label={`Remove ${topic}`} onClick={() => setTopics(topics.filter((item) => item !== topic))}><FiX /></button></span>)}
          </div>
          <div className="topic-add"><input value={topicInput} onChange={(e) => setTopicInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTopic(); } }} placeholder="Add a topic" /><button onClick={addTopic}><FiPlus /> Add</button></div></>}
          <button className="button primary wide" onClick={run}>
            {searching ? (
              <>
                <FiRefreshCw className="spin" /> Researching stories
              </>
            ) : (
              <>
                <FiSearch /> Search for stories
              </>
            )}
          </button>
        </div>
        <div className="panel requirements">
          <h2>Research requirements</h2>
          <Requirement
            title="Direct, accessible sources"
            text="Prioritize primary sources, official accounts, and first-hand reporting."
          />
          <Requirement
            title="Category variety"
            text="Cover multiple angles and source types across each search."
          />
          <Requirement
            title="8–10 search queries"
            text="Run targeted research across every topic area."
          />
        </div>
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
  produce,
  discard,
  saveDetail,
  generatePrompt,
  reanalyze,
  notify,
}: {
  story: Story;
  concept: Concept | null;
  previous: () => void;
  next: () => void;
  produce: () => void;
  discard: () => void;
  saveDetail: (id: string, values: DetailValues) => Promise<void>;
  generatePrompt: (id: string, values: Record<string, unknown>) => Promise<string>;
  reanalyze: () => Promise<unknown>;
  notify: (message: string) => void;
}) {
  const [values, setValues] = useState<DetailValues>(() => detailValues(story, concept));
  const [busy, setBusy] = useState("");
  useEffect(() => setValues(detailValues(story, concept)), [story.id, concept]);
  const update = (key: keyof DetailValues, value: string | number) => setValues((old) => ({ ...old, [key]: value }));
  const save = async () => { setBusy("save"); try { await saveDetail(story.id, values); notify("Article detail saved."); } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t save article detail."); } finally { setBusy(""); } };
  const prompt = async () => { setBusy("prompt"); try { const generated = await generatePrompt(story.id, values); setValues((old) => ({ ...old, prompt: generated })); notify("Full production prompt generated from your saved guidance."); } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t generate the prompt."); } finally { setBusy(""); } };
  const rerun = async () => { setBusy("analysis"); try { await reanalyze(); notify("Article analysis refreshed with a new version."); } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t rerun analysis."); } finally { setBusy(""); } };
  return (
    <section>
      <div className="detail-top">
        <p>
          Story queue <span>/</span> {story.title}
        </p>
        <div>
          <button onClick={previous}>
            <FiArrowLeft /> Previous
          </button>
          <button onClick={next}>
            Next <FiArrowRight />
          </button>
          <button onClick={discard}>
            <FiTrash2 /> Discard
          </button>
          <button onClick={rerun} disabled={Boolean(busy)}><FiRefreshCw /> {busy === "analysis" ? "Analyzing…" : "Regenerate analysis"}</button>
          <button onClick={save} disabled={Boolean(busy)}><FiCheck /> {busy === "save" ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
      <h1>Article detail</h1>
      <div className="detail-grid">
        <div className="left-fields">
          <Field label="Article title"><input value={values.title} onChange={(e) => update("title", e.target.value)} /></Field>
          <Field label="URL"><input type="url" value={values.url} onChange={(e) => update("url", e.target.value)} /></Field>
          <Field label="Score"><input type="number" min="1" max="100" value={values.score} onChange={(e) => update("score", Number(e.target.value))} /></Field>
          <Field label="Type"><select value={values.postType} onChange={(e) => update("postType", e.target.value)}><option value="Carousel">Five-panel Instagram carousel</option><option value="Single image">Single image</option><option value="Reel">Reel</option></select></Field>
          <Field label="Panels"><input type="number" min="1" max="10" value={values.panelCount} onChange={(e) => update("panelCount", Number(e.target.value))} /></Field>
          <Field label="Setting"><textarea style={{ minHeight: 95 }} value={values.setting} onChange={(e) => update("setting", e.target.value)} /></Field>
          <Field label="Caption"><textarea className="caption-editor" value={values.caption} onChange={(e) => update("caption", e.target.value)} /></Field>
          <Field label="Recommended hashtags · 3–5"><textarea style={{ minHeight: 100 }} value={values.hashtags} onChange={(e) => update("hashtags", e.target.value)} placeholder="#gsd-book #focus #productivity" /></Field>
        </div>
        <div className="right-fields">
          <Field label="Content"><textarea className="tall" style={{ minHeight: 720, lineHeight: 1.7 }} value={values.content} onChange={(e) => update("content", e.target.value)} /></Field>
          <button className="button primary wide" onClick={prompt} disabled={Boolean(busy)}><FiFileText /> {busy === "prompt" ? "Generating prompt…" : values.prompt ? "Regenerate Prompt" : "Generate Prompt"}</button>
        </div>
      </div>
      {values.prompt && <div style={{ marginTop: 28 }}><Field label="Full production prompt"><textarea className="tall" style={{ minHeight: 420, lineHeight: 1.65 }} value={values.prompt} onChange={(e) => update("prompt", e.target.value)} /></Field><button className="button primary wide" style={{ marginTop: 18 }} onClick={produce}><FiImage /> Generate Post</button></div>}
    </section>
  );
}
type DetailValues = { title: string; url: string; score: number; postType: string; panelCount: number; setting: string; content: string; prompt: string; caption: string; hashtags: string };
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
  const content = formatPanelContent(image.content ?? concept?.detailed_prompt ?? "");
  return { title: story.title, url: story.url ?? "", score: story.score, postType: concept?.post_type ?? story.type, panelCount: concept?.panel_count ?? 5, setting: image.setting ?? [image.location, image.time_of_day].filter(Boolean).join(" · "), content, prompt: concept?.detailed_prompt ?? "", caption: concept?.caption ?? "", hashtags: normalizeHashtags((concept?.hashtags ?? []).join(" ")).join(" ") };
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
            Produce carousel{" "}
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
  caption,
  back,
  notify,
}: {
  caption: string;
  back: () => void;
  notify: (m: string) => void;
}) {
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
            <img
              src="/assets/hank-squirrel-preview.png"
              alt="Hank and the squirrel carousel preview"
            />
          </div>
          <div className="post-controls">
            <span>♡</span>
            <span>◯</span>
            <span>↗</span>
            <span className="save">♧</span>
          </div>
          <div className="dots">
            <i className="on" />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
        <aside className="post-details">
          <h2>Post details</h2>
          <b>Caption</b>
          <p>{caption}</p>
          <b>Hashtags</b>
          <div className="hashtags">
            {[].map(
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
            {Array.from({ length: 9 }, (_, i) => (
              <img
                key={i}
                src="/assets/carousel-production.png"
                alt="Carousel grid thumbnail"
              />
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
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
      <div className="metrics archive-metrics">
        <Metric number={String(rows.length)} label="Discarded" icon={<FiTrash2 />} />
        <Metric number="0" label="Low fit" icon={<FiArrowRight />} />
        <Metric number="0" label="Duplicates" icon={<FiGrid />} />
      </div>
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
