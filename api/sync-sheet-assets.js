import syncSheetGeneration from "./sync-sheet-generation.js";

export default async function handler(req, res) {
  req.syncMode = "assets";
  return syncSheetGeneration(req, res);
}
