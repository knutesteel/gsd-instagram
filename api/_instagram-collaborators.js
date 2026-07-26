const FIT_TERMS = [
  ["adhd", 18, "ADHD audience"],
  ["productivity", 16, "productivity content"],
  ["mental health", 16, "mental-health audience"],
  ["author", 12, "author/book audience"],
  ["book", 10, "book-focused content"],
  ["humor", 12, "humor"],
  ["comedy", 12, "comedy"],
  ["dog", 8, "dog content"],
  ["pet", 8, "pet content"],
  ["entrepreneur", 7, "entrepreneur audience"],
  ["self improvement", 10, "self-improvement content"],
  ["wellness", 8, "wellness audience"],
  ["florida", 5, "Florida relevance"],
  ["tampa", 7, "Tampa relevance"],
];

export function usernamesFromInstagramExport(value) {
  const found = new Map();
  if (typeof value === "string") {
    const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gis;
    let match;
    while ((match = anchorPattern.exec(value)) !== null) {
      const href = String(match[2] || "").replace(/&amp;/g, "&");
      const text = String(match[3] || "").replace(/<[^>]+>/g, "").trim();
      const hrefMatch = href.match(/instagram\.com\/(?:_u\/)?([A-Za-z0-9._]{1,30})(?:[/?#]|$)/i);
      const username = (hrefMatch?.[1] || text).replace(/^@/, "").trim();
      if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) continue;
      found.set(username.toLowerCase(), {
        username,
        followed_at: null,
        profile_url: hrefMatch ? `https://www.instagram.com/${username}/` : href,
      });
    }
    return [...found.values()];
  }
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.string_list_data)) {
      for (const item of node.string_list_data) {
        const username = String(item?.value || "").trim().replace(/^@/, "");
        if (/^[A-Za-z0-9._]{1,30}$/.test(username)) {
          const key = username.toLowerCase();
          const existing = found.get(key);
          found.set(key, {
            username,
            followed_at: existing?.followed_at || (item.timestamp ? new Date(Number(item.timestamp) * 1000).toISOString() : null),
            profile_url: existing?.profile_url || item.href || `https://www.instagram.com/${username}/`,
          });
        }
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(value);
  return [...found.values()];
}

export function collaborationFit(profile = {}) {
  const searchable = `${profile.username || ""} ${profile.name || ""} ${profile.biography || ""}`.toLowerCase();
  let score = 18;
  const reasons = [];
  for (const [term, points, reason] of FIT_TERMS) {
    if (searchable.includes(term)) {
      score += points;
      if (!reasons.includes(reason)) reasons.push(reason);
    }
  }
  const followers = Number(profile.followers_count || 0);
  if (followers >= 1000 && followers <= 100000) {
    score += 18;
    reasons.push("collaboration-sized audience");
  } else if (followers > 100000 && followers <= 500000) {
    score += 10;
    reasons.push("large audience");
  } else if (followers > 0 && followers < 1000) {
    score += 5;
    reasons.push("small engaged-account potential");
  }
  score = Math.min(100, score);
  const fit = score >= 70 ? "Excellent" : score >= 52 ? "Strong" : score >= 36 ? "Possible" : "Low";
  const analysis = reasons.length
    ? `Potential fit because of ${reasons.slice(0, 3).join(", ")}. Review recent posts and engagement before outreach.`
    : "Limited profile overlap is visible. Review recent content manually before proposing a collaboration.";
  return { fit_score: score, fit_label: fit, fit_analysis: analysis };
}

export function followingRefreshDue(lastImportedAt, now = Date.now()) {
  if (!lastImportedAt) return true;
  const importedAt = new Date(lastImportedAt).getTime();
  if (!Number.isFinite(importedAt)) return true;
  return now - importedAt >= 3 * 24 * 60 * 60 * 1000;
}
