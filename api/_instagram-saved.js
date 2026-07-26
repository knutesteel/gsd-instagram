const decodeHtml = (value) => String(value || "")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, "\"")
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const textFromHtml = (value) => decodeHtml(String(value || "")
  .replace(/<br\s*\/?>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim());

function normalizedInstagramUrl(value) {
  try {
    const url = new URL(decodeHtml(value));
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/(p|reel|tv)\/([^/?#]+)/i);
    if (!match) return null;
    return {
      url: `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/`,
      media_type: match[1].toLowerCase() === "p" ? "post" : match[1].toLowerCase(),
      shortcode: match[2],
    };
  } catch {
    return null;
  }
}

export function savedItemsFromInstagramExport(html) {
  if (typeof html !== "string" || !html.trim()) return [];
  const matches = [];
  const anchorPattern = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html))) {
    const media = normalizedInstagramUrl(match[3]);
    if (!media) continue;
    const context = html.slice(Math.max(0, match.index - 500), Math.min(html.length, anchorPattern.lastIndex + 500));
    const contextText = textFromHtml(context);
    const timestampMatch = contextText.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s+(?:AM|PM))?\b/i);
    const parsedTimestamp = timestampMatch ? new Date(`${timestampMatch[0]} UTC`) : null;
    matches.push({
      instagram_url: media.url,
      shortcode: media.shortcode,
      media_type: media.media_type,
      title: textFromHtml(match[5]) || "Saved Instagram item",
      saved_at: parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime()) ? parsedTimestamp.toISOString() : null,
    });
  }
  return [...new Map(matches.map((item) => [item.instagram_url, item])).values()];
}
