(function () {
    'use strict';

    // Aggregation (seller/team, region/province/office + aging buckets) now
    // happens server-side in api/data.js — the browser only ever receives the
    // small summarized tree, not the raw (six-figure-row) backlog CSV.
    const DATA_SOURCES = {
        vip: '/api/data?source=vip',
        thuong: '/api/data?source=thuong',
        region: '/api/data?source=region',
    };

    // ========== STATE ==========
    let vipTree = null;
    let thuongTree = null;
    let regionTree = null;

    // ========== HELPERS ==========
    function formatNumber(n) {
        return new Intl.NumberFormat('vi-VN').format(n || 0);
    }

    function emptyNode() {
        return { name: 'root', total: 0, a1: 0, a2: 0, a3: 0, children: [] };
    }

    // Filters a tree by substring match on name at any level; keeps ancestors
    // of matches and whole subtrees under a matching ancestor.
    function filterTree(node, query) {
        if (!query) return node;
        const q = query.toLowerCase();
        if (node.name.toLowerCase().includes(q)) return node;
        const keptChildren = [];
        for (const child of node.children) {
            const filteredChild = filterTree(child, query);
            if (filteredChild) keptChildren.push(filteredChild);
        }
        if (keptChildren.length === 0) return null;
        return { name: node.name, total: node.total, a1: node.a1, a2: node.a2, a3: node.a3, children: keptChildren };
    }

    // ========== RENDERING ==========
    function renderTree(tbody, root, prefix, autoExpand) {
        tbody.innerHTML = '';
        const frag = document.createDocumentFragment();

        function renderLevel(node, level, idPath, parentId) {
            node.children.forEach(child => {
                const id = idPath + '::' + child.name;
                const isLeaf = child.children.length === 0;
                const tr = document.createElement('tr');
                tr.className = 'drill-row level-' + level + (isLeaf ? ' leaf' : '');
                tr.dataset.id = id;
                if (parentId) {
                    tr.dataset.parent = parentId;
                    tr.classList.add('child-hidden');
                }
                if (parentId && autoExpand) tr.classList.remove('child-hidden');

                tr.innerHTML =
                    '<td class="col-name"><span class="drill-toggle">▶</span><span>' + escapeHTML(child.name) + '</span></td>' +
                    '<td>' + formatNumber(child.total) + '</td>' +
                    '<td class="aging1-badge">' + formatNumber(child.a1) + '</td>' +
                    '<td class="aging2-badge">' + formatNumber(child.a2) + '</td>' +
                    '<td class="aging3-badge">' + formatNumber(child.a3) + '</td>';

                frag.appendChild(tr);
                if (child.children.length > 0) {
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
    function renderBreakdown(elId, a1, a2, a3, total) {
        const el = document.getElementById(elId);
        if (!el) return;
        if (!total) { el.innerHTML = ''; return; }
        const pct = n => Math.round((n / total) * 100);
        el.innerHTML =
            '<span class="bd-item bd-a1">≤1d: <b>' + formatNumber(a1) + '</b> (' + pct(a1) + '%)</span>' +
            '<span class="bd-item bd-a2">2d: <b>' + formatNumber(a2) + '</b> (' + pct(a2) + '%)</span>' +
            '<span class="bd-item bd-a3">≥3d: <b>' + formatNumber(a3) + '</b> (' + pct(a3) + '%)</span>';
    }

    function updateKPIs() {
        const vip = vipTree || { total: 0, a1: 0, a2: 0, a3: 0 };
        const thuong = thuongTree || { total: 0, a1: 0, a2: 0, a3: 0 };
        const total = vip.total + thuong.total;
        const a1 = vip.a1 + thuong.a1;
        const a2 = vip.a2 + thuong.a2;
        const a3 = vip.a3 + thuong.a3;

        document.getElementById('kpi-total').textContent = formatNumber(total);
        document.getElementById('kpi-vip-total').textContent = formatNumber(vip.total);
        document.getElementById('kpi-thuong-total').textContent = formatNumber(thuong.total);
        document.getElementById('kpi-aging3-total').textContent = formatNumber(a3);

        renderBreakdown('kpi-total-breakdown', a1, a2, a3, total);
        renderBreakdown('kpi-vip-breakdown', vip.a1, vip.a2, vip.a3, vip.total);
        renderBreakdown('kpi-thuong-breakdown', thuong.a1, thuong.a2, thuong.a3, thuong.total);
    }

    // ========== DATA LOADING ==========
    function fetchTree(url) {
        return fetch(url, { cache: 'no-store' }).then(res => {
            if (!res.ok) return res.json().catch(() => null).then(body => {
                throw new Error((body && body.error) || ('HTTP ' + res.status + ' for ' + url));
            });
            return res.json();
        });
    }

    function setStatus(msg) {
        const el = document.getElementById('loading-status');
        if (el) el.textContent = msg;
    }

    async function loadAll() {
        document.getElementById('loading-overlay').classList.remove('hidden');
        try {
            setStatus('Đang tải danh sách Seller VIP...');
            const vipResult = await fetchTree(DATA_SOURCES.vip);
            vipTree = vipResult.tree;
            if (vipResult.unknownAgingValues && vipResult.unknownAgingValues.length) {
                console.warn('VIP: giá trị Aging chưa nhận diện được (vẫn tính vào total):', vipResult.unknownAgingValues);
            }

            setStatus('Đang tải danh sách Seller Thường...');
            const thuongResult = await fetchTree(DATA_SOURCES.thuong);
            thuongTree = thuongResult.tree;
            if (thuongResult.unknownAgingValues && thuongResult.unknownAgingValues.length) {
                console.warn('Thường: giá trị Aging chưa nhận diện được (vẫn tính vào total):', thuongResult.unknownAgingValues);
            }

            setStatus('Đang tổng hợp theo Vùng...');
            const regionResult = await fetchTree(DATA_SOURCES.region);
            regionTree = regionResult.tree;

            renderTree(document.getElementById('vip-tbody'), vipTree, 'vip');
            renderTree(document.getElementById('thuong-tbody'), thuongTree, 'thuong');
            renderTree(document.getElementById('region-tbody'), regionTree, 'region');
            updateKPIs();

            document.getElementById('last-updated').textContent = new Date().toLocaleString('vi-VN');
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
            const filtered = q ? (filterTree(tree, q) || emptyNode()) : tree;
            renderTree(tbody, filtered, prefix, !!q);
        });
    }

    function setupTabs() {
        const group = document.getElementById('seller-tab-group');
        if (!group) return;
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('.tab-btn');
            if (!btn) return;
            group.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
            const activeTab = btn.dataset.tab;
            document.querySelectorAll('.tab-panel').forEach(panel => {
                panel.style.display = panel.dataset.panel === activeTab ? '' : 'none';
            });
        });
    }

    // ========== INIT ==========
    function init() {
        attachDrillHandlers(document.getElementById('vip-tbody'));
        attachDrillHandlers(document.getElementById('thuong-tbody'));
        attachDrillHandlers(document.getElementById('region-tbody'));
        setupSearch('vip-search', document.getElementById('vip-tbody'), () => vipTree, 'vip');
        setupSearch('thuong-search', document.getElementById('thuong-tbody'), () => thuongTree, 'thuong');
        setupSearch('region-search', document.getElementById('region-tbody'), () => regionTree, 'region');
        setupTabs();

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
