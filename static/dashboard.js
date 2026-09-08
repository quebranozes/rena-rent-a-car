/* ══════════════ Rena Dashboard JS ══════════════ */
(function () {
    'use strict';

    /* ── Global ESC to close any open modal ──
       Modals across the app use the pattern: <div class="fixed inset-0 z-50 hidden">
       Pressing ESC hides the topmost open modal (last in DOM order). */
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' && e.key !== 'Esc') return;
        // Find all open modals (fixed inset-0 z-50, not hidden)
        const openModals = Array.from(document.querySelectorAll('div.fixed.inset-0.z-50'))
            .filter(function (el) { return !el.classList.contains('hidden'); });
        if (!openModals.length) return;
        // Close the topmost (last in DOM)
        const top = openModals[openModals.length - 1];
        top.classList.add('hidden');
        e.preventDefault();
        e.stopPropagation();
    });

    /* ── Sidebar Toggle (mobile) ── */
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebarToggle = document.getElementById('sidebarToggle');
    function syncSidebarAccess() {
        const closed = window.innerWidth < 768 && sidebar.classList.contains('sidebar-closed');
        sidebar.inert = closed;
        if (closed) sidebar.setAttribute('aria-hidden', 'true');
        else sidebar.removeAttribute('aria-hidden');
        if (window.innerWidth >= 768) sidebarOverlay.classList.add('hidden');
    }

    window.toggleSidebar = function () {
        sidebar.classList.toggle('sidebar-closed');
        const open = !sidebar.classList.contains('sidebar-closed');
        syncSidebarAccess();
        sidebarOverlay.classList.toggle('hidden', !open);
        sidebarToggle.setAttribute('aria-expanded', String(open));
        sidebarToggle.setAttribute('aria-label', open ? "Close menu" : "Open menu");
        if (open) {
            const first = sidebar.querySelector('.nav-link.active') || sidebar.querySelector('.nav-link');
            if (first) first.focus();
        } else sidebarToggle.focus();
    };

    sidebarToggle.addEventListener('click', toggleSidebar);
    window.addEventListener('resize', syncSidebarAccess);
    syncSidebarAccess();
    document.addEventListener('keydown', function (e) {
        if (window.innerWidth >= 768 || sidebar.classList.contains('sidebar-closed')) return;
        if (e.key === 'Escape') {
            window.toggleSidebar();
            e.preventDefault();
        } else if (e.key === 'Tab') {
            const items = Array.from(sidebar.querySelectorAll('a,button,input')).filter(el => el.getClientRects().length);
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
            else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
        }
    });

    /* ── Sidebar Mini (collapsible icon rail, desktop) ── */
    (function () {
        const mainWrapper = document.getElementById('mainWrapper');
        const MINI_KEY = 'rena_sb_mini';

        // Wrap all nav-link text nodes in sb-txt spans so CSS can hide them
        document.querySelectorAll('.nav-link').forEach(function (el) {
            Array.from(el.childNodes).forEach(function (node) {
                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                    var span = document.createElement('span');
                    span.className = 'sb-txt';
                    span.textContent = node.textContent;
                    el.replaceChild(span, node);
                }
            });
        });
        // Wrap group toggle label text + mark chevron as sb-txt
        document.querySelectorAll('.nav-group-toggle').forEach(function (btn) {
            btn.querySelectorAll('.flex.items-center.gap-2').forEach(function (wrap) {
                Array.from(wrap.childNodes).forEach(function (node) {
                    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                        var span = document.createElement('span');
                        span.className = 'sb-txt';
                        span.textContent = node.textContent;
                        wrap.replaceChild(span, node);
                    }
                });
            });
            var chevron = btn.querySelector('i.fa-chevron-down');
            if (chevron) chevron.classList.add('sb-txt');
        });

        function setMini(mini) {
            sidebar.classList.toggle('sb-mini', mini);
            if (mainWrapper) mainWrapper.classList.toggle('sb-mini-main', mini);
            var toggle = document.getElementById('sbLogoBtn');
            if (toggle) {
                toggle.setAttribute('aria-expanded', String(!mini));
                toggle.setAttribute('aria-label', mini ? "Expand menu" : "Collapse menu");
                toggle.title = mini ? "Expand menu" : "Collapse menu";
            }
        }

        // Show page names on a first visit; retain the user's compact preference.
        var stored = null;
        try { stored = localStorage.getItem(MINI_KEY); } catch (_) {}
        setMini(stored === '1');

        // Hover: temporarily expand
        sidebar.addEventListener('mouseenter', function () {
            if (sidebar.classList.contains('sb-mini')) sidebar.classList.add('sb-hover');
        });
        sidebar.addEventListener('mouseleave', function () {
            if (!sidebar.contains(document.activeElement)) sidebar.classList.remove('sb-hover');
        });
        sidebar.addEventListener('focusin', function () {
            if (sidebar.classList.contains('sb-mini')) sidebar.classList.add('sb-hover');
        });
        sidebar.addEventListener('focusout', function (e) {
            if (!sidebar.contains(e.relatedTarget)) sidebar.classList.remove('sb-hover');
        });

        // Click RENA logo: toggle pin (always open) / mini
        var logoBtn = document.getElementById('sbLogoBtn');
        if (logoBtn) {
            logoBtn.addEventListener('click', function (e) {
                e.preventDefault();
                if (window.innerWidth < 768) { window.toggleSidebar(); return; }
                var isMini = sidebar.classList.contains('sb-mini');
                if (isMini) {
                    setMini(false);
                    try { localStorage.setItem(MINI_KEY, '0'); } catch (_) {}
                    sidebar.classList.remove('sb-hover');
                } else {
                    setMini(true);
                    try { localStorage.setItem(MINI_KEY, '1'); } catch (_) {}
                }
            });
        }
    })();

    /* ── Page Navigation ── */
    const navLinks = document.querySelectorAll('.nav-link');
    const pages = {
        dashboard: document.getElementById('pageDashboard'),
        fleet: document.getElementById('pageFleet'),
        analytics: document.getElementById('pageAnalytics'),
        reservations: document.getElementById('pageReservations'),
        'ow-foreign': document.getElementById('pageOWForeign'),
        duplicados: document.getElementById('pageDuplicados'),
        planning: document.getElementById('pagePlanning'),
        'island-blocking': document.getElementById('pageIslandBlocking'),
        'capacity-control': document.getElementById('pageCapacityControl'),
        rotation: document.getElementById('pageRotation'),
        'match-vehicle': document.getElementById('pageMatchVehicle'),
        settings: document.getElementById('pageSettings'),
    };
    const tabBar = document.getElementById('tabBar');
    const tabBarInner = document.getElementById('tabBarInner');

    // ── Tab state ──
    var openTabs = [];   // ordered list of page keys
    var activeTab = '';

    function _tabLabel(page) {
        return (pageLabels[page] || page).replace('../', '');
    }

    function _renderTabs() {
        if (!tabBarInner) return;
        if (openTabs.length === 0) {
            tabBar.classList.add('hidden');
            tabBarInner.innerHTML = '';
            return;
        }
        tabBar.classList.remove('hidden');
        tabBarInner.innerHTML = openTabs.map(function (p) {
            var isActive = p === activeTab;
            var label = _tabLabel(p);
            return '<div class="ui-tab' + (isActive ? ' is-active' : '') + '">'
                + '<button type="button" data-tab="' + p + '" aria-current="' + (isActive ? 'page' : 'false') + '" onclick="window._tabClick(\'' + p + '\')">' + label + '</button>'
                + "<button type=\"button\" class=\"ui-tab-close\" aria-label=\"Close " + label + "\" title=\"Close " + label + '" onclick="window._tabClose(\'' + p + '\')">'
                + '<svg class="ui-icon" aria-hidden="true"><use href="/shared/icons.svg#close"></use></svg></button></div>';
        }).join('');
    }

    window._tabClick = function (page) {
        navigateTo(page, true);
    };

    window._tabClose = function (page) {
        var idx = openTabs.indexOf(page);
        if (idx === -1) return;
        openTabs.splice(idx, 1);
        if (activeTab === page) {
            // Switch to nearest remaining tab
            var next = openTabs[idx] || openTabs[idx - 1] || openTabs[0] || 'dashboard';
            navigateTo(next, true);
        }
        _renderTabs();
        const focusTarget = tabBarInner.querySelector('[data-tab="' + activeTab + '"]') || document.getElementById('appPageTitle');
        if (focusTarget) { focusTarget.setAttribute('tabindex', '0'); focusTarget.focus({preventScroll:true}); }
    };

    const pageLabels = {
        dashboard: "../Overview",
        fleet: "../Fleet",
        analytics: "../Analytics",
        reservations: "../Reservations",
        'ow-foreign': "../Foreign One-Way",
        duplicados: "../Duplicates",
        planning: "../Planning",
        'island-blocking': "../Island Transfers",
        'capacity-control': "../Capacity & Slots",
        rotation: '../Fleet Rotation',
        'match-vehicle': '../Vehicle Match',
        settings: "../Settings",
    };
    const descriptions = {
        dashboard: "Key operational indicators in one place.",
        fleet: "Vehicle availability, location and status.",
        analytics: "Fleet metrics and trends.",
        reservations: "Browse, filter and track reservations.",
        'ow-foreign': "Track foreign vehicles and international reservations.",
        duplicados: "Identify potential duplicate reservations and review their status.",
        planning: "Forecast fleet demand by station, vehicle group and period.",
        'island-blocking': "Find vehicles eligible for island transfers.",
        'capacity-control': "Occupancy and capacity by station and time slot.",
        rotation: "Organize transport loads and track fleet transfers.",
        'match-vehicle': "Find suitable reservations for each vehicle.",
        settings: "Stations, operating rules and access settings.",
    };

    function navigateTo(page, fromTab) {
        if (!Object.prototype.hasOwnProperty.call(pages, page)) page = 'dashboard';
        if (typeof window.renaHasPage === 'function' && !window.renaHasPage(page)) {
            page = Object.keys(pages).find(key => window.renaHasPage(key));
            if (!page) return;
        }
        // Add to tabs if not already open (skip dashboard which needs no tab)
        if (page && page !== 'dashboard') {
            if (openTabs.indexOf(page) === -1) {
                openTabs.push(page);
            }
            activeTab = page;
        } else {
            activeTab = '';
        }

        // Hide all pages
        Object.values(pages).forEach(function (el) { if (el) el.style.display = 'none'; });

        // Show requested page (or dashboard)
        var target = pages[page] || pages.dashboard;
        if (target) target.style.display = '';
        if (target) target.setAttribute('aria-labelledby', 'appPageTitle');
        document.getElementById('appPageTitle').textContent = _tabLabel(page);
        document.getElementById('appPageDescription').textContent = descriptions[page] || '';
        document.title = _tabLabel(page) + " · RENA | Renato Pinto";

        // Update nav active state
        navLinks.forEach(function (link) {
            var p = link.getAttribute('data-page');
            link.classList.toggle('active', p === page);
            if (p === page) link.setAttribute('aria-current','page');
            else link.removeAttribute('aria-current');
        });

        _renderTabs();
        document.dispatchEvent(new CustomEvent('rena:navigate', {detail:{page:page}}));

        // Render analytics charts when switching to analytics page
        if (page === 'analytics' && typeof window.nafRenderAnalytics === 'function') {
            window.nafRenderAnalytics();
        }

        // Render settings when switching to settings page
        if (page === 'settings' && typeof window.nafRenderSettings === 'function') {
            window.nafRenderSettings();
        }

        // Init reservations when switching to reservations page
        if (page === 'reservations' && typeof window.resInit === 'function') {
            window.resInit();
        }

        // Init OW Foreign when switching to ow-foreign page
        if (page === 'ow-foreign' && typeof window.owForeignInit === 'function') {
            window.owForeignInit();
        }

        // Init duplicados when switching to duplicados page
        if (page === 'duplicados' && typeof window.duplicadosInit === 'function') {
            window.duplicadosInit();
        }

        // Init planning when switching to planning page
        if (page === 'planning' && typeof window.planningInit === 'function') {
            window.planningInit();
        }

        // Init island blocking when switching to island-blocking page
        if (page === 'island-blocking' && typeof window.islandBlockingInit === 'function') {
            window.islandBlockingInit();
        }

        // Init capacity control when switching to capacity-control page
        if (page === 'capacity-control' && typeof window.capacityControlInit === 'function') {
            window.capacityControlInit();
        }

        // Init Fleet Rotation when switching to rotation page
        if (page === 'rotation' && typeof window.nafInitRotation === 'function') {
            window.nafInitRotation();
        }

        // Init Alocador de Viaturas
        if (page === 'match-vehicle' && typeof window.matchInit === 'function') {
            window.matchInit();
        }

        // Close sidebar on mobile after navigation
        if (window.innerWidth < 768) {
            sidebar.classList.add('sidebar-closed');
            sidebarOverlay.classList.add('hidden');
            sidebarToggle.setAttribute('aria-expanded', 'false');
            sidebarToggle.setAttribute('aria-label', "Open menu");
            syncSidebarAccess();
        }
    }

    navLinks.forEach(function (link) {
        link.title = link.textContent.trim();
        link.addEventListener('click', function (e) {
            e.preventDefault();
            var page = this.getAttribute('data-page');
            navigateTo(page);
        });
    });

    /* ── Sidebar Nav Groups (collapsible) ── */
    (function () {
        var STORAGE_KEY = 'renaNavGroups';
        var saved = {};
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) { saved = {}; }

        var toggles = document.querySelectorAll('.nav-group-toggle');
        toggles.forEach(function (btn) {
            var key = btn.getAttribute('data-group');
            var body = document.querySelector('[data-group-body="' + key + '"]');
            if (!body) return;

            // Navigation is discoverable on first visit; status details stay compact.
            var collapsed = saved[key] !== undefined ? saved[key] : key === 'res-stations';
            body.id = body.id || 'nav-group-' + key;
            btn.setAttribute('aria-controls', body.id);
            applyState(btn, body, collapsed, false);

            btn.addEventListener('click', function () {
                var isCollapsed = body.classList.contains('collapsed');
                applyState(btn, body, !isCollapsed, true);
                saved[key] = !isCollapsed;
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch (e) { }
            });
        });

        function applyState(btn, body, collapsed, animate) {
            btn.setAttribute('aria-expanded', String(!collapsed));
            if (collapsed) {
                body.classList.add('collapsed');
                btn.classList.add('collapsed');
                body.style.maxHeight = '0px';
            } else {
                body.classList.remove('collapsed');
                btn.classList.remove('collapsed');
                // expand to scrollHeight
                body.style.maxHeight = body.scrollHeight + 'px';
                if (animate) {
                    setTimeout(function () { body.style.maxHeight = 'none'; }, 260);
                } else {
                    body.style.maxHeight = 'none';
                }
            }
        }

        document.addEventListener('rena:navigate', function (e) {
            const link = document.querySelector('.nav-link[data-page="' + e.detail.page + '"]');
            const group = link && link.closest('[data-group-body]');
            if (!group) return;
            const button = document.querySelector('[data-group="' + group.dataset.groupBody + '"]');
            if (button) applyState(button, group, false, false);
        });

        // Auto-expand the group containing the active page on load
        var activeLink = document.querySelector('.nav-link.active, .nav-link.bg-primary-500\\/10');
        if (activeLink) {
            var parent = activeLink.closest('[data-group-body]');
            if (parent) {
                var key = parent.getAttribute('data-group-body');
                var btn = document.querySelector('.nav-group-toggle[data-group="' + key + '"]');
                if (btn) applyState(btn, parent, false, false);
            }
        }
    })();

    /* Search only the pages available to the current user. */
    (function () {
        const input = document.getElementById('navSearchInput');
        const empty = document.getElementById('navSearchEmpty');
        const aliases = {dashboard:'dashboard',fleet:'fleet',analytics:'analytics',planning:'planning',settings:'settings',rotation:'transferencias cargas','match-vehicle':"alocacao vehicles"};
        const normalise = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
        function filter() {
            const query = normalise(input.value);
            let matches = 0;
            navLinks.forEach(function (link) {
                const allowed = typeof window.renaHasPage !== 'function' || window.renaHasPage(link.dataset.page);
                const match = normalise(link.textContent + ' ' + (aliases[link.dataset.page] || '')).includes(query);
                link.classList.toggle('ui-nav-filtered', !!query && !match);
                if (allowed && match) matches++;
            });
            document.querySelectorAll('#mainNavigation [data-group-body]').forEach(function (group) {
                const button = document.querySelector('[data-group="' + group.dataset.groupBody + '"]');
                const visible = Array.from(group.querySelectorAll('.nav-link')).some(link =>
                    !link.classList.contains('ui-nav-filtered') && link.style.display !== 'none');
                group.classList.toggle('ui-group-filtered', !visible);
                group.classList.toggle('ui-search-open', !!query && visible);
                if (button) {
                    button.classList.toggle('ui-group-filtered', !visible);
                    button.setAttribute('aria-expanded', String(visible && (!!query || !group.classList.contains('collapsed'))));
                }
            });
            empty.hidden = !query || matches > 0;
        }
        input.addEventListener('input', filter);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { input.value = ''; filter(); }
            if (e.key === 'Enter') {
                const first = Array.from(navLinks).find(link => !link.classList.contains('ui-nav-filtered') && link.style.display !== 'none');
                if (first) { input.value = ''; filter(); first.click(); }
            }
        });
        document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                if (window.innerWidth < 768 && sidebar.classList.contains('sidebar-closed')) window.toggleSidebar();
                sidebar.classList.add('sb-hover');
                input.focus(); input.select();
            }
        });
        document.addEventListener('rena:permissions', filter);
        filter();
    })();

    (function () {
        const button = document.getElementById('themeToggle');
        function update() {
            const dark = document.documentElement.classList.contains('dark');
            const label = dark ? "Switch to light mode" : "Switch to dark mode";
            button.setAttribute('aria-label', label); button.title = label;
            button.querySelector('use').setAttribute('href', '/shared/icons.svg#' + (dark ? 'sun' : 'moon'));
            const map = document.getElementById('dashMapFrame');
            try { if (map && map.contentDocument) map.contentDocument.documentElement.classList.toggle('dark', dark); } catch (_) {}
        }
        button.addEventListener('click', function () {
            const dark = document.documentElement.classList.toggle('dark');
            try { localStorage.setItem('rena_theme', dark ? 'dark' : 'light'); } catch (_) {}
            update();
            if (pages.analytics.style.display !== 'none' && typeof window.nafRenderAnalytics === 'function') window.nafRenderAnalytics();
        });
        const map = document.getElementById('dashMapFrame');
        if (map) map.addEventListener('load', update);
        update();
    })();

    // Expose for external use
    window.renaNavigateTo = navigateTo;
    document.addEventListener('rena:permissions', function () {
        if (typeof window.renaHasPage !== 'function') return;
        openTabs = openTabs.filter(page => window.renaHasPage(page));
        if (!window.renaHasPage(activeTab || 'dashboard')) navigateTo('dashboard');
        else _renderTabs();
    });

    // Initial page — dashboard for owner/mod, will be overridden by state.js for regular users
    navigateTo('dashboard');

    /* ── Demo health banner ── */
    (function () {
        const banner = document.getElementById('onedriveBanner');
        const msg    = document.getElementById('onedriveMsg');
        if (!banner) return;
        function checkDemo() {
            fetch('/api/system/onedrive-health')
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (!d) return;
                    if (d.warn) {
                        const mins = d.shared_fleet_stale_min != null ? Math.round(d.shared_fleet_stale_min) : '?';
                        if (msg) msg.textContent = `Shared fleet snapshot age: ${mins} min — verifique o Demo.`;
                        banner.classList.remove('hidden');
                    } else {
                        banner.classList.add('hidden');
                    }
                })
                .catch(() => {});
        }
        checkDemo();
        setInterval(checkDemo, 120000); // every 2 min
    })();

})();
