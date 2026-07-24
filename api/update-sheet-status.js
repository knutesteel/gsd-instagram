import { createPrivateKey, sign } from "node:crypto";

// Generation has one canonical sheet. A stale Vercel override previously made
// rollback search a different spreadsheet from Send for Generation.
const spreadsheetId = "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ";
const base64Url = (value) => Buffer.from(value).toString("base64url");
const statusMap = {
  New: { app: "new", sheet: "New" },
  "Sent to Sheets": { app: "sent_to_sheets", sheet: "Pending" },
  Generated: { app: "generated", sheet: "Generated" },
  Approved: { app: "approved_to_post", sheet: "Approved" },
  Posted: { app: "posted", sheet: "Posted" },
  Archived: { app: "discarded", sheet: "Archived" },
};

export const statusRequiresSheetLookup = (status, hasIdentifier = false) =>
  status !== "Archived" || hasIdentifier;

async function googleAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Google Sheets connection is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(privateKey)).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }) });
  if (!response.ok) throw new Error("Couldn’t authenticate the Google Sheets connection.");
  return (await response.json()).access_token;
}

async function findSheetRow(accessToken, identifier) {
  const lookup = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:R")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!lookup.ok) throw new Error("Couldn’t read the generation Google Sheet.");
  const rows = (await lookup.json()).values ?? [];
  const foundIndex = rows.findIndex((row, index) => index > 0 && String(row[3] || "").trim() === String(identifier).trim());
  return foundIndex < 0 ? null : foundIndex + 1;
}

async function deleteSheetRow(accessToken, rowNumber) {
  const metadata = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=${encodeURIComponent("sheets(properties(sheetId,title))")}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metadata.ok) throw new Error("Couldn’t read the generation worksheet configuration.");
  const sheet = (await metadata.json()).sheets?.find((item) => item.properties?.title === "Sheet1");
  if (!sheet) throw new Error("Couldn’t find the Sheet1 worksheet.");

  const deletion = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ deleteDimension: { range: {
      sheetId: sheet.properties.sheetId,
      dimension: "ROWS",
      startIndex: rowNumber - 1,
      endIndex: rowNumber,
    } } }] }),
  });
  if (!deletion.ok) throw new Error("Couldn’t delete the article row from the generation Google Sheet.");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const articleId = req.body?.articleId;
  const status = req.body?.status;
  const target = statusMap[status];
  if (!token || !supabaseUrl || !key) return res.status(500).json({ error: "Server configuration is incomplete." });
  if (!articleId || !target) return res.status(400).json({ error: "A valid article and status are required." });

  const headers = { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });
  const user = await userResponse.json();

  try {
    const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,generation_identifier,generation_sheet_row`, { headers });
    if (!articleResponse.ok) throw new Error("Couldn’t find the article.");
    const article = (await articleResponse.json())[0];
    if (!article) return res.status(404).json({ error: "Article not found." });

    // A brand-new article can be archived without touching Sheets. If the
    // article has an identifier, remove any matching sheet row by Identifier;
    // a missing row is valid and does not block archiving.
    if (!statusRequiresSheetLookup(status, Boolean(article.generation_identifier))) {
      const archiveUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ status: target.app }),
      });
      if (!archiveUpdate.ok) throw new Error("Couldn’t save the status in the app.");
      return res.status(200).json({ status, appOnly: true });
    }

    let sheetRow = article.generation_sheet_row;
    let accessToken = null;
    // Rows can move or be recreated after a sheet cleanup. Resolve by identifier
    // before falling back to the saved row number so the wrong story is never updated.
    if (article.generation_identifier) {
      accessToken = await googleAccessToken();
      sheetRow = await findSheetRow(accessToken, article.generation_identifier);
      if (!sheetRow && status !== "Archived") throw new Error(`Couldn’t find identifier #${article.generation_identifier} in the Google Sheet.`);
    }

    if (sheetRow) {
      accessToken ||= await googleAccessToken();
      if (status === "New" || status === "Archived") {
        await deleteSheetRow(accessToken, sheetRow);
      } else {
        const update = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`Sheet1!B${sheetRow}`)}?valueInputOption=USER_ENTERED`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ values: [[target.sheet]] }),
        });
        if (!update.ok) throw new Error("Couldn’t update the status in the Google Sheet.");
      }
    }

    const statusUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ status: target.app, ...(["New", "Archived"].includes(status) ? { generation_sheet_row: null } : { generation_sheet_row: sheetRow }) }),
    });
    if (!statusUpdate.ok) throw new Error("Couldn’t save the status in the app.");
    return res.status(200).json({ status });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t update the status." });
  }
}
