/* ══════════════ R.E.N.A. — Shared State ══════════════ */
(function () {
    'use strict';

    // ── API base URL (same origin) ──────────────────────────────
    window.API_BASE = '';

    // ── Current user / permissions ──────────────────────────────
    window.RENA_ME = { username: '', display_name: '', role: 'user', pages: ['dashboard'], can_lynx: false };

    window.renaHasPage = function (page) {
        const me = window.RENA_ME;
        if (me.role === 'owner' || me.role === 'mod') return true;
        return Array.isArray(me.pages) && me.pages.includes(page);
    };

    window.renaApplyPermissions = function () {
        const me = window.RENA_ME;
        // Lite mode for regular users: hide everything in sidebar except Vehicle Match
        if (me.role !== 'owner' && me.role !== 'mod') {
            document.body.classList.add('lite-mode');
        } else {
            document.body.classList.remove('lite-mode');
        }
        // Nav links — hide pages not allowed
        document.querySelectorAll('.nav-link[data-page]').forEach(function (link) {
            const page = link.dataset.page;
            if (!window.renaHasPage(page)) {
                link.style.display = 'none';
            } else {
                link.style.display = '';
            }
        });
        // Demo-only buttons/sections
        if (!me.can_lynx) {
            document.querySelectorAll('[data-lynx-only]').forEach(function (el) {
                el.style.display = 'none';
            });
        } else {
            document.querySelectorAll('[data-lynx-only]').forEach(function (el) {
                el.style.display = '';
            });
        }
        // Owner-only elements
        document.querySelectorAll('[data-owner-only]').forEach(function (el) {
            el.style.display = me.role === 'owner' ? '' : 'none';
        });
        // Sidebar name/role text is handled by _nafFetchUserProfile() in data.js (JAP directory).
        // We only apply a subtle colour hint to sidebarUserRole to indicate RENA role.
        const roleEl = document.getElementById('sidebarUserRole');
        if (roleEl) {
            roleEl.classList.remove('text-gray-400', 'text-yellow-500', 'text-green-500');
            roleEl.classList.add(
                me.role === 'owner' ? 'text-yellow-500' :
                me.role === 'mod'   ? 'text-green-500'  : 'text-gray-400'
            );
        }
        document.dispatchEvent(new CustomEvent('rena:permissions'));
    };

    async function _loadMe() {
        try {
            const r = await fetch(window.API_BASE + '/api/me');
            if (r.ok) {
                window.RENA_ME = await r.json();
                window.renaApplyPermissions();
                // If current page isn't allowed, navigate to the first allowed one
                if (typeof window.renaNavigateTo === 'function') {
                    const me = window.RENA_ME;
                    if (me.role !== 'owner' && me.role !== 'mod') {
                        const target = (Array.isArray(me.pages) && me.pages[0]) || 'match-vehicle';
                        window.renaNavigateTo(target);
                    }
                }
            }
        } catch (e) { /* silent — app still works */ }
    }
    _loadMe();

    // ── APP STATE ───────────────────────────────────────────────
    window.NAF = {
        rawData     : [],
        filtered    : [],
        sortCol     : 'subStatus',
        sortDir     : 'asc',
        pollTimer   : null,
        capturedAt  : '',
        POLL_INTERVAL: 60_000,
        initialized : false,
        page        : 0,
        PAGE_SIZE   : 50
    };
    Object.defineProperty(window, 'NAF_PAGE', { get: () => window.NAF.page });

    // ── STATION CONFIG (loaded from server) ─────────────────────
    window.NAF_STATION_CFG = { stations: {}, zones: {}, hiddenTypes: [], classicStatusMap: {} };
    window._nafStationCfgLoaded = false;

})();
