(function () {
    'use strict';

    // Aggregation (seller/team, region/province/office + aging buckets) now
    // happens server-side in api/data.js — the browser only ever receives the
    // small summarized trees, not the raw (six-figure-row) backlog CSV. One
    // fetch returns all three trees plus the status/attempts breakdowns.
    const DATA_URL = '/api/data';

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

    function renderSinglePercent(elId, count, total) {
        const el = document.getElementById(elId);
        if (!el || !total) { if (el) el.innerHTML = ''; return; }
        const pct = Math.round((count / total) * 100);
        el.innerHTML = '<span class="bd-item">' + pct + '% of total backlog</span>';
    }

    function renderAttemptsBreakdown(elId, attemptCounts, total) {
        const el = document.getElementById(elId);
        if (!el) return;
        if (!attemptCounts || !total) { el.innerHTML = 'Không có dữ liệu cột số lần lấy'; return; }
        const pct = n => Math.round(((attemptCounts[n] || 0) / total) * 100);
        el.innerHTML =
            '<span class="bd-item bd-a1">0 lần: <b>' + formatNumber(attemptCounts['0'] || 0) + '</b> (' + pct('0') + '%)</span>' +
            '<span class="bd-item">1 lần: <b>' + formatNumber(attemptCounts['1'] || 0) + '</b> (' + pct('1') + '%)</span>' +
            '<span class="bd-item bd-a2">2 lần: <b>' + formatNumber(attemptCounts['2'] || 0) + '</b> (' + pct('2') + '%)</span>' +
            '<span class="bd-item bd-a3">≥3 lần: <b>' + formatNumber(attemptCounts['>=3'] || 0) + '</b> (' + pct('>=3') + '%)</span>';
    }

    function updateStatusAndAttempts(statusCounts, attemptCounts, total) {
        const readyCount = (statusCounts && statusCounts['ready_to_pick']) || 0;
        const pickingCount = (statusCounts && statusCounts['picking']) || 0;

        document.getElementById('kpi-status-ready').textContent = formatNumber(readyCount);
        document.getElementById('kpi-status-picking').textContent = formatNumber(pickingCount);
        renderSinglePercent('kpi-status-ready-breakdown', readyCount, total);
        renderSinglePercent('kpi-status-picking-breakdown', pickingCount, total);
        renderAttemptsBreakdown('kpi-attempts-breakdown', attemptCounts, total);
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
            setStatus('Đang tải dữ liệu backlog...');
            const result = await fetchTree(DATA_URL);
            vipTree = result.vipTree;
            thuongTree = result.thuongTree;
            regionTree = result.regionTree;
            updateStatusAndAttempts(result.statusCounts, result.attemptCounts, result.rowCount);
            const warningEl = document.getElementById('data-warning');
            if (result.unknownAgingValues && result.unknownAgingValues.length) {
                console.warn('Giá trị Aging chưa nhận diện được (vẫn tính vào total, không tính vào aging buckets):', result.unknownAgingValues);
                warningEl.innerHTML = '⚠️ Có <b>' + result.unknownAgingValues.length + '</b> giá trị cột Aging không nhận diện được (vẫn tính vào Total nhưng không vào ≤1/2/≥3 ngày): ' +
                    result.unknownAgingValues.map(v => '<b>"' + escapeHTML(v) + '"</b>').join(', ');
                warningEl.style.display = 'block';
            } else if (warningEl) {
                warningEl.style.display = 'none';
            }

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

    // ========== GOOGLE SIGN-IN (redirect flow — no popup/FedCM, works even with
    // third-party cookies blocked or ad/privacy extensions installed) ==========
    const GOOGLE_CLIENT_ID = '646710154972-b7b4iq81ej76i86cm2mgs4fnnquhrc0a.apps.googleusercontent.com';
    const REDIRECT_URI = window.location.origin + window.location.pathname;

    function decodeJwtResponse(token) {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c =>
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join(''));
        return JSON.parse(jsonPayload);
    }

    function startGoogleLogin() {
        const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: 'id_token',
            scope: 'openid email profile',
            nonce: nonce,
            prompt: 'select_account',
        });
        window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
    }

    function showLoginError(msg) {
        const errorEl = document.getElementById('login-error');
        if (errorEl) errorEl.innerHTML = msg;
    }

    function showDashboard() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-dashboard').style.display = 'block';
        document.getElementById('loading-overlay').classList.remove('hidden');
        init();
    }

    // Returns true only when login succeeded and the dashboard (with its own
    // loading spinner) was shown — so the caller knows not to hide that
    // spinner right back out from under loadAll().
    function handleAuthRedirect() {
        if (!window.location.hash) return false;
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const idToken = hashParams.get('id_token');
        const error = hashParams.get('error');
        if (!idToken && !error) return false;

        // Clean the token/error out of the URL so refresh/back doesn't resubmit it.
        history.replaceState(null, '', window.location.pathname + window.location.search);

        if (error) {
            showLoginError('Đăng nhập thất bại: ' + escapeHTML(error));
            return false;
        }

        const payload = decodeJwtResponse(idToken);
        const email = payload.email;
        if (email && email.endsWith('@ghn.vn')) {
            showDashboard();
            return true;
        }
        showLoginError('Lỗi: Email <strong>' + escapeHTML(email || '') + '</strong> không được phép truy cập.<br>Vui lòng sử dụng tài khoản @ghn.vn!');
        return false;
    }

    function initLogin() {
        const btn = document.getElementById('google-login-btn');
        if (btn) btn.addEventListener('click', startGoogleLogin);
        const loggedIn = handleAuthRedirect();
        if (!loggedIn) {
            document.getElementById('loading-overlay').classList.add('hidden');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLogin);
    } else {
        initLogin();
    }
})();
