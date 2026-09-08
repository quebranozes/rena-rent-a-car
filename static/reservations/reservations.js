/* ══════════════ R.E.N.A. — Reservations Module ══════════════ */
(function () {
    'use strict';

    // ── STATE ───────────────────────────────────────────────────
    const RES = {
        rows: [],
        total: 0,
        page: 1,
        perPage: 50,
        pages: 0,
        sortBy: 'PICK_DATETIME',
        sortDir: 'ASC',
        filters: {
            status: 'RS,CO',
            pick_station: '',
            ret_station: '',
            date_from: '',
            date_to: '',
            search: '',
            zgroup: '',
            ow_from: '',
            ow_to: '',
            foreign: '',
        },
        stats: null,
        loading: false,
        initialized: false,
        lastFetchTs: 0,       // timestamp of last successful data fetch
        lastStatsTs: 0,       // timestamp of last stats fetch
        fetchedAt: null,      // ISO string from server (last SQL query time)
    };

    /** Timestamp (ms) of the start of the current 15-min cache slot.
     *  Frontend only re-fetches from server when this slot changes.
     *  Server-side data is refreshed in background every 15 min. */
    function _currentSlotTs() {
        const now = Date.now();
        return now - (now % (15 * 60 * 1000));
    }

    // Status label/color mapping
    const STATUS_CFG = {
        RS:  { label: "Accepted Reservation", color: 'green',  icon: 'fa-check-circle' },
        RQ:  { label: 'On Request',    color: 'purple', icon: 'fa-user-clock' },
        OF:  { label: "Offer",        color: 'yellow', icon: 'fa-paper-plane' },
        ARQ: { label: 'Alt. Request',  color: 'yellow', icon: 'fa-random' },
        NS:  { label: 'No Show',       color: 'orange', icon: 'fa-user-slash' },
        CO:  { label: 'Checkout',      color: 'blue',   icon: 'fa-sign-out-alt' },
        CNL: { label: "Cancelled",     color: 'red',    icon: 'fa-times-circle' },
        DEN: { label: "Declined",      color: 'rose',   icon: 'fa-ban' },
    };

    // Display order for status cards (flow: initial → final)
    const STATUS_ORDER = ['RS', 'RQ', 'OF', 'ARQ', 'NS', 'CO', 'CNL', 'DEN'];

    // ── HELPERS ─────────────────────────────────────────────────
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function _fmtDate(iso) {
        return _esc(window.renaFormatDate(iso, true));
    }

    function _fmtDateTime(iso) {
        return _esc(window.renaFormatDate(iso));
    }

    function _statusBadge(status) {
        const cfg = STATUS_CFG[status] || { label: status, color: 'gray', icon: 'fa-question' };
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-${cfg.color}-500/10 text-${cfg.color}-500">
            <i class="fas ${cfg.icon} text-[0.6rem]"></i> ${_esc(cfg.label)}
        </span>`;
    }

    function _boolBadge(val) {
        if (val === true || val === 1) return "<span class=\"text-green-500 text-xs font-bold\">Yes</span>";
        if (val === false || val === 0) return "<span class=\"text-gray-400 text-xs\">No</span>";
        return '—';
    }

    // ── API ─────────────────────────────────────────────────────
    /** Builds the URLSearchParams shared by list-fetch and export requests
     *  (sort + all active filters; page/per_page/format are added by the caller). */
    function _buildFilterParams() {
        const params = new URLSearchParams();
        params.set('sort_by', RES.sortBy);
        params.set('sort_dir', RES.sortDir);

        if (RES.filters.status) params.set('status', RES.filters.status);
        if (RES.filters.pick_station) params.set('pick_station', RES.filters.pick_station);
        if (RES.filters.ret_station) params.set('ret_station', RES.filters.ret_station);
        if (RES.filters.date_from) params.set('date_from', RES.filters.date_from);
        if (RES.filters.date_to) params.set('date_to', RES.filters.date_to);
        if (RES.filters.search) params.set('search', RES.filters.search);
        if (RES.filters.zgroup) params.set('zgroup', RES.filters.zgroup);
        if (RES.filters.ow_from) params.set('ow_from', RES.filters.ow_from);
        if (RES.filters.ow_to) params.set('ow_to', RES.filters.ow_to);
        if (RES.filters.foreign) params.set('foreign', RES.filters.foreign);
        return params;
    }

    async function _fetchData(force) {
        if (RES.loading) return;
        // Skip if data is fresh unless forced
        if (!force && RES.rows.length > 0 && RES.lastFetchTs >= _currentSlotTs()) {
            return;
        }
        RES.loading = true;
        // Only show loading spinner on first load (no data yet)
        if (RES.rows.length === 0) _renderLoading();

        const params = _buildFilterParams();
        params.set('page', RES.page);
        params.set('per_page', RES.perPage);

        try {
            const resp = await fetch('/api/reservations?' + params.toString());
            const data = await resp.json();
            if (data.no_token) {
                // No Demo token yet — keep loading UI with progress polling, retry in 5s
                if (RES.rows.length === 0) {
                    _renderLoading();
                    setTimeout(() => { RES.loading = false; _fetchData(true); }, 5000);
                    return;
                }
            }
            if (data.error && !data.no_token) throw new Error(data.error);
            RES.rows = data.rows;
            RES.total = data.total;
            RES.page = data.page;
            RES.pages = data.pages;
            RES.lastFetchTs = Date.now();
            if (data.fetched_at) RES.fetchedAt = data.fetched_at;
        } catch (e) {
            console.error('Reservations fetch error:', e);
            // Only clear if we have no data at all — preserve old data on transient errors
            if (RES.rows.length === 0) {
                RES.rows = [];
                RES.total = 0;
                RES.pages = 0;
            }
        }
        RES.loading = false;
        _stopProgressPolling();
        _renderTable();
        _renderPagination();
        _renderFreshness();
        // Check if a background refresh is in progress — show inline indicator
        _checkInlineProgress();
    }

    function _checkInlineProgress() {
        fetch('/api/reservations/progress').then(r => r.json()).then(p => {
            if (p.active) _startInlineProgress();
        }).catch(() => {});
    }

    async function _fetchStats(force) {
        // Skip if data is fresh (same clock slot) unless forced
        if (!force && RES.stats && RES.lastStatsTs >= _currentSlotTs()) {
            return;
        }
        try {
            const params = new URLSearchParams();
            if (RES.filters.date_from) params.set('date_from', RES.filters.date_from);
            if (RES.filters.date_to) params.set('date_to', RES.filters.date_to);
            const resp = await fetch('/api/reservations/stats?' + params.toString());
            const data = await resp.json();
            if (data.no_token) return; // _fetchData handles the retry
            if (data.error) throw new Error(data.error);
            RES.stats = data;
            RES.lastStatsTs = Date.now();
            _renderFilterDropdowns();
        } catch (e) {
            console.error('Reservations stats error:', e);
        }
    }

    // ── RENDER ──────────────────────────────────────────────────
    let _progressTimer = null;

    function _renderLoading() {
        const tbody = document.getElementById('resTableBody');
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="28" class="p-0">
            <div id="resLoadingCard" class="flex flex-col items-center justify-center py-16 text-gray-400">
                <i class="fas fa-spinner fa-spin text-3xl mb-4"></i>
                <div class="text-lg font-medium mb-2">A recolher reservations…</div>
                <div class="w-80 bg-gray-700 rounded-full h-3 mb-2 overflow-hidden">
                    <div id="resProgressBar" class="bg-blue-500 h-3 rounded-full transition-all duration-300" style="width:0%"></div>
                </div>
                <div id="resProgressText" class="text-sm text-gray-500 mb-1">A iniciar…</div>
                <div id="resProgressBranch" class="text-xs text-gray-600"></div>
                <div id="resProgressFailed" class="text-xs text-red-400 mt-2 hidden"></div>
            </div>
        </td></tr>`;
        _startProgressPolling();
    }

    function _startProgressPolling() {
        if (_progressTimer) clearInterval(_progressTimer);
        _progressTimer = setInterval(_pollProgress, 800);
        _pollProgress();
    }

    function _stopProgressPolling() {
        if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
    }

    async function _pollProgress() {
        try {
            const resp = await fetch('/api/reservations/progress');
            const p = await resp.json();
            const bar = document.getElementById('resProgressBar');
            const text = document.getElementById('resProgressText');
            const branch = document.getElementById('resProgressBranch');
            const failedEl = document.getElementById('resProgressFailed');
            if (!bar || !text) return;

            if (p.has_cache && !p.active && p.cache_count > 0 && !p.error) {
                // Data already available — no need to show progress
                _stopProgressPolling();
                return;
            }

            if (p.active && p.total > 0) {
                const pct = Math.round((p.done / p.total) * 100);
                bar.style.width = pct + '%';
                if (p.error) {
                    // Waiting for token — show warning state
                    bar.classList.remove('bg-blue-500');
                    bar.classList.add('bg-yellow-500');
                    text.textContent = p.error;
                    if (p.current_branch) {
                        branch.textContent = p.current_branch;
                    }
                } else {
                    bar.classList.remove('bg-yellow-500', 'bg-red-500');
                    bar.classList.add('bg-blue-500');
                    text.textContent = `${p.done} / ${p.total} stations (${pct}%) — ${p.rows_so_far.toLocaleString()} reservations`;
                    if (p.current_branch) {
                        branch.textContent = `A recolher: ${p.current_branch}`;
                    }
                }
            } else if (p.finished) {
                bar.style.width = '100%';
                if (p.error) {
                    bar.classList.remove('bg-blue-500');
                    bar.classList.add('bg-red-500');
                    text.textContent = p.error;
                    branch.textContent = p.cache_count > 0 ? `Cached data: ${p.cache_count.toLocaleString()} reservations (from ${window.renaFormatDate(p.fetched_at, false, '?')})` : '';
                } else if (p.rows_so_far > 0) {
                    text.textContent = `Completed — ${p.rows_so_far.toLocaleString()} reservations from ${p.total} stations`;
                    branch.textContent = '';
                } else {
                    // 0 rows, no error — probably stale progress or token issue
                    const cc = p.cache_count > 0 ? `${p.cache_count.toLocaleString()} cached reservations` : 'no data';
                    text.textContent = `No new API data — ${cc}`;
                    branch.textContent = '';
                }
                _stopProgressPolling();
            }

            // Show failed branches
            if (p.failed && p.failed.length > 0 && failedEl) {
                const names = p.failed.map(f => f.name).join(', ');
                if (p.active) {
                    failedEl.textContent = `⚠ Failed at ${p.failed.length} station(s) — a tentar novamente: ${names}`;
                } else {
                    failedEl.textContent = `⚠ Failed at ${p.failed.length} station(s): ${names}`;
                }
                failedEl.classList.remove('hidden');
            } else if (failedEl) {
                failedEl.classList.add('hidden');
            }
        } catch (_) {
            // Silent — server might be busy
        }
    }

    function _renderTable() {
        const tbody = document.getElementById('resTableBody');
        const countEl = document.getElementById('resCount');
        if (!tbody) return;
        const table = document.getElementById('resTable');
        if (table) table.classList.toggle('ui-table-empty', RES.rows.length === 0);

        if (countEl) countEl.textContent = RES.total.toLocaleString('en-GB');

        if (RES.rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="28" class="text-center py-12 text-gray-400">
                <i class="fas fa-inbox text-3xl mb-2"></i><br>No reservations match the selected filters
            </td></tr>`;
            return;
        }

        tbody.innerHTML = RES.rows.map(r => `<tr class="hover:bg-lynx-subtle dark:hover:bg-white/5 border-b border-lynx-divider dark:border-gray-800/50 text-xs">
            <td class="px-3 py-2 font-mono font-bold text-primary-500 whitespace-nowrap">${_esc(r.RESERVATION_NO)}</td>
            <td class="px-3 py-2 whitespace-nowrap">${_statusBadge(r.STATUS)}</td>
            <td class="px-3 py-2 font-mono whitespace-nowrap">${_esc(r.ZGROUP)}</td>
            <td class="px-3 py-2 font-mono whitespace-nowrap">${_esc(r.ACRISS_CODE || '—')}</td>
            <td class="px-3 py-2 text-right">${r.DURATION != null ? r.DURATION : '—'}</td>
            <td class="px-3 py-2">${_boolBadge(r.IS_LONGTERM)}</td>
            <td class="px-3 py-2">${_boolBadge(r.ONE_WAY)}</td>
            <td class="px-3 py-2">${_boolBadge(r.IS_PREPAID)}</td>
            <td class="px-3 py-2">${_boolBadge(r.IS_VIP)}</td>
            <td class="px-3 py-2 whitespace-nowrap">${_esc(r.LOYALTY_STATUS || '—')}</td>
            <td class="px-3 py-2 whitespace-nowrap font-medium">${_fmtDateTime(r.PICK_DATETIME)}</td>
            <td class="px-3 py-2 font-mono">${_esc(r.PICK_STATION_ID || '—')}</td>
            <td class="px-3 py-2 whitespace-nowrap">${_esc(r.PICK_STATION_NAME || '—')}${r.PICK_ZONE ? ' <span class="text-[0.6rem] text-gray-400">[' + _esc(r.PICK_ZONE) + ']</span>' : ''}</td>
            <td class="px-3 py-2 whitespace-nowrap text-gray-400">${_esc(r.PICK_TIMEZONE || '—')}</td>
            <td class="px-3 py-2 whitespace-nowrap">${_fmtDateTime(r.RET_DATETIME)}</td>
            <td class="px-3 py-2 font-mono">${_esc(r.RET_STATION_ID || '—')}</td>
            <td class="px-3 py-2 whitespace-nowrap">${_esc(r.RET_STATION_NAME || '—')}${r.RET_ZONE ? ' <span class="text-[0.6rem] text-gray-400">[' + _esc(r.RET_ZONE) + ']</span>' : ''}</td>
            <td class="px-3 py-2 whitespace-nowrap">${_esc(r.VEHICLE_TYPE || '—')}</td>
            <td class="px-3 py-2 whitespace-nowrap">${_esc(r.VEHICLE_MAKE || '—')}</td>
            <td class="px-3 py-2 whitespace-nowrap">${_esc(r.VEHICLE_MODEL || '—')}</td>
            <td class="px-3 py-2 font-mono whitespace-nowrap">${_esc(r.LICENCE_PLATE || '—')}</td>
            <td class="px-3 py-2">${_boolBadge(r.IS_DELIVERY)}</td>
            <td class="px-3 py-2">${_boolBadge(r.IS_COLLECTION)}</td>
            <td class="px-3 py-2">${_boolBadge(r.GAT_DELIVERY)}</td>
            <td class="px-3 py-2">${_boolBadge(r.IS_SUBSCRIPTION)}</td>
            <td class="px-3 py-2">${_boolBadge(r.IS_VEHICLE_EXCHANGE)}</td>
            <td class="px-3 py-2 whitespace-nowrap">${_esc(r.CHECKOUT_AGENT || '—')}</td>
            <td class="px-3 py-2">${_boolBadge(r.CAN_CHECKOUT)}</td>
        </tr>`).join('');
    }

    function _renderPagination() {
        const el = document.getElementById('resPagination');
        if (!el) return;

        const { page, pages, total, perPage } = RES;
        const from = total === 0 ? 0 : (page - 1) * perPage + 1;
        const to = Math.min(page * perPage, total);

        let html = `<span class="text-xs text-gray-400">${from}–${to} of ${total.toLocaleString('en-GB')}</span>`;
        html += '<div class="flex gap-1">';

        // First / Prev
        html += `<button onclick="resGoPage(1)" class="px-2 py-1 rounded text-xs ${page <= 1 ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-primary-500 hover:bg-lynx-subtle dark:hover:bg-white/5'}" ${page <= 1 ? 'disabled' : ''}><i class="fas fa-angle-double-left"></i></button>`;
        html += `<button onclick="resGoPage(${page - 1})" class="px-2 py-1 rounded text-xs ${page <= 1 ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-primary-500 hover:bg-lynx-subtle dark:hover:bg-white/5'}" ${page <= 1 ? 'disabled' : ''}><i class="fas fa-angle-left"></i></button>`;

        // Page numbers (show max 7)
        const start = Math.max(1, page - 3);
        const end = Math.min(pages, start + 6);
        for (let i = start; i <= end; i++) {
            html += `<button onclick="resGoPage(${i})" class="px-2.5 py-1 rounded text-xs font-medium ${i === page ? 'bg-primary-500 text-white' : 'text-gray-500 hover:text-primary-500 hover:bg-lynx-subtle dark:hover:bg-white/5'}">${i}</button>`;
        }

        // Next / Last
        html += `<button onclick="resGoPage(${page + 1})" class="px-2 py-1 rounded text-xs ${page >= pages ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-primary-500 hover:bg-lynx-subtle dark:hover:bg-white/5'}" ${page >= pages ? 'disabled' : ''}><i class="fas fa-angle-right"></i></button>`;
        html += `<button onclick="resGoPage(${pages})" class="px-2 py-1 rounded text-xs ${page >= pages ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-primary-500 hover:bg-lynx-subtle dark:hover:bg-white/5'}" ${page >= pages ? 'disabled' : ''}><i class="fas fa-angle-double-right"></i></button>`;

        html += '</div>';
        el.innerHTML = html;
    }

    function _renderFilterDropdowns() {
        if (!RES.stats) return;

        // Pick station dropdown
        const pickSel = document.getElementById('resFilterPickStation');
        if (pickSel && RES.stats.pick_stations) {
            let opts = "<option value=\"\">All</option>";
            RES.stats.pick_stations.forEach(s => {
                opts += `<option value="${_esc(s)}" ${RES.filters.pick_station === s ? 'selected' : ''}>${_esc(s)}</option>`;
            });
            pickSel.innerHTML = opts;
        }

        // ZGROUP multi-select checkboxes
        const zgOptsWrap = document.getElementById('resFilterZgroupOptions');
        if (zgOptsWrap && RES.stats.zgroups) {
            const selected = new Set((RES.filters.zgroup || '').split(',').filter(Boolean));
            zgOptsWrap.innerHTML = RES.stats.zgroups.map(g => `
                <label class="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-lynx-subtle dark:hover:bg-gray-800 rounded">
                    <input type="checkbox" class="resZgroupCheck" value="${_esc(g)}" ${selected.has(g) ? 'checked' : ''} onchange="window.resZgroupChanged()">
                    ${_esc(g)}
                </label>`).join('');
            const allCb = document.getElementById('resFilterZgroupAll');
            if (allCb) allCb.checked = selected.size === 0;
            _updateZgroupLabel();
        }

        // Channel dropdown removed — no longer available from API

        // Status counts badges — removed, only RS+CO total shown in header
        const statusWrap = document.getElementById('resStatusCards');
        if (statusWrap) statusWrap.innerHTML = '';

        // OW zone dropdowns
        const owFrom = document.getElementById('resFilterOwFrom');
        const owTo = document.getElementById('resFilterOwTo');
        if (owFrom && RES.stats.zones) {
            let opts = "<option value=\"\">Any zone</option>";
            RES.stats.zones.forEach(z => {
                opts += `<option value="${_esc(z)}" ${RES.filters.ow_from === z ? 'selected' : ''}>${_esc(z)}</option>`;
            });
            owFrom.innerHTML = opts;
        }
        if (owTo && RES.stats.zones) {
            let opts = "<option value=\"\">Any zone</option>";
            RES.stats.zones.forEach(z => {
                opts += `<option value="${_esc(z)}" ${RES.filters.ow_to === z ? 'selected' : ''}>${_esc(z)}</option>`;
            });
            owTo.innerHTML = opts;
        }
    }

    // ── ZGROUP MULTI-SELECT ─────────────────────────────────────
    function _updateZgroupLabel() {
        const label = document.getElementById('resFilterZgroupLabel');
        if (!label) return;
        const selected = (RES.filters.zgroup || '').split(',').filter(Boolean);
        if (selected.length === 0) label.textContent = "All";
        else if (selected.length <= 2) label.textContent = selected.join(', ');
        else label.textContent = selected.length + " selected groups";
    }

    window.resToggleZgroupPanel = function () {
        const panel = document.getElementById('resFilterZgroupPanel');
        if (panel) panel.classList.toggle('hidden');
    };

    window.resZgroupToggleAll = function (checked) {
        if (!checked) {
            // Unchecking "Todos" with nothing else selected — just re-check it,
            // there's no meaningful "select nothing" state for this filter.
            const allCb = document.getElementById('resFilterZgroupAll');
            if (allCb) allCb.checked = true;
            return;
        }
        document.querySelectorAll('.resZgroupCheck').forEach(cb => { cb.checked = false; });
        RES.filters.zgroup = '';
        _updateZgroupLabel();
        _applyFilters();
    };

    window.resZgroupChanged = function () {
        const checked = Array.from(document.querySelectorAll('.resZgroupCheck:checked')).map(cb => cb.value);
        RES.filters.zgroup = checked.join(',');
        const allCb = document.getElementById('resFilterZgroupAll');
        if (allCb) allCb.checked = checked.length === 0;
        _updateZgroupLabel();
        _applyFilters();
    };

    // ── FRESHNESS / ADMIN ───────────────────────────────────────
    let _inlineProgressTimer = null;

    function _renderFreshness() {
        const el = document.getElementById('resFreshnessInfo');
        if (!el) return;
        if (RES.fetchedAt) {
            const timestamp = window.renaFormatDate(RES.fetchedAt);
            el.innerHTML = `<i class="fas fa-clock text-[0.55rem]"></i> Updated ${_esc(timestamp)}`
                + `<span id="resInlineProgress" class="ml-2 text-blue-400 hidden"></span>`;
            el.title = "Last updated: " + timestamp;
        } else {
            el.innerHTML = `<span id="resInlineProgress" class="text-blue-400"></span>`;
        }
    }

    function _startInlineProgress() {
        if (_inlineProgressTimer) clearInterval(_inlineProgressTimer);
        _inlineProgressTimer = setInterval(_pollInlineProgress, 800);
        _pollInlineProgress();
    }
    function _stopInlineProgress() {
        if (_inlineProgressTimer) { clearInterval(_inlineProgressTimer); _inlineProgressTimer = null; }
        const sp = document.getElementById('resInlineProgress');
        if (sp) { sp.classList.add('hidden'); sp.textContent = ''; }
    }
    async function _pollInlineProgress() {
        try {
            const resp = await fetch('/api/reservations/progress');
            const p = await resp.json();
            const sp = document.getElementById('resInlineProgress');
            if (!sp) return;
            if (!p.active && p.finished) {
                if (p.error) {
                    // Refresh failed — show error + cache info
                    const cacheInfo = p.cache_count > 0 ? ` · cached data: ${p.cache_count.toLocaleString()}` : '';
                    sp.innerHTML = `<i class="fas fa-exclamation-triangle text-yellow-400 text-[0.55rem]"></i> ${_esc(p.error)}${cacheInfo}`;
                } else if (p.rows_so_far > 0) {
                    sp.innerHTML = `<i class="fas fa-check text-green-400 text-[0.55rem]"></i> ${p.done}/${p.total} stations · ${p.rows_so_far.toLocaleString()} reservations refreshed`;
                } else {
                    // 0 rows but no error — stale progress, just show cache
                    const cc = p.cache_count > 0 ? `${p.cache_count.toLocaleString()} cached reservations` : 'no data';
                    sp.innerHTML = `<i class="fas fa-info-circle text-gray-400 text-[0.55rem]"></i> ${cc}`;
                }
                sp.classList.remove('hidden');
                setTimeout(() => _stopInlineProgress(), 5000);
                return;
            }
            if (!p.active) { _stopInlineProgress(); return; }
            const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
            if (p.error) {
                sp.innerHTML = `<i class="fas fa-exclamation-triangle text-yellow-400 text-[0.55rem]"></i> ${_esc(p.error)}`;
            } else {
                sp.innerHTML = `<i class="fas fa-spinner fa-spin text-[0.55rem]"></i> ${p.done}/${p.total} stations (${pct}%) · ${(p.rows_so_far || 0).toLocaleString()} reservations`;
            }
            sp.classList.remove('hidden');
        } catch (_) {}
    }

    function _renderAdminRefresh() {
        const btn = document.getElementById('resRefreshBtn');
        if (!btn) return;
        const canLynx = window.RENA_ME ? window.RENA_ME.can_lynx : !!window.RENA_IS_ADMIN;
        btn.style.display = canLynx ? 'inline-flex' : 'none';
    }

    async function _forceRefresh() {
        if (RES.loading) return;
        try {
            const resp = await fetch('/api/reservations/refresh?force=1', { method: 'POST' });
            const data = await resp.json();
            if (data.error) { console.error(data.error); return; }
            if (data.skipped && (data.status === 'reloaded_shared' || data.status === 'shared_unchanged')) {
                // Not the sole fetcher — nothing to poll, just show whatever the
                // shared cache reload produced and tell the user why.
                const btn = document.getElementById('resRefreshBtn');
                if (btn) {
                    const original = "<i class=\"fas fa-sync-alt mr-1\"></i> Refresh Data";
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fas fa-check mr-1"></i> ' + (data.status === 'reloaded_shared' ? "Updated" : "Already up to date");
                    setTimeout(() => { btn.disabled = false; btn.innerHTML = original; }, 3000);
                }
                if (data.message) console.info(data.message);
                RES.lastFetchTs = 0;
                RES.lastStatsTs = 0;
                Promise.all([_fetchStats(true), _fetchData(true)]);
                return;
            }
            if (data.status === 'already_running') {
                // Already refreshing — just start polling the progress that's already going
            }
            // Show inline progress in header
            _startInlineProgress();
            // Show subtle indicator on the button while refreshing in background
            const btn = document.getElementById('resRefreshBtn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> A atualizar…';
            }
            // Track that we just triggered a refresh (to distinguish stale progress)
            const refreshStartedAt = Date.now();
            // Poll until background refresh finishes, then swap data
            const pollDone = () => {
                fetch('/api/reservations/progress').then(r => r.json()).then(p => {
                    if (p.active) {
                        setTimeout(pollDone, 2000);
                        return;
                    }
                    // If finished very quickly (< 3s), wait a bit more — thread may not have started yet
                    if (!p.active && !p.error && Date.now() - refreshStartedAt < 3000) {
                        setTimeout(pollDone, 1500);
                        return;
                    }
                    // Background refresh finished — fetch the (possibly old) cached data
                    RES.lastFetchTs = 0;
                    RES.lastStatsTs = 0;
                    Promise.all([_fetchStats(true), _fetchData(true)]).then(() => {
                        if (btn) {
                            btn.disabled = false;
                            btn.innerHTML = "<i class=\"fas fa-sync-alt mr-1\"></i> Refresh Data";
                        }
                    });
                }).catch(() => setTimeout(pollDone, 3000));
            };
            // Wait a moment for backend thread to start, then begin polling
            setTimeout(pollDone, 2000);
        } catch (e) {
            console.error('Force refresh error:', e);
        }
    }

    // ── SORT ────────────────────────────────────────────────────
    function _sortBy(col) {
        if (RES.sortBy === col) {
            RES.sortDir = RES.sortDir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            RES.sortBy = col;
            RES.sortDir = 'ASC';
        }
        RES.page = 1;
        _updateSortIcons();
        _fetchData(true);
    }

    function _updateSortIcons() {
        document.querySelectorAll('#resTable th[data-col]').forEach(th => {
            const icon = th.querySelector('.sort-icon');
            if (!icon) return;
            const col = th.getAttribute('data-col');
            if (col === RES.sortBy) {
                icon.className = 'sort-icon fas fa-sort-' + (RES.sortDir === 'ASC' ? 'up' : 'down') + ' text-primary-500 ml-1';
            } else {
                icon.className = 'sort-icon fas fa-sort text-gray-300 ml-1';
            }
        });
    }

    // ── FILTER ACTIONS ──────────────────────────────────────────
    function _applyFilters() {
        const f = RES.filters;
        const prevDateFrom = f.date_from;
        const prevDateTo = f.date_to;
        f.search = (document.getElementById('resFilterSearch') || {}).value || '';
        f.pick_station = (document.getElementById('resFilterPickStation') || {}).value || '';
        // f.zgroup is kept in sync directly by the checkbox handlers (resZgroupChanged/
        // resZgroupToggleAll) — no single element to read a .value from anymore.
        f.date_from = (document.getElementById('resFilterDateFrom') || {}).value || '';
        f.date_to = (document.getElementById('resFilterDateTo') || {}).value || '';
        f.ow_from = (document.getElementById('resFilterOwFrom') || {}).value || '';
        f.ow_to = (document.getElementById('resFilterOwTo') || {}).value || '';
        RES.page = 1;
        // Refresh status counts if date range changed
        if (f.date_from !== prevDateFrom || f.date_to !== prevDateTo) {
            _fetchStats(true);
        }
        _fetchData(true);
    }

    function _resetFilters() {
        RES.filters = { status: '', pick_station: '', ret_station: '', date_from: '', date_to: '', search: '', zgroup: '', ow_from: '', ow_to: '', foreign: '' };
        // Clear UI
        const ids = ['resFilterSearch', 'resFilterPickStation', 'resFilterDateFrom', 'resFilterDateTo', 'resFilterOwFrom', 'resFilterOwTo'];
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.querySelectorAll('.resZgroupCheck').forEach(cb => { cb.checked = false; });
        const zgAllCb = document.getElementById('resFilterZgroupAll');
        if (zgAllCb) zgAllCb.checked = true;
        _updateZgroupLabel();
        document.getElementById('resFilterZgroupPanel')?.classList.add('hidden');
        _updateForeignBtn();
        RES.page = 1;
        _renderFilterDropdowns();
        _fetchStats(true);
        _fetchData(true);
    }

    function _updateForeignBtn() {
        const btn = document.getElementById('resFilterForeignBtn');
        if (!btn) return;
        const active = RES.filters.foreign === '1';
        btn.className = active
            ? 'flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border transition-colors bg-blue-500 text-white border-blue-500 font-semibold'
            : 'flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-lynx-divider dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-blue-500 hover:border-blue-400 transition-colors';
    }

    // ── EXPORT (CSV / Excel) ───────────────────────────────────────
    function _exportFile(format, btnId) {
        const btn = document.getElementById(btnId);
        const original = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> A exportar…';
        }
        const params = _buildFilterParams();
        params.set('format', format);
        const url = '/api/reservations/export?' + params.toString();
        // Plain navigation: server responds with Content-Disposition: attachment,
        // so the browser downloads the file without leaving the page.
        const a = document.createElement('a');
        a.href = url;
        a.click();
        if (btn) {
            setTimeout(() => { btn.disabled = false; btn.innerHTML = original; }, 2000);
        }
    }

    function _exportCSV() {
        _exportFile('csv', 'resExportCsvBtn');
    }

    function _exportExcel() {
        _exportFile('xlsx', 'resExportExcelBtn');
    }

    // ── INIT ────────────────────────────────────────────────────
    async function init() {
        if (RES.initialized) {
            // Re-entry: only refresh if cache expired
            const stale = RES.lastFetchTs < _currentSlotTs();
            if (stale) {
                await Promise.all([_fetchStats(true), _fetchData(true)]);
            }
            _renderAdminRefresh();
            return;
        }
        RES.initialized = true;

        // Set default date range: today → +2 years
        const today = new Date();
        const future = new Date(today);
        future.setFullYear(future.getFullYear() + 2);
        RES.filters.date_from = today.toISOString().slice(0, 10);
        RES.filters.date_to = future.toISOString().slice(0, 10);

        const dfEl = document.getElementById('resFilterDateFrom');
        const dtEl = document.getElementById('resFilterDateTo');
        if (dfEl) dfEl.value = RES.filters.date_from;
        if (dtEl) dtEl.value = RES.filters.date_to;

        // Bind search debounce
        const searchEl = document.getElementById('resFilterSearch');
        if (searchEl) {
            let debounce;
            searchEl.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => _applyFilters(), 400);
            });
            searchEl.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounce); _applyFilters(); }
            });
        }

        // Bind filter changes
        ['resFilterPickStation', 'resFilterDateFrom', 'resFilterDateTo'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => _applyFilters());
        });

        // ZGROUP dropdown: close on outside click (checkboxes themselves apply
        // the filter directly via resZgroupChanged/resZgroupToggleAll)
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('resFilterZgroupPanel');
            const btn = document.getElementById('resFilterZgroupBtn');
            if (!panel || panel.classList.contains('hidden')) return;
            if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
            panel.classList.add('hidden');
        });

        // Bind sort headers
        document.querySelectorAll('#resTable th[data-col]').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => _sortBy(th.getAttribute('data-col')));
        });

        // Fetch stats and data in parallel
        await Promise.all([_fetchStats(true), _fetchData(true)]);
        _updateSortIcons();
        _renderAdminRefresh();
    }

    // ── GLOBAL EXPORTS ──────────────────────────────────────────
    window.resInit = init;
    window.resGoPage = function (p) {
        if (p < 1 || p > RES.pages || p === RES.page) return;
        RES.page = p;
        _fetchData(true);
    };
    window.resFilterStatus = function (st) {
        RES.filters.status = st;
        RES.page = 1;
        _renderFilterDropdowns();
        _fetchData(true);
    };
    window.resApplyFilters = _applyFilters;
    window.resResetFilters = _resetFilters;
    window.resToggleForeign = function () {
        RES.filters.foreign = RES.filters.foreign === '1' ? '' : '1';
        _updateForeignBtn();
        RES.page = 1;
        _fetchData(true);
    };
    window.resExportCSV = _exportCSV;
    window.resExportExcel = _exportExcel;
    window.resSortBy = _sortBy;
    window.resForceRefresh = _forceRefresh;

    // Auto-refresh: when the shared status poll (utils.js) detects the backend
    // has newer reservation data (new fetch by the sole fetcher, or the shared
    // cache watcher picking it up), silently re-fetch and re-render — no manual
    // reload needed. Only acts if this page has already been opened this session.
    window.addEventListener('rena:reservations-updated', () => {
        if (!RES.initialized) return;
        RES.lastFetchTs = 0;
        RES.lastStatsTs = 0;
        Promise.all([_fetchStats(true), _fetchData(true)]);
    });

})();
