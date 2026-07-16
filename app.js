(function () {
    'use strict';

    // ========== CONFIG ==========
    // NOTE: assumes both "all seller VIP" and "all seller Thường" tabs share the
    // same raw-order schema as the "DATA RAW" tab in the Backlog Firstmile sheet:
    // OrderCode, CurrentStatus, Clientcontactname, Category, LoadDate, Aging,
    // PickWH, FromRegionShortName, FromProvince, FromDistrict, FirstFailPickNote,
    // LastFailPickNote, clientid.
    // Adjust COLUMN_MAP below if the real header names differ.
    const COLUMN_MAP = {
        seller: 'Clientcontactname',
        pickWH: 'PickWH',
        region: 'FromRegionShortName',
        province: 'FromProvince',
        aging: 'Aging',
    };

    const DATA_SOURCES = {
        vip: '/api/data?source=vip',
        thuong: '/api/data?source=thuong',
    };

    // ========== STATE ==========
    let vipRows = [];
    let thuongRows = [];
    let vipTree = null;
    let thuongTree = null;
    const unknownAgingValues = new Set();

    // ========== HELPERS ==========
    function normalizeAging(raw) {
        const s = (raw == null ? '' : String(raw)).trim();
        if (!s) return null;
        if (s.includes('<=1') || s === '1' || s === '<1' || s === '0') return 1;
        if (s.includes('>=3') || s.includes('>3') || s.toLowerCase().includes('3+')) return 3;
        if (s === '2' || s.includes('=2')) return 2;
        const m = s.match(/(\d+)/);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n <= 1) return 1;
            if (n === 2) return 2;
            if (n >= 3) return 3;
        }
        unknownAgingValues.add(s);
        return null;
    }

    function formatNumber(n) {
        return new Intl.NumberFormat('vi-VN').format(n || 0);
    }

    function makeNode(name) {
        return { name, total: 0, a1: 0, a2: 0, a3: 0, children: new Map() };
    }

    function addToNode(node, agingBucket) {
        node.total += 1;
        if (agingBucket === 1) node.a1 += 1;
        else if (agingBucket === 2) node.a2 += 1;
        else if (agingBucket === 3) node.a3 += 1;
    }

    // Builds an n-level tree from flat rows. keyFns: array of (row => levelName)
    function buildTree(rows, keyFns) {
        const root = makeNode('root');
        rows.forEach(row => {
            const bucket = normalizeAging(row[COLUMN_MAP.aging]);
            let node = root;
            addToNode(node, bucket);
            for (const keyFn of keyFns) {
                const key = (keyFn(row) || '(Không xác định)').trim() || '(Không xác định)';
                if (!node.children.has(key)) node.children.set(key, makeNode(key));
                node = node.children.get(key);
                addToNode(node, bucket);
            }
        });
        return root;
    }

    function sortedChildren(node) {
        return Array.from(node.children.values()).sort((a, b) => b.total - a.total);
    }

    // Filters a tree by substring match on name at any level; keeps ancestors
    // of matches and whole subtrees under a matching ancestor.
    function filterTree(node, query) {
        if (!query) return node;
        const q = query.toLowerCase();
        if (node.name.toLowerCase().includes(q)) return node;
        const kept = makeNode(node.name);
        kept.total = node.total; kept.a1 = node.a1; kept.a2 = node.a2; kept.a3 = node.a3;
        let anyMatch = false;
        for (const child of node.children.values()) {
            const filteredChild = filterTree(child, query);
            if (filteredChild) {
                kept.children.set(child.name, filteredChild);
                anyMatch = true;
            }
        }
        return anyMatch ? kept : null;
    }

    // ========== RENDERING ==========
    function renderTree(tbody, root, prefix, autoExpand) {
        tbody.innerHTML = '';
        const frag = document.createDocumentFragment();

        function renderLevel(node, level, idPath, parentId) {
            sortedChildren(node).forEach(child => {
                const id = idPath + '::' + child.name;
                const isLeaf = child.children.size === 0;
                const tr = document.createElement('tr');
                tr.className = 'drill-row level-' + level + (isLeaf ? ' leaf' : '') + (parentId ? '' : '');
                tr.dataset.id = id;
                if (parentId) tr.dataset.parent = parentId;
                if (!parentId || autoExpand) {
                    // top-level rows always visible; nested rows hidden until expanded
                } else {
                    tr.classList.add('child-hidden');
                }
                if (parentId) tr.classList.add('child-hidden');

                const a3Class = child.a3 > 0 ? ' class="aging3-badge"' : '';
                const a2Class = child.a2 > 0 ? ' class="aging2-badge"' : '';

                tr.innerHTML =
                    '<td class="col-name"><span class="drill-toggle">▶</span><span>' + escapeHTML(child.name) + '</span></td>' +
                    '<td>' + formatNumber(child.total) + '</td>' +
                    '<td>' + formatNumber(child.a1) + '</td>' +
                    '<td' + a2Class + '>' + formatNumber(child.a2) + '</td>' +
                    '<td' + a3Class + '>' + formatNumber(child.a3) + '</td>';

                frag.appendChild(tr);
                if (child.children.size > 0) {
                    renderLevel(child, level + 1, id, id);
                }
            });
        }

        renderLevel(root, 0, prefix, null);
        tbody.appendChild(frag);
    }

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function attachDrillHandlers(tbody) {
        tbody.addEventListener('click', (e) => {
            const row = e.target.closest('.drill-row');
            if (!row || row.classList.contains('leaf')) return;
            const id = row.dataset.id;
            const expanding = !row.classList.contains('expanded');
            row.classList.toggle('expanded', expanding);

            const directChildren = tbody.querySelectorAll('[data-parent="' + cssEscape(id) + '"]');
            directChildren.forEach(child => {
                child.classList.toggle('child-hidden', !expanding);
                if (!expanding) {
                    // collapse further descendants too
                    child.classList.remove('expanded');
                    const grandChildren = tbody.querySelectorAll('[data-parent="' + cssEscape(child.dataset.id) + '"]');
                    grandChildren.forEach(gc => gc.classList.add('child-hidden'));
                }
            });
        });
    }

    function cssEscape(s) {
        return s.replace(/(["\\])/g, '\\$1');
    }

    // ========== SUMMARY / KPI ==========
    function updateKPIs() {
        const vipTotal = vipTree ? vipTree.total : 0;
        const thuongTotal = thuongTree ? thuongTree.total : 0;
        const aging3Total = (vipTree ? vipTree.a3 : 0) + (thuongTree ? thuongTree.a3 : 0);

        document.getElementById('kpi-total').textContent = formatNumber(vipTotal + thuongTotal);
        document.getElementById('kpi-vip-total').textContent = formatNumber(vipTotal);
        document.getElementById('kpi-thuong-total').textContent = formatNumber(thuongTotal);
        document.getElementById('kpi-aging3-total').textContent = formatNumber(aging3Total);
    }

    // ========== DATA LOADING ==========
    function fetchCsv(url) {
        return fetch(url, { cache: 'no-store' }).then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
            return res.text();
        }).then(text => new Promise((resolve, reject) => {
            Papa.parse(text, {
                header: true,
                skipEmptyLines: true,
                complete: (result) => resolve(result.data),
                error: reject,
            });
        }));
    }

    function setStatus(msg) {
        const el = document.getElementById('loading-status');
        if (el) el.textContent = msg;
    }

    async function loadAll() {
        document.getElementById('loading-overlay').classList.remove('hidden');
        try {
            setStatus('Đang tải danh sách Seller VIP...');
            vipRows = await fetchCsv(DATA_SOURCES.vip);

            setStatus('Đang tải danh sách Seller Thường...');
            thuongRows = await fetchCsv(DATA_SOURCES.thuong);

            setStatus('Đang tổng hợp dữ liệu...');
            unknownAgingValues.clear();
            vipTree = buildTree(vipRows, [
                r => r[COLUMN_MAP.seller],
                r => r[COLUMN_MAP.pickWH],
            ]);
            thuongTree = buildTree(thuongRows, [
                r => r[COLUMN_MAP.region],
                r => r[COLUMN_MAP.province],
                r => r[COLUMN_MAP.pickWH],
            ]);

            renderTree(document.getElementById('vip-tbody'), vipTree, 'vip');
            renderTree(document.getElementById('thuong-tbody'), thuongTree, 'thuong');
            updateKPIs();

            document.getElementById('last-updated').textContent = new Date().toLocaleString('vi-VN');

            if (unknownAgingValues.size > 0) {
                console.warn('Giá trị Aging chưa nhận diện được (không tính vào 3 cột aging, vẫn tính vào total):', Array.from(unknownAgingValues));
            }
        } catch (err) {
            console.error('Load failed:', err);
            setStatus('Lỗi tải dữ liệu: ' + err.message);
            alert('Không tải được dữ liệu: ' + err.message);
        } finally {
            document.getElementById('loading-overlay').classList.add('hidden');
        }
    }

    function setupSearch(inputId, tbody, getTree, prefix) {
        const input = document.getElementById(inputId);
        input.addEventListener('input', () => {
            const q = input.value.trim();
            const tree = getTree();
            if (!tree) return;
            const filtered = q ? (filterTree(tree, q) || makeNode('root')) : tree;
            renderTree(tbody, filtered, prefix, !!q);
        });
    }

    // ========== INIT ==========
    function init() {
        attachDrillHandlers(document.getElementById('vip-tbody'));
        attachDrillHandlers(document.getElementById('thuong-tbody'));
        setupSearch('vip-search', document.getElementById('vip-tbody'), () => vipTree, 'vip');
        setupSearch('thuong-search', document.getElementById('thuong-tbody'), () => thuongTree, 'thuong');

        document.getElementById('refresh-btn').addEventListener('click', () => {
            document.getElementById('refresh-btn').classList.add('loading');
            loadAll().finally(() => document.getElementById('refresh-btn').classList.remove('loading'));
        });

        loadAll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
