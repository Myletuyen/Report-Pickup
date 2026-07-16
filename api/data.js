const { fetchPublicCsv } = require('./_lib/sheetsClient');

const SPREADSHEET_ID = process.env.PICKUP_SPREADSHEET_ID || '14h6x-yB0uScxO8DDTliF6B79Xxt-gSXg1Kk3BXrfIWI';

const SHEETS = {
    vip: process.env.PICKUP_SHEET_VIP || 'all seller VIP',
    thuong: process.env.PICKUP_SHEET_THUONG || 'all seller Thường',
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
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return res.status(200).send(csvText);
    } catch (err) {
        console.error(`Error fetching source=${source}:`, err.message);
        return res.status(500).json({ error: 'Failed to fetch data: ' + err.message });
    }
};
