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
  type: string;
  status: "Proposed" | "Produced" | "Archived";
};

function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [items, setItems] = useState<Story[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [caption, setCaption] = useState(
    "You don’t need more willpower. You need fewer tiny interruptions pretending to be urgent.\n\nYour focus is real. Protect it like it matters.",
  );
  const [change, setChange] = useState("");
  const [toast, setToast] = useState("");
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [userId, setUserId] = useState<string | null>(null);
  const active = items.find((i) => i.id === selected) ?? items[0];
  const proposed = items.filter((i) => i.status === "Proposed");
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
    supabase.from("articles").select("id,title,category,rank,status,post_concepts(post_type,summary)").order("rank", { ascending: false }).then(({ data, error }) => {
      if (error) return notify(`Couldn’t load your queue: ${error.message}`);
      const saved: Story[] = (data ?? []).map((row: any) => ({ id: row.id, title: row.title, overview: row.post_concepts?.[0]?.summary ?? "No summary saved yet.", category: row.category ?? "Uncategorized", score: row.rank ?? 0, type: row.post_concepts?.[0]?.post_type ?? "Carousel", status: (row.status === "discarded" || row.status === "removed" ? "Archived" : row.status === "produced" || row.status === "ready" ? "Produced" : "Proposed") as Story["status"] }));
      setItems(saved);
      if (saved[0]) setSelected(saved[0].id);
    });
  }, [userId]);
  const updateStatus = async (id: string, status: "discarded" | "produced") => {
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
    void updateStatus(selected, "produced");
    setScreen("dashboard");
  };
  const produce = () => {
    setItems((old) =>
      old.map((i) => (i.id === selected ? { ...i, status: "Produced" } : i)),
    );
    setScreen("produce");
    notify("Five carousel panels are ready for review.");
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
    await supabase.from("articles").select("id,title,category,rank,status,post_concepts(post_type,summary)").order("rank", { ascending: false }).then(({ data: rows }) => {
      const saved: Story[] = (rows ?? []).map((row: any) => ({ id: row.id, title: row.title, overview: row.post_concepts?.[0]?.summary ?? "No summary saved yet.", category: row.category ?? "Uncategorized", score: row.rank ?? 0, type: row.post_concepts?.[0]?.post_type ?? "Carousel", status: (row.status === "discarded" || row.status === "removed" ? "Archived" : row.status === "produced" || row.status === "ready" ? "Produced" : "Proposed") as Story["status"] }));
      setItems(saved); if (saved[0]) setSelected(saved[0].id);
    });
    return result.count as number;
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
              setScreen("detail");
            }}
            onProduce={(id) => {
              setSelected(id);
              produce();
            }}
            onDiscard={discard}
          />
        )}
        {screen === "discover" && (
          <Discover
            searching={searching}
            setSearching={setSearching}
            notify={notify}
            research={research}
          />
        )}
        {screen === "detail" && (
          <Detail
            story={active}
            caption={caption}
            setCaption={setCaption}
            previous={() => navigate(-1)}
            next={() => navigate(1)}
            produce={produce}
            discard={() => discard(active.id)}
          />
        )}
        {screen === "produce" && (
          <Produce
            story={active}
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
                  i.id === id ? { ...i, status: "Proposed" } : i,
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
  return <main className="auth-page"><form className="auth-card" onSubmit={sendLink}>
    <div className="brand"><span>GSD</span><em>Instagram</em></div>
    <h1>Your story desk</h1><p>Sign in to save research, concepts, and assets privately to your workspace.</p>
    <label className="field"><b>Email address</b><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
    <button className="button primary wide" disabled={sending}>{sending ? "Sending…" : "Email me a sign-in link"}</button>
    {message && <p className="auth-message">{message}</p>}
  </form></main>;
}

type PromptDocument = { id: string; kind: "icp" | "voice_guide"; file_name: string; created_at: string; text_content?: string | null };
function Guidance() {
  const [documents, setDocuments] = useState<PromptDocument[]>([]);
  const [uploading, setUploading] = useState<"icp" | "voice_guide" | null>(null);
  const [message, setMessage] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [savingVoice, setSavingVoice] = useState(false);
  const loadDocuments = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("prompt_documents").select("id,kind,file_name,created_at,text_content").eq("is_active", true).order("created_at", { ascending: false });
    if (error) setMessage(error.message); else { const saved = (data ?? []) as PromptDocument[]; setDocuments(saved); setVoiceText(saved.find((doc) => doc.kind === "voice_guide")?.text_content ?? ""); }
  };
  useEffect(() => { void loadDocuments(); }, []);
  const upload = async (kind: "icp" | "voice_guide", file?: File) => {
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
    const textContent = kind === "voice_guide" && (file.name.endsWith(".md") || file.type.startsWith("text/")) ? await file.text() : null;
    const { error: dbError } = await supabase.from("prompt_documents").insert({ user_id: user.id, kind, file_name: file.name, storage_path: path, mime_type: file.type || null, file_size: file.size, text_content: textContent });
    if (dbError) { await supabase.storage.from("prompt-documents").remove([path]); setMessage(dbError.message); } else { setMessage(`${file.name} is ready to guide future prompts.`); await loadDocuments(); }
    setUploading(null);
  };
  const saveVoice = async () => { if (!supabase) return; setSavingVoice(true); const { data: userData } = await supabase.auth.getUser(); const existing = documents.find((doc) => doc.kind === "voice_guide"); const payload = { text_content: voiceText, file_name: existing?.file_name ?? "GSD Voice.md" }; const { error } = existing ? await supabase.from("prompt_documents").update(payload).eq("id", existing.id) : await supabase.from("prompt_documents").insert({ user_id: userData.user?.id, kind: "voice_guide", storage_path: `${userData.user?.id}/voice_guide/GSD-Voice.md`, mime_type: "text/markdown", file_size: voiceText.length, ...payload }); setSavingVoice(false); setMessage(error ? error.message : "GSD Voice saved and ready for all future prompts."); await loadDocuments(); };
  const card = (kind: "icp" | "voice_guide", title: string, description: string) => {
    const docs = documents.filter((doc) => doc.kind === kind);
    return <article className="guidance-card"><span className="guidance-icon"><FiBookOpen /></span><h2>{title}</h2><p>{description}</p><label className="button primary wide"><FiUploadCloud /> {uploading === kind ? "Uploading…" : `Upload ${title}`}<input hidden type="file" accept={kind === "voice_guide" ? ".md,.txt,text/markdown,text/plain" : ".pdf,.txt,.doc,.docx,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"} disabled={Boolean(uploading)} onChange={(e) => { void upload(kind, e.target.files?.[0]); e.currentTarget.value = ""; }} /></label><small>{kind === "voice_guide" ? "Markdown or TXT · editable below" : "PDF, DOCX, DOC, or TXT · 10 MB max"} · private to your workspace</small>{kind === "voice_guide" && <><Field label="Editable GSD Voice"><textarea className="voice-editor" value={voiceText} onChange={(e) => setVoiceText(e.target.value)} placeholder="Upload a .md file or write the GSD Voice here…" /></Field><button className="button wide" onClick={() => void saveVoice()} disabled={savingVoice}>{savingVoice ? "Saving…" : "Save GSD Voice"}</button></>}{docs.length > 0 ? <div className="document-list">{docs.map((doc) => <div key={doc.id}><FiFileText /> <span>{doc.file_name}</span><FiCheck /></div>)}</div> : <div className="document-empty">No file uploaded yet.</div>}</article>;
  };
  return <section><header className="page-header"><div><h1>Prompt guidance</h1><p>Upload the source documents that define who we are talking to and how Hank and the squirrel should sound.</p></div></header><div className="guidance-grid">{card("icp", "ICP", "Your ideal customer profile: priorities, problems, context, and the emotional reality each post should recognize.")}{card("voice_guide", "GSD Voice", "Your tone, language, character rules, and creative guardrails. These will be injected into research and production prompts.")}</div>{message && <p className="guidance-message">{message}</p>}<div className="panel guidance-note"><FiCheck /><div><b>Private by default</b><p>These documents are stored in a private Supabase bucket. Only your signed-in workspace can access them.</p></div></div></section>;
}

