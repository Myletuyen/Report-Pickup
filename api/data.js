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

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const source = req.query.source;
    if (!SHEETS[source]) {
        return res.status(400).json({ error: 'Bad Request: source must be "vip" or "thuong"' });
    }

    try {
        const csvText = await fetchPublicCsv(SPREADSHEET_ID, SHEETS[source]);
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
        const { tree, unknownAgingValues } = buildTree(parsed.data, LEVELS[source], COLUMN_MAP.aging);

        if (unknownAgingValues.length > 0) {
            console.warn(`Unrecognized Aging values for source=${source}:`, unknownAgingValues);
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return res.status(200).json({ tree, rowCount: parsed.data.length, unknownAgingValues });
    } catch (err) {
        console.error(`Error fetching source=${source}:`, err.message);
        return res.status(500).json({ error: 'Failed to fetch data: ' + err.message });
    }
};
