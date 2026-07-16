// Sheet is shared as "Anyone with the link can view", so we read it through
// the public gviz CSV export endpoint — no service account / credentials
// needed. Google's CSV escaping (quotes/newlines) is passed straight through.
async function fetchPublicCsv(spreadsheetId, sheetName) {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Google Sheets returned HTTP ${response.status} for sheet "${sheetName}" (is it shared as "Anyone with the link can view"?)`);
    }
    return response.text();
}

module.exports = { fetchPublicCsv };
