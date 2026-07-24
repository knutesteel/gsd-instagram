const postTypeBySheetLabel = {
  carousel: "carousel",
  "single image": "single_image",
  "multi pane cartoon": "multi_pane_cartoon",
  "multi-pane cartoon": "multi_pane_cartoon",
  reel: "reel",
};

export const sheetTypeLabel = (value) => ({
  carousel: "Carousel",
  single_image: "Single Image",
  multi_pane_cartoon: "Multi-pane Cartoon",
  reel: "Reel",
}[value] || String(value || "Carousel"));

export const appPostType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
  return postTypeBySheetLabel[normalized] || normalized.replace(/\s+/g, "_") || "carousel";
};

export const hashtagsFromSheet = (value) =>
  String(value || "").split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean);

export const sharedFieldsFromSheetRow = (row) => ({
  article: {
    title: String(row[2] || ""),
    source_url: String(row[4] || ""),
    canonical_url: String(row[4] || ""),
    source: String(row[17] || ""),
  },
  concept: {
    summary: String(row[5] || ""),
    panel_count: Math.max(1, Number(row[6]) || 1),
    post_type: appPostType(row[7]),
    content: String(row[8] || ""),
    caption: String(row[10] || ""),
    hashtags: hashtagsFromSheet(row[11]),
  },
});

export const sharedSheetValuesFromApp = ({ article, concept }) => ({
  firstRange: [
    String(article.title || ""),
    String(article.source_url || article.canonical_url || ""),
    String(concept.summary || ""),
    Math.max(1, Number(concept.panel_count) || 1),
    sheetTypeLabel(concept.post_type),
    String(concept.image_summary?.content || ""),
  ],
  secondRange: [
    String(concept.caption || ""),
    Array.isArray(concept.hashtags) ? concept.hashtags.join(" ") : String(concept.hashtags || ""),
  ],
  source: String(article.source || ""),
});
