const json = { "Content-Type": "application/json" };

export async function extendSheetFilter({ accessToken, spreadsheetId, sheetTitle = "Sheet1", lastRow, endColumnIndex = 17 }) {
  if (!Number.isInteger(lastRow) || lastRow < 1) throw new Error("Couldn’t determine the new Google Sheets filter range.");

  const metadata = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=${encodeURIComponent("sheets(properties(sheetId,title),basicFilter)")}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metadata.ok) throw new Error("Couldn’t read the Google Sheets filter configuration.");
  const sheet = (await metadata.json()).sheets?.find((item) => item.properties?.title === sheetTitle);
  if (!sheet) throw new Error(`Couldn’t find the ${sheetTitle} worksheet.`);

  const existingFilter = sheet.basicFilter || {};
  const basicFilter = {
    ...existingFilter,
    range: {
      ...(existingFilter.range || {}),
      sheetId: sheet.properties.sheetId,
      startRowIndex: existingFilter.range?.startRowIndex ?? 0,
      endRowIndex: Math.max(existingFilter.range?.endRowIndex ?? 0, lastRow),
      startColumnIndex: existingFilter.range?.startColumnIndex ?? 0,
      endColumnIndex: Math.max(existingFilter.range?.endColumnIndex ?? 0, endColumnIndex),
    },
  };

  const update = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { ...json, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ requests: [{ setBasicFilter: { filter: basicFilter } }] }),
  });
  if (!update.ok) throw new Error("Couldn’t include the new row in the Google Sheets filter.");
}
