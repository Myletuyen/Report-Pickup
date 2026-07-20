const Papa = require('papaparse');
const { fetchPublicCsv } = require('./_lib/sheetsClient');
const { buildTree } = require('./_lib/aggregate');

// "Backlog Firstmile" spreadsheet shared by the team as "Anyone with the link
// can view" — no service account / credentials needed to read it. All backlog
// rows live in one "DATA RAW" tab; VIP vs Thường is a Category column value on
// each row, not a separate tab (the "all seller VIP" / "all seller Thường"
// tabs turned out to both mirror the full raw data, not filtered subsets).
const SPREADSHEET_ID = process.env.PICKUP_SPREADSHEET_ID || '14h6x-yB0uScxO8DDTliF6B79Xxt-gSXg1Kk3BXrfIWI';
const RAW_SHEET = process.env.PICKUP_SHEET_RAW || 'DATA RAW';

const COLUMN_MAP = {
    seller: 'Clientcontactname',
    pickWH: 'PickWH',
    region: 'FromRegionShortName',
    province: 'FromProvince',
    aging: 'Aging',
    status: 'CurrentStatus',
    category: 'Category',
};

// The "number of pickup attempts" column name isn't confirmed exactly, so match
// it case/whitespace-insensitively against a few likely spellings instead of a
// single hardcoded header string.
const NUMBER_PICK_CANDIDATES = ['numpick', 'numberpick', 'numberofpick', 'numofpick', 'pickattempt', 'pickattempts', 'solanlay'];

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

function isVip(row) {
    return (row[COLUMN_MAP.category] || '').trim().toLowerCase() === 'vip';
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const csvText = await fetchPublicCsv(SPREADSHEET_ID, RAW_SHEET);
        const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data;

        const vipRows = rows.filter(isVip);
        const thuongRows = rows.filter(row => !isVip(row));

        const vipResult = buildTree(vipRows, [
            row => row[COLUMN_MAP.seller],
            row => row[COLUMN_MAP.pickWH],
        ], COLUMN_MAP.aging);

        const thuongResult = buildTree(thuongRows, [
            row => row[COLUMN_MAP.region],
            row => row[COLUMN_MAP.province],
            row => row[COLUMN_MAP.pickWH],
        ], COLUMN_MAP.aging);

        rows.forEach(row => { row.__sellerType = isVip(row) ? 'Seller VIP' : 'Seller Thường'; });
        const regionResult = buildTree(rows, [
            row => row[COLUMN_MAP.region],
            row => row.__sellerType,
            // Under "Seller VIP": list of seller names. Under "Seller Thường": list of pickup offices (Bưu cục).
            row => row.__sellerType === 'Seller VIP' ? row[COLUMN_MAP.seller] : row[COLUMN_MAP.pickWH],
        ], COLUMN_MAP.aging);

        const statusCounts = countBy(rows, row => (row[COLUMN_MAP.status] || '').trim() || 'unknown');
        const numberPickKey = findNumberPickKey(rows[0]);
        const attemptCounts = numberPickKey
            ? countBy(rows, row => bucketAttempts(row[numberPickKey]))
            : null;

        const unknownAgingValues = Array.from(new Set([
            ...vipResult.unknownAgingValues,
            ...thuongResult.unknownAgingValues,
        ]));

        if (unknownAgingValues.length > 0) {
            console.warn('Unrecognized Aging values:', unknownAgingValues);
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return res.status(200).json({
            vipTree: vipResult.tree,
            thuongTree: thuongResult.tree,
            regionTree: regionResult.tree,
            rowCount: rows.length,
            unknownAgingValues,
            statusCounts,
            attemptCounts,
        });
    } catch (err) {
        console.error('Error fetching backlog data:', err.message);
        return res.status(500).json({ error: 'Failed to fetch data: ' + err.message });
    }
};