function Dashboard({
  items,
  discover,
  select,
  onProduce,
  onDiscard,
}: {
  items: Story[];
  discover: () => void;
  select: (id: string) => void;
  onProduce: (id: string) => void;
  onDiscard: (id: string) => void;
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
        <Metric number="25" label="To review" icon={<FiFileText />} />
        <Metric number="7" label="Produced" icon={<FiCheck />} />
        <Metric number="18" label="Archived" icon={<FiArchive />} />
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
            <div className="actions">
              <button onClick={() => select(item.id)}>Edit</button>
              <button className="outline" onClick={() => onProduce(item.id)}>
                Produce
              </button>
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
}: {
  searching: boolean;
  setSearching: (v: boolean) => void;
  notify: (m: string) => void;
  research: (payload: Record<string, unknown>) => Promise<number>;
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
      const count = await research({ mode, manualUrl: manualUrl.trim(), searchText: searchText.trim(), topics, timeframe: 48 });
      setQueued(mode === "manual" ? ["Article analyzed", "GSD fit scored", "Post concept saved"] : ["Searching trusted, accessible sources", "Ranking GSD audience fit", "Building post concepts"]);
      notify(`${count} ${count === 1 ? "story" : "stories"} added to your dashboard.`);
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
        {(queued.length ? queued : ["Attention & Brain", "Animal Behavior", "Weird Human News"]).map(
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
  caption,
  setCaption,
  previous,
  next,
  produce,
  discard,
}: {
  story: Story;
  caption: string;
  setCaption: (s: string) => void;
  previous: () => void;
  next: () => void;
  produce: () => void;
  discard: () => void;
}) {
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
          <button className="button primary" onClick={produce}>
            Produce
          </button>
        </div>
      </div>
      <h1>Article detail</h1>
      <div className="detail-grid">
        <div className="left-fields">
          <div className="source">
            <FiExternalLink />
            <span>https://research.example.com/attention-cost</span>
          </div>
          <Field label="Article summary">
            <textarea defaultValue={story.overview} />
          </Field>
          <Field label="Post type">
            <select defaultValue={story.type}>
              <option>Carousel</option>
              <option>Reel</option>
              <option>Single image</option>
            </select>
          </Field>
          <Field label="Panels">
            <input defaultValue="5" />
          </Field>
          <Field label="Image summary">
            <textarea
              className="expanded"
              defaultValue={
                "Location: warm home office\nTime: late afternoon\nHank’s expression: tired but amused\nthe squirrel’s expression: smug and delighted"
              }
            />
          </Field>
        </div>
        <div className="right-fields">
          <Field label="Detailed production prompt">
            <textarea
              className="tall"
              defaultValue={
                "Create five separate 4:5 carousel panels using the GSD Voice and ICP. Hank is visibly larger than the squirrel. All conversation is in readable speech bubbles. Maintain clothing and setting continuity.\n\nHank: “Every notification is a tiny meeting you didn’t agree to.”\nthe squirrel: “I put them all on your calendar. You’re welcome.”"
              }
            />
          </Field>
          <Field label="Caption">
            <textarea
              className="caption-editor"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </Field>
          <Field label="Suggested hashtags">
            <input defaultValue="#FocusOverFluff, #Attention, #GetShitDone, #DeepWork" />
          </Field>
        </div>
      </div>
    </section>
  );
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
  change,
  setChange,
  onPreview,
  notify,
}: {
  story: Story;
  change: string;
  setChange: (s: string) => void;
  onPreview: () => void;
  notify: (m: string) => void;
}) {
  const [active, setActive] = useState(2);
  return (
    <section>
      <header className="produce-head">
        <div>
          <h1>
            Produce carousel{" "}
            <span className="ready">
              <FiCheck /> Assets ready
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
          <div className="asset-strip">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={active === n ? "asset selected" : "asset"}
                onClick={() => setActive(n)}
              >
                <img
                  src="/assets/carousel-production.png"
                  alt={`Generated carousel panel ${n}`}
                />
                <span>{n}</span>
              </button>
            ))}
          </div>
          <div className="copy-grid">
            <Field label="Post text">
              <textarea
                defaultValue={
                  "Every ping pulls a little from your focus.\n\nThe cost is real—your attention, your time, your peace.\n\nProtect your focus. Do what matters most."
                }
              />
            </Field>
            <div className="field hash-field">
              <b>Suggested hashtags</b>
              <div className="hashes">
                {[
                  "#Focus",
                  "#DeepWork",
                  "#AttentionIsScarce",
                  "#DigitalWellbeing",
                  "#MindfulWork",
                  "#GSD",
                ].map((x) => (
                  <span key={x}>
                    {x} <FiPlus />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <aside className="asset-editor">
          <h2>Asset {active} of 5</h2>
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
            onClick={() => {
              setChange("");
              notify("Panel regeneration started with your requested change.");
            }}
          >
            <FiRefreshCw /> Regenerate
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
            {["#FocusOverFluff", "#Attention", "#GetShitDone", "#DeepWork"].map(
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
        <Metric number="142" label="Discarded" icon={<FiTrash2 />} />
        <Metric number="88" label="Low fit" icon={<FiArrowRight />} />
        <Metric number="51" label="Duplicates" icon={<FiGrid />} />
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
