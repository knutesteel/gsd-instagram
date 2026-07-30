import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../api/sync-sheet-generation.js", import.meta.url);
const source = await readFile(path, "utf8");

const original = String.raw`async function saveItemState({ supabaseUrl, headers, userId, articleId, identifier, stage, status, errorMessage = null, expectedImages = 0, importedImages = 0 }) {
  const failed = status === "failed";
  const now = new Date().toISOString();
  const response = await fetch(\`${supabaseUrl}/rest/v1/sheet_sync_items?on_conflict=user_id,article_id\`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      user_id: userId,
      article_id: articleId,
      identifier: Number(identifier),
      stage,
      status,
      error_message: errorMessage,
      expected_images: expectedImages,
      imported_images: importedImages,
      last_attempt_at: now,
      last_success_at: status === "complete" ? now : null,
      next_retry_at: failed ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null,
      retry_count: failed ? 1 : 0,
      updated_at: now,
    }]),
  });
  if (!response.ok) throw new Error(\`Couldn’t save synchronization state for #${identifier}.\`);
}`;

const replacement = String.raw`async function saveItemState({ supabaseUrl, headers, userId, articleId, identifier, stage, status, errorMessage = null, expectedImages = 0, importedImages = 0 }) {
  const failed = status === "failed";
  const now = new Date().toISOString();
  const url = \`${supabaseUrl}/rest/v1/sheet_sync_items?on_conflict=user_id,article_id\`;
  const body = JSON.stringify([{
    user_id: userId,
    article_id: articleId,
    identifier: Number(identifier),
    stage,
    status,
    error_message: errorMessage,
    expected_images: expectedImages,
    imported_images: importedImages,
    last_attempt_at: now,
    last_success_at: status === "complete" ? now : null,
    next_retry_at: failed ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null,
    retry_count: failed ? 1 : 0,
    updated_at: now,
  }]);
  let response;
  let detail = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
        body,
      });
      if (response.ok) {
        const saved = await response.json().catch(() => []);
        const row = Array.isArray(saved) ? saved[0] : null;
        if (row && String(row.article_id) === String(articleId) && Number(row.identifier) === Number(identifier)) return;
        detail = "Supabase accepted the write but did not return the expected audit row.";
      } else {
        detail = (await response.text().catch(() => "")).slice(0, 300);
      }
    } catch (error) {
      detail = error instanceof Error ? error.message : "request failed";
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 200 * (2 ** (attempt - 1))));
  }
  const statusCode = response ? \` HTTP ${response.status}.\` : "";
  throw new Error(\`Couldn’t save synchronization state for #${identifier}.${statusCode}${detail ? \` Supabase: ${detail}\` : ""}\`);
}`;

if (!source.includes(original)) {
  throw new Error("The sheet sync state function changed; update scripts/patch-sync-state.mjs before building.");
}

await writeFile(path, source.replace(original, replacement));
