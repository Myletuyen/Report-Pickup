// Aggregates raw backlog rows into a seller/region drill-down tree, server-side,
// so the browser only ever receives a small summarized JSON payload instead of
// the full (six-figure-row) raw CSV.
function normalizeAging(raw) {
    const s = (raw == null ? '' : String(raw)).trim();
    if (!s) return { bucket: null };
    if (s.includes('<=1') || s === '1' || s === '<1' || s === '0') return { bucket: 1 };
    if (s.includes('>=3') || s.includes('>3') || s.toLowerCase().includes('3+')) return { bucket: 3 };
    if (s === '2' || s.includes('=2')) return { bucket: 2 };
    const m = s.match(/(\d+)/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n <= 1) return { bucket: 1 };
        if (n === 2) return { bucket: 2 };
        if (n >= 3) return { bucket: 3 };
    }
    return { bucket: null, unknown: s };
}

function makeNode(name) {
    return { name, total: 0, a1: 0, a2: 0, a3: 0, children: new Map() };
}

function addToNode(node, bucket) {
    node.total += 1;
    if (bucket === 1) node.a1 += 1;
    else if (bucket === 2) node.a2 += 1;
    else if (bucket === 3) node.a3 += 1;
}

function serialize(node) {
    const children = Array.from(node.children.values())
        .sort((a, b) => b.total - a.total)
        .map(serialize);
    return { name: node.name, total: node.total, a1: node.a1, a2: node.a2, a3: node.a3, children };
}

// rows: array of row objects (from a CSV header-parse). keyFns: array of
// (row => levelName) functions, one per tree level (e.g. [seller, pickWH]).
function buildTree(rows, keyFns, agingField) {
    const root = makeNode('root');
    const unknownAgingValues = new Set();

    rows.forEach(row => {
        const { bucket, unknown } = normalizeAging(row[agingField]);
        if (unknown) unknownAgingValues.add(unknown);
        let node = root;
        addToNode(node, bucket);
        for (const keyFn of keyFns) {
            const raw = keyFn(row);
            const key = (raw || '').toString().trim() || '(Không xác định)';
            if (!node.children.has(key)) node.children.set(key, makeNode(key));
            node = node.children.get(key);
            addToNode(node, bucket);
        }
    });

    return { tree: serialize(root), unknownAgingValues: Array.from(unknownAgingValues) };
}

module.exports = { buildTree };
