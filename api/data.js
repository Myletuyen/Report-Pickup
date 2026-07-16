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
};

const LEVELS = {
    vip: [row => row[COLUMN_MAP.seller], row => row[COLUMN_MAP.pickWH]],
    thuong: [row => row[COLUMN_MAP.region], row => row[COLUMN_MAP.province], row => row[COLUMN_MAP.pickWH]],
};

async function loadRows(sheetName) {
    const csvText = await fetchPublicCsv(SPREADSHEET_ID, sheetName);
    return Papa.parse(csvText, { header: true, skipEmptyLines: true }).data;
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
        let tree, unknownAgingValues, rowCount;

        if (source === 'region') {
            // Combined region-level overview: Region -> {Seller VIP, Seller Thường}.
            const [vipRows, thuongRows] = await Promise.all([
                loadRows(SHEETS.vip),
                loadRows(SHEETS.thuong),
            ]);
            vipRows.forEach(row => { row.__sellerType = 'Seller VIP'; });
            thuongRows.forEach(row => { row.__sellerType = 'Seller Thường'; });
            const combined = vipRows.concat(thuongRows);
            const result = buildTree(combined, [row => row[COLUMN_MAP.region], row => row.__sellerType], COLUMN_MAP.aging);
            tree = result.tree;
            unknownAgingValues = result.unknownAgingValues;
            rowCount = combined.length;
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
        return res.status(200).json({ tree, rowCount, unknownAgingValues });
    } catch (err) {
        console.error(`Error fetching source=${source}:`, err.message);
        return res.status(500).json({ error: 'Failed to fetch data: ' + err.message });
    }
};
