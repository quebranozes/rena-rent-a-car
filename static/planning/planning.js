/* ══════════════ R.E.N.A. — Fleet Planning Module ══════════════ */
(function () {
    'use strict';

    const FP = {
        data: null,
        selectedPools: [],  // pool names to show as columns
        selectedStations: [],  // station IDs to show as individual columns
        selectedRegions: [], // region names when in region view
        selectedGroups: [], // ACRISS codes selected (empty = all)
        expandedPoolStns: [],  // pool names with expanded station lists
        days: 30,
        loading: false,
        regionView: false,  // toggle between pool view and region view
        nationalView: false, // aggregate all non-island pools into one "National" column
        infleet: null,       // infleet data from server
        _infleetParksByPool: {},  // { poolName: [parkId, ...] }
        _infleetStationType: {},  // { stationId: tipo }
    };

    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ── Vehicle masterdata (cor + alarme) — same cache the Fleet page uses ──
    let _fpMasterData = null;  // { plate: { cor, alarme, updated_at } }

    async function _fpEnsureMasterData() {
        if (_fpMasterData) return _fpMasterData;
        // Reuse Fleet's already-loaded cache if that page was visited this session
        if (typeof window.nafGetMasterDataCache === 'function') {
            const existing = window.nafGetMasterDataCache();
            if (existing && Object.keys(existing).length) { _fpMasterData = existing; return _fpMasterData; }
        }
        try {
            const r = await fetch('/api/vehicle-masterdata/data');
            const j = await r.json();
            _fpMasterData = (j && j.masterdata) || {};
        } catch (e) { _fpMasterData = {}; }
        return _fpMasterData;
    }

    function _fpAlarm(plate) {
        if (!_fpMasterData) return '';
        const md = _fpMasterData[(plate || '').trim()] || {};
        return md.alarme || '';
    }

    function _fmtDate(iso) {
        return _esc(window.renaFormatDate(iso, true));
    }

    function _isWeekend(iso) {
        const d = new Date(iso + 'T00:00:00');
        return d.getDay() === 0 || d.getDay() === 6;
    }

    // ── Persistent prefs ────────────────────────────────────────
    function _savePrefs() {
        try {
            localStorage.setItem('rena-fp-prefs', JSON.stringify({
                selectedPools: FP.selectedPools,
                selectedStations: FP.selectedStations,
                selectedRegions: FP.selectedRegions,
                selectedGroups: FP.selectedGroups,
                days: FP.days,
                regionView: FP.regionView,
                nationalView: FP.nationalView,
            }));
        } catch (_) {}
    }
    function _loadPrefs() {
        try {
            const p = JSON.parse(localStorage.getItem('rena-fp-prefs') || '{}');
            if (Array.isArray(p.selectedPools)) FP.selectedPools = p.selectedPools;
            if (Array.isArray(p.selectedStations)) FP.selectedStations = p.selectedStations;
            if (Array.isArray(p.selectedRegions)) FP.selectedRegions = p.selectedRegions;
            if (Array.isArray(p.selectedGroups)) FP.selectedGroups = p.selectedGroups;
            if (p.days) FP.days = parseInt(p.days, 10) || 30;
            if (p.nationalView) { FP.nationalView = true; FP.regionView = false; }
            else if (p.regionView) FP.regionView = true;
        } catch (_) {}
    }

    // ── API ─────────────────────────────────────────────────────
    async function _fetchData() {
        if (FP.loading) return;
        FP.loading = true;
        // Only show loading spinner on first load (no data yet)
        if (!FP.data) _renderLoading();

        const params = new URLSearchParams();
        params.set('days', FP.days);

        try {
            const resp = await fetch('/api/fleet-planning?' + params.toString());
            const json = await resp.json();
            if (json.error) throw new Error(json.error);
            FP.data = json;

            // Auto-select all pools on first load if none selected
            if (FP.selectedPools.length === 0 && json.pool_names && json.pool_names.length) {
                FP.selectedPools = json.pool_names.slice();
            }
            // Remove pools that no longer exist
            FP.selectedPools = FP.selectedPools.filter(p => json.pool_names.includes(p));
            // Remove stations that no longer exist
            const allStationIds = json.stations ? Object.keys(json.stations) : [];
            FP.selectedStations = FP.selectedStations.filter(s => allStationIds.includes(s));
            // Auto-select all regions on first load if none selected
            const regionNames = (json.planning_regions || []).map(r => r.nome);
            if (FP.selectedRegions.length === 0 && regionNames.length) {
                FP.selectedRegions = regionNames.slice();
            }
            FP.selectedRegions = FP.selectedRegions.filter(r => regionNames.includes(r));

            // Build infleet lookups
            FP.infleet = json.infleet || null;
            FP._infleetFetchStatus = json.infleet_fetch_status || null;
            _buildInfleetLookups();

            // Auto-refresh infleet once per day after 08:00 if stale
            // Demo examples are fixed; no automatic extraction.
        } catch (e) {
            console.error('Fleet Planning fetch error:', e);
            // Preserve old data on transient errors
            if (!FP.data) FP.data = null;
        }
        FP.loading = false;
        _fpStopProgressPolling();
        _renderFilters();
        _renderTable();
    }

    // ── RENDER ──────────────────────────────────────────────────
    let _fpProgressTimer = null;

    function _renderLoading() {
        const wrap = document.getElementById('fpContent');
        if (!wrap) return;
        wrap.innerHTML = `<div id="fpLoadingCard" class="flex flex-col items-center justify-center py-20 text-gray-400">
            <i class="fas fa-spinner fa-spin text-3xl mb-4"></i>
            <div class="text-lg font-medium mb-2">Loading Fleet Planning…</div>
            <div class="w-80 bg-gray-700 rounded-full h-3 mb-2 overflow-hidden">
                <div id="fpProgressBar" class="bg-blue-500 h-3 rounded-full transition-all duration-300" style="width:0%"></div>
            </div>
            <div id="fpProgressText" class="text-sm text-gray-500 mb-1">A verificar reservations…</div>
            <div id="fpProgressBranch" class="text-xs text-gray-600"></div>
        </div>`;
        _fpStartProgressPolling();
    }

    function _fpStartProgressPolling() {
        if (_fpProgressTimer) clearInterval(_fpProgressTimer);
        _fpProgressTimer = setInterval(_fpPollProgress, 800);
        _fpPollProgress();
    }
    function _fpStopProgressPolling() {
        if (_fpProgressTimer) { clearInterval(_fpProgressTimer); _fpProgressTimer = null; }
    }

    async function _fpPollProgress() {
        try {
            const resp = await fetch('/api/reservations/progress');
            const p = await resp.json();
            const bar = document.getElementById('fpProgressBar');
            const text = document.getElementById('fpProgressText');
            const branch = document.getElementById('fpProgressBranch');
            if (!bar || !text) { _fpStopProgressPolling(); return; }

            if (p.has_cache && !p.active) {
                _fpStopProgressPolling(); return;
            }
            if (p.active && p.total > 0) {
                const pct = Math.round((p.done / p.total) * 100);
                bar.style.width = pct + '%';
                if (p.error) {
                    bar.classList.remove('bg-blue-500');
                    bar.classList.add('bg-yellow-500');
                    text.textContent = p.error;
                    if (p.current_branch) branch.textContent = p.current_branch;
                } else {
                    bar.classList.remove('bg-yellow-500');
                    bar.classList.add('bg-blue-500');
                    text.textContent = `Reservations: ${p.done}/${p.total} stations (${pct}%) — ${p.rows_so_far.toLocaleString()} reservations`;
                    if (p.current_branch) branch.textContent = `A recolher: ${p.current_branch}`;
                }
            } else if (p.finished) {
                bar.style.width = '100%';
                text.textContent = p.error || `Reservations loaded — ${p.rows_so_far.toLocaleString()}`;
                branch.textContent = '';
                _fpStopProgressPolling();
            }
        } catch (_) {}
    }

    function _renderFilters() {
        if (!FP.data) return;

        const regions = FP.data.planning_regions || [];
        const hasRegions = regions.length > 0;

        // Pool / Region dropdown
        _renderPoolDropdown();

        // Region toggle button
        const toggleWrap = document.getElementById('fpViewToggle');
        if (toggleWrap) {
            if (hasRegions) {
                const isNat = FP.nationalView;
                const isReg = !isNat && FP.regionView;
                const isPool = !isNat && !isReg;
                const _btn = (label, onclick, active, pos) => {
                    const rounded = pos === 'l' ? 'rounded-l' : pos === 'r' ? 'rounded-r' : '';
                    const cls = active ? 'bg-primary-500 text-white' : 'bg-lynx-subtle dark:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300';
                    return '<button onclick="' + onclick + '" class="px-2 py-0.5 text-[0.6rem] ' + rounded + ' ' + cls + '">' + label + '</button>';
                };
                toggleWrap.innerHTML =
                    _btn('Pools',    'fpSetView(\'pools\')',    isPool, 'l') +
                    _btn("Regions",  'fpSetView(\'regions\')',  isReg,  '') +
                    _btn("National", 'fpSetView(\'national\')', isNat,  'r');
                toggleWrap.classList.remove('hidden');
            } else {
                toggleWrap.innerHTML = '';
                toggleWrap.classList.add('hidden');
            }
        }

        // ACRISS multi-select dropdown
        _renderGroupDropdown();

        // Days selector
        const daysSel = document.getElementById('fpDaysFilter');
        if (daysSel) daysSel.value = FP.days;

        // Info
        const info = document.getElementById('fpInfo');
        if (info) {
            const resCached = FP.data.res_total_cache || 0;
            const resPlanning = FP.data.res_counted_planning || 0;
            const infleetAt = FP.infleet && FP.infleet.refreshed_at
                ? window.renaFormatDate(FP.infleet.refreshed_at) : null;
            // Infleet fetch status indicator
            const ifs = FP._infleetFetchStatus || {};
            let infleetStatusHtml = '';
            if (ifs.active) {
                const who = ifs.me ? 'A atualizar infleet…' : _esc(ifs.user || '?') + ' a atualizar infleet…';
                infleetStatusHtml = ' <span class="text-yellow-500"><i class="fas fa-arrows-rotate fa-spin text-[0.55rem]"></i> ' + who + '</span>';
            }
            info.innerHTML = "<span class=\"text-gray-400 text-[0.65rem]\">Fleet: " + _esc(window.renaFormatDate(FP.data.fleet_captured_at))
                + " · Reservations: " + _esc(window.renaFormatDate(FP.data.res_fetched_at))
                + (infleetAt ? ' · Infleet: ' + _esc(infleetAt) : '')
                + " · <span title=\"Cached reservations (total) / included in planning (hoje→+" + FP.days + 'd)">' + resCached.toLocaleString('en-GB') + " cached / " + resPlanning.toLocaleString('en-GB') + " in planning</span>"
                + infleetStatusHtml + '</span>';
        }
    }

    // Combined Taxa de Ocupação across whichever regions/folders are
    // currently selected — reuses _mergePools so the number always agrees
    // with what summing the individual region cards would give.
    function _renderOccupancyBadge(poolNames) {
        const badge = document.getElementById('fpOccupancyBadge');
        if (!badge) return;
        const uniquePools = [...new Set(poolNames)];
        const merged = uniquePools.length && FP.data && FP.data.pools ? _mergePools(uniquePools, FP.data.pools) : null;
        if (!merged || !merged.occupancy || merged.occupancy.pct == null) {
            badge.classList.add('hidden');
            badge.innerHTML = '';
            return;
        }
        const pct = merged.occupancy.pct;
        const improPct = merged.occupancy.impro_pct;
        const cls = pct < 60 ? 'text-red-500' : pct < 75 ? 'text-orange-400' : 'text-indigo-500';
        badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-lynx-subtle dark:bg-[#1A1A1A] border border-lynx-divider dark:border-gray-700 text-xs font-semibold';
        badge.title = "Combined occupancy of the selected zones: " + merged.occupancy.em_andamento
            + " rented out of " + merged.occupancy.base + " (total fleet " + merged.occupancy.total
            + ', excl. ' + merged.occupancy.unknown + " with unknown status). Non-revenue use: " + merged.occupancy.impro
            + " vehicle(s) on non-customer rate codes.";
        badge.innerHTML = '<span class="' + cls + '"><i class="fas fa-gauge-high"></i> Tx Ocup: ' + pct + '%</span>'
            + '<span class="text-fuchsia-400"><i class="fas fa-truck-ramp-box"></i> Tx Impro: ' + (improPct == null ? '—' : improPct + '%') + '</span>';
    }

    function _renderPoolDropdown(keepOpen) {
        const wrap = document.getElementById('fpPoolDropdown');
        if (!wrap || !FP.data) return;

        const regions = FP.data.planning_regions || [];
        // National view: hide the pool selector entirely
        if (FP.nationalView) {
            wrap.innerHTML = '';
            return;
        }
        const isRegion = FP.regionView && regions.length > 0;
        const wasOpen = keepOpen && document.getElementById('fpPoolPanel') && !document.getElementById('fpPoolPanel').classList.contains('hidden');

        // Save scroll position before rebuilding DOM
        let savedScroll = 0;
        if (wasOpen) {
            const scrollEl = document.querySelector('#fpPoolPanel .overflow-y-auto');
            if (scrollEl) savedScroll = scrollEl.scrollTop;
        }

        let items, selected, label, icon;
        if (isRegion) {
            // Every folder (Agentes, Ilhas, Outros, ...) is selectable here —
            // unlike National, which deliberately stays continental-only.
            const extraFolders = FP.data.pool_folders || [];
            items = [...regions.map(r => r.nome), ...extraFolders.map(f => f.nome)];
            selected = FP.selectedRegions;
            const cntCore = regions.filter(r => selected.includes(r.nome)).length;
            const cntExtra = extraFolders.filter(f => selected.includes(f.nome)).length;
            let parts = [];
            if (cntCore > 0) parts.push(cntCore === regions.length ? "All Regions" : cntCore + " Regions");
            if (cntExtra > 0) parts.push(extraFolders.filter(f => selected.includes(f.nome)).map(f => f.nome).join(', '));
            label = parts.length ? parts.join(' + ') : "No Regions";
            icon = 'fa-globe-europe';

            // Combined occupancy badge — every pool behind whichever
            // regions/folders are currently checked (e.g. Agentes only
            // counts in if the user has it selected).
            const selectedPoolNames = [];
            regions.concat(extraFolders).forEach(src => {
                if (selected.includes(src.nome)) selectedPoolNames.push(...(src.pools || []));
            });
            _renderOccupancyBadge(selectedPoolNames);
        } else {
            items = FP.data.pool_names || [];
            selected = FP.selectedPools;
            const cnt = selected.length;
            label = cnt === 0 ? "No Pool" : cnt === items.length ? "All Pools" : cnt + ' Pools';
            icon = 'fa-map-marker-alt';
            const badge = document.getElementById('fpOccupancyBadge');
            if (badge) badge.classList.add('hidden');
        }

        // Panel content
        let panelHtml = '<div class="flex items-center justify-between px-3 py-2 border-b border-lynx-divider dark:border-gray-700">'
            + '<span class="text-[0.6rem] text-gray-400 uppercase tracking-wider font-semibold">'
            + (isRegion ? "Select Regions" : "Select Pools") + '</span>'
            + '<div class="flex gap-1">'
            + "<button onclick=\"fpSelectAllPools()\" class=\"text-[0.6rem] px-2 py-0.5 rounded bg-lynx-subtle dark:bg-gray-700 text-gray-500 hover:text-primary-500\">All</button>"
            + "<button onclick=\"fpDeselectAllPools()\" class=\"text-[0.6rem] px-2 py-0.5 rounded bg-lynx-subtle dark:bg-gray-700 text-gray-500 hover:text-red-400\">Clear</button>"
            + '</div></div>';
        panelHtml += '<div class="max-h-[400px] overflow-y-auto p-2 space-y-0.5">';

        if (isRegion) {
            regions.forEach(r => {
                const checked = selected.includes(r.nome) ? 'checked' : '';
                const poolList = (r.pools || []).join(', ');
                panelHtml += '<label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-lynx-subtle dark:hover:bg-gray-800/50 cursor-pointer">'
                    + '<input type="checkbox" value="' + _esc(r.nome) + '" ' + checked + ' onchange="fpToggleRegion(this)" class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-500 focus:ring-primary-500 cursor-pointer">'
                    + '<div><span class="text-xs font-medium text-gray-700 dark:text-gray-300">' + _esc(r.nome) + '</span>'
                    + '<span class="text-[0.55rem] text-gray-400 ml-1.5">' + _esc(poolList) + '</span></div>'
                    + '</label>';
            });
            // Optional folders (Agentes, Ilhas, Outros, ...)
            const extraFolders = FP.data.pool_folders || [];
            if (extraFolders.length) {
                panelHtml += '<div class="mt-2 pt-2 border-t border-lynx-divider dark:border-gray-700">'
                    + '<span class="text-[0.55rem] text-gray-400 uppercase tracking-wider px-2">Opcional</span></div>';
                extraFolders.forEach(f => {
                    const checked = selected.includes(f.nome) ? 'checked' : '';
                    const poolList = (f.pools || []).join(', ');
                    const icon = f.icon || 'fa-folder';
                    panelHtml += '<label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-lynx-subtle dark:hover:bg-gray-800/50 cursor-pointer">'
                        + '<input type="checkbox" value="' + _esc(f.nome) + '" ' + checked + ' onchange="fpToggleRegion(this)" class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-500 focus:ring-primary-500 cursor-pointer">'
                        + '<div><i class="fas ' + _esc(icon) + ' text-[0.55rem] mr-1 text-gray-400"></i>'
                        + '<span class="text-xs font-medium text-gray-600 dark:text-gray-400">' + _esc(f.nome) + '</span>'
                        + '<span class="text-[0.55rem] text-gray-400 ml-1.5">' + _esc(poolList) + '</span></div>'
                        + '</label>';
                });
            }
        } else {
            const folders = FP.data.pool_folders || [];
            const foldered = new Set();
            folders.forEach(f => (f.pools || []).forEach(p => foldered.add(p)));
            const topPools = items.filter(p => !foldered.has(p));
            const poolStations = FP.data.pool_stations || {};

            // Helper: render a pool checkbox + its expandable stations
            function _renderPoolItem(p, indent) {
                const checked = selected.includes(p) ? 'checked' : '';
                const stns = poolStations[p] || [];
                const cls = indent ? 'px-2 py-0.5' : 'px-2 py-1';
                const sz = indent ? 'w-3 h-3' : 'w-3.5 h-3.5';
                const txtCls = indent ? 'text-[0.65rem] text-gray-500 dark:text-gray-400' : 'text-xs text-gray-700 dark:text-gray-300';
                let h = '<label class="flex items-center gap-2 ' + cls + ' rounded hover:bg-lynx-subtle dark:hover:bg-gray-800/50 cursor-pointer">'
                    + '<input type="checkbox" value="' + _esc(p) + '" ' + checked + ' onchange="fpTogglePool(this)" class="' + sz + ' rounded border-gray-300 dark:border-gray-600 text-primary-500 focus:ring-primary-500 cursor-pointer">'
                    + '<span class="' + txtCls + '">' + _esc(p) + '</span>';
                if (stns.length) {
                    h += '<span class="text-[0.5rem] text-gray-400 ml-auto cursor-pointer" onclick="event.preventDefault();fpToggleStationList(this.dataset.pool)" data-pool="' + _esc(p) + '"><i class="fas fa-chevron-down"></i></span>';
                }
                h += '</label>';
                // Station sub-list (hidden by default, expanded if tracked)
                if (stns.length) {
                    const expanded = FP.expandedPoolStns.includes(p);
                    h += '<div id="fpStns_' + _esc(p).replace(/\s/g, '_') + '" class="' + (expanded ? '' : 'hidden ') + 'ml-6 space-y-0.5">';
                    stns.forEach(s => {
                        const sChecked = FP.selectedStations.includes(s.id) ? 'checked' : '';
                        h += '<label class="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-lynx-subtle dark:hover:bg-gray-800/30 cursor-pointer">'
                            + '<input type="checkbox" value="' + _esc(s.id) + '" ' + sChecked + ' onchange="fpToggleStation(this)" class="w-2.5 h-2.5 rounded border-gray-300 dark:border-gray-600 text-blue-400 focus:ring-blue-400 cursor-pointer">'
                            + '<span class="text-[0.6rem] text-gray-400 dark:text-gray-500">' + _esc(s.nome) + '</span>'
                            + '</label>';
                    });
                    h += '</div>';
                }
                return h;
            }

            // Main pools section
            if (topPools.length) {
                panelHtml += '<div class="pb-1 mb-1 border-b border-lynx-divider dark:border-gray-700">';
                topPools.forEach(p => { panelHtml += _renderPoolItem(p, false); });
                panelHtml += '</div>';
            }

            // Folder sections
            folders.forEach(f => {
                const fPools = (f.pools || []).filter(p => items.includes(p));
                if (!fPools.length) return;
                const icon = f.icon || 'fa-folder';
                const allSel = fPools.every(p => selected.includes(p));
                const someSel = !allSel && fPools.some(p => selected.includes(p));
                const folderCb = allSel ? 'checked' : '';
                const indet = someSel ? 'data-indeterminate="1"' : '';

                panelHtml += '<div class="mt-1">';
                panelHtml += '<label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-lynx-subtle dark:hover:bg-gray-800/50 cursor-pointer">'
                    + '<input type="checkbox" ' + folderCb + ' ' + indet + ' onchange="fpTogglePoolFolder(\'' + _esc(f.nome) + '\')" class="fp-folder-cb w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-500 focus:ring-primary-500 cursor-pointer">'
                    + '<span class="text-xs font-semibold text-gray-600 dark:text-gray-400"><i class="fas ' + _esc(icon) + ' text-[0.55rem] mr-1 text-gray-400"></i>' + _esc(f.nome) + '</span>'
                    + '<span class="text-[0.5rem] text-gray-400 ml-auto">' + fPools.length + '</span>'
                    + '</label>';
                panelHtml += '<div class="ml-6 space-y-0.5">';
                fPools.forEach(p => { panelHtml += _renderPoolItem(p, true); });
                panelHtml += '</div></div>';
            });
        }
        panelHtml += '</div>';

        wrap.innerHTML = '<button onclick="fpTogglePoolPanel()" id="fpPoolBtn" class="text-xs px-3 py-1.5 rounded-lg bg-lynx-subtle dark:bg-[#1A1A1A] text-gray-700 dark:text-gray-300 border border-lynx-divider dark:border-gray-700 hover:border-primary-500 transition-colors whitespace-nowrap">'
            + '<i class="fas ' + _esc(icon) + ' mr-1 text-primary-500"></i>' + _esc(label)
            + ' <i class="fas fa-chevron-down text-[0.5rem] ml-1 text-gray-400"></i></button>'
            + '<div id="fpPoolPanel" class="hidden absolute z-50 mt-1 w-[300px] lynx-dropdown shadow-xl">'
            + panelHtml + '</div>';

        // Indeterminate state for folder checkboxes
        wrap.querySelectorAll('.fp-folder-cb[data-indeterminate="1"]').forEach(cb => { cb.indeterminate = true; });

        if (wasOpen) {
            const panel = document.getElementById('fpPoolPanel');
            if (panel) {
                panel.classList.remove('hidden');
                const scrollEl = panel.querySelector('.overflow-y-auto');
                if (scrollEl && savedScroll) scrollEl.scrollTop = savedScroll;
            }
        }
    }

    function _renderGroupDropdown(keepOpen) {
        const wrap = document.getElementById('fpGroupDropdown');
        if (!wrap || !FP.data) return;

        const wasOpen = keepOpen && document.getElementById('fpGroupFilterBar') && !document.getElementById('fpGroupFilterBar').classList.contains('hidden');

        // Save scroll position of the group list before rebuilding DOM
        let savedScroll = 0;
        if (wasOpen) {
            const scrollEl = document.querySelector('#fpGroupFilterBar .overflow-y-auto');
            if (scrollEl) savedScroll = scrollEl.scrollTop;
        }

        const categories = FP.data.acriss_categories || [];
        const allGroups = FP.data.zgroups || [];
        const sel = FP.selectedGroups;
        const count = sel.length;

        // Button label
        const btnLabel = count === 0 ? "All Groups"
            : count <= 3 ? sel.join(', ')
            : count + " selected groups";

        // Build groups assigned to categories
        const assignedGroups = new Set();
        categories.forEach(c => (c.groups || []).forEach(g => assignedGroups.add(g)));
        const uncategorized = allGroups.filter(g => !assignedGroups.has(g));

        const txtVal = sel.length ? sel.join(',') : '';
        let panelHtml = '<div class="flex items-center gap-3 mb-2 flex-wrap">'
            + "<span class=\"text-[0.6rem] text-gray-400 uppercase tracking-wider font-semibold whitespace-nowrap\">Filtrar Groups ACRISS</span>"
            + '<input id="fpGroupTextInput" type="text" value="' + _esc(txtVal) + '" placeholder="Ex: EDMR,CFMR" '
            + 'oninput="fpGroupTextChanged(this.value)" '
            + 'class="text-xs px-2 py-1 rounded-lg bg-lynx-subtle dark:bg-[#0d0d0d] border border-lynx-divider dark:border-gray-700 text-gray-700 dark:text-gray-200 font-mono placeholder-gray-400 focus:border-primary-500 focus:outline-none w-40">'
            + "<button onclick=\"fpGroupsClear()\" class=\"text-[0.6rem] px-2 py-0.5 rounded bg-lynx-subtle dark:bg-gray-700 text-gray-500 hover:text-primary-500 ml-auto\">Clear</button>"
            + '</div>';
        panelHtml += '<div class="grid gap-x-4 gap-y-2" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">';

        // Categories with their groups
        categories.forEach(cat => {
            const catGroups = (cat.groups || []).filter(g => allGroups.includes(g));
            if (!catGroups.length) return;
            const allSelected = catGroups.every(g => sel.includes(g));
            const someSelected = !allSelected && catGroups.some(g => sel.includes(g));
            const catCb = allSelected ? 'checked' : '';
            const indeterminate = someSelected ? 'data-indeterminate="1"' : '';

            panelHtml += '<div>';
            panelHtml += '<label class="flex items-center gap-1.5 py-0.5 cursor-pointer group">'
                + '<input type="checkbox" ' + catCb + ' ' + indeterminate + ' onchange="fpToggleCategory(\'' + _esc(cat.nome) + '\')" class="fp-cat-cb w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-500 focus:ring-primary-500 cursor-pointer">'
                + '<span class="text-[0.7rem] font-semibold text-gray-700 dark:text-gray-300"><i class="fas fa-folder text-yellow-500 mr-0.5 text-[0.55rem]"></i>' + _esc(cat.nome) + '</span>'
                + '<span class="text-[0.55rem] text-gray-400 ml-auto">' + catGroups.length + '</span>'
                + '</label>';
            panelHtml += '<div class="flex flex-wrap gap-x-1 gap-y-0.5 mt-0.5">';
            catGroups.forEach(g => {
                const checked = sel.includes(g) ? 'checked' : '';
                panelHtml += '<label class="inline-flex items-center gap-0.5 cursor-pointer">'
                    + '<input type="checkbox" value="' + _esc(g) + '" ' + checked + ' onchange="fpToggleGroup(this.value)" class="fp-grp-cb w-3 h-3 rounded border-gray-300 dark:border-gray-600 text-primary-500 focus:ring-primary-500 cursor-pointer">'
                    + '<span class="text-[0.6rem] text-gray-500 dark:text-gray-400 font-mono">' + _esc(g) + '</span>'
                    + '</label>';
            });
            panelHtml += '</div></div>';
        });

        // Uncategorized groups
        if (uncategorized.length) {
            panelHtml += '<div>';
            panelHtml += "<div class=\"text-[0.55rem] text-gray-400 uppercase tracking-wider font-semibold py-0.5\">Other</div>";
            panelHtml += '<div class="flex flex-wrap gap-x-1 gap-y-0.5 mt-0.5">';
            uncategorized.forEach(g => {
                const checked = sel.includes(g) ? 'checked' : '';
                panelHtml += '<label class="inline-flex items-center gap-0.5 cursor-pointer">'
                    + '<input type="checkbox" value="' + _esc(g) + '" ' + checked + ' onchange="fpToggleGroup(this.value)" class="fp-grp-cb w-3 h-3 rounded border-gray-300 dark:border-gray-600 text-primary-500 focus:ring-primary-500 cursor-pointer">'
                    + '<span class="text-[0.6rem] text-gray-500 dark:text-gray-400 font-mono">' + _esc(g) + '</span>'
                    + '</label>';
            });
            panelHtml += '</div></div>';
        }

        panelHtml += '</div>';

        // Button in toolbar
        wrap.innerHTML = '<button onclick="fpToggleGroupPanel()" id="fpGroupBtn" class="text-xs px-3 py-1.5 rounded-lg bg-lynx-subtle dark:bg-[#1A1A1A] text-gray-700 dark:text-gray-300 border border-lynx-divider dark:border-gray-700 hover:border-primary-500 transition-colors whitespace-nowrap">'
            + '<i class="fas fa-car mr-1 text-primary-500"></i>' + _esc(btnLabel)
            + ' <i class="fas fa-chevron-down text-[0.5rem] ml-1 text-gray-400" id="fpGroupBtnChevron"></i></button>';

        // Panel content rendered inline in #fpGroupFilterBar (not a dropdown overlay)
        const bar = document.getElementById('fpGroupFilterBar');
        if (bar) bar.innerHTML = panelHtml;

        // Set indeterminate state on category checkboxes
        document.querySelectorAll('.fp-cat-cb[data-indeterminate="1"]').forEach(cb => { cb.indeterminate = true; });

        // Restore open state and scroll position if panel was open before re-render
        if (wasOpen) {
            const bar2 = document.getElementById('fpGroupFilterBar');
            if (bar2) {
                bar2.classList.remove('hidden');
                const scrollEl = bar2.querySelector('.overflow-y-auto');
                if (scrollEl && savedScroll) scrollEl.scrollTop = savedScroll;
            }
            const chevron = document.getElementById('fpGroupBtnChevron');
            if (chevron) chevron.style.transform = 'rotate(180deg)';
        }
    }

    // Sum only selected groups from a group dict
    function _sumGroups(dict, sel) {
        if (!dict) return 0;
        if (!sel) return Object.values(dict).reduce((a, b) => a + b, 0);
        let s = 0;
        sel.forEach(g => { s += dict[g] || 0; });
        return s;
    }

    // Filter subgroups dict to only selected groups
    function _filterDict(dict, sel) {
        if (!dict) return {};
        if (!sel) return dict;
        const r = {};
        sel.forEach(g => { if (dict[g]) r[g] = dict[g]; });
        return r;
    }

    // Compute the expected minimal fleet at any moment of the day.
    // Simulates intraday events in chronological order to find the lowest point.
    function _computeDayMin(saldo, resOutDetails, resInDetails, fleetInDetails) {
        var events = [];
        // All pickups → balance decreases (includes LT pickups, they are in res_out)
        (resOutDetails || []).forEach(function (d) {
            var t = (d.pick_time || '').substring(11, 16) || '00:00';
            events.push({ time: t, delta: -1, label: d.group + ' pick ' + (d.pick_station || ''), type: 'out' });
        });
        // Non-LT reservation returns → balance increases
        (resInDetails || []).forEach(function (d) {
            if (d.is_lt) return;
            var t = (d.ret_time || '').substring(11, 16) || '23:59';
            events.push({ time: t, delta: +1, label: d.group + ' res-ret ' + (d.ret_station || ''), type: 'in' });
        });
        // Non-LT, non-defleet fleet returns → balance increases
        (fleetInDetails || []).forEach(function (d) {
            if (d.is_lt || d.will_defleet || d.will_exceed_km) return;
            var t = (d.ret_time || '').substring(11, 16) || '23:59';
            events.push({ time: t, delta: +1, label: d.group + ' fleet-ret ' + (d.station || d.plate || ''), type: 'in' });
        });
        if (!events.length) return { min: saldo, time: null, events: [] };
        // Sort by time; at same time, pickups first (pessimistic)
        events.sort(function (a, b) {
            var c = a.time.localeCompare(b.time);
            if (c !== 0) return c;
            return a.delta - b.delta;
        });
        var running = saldo, min = saldo, minTime = null;
        for (var i = 0; i < events.length; i++) {
            running += events[i].delta;
            events[i].running = running;
            if (running < min) { min = running; minTime = events[i].time; }
        }
        return { min: min, time: minTime, events: events };
    }

    // ── Infleet helpers ─────────────────────────────────────────
    function _buildInfleetLookups() {
        FP._infleetParksByPool = {};
        FP._infleetStationType = {};
        const ps = FP.data && FP.data.pool_stations || {};
        Object.keys(ps).forEach(pool => {
            FP._infleetParksByPool[pool] = [];
            (ps[pool] || []).forEach(s => {
                FP._infleetStationType[s.id] = s.tipo || '';
                if (s.tipo === "Parking") FP._infleetParksByPool[pool].push(s.id);
            });
        });
    }

    /**
     * Get infleet count for a given date for a display column.
     * poolKey: display name (could be pool, region, or "📍 StationName")
     * Returns { total, groups: {ACRISS: count} } or null.
     */
    function _getInfleetForDate(poolKey, dateStr) {
        if (!FP.infleet || !FP.infleet.by_park_date) return null;
        const bpd = FP.infleet.by_park_date;
        const parkIds = _getInfleetParkIds(poolKey);
        if (!parkIds || !parkIds.length) return null;
        const sel = FP.selectedGroups;

        let total = 0;
        const groups = {};
        parkIds.forEach(pid => {
            const dateGroups = (bpd[pid] || {})[dateStr];
            if (!dateGroups) return;
            Object.entries(dateGroups).forEach(([g, n]) => {
                if (sel.length && !sel.includes(g)) return;
                groups[g] = (groups[g] || 0) + n;
                total += n;
            });
        });
        return total ? { total, groups } : null;
    }

    /**
     * Get cumulative infleet for a display column (all future dates).
     * Returns { total, groups: {ACRISS: {count, vehicles[]}} } or null.
     */
    function _getInfleetForColumn(poolKey) {
        if (!FP.infleet || !FP.infleet.by_park) return null;
        const bp = FP.infleet.by_park;
        const parkIds = _getInfleetParkIds(poolKey);
        if (!parkIds || !parkIds.length) return null;
        const sel = FP.selectedGroups;

        let total = 0;
        const groups = {};
        parkIds.forEach(pid => {
            const pg = bp[pid];
            if (!pg) return;
            Object.entries(pg).forEach(([g, d]) => {
                if (sel.length && !sel.includes(g)) return;
                const pending = d.pending || 0;
                if (!pending) return;
                if (!groups[g]) groups[g] = { count: 0, vehicles: [] };
                groups[g].count += pending;
                total += pending;
                (d.vehicles || []).forEach(v => {
                    if (!v.in_fleet) groups[g].vehicles.push(v);
                });
            });
        });
        return total ? { total, groups } : null;
    }

    /**
     * Determine park IDs for a given display column name.
     */
    function _getInfleetParkIds(poolKey) {
        // Individual station: "📍 StationName"
        if (poolKey.startsWith('\uD83D\uDCCD ')) {
            // Find station ID by name
            const sName = poolKey.substring(3);
            const ps = FP.data && FP.data.pool_stations || {};
            for (const pool in ps) {
                for (const s of ps[pool]) {
                    if (s.nome === sName && s.tipo === "Parking") return [s.id];
                }
            }
            return null; // Not a park station
        }
        // Pool name → parks in this pool
        if (FP._infleetParksByPool[poolKey] && FP._infleetParksByPool[poolKey].length) {
            return FP._infleetParksByPool[poolKey];
        }
        // Region name → parks in all pools of this region
        const regions = FP.data && FP.data.planning_regions || [];
        const reg = regions.find(r => r.nome === poolKey);
        if (reg) {
            const parks = [];
            (reg.pools || []).forEach(p => {
                (FP._infleetParksByPool[p] || []).forEach(pid => parks.push(pid));
            });
            if (parks.length) return parks;
        }
        return null;
    }

    /**
     * Count overdue infleet vehicles for a pool: arrival < today AND not in_fleet.
     */
    function _getInfleetOverdueCount(poolKey, todayStr, groupFilter) {
        if (!FP.infleet || !FP.infleet.vehicles || !todayStr) return 0;
        const parkIds = _getInfleetParkIds(poolKey);
        if (!parkIds || !parkIds.length) return 0;
        const selSet = groupFilter && groupFilter.length ? new Set(groupFilter) : null;
        return FP.infleet.vehicles.filter(v =>
            !v.in_fleet && parkIds.includes(v.park_id) && v.arrival && v.arrival < todayStr
            && (!selSet || selSet.has(v.group))
        ).length;
    }

    /**
     * Get overdue infleet vehicles for a pool.
     */
    function _getInfleetOverdueVehicles(poolKey, todayStr, groupFilter) {
        if (!FP.infleet || !FP.infleet.vehicles || !todayStr) return [];
        const parkIds = _getInfleetParkIds(poolKey);
        if (!parkIds || !parkIds.length) return [];
        const selSet = groupFilter && groupFilter.length ? new Set(groupFilter) : null;
        return FP.infleet.vehicles.filter(v =>
            !v.in_fleet && parkIds.includes(v.park_id) && v.arrival && v.arrival < todayStr
            && (!selSet || selSet.has(v.group))
        );
    }

    // Apply group filter to a pool — recalculate all totals from group dicts
    function _filterPool(pool, sel) {
        if (!sel || !sel.length) {
            // No group filter — still compute daymin if not already present
            if (pool && pool.rows) {
                pool.rows.forEach(function (row) {
                    if (row.daymin == null) {
                        var dm = _computeDayMin(row.saldo, row.res_out_details, row.res_in_details, row.fleet_in_details);
                        row.daymin = dm.min;
                        row.daymin_time = dm.time;
                        row.daymin_events = dm.events;
                    }
                });
            }
            return pool;
        }
        const selSet = new Set(sel);

        // Occupancy needs a fleet total *scoped to the selected groups* (unlike
        // the header's fleet_total, which intentionally stays pool-wide) — sum
        // it from the per-group breakdown the backend already computed.
        let occTotal = 0, occUnknown = 0, occImpro = 0;
        sel.forEach(g => {
            const og = (pool.occupancy_by_group || {})[g];
            if (og) { occTotal += og.total || 0; occUnknown += og.unknown || 0; occImpro += og.impro || 0; }
        });

        const avail = _sumGroups(pool.groups_available, sel);
        const filtered = {
            fleet_total: pool.fleet_total,  // fleet total doesn't change with group filter
            available_today: avail,
            available_total: avail,
            oficina_count: _sumGroups(pool.groups_oficina, sel),
            groups_oficina: _filterDict(pool.groups_oficina, sel),
            pronto_of_count: _sumGroups(pool.groups_pronto_of || {}, sel),
            groups_pronto_of: _filterDict(pool.groups_pronto_of || {}, sel),
            pronto_of_vehicles: (pool.pronto_of_vehicles || []).filter(v => selSet.has(v.group)),
            groups_available: _filterDict(pool.groups_available, sel),
            avail_vehicles: (pool.avail_vehicles || []).filter(v => selSet.has(v.group)),
            oficina_vehicles: (pool.oficina_vehicles || []).filter(v => selSet.has(v.group)),
            blocked_count: _sumGroups(pool.blocked_groups, sel),
            blocked_groups: _filterDict(pool.blocked_groups, sel),
            blocked_vehicles: (pool.blocked_vehicles || []).filter(v => selSet.has(v.group)),
            no_show_count: _sumGroups(pool.groups_no_show, sel),
            groups_no_show: _filterDict(pool.groups_no_show, sel),
            no_show_details: (pool.no_show_details || []).filter(v => selSet.has(v.group)),
            overdue_ret_count: _sumGroups(pool.groups_overdue_ret, sel),
            groups_overdue_ret: _filterDict(pool.groups_overdue_ret, sel),
            overdue_ret_details: (pool.overdue_ret_details || []).filter(v => selSet.has(v.group)),
            unknown_status_count: occUnknown,
            impro_count: occImpro,
            groups_impro: _filterDict(pool.groups_impro || {}, sel),
            impro_vehicles: (pool.impro_vehicles || []).filter(v => selSet.has(v.group)),
            rows: [],
        };
        filtered.occupancy = _occupancyCalc(
            occTotal, occUnknown, avail, filtered.oficina_count, filtered.pronto_of_count, filtered.blocked_count, occImpro
        );

        // Recalculate running balance from filtered data
        let running = avail;
        let runningFleetTotal = occTotal;  // group-scoped, for the occupancy forecast below
        const runGrp = Object.assign({}, _filterDict(pool.groups_available, sel));
        (pool.rows || []).forEach((row, idx) => {
            const f_in = _sumGroups(row.groups_fleet_in, sel);
            const f_in_lt = _sumGroups(row.groups_fleet_in_lt, sel);
            const r_in = _sumGroups(row.groups_in, sel);
            const r_in_lt = _sumGroups(row.groups_in_lt, sel);
            const r_out = _sumGroups(row.groups_out, sel);
            const r_out_lt = _sumGroups(row.groups_out_lt, sel);
            const defleet = _sumGroups(row.groups_defleet_out, sel);

            // Defleet applied at start of day (first unavailable day)
            running -= defleet;
            runningFleetTotal -= defleet;
            Object.entries(_filterDict(row.groups_defleet_out, sel)).forEach(([g, n]) => { runGrp[g] = (runGrp[g] || 0) - n; });
            const fgSnap = {}; Object.entries(runGrp).forEach(([g, n]) => { if (n > 0) fgSnap[g] = n; });
            const fResOut = (row.res_out_details || []).filter(d => selSet.has(d.group));
            const fResIn = (row.res_in_details || []).filter(d => selSet.has(d.group));
            const fFleetIn = (row.fleet_in_details || []).filter(d => selSet.has(d.group));
            const dm = _computeDayMin(running, fResOut, fResIn, fFleetIn);
            // Today's oficina/OK-OF/blocked/impro held constant — not
            // projectable day by day, but they stay excluded from real
            // occupancy until they actually move.
            const occBase = Math.max(runningFleetTotal - occUnknown, 0);
            const fixedParados = filtered.oficina_count + filtered.pronto_of_count + filtered.blocked_count;
            const occPct = occBase > 0 ? Math.round(((occBase - fixedParados - occImpro - running) / occBase) * 1000) / 10 : null;
            const improPct = occBase > 0 ? Math.round((occImpro / occBase) * 1000) / 10 : null;
            filtered.rows.push({
                date: row.date,
                fleet_total: row.fleet_total,
                available: idx === 0 ? avail : null,
                saldo: running,
                occupancy_pct: occPct,
                impro_pct: improPct,
                daymin: dm.min,
                daymin_time: dm.time,
                daymin_events: dm.events,
                forecast_groups: fgSnap,
                fleet_in: f_in,
                fleet_in_lt: f_in_lt,
                res_in: r_in,
                res_in_lt: r_in_lt,
                res_out: r_out,
                res_out_lt: r_out_lt,
                defleet_out: defleet,
                rented_defleet: _sumGroups(row.groups_rented_defleet || {}, sel),
                groups_out: _filterDict(row.groups_out, sel),
                groups_out_lt: _filterDict(row.groups_out_lt, sel),
                groups_in: _filterDict(row.groups_in, sel),
                groups_in_lt: _filterDict(row.groups_in_lt, sel),
                groups_fleet_in: _filterDict(row.groups_fleet_in, sel),
                groups_fleet_in_lt: _filterDict(row.groups_fleet_in_lt, sel),
                groups_defleet_out: _filterDict(row.groups_defleet_out, sel),
                groups_rented_defleet: _filterDict(row.groups_rented_defleet || {}, sel),
                repair_in: _sumGroups(row.groups_repair_in || {}, sel),
                groups_repair_in: _filterDict(row.groups_repair_in || {}, sel),
                repair_in_details: (row.repair_in_details || []).filter(d => selSet.has(d.group)),
                res_out_details: fResOut,
                res_in_details: fResIn,
                fleet_in_details: fFleetIn,
                defleet_details: (row.defleet_details || []).filter(d => selSet.has(d.group)),
            });
            // Movements during the day update balance for next day
            running = running + f_in + r_in - r_out;
            runningFleetTotal += f_in;
            Object.entries(_filterDict(row.groups_fleet_in, sel)).forEach(([g, n]) => { runGrp[g] = (runGrp[g] || 0) + n; });
            Object.entries(_filterDict(row.groups_in, sel)).forEach(([g, n]) => { runGrp[g] = (runGrp[g] || 0) + n; });
            Object.entries(_filterDict(row.groups_out, sel)).forEach(([g, n]) => { runGrp[g] = (runGrp[g] || 0) - n; });
        });
        // Today's row used the forward-looking approximation like every other
        // day — override with the precise snapshot value (we know today's
        // exact oficina/blocked/OK-OF breakdown, no need to estimate it).
        if (filtered.rows[0]) {
            filtered.rows[0].occupancy_pct = filtered.occupancy.pct;
            filtered.rows[0].impro_pct = filtered.occupancy.impro_pct;
        }
        return filtered;
    }

    // Mirrors server.py's _occupancy_calc — recomputed from already-merged/
    // filtered raw counts rather than averaging percentages (which would be
    // wrong once pools/groups have different fleet sizes).
    function _occupancyCalc(total, unknown, avail, oficina, prontoOf, blocked, impro) {
        impro = impro || 0;
        const base = total - unknown;
        const parados = avail + oficina + prontoOf + blocked;
        const emAndamento = base - parados - impro;
        const pct = base > 0 ? Math.round((emAndamento / base) * 1000) / 10 : null;
        const improPct = base > 0 ? Math.round((impro / base) * 1000) / 10 : null;
        return { total: total, unknown: unknown, base: base, parados: parados, impro: impro,
            impro_pct: improPct, em_andamento: emAndamento, pct: pct };
    }

    // Merge multiple pools into one virtual pool (for region view)
    function _mergePools(poolNames, allPools) {
        const merged = { rows: [], fleet_total: 0, available_today: 0, available_total: 0, oficina_count: 0, groups_oficina: {}, pronto_of_count: 0, groups_pronto_of: {}, pronto_of_vehicles: [], groups_available: {}, avail_vehicles: [], oficina_vehicles: [], blocked_count: 0, blocked_groups: {}, blocked_vehicles: [], no_show_count: 0, groups_no_show: {}, no_show_details: [], overdue_ret_count: 0, groups_overdue_ret: {}, overdue_ret_details: [], unknown_status_count: 0, impro_count: 0, groups_impro: {}, impro_vehicles: [], occupancy_by_group: {} };
        const sources = poolNames.map(p => allPools[p]).filter(Boolean);
        if (!sources.length) return null;

        sources.forEach(pool => {
            merged.fleet_total += pool.fleet_total || 0;
            merged.available_today += pool.available_today || 0;
            merged.available_total += pool.available_total || 0;
            merged.oficina_count += pool.oficina_count || 0;
            merged.pronto_of_count += pool.pronto_of_count || 0;
            merged.unknown_status_count += pool.unknown_status_count || 0;
            merged.impro_count += pool.impro_count || 0;
            Object.entries(pool.groups_impro || {}).forEach(([g, n]) => {
                merged.groups_impro[g] = (merged.groups_impro[g] || 0) + n;
            });
            if (pool.impro_vehicles) merged.impro_vehicles = merged.impro_vehicles.concat(pool.impro_vehicles);
            // Merge occupancy_by_group (needed if a group filter gets applied
            // to this merged pool afterwards — see _filterPool)
            Object.entries(pool.occupancy_by_group || {}).forEach(([g, og]) => {
                const dst = merged.occupancy_by_group[g] || (merged.occupancy_by_group[g] = { total: 0, unknown: 0, impro: 0 });
                dst.total += og.total || 0;
                dst.unknown += og.unknown || 0;
                dst.impro += og.impro || 0;
            });
            // Merge groups_oficina
            Object.entries(pool.groups_oficina || {}).forEach(([g, n]) => {
                merged.groups_oficina[g] = (merged.groups_oficina[g] || 0) + n;
            });
            // Merge groups_pronto_of
            Object.entries(pool.groups_pronto_of || {}).forEach(([g, n]) => {
                merged.groups_pronto_of[g] = (merged.groups_pronto_of[g] || 0) + n;
            });
            // Merge groups_available
            Object.entries(pool.groups_available || {}).forEach(([g, n]) => {
                merged.groups_available[g] = (merged.groups_available[g] || 0) + n;
            });
            // Merge avail_vehicles
            if (pool.avail_vehicles) merged.avail_vehicles = merged.avail_vehicles.concat(pool.avail_vehicles);
            // Merge pronto_of_vehicles
            if (pool.pronto_of_vehicles) merged.pronto_of_vehicles = merged.pronto_of_vehicles.concat(pool.pronto_of_vehicles);
            // Merge oficina_vehicles
            if (pool.oficina_vehicles) merged.oficina_vehicles = merged.oficina_vehicles.concat(pool.oficina_vehicles);
            // Merge blocked
            merged.blocked_count += pool.blocked_count || 0;
            Object.entries(pool.blocked_groups || {}).forEach(([g, n]) => {
                merged.blocked_groups[g] = (merged.blocked_groups[g] || 0) + n;
            });
            if (pool.blocked_vehicles) merged.blocked_vehicles = merged.blocked_vehicles.concat(pool.blocked_vehicles);
            // Merge no-show
            merged.no_show_count += pool.no_show_count || 0;
            Object.entries(pool.groups_no_show || {}).forEach(([g, n]) => {
                merged.groups_no_show[g] = (merged.groups_no_show[g] || 0) + n;
            });
            if (pool.no_show_details) merged.no_show_details = merged.no_show_details.concat(pool.no_show_details);
            // Merge overdue returns
            merged.overdue_ret_count += pool.overdue_ret_count || 0;
            Object.entries(pool.groups_overdue_ret || {}).forEach(([g, n]) => {
                merged.groups_overdue_ret[g] = (merged.groups_overdue_ret[g] || 0) + n;
            });
            if (pool.overdue_ret_details) merged.overdue_ret_details = merged.overdue_ret_details.concat(pool.overdue_ret_details);
        });

        merged.occupancy = _occupancyCalc(
            merged.fleet_total, merged.unknown_status_count, merged.available_today,
            merged.oficina_count, merged.pronto_of_count, merged.blocked_count, merged.impro_count
        );

        // Merge rows by date index
        const rowCount = sources[0].rows ? sources[0].rows.length : 0;
        for (let i = 0; i < rowCount; i++) {
            const row = { date: sources[0].rows[i].date, fleet_total: 0, available: null, saldo: 0,
                res_in: 0, res_out: 0, res_out_lt: 0, res_in_lt: 0, fleet_in: 0, fleet_in_lt: 0, defleet_out: 0, rented_defleet: 0, repair_in: 0,
                groups_out: {}, groups_out_lt: {}, groups_in: {}, groups_in_lt: {}, groups_fleet_in: {}, groups_fleet_in_lt: {}, groups_defleet_out: {}, groups_rented_defleet: {}, groups_repair_in: {},
                res_out_details: [], res_in_details: [], fleet_in_details: [], defleet_details: [], repair_in_details: [], forecast_groups: {} };
            sources.forEach(pool => {
                const r = (pool.rows || [])[i] || {};
                row.fleet_total += r.fleet_total || 0;
                if (r.available != null) row.available = (row.available || 0) + r.available;
                row.saldo += r.saldo || 0;
                row.res_in += r.res_in || 0;
                row.res_out += r.res_out || 0;
                row.res_out_lt += r.res_out_lt || 0;
                row.res_in_lt += r.res_in_lt || 0;
                row.fleet_in += r.fleet_in || 0;
                row.fleet_in_lt += r.fleet_in_lt || 0;
                row.defleet_out += r.defleet_out || 0;
                row.rented_defleet += r.rented_defleet || 0;
                row.repair_in += r.repair_in || 0;
                // Merge group dicts
                ['groups_out', 'groups_out_lt', 'groups_in', 'groups_in_lt', 'groups_fleet_in', 'groups_fleet_in_lt', 'groups_defleet_out', 'groups_rented_defleet', 'groups_repair_in'].forEach(key => {
                    Object.entries(r[key] || {}).forEach(([g, n]) => { row[key][g] = (row[key][g] || 0) + n; });
                });
                // Merge forecast_groups
                Object.entries(r.forecast_groups || {}).forEach(([g, n]) => { row.forecast_groups[g] = (row.forecast_groups[g] || 0) + n; });
                // Merge detail lists
                if (r.res_out_details) row.res_out_details = row.res_out_details.concat(r.res_out_details);
                if (r.res_in_details) row.res_in_details = row.res_in_details.concat(r.res_in_details);
                if (r.fleet_in_details) row.fleet_in_details = row.fleet_in_details.concat(r.fleet_in_details);
                if (r.defleet_details) row.defleet_details = row.defleet_details.concat(r.defleet_details);
                if (r.repair_in_details) row.repair_in_details = row.repair_in_details.concat(r.repair_in_details);
            });
            const dm = _computeDayMin(row.saldo, row.res_out_details, row.res_in_details, row.fleet_in_details);
            row.daymin = dm.min;
            row.daymin_time = dm.time;
            row.daymin_events = dm.events;
            // Same forecast approximation as the backend: today's oficina/
            // OK-OF/blocked/impro held constant, only saldo actually moves day to day.
            const occBase = Math.max(row.fleet_total - merged.unknown_status_count, 0);
            const fixedParados = merged.oficina_count + merged.pronto_of_count + merged.blocked_count;
            row.occupancy_pct = occBase > 0 ? Math.round(((occBase - fixedParados - merged.impro_count - row.saldo) / occBase) * 1000) / 10 : null;
            row.impro_pct = occBase > 0 ? Math.round((merged.impro_count / occBase) * 1000) / 10 : null;
            merged.rows.push(row);
        }
        // Today's row used the forward-looking approximation like every other
        // day — override with the precise snapshot value.
        if (merged.rows[0]) {
            merged.rows[0].occupancy_pct = merged.occupancy.pct;
            merged.rows[0].impro_pct = merged.occupancy.impro_pct;
        }
        return merged;
    }

    function _renderTable() {
        const wrap = document.getElementById('fpContent');
        if (!wrap) return;
        // Preserve scroll across re-renders (filter changes, etc.)
        const oldWrap = wrap.querySelector('.fp-table-wrap');
        let _savedScrollTop = 0;
        let _savedScrollLeft = 0;
        try {
            if (oldWrap) {
                _savedScrollTop = oldWrap.scrollTop || 0;
                _savedScrollLeft = oldWrap.scrollLeft || 0;
            }
        } catch (_) { /* ignore */ }
        if (!FP.data || !FP.data.pools) {
            wrap.innerHTML = "<div class=\"text-center text-gray-400 py-10\">No data available. Configure pools under Settings → Planning Pools.</div>";
            return;
        }

        const { names: displayNames, pools: displayPools } = _getDisplayData();
        FP._lastDisplayNames = displayNames;
        FP._lastDisplayPools = displayPools;

        if (displayNames.length === 0) {
            const msg = FP.nationalView ? "No mainland pools available." : FP.regionView ? "Select at least one region to display." : "Select at least one pool to display.";
            wrap.innerHTML = '<div class="text-center text-gray-400 py-10">' + msg + '</div>';
            return;
        }

        // Get date range from first column
        const firstPool = displayPools[displayNames[0]];
        const dates = (firstPool.rows || []).map(r => r.date);
        if (!dates.length) {
            wrap.innerHTML = "<div class=\"text-center text-gray-400 py-10\">No dates available.</div>";
            return;
        }

        // Build side-by-side table
        // Determine which columns can have infleet (parks, pools with parks, regions)
        const hasInfleet = {};
        let anyInfleet = false;
        displayNames.forEach(pname => {
            const pids = _getInfleetParkIds(pname);
            hasInfleet[pname] = !!(pids && pids.length);
            if (hasInfleet[pname]) anyInfleet = true;
        });
        // Tx Ocup / Tx Impro only make sense as an aggregate view — hide them
        // when looking at individual pools/stations one at a time.
        const showOccupancy = FP.regionView || FP.nationalView;
        const colsPerPool = (anyInfleet ? 8 : 7) + (showOccupancy ? 2 : 0); // +1 Infleet, +1 OK OF, +[Tx Ocup, Tx Impro]
        const totalCols = 1 + displayNames.length * colsPerPool;
        const icon = FP.nationalView ? 'fa-flag' : FP.regionView ? 'fa-globe-europe' : 'fa-map-marker-alt';

        let html = '<div class="lynx-card fp-table-wrap overflow-auto" style="max-height:75vh">';
        html += '<table class="fp-table w-full text-xs">';

        // Header row 1: Pool names spanning columns
        html += '<thead>';
        html += '<tr>';
        html += "<th rowspan=\"2\" class=\"text-left px-3 py-2 sticky left-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-20 border-b border-lynx-divider dark:border-gray-700 text-[0.6rem] text-gray-400 uppercase tracking-wider min-w-[85px]\">Date</th>";
        displayNames.forEach((pname, pi) => {
            const pool = displayPools[pname];
            const borderL = pi > 0 ? ' border-l-2 border-lynx-divider dark:border-gray-600' : '';
            const oficina = pool.oficina_count || 0;
            const oficinaBadge = oficina > 0
                ? " <span class=\"inline-flex items-center gap-0.5 ml-1 text-[0.55rem] font-normal text-orange-400 cursor-pointer hover:underline\" title=\"Click to view workshop vehicles\" onclick=\"fpShowOficina(" + pi + ')"><i class="fas fa-wrench text-[0.5rem]"></i>' + oficina + '</span>'
                : '';
            const blocked = pool.blocked_count || 0;
            const blockedBadge = blocked > 0
                ? " <span class=\"inline-flex items-center gap-0.5 ml-1 text-[0.55rem] font-normal text-red-400 cursor-pointer hover:underline\" title=\"On hold / mileage limit / defleet — click to view\" onclick=\"fpShowBlocked(" + pi + ')"><i class="fas fa-ban text-[0.5rem]"></i>' + blocked + '</span>'
                : '';
            const noShow = pool.no_show_count || 0;
            const noShowBadge = noShow > 0
                ? " <span class=\"inline-flex items-center gap-0.5 ml-1 text-[0.55rem] font-normal text-yellow-500 cursor-pointer hover:underline\" title=\"No-shows: pickups overdue by more than one hour — click to view\" onclick=\"fpShowNoShow(" + pi + ')"><i class="fas fa-user-slash text-[0.5rem]"></i>' + noShow + '</span>'
                : '';
            const overdueRet = pool.overdue_ret_count || 0;
            const overdueRetBadge = overdueRet > 0
                ? ' <span class="inline-flex items-center gap-0.5 ml-1 text-[0.55rem] font-normal text-red-500 cursor-pointer hover:underline" title="Retomas em atraso: ' + overdueRet + " vehicles past their expected return — click to view\" onclick=\"fpShowOverdueRet(" + pi + ')"><i class="fas fa-clock text-[0.5rem]"></i>' + overdueRet + '</span>'
                : '';
            // Retomas em Oficina: reservations / fleet returning to repair centres
            const repairRetTotal = (pool.rows || []).reduce((s, r) => s + (r.repair_in || 0), 0);
            const repairRetBadge = repairRetTotal > 0
                ? " <span class=\"inline-flex items-center gap-0.5 ml-1 text-[0.55rem] font-normal text-pink-400 cursor-pointer hover:underline\" title=\"Workshop Returns: " + repairRetTotal + " during the period — click to view\" onclick=\"fpShowRepairRetomas(" + pi + ')"><i class="fas fa-tools text-[0.5rem]"></i>' + repairRetTotal + '</span>'
                : '';
            // OK OF: vehicles ready at repair center, waiting to be collected
            const prontoOf = pool.pronto_of_count || 0;
            const prontoOfBadge = prontoOf > 0
                ? ' <span class="inline-flex items-center gap-0.5 ml-1 text-[0.55rem] font-normal text-violet-400 cursor-pointer hover:underline" title="OK OF: ' + prontoOf + " workshop-ready vehicle(s) awaiting collection — click to view\" onclick=\"fpShowProntoOf(" + pi + ')"><i class="fas fa-check-circle text-[0.5rem]"></i>' + prontoOf + '</span>'
                : '';
            // Infleet overdue: only for parks/pools/regions
            const todayStr = dates[0] || '';
            const infleetOverdue = hasInfleet[pname] ? _getInfleetOverdueCount(pname, todayStr, FP.selectedGroups) : 0;
            const infleetOverdueBadge = infleetOverdue > 0
                ? ' <span class="inline-flex items-center gap-0.5 ml-1 text-[0.55rem] font-normal text-emerald-400 cursor-pointer hover:underline" title="Infleet em atraso: ' + infleetOverdue + " vehicles past their scheduled arrival — click to view\" onclick=\"fpShowInfleetOverdue(" + pi + ')"><i class="fas fa-truck-loading text-[0.5rem]"></i>' + infleetOverdue + '</span>'
                : '';
            // Impro: rented under a non-customer rate code (courtesy, internal
            // movement, workshop-bound, support, trailer) — see Tx Impro column
            const impro = pool.impro_count || 0;
            const improBadge = impro > 0
                ? " <span class=\"inline-flex items-center gap-0.5 ml-1 text-[0.55rem] font-normal text-fuchsia-400 cursor-pointer hover:underline\" title=\"Non-Revenue Use: " + impro + " vehicle(s) on non-customer rate codes — click to view\" onclick=\"fpShowImpro(" + pi + ')"><i class="fas fa-truck-ramp-box text-[0.5rem]"></i>' + impro + '</span>'
                : '';
            html += '<th colspan="' + colsPerPool + '" class="fp-pool-th text-center px-2 py-2 bg-lynx-subtle dark:bg-[#0A0A0A] border-b border-lynx-divider dark:border-gray-700 text-xs font-bold lynx-text-primary' + borderL + '">'
                + '<i class="fas ' + icon + ' text-primary-500 mr-1"></i>' + _esc(pname)
                + ' <span class="text-[0.55rem] font-normal text-gray-400">(' + (pool.fleet_total || 0) + " veh. · " + (pool.available_today || 0) + ' avail.)</span>'
                + oficinaBadge
                + prontoOfBadge
                + blockedBadge
                + noShowBadge
                + overdueRetBadge
                + repairRetBadge
                + infleetOverdueBadge
                + improBadge
                + '</th>';
        });
        html += '</tr>';

        // Header row 2: Sub-columns per pool
        html += '<tr class="text-[0.55rem] text-gray-400 uppercase tracking-wider">';
        const subThBase = 'text-center px-1.5 py-1.5 bg-lynx-subtle dark:bg-[#0A0A0A] border-b border-lynx-divider dark:border-gray-700';
        displayNames.forEach((pname, pi) => {
            const borderL = pi > 0 ? ' border-l-2 border-lynx-divider dark:border-gray-600' : '';
            if (anyInfleet) {
                if (hasInfleet[pname]) {
                    html += '<th class="' + subThBase + ' text-emerald-500 min-w-[35px]' + borderL + "\" title=\"Scheduled fleet additions (incoming new vehicles)\">Infleets</th>";
                } else {
                    html += '<th class="' + subThBase + borderL + '"></th>';
                }
                html += '<th class="' + subThBase + " text-violet-400 min-w-[35px]\" title=\"Workshop-ready vehicles awaiting collection\">OK<br>OF</th>";
                html += '<th class="' + subThBase + " text-green-500 min-w-[40px]\">Balance</th>";
            } else {
                html += '<th class="' + subThBase + ' text-violet-400 min-w-[35px]' + borderL + "\" title=\"Workshop-ready vehicles awaiting collection\">OK<br>OF</th>";
                html += '<th class="' + subThBase + " text-green-500 min-w-[40px]\">Balance</th>";
            }
            html += '<th class="' + subThBase + " text-red-500 min-w-[35px]\" title=\"Departures: reservations with pickup on this date\">RES</th>";
            html += '<th class="' + subThBase + " text-blue-500 min-w-[35px]\" title=\"Returns: current rentals plus future reservations\">DROP</th>";
            html += '<th class="' + subThBase + " text-cyan-500 min-w-[35px]\" title=\"Expected intraday minimum, accounting for pickup and return times\">Min</th>";
            html += '<th class="' + subThBase + " text-orange-400 min-w-[30px]\" title=\"Long-term returns: informational, excluded from available balance\">LT</th>";
            html += '<th class="' + subThBase + " text-gray-500 min-w-[30px]\" title=\"Fleet exits (defleet / contract return)\"><i class=\"fas fa-sign-out-alt\"></i></th>";
            if (showOccupancy) {
                html += '<th class="' + subThBase + " text-indigo-400 min-w-[40px]\" title=\"Occupancy: rented fleet share, excluding unknown statuses and non-customer movements. Available, workshop and held vehicles are idle. Future dates are estimates.\">Tx<br>Ocup</th>";
                html += '<th class="' + subThBase + " text-fuchsia-400 min-w-[40px]\" title=\"Non-revenue use: fleet share on non-customer rate codes, such as courtesy, internal transfers and workshop support. Excluded from customer occupancy. Service vehicles (PTCCD) are excluded.\">Tx<br>Impro</th>";
            }
        });
        html += '</tr></thead>';

        // Data rows
        html += '<tbody>';
        dates.forEach((dt, idx) => {
            const weekend = _isWeekend(dt);
            const isToday = idx === 0;
            const weekendCls = weekend ? 'fp-row-weekend' : '';
            const todayCls = isToday ? 'fp-row-today font-semibold' : '';

            let hasNeg = false;
            let hasDmNeg = false;
            displayNames.forEach(pname => {
                const row = (displayPools[pname].rows || [])[idx];
                if (row && row.saldo < 0) hasNeg = true;
                if (row && row.daymin != null && row.daymin < 0) hasDmNeg = true;
            });
            const negBg = hasNeg ? 'bg-red-500/5' : hasDmNeg ? 'bg-orange-500/5' : '';

            html += '<tr class="fp-row border-b border-gray-50 dark:border-gray-800/50 ' + (negBg || weekendCls) + ' ' + todayCls + ' hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
            html += '<td class="px-3 py-1.5 sticky left-0 bg-inherit whitespace-nowrap z-10 fp-date-cell ' + (weekend ? 'text-blue-400' : 'text-gray-600 dark:text-gray-300') + '">' + _fmtDate(dt) + '</td>';

            displayNames.forEach((pname, pi) => {
                const row = (displayPools[pname].rows || [])[idx] || {};
                const saldo = row.saldo != null ? row.saldo : '—';
                const saldoClass = saldo < 0 ? 'text-red-500 font-bold' : saldo === 0 ? 'text-orange-400 font-semibold' : 'text-green-600 dark:text-green-400';
                const borderL = pi > 0 ? ' border-l-2 border-lynx-divider dark:border-gray-700' : '';

                // IN = fleet returns + reservation returns, excluding defleet (they exit same day)
                const totalIn = (row.fleet_in || 0) + (row.res_in || 0) - (row.defleet_out || 0);
                const inParts = [];
                const cleanFleetIn = (row.fleet_in || 0) - (row.defleet_out || 0);
                if (cleanFleetIn > 0) inParts.push("Contracts: " + cleanFleetIn);
                if (row.res_in) inParts.push("Reservations: " + row.res_in);
                if (row.repair_in) inParts.push("→Workshop (excluded): " + row.repair_in);
                // Add group breakdowns (subtract defleet groups from fleet returns)
                const gFleetClean = {};
                Object.entries(row.groups_fleet_in || {}).forEach(([g, n]) => {
                    const net = n - ((row.groups_defleet_out || {})[g] || 0);
                    if (net > 0) gFleetClean[g] = net;
                });
                const fleetGrp = _groupParts(gFleetClean);
                const resGrp = _groupParts(row.groups_in);
                if (fleetGrp) inParts.push("Groups (fleet): " + fleetGrp);
                if (resGrp) inParts.push("Groups (reservations): " + resGrp);
                const inTip = inParts.length ? ' title="' + _esc(inParts.join('\n')) + '"' : '';

                const outTip = _groupTip(row.groups_out);

                // LT = fleet LT returns + reservation LT returns (informational only)
                const totalLt = (row.fleet_in_lt || 0) + (row.res_in_lt || 0);
                const ltParts = [];
                if (row.fleet_in_lt) ltParts.push("Contracts LT (retoma): " + row.fleet_in_lt);
                if (row.res_in_lt) ltParts.push("Reservations LT (retoma): " + row.res_in_lt);
                const ltGrpF = _groupParts(row.groups_fleet_in_lt);
                const ltGrpR = _groupParts(row.groups_in_lt);
                if (ltGrpF) ltParts.push("Groups (fleet): " + ltGrpF);
                if (ltGrpR) ltParts.push("Groups (reservations): " + ltGrpR);
                const ltTip = ltParts.length ? ' title="' + _esc(ltParts.join('\n')) + '"' : '';

                const defleet = (row.defleet_out || 0) + (row.rented_defleet || 0);

                // DayMin — expected minimal fleet at a moment of the day
                const dm = row.daymin != null ? row.daymin : saldo;
                const dmClass = dm < 0 ? 'text-red-500 font-bold' : dm === 0 ? 'text-orange-400 font-semibold' : 'text-cyan-500';
                const dmTip = row.daymin_time ? "Min. at " + row.daymin_time : "No intraday movements";
                const dmWarn = (dm < saldo) ? ' bg-orange-500/10' : '';

                // Infleet cell (before saldo) — only for parks/pools/regions
                if (anyInfleet) {
                    if (hasInfleet[pname]) {
                        const inflData = _getInfleetForDate(pname, dt);
                        const inflCount = inflData ? inflData.total : 0;
                        const inflGrp = inflData && inflData.groups ? _groupParts(inflData.groups) : '';
                        const inflTip = inflCount > 0 ? ' title="Infleet previsto: ' + inflCount + (inflGrp ? '\n' + _esc(inflGrp) : '') + '"' : " title=\"No fleet additions scheduled\"";
                        if (inflCount > 0) {
                            html += '<td class="text-center px-1.5 py-1 text-emerald-500 font-semibold cursor-pointer hover:underline' + borderL + '" onclick="fpShowInfleet(' + pi + ',' + idx + ')"' + inflTip + '>' + inflCount + '</td>';
                        } else {
                            html += '<td class="text-center px-1.5 py-1 text-emerald-500/30' + borderL + '"' + inflTip + '></td>';
                        }
                    } else {
                        html += '<td class="text-center px-1.5 py-1' + borderL + '"></td>';
                    }
                }

                // OK OF cell — only on first date (static snapshot, not per-day flow)
                const _poolData = displayPools[pname];
                const prontoOfCount = idx === 0 ? (_poolData.pronto_of_count || 0) : 0;
                const prontoOfGrp = idx === 0 ? _groupParts(_poolData.groups_pronto_of || {}) : '';
                if (prontoOfCount > 0) {
                    html += '<td class="text-center px-1.5 py-1 text-violet-400 font-semibold cursor-pointer hover:underline' + (anyInfleet ? '' : borderL) + '" onclick="fpShowProntoOf(' + pi + ")\" title=\"Workshop-ready vehicles awaiting collection" + (prontoOfGrp ? '\n' + _esc(prontoOfGrp) : '') + '">' + prontoOfCount + '</td>';
                } else {
                    html += '<td class="text-center px-1.5 py-1 text-violet-400/20' + (anyInfleet ? '' : borderL) + '"></td>';
                }

                html += '<td class="text-center px-1.5 py-1 ' + saldoClass + ' cursor-pointer hover:underline" onclick="fpShowVehicles(' + pi + ',' + idx + ")\" title=\"Click to view balance details\">" + saldo + '</td>';
                if (row.res_out) {
                    html += '<td class="text-center px-1.5 py-1 text-red-400 cursor-pointer hover:underline" onclick="fpShowReservations(' + pi + ',' + idx + ',\'out\')"' + outTip + '>' + row.res_out + '</td>';
                } else {
                    html += '<td class="text-center px-1.5 py-1 text-red-400"' + outTip + '></td>';
                }
                if (totalIn) {
                    html += '<td class="text-center px-1.5 py-1 text-blue-400 cursor-pointer hover:underline" onclick="fpShowReservations(' + pi + ',' + idx + ',\'in\')"' + inTip + '>' + totalIn + '</td>';
                } else {
                    html += '<td class="text-center px-1.5 py-1 text-blue-400"' + inTip + '></td>';
                }
                html += '<td class="text-center px-1.5 py-1 ' + dmClass + dmWarn + ' cursor-pointer hover:underline" onclick="fpShowDayMin(' + pi + ',' + idx + ')" title="' + _esc(dmTip) + '">' + dm + '</td>';
                if (totalLt) {
                    html += '<td class="text-center px-1.5 py-1 text-orange-300 italic cursor-pointer hover:underline" onclick="fpShowLtReturns(' + pi + ',' + idx + ')"' + ltTip + '>' + totalLt + '</td>';
                } else {
                    html += '<td class="text-center px-1.5 py-1 text-orange-300 italic"' + ltTip + '></td>';
                }
                if (defleet) {
                    html += '<td class="text-center px-1.5 py-1 text-gray-500 cursor-pointer hover:underline" onclick="fpShowDefleet(' + pi + ',' + idx + ')">' + defleet + '</td>';
                } else {
                    html += '<td class="text-center px-1.5 py-1 text-gray-500"></td>';
                }

                if (showOccupancy) {
                    const occPct = row.occupancy_pct;
                    const occClass = occPct == null ? 'text-gray-400' : occPct < 60 ? 'text-red-500 font-bold' : occPct < 75 ? 'text-orange-400 font-semibold' : 'text-indigo-400';
                    const occTitle = idx === 0 ? "Current occupancy (exact)" : "Estimated occupancy; workshop, hold and non-revenue counts stay constant";
                    html += '<td class="text-center px-1.5 py-1 ' + occClass + '" title="' + occTitle + '">' + (occPct == null ? '—' : occPct + '%') + '</td>';

                    const improPct = row.impro_pct;
                    const improClass = improPct == null ? 'text-gray-400' : improPct >= 10 ? 'text-fuchsia-500 font-bold' : 'text-fuchsia-400';
                    const improTitle = idx === 0 ? "Current non-revenue use (exact)" : "Estimated non-revenue use; current count stays constant";
                    html += '<td class="text-center px-1.5 py-1 ' + improClass + '" title="' + improTitle + '">' + (improPct == null ? '—' : improPct + '%') + '</td>';
                }
            });

            html += '</tr>';
        });

        html += '</tbody></table></div>';
        wrap.innerHTML = html;

        // Restore inner scroll position (window scroll is left untouched)
        try {
            const newWrap = wrap.querySelector('.fp-table-wrap');
            if (newWrap) {
                if (_savedScrollTop)  newWrap.scrollTop  = _savedScrollTop;
                if (_savedScrollLeft) newWrap.scrollLeft = _savedScrollLeft;
            }
        } catch (_) { /* ignore */ }

        // Measure pool-header row height so the sub-header row can stick right below it
        try {
            const tableEl = wrap.querySelector('.fp-table');
            if (tableEl) {
                const r1 = tableEl.querySelector('thead tr:first-child');
                if (r1) {
                    const h = Math.max(1, r1.getBoundingClientRect().height || r1.offsetHeight || 56);
                    tableEl.style.setProperty('--fp-row1-h', h + 'px');
                }
            }
        } catch (_) { /* ignore */ }
    }

    function _groupTip(groups) {
        if (!groups || Object.keys(groups).length === 0) return '';
        const parts = Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g, n]) => g + ': ' + n);
        return ' title="' + _esc(parts.join(', ')) + '"';
    }

    function _groupParts(groups) {
        if (!groups || Object.keys(groups).length === 0) return '';
        return Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g, n]) => g + ': ' + n).join(', ');
    }

    // ── Sortable modal tables ──
    // Show modal and make all tables inside it sortable by clicking column headers
    function _showModal(modal) {
        modal.classList.remove('hidden');
        const body = document.getElementById('fpVehicleModalBody');
        if (!body) return;
        body.querySelectorAll('table').forEach(function(table) {
            const headers = table.querySelectorAll('thead th');
            headers.forEach(function(th, colIdx) {
                th.style.cursor = 'pointer';
                th.style.userSelect = 'none';
                // Remove any existing sort indicator
                th.addEventListener('click', function() {
                    const tbody = table.querySelector('tbody');
                    if (!tbody) return;
                    const rows = Array.from(tbody.querySelectorAll('tr'));
                    // Determine sort direction
                    const currentDir = th.getAttribute('data-sort-dir');
                    const newDir = currentDir === 'asc' ? 'desc' : 'asc';
                    // Reset all headers in this table
                    headers.forEach(function(h) {
                        h.removeAttribute('data-sort-dir');
                        const ind = h.querySelector('.sort-indicator');
                        if (ind) ind.remove();
                    });
                    th.setAttribute('data-sort-dir', newDir);
                    // Add indicator
                    const indicator = document.createElement('span');
                    indicator.className = 'sort-indicator ml-0.5 text-primary-500';
                    indicator.textContent = newDir === 'asc' ? ' ▲' : ' ▼';
                    th.appendChild(indicator);
                    // Sort rows
                    rows.sort(function(a, b) {
                        const cellA = a.children[colIdx];
                        const cellB = b.children[colIdx];
                        if (!cellA || !cellB) return 0;
                        let valA = cellA.textContent.trim();
                        let valB = cellB.textContent.trim();
                        // Try numeric comparison (handle pt-PT locale: 1.234 or 1 234)
                        const numA = parseFloat(valA.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
                        const numB = parseFloat(valB.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
                        let cmp;
                        if (!isNaN(numA) && !isNaN(numB)) {
                            cmp = numA - numB;
                        } else {
                            cmp = valA.localeCompare(valB, 'pt');
                        }
                        return newDir === 'asc' ? cmp : -cmp;
                    });
                    rows.forEach(function(row) { tbody.appendChild(row); });
                });
            });
        });
    }

    // Status label map
    const _statusLabels = {
        1: "Available", 2: "Available (park)", 3: "Reserved", 4: 'Infleeted',
        7: 'Loading', 9: 'Ready pickup', 10: 'Arrived', 11: 'Check-in'
    };

    // Engine type labels
    const _engineLabels = { 'PETROL': "Petrol", 'DIESEL': 'Diesel', 'ELECTRIC': "Electric", 'HYBRID': "Hybrid", 'PLUGIN_HYBRID': "Plug-in Hybrid" };

    // Fuel / charge display
    function _fuelBar(level, engine, chargePct) {
        if (level == null && chargePct == null) return '';
        const isElectric = engine === 'ELECTRIC' || engine === 'PLUGIN_HYBRID';
        if (isElectric) {
            const pct = chargePct != null ? chargePct : Math.round((level / 8) * 100);
            const color = pct >= 50 ? 'text-green-500' : pct >= 25 ? 'text-yellow-500' : 'text-red-500';
            return '<span class="font-semibold ' + color + "\" title=\"Load: " + pct + '%"><i class="fas fa-bolt text-[0.55rem] mr-0.5"></i>' + pct + '%</span>';
        }
        const lv = level != null ? level : 0;
        const color = lv >= 4 ? 'text-green-500' : lv >= 2 ? 'text-yellow-500' : 'text-red-500';
        return '<span class="font-semibold ' + color + "\" title=\"Fuel: " + lv + '/8"><i class="fas fa-gas-pump text-[0.55rem] mr-0.5"></i>' + lv + '/8</span>';
    }

    // Calculate remaining days from defleet date
    function _remainDays(defleetStr) {
        if (!defleetStr) return '';
        try {
            const today = new Date(); today.setHours(0,0,0,0);
            const d = new Date(defleetStr + 'T00:00:00'); d.setHours(0,0,0,0);
            const diff = Math.round((d - today) / 86400000);
            return diff;
        } catch(e) { return ''; }
    }

    function _tipoBadge(tipo) {
        if (!tipo) return '<span class="text-gray-400 text-[0.65rem]">—</span>';
        if (tipo === 'BB') return '<span class="inline-block px-1.5 py-0.5 rounded text-[0.6rem] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">BB</span>';
        if (tipo === 'FP') return '<span class="inline-block px-1.5 py-0.5 rounded text-[0.6rem] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">FP</span>';
        return '<span class="text-gray-400 text-[0.65rem]">' + _esc(tipo) + '</span>';
    }

    // Show saldo detail modal — Day 0: real vehicles; Day 1+: group forecast
    window.fpShowVehicles = function (poolIdx, dayIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const row = (pool.rows || [])[dayIdx];
        if (!row) return;
        const isToday = dayIdx === 0;
        const dateLabel = row.date ? _fmtDate(row.date) : '';

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        // ═══════════ FUTURE DAY → GROUP FORECAST ═══════════
        if (!isToday) {
            const fg = row.forecast_groups || {};
            const totalForecast = Object.values(fg).reduce((s, n) => s + n, 0);
            title.textContent = poolKey + " — Group Forecast — " + dateLabel + ' [' + totalForecast + ']';

            const categories = (FP.data && FP.data.acriss_categories) || [];
            const categorized = new Set();
            let html = '';

            // Summary bar
            html += '<div class="flex items-center gap-3 mb-4 pb-3 border-b border-lynx-divider dark:border-gray-700">';
            html += '<div class="text-lg font-bold text-emerald-400">' + totalForecast + '</div>';
            html += "<div class=\"text-xs text-gray-400\">projected vehicles</div>";
            html += '</div>';

            // Build category sections
            categories.forEach(cat => {
                const catName = cat.nome || '';
                const catGroups = cat.groups || [];
                const items = [];
                catGroups.forEach(g => {
                    categorized.add(g);
                    const cnt = fg[g] || 0;
                    if (cnt > 0) items.push({ group: g, count: cnt });
                });
                if (!items.length) return;
                items.sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));
                const catTotal = items.reduce((s, i) => s + i.count, 0);

                html += '<div class="mb-3">';
                html += '<div class="flex items-center gap-2 mb-1.5">';
                html += '<i class="fas fa-folder text-yellow-500 text-[0.6rem]"></i>';
                html += '<span class="text-[0.7rem] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">' + _esc(catName) + '</span>';
                html += '<span class="text-xs font-bold text-emerald-400 ml-auto">' + catTotal + '</span>';
                html += '</div>';
                html += '<div class="flex flex-wrap gap-1.5 ml-4">';
                items.forEach(i => {
                    html += '<div class="flex items-center gap-1 px-2 py-1 rounded-md bg-lynx-subtle dark:bg-gray-800/60 border border-lynx-divider dark:border-gray-700">';
                    html += '<span class="text-[0.65rem] font-mono font-semibold text-primary-500">' + _esc(i.group) + '</span>';
                    html += '<span class="text-[0.7rem] font-bold text-gray-700 dark:text-gray-200">' + i.count + '</span>';
                    html += '</div>';
                });
                html += '</div></div>';
            });

            // Uncategorized groups ("Outros")
            const otherItems = [];
            Object.entries(fg).forEach(([g, cnt]) => {
                if (!categorized.has(g) && cnt > 0) otherItems.push({ group: g, count: cnt });
            });
            if (otherItems.length) {
                otherItems.sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));
                const otherTotal = otherItems.reduce((s, i) => s + i.count, 0);
                html += '<div class="mb-3 mt-2 pt-2 border-t border-lynx-divider dark:border-gray-700">';
                html += '<div class="flex items-center gap-2 mb-1.5">';
                html += "<span class=\"text-[0.7rem] font-bold text-gray-500 uppercase tracking-wider\">Other</span>";
                html += '<span class="text-xs font-bold text-emerald-400 ml-auto">' + otherTotal + '</span>';
                html += '</div>';
                html += '<div class="flex flex-wrap gap-1.5 ml-4">';
                otherItems.forEach(i => {
                    html += '<div class="flex items-center gap-1 px-2 py-1 rounded-md bg-lynx-subtle dark:bg-gray-800/60 border border-lynx-divider dark:border-gray-700">';
                    html += '<span class="text-[0.65rem] font-mono font-semibold text-primary-500">' + _esc(i.group) + '</span>';
                    html += '<span class="text-[0.7rem] font-bold text-gray-700 dark:text-gray-200">' + i.count + '</span>';
                    html += '</div>';
                });
                html += '</div></div>';
            }

            // Day movements summary
            const dayIn = (row.fleet_in || 0) + (row.res_in || 0) - (row.defleet_out || 0);
            const dayOut = row.res_out || 0;
            const dayDefleet = (row.defleet_out || 0) + (row.rented_defleet || 0);
            const dayRepair = row.repair_in || 0;
            if (dayIn || dayOut || dayDefleet || dayRepair) {
                html += '<div class="mt-4 pt-3 border-t border-lynx-divider dark:border-gray-700">';
                html += "<div class=\"text-[0.6rem] font-bold text-gray-400 uppercase tracking-wider mb-2\">Daily Movements</div>";
                html += '<div class="flex flex-wrap gap-3 text-xs">';
                if (dayIn) {
                    html += "<div class=\"flex items-center gap-1\"><i class=\"fas fa-arrow-down text-green-400\"></i><span class=\"text-gray-300\">Arrivals:</span><span class=\"font-bold text-green-400\">" + dayIn + '</span>';
                    // Show groups entering (subtract defleet from fleet groups)
                    const gFleetCleanM = {};
                    Object.entries(row.groups_fleet_in || {}).forEach(([g, n]) => {
                        const net = n - ((row.groups_defleet_out || {})[g] || 0);
                        if (net > 0) gFleetCleanM[g] = net;
                    });
                    const gIn = Object.assign({}, gFleetCleanM);
                    Object.entries(row.groups_in || {}).forEach(([g, n]) => { gIn[g] = (gIn[g] || 0) + n; });
                    const inParts = Object.entries(gIn).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
                    if (inParts.length) html += ' <span class="text-gray-500 font-mono text-[0.6rem]">(' + inParts.map(([g, n]) => g + ':' + n).join(', ') + ')</span>';
                    html += '</div>';
                }
                if (dayOut) {
                    html += "<div class=\"flex items-center gap-1\"><i class=\"fas fa-arrow-up text-orange-400\"></i><span class=\"text-gray-300\">Departures:</span><span class=\"font-bold text-orange-400\">" + dayOut + '</span>';
                    const outParts = Object.entries(row.groups_out || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
                    if (outParts.length) html += ' <span class="text-gray-500 font-mono text-[0.6rem]">(' + outParts.map(([g, n]) => g + ':' + n).join(', ') + ')</span>';
                    html += '</div>';
                }
                if (dayDefleet) {
                    html += '<div class="flex items-center gap-1"><i class="fas fa-ban text-red-400"></i><span class="text-gray-300">Defleet:</span><span class="font-bold text-red-400">' + dayDefleet + '</span>';
                    const allDefGroups = {};
                    Object.entries(row.groups_defleet_out || {}).forEach(([g, n]) => { allDefGroups[g] = (allDefGroups[g] || 0) + n; });
                    Object.entries(row.groups_rented_defleet || {}).forEach(([g, n]) => { allDefGroups[g] = (allDefGroups[g] || 0) + n; });
                    const defParts = Object.entries(allDefGroups).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
                    if (defParts.length) html += ' <span class="text-gray-500 font-mono text-[0.6rem]">(' + defParts.map(([g, n]) => g + ':' + n).join(', ') + ')</span>';
                    html += '</div>';
                }
                if (dayRepair) {
                    html += "<div class=\"flex items-center gap-1\"><i class=\"fas fa-tools text-pink-400\"></i><span class=\"text-gray-300\">Workshop:</span><span class=\"font-bold text-pink-400\">" + dayRepair + '</span>';
                    const repParts = Object.entries(row.groups_repair_in || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
                    if (repParts.length) html += ' <span class="text-gray-500 font-mono text-[0.6rem]">(' + repParts.map(([g, n]) => g + ':' + n).join(', ') + ')</span>';
                    html += '</div>';
                }
                html += '</div></div>';
            }

            // DayMin summary
            if (row.daymin != null && row.daymin < (row.saldo || 0)) {
                const dmCls = row.daymin < 0 ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-orange-500/10 border-orange-500/30 text-orange-300';
                html += '<div class="mt-3 p-2 ' + dmCls + ' border rounded-lg text-[0.65rem]">';
                html += "<i class=\"fas fa-clock mr-1\"></i>Intraday minimum: <span class=\"font-bold\">" + row.daymin + '</span>';
                if (row.daymin_time) html += " at " + row.daymin_time;
                html += ' — <span class="cursor-pointer underline" onclick="fpShowDayMin(' + poolIdx + ',' + dayIdx + ')">ver timeline</span>';
                html += '</div>';
            }

            if (!totalForecast && !dayIn && !dayOut && !dayDefleet && !dayRepair) {
                html = "<div class=\"text-center text-gray-400 py-8\">No forecast for this day.</div>";
            }

            // ── Station Breakdown ──
            // Resolve poolKey → list of station IDs
            var _stnIds = [];
            if (poolKey.indexOf('📍 ') !== 0) {
                var _ps = FP.data.pool_stations || {};
                var _regions = FP.data.planning_regions || [];
                if (FP.nationalView && poolKey === "National") {
                    // Collect all stations from non-island pools
                    var _islandFolders = (FP.data.pool_folders || []).filter(function (f) {
                        return (f.nome || '').toLowerCase().includes('ilha') || (f.icon || '').includes('island');
                    });
                    var _islandPools = new Set();
                    _islandFolders.forEach(function (f) { (f.pools || []).forEach(function (p) { _islandPools.add(p); }); });
                    (FP.data.pool_names || []).forEach(function (pn) {
                        if (!_islandPools.has(pn)) (_ps[pn] || []).forEach(function (s) { _stnIds.push(s); });
                    });
                } else if (FP.regionView) {
                    var _extraFolders = FP.data.pool_folders || [];
                    var _reg = _regions.find(function (r) { return r.nome === poolKey; })
                        || _extraFolders.find(function (f) { return f.nome === poolKey; });
                    if (_reg) {
                        (_reg.pools || []).forEach(function (pn) {
                            (_ps[pn] || []).forEach(function (s) { _stnIds.push(s); });
                        });
                    }
                } else {
                    (_ps[poolKey] || []).forEach(function (s) { _stnIds.push(s); });
                }
            }
            if (_stnIds.length) {
                var _allSt = FP.data.stations || {};
                var _sel = FP.selectedGroups && FP.selectedGroups.length ? FP.selectedGroups : null;
                var _stnRows = [];
                _stnIds.forEach(function (s) {
                    var raw = _allSt[s.id];
                    if (!raw) return;
                    var filtered = _filterPool(raw, _sel);
                    var r = (filtered.rows || [])[dayIdx];
                    if (!r) return;
                    var retomas = (r.res_in || 0) + (r.fleet_in || 0);
                    var repairIn = r.repair_in || 0;
                    _stnRows.push({
                        id: s.id,
                        nome: s.nome || s.id,
                        saldo: r.saldo || 0,
                        res_out: r.res_out || 0,
                        retomas: retomas,
                        repair_in: repairIn,
                    });
                });
                _stnRows.sort(function (a, b) {
                    var aAct = Math.abs(a.saldo) + a.res_out + a.retomas + a.repair_in;
                    var bAct = Math.abs(b.saldo) + b.res_out + b.retomas + b.repair_in;
                    if (bAct !== aAct) return bAct - aAct;
                    return a.nome.localeCompare(b.nome);
                });
                if (_stnRows.length) {
                    html += '<div class="mt-4 pt-3 border-t border-lynx-divider dark:border-gray-700">';
                    html += "<div class=\"text-[0.6rem] font-bold text-gray-400 uppercase tracking-wider mb-2\"><i class=\"fas fa-map-marker-alt mr-1\"></i>Distribution by Station</div>";
                    html += '<table class="w-full text-xs border-collapse">';
                    html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
                    html += '<tr class="text-left text-[0.55rem] text-gray-400 uppercase tracking-wider">';
                    html += "<th class=\"pb-1.5 pr-2 pl-1\">Station</th>";
                    html += "<th class=\"pb-1.5 pr-2 text-center\">Balance</th>";
                    html += "<th class=\"pb-1.5 pr-2 text-center\">Reservations</th>";
                    html += '<th class="pb-1.5 pr-2 text-center">Retomas</th>';
                    html += "<th class=\"pb-1.5 pr-2 text-center text-pink-400\" title=\"Workshop returns (excluded from DROP)\">Workshop</th>";
                    html += '</tr></thead><tbody>';
                    _stnRows.forEach(function (s, i) {
                        var bg = i % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-gray-800/20';
                        var saldoCls = s.saldo < 0 ? 'text-red-400 font-bold' : s.saldo === 0 ? 'text-gray-500' : 'text-emerald-400 font-semibold';
                        var hasActivity = s.res_out || s.retomas || s.repair_in;
                        var rowCls = hasActivity ? '' : 'opacity-50';
                        html += '<tr class="border-b border-lynx-divider dark:border-gray-800/40 ' + bg + ' ' + rowCls + '">';
                        html += '<td class="py-1 pr-2 pl-1 whitespace-nowrap text-[0.65rem]">' + _esc(s.nome) + '</td>';
                        html += '<td class="py-1 pr-2 text-center cursor-pointer hover:underline ' + saldoCls + '" onclick="fpShowStationDetail(\'' + s.id + '\',' + dayIdx + ',\'saldo\')">' + s.saldo + '</td>';
                        html += '<td class="py-1 pr-2 text-center cursor-pointer hover:underline ' + (s.res_out ? 'text-orange-400' : 'text-gray-600') + '" onclick="fpShowStationDetail(\'' + s.id + '\',' + dayIdx + ',\'res\')">' + (s.res_out || '-') + '</td>';
                        html += '<td class="py-1 pr-2 text-center cursor-pointer hover:underline ' + (s.retomas ? 'text-blue-400' : 'text-gray-600') + '" onclick="fpShowStationDetail(\'' + s.id + '\',' + dayIdx + ',\'drop\')">' + (s.retomas || '-') + '</td>';
                        html += '<td class="py-1 pr-2 text-center ' + (s.repair_in ? 'text-pink-400 font-semibold' : 'text-gray-600') + '">' + (s.repair_in || '-') + '</td>';
                        html += '</tr>';
                    });
                    var _totSaldo = _stnRows.reduce(function (s, r) { return s + r.saldo; }, 0);
                    var _totOut = _stnRows.reduce(function (s, r) { return s + r.res_out; }, 0);
                    var _totRet = _stnRows.reduce(function (s, r) { return s + r.retomas; }, 0);
                    var _totRepair = _stnRows.reduce(function (s, r) { return s + r.repair_in; }, 0);
                    html += '<tr class="border-t-2 border-gray-300 dark:border-gray-600 font-bold text-[0.65rem]">';
                    html += '<td class="py-1.5 pr-2 pl-1 text-gray-400 uppercase">Total</td>';
                    html += '<td class="py-1.5 pr-2 text-center text-emerald-400">' + _totSaldo + '</td>';
                    html += '<td class="py-1.5 pr-2 text-center text-orange-400">' + (_totOut || '-') + '</td>';
                    html += '<td class="py-1.5 pr-2 text-center text-blue-400">' + (_totRet || '-') + '</td>';
                    html += '<td class="py-1.5 pr-2 text-center text-pink-400">' + (_totRepair || '-') + '</td>';
                    html += '</tr>';
                    html += '</tbody></table></div>';
                }
            }

            body.innerHTML = html;
            _showModal(modal);
            return;
        }

        // ═══════════ TODAY → REAL VEHICLES ═══════════
        const vehicles = pool.avail_vehicles || [];
        const dateLabel2 = dateLabel;

        // LT returns for this day: fleet_in_details where is_lt=true (exclude defleet — priority)
        const ltReturns = (row.fleet_in_details || []).filter(d => d.is_lt && !d.will_defleet && !d.will_exceed_km);
        // Defleet vehicles for this day
        const defleetItems = row.defleet_details || [];

        title.textContent = poolKey + " — Balance — " + dateLabel2;

        let html = '';
        const totalSections = (vehicles.length ? 1 : 0) + (ltReturns.length ? 1 : 0) + (defleetItems.length ? 1 : 0);

        if (!totalSections) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No details for this day.</div>";
            _showModal(modal);
            return;
        }

        // ── Section 1: Available Vehicles (today only) ──
        if (vehicles.length) {
            html += "<div class=\"text-[0.65rem] font-bold text-emerald-400 uppercase tracking-wider mb-2\"><i class=\"fas fa-car mr-1\"></i>Available Vehicles (" + vehicles.length + ')</div>';
            const sorted = vehicles.slice().sort((a, b) => {
                const cmp = (a.group || '').localeCompare(b.group || '');
                return cmp !== 0 ? cmp : (a.plate || '').localeCompare(b.plate || '');
            });

            html += '<table class="w-full text-xs border-collapse">';
            html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
            html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
            html += "<th class=\"pb-2 pr-3 pl-1\">Station</th>";
            html += "<th class=\"pb-2 pr-3\">License Plate</th>";
            html += "<th class=\"pb-2 pr-3\">Group</th>";
            html += "<th class=\"pb-2 pr-3\">Vehicle</th>";
            html += '<th class="pb-2 pr-3">Status</th>';
            html += "<th class=\"pb-2 pr-3\">Alert</th>";
            html += '<th class="pb-2 pr-3">Parking</th>';
            html += "<th class=\"pb-2 pr-3 text-right\">Remaining km</th>";
            html += '<th class="pb-2 pr-3 text-right">KM Total</th>';
            html += "<th class=\"pb-2 pr-3 text-right\">Days Defleet</th>";
            html += "<th class=\"pb-2 pr-3\">Type</th>";
            html += '<th class="pb-2 pr-3">Engine</th>';
            html += "<th class=\"pb-2 pr-3\">Fuel</th>";
            html += '</tr></thead>';
            html += '<tbody class="lynx-text-primary">';

            sorted.forEach(v => {
                const remainDays = _remainDays(v.defleet);
                const remainClass = remainDays !== '' && remainDays <= 30 ? 'text-red-400 font-semibold' : remainDays !== '' && remainDays <= 60 ? 'text-orange-400' : '';
                const kmClass = v.remaining_km != null && v.remaining_km < 1000 ? 'text-red-400 font-semibold' : v.remaining_km != null && v.remaining_km < 3000 ? 'text-orange-400' : '';
                const statusLabel = _statusLabels[v.status] || ('Status ' + v.status);
                const engineLabel = _engineLabels[v.engine] || v.engine || '';
                const nearDefleetBadge = v.near_defleet ? " <span class=\"text-red-400 text-[0.5rem]\" title=\"Approaching defleet\"><i class=\"fas fa-exclamation-triangle\"></i></span>" : '';
                const alarm = _fpAlarm(v.plate);

                html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
                html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap">' + _esc(v.station || '') + '</td>';
                html += '<td class="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate) + '</td>';
                html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group) + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(window.nafGetCarModel(v) || '') + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(statusLabel) + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap' + (alarm ? ' text-red-500 font-semibold' : '') + '">' + (alarm ? _esc(alarm) : '—') + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap text-gray-500">' + _esc(v.parking || '') + '</td>';
                html += '<td class="py-1.5 pr-3 text-right ' + kmClass + '">' + (v.remaining_km != null ? v.remaining_km.toLocaleString('en-GB') : '') + '</td>';
                html += '<td class="py-1.5 pr-3 text-right">' + (v.mileage != null ? v.mileage.toLocaleString('en-GB') : '') + '</td>';
                html += '<td class="py-1.5 pr-3 text-right ' + remainClass + '">' + (remainDays !== '' ? remainDays : '') + nearDefleetBadge + '</td>';
                html += '<td class="py-1.5 pr-3">' + _tipoBadge(v.tipo) + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(engineLabel) + '</td>';
                html += '<td class="py-1.5 pr-3">' + _fuelBar(v.fuel, v.engine, v.charge_pct) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        }

        // ── Section 2: LT Returns (DrLo style) ──
        if (ltReturns.length) {
            if (vehicles.length) html += '<div class="mt-4"></div>';
            html += '<div class="text-[0.65rem] font-bold text-purple-400 uppercase tracking-wider mb-2"><i class="fas fa-handshake mr-1"></i>Retomas LT (' + ltReturns.length + ')</div>';
            const sortedLt = ltReturns.slice().sort((a, b) => (a.ret_time || '').localeCompare(b.ret_time || ''));

            html += '<table class="w-full text-xs border-collapse">';
            html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
            html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
            html += "<th class=\"pb-2 pr-3 pl-1\">Station</th>";
            html += "<th class=\"pb-2 pr-3\">Time</th>";
            html += "<th class=\"pb-2 pr-3\">License Plate</th>";
            html += "<th class=\"pb-2 pr-3\">Group</th>";
            html += "<th class=\"pb-2 pr-3\">Vehicle</th>";
            html += '</tr></thead>';
            html += '<tbody class="lynx-text-primary">';

            sortedLt.forEach(v => {
                const retTime = _fmtTime(v.ret_time || '');
                html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
                html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap">' + _esc(v.station || '') + '</td>';
                html += '<td class="py-1.5 pr-3 font-mono whitespace-nowrap">' + _esc(retTime) + '</td>';
                html += '<td class="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate || '') + '</td>';
                html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group || '') + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(window.nafGetCarModel(v) || '') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        }

        // ── Section 3: Defleet (Def style) ──
        if (defleetItems.length) {
            if (vehicles.length || ltReturns.length) html += '<div class="mt-4"></div>';
            html += '<div class="text-[0.65rem] font-bold text-red-400 uppercase tracking-wider mb-2"><i class="fas fa-arrow-right mr-1"></i>Defleet (' + defleetItems.length + ')</div>';
            const sortedDef = defleetItems.slice().sort((a, b) => (a.group || '').localeCompare(b.group || ''));

            html += '<table class="w-full text-xs border-collapse">';
            html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
            html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
            html += "<th class=\"pb-2 pr-3 pl-1\">Station</th>";
            html += "<th class=\"pb-2 pr-3\">License Plate</th>";
            html += "<th class=\"pb-2 pr-3\">Group</th>";
            html += "<th class=\"pb-2 pr-3\">Vehicle</th>";
            html += "<th class=\"pb-2 pr-3 text-right\">Remaining Days</th>";
            html += "<th class=\"pb-2 pr-3 text-right\">Remaining km</th>";
            html += '<th class="pb-2 pr-3">Engine</th>';
            html += '</tr></thead>';
            html += '<tbody class="lynx-text-primary">';

            sortedDef.forEach(v => {
                const daysClass = v.remaining_days != null && v.remaining_days <= 0 ? 'text-red-400 font-semibold' : v.remaining_days != null && v.remaining_days <= 7 ? 'text-orange-400' : '';
                const kmClass = v.remaining_km != null && v.remaining_km < 0 ? 'text-red-400 font-semibold' : v.remaining_km != null && v.remaining_km < 1000 ? 'text-orange-400' : '';
                const engineLabel = _engineLabels[v.engine] || v.engine || '';

                html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
                html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap">' + _esc(v.station || '') + '</td>';
                html += '<td class="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate || '') + '</td>';
                html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group || '') + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(window.nafGetCarModel(v) || '') + '</td>';
                html += '<td class="py-1.5 pr-3 text-right ' + daysClass + '">' + (v.remaining_days != null ? v.remaining_days : '') + '</td>';
                html += '<td class="py-1.5 pr-3 text-right ' + kmClass + '">' + (v.remaining_km != null ? v.remaining_km.toLocaleString('en-GB') : '') + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(engineLabel) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        }

        body.innerHTML = html;
        _showModal(modal);
    };

    // Show station-level detail when clicking a cell in the station breakdown table
    window.fpShowStationDetail = function (stationId, dayIdx, type) {
        var allStations = FP.data.stations || {};
        var raw = allStations[stationId];
        if (!raw) return;
        var sel = FP.selectedGroups && FP.selectedGroups.length ? FP.selectedGroups : null;
        var filtered = _filterPool(raw, sel);
        var row = (filtered.rows || [])[dayIdx];
        if (!row) return;

        // Find station name
        var stName = stationId;
        Object.values(FP.data.pool_stations || {}).forEach(function (stns) {
            stns.forEach(function (s) { if (s.id === stationId) stName = s.nome; });
        });

        var modal = document.getElementById('fpVehicleModal');
        var title = document.getElementById('fpVehicleModalTitle');
        var body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        var dateLabel = row.date ? _fmtDate(row.date) : '';
        var html = '';

        if (type === 'saldo') {
            // Show forecast groups for this station
            var fg = row.forecast_groups || {};
            var total = Object.values(fg).reduce(function (s, n) { return s + n; }, 0);
            title.textContent = stName + " — Balance — " + dateLabel + ' [' + total + ']';

            if (!total) {
                body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No vehicles forecast at this station.</div>";
                _showModal(modal);
                return;
            }
            var items = Object.entries(fg).filter(function (e) { return e[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; });
            html += '<div class="flex items-center gap-3 mb-4 pb-3 border-b border-lynx-divider dark:border-gray-700">';
            html += '<div class="text-lg font-bold text-emerald-400">' + total + '</div>';
            html += "<div class=\"text-xs text-gray-400\">projected vehicles</div>";
            html += '</div>';
            html += '<div class="flex flex-wrap gap-1.5">';
            items.forEach(function (i) {
                html += '<div class="flex items-center gap-1 px-2 py-1 rounded-md bg-lynx-subtle dark:bg-gray-800/60 border border-lynx-divider dark:border-gray-700">';
                html += '<span class="text-[0.65rem] font-mono font-semibold text-primary-500">' + _esc(i[0]) + '</span>';
                html += '<span class="text-[0.7rem] font-bold text-gray-700 dark:text-gray-200">' + i[1] + '</span>';
                html += '</div>';
            });
            html += '</div>';
        } else if (type === 'res') {
            // Show reservation pickups for this station
            var items = row.res_out_details || [];
            title.textContent = stName + " — Reservations (pickups) — " + dateLabel + ' [' + items.length + ']';

            if (!items.length) {
                body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No reservations at this station.</div>";
                _showModal(modal);
                return;
            }
            var sorted = items.slice().sort(function (a, b) { return (a.pick_time || '').localeCompare(b.pick_time || ''); });
            html += _buildResTable(sorted, 'pick');
        } else {
            // Show returns: res_in + fleet_in
            var resItems = (row.res_in_details || []).filter(function (d) { return !d.is_lt; }).map(function (d) { return Object.assign({_type: 'res'}, d); });
            var fleetItems = (row.fleet_in_details || []).filter(function (d) { return !d.is_lt && !d.will_defleet && !d.will_exceed_km; }).map(function (d) { return Object.assign({_type: 'fleet'}, d); });
            var allItems = resItems.concat(fleetItems);
            title.textContent = stName + ' — Retomas (entrada) — ' + dateLabel + ' [' + allItems.length + ']';

            if (!allItems.length) {
                body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No returns at this station.</div>";
                _showModal(modal);
                return;
            }
            var resOnly = allItems.filter(function (d) { return d._type === 'res'; });
            var fleetOnly = allItems.filter(function (d) { return d._type === 'fleet'; });
            if (resOnly.length) {
                html += "<div class=\"text-[0.65rem] font-bold text-blue-400 uppercase tracking-wider mb-2\"><i class=\"fas fa-calendar-check mr-1\"></i>Reservations (" + resOnly.length + ')</div>';
                html += _buildResTable(resOnly.sort(function (a, b) { return (a.ret_time || '').localeCompare(b.ret_time || ''); }), 'ret');
            }
            if (fleetOnly.length) {
                if (resOnly.length) html += '<div class="mt-4"></div>';
                html += "<div class=\"text-[0.65rem] font-bold text-green-400 uppercase tracking-wider mb-2\"><i class=\"fas fa-car mr-1\"></i>Fleet / Contracts (" + fleetOnly.length + ')</div>';
                html += _buildFleetRetTable(fleetOnly);
            }
        }

        body.innerHTML = html;
        _showModal(modal);
    };

    window.fpCloseVehicleModal = function () {
        const modal = document.getElementById('fpVehicleModal');
        if (modal) modal.classList.add('hidden');
    };

    // Show LT returns modal for a specific day
    window.fpShowLtReturns = function (poolIdx, dayIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const row = (pool.rows || [])[dayIdx];
        if (!row) return;

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        const dateLabel = row.date ? _fmtDate(row.date) : '';
        // LT returns = fleet returns where is_lt + reservation returns where is_lt
        // LT returns = fleet returns where is_lt (exclude defleet — defleet has priority)
        const ltFleet = (row.fleet_in_details || []).filter(d => d.is_lt && !d.will_defleet && !d.will_exceed_km);
        const ltRes = (row.res_in_details || []).filter(d => d.is_lt);

        title.textContent = poolKey + ' — Retomas LT — ' + dateLabel + ' [' + (ltFleet.length + ltRes.length) + ']';

        if (!ltFleet.length && !ltRes.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No long-term returns on this day.</div>";
            _showModal(modal);
            return;
        }

        let html = '';

        // Fleet LT returns (contracts)
        if (ltFleet.length) {
            html += "<div class=\"text-[0.65rem] font-bold text-purple-400 uppercase tracking-wider mb-2\"><i class=\"fas fa-handshake mr-1\"></i>Contracts LT (" + ltFleet.length + ')</div>';
            const sorted = ltFleet.slice().sort((a, b) => (a.ret_time || '').localeCompare(b.ret_time || ''));
            html += '<table class="w-full text-xs border-collapse">';
            html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
            html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
            html += "<th class=\"pb-2 pr-3 pl-1\">Station</th>";
            html += "<th class=\"pb-2 pr-3\">Time</th>";
            html += "<th class=\"pb-2 pr-3\">N.º Contract</th>";
            html += "<th class=\"pb-2 pr-3\">License Plate</th>";
            html += "<th class=\"pb-2 pr-3\">Group</th>";
            html += "<th class=\"pb-2 pr-3\">Vehicle</th>";
            html += "<th class=\"pb-2 pr-3\">Alert</th>";
            html += '<th class="pb-2 pr-3 text-center">Defleet</th>';
            html += '</tr></thead>';
            html += '<tbody class="lynx-text-primary">';
            sorted.forEach(v => {
                const retTime = _fmtTime(v.ret_time || '');
                const defleetBadge = v.will_defleet ? '<span class="text-red-400"><i class="fas fa-exclamation-triangle"></i></span>' : '';
                const alarm = _fpAlarm(v.plate);
                html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
                html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap">' + _esc(v.station || '') + '</td>';
                html += '<td class="py-1.5 pr-3 font-mono whitespace-nowrap">' + _esc(retTime) + '</td>';
                html += '<td class="py-1.5 pr-3 font-mono">' + _esc(v.ra_number || '') + '</td>';
                html += '<td class="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate || '') + '</td>';
                html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group || '') + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(window.nafGetCarModel(v) || '') + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap' + (alarm ? ' text-red-500 font-semibold' : '') + '">' + (alarm ? _esc(alarm) : '—') + '</td>';
                html += '<td class="py-1.5 pr-3 text-center">' + defleetBadge + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        }

        // Reservation LT returns
        if (ltRes.length) {
            if (ltFleet.length) html += '<div class="mt-4"></div>';
            html += "<div class=\"text-[0.65rem] font-bold text-indigo-400 uppercase tracking-wider mb-2\"><i class=\"fas fa-calendar-check mr-1\"></i>Reservations LT (" + ltRes.length + ')</div>';
            const sorted = ltRes.slice().sort((a, b) => (a.ret_time || '').localeCompare(b.ret_time || ''));
            html += _buildResTable(sorted, 'ret');
        }

        body.innerHTML = html;
        _showModal(modal);
    };

    // Show DayMin timeline modal — intraday events ordered by time
    window.fpShowDayMin = function (poolIdx, dayIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const row = (pool.rows || [])[dayIdx];
        if (!row) return;

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        const dateLabel = row.date ? _fmtDate(row.date) : '';
        const saldo = row.saldo != null ? row.saldo : 0;
        const dm = row.daymin != null ? row.daymin : saldo;
        title.textContent = poolKey + ' — DayMin — ' + dateLabel + " [Balance: " + saldo + ' → Min: ' + dm + ']';

        const events = row.daymin_events || [];
        if (!events.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No intraday movements — minimum = opening balance (" + saldo + ').</div>';
            _showModal(modal);
            return;
        }

        let html = "<div class=\"mb-3 text-[0.65rem] text-gray-400\">Opening balance: <span class=\"font-bold text-green-400\">" + saldo + '</span></div>';
        html += '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += "<th class=\"pb-2 pr-3 pl-1 min-w-[50px]\">Time</th>";
        html += "<th class=\"pb-2 pr-3\">Type</th>";
        html += '<th class="pb-2 pr-3">Detalhe</th>';
        html += "<th class=\"pb-2 pr-3 text-right\">Balance</th>";
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        events.forEach(function (ev) {
            const isMin = ev.running === dm && dm < saldo;
            const rowCls = isMin ? 'bg-red-500/10' : '';
            const icon = ev.delta < 0
                ? '<i class="fas fa-arrow-up text-red-400"></i>'
                : '<i class="fas fa-arrow-down text-green-400"></i>';
            const typeLabel = ev.delta < 0 ? "Departure" : "Return";
            const saldoCls = ev.running < 0 ? 'text-red-500 font-bold' : ev.running === 0 ? 'text-orange-400 font-semibold' : 'text-green-400';
            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 ' + rowCls + '">';
            html += '<td class="py-1.5 pr-3 pl-1 font-mono whitespace-nowrap">' + _esc(ev.time) + '</td>';
            html += '<td class="py-1.5 pr-3">' + icon + ' <span class="ml-0.5">' + typeLabel + '</span></td>';
            html += '<td class="py-1.5 pr-3 text-gray-400 text-[0.6rem]">' + _esc(ev.label || '') + '</td>';
            html += '<td class="py-1.5 pr-3 text-right font-bold ' + saldoCls + '">' + ev.running + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';

        if (dm < 0) {
            html += '<div class="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[0.65rem] text-red-300">';
            html += "<i class=\"fas fa-exclamation-triangle mr-1\"></i>Attention: negative intraday minimum (" + dm + ')';
            if (row.daymin_time) html += " at " + row.daymin_time;
            html += " — returns do not cover departures in time.</div>";
        } else if (dm < saldo) {
            html += '<div class="mt-3 p-2 bg-orange-500/10 border border-orange-500/30 rounded-lg text-[0.65rem] text-orange-300">';
            html += "<i class=\"fas fa-info-circle mr-1\"></i>Intraday minimum: " + dm;
            if (row.daymin_time) html += " at " + row.daymin_time;
            html += " (below opening balance).</div>";
        }

        body.innerHTML = html;
        _showModal(modal);
    };

    // Show defleet detail modal for a specific day
    window.fpShowDefleet = function (poolIdx, dayIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const row = (pool.rows || [])[dayIdx];
        if (!row) return;

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        const dateLabel = row.date ? _fmtDate(row.date) : '';
        const defleetItems = row.defleet_details || [];

        title.textContent = poolKey + ' — Defleet — ' + dateLabel + ' [' + defleetItems.length + ']';

        if (!defleetItems.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No fleet exits on this day.</div>";
            _showModal(modal);
            return;
        }

        const sorted = defleetItems.slice().sort((a, b) => (a.group || '').localeCompare(b.group || ''));
        let html = '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += "<th class=\"pb-2 pr-3 pl-1\">Station</th>";
        html += "<th class=\"pb-2 pr-3\">License Plate</th>";
        html += "<th class=\"pb-2 pr-3\">Group</th>";
        html += "<th class=\"pb-2 pr-3\">Vehicle</th>";
        html += "<th class=\"pb-2 pr-3\">Reason</th>";
        html += "<th class=\"pb-2 pr-3 text-right\">Remaining Days</th>";
        html += "<th class=\"pb-2 pr-3 text-right\">Remaining km</th>";
        html += '<th class="pb-2 pr-3 text-right">KM Previstos</th>';
        html += '<th class="pb-2 pr-3">Engine</th>';
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        sorted.forEach(v => {
            const daysClass = v.remaining_days != null && v.remaining_days <= 0 ? 'text-red-400 font-semibold' : v.remaining_days != null && v.remaining_days <= 7 ? 'text-orange-400' : '';
            const kmClass = v.remaining_km != null && v.remaining_km < 0 ? 'text-red-400 font-semibold' : v.remaining_km != null && v.remaining_km < 1000 ? 'text-orange-400' : '';
            const predKmClass = v.predicted_km != null && v.predicted_km < 0 ? 'text-red-400 font-semibold' : '';
            const engineLabel = _engineLabels[v.engine] || v.engine || '';
            const reasonLabel = v.reason === 'sem_km' ? "<span class=\"text-orange-400 font-semibold\">Mileage exhausted</span>" : '<span class="text-purple-400">Defleet</span>';

            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
            html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap">' + _esc(v.station || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(window.nafGetCarModel(v) || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + reasonLabel + '</td>';
            html += '<td class="py-1.5 pr-3 text-right ' + daysClass + '">' + (v.remaining_days != null ? v.remaining_days : '') + '</td>';
            html += '<td class="py-1.5 pr-3 text-right ' + kmClass + '">' + (v.remaining_km != null ? v.remaining_km.toLocaleString('en-GB') : '') + '</td>';
            html += '<td class="py-1.5 pr-3 text-right ' + predKmClass + '">' + (v.predicted_km != null ? v.predicted_km.toLocaleString('en-GB') : '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(engineLabel) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        body.innerHTML = html;
        _showModal(modal);
    };

    // Show infleet detail modal
    window.fpShowInfleet = function (poolIdx, dayIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const row = (pool.rows || [])[dayIdx];
        if (!row) return;

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        const dateLabel = row.date ? _fmtDate(row.date) : '';
        const dateStr = row.date || '';

        // Get infleet vehicles for this pool+date (only pending, respecting group filter)
        const parkIds = _getInfleetParkIds(poolKey);
        const sel = FP.selectedGroups;
        let vehicles = [];
        if (FP.infleet && FP.infleet.vehicles && parkIds.length) {
            vehicles = FP.infleet.vehicles.filter(v => {
                if (v.in_fleet) return false; // already in inventory, counts in saldo
                if (!parkIds.includes(v.park_id)) return false;
                if (!v.arrival) return false;
                if (v.arrival !== dateStr) return false;
                if (sel.length && !sel.includes(v.group)) return false;
                return true;
            });
        }

        title.textContent = poolKey + ' — Infleet Previsto — ' + dateLabel + ' [' + vehicles.length + ']';

        if (!vehicles.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No fleet additions scheduled for this day.</div>";
            _showModal(modal);
            return;
        }

        const sorted = vehicles.slice().sort((a, b) => (a.group || '').localeCompare(b.group || '') || (a.plate || '').localeCompare(b.plate || ''));
        let html = '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += "<th class=\"pb-2 pr-3 pl-1\">License Plate</th>";
        html += "<th class=\"pb-2 pr-3\">Group</th>";
        html += "<th class=\"pb-2 pr-3\">Manufacturer</th>";
        html += "<th class=\"pb-2 pr-3\">Model</th>";
        html += "<th class=\"pb-2 pr-3\">Trim</th>";
        html += "<th class=\"pb-2 pr-3\">Fuel</th>";
        html += "<th class=\"pb-2 pr-3\">Color</th>";
        html += '<th class="pb-2 pr-3">Chegada</th>';
        html += "<th class=\"pb-2 pr-3\">Contract End</th>";
        html += "<th class=\"pb-2 pr-3\">In Fleet</th>";
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        sorted.forEach(v => {
            const inFleetBadge = v.in_fleet
                ? "<span class=\"text-green-500 font-semibold\">Yes</span>"
                : "<span class=\"text-orange-400\">No</span>";
            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
            html += '<td class="py-1.5 pr-3 pl-1 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(v.make || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(v.model || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap text-[0.55rem]">' + _esc(v.version || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(v.fuel || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(v.color || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + (v.arrival ? _fmtDate(v.arrival) : '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + (v.contract_end ? _fmtDate(v.contract_end) : '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + inFleetBadge + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        body.innerHTML = html;
        _showModal(modal);
    };

    // Show infleet overdue modal
    window.fpShowInfleetOverdue = function (poolIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        const todayStr = (pool.rows || [])[0] ? pool.rows[0].date : '';
        const vehicles = _getInfleetOverdueVehicles(poolKey, todayStr, FP.selectedGroups);

        title.textContent = poolKey + " — Overdue Fleet Additions — " + vehicles.length + " vehicles";

        if (!vehicles.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No overdue fleet additions.</div>";
            _showModal(modal);
            return;
        }

        // Summary by group
        const byGrp = {};
        vehicles.forEach(v => { byGrp[v.group] = (byGrp[v.group] || 0) + 1; });
        let summaryHtml = '<div class="flex gap-3 mb-3 text-xs flex-wrap">';
        Object.entries(byGrp).sort((a, b) => b[1] - a[1]).forEach(([g, n]) => {
            summaryHtml += '<span class="text-emerald-500 font-semibold">' + _esc(g) + ': ' + n + '</span>';
        });
        summaryHtml += '</div>';

        const sorted = vehicles.slice().sort((a, b) => (a.arrival || '').localeCompare(b.arrival || '') || (a.group || '').localeCompare(b.group || ''));
        let html = summaryHtml;
        html += '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += "<th class=\"pb-2 pr-3 pl-1\">License Plate</th>";
        html += "<th class=\"pb-2 pr-3\">Group</th>";
        html += "<th class=\"pb-2 pr-3\">Manufacturer</th>";
        html += "<th class=\"pb-2 pr-3\">Model</th>";
        html += "<th class=\"pb-2 pr-3\">Trim</th>";
        html += "<th class=\"pb-2 pr-3\">Fuel</th>";
        html += "<th class=\"pb-2 pr-3\">Color</th>";
        html += '<th class="pb-2 pr-3">Chegada Prevista</th>';
        html += "<th class=\"pb-2 pr-3\">Days Overdue</th>";
        html += "<th class=\"pb-2 pr-3\">Contract End</th>";
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        sorted.forEach(v => {
            const daysLate = v.arrival ? Math.floor((new Date(todayStr) - new Date(v.arrival)) / 86400000) : '';
            const lateClass = daysLate >= 7 ? 'text-red-500 font-bold' : daysLate >= 3 ? 'text-orange-400 font-semibold' : 'text-yellow-500';
            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
            html += '<td class="py-1.5 pr-3 pl-1 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(v.make || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(v.model || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap text-[0.55rem]">' + _esc(v.version || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(v.fuel || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(v.color || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + (v.arrival ? _fmtDate(v.arrival) : '') + '</td>';
            html += '<td class="py-1.5 pr-3 text-center ' + lateClass + '">' + daysLate + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + (v.contract_end ? _fmtDate(v.contract_end) : '') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        body.innerHTML = html;
        _showModal(modal);
    };

    // Show oficina vehicles modal
    window.fpShowOficina = function (poolIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const vehicles = pool.oficina_vehicles || [];

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        title.textContent = poolKey + " — Workshop — " + vehicles.length + " vehicles";

        if (!vehicles.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No workshop vehicles.</div>";
            _showModal(modal);
            return;
        }

        const _activityLabels = {FER: "Rust", REP: "Repair", WEC: 'Wear & Care'};
        const sorted = vehicles.slice().sort((a, b) => {
            const cmp = (a.group || '').localeCompare(b.group || '');
            return cmp !== 0 ? cmp : (a.plate || '').localeCompare(b.plate || '');
        });

        let html = '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += "<th class=\"pb-2 pr-3 pl-1\">Station</th>";
        html += "<th class=\"pb-2 pr-3\">License Plate</th>";
        html += "<th class=\"pb-2 pr-3\">Group</th>";
        html += "<th class=\"pb-2 pr-3\">Vehicle</th>";
        html += '<th class="pb-2 pr-3">Status</th>';
        html += '<th class="pb-2 pr-3">Actividade</th>';
        html += '<th class="pb-2 pr-3">Parking</th>';
        html += "<th class=\"pb-2 pr-3\">In workshop desde</th>";
        html += '<th class="pb-2 pr-3 text-right">KM Total</th>';
        html += "<th class=\"pb-2 pr-3 text-right\">Days Defleet</th>";
        html += "<th class=\"pb-2 pr-3\">Type</th>";
        html += '<th class="pb-2 pr-3">Engine</th>';
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        sorted.forEach(v => {
            const statusLabel = v.status === 5 ? "Quick Repair" : v.status === 6 ? 'Rep. Longa' : 'Status ' + v.status;
            const actLabel = _activityLabels[v.activity] || v.activity || '';
            const remainDays = _remainDays(v.defleet);
            const remainClass = remainDays !== '' && remainDays <= 30 ? 'text-red-400 font-semibold' : remainDays !== '' && remainDays <= 60 ? 'text-orange-400' : '';
            const engineLabel = _engineLabels[v.engine] || v.engine || '';
            const sinceDate = v.in_status_since ? v.in_status_since.substring(0, 10) : '';
            const sinceDays = sinceDate ? Math.floor((Date.now() - new Date(sinceDate).getTime()) / 86400000) : '';
            const sinceLabel = sinceDate ? window.renaFormatDate(v.in_status_since) + (sinceDays !== '' ? ' (' + sinceDays + 'd)' : '') : '';

            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
            html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap">' + _esc(v.station || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(window.nafGetCarModel(v) || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(statusLabel) + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(actLabel) + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap text-gray-500">' + _esc(v.parking || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(sinceLabel) + '</td>';
            html += '<td class="py-1.5 pr-3 text-right">' + (v.mileage != null ? v.mileage.toLocaleString('en-GB') : '') + '</td>';
            html += '<td class="py-1.5 pr-3 text-right ' + remainClass + '">' + (remainDays !== '' ? remainDays : '') + '</td>';
            html += '<td class="py-1.5 pr-3">' + _tipoBadge(v.tipo) + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(engineLabel) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        body.innerHTML = html;
        _showModal(modal);
    };

    // Show Impro vehicles modal (rented under a non-customer rate code)
    window.fpShowImpro = function (poolIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const vehicles = pool.impro_vehicles || [];

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        title.textContent = poolKey + ' — Impro — ' + vehicles.length + " vehicles";

        if (!vehicles.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No vehicles in non-revenue use.</div>";
            _showModal(modal);
            return;
        }

        const sorted = vehicles.slice().sort((a, b) => {
            const cmp = (a.rate_label || '').localeCompare(b.rate_label || '');
            return cmp !== 0 ? cmp : (a.plate || '').localeCompare(b.plate || '');
        });

        let html = '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += "<th class=\"pb-2 pr-3 pl-1\">Station</th>";
        html += "<th class=\"pb-2 pr-3\">License Plate</th>";
        html += "<th class=\"pb-2 pr-3\">Group</th>";
        html += "<th class=\"pb-2 pr-3\">Vehicle</th>";
        html += "<th class=\"pb-2 pr-3\">Reason (Rate Code)</th>";
        html += "<th class=\"pb-2 pr-3\">Expected return</th>";
        html += "<th class=\"pb-2 pr-3\">Contract No.</th>";
        html += '<th class="pb-2 pr-3 text-right">KM Total</th>';
        html += '<th class="pb-2 pr-3">Engine</th>';
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        sorted.forEach(v => {
            const engineLabel = _engineLabels[v.engine] || v.engine || '';
            const retLabel = v.return_time ? window.renaFormatDate(v.return_time) : '';

            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
            html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap">' + _esc(v.station || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(window.nafGetCarModel(v) || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap text-fuchsia-500 font-medium" title="' + _esc(v.rate_code || '') + '">' + _esc(v.rate_label || v.rate_code || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(retLabel) + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap text-gray-500">' + _esc(v.ra_number || '') + '</td>';
            html += '<td class="py-1.5 pr-3 text-right">' + (v.mileage != null ? v.mileage.toLocaleString('en-GB') : '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(engineLabel) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        body.innerHTML = html;
        _showModal(modal);
    };

    // Show OK OF vehicles modal (ready at repair center, waiting collection)
    window.fpShowProntoOf = function (poolIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const vehicles = (pool.pronto_of_vehicles || []);

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        title.textContent = poolKey + ' — OK OF — ' + vehicles.length + " vehicle(s) prontas a recolher";

        if (!vehicles.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No workshop-ready vehicles.</div>";
            _showModal(modal);
            return;
        }

        const sorted = vehicles.slice().sort((a, b) => {
            const cmp = (a.station || '').localeCompare(b.station || '');
            return cmp !== 0 ? cmp : (a.group || '').localeCompare(b.group || '');
        });

        let html = "<div class=\"text-xs text-violet-400 mb-3 px-1\"><i class=\"fas fa-info-circle mr-1\"></i>Vehicles with status <b>Ready</b> (classicStatus=4) still at the workshop. Excluded from the available balance until collected.</div>";
        html += '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += "<th class=\"pb-2 pr-3 pl-1\">Workshop</th>";
        html += "<th class=\"pb-2 pr-3\">License Plate</th>";
        html += "<th class=\"pb-2 pr-3\">Group</th>";
        html += "<th class=\"pb-2 pr-3\">Vehicle</th>";
        html += '<th class="pb-2 pr-3">Parking</th>';
        html += "<th class=\"pb-2 pr-3\">Ready desde</th>";
        html += '<th class="pb-2 pr-3 text-right">KM Total</th>';
        html += "<th class=\"pb-2 pr-3\">Type</th>";
        html += '<th class="pb-2 pr-3">Engine</th>';
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        sorted.forEach(v => {
            const sinceDate = v.in_status_since ? v.in_status_since.substring(0, 10) : '';
            const sinceDays = sinceDate ? Math.floor((Date.now() - new Date(sinceDate).getTime()) / 86400000) : '';
            const sinceLabel = sinceDate ? window.renaFormatDate(v.in_status_since) + (sinceDays !== '' ? ' (' + sinceDays + 'd)' : '') : '';
            const sinceCls = sinceDays !== '' && sinceDays >= 3 ? 'text-orange-400 font-semibold' : '';
            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
            html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap text-violet-400 font-medium">' + _esc(v.station || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(window.nafGetCarModel(v) || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap text-gray-500">' + _esc(v.parking || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap ' + sinceCls + '">' + _esc(sinceLabel) + '</td>';
            html += '<td class="py-1.5 pr-3 text-right">' + (v.mileage != null ? v.mileage.toLocaleString('en-GB') : '') + '</td>';
            html += '<td class="py-1.5 pr-3">' + _tipoBadge(v.tipo) + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc((_engineLabels || {})[v.engine] || v.engine || '') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        body.innerHTML = html;
        _showModal(modal);
    };

    // Show blocked / sem KM / defleet vehicles modal
    window.fpShowBlocked = function (poolIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const vehicles = pool.blocked_vehicles || [];

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        title.textContent = poolKey + " — On Hold / Mileage Limit / Defleet — " + vehicles.length + " vehicles";

        if (!vehicles.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No vehicles on hold.</div>";
            _showModal(modal);
            return;
        }

        const _reasonLabels = { 'bloqueado': "On Hold", 'mileage exhausted': "Mileage exhausted", 'defleet': 'Defleet' };
        const _reasonColors = { 'bloqueado': 'text-red-400', 'mileage exhausted': 'text-orange-400', 'defleet': 'text-purple-400' };
        const sorted = vehicles.slice().sort(function (a, b) {
            var cmp = (a.reason || '').localeCompare(b.reason || '');
            if (cmp !== 0) return cmp;
            cmp = (a.group || '').localeCompare(b.group || '');
            return cmp !== 0 ? cmp : (a.plate || '').localeCompare(b.plate || '');
        });

        // Summary by reason
        const byReason = {};
        sorted.forEach(function (v) { byReason[v.reason] = (byReason[v.reason] || 0) + 1; });
        let summaryHtml = '<div class="flex gap-4 mb-3 text-xs">';
        Object.entries(byReason).forEach(function (e) {
            const lbl = _reasonLabels[e[0]] || e[0];
            const clr = _reasonColors[e[0]] || 'text-gray-400';
            summaryHtml += '<span class="' + clr + ' font-semibold">' + lbl + ': ' + e[1] + '</span>';
        });
        summaryHtml += '</div>';

        let html = summaryHtml;
        html += '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += "<th class=\"pb-2 pr-3 pl-1\">Station</th>";
        html += "<th class=\"pb-2 pr-3\">License Plate</th>";
        html += "<th class=\"pb-2 pr-3\">Group</th>";
        html += "<th class=\"pb-2 pr-3\">Vehicle</th>";
        html += "<th class=\"pb-2 pr-3\">Reason</th>";
        html += "<th class=\"pb-2 pr-3\">Alert</th>";
        html += "<th class=\"pb-2 pr-3 text-right\">Remaining km</th>";
        html += '<th class="pb-2 pr-3 text-right">KM Total</th>';
        html += "<th class=\"pb-2 pr-3 text-right\">Days Defleet</th>";
        html += "<th class=\"pb-2 pr-3\">Type</th>";
        html += '<th class="pb-2 pr-3">Parking</th>';
        html += '<th class="pb-2 pr-3">Engine</th>';
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        sorted.forEach(function (v) {
            const reasonLabel = _reasonLabels[v.reason] || v.reason || '';
            const reasonColor = _reasonColors[v.reason] || 'text-gray-400';
            const alarm = _fpAlarm(v.plate);
            const remainDays = _remainDays(v.defleet);
            const remainClass = remainDays !== '' && remainDays <= 0 ? 'text-red-400 font-semibold' : remainDays !== '' && remainDays <= 30 ? 'text-orange-400' : '';
            const engineLabel = _engineLabels[v.engine] || v.engine || '';
            const kmRemain = v.remaining_km != null ? v.remaining_km.toLocaleString('en-GB') : '';
            const kmClass = v.remaining_km != null && v.remaining_km < 250 ? 'text-red-400 font-semibold' : '';

            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
            html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap">' + _esc(v.station || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(window.nafGetCarModel(v) || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap font-semibold ' + reasonColor + '">' + _esc(reasonLabel) + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap' + (alarm ? ' text-red-500 font-semibold' : '') + '">' + (alarm ? _esc(alarm) : '—') + '</td>';
            html += '<td class="py-1.5 pr-3 text-right ' + kmClass + '">' + kmRemain + '</td>';
            html += '<td class="py-1.5 pr-3 text-right">' + (v.mileage != null ? v.mileage.toLocaleString('en-GB') : '') + '</td>';
            html += '<td class="py-1.5 pr-3 text-right ' + remainClass + '">' + (remainDays !== '' ? remainDays : '') + '</td>';
            html += '<td class="py-1.5 pr-3">' + _tipoBadge(v.tipo) + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap text-gray-500">' + _esc(v.parking || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(engineLabel) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        body.innerHTML = html;
        _showModal(modal);
    };

    // Show no-show reservations modal
    window.fpShowNoShow = function (poolIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const details = pool.no_show_details || [];

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        title.textContent = poolKey + ' \u2014 No-Show \u2014 ' + details.length + " reservations";

        if (!details.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No no-shows.</div>";
            _showModal(modal);
            return;
        }

        // Summary by group
        const byGrp = {};
        details.forEach(function (d) { byGrp[d.group] = (byGrp[d.group] || 0) + 1; });
        let summaryHtml = '<div class="flex gap-3 mb-3 text-xs flex-wrap">';
        Object.entries(byGrp).sort(function (a, b) { return b[1] - a[1]; }).forEach(function (e) {
            summaryHtml += '<span class="text-yellow-500 font-semibold">' + _esc(e[0]) + ': ' + e[1] + '</span>';
        });
        summaryHtml += '</div>';

        const sorted = details.slice().sort(function (a, b) {
            return (a.pick_time || '').localeCompare(b.pick_time || '') || (a.group || '').localeCompare(b.group || '');
        });

        let html = summaryHtml;
        html += '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += '<th class="pb-2 pr-3 pl-1">Pickup</th>';
        html += "<th class=\"pb-2 pr-3\">Reservation</th>";
        html += "<th class=\"pb-2 pr-3\">Group</th>";
        html += "<th class=\"pb-2 pr-3\">Station</th>";
        html += "<th class=\"pb-2 pr-3\">Return</th>";
        html += "<th class=\"pb-2 pr-3\">Duration</th>";
        html += '<th class="pb-2 pr-3">Status</th>';
        html += '<th class="pb-2 pr-3">Info</th>';
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        sorted.forEach(function (d) {
            const pickLabel = window.renaFormatDate(d.pick_time, false, '');
            const infoTags = [];
            if (d.is_lt) infoTags.push('<span class="text-orange-400">LT</span>');
            if (d.one_way) infoTags.push('<span class="text-blue-400">OW</span>');
            if (d.is_vip) infoTags.push('<span class="text-purple-400">VIP</span>');
            if (d.is_prepaid) infoTags.push('<span class="text-green-400">PP</span>');
            if (d.loyalty) infoTags.push('<span class="text-yellow-400">' + _esc(d.loyalty) + '</span>');
            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
            html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap font-semibold text-yellow-500">' + _esc(pickLabel) + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono">' + _esc(d.res_no || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(d.group || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(d.pick_station || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(d.ret_station || '') + '</td>';
            html += '<td class="py-1.5 pr-3 text-center">' + _esc(String(d.duration || '')) + '</td>';
            html += '<td class="py-1.5 pr-3">' + _esc(d.status || '') + '</td>';
            html += '<td class="py-1.5 pr-3">' + infoTags.join(' ') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        body.innerHTML = html;
        _showModal(modal);
    };

    // Show overdue returns modal: vehicles still on rent past their return date
    window.fpShowOverdueRet = function (poolIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const details = (pool.overdue_ret_details || []).slice().sort(function (a, b) {
            return (b.days_overdue || 0) - (a.days_overdue || 0) || (a.ret_time || '').localeCompare(b.ret_time || '');
        });

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        title.textContent = poolKey + " — Overdue Returns — " + details.length + " vehicles";

        if (!details.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No overdue returns.</div>";
            _showModal(modal);
            return;
        }

        // Store data on FP for copy helpers
        FP._overdueRetData = { poolKey: poolKey, details: details };

        // Group by station
        const byStation = {};
        details.forEach(function (d) {
            const stn = d.station || "Unknown";
            if (!byStation[stn]) byStation[stn] = [];
            byStation[stn].push(d);
        });
        const stationNames = Object.keys(byStation).sort(function (a, b) {
            return (byStation[b].length - byStation[a].length) || a.localeCompare(b);
        });

        // Summary pills by group
        const byGrp = {};
        details.forEach(function (d) { byGrp[d.group] = (byGrp[d.group] || 0) + 1; });
        let html = '<div class="flex flex-wrap gap-2 mb-3 items-center">';
        Object.entries(byGrp).sort(function (a, b) { return b[1] - a[1]; }).forEach(function (e) {
            html += '<span class="text-xs text-red-500 font-semibold">' + _esc(e[0]) + ': ' + e[1] + '</span>';
        });
        html += '<span class="flex-1"></span>';
        html += '<button onclick="fpCopyOverdueAll()" class="text-[0.65rem] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 flex items-center gap-1"><i class="fas fa-copy"></i> Copiar tudo</button>';
        html += '</div>';

        // One section per station
        stationNames.forEach(function (stn, si) {
            const rows = byStation[stn];
            const ltCount = rows.filter(function (r) { return r.is_lt; }).length;
            const badges = ltCount > 0 ? ' <span class="text-orange-400 text-[0.6rem]">LT: ' + ltCount + '</span>' : '';
            html += '<div class="mb-4">';
            html += '<div class="flex items-center gap-2 mb-1.5 border-b border-gray-700 pb-1">';
            html += '<span class="text-xs font-bold lynx-text-primary">' + _esc(stn) + '</span>';
            html += '<span class="text-[0.6rem] text-gray-400">(' + rows.length + ' viatur' + (rows.length === 1 ? 'a' : 'as') + ')</span>';
            html += badges;
            html += '<span class="flex-1"></span>';
            html += '<button onclick="fpCopyOverdueStation(' + si + ')" class="text-[0.6rem] px-1.5 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center gap-1"><i class="fas fa-copy"></i> Copiar</button>';
            html += '</div>';
            html += '<table class="w-full text-xs border-collapse">';
            html += '<thead><tr class="text-left text-[0.58rem] text-gray-500 uppercase tracking-wider">';
            html += '<th class="pb-1 pr-3 pl-1">Atraso</th>';
            html += "<th class=\"pb-1 pr-3\">License Plate</th>";
            html += "<th class=\"pb-1 pr-3\">Group</th>";
            html += "<th class=\"pb-1 pr-3\">Date Ret. Prev.</th>";
            html += "<th class=\"pb-1 pr-3\">N.º Contract</th>";
            html += "<th class=\"pb-1 pr-3\">Alert</th>";
            html += '<th class="pb-1 pr-3 text-center">LT</th>';
            html += '</tr></thead>';
            html += '<tbody class="lynx-text-primary">';
            rows.forEach(function (d) {
                const retLabel = window.renaFormatDate(d.ret_time, false, '');
                const daysLabel = d.days_overdue === 1 ? '1 dia' : (d.days_overdue || 0) + " days";
                const urgentCls = (d.days_overdue || 0) >= 3 ? 'text-red-500 font-bold' : (d.days_overdue || 0) >= 1 ? 'text-orange-400 font-semibold' : 'text-yellow-500';
                const alarm = _fpAlarm(d.plate);
                html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
                html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap ' + urgentCls + '"><i class="fas fa-clock mr-1"></i>' + _esc(daysLabel) + '</td>';
                html += '<td class="py-1.5 pr-3 font-mono font-semibold">' + _esc(d.plate || '') + '</td>';
                html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(d.group || '') + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(retLabel) + '</td>';
                html += '<td class="py-1.5 pr-3 font-mono">' + _esc(d.ra_number || '') + '</td>';
                html += '<td class="py-1.5 pr-3 whitespace-nowrap' + (alarm ? ' text-red-500 font-semibold' : '') + '">' + (alarm ? _esc(alarm) : '—') + '</td>';
                html += '<td class="py-1.5 pr-3 text-center">' + (d.is_lt ? '<span class="text-orange-400">LT</span>' : '') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        });

        body.innerHTML = html;
        _showModal(modal);
    };

    // Copy helpers for overdue returns
    function _overdueRowsToText(rows, header) {
        const today = window.renaFormatDate(new Date(), true);
        let lines = [header, "Generated by RENA on " + today, ''];
        lines.push("License Plate\tGroup\tStation\tDate Ret. Prevista\tAtraso (days)\tN.º Contract\tLT");
        rows.forEach(function (d) {
            const retLabel = window.renaFormatDate(d.ret_time, false, '');
            lines.push([
                d.plate || '',
                d.group || '',
                d.station || '',
                retLabel,
                d.days_overdue || 0,
                d.ra_number || '',
                d.is_lt ? 'LT' : ''
            ].join('\t'));
        });
        return lines.join('\n');
    }

    window.fpCopyOverdueAll = function () {
        if (!FP._overdueRetData) return;
        const { poolKey, details } = FP._overdueRetData;
        const text = _overdueRowsToText(details, 'RETOMAS EM ATRASO \u2014 ' + poolKey + ' \u2014 ' + details.length + " vehicles");
        navigator.clipboard.writeText(text).then(function () {
            _showCopyToast('Lista copiada (' + details.length + " vehicles) — ready to paste into Excel or email");
        }).catch(function () {
            _showCopyToast("Could not copy to clipboard", true);
        });
    };

    window.fpCopyOverdueStation = function (stationIdx) {
        if (!FP._overdueRetData) return;
        const { poolKey, details } = FP._overdueRetData;
        const byStation = {};
        details.forEach(function (d) {
            const stn = d.station || "Unknown";
            if (!byStation[stn]) byStation[stn] = [];
            byStation[stn].push(d);
        });
        const stationNames = Object.keys(byStation).sort(function (a, b) {
            return (byStation[b].length - byStation[a].length) || a.localeCompare(b);
        });
        const stn = stationNames[stationIdx];
        if (!stn) return;
        const rows = byStation[stn];
        const text = _overdueRowsToText(rows, 'RETOMAS EM ATRASO \u2014 ' + stn + ' \u2014 ' + rows.length + " vehicles");
        navigator.clipboard.writeText(text).then(function () {
            _showCopyToast("Copied " + rows.length + " vehicles from " + stn);
        }).catch(function () {
            _showCopyToast("Could not copy to clipboard", true);
        });
    };

    function _showCopyToast(msg, isError) {
        let toast = document.getElementById('fpCopyToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'fpCopyToast';
            toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-4 py-2 rounded-lg text-sm font-medium shadow-lg pointer-events-none transition-opacity duration-300';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.className = toast.className.replace(/bg-\S+/g, '');
        toast.classList.add(isError ? 'bg-red-700' : 'bg-green-700', 'text-white', 'opacity-100');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function () { toast.classList.remove('opacity-100'); toast.classList.add('opacity-0'); }, 2500);
    }

    // Show repair-retomas modal: all reservations/fleet returning to repair centres in the window
    window.fpShowRepairRetomas = function (poolIdx) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        // Collect all repair_in_details across all dates, with date annotation
        const allItems = [];
        (pool.rows || []).forEach(function (row) {
            (row.repair_in_details || []).forEach(function (d) {
                allItems.push(Object.assign({}, d, { _date: row.date }));
            });
        });

        const total = allItems.length;
        title.textContent = poolKey + " — Workshop Returns — " + total + " during the period";

        if (!total) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No workshop returns during this period.</div>";
            _showModal(modal);
            return;
        }

        // Summary by group
        const byGrp = {};
        allItems.forEach(function (d) { byGrp[d.group] = (byGrp[d.group] || 0) + 1; });
        let html = '<div class="flex gap-3 mb-3 text-xs flex-wrap">';
        Object.entries(byGrp).sort(function (a, b) { return b[1] - a[1]; }).forEach(function (e) {
            html += '<span class="text-pink-400 font-semibold">' + _esc(e[0]) + ': ' + e[1] + '</span>';
        });
        html += '</div>';

        // Sort by date then time
        const sorted = allItems.slice().sort(function (a, b) {
            const da = (a._date || '') + (a.ret_time || a.pick_time || '');
            const db = (b._date || '') + (b.ret_time || b.pick_time || '');
            return da.localeCompare(db);
        });

        html += '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += "<th class=\"pb-2 pr-3 pl-1\">Date</th>";
        html += "<th class=\"pb-2 pr-3\">Type</th>";
        html += "<th class=\"pb-2 pr-3\">Group</th>";
        html += "<th class=\"pb-2 pr-3\">License Plate</th>";
        html += '<th class="pb-2 pr-3">Pickup</th>';
        html += "<th class=\"pb-2 pr-3\">Workshop (Return)</th>";
        html += "<th class=\"pb-2 pr-3\">Time</th>";
        html += "<th class=\"pb-2 pr-3\">Reservation / Contract</th>";
        html += "<th class=\"pb-2 pr-3 text-right\">Duration</th>";
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        sorted.forEach(function (d) {
            const isRes = d.type === 'res';
            const typeBadge = isRes
                ? '<span class="text-blue-400 font-semibold">Res</span>'
                : "<span class=\"text-green-400 font-semibold\">Fleet</span>";
            const dateLabel = d._date ? _fmtDate(d._date) : '';
            const timeStr = isRes ? _fmtTime(d.ret_time || '') : _fmtTime(d.ret_time || '');
            const pickStn = isRes ? (d.pick_station || '') : (d.station || '');
            const retStn = isRes ? (d.ret_station || '') : (d.station || '');
            const resNo = isRes ? (d.res_no || '') : (d.ra_number || '');
            const plate = isRes ? (d.plate || '') : (d.plate || '');
            const dur = isRes ? (d.duration != null ? String(d.duration) : '') : '';

            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
            html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap font-semibold text-pink-400">' + _esc(dateLabel) + '</td>';
            html += '<td class="py-1.5 pr-3">' + typeBadge + '</td>';
            html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(d.group || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">' + _esc(plate) + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(isRes ? pickStn : '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap text-pink-300">' + _esc(retStn) + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono whitespace-nowrap">' + _esc(timeStr) + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono">' + _esc(resNo) + '</td>';
            html += '<td class="py-1.5 pr-3 text-right">' + _esc(dur) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        body.innerHTML = html;
        _showModal(modal);
    };

    // Display a full date/time; calculations keep the original ISO value.
    function _fmtTime(dtStr) {
        return _esc(window.renaFormatDate(dtStr));
    }

    // Show reservation detail modal for RES (out) or DROP (in) cells
    window.fpShowReservations = function (poolIdx, dayIdx, direction) {
        const names = FP._lastDisplayNames;
        const dp = FP._lastDisplayPools;
        if (!names || !dp || poolIdx >= names.length) return;
        const poolKey = names[poolIdx];
        const pool = dp[poolKey];
        if (!pool) return;
        const row = (pool.rows || [])[dayIdx];
        if (!row) return;

        const modal = document.getElementById('fpVehicleModal');
        const title = document.getElementById('fpVehicleModalTitle');
        const body = document.getElementById('fpVehicleModalBody');
        if (!modal || !body) return;

        let items = [];
        let titlePrefix = '';
        let isFleetSection = false;

        if (direction === 'out') {
            items = row.res_out_details || [];
            titlePrefix = "Reservations (pickups)";
        } else {
            // IN = fleet returns + reservation returns (exclude LT and defleet)
            const resItems = (row.res_in_details || []).filter(d => !d.is_lt).map(d => Object.assign({_type: 'res'}, d));
            const fleetItems = (row.fleet_in_details || []).filter(d => !d.is_lt && !d.will_defleet && !d.will_exceed_km).map(d => Object.assign({_type: 'fleet'}, d));
            items = resItems.concat(fleetItems);
            titlePrefix = 'Retomas (entrada)';
            isFleetSection = fleetItems.length > 0;
        }

        const dateLabel = row.date ? _fmtDate(row.date) : '';
        title.textContent = poolKey + ' — ' + titlePrefix + ' — ' + dateLabel + ' [' + items.length + ']';

        if (!items.length) {
            body.innerHTML = "<div class=\"text-center text-gray-400 py-8\">No records.</div>";
            _showModal(modal);
            return;
        }

        let html = '';

        if (direction === 'out') {
            // Reservation pick-ups table
            const sorted = items.slice().sort((a, b) => (a.pick_time || '').localeCompare(b.pick_time || ''));
            html += _buildResTable(sorted, 'pick');
        } else {
            // Split into reservation returns and fleet returns
            const resItems = items.filter(d => d._type === 'res');
            const fleetItems = items.filter(d => d._type === 'fleet');

            if (resItems.length) {
                html += "<div class=\"text-[0.65rem] font-bold text-blue-400 uppercase tracking-wider mb-2\"><i class=\"fas fa-calendar-check mr-1\"></i>Reservations (" + resItems.length + ')</div>';
                const sorted = resItems.slice().sort((a, b) => (a.ret_time || '').localeCompare(b.ret_time || ''));
                html += _buildResTable(sorted, 'ret');
            }
            if (fleetItems.length) {
                if (resItems.length) html += '<div class="mt-4"></div>';
                const kmExcluded = fleetItems.filter(v => v.will_exceed_km).length;
                const kmNote = kmExcluded ? ' <span class="text-red-400 normal-case font-normal">— ' + kmExcluded + ' excede KM <i class="fas fa-wrench"></i></span>' : '';
                html += "<div class=\"text-[0.65rem] font-bold text-green-400 uppercase tracking-wider mb-2\"><i class=\"fas fa-car mr-1\"></i>Fleet / Contracts (" + fleetItems.length + ')' + kmNote + '</div>';
                html += _buildFleetRetTable(fleetItems);
            }
        }

        body.innerHTML = html;
        _showModal(modal);
    };

    // Build reservation table HTML
    function _buildResTable(items, mode) {
        let html = '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += "<th class=\"pb-2 pr-3 pl-1\">Pickup Station</th>";
        html += "<th class=\"pb-2 pr-3\">Time</th>";
        html += "<th class=\"pb-2 pr-3\">Return Station</th>";
        html += "<th class=\"pb-2 pr-3\">N.º Reservation</th>";
        html += "<th class=\"pb-2 pr-3\">Group</th>";
        html += "<th class=\"pb-2 pr-3 text-right\">Duration</th>";
        html += '<th class="pb-2 pr-3">Status</th>';
        html += '<th class="pb-2 pr-3 text-center">LT</th>';
        html += '<th class="pb-2 pr-3 text-center">OW</th>';
        html += '<th class="pb-2 pr-3 text-center">VIP</th>';
        html += '<th class="pb-2 pr-3 text-center">Prepaid</th>';
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        items.forEach(r => {
            const timeVal = mode === 'pick' ? _fmtTime(r.pick_time) : _fmtTime(r.ret_time);
            const owBadge = r.one_way ? '<span class="text-orange-400"><i class="fas fa-arrow-right"></i></span>' : '';
            const ltBadge = r.is_lt ? '<span class="text-purple-400"><i class="fas fa-check"></i></span>' : '';
            const vipBadge = r.is_vip ? '<span class="text-yellow-400"><i class="fas fa-star"></i></span>' : '';
            const prepaidBadge = r.is_prepaid ? '<span class="text-green-400"><i class="fas fa-check"></i></span>' : '';
            const durClass = r.duration && r.duration >= 30 ? 'text-purple-400 font-semibold' : '';

            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30">';
            html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap">' + _esc(r.pick_station || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap font-mono">' + _esc(timeVal) + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(r.ret_station || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono">' + _esc(r.res_no || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(r.group || '') + '</td>';
            html += '<td class="py-1.5 pr-3 text-right ' + durClass + '">' + (r.duration || '') + '</td>';
            html += '<td class="py-1.5 pr-3">' + _esc(r.status || '') + '</td>';
            html += '<td class="py-1.5 pr-3 text-center">' + ltBadge + '</td>';
            html += '<td class="py-1.5 pr-3 text-center">' + owBadge + '</td>';
            html += '<td class="py-1.5 pr-3 text-center">' + vipBadge + '</td>';
            html += '<td class="py-1.5 pr-3 text-center">' + prepaidBadge + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        return html;
    }

    // Build fleet return table HTML
    function _buildFleetRetTable(items) {
        const sorted = items.slice().sort((a, b) => (a.group || '').localeCompare(b.group || ''));
        let html = '<table class="w-full text-xs border-collapse">';
        html += '<thead class="sticky top-0 bg-lynx-subtle dark:bg-[#0A0A0A] z-10">';
        html += '<tr class="text-left text-[0.6rem] text-gray-400 uppercase tracking-wider">';
        html += "<th class=\"pb-2 pr-3 pl-1\">Station</th>";
        html += "<th class=\"pb-2 pr-3\">License Plate</th>";
        html += "<th class=\"pb-2 pr-3\">Group</th>";
        html += "<th class=\"pb-2 pr-3\">Vehicle</th>";
        html += "<th class=\"pb-2 pr-3\">Time Return</th>";
        html += "<th class=\"pb-2 pr-3\">Alert</th>";
        html += '<th class="pb-2 pr-3 text-right">KM Rest.</th>';
        html += '<th class="pb-2 pr-3 text-right">KM Prev.</th>';
        html += '<th class="pb-2 pr-3 text-center">LT</th>';
        html += '<th class="pb-2 pr-3 text-center">Defleet</th>';
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        sorted.forEach(v => {
            const ltBadge = v.is_lt ? '<span class="text-purple-400"><i class="fas fa-check"></i></span>' : '';
            const defleetBadge = v.will_defleet ? '<span class="text-red-400"><i class="fas fa-exclamation-triangle"></i></span>' : '';
            const retTime = _fmtTime(v.ret_time || '');
            const exceedKm = v.will_exceed_km;
            const alarm = _fpAlarm(v.plate);
            const rowClass = exceedKm
                ? 'border-b border-red-400/30 bg-red-900/10 hover:bg-red-900/20'
                : 'border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30';

            // KM columns — only shown for rented vehicles (remaining_km present)
            let kmRestHtml = '';
            let kmPrevHtml = '';
            if (v.remaining_km != null) {
                kmRestHtml = _esc(Math.round(v.remaining_km).toLocaleString('en-GB'));
                const pred = v.predicted_km != null ? Math.round(v.predicted_km) : null;
                if (pred != null) {
                    const cls = pred < 0 ? 'text-red-400 font-semibold' : 'text-green-400';
                    kmPrevHtml = '<span class="' + cls + '">' + _esc(pred.toLocaleString('en-GB')) + '</span>';
                    if (exceedKm) kmPrevHtml += " <i class=\"fas fa-wrench text-red-400 ml-1\" title=\"Workshop — excede KM\"></i>";
                }
            }

            html += '<tr class="' + rowClass + '">';
            html += '<td class="py-1.5 pr-3 pl-1 whitespace-nowrap">' + _esc(v.station || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">' + _esc(v.plate || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-semibold text-primary-500">' + _esc(v.group || '') + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap">' + _esc(window.nafGetCarModel(v) || '') + '</td>';
            html += '<td class="py-1.5 pr-3 font-mono whitespace-nowrap">' + _esc(retTime) + '</td>';
            html += '<td class="py-1.5 pr-3 whitespace-nowrap' + (alarm ? ' text-red-500 font-semibold' : '') + '">' + (alarm ? _esc(alarm) : '—') + '</td>';
            html += '<td class="py-1.5 pr-3 text-right font-mono">' + kmRestHtml + '</td>';
            html += '<td class="py-1.5 pr-3 text-right font-mono">' + kmPrevHtml + '</td>';
            html += '<td class="py-1.5 pr-3 text-center">' + ltBadge + '</td>';
            html += '<td class="py-1.5 pr-3 text-center">' + defleetBadge + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        return html;
    }

    // ── EVENTS ──────────────────────────────────────────────────
    window.fpTogglePoolPanel = function () {
        const panel = document.getElementById('fpPoolPanel');
        if (!panel) return;
        const vis = panel.classList.toggle('hidden');
        if (!vis) {
            setTimeout(() => {
                const closer = function (e) {
                    const dd = document.getElementById('fpPoolDropdown');
                    if (dd && !dd.contains(e.target)) {
                        panel.classList.add('hidden');
                        document.removeEventListener('click', closer);
                    }
                };
                document.addEventListener('click', closer);
            }, 0);
        }
    };

    window.fpTogglePool = function (cb) {
        const pool = cb.value;
        if (cb.checked) {
            if (!FP.selectedPools.includes(pool)) FP.selectedPools.push(pool);
        } else {
            FP.selectedPools = FP.selectedPools.filter(p => p !== pool);
        }
        _savePrefs();
        _renderPoolDropdown(true);
        _renderTable();
    };

    window.fpToggleStation = function (cb) {
        const sid = cb.value;
        if (cb.checked) {
            if (!FP.selectedStations.includes(sid)) FP.selectedStations.push(sid);
        } else {
            FP.selectedStations = FP.selectedStations.filter(s => s !== sid);
        }
        _savePrefs();
        _renderPoolDropdown(true);
        _renderTable();
    };

    window.fpToggleStationList = function (poolName) {
        const id = 'fpStns_' + poolName.replace(/\s/g, '_');
        const el = document.getElementById(id);
        if (el) {
            el.classList.toggle('hidden');
            if (el.classList.contains('hidden')) {
                FP.expandedPoolStns = FP.expandedPoolStns.filter(p => p !== poolName);
            } else if (!FP.expandedPoolStns.includes(poolName)) {
                FP.expandedPoolStns.push(poolName);
            }
        }
    };

    window.fpTogglePoolFolder = function (nome) {
        const folders = (FP.data && FP.data.pool_folders) || [];
        const f = folders.find(x => x.nome === nome);
        if (!f) return;
        const fPools = (f.pools || []).filter(p => (FP.data.pool_names || []).includes(p));
        const allSel = fPools.every(p => FP.selectedPools.includes(p));
        if (allSel) {
            fPools.forEach(p => { FP.selectedPools = FP.selectedPools.filter(x => x !== p); });
        } else {
            fPools.forEach(p => { if (!FP.selectedPools.includes(p)) FP.selectedPools.push(p); });
        }
        _savePrefs();
        _renderPoolDropdown(true);
        _renderTable();
    };

    window.fpToggleRegion = function (cb) {
        const region = cb.value;
        if (cb.checked) {
            if (!FP.selectedRegions.includes(region)) FP.selectedRegions.push(region);
        } else {
            FP.selectedRegions = FP.selectedRegions.filter(r => r !== region);
        }
        _savePrefs();
        _renderPoolDropdown(true);
        _renderTable();
    };

    window.fpSetView = function (view) {
        // Accept both old boolean values (backwards-compat) and new string values
        const v = view === true ? 'regions' : view === false ? 'pools' : String(view);
        FP.nationalView = v === 'national';
        FP.regionView   = v === 'regions';
        // Auto-select all regions on first switch if none selected
        if (FP.regionView && FP.selectedRegions.length === 0 && FP.data) {
            FP.selectedRegions = (FP.data.planning_regions || []).map(r => r.nome);
        }
        _savePrefs();
        _renderFilters();
        _renderTable();
    };

    window.fpSelectAllPools = function () {
        if (!FP.data) return;
        if (FP.nationalView) {
            // National has no pool selector
        } else if (FP.regionView) {
            const extraFolders = FP.data.pool_folders || [];
            FP.selectedRegions = [
                ...(FP.data.planning_regions || []).map(r => r.nome),
                ...extraFolders.map(f => f.nome),
            ];
        } else {
            FP.selectedPools = FP.data.pool_names.slice();
        }
        _savePrefs();
        _renderPoolDropdown(true);
        _renderTable();
    };

    window.fpDeselectAllPools = function () {
        if (FP.nationalView) {
            // National has no pool selector
        } else if (FP.regionView) {
            FP.selectedRegions = [];
        } else {
            FP.selectedPools = [];
            FP.selectedStations = [];
        }
        _savePrefs();
        _renderPoolDropdown(true);
        _renderTable();
    };

    window.fpToggleGroupPanel = function () {
        const bar = document.getElementById('fpGroupFilterBar');
        const chevron = document.getElementById('fpGroupBtnChevron');
        if (!bar) return;
        const isHidden = bar.classList.contains('hidden');
        if (isHidden) {
            bar.classList.remove('hidden');
            if (chevron) chevron.style.transform = 'rotate(180deg)';
        } else {
            bar.classList.add('hidden');
            if (chevron) chevron.style.transform = '';
        }
    };

    window.fpToggleGroup = function (code) {
        const idx = FP.selectedGroups.indexOf(code);
        if (idx >= 0) FP.selectedGroups.splice(idx, 1);
        else FP.selectedGroups.push(code);
        _savePrefs();
        _renderGroupDropdown(true);
        _renderTable();
    };

    window.fpToggleCategory = function (catName) {
        const cats = (FP.data && FP.data.acriss_categories) || [];
        const allGroups = (FP.data && FP.data.zgroups) || [];
        const cat = cats.find(c => c.nome === catName);
        if (!cat) return;
        // Only operate on groups that actually exist in the fleet data
        const codes = (cat.groups || []).filter(g => allGroups.includes(g));
        const allSelected = codes.every(c => FP.selectedGroups.includes(c));
        if (allSelected) {
            // Remove all codes of this category
            codes.forEach(c => { const i = FP.selectedGroups.indexOf(c); if (i >= 0) FP.selectedGroups.splice(i, 1); });
        } else {
            // Add missing codes
            codes.forEach(c => { if (!FP.selectedGroups.includes(c)) FP.selectedGroups.push(c); });
        }
        _savePrefs();
        _renderGroupDropdown(true);
        _renderTable();
    };

    window.fpGroupsClear = function () {
        FP.selectedGroups = [];
        _savePrefs();
        _renderGroupDropdown(true);
        _renderTable();
    };

    window.fpGroupTextChanged = function (val) {
        const allGroups = (FP.data && FP.data.zgroups) || [];
        const parts = val.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(function (s) { return s.length > 0; });
        FP.selectedGroups = parts.filter(function (g) { return allGroups.includes(g); });
        _savePrefs();
        // Update checkboxes in-place without rebuilding the text input
        var panel = document.getElementById('fpGroupFilterBar');
        if (panel) {
            panel.querySelectorAll('.fp-grp-cb').forEach(function (cb) {
                cb.checked = FP.selectedGroups.includes(cb.value);
            });
            // Update category checkboxes
            var cats = (FP.data && FP.data.acriss_categories) || [];
            panel.querySelectorAll('.fp-cat-cb').forEach(function (cb, idx) {
                if (idx < cats.length) {
                    var codes = cats[idx].groups || [];
                    var validCodes = codes.filter(function (c) { return allGroups.includes(c); });
                    var allSel = validCodes.every(function (c) { return FP.selectedGroups.includes(c); });
                    var someSel = !allSel && validCodes.some(function (c) { return FP.selectedGroups.includes(c); });
                    cb.checked = allSel;
                    cb.indeterminate = someSel;
                }
            });
        }
        // Update button label
        var btn = document.getElementById('fpGroupBtn');
        if (btn) {
            var count = FP.selectedGroups.length;
            var lbl = count === 0 ? "All Groups" : count <= 3 ? FP.selectedGroups.join(', ') : count + " selected groups";
            btn.innerHTML = '<i class="fas fa-car mr-1 text-primary-500"></i>' + _esc(lbl) + ' <i class="fas fa-chevron-down text-[0.5rem] ml-1 text-gray-400"></i>';
        }
        _renderTable();
    };

    window.fpChangeDays = function () {
        FP.days = parseInt(document.getElementById('fpDaysFilter')?.value || '30', 10);
        _savePrefs();
        _fetchData();
    };

    // Build the same displayNames/displayPools mapping used in _renderTable
    function _getDisplayData() {
        if (!FP.data || !FP.data.pools) return { names: [], pools: {} };
        const allPools = FP.data.pools;
        const allStations = FP.data.stations || {};
        const stationNames = {};
        // Build station name lookup from pool_stations
        Object.values(FP.data.pool_stations || {}).forEach(stns => {
            stns.forEach(s => { stationNames[s.id] = s.nome; });
        });
        const regions = FP.data.planning_regions || [];
        const sel = FP.selectedGroups && FP.selectedGroups.length ? FP.selectedGroups : null;
        let names = [];
        let pools = {};

        if (FP.nationalView) {
            // Collect island pools from folders named "Ilhas" or with island icon
            const folders = FP.data.pool_folders || [];
            const islandPools = new Set();
            folders.forEach(f => {
                if ((f.nome || '').toLowerCase().includes('ilha') || (f.icon || '').includes('island')) {
                    (f.pools || []).forEach(p => islandPools.add(p));
                }
            });
            const nationalPools = (FP.data.pool_names || []).filter(p => !islandPools.has(p) && allPools[p]);
            if (nationalPools.length) {
                const merged = _mergePools(nationalPools, allPools);
                if (merged) { names.push("National"); pools["National"] = _filterPool(merged, sel); }
            }
        } else if (FP.regionView && regions.length) {
            // Valid region names = planning_regions + every pool_folder
            // (Ilhas included — only National stays continental-only)
            const extraFolders = FP.data.pool_folders || [];
            FP.selectedRegions.forEach(rn => {
                // Look up in planning_regions first, then pool_folders
                const src = regions.find(r => r.nome === rn) || extraFolders.find(f => f.nome === rn);
                if (!src) return;
                const merged = _mergePools(src.pools || [], allPools);
                if (merged) { names.push(rn); pools[rn] = _filterPool(merged, sel); }
            });
        } else {
            names = FP.selectedPools.filter(p => allPools[p]);
            names.forEach(p => { pools[p] = _filterPool(allPools[p], sel); });
        }

        // Add selected individual stations as their own columns
        FP.selectedStations.forEach(sid => {
            if (!allStations[sid]) return;
            const sName = stationNames[sid] || sid;
            const key = '📍 ' + sName;
            names.push(key);
            pools[key] = _filterPool(allStations[sid], sel);
        });

        return { names, pools };
    }

    window.fpRefreshInfleet = function (silent) {
        if (FP._infleetRefreshing) return;
        FP._infleetRefreshing = true;
        // Optimistically update local status so the indicator appears immediately
        FP._infleetFetchStatus = { active: true, user: 'eu', me: true };
        const btn = document.getElementById('fpInfleetBtn');
        if (!silent) {
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A atualizar...'; }
        }
        fetch('/api/infleet/refresh', { method: 'POST' })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    // Reload infleet data into FP state
                    return fetch('/api/infleet/data').then(r2 => r2.json()).then(d2 => {
                        FP.infleet = d2;
                        FP._infleetFetchStatus = data.infleet_fetch_status || { active: false };
                        _buildInfleetLookups();
                        _renderTable();
                        _renderFilters(); // update info bar with new infleet time
                        if (!silent && btn) {
                            btn.innerHTML = '<i class="fas fa-truck-loading"></i> Infleet <i class="fas fa-check text-green-400 ml-1"></i>';
                            setTimeout(() => { if (btn) btn.innerHTML = '<i class="fas fa-truck-loading"></i> Infleet'; }, 3000);
                        }
                    });
                } else {
                    FP._infleetFetchStatus = { active: false };
                    if (!silent) alert("Could not refresh fleet additions: " + (data.error || 'desconhecido'));
                }
            })
            .catch(err => {
                FP._infleetFetchStatus = { active: false };
                if (!silent) alert("Network error while refreshing fleet additions: " + err.message);
            })
            .finally(() => {
                FP._infleetRefreshing = false;
                if (!silent && btn) btn.disabled = false;
            });
    };

    // Check if infleet needs automatic daily refresh (after 08:00, not yet refreshed today after 08:00)
    function _infleetNeedsAutoRefresh() {
        const now = new Date();
        if (now.getHours() < 8) return false;
        // If someone else is already refreshing, skip — their result will be in shared cache
        const ifs = FP._infleetFetchStatus || {};
        if (ifs.active && !ifs.me) return false;
        if (!FP.infleet || !FP.infleet.refreshed_at) return true;
        const today = now.toISOString().slice(0, 10);
        const ra = FP.infleet.refreshed_at || '';
        if (ra.slice(0, 10) !== today) return true;       // stale: different day
        if (parseInt(ra.slice(11, 13), 10) < 8) return true; // refreshed before 08:00 today
        return false;
    }

    function _infleetMaybeAutoRefresh() {
        const canLynx = window.RENA_ME ? window.RENA_ME.can_lynx : true;
        if (canLynx && _infleetNeedsAutoRefresh()) fpRefreshInfleet(true);
    }

    window.fpExportCSV = function () {
        const { names, pools } = _getDisplayData();
        if (!names.length) return;

        const sep = ';';
        let csv = "Date";
        names.forEach(p => { csv += sep + p + ' Infleet' + sep + p + " Balance" + sep + p + ' RES' + sep + p + ' DROP' + sep + p + ' Min' + sep + p + ' LT' + sep + p + ' Defleet'; });
        csv += '\n';

        const firstPool = pools[names[0]];
        (firstPool.rows || []).forEach((_, idx) => {
            const dt = firstPool.rows[idx].date;
            csv += window.renaFormatDate(dt, true);
            names.forEach(pname => {
                const row = (pools[pname].rows || [])[idx] || {};
                const totalIn = (row.fleet_in || 0) + (row.res_in || 0) - (row.defleet_out || 0);
                const totalLt = (row.fleet_in_lt || 0) + (row.res_in_lt || 0);
                const dmVal = row.daymin != null ? row.daymin : '';
                const inflData = _getInfleetForDate(pname, dt);
                const inflCount = inflData ? inflData.total : 0;
                csv += sep + (inflCount || '') + sep + (row.saldo != null ? row.saldo : '') + sep + (row.res_out || '') + sep + (totalIn || '') + sep + dmVal + sep + (totalLt || '') + sep + ((row.defleet_out || 0) + (row.rented_defleet || 0) || '');
            });
            csv += '\n';
        });

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'fleet_planning_' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    // ── INIT ────────────────────────────────────────────────────
    window.planningInit = function () {
        _loadPrefs();
        _fetchData();
        _fpEnsureMasterData();  // fire-and-forget — ready by the time a modal is opened
    };

})();
