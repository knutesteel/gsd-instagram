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
          required: ["title", "summary", "suggested_content"],
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            suggested_content: { type: "string" },
          },
        },
      },
    },
  };

  const prompt = `Use web search to identify ten of the biggest timely, high-engagement social-media conversations or trends in the United States right now. Favor trends visibly active across TikTok, Instagram, YouTube, Reddit, X, Google Trends, or major social reporting. Exclude politics, tragedy, crime, unsafe challenges, sexual content, celebrity gossip, and anything that is not appropriate for a warm all-ages brand. Do not invent metrics or claim an exact platform rank. Return exactly ten distinct topics. For each: a short title, a concise factual summary of why people are talking about it, and a practical, playful suggested Hank-and-the-squirrel content idea. The idea must make panel 1 directly connect to the topic; later panels can become a natural character conversation rather than repeating facts.`;

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
