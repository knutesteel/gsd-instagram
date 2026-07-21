const jsonHeaders = { "Content-Type": "application/json" };

const getOutputText = (response) =>
  response.output_text ??
  response.output?.flatMap((item) => item.content ?? []).find((part) => part.type === "output_text")?.text;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!token || !supabaseUrl || !publicKey || !openaiKey) {
    return res.status(500).json({ error: "Server configuration is incomplete." });
  }

  const auth = { apikey: publicKey, Authorization: `Bearer ${token}` };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: auth });
  if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["topics"],
    properties: {
      topics: {
        type: "array",
        minItems: 10,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "platform", "summary", "suggested_content", "source_url"],
          properties: {
            title: { type: "string" },
            platform: { type: "string" },
            summary: { type: "string" },
            suggested_content: { type: "string" },
            source_url: { type: "string" },
          },
        },
      },
    },
  };

  const prompt = `Use web search to identify ten of the biggest timely, high-engagement trends happening on social-media platforms in the United States right now. These must be platform-native trends such as a viral format, meme, challenge, sound, creator behavior, shared prompt, fandom moment, or distinctive conversation pattern—not news stories or reports about trends. Use only a trend that is visibly active on TikTok, Instagram, YouTube, Reddit, or X. For each trend, identify the single primary platform where it is currently most active. Exclude politics, tragedy, crime, unsafe challenges, sexual content, celebrity gossip, and anything that is not appropriate for a warm all-ages brand. Do not invent metrics or claim an exact platform rank. Return exactly ten distinct trends. For each: a short title, platform (use a single platform name), a concise factual summary of the platform-native trend, one direct clickable source_url to a current supporting page, and a broad suggested Hank-and-the-squirrel commentary angle. The suggested commentary must be a high-level premise or human observation, not a panel-by-panel layout, dialogue, scene list, or image-generation prompt.`;

  try {
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { ...jsonHeaders, Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-5-mini",
        tools: [{ type: "web_search" }],
        input: prompt,
        text: { format: { type: "json_schema", name: "social_trends", strict: true, schema } },
      }),
    });
    if (!aiResponse.ok) return res.status(502).json({ error: "Could not load current trends." });
    const output = getOutputText(await aiResponse.json());
    const parsed = JSON.parse(output);
    return res.status(200).json({ topics: parsed.topics });
  } catch {
    return res.status(502).json({ error: "Could not load current trends. Please refresh and try again." });
  }
}
