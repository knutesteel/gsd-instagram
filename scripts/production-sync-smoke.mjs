const baseUrl = String(process.env.SMOKE_BASE_URL || "https://gsd-instagram2.vercel.app").replace(/\/$/, "");
const authToken = process.env.SMOKE_AUTH_TOKEN;

if (!authToken) {
  console.error("SMOKE_AUTH_TOKEN is required.");
  process.exit(2);
}

const response = await fetch(`${baseUrl}/api/sync-sheet-generation`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ repairMissingRows: false }),
});

const bodyText = await response.text();
let result;
try {
  result = JSON.parse(bodyText);
} catch {
  throw new Error(`Smoke endpoint returned non-JSON HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
}

if (!response.ok) {
  throw new Error(`Synchronization endpoint failed with HTTP ${response.status}: ${result.error || bodyText}`);
}

const rowResults = Array.isArray(result.rowResults) ? result.rowResults : [];
if (!rowResults.length) throw new Error("Synchronization returned no rowResults; the run cannot be certified.");

const invalidOutcomes = rowResults.filter((row) => !["updated", "already_synchronized"].includes(row.outcome));
const syncErrors = Array.isArray(result.syncErrors) ? result.syncErrors : [];
const counts = result.resultCounts || {};

if (invalidOutcomes.length || syncErrors.length || Number(counts.failed || 0) > 0) {
  console.error(JSON.stringify({ invalidOutcomes, syncErrors, resultCounts: counts }, null, 2));
  throw new Error(`Production synchronization smoke test failed for ${invalidOutcomes.length || syncErrors.length} row(s).`);
}

if (Number(counts.updated || 0) + Number(counts.already_synchronized || 0) !== rowResults.length) {
  throw new Error("Synchronization counts do not reconcile to the returned row results.");
}

console.log(JSON.stringify({
  baseUrl,
  passed: true,
  rows: rowResults.length,
  updated: Number(counts.updated || 0),
  alreadySynchronized: Number(counts.already_synchronized || 0),
  restoredIdentifiers: result.restoredIdentifiers || [],
}, null, 2));
