const Papa = require('papaparse');
const { fetchPublicCsv } = require('./_lib/sheetsClient');
const { buildTree } = require('./_lib/aggregate');

// "Backlog Firstmile" spreadsheet shared by the team as "Anyone with the link
// can view" — no service account / credentials needed to read it.
const SPREADSHEET_ID = process.env.PICKUP_SPREADSHEET_ID || '14h6x-yB0uScxO8DDTliF6B79Xxt-gSXg1Kk3BXrfIWI';

const SHEETS = {
    vip: process.env.PICKUP_SHEET_VIP || 'all seller VIP',
    thuong: process.env.PICKUP_SHEET_THUONG || 'all seller Thường',
};

const COLUMN_MAP = {
    seller: 'Clientcontactname',
    pickWH: 'PickWH',
    region: 'FromRegionShortName',
    province: 'FromProvince',
    aging: 'Aging',
    status: 'CurrentStatus',
};

const LEVELS = {
    vip: [row => row[COLUMN_MAP.seller], row => row[COLUMN_MAP.pickWH]],
    thuong: [row => row[COLUMN_MAP.region], row => row[COLUMN_MAP.province], row => row[COLUMN_MAP.pickWH]],
};

async function loadRows(sheetName) {
    const csvText = await fetchPublicCsv(SPREADSHEET_ID, sheetName);
    return Papa.parse(csvText, { header: true, skipEmptyLines: true }).data;
}

// The "number of pickup attempts" column name isn't confirmed exactly, so match
// it case/whitespace-insensitively against a few likely spellings instead of a
// single hardcoded header string.
const NUMBER_PICK_CANDIDATES = ['numberpick', 'numberofpick', 'numofpick', 'pickattempt', 'pickattempts', 'solanlay'];

function findNumberPickKey(sampleRow) {
    if (!sampleRow) return null;
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const keys = Object.keys(sampleRow);
    return keys.find(k => NUMBER_PICK_CANDIDATES.includes(normalize(k))) || null;
}

function bucketAttempts(raw) {
    const n = parseInt(String(raw == null ? '' : raw).trim(), 10);
    if (isNaN(n)) return 'unknown';
    if (n <= 0) return '0';
    if (n === 1) return '1';
    if (n === 2) return '2';
    return '>=3';
}

function countBy(rows, keyFn) {
    const counts = {};
    rows.forEach(row => {
        const key = keyFn(row);
        counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const source = req.query.source;
    if (source !== 'vip' && source !== 'thuong' && source !== 'region') {
        return res.status(400).json({ error: 'Bad Request: source must be "vip", "thuong" or "region"' });
    }

    try {
        let tree, unknownAgingValues, rowCount, statusCounts, attemptCounts;

        if (source === 'region') {
            // Combined region-level overview: Region -> {Seller VIP, Seller Thường}.
            const [vipRows, thuongRows] = await Promise.all([
                loadRows(SHEETS.vip),
                loadRows(SHEETS.thuong),
            ]);
            vipRows.forEach(row => { row.__sellerType = 'Seller VIP'; });
            thuongRows.forEach(row => { row.__sellerType = 'Seller Thường'; });
            const combined = vipRows.concat(thuongRows);
            const result = buildTree(combined, [
                row => row[COLUMN_MAP.region],
                row => row.__sellerType,
                // Under "Seller VIP": list of seller names. Under "Seller Thường": list of pickup offices (Bưu cục).
                row => row.__sellerType === 'Seller VIP' ? row[COLUMN_MAP.seller] : row[COLUMN_MAP.pickWH],
            ], COLUMN_MAP.aging);
            tree = result.tree;
            unknownAgingValues = result.unknownAgingValues;
            rowCount = combined.length;

            statusCounts = countBy(combined, row => (row[COLUMN_MAP.status] || '').trim() || 'unknown');

            const numberPickKey = findNumberPickKey(combined[0]);
            attemptCounts = numberPickKey
                ? countBy(combined, row => bucketAttempts(row[numberPickKey]))
                : null;
        } else {
            const rows = await loadRows(SHEETS[source]);
            const result = buildTree(rows, LEVELS[source], COLUMN_MAP.aging);
            tree = result.tree;
            unknownAgingValues = result.unknownAgingValues;
            rowCount = rows.length;
        }

        if (unknownAgingValues.length > 0) {
            console.warn(`Unrecognized Aging values for source=${source}:`, unknownAgingValues);
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return res.status(200).json({ tree, rowCount, unknownAgingValues, statusCounts, attemptCounts });
    } catch (err) {
        console.error(`Error fetching source=${source}:`, err.message);
        return res.status(500).json({ error: 'Failed to fetch data: ' + err.message });
    }
};
