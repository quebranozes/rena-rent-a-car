/* ══════════════ R.E.N.A. — Shared Utilities ══════════════ */
(function () {
    'use strict';

    // ── HTML Escape ─────────────────────────────────────────────
    window.nafEsc = function (str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };

    // ── SubStatus Formatting ────────────────────────────────────
    window.nafFormatSubStatus = function (ss) {
        if (!ss) return '—';
        return ss.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    };

    window.nafSubStatusClass = function (ss) {
        if (!ss) return 'other';
        const u = ss.toUpperCase();
        if (u.includes('MAINTENANCE') || u.includes('WORKSHOP') || u.includes('REPAIR')) return 'maintenance';
        if (u.includes('DAMAGE')) return 'damage';
        if (u.includes('HOLD'))  return 'hold';
        if (u.includes('DELIVERY') || u === 'DELIVERY_CONTRACT_CREATED') return 'delivery';
        if (u.includes('PREPARATION') || u.includes('PREP') || u.includes('CLEANING')) return 'prep';
        return 'other';
    };

    // ── Date Helpers ────────────────────────────────────────────
    window.nafDaysDiff = function (dateStr) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d)) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        d.setHours(0, 0, 0, 0);
        return Math.round((d - today) / 86400000);
    };

    window.nafDaysAgo = function (dateStr) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d)) return null;
        return Math.round((Date.now() - d.getTime()) / 86400000);
    };

    // ── Fuel Label ──────────────────────────────────────────────
    window.nafFuelLabel = function (code) {
        const map = { U: "Petrol", D: 'Diesel', E: "Electric", H: "Hybrid",
                      P: 'GPL', N: 'GNV', B: 'Biodiesel', M: "Mixed" };
        return map[(code || '').toUpperCase()] || (code || '—');
    };

    // ── Plate Normalization (dash/space/case-agnostic) ───────────
    // Used to match plates across sources that don't format them identically
    // (e.g. Demo's licensePlate vs SAP's LICENCE_PLATE).
    window.nafNormPlate = function (s) {
        return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    };

    // ── Car Model (Marca/Modelo, sourced from Demo) ───────
    // Shared across every page (Fleet, Planning, …) so they all show the
    // exact same text for a given plate instead of each page picking its
    // own source. Loaded once (triggered from the shared fleet-data bootstrap
    // in data.js); pages that render before it resolves should register a
    // callback via nafOnCarModelUpdate to re-render once it's ready.
    let _nafCarModelCache = {};  // { normPlate: CAR_DESCRIPTION }
    let _nafBrandMapCache = {};  // { BRAND_CODE: 'Display Name' } — editable in Settings
    const _nafCarModelListeners = [];

    function _nafNotifyCarModelListeners() {
        _nafCarModelListeners.forEach(fn => { try { fn(); } catch (e) { /* listener's problem */ } });
    }

    window.nafOnCarModelUpdate = function (fn) {
        if (typeof fn === 'function') _nafCarModelListeners.push(fn);
    };

    window.nafLoadCarModelData = async function () {
        try {
            const res = await fetch((window.API_BASE || '') + '/api/car-model/data');
            if (!res.ok) return;
            const json = await res.json();
            if (json.success && json.data) {
                _nafCarModelCache = json.data;
                _nafNotifyCarModelListeners();
            }
        } catch (e) { console.warn('Car model load error:', e); }
    };

    window.nafLoadBrandMap = async function () {
        try {
            const res = await fetch((window.API_BASE || '') + '/api/brand-abbreviations');
            if (!res.ok) return;
            const json = await res.json();
            if (json.success && json.data) {
                _nafBrandMapCache = json.data;
                _nafNotifyCarModelListeners();
            }
        } catch (e) { console.warn('Brand map load error:', e); }
    };

    // Let the Settings "Marcas" tab push its edits live everywhere, without a
    // full page reload.
    window.nafSetBrandMap = function (map) { _nafBrandMapCache = map || {}; _nafNotifyCarModelListeners(); };

    // Only the brand code (first token) gets swapped for its full name via
    // the Settings "Marcas" map — everything else (model, body type, fuel,
    // transmission codes like HBP/PET/MAN) is kept exactly as SAP sends it.
    // Unmapped brand codes are left untouched too (no guessing).
    function _nafFormatCarDescription(desc) {
        const toks = String(desc || '').trim().split(/\s+/).filter(Boolean);
        if (!toks.length) return '';
        const brandTok = toks[0];
        const brand = _nafBrandMapCache[brandTok.toUpperCase()] || brandTok;
        const rest = toks.slice(1).join(' ');
        return rest ? `${brand} ${rest}` : brand;
    }

    // v can be a vehicle object or a bare plate string. Different pages name
    // the plate field differently — Fleet's raw Demo objects use
    // `licensePlate`, Planning's distilled per-modal dicts use `plate` — so
    // check both instead of assuming one. Falls back to Demo's own
    // displayName/name when the plate isn't in the SAP data yet (brand-new
    // vehicle, or first daily fetch hasn't run).
    window.nafGetCarModel = function (v) {
        const plate = typeof v === 'string' ? v : (v && (v.licensePlate || v.plate));
        const desc = _nafCarModelCache[nafNormPlate(plate)];
        if (desc) return _nafFormatCarDescription(desc);
        if (v && typeof v === 'object') return v.displayName || v.name || '';
        return '';
    };

    // ── Branch ID Helpers ───────────────────────────────────────
    window._nafBranchId = function (b) {
        return String((b && (b.id || b.number)) || '');
    };

    window._nafEffectiveBranch = function (v) {
        if (v.classicStatus === 0 && v.returnBranch && _nafBranchId(v.returnBranch)) {
            return {
                number: _nafBranchId(v.returnBranch),
                name: v.returnBranch.name || '',
                poolName: (v.returnBranch.poolName || v.branch && v.branch.poolName) || ''
            };
        }
        const b = v.branch || {};
        return { number: _nafBranchId(b), name: b.name || '', poolName: b.poolName || '' };
    };

    // ── Vehicle Zone / Branch Helpers (use station config) ──────
    window._nafGetVehicleZone = function (v) {
        const stations = NAF_STATION_CFG.stations || {};
        const bid = _nafBranchId(v.branch);
        if (bid && stations[bid]) return stations[bid].zona || '';
        const pool = (v.branch && v.branch.poolName) || '';
        const pl = pool.toLowerCase();
        if (pl.includes('porto') || pl.includes('norte')) return "North";
        if (pl.includes('lisbo') || pl.includes('centro')) return "Central";
        if (pl.includes('faro') || pl.includes('sul') || pl.includes('algarve')) return "South";
        if (pl.includes('madeira') || pl.includes('açores') || pl.includes('acores') || pl.includes('ilha')) return "Islands";
        return '';
    };

    window._nafGetBranchName = function (v) {
        const stations = NAF_STATION_CFG.stations || {};
        const bid = _nafBranchId(v.branch);
        if (bid && stations[bid]) return stations[bid].nome || (v.branch && v.branch.name) || '—';
        return (v.branch && v.branch.name) || '—';
    };

    window._nafIsOficinaStation = function (v) {
        const stations = NAF_STATION_CFG.stations || {};
        const bid = _nafBranchId(v.branch);
        if (bid && stations[bid]) {
            const tipo = (stations[bid].tipo || '').toLowerCase();
            return tipo === 'oficina';
        }
        return false;
    };

    // ── Defleet / Remaining KM Helpers ──────────────────────────
    window._nafDaysToDefleet = function (v) {
        if (!v.defleetDate) return null;
        const d = new Date(v.defleetDate);
        if (isNaN(d)) return null;
        return Math.round((d.getTime() - Date.now()) / 86400000);
    };

    window._nafRemainingKm = function (v) {
        if (v.holdRemainingMileage != null && v.holdRemainingMileage > 0) return v.holdRemainingMileage;
        if (v.remainingMileage != null && v.remainingMileage > 0) return v.remainingMileage;
        return null;
    };

    // ── Last Capture Display ────────────────────────────────────
    window._nafShowLastCapture = function (capturedAt) {
        // kept for compatibility — no-op now (sidebar uses pollDataStatus)
    };

    function _fmtCaptureAge(ts) {
        return window.renaFormatDate(ts);
    }

    // Last-seen server-side capture timestamps — used to detect when the backend
    // (background scheduler / another user's shared write) has newer data than
    // what any already-open tab is currently showing, so pages can auto-refresh
    // instead of requiring a manual reload (F5/Ctrl+Shift+R).
    let _lastSeenResFetchedAt = null;
    let _lastSeenFleetCapturedAt = null;

    async function _pollDataStatus() {
        try {
            const res = await fetch(API_BASE + '/api/data-status');
            if (!res.ok) return;
            const json = await res.json();

            // Notify listening pages when fresher data becomes available server-side.
            if (json.res_fetched_at && json.res_fetched_at !== _lastSeenResFetchedAt) {
                const isFirstPoll = _lastSeenResFetchedAt === null;
                _lastSeenResFetchedAt = json.res_fetched_at;
                if (!isFirstPoll) {
                    window.dispatchEvent(new CustomEvent('rena:reservations-updated', { detail: json }));
                }
            }
            if (json.fleet_captured_at && json.fleet_captured_at !== _lastSeenFleetCapturedAt) {
                const isFirstPoll = _lastSeenFleetCapturedAt === null;
                _lastSeenFleetCapturedAt = json.fleet_captured_at;
                if (!isFirstPoll) {
                    window.dispatchEvent(new CustomEvent('rena:fleet-updated', { detail: json }));
                }
            }

            const fleetEl   = document.getElementById('statusFleetCapture');
            const fleetIcon = document.getElementById('statusFleetIcon');
            const mdEl      = document.getElementById('statusMasterdataCapture');
            const mdIcon    = document.getElementById('statusMasterdataIcon');
            const resEl     = document.getElementById('statusResCapture');
            const resIcon   = document.getElementById('statusResIcon');
            const resStationsEl = document.getElementById('statusResStations');
            const infleetEl   = document.getElementById('statusInfleetCapture');
            const infleetIcon = document.getElementById('statusInfleetIcon');

            const sf  = json.shared_fetch        || {};
            const rfs = json.res_fetch_status    || {};
            const ifs = json.infleet_fetch_status || {};

            // Fleet
            if (fleetEl) {
                if (sf.active) {
                    const who = sf.me ? "Refreshing fleet…" : (sf.user || '?') + " refreshing fleet…";
                    fleetEl.innerHTML = '<i class="fas fa-arrows-rotate fa-spin" style="font-size:0.55rem"></i> ' + who;
                    if (fleetIcon) { fleetIcon.style.color = '#f59e0b'; }
                } else {
                    const fleetCnt = json.fleet_count != null ? ` · ${json.fleet_count}v` : '';
                    fleetEl.textContent = 'Fleet ' + _fmtCaptureAge(json.fleet_captured_at) + fleetCnt;
                    if (fleetIcon) { fleetIcon.style.color = ''; }
                }
            }
            // Alarme / Marcas e Modelo (masterdata enrichment — separate from Frota)
            if (mdEl) {
                if (json.masterdata_active) {
                    const done = json.masterdata_fetched || 0;
                    const total = json.masterdata_total_progress || 0;
                    mdEl.innerHTML = "<i class=\"fas fa-arrows-rotate fa-spin\" style=\"font-size:0.55rem\"></i> Refreshing alerts and models… " + done + '/' + total;
                    if (mdIcon) { mdIcon.style.color = '#f59e0b'; }
                } else {
                    const mdCnt = json.masterdata_plate_count != null ? ` · ${json.masterdata_plate_count}v` : '';
                    mdEl.textContent = "Alerts / Manufacturers & Models" + mdCnt;
                    if (mdIcon) { mdIcon.style.color = ''; }
                }
            }
            // Reservas
            if (resEl) {
                if (rfs.active) {
                    const who = rfs.me ? "Refreshing reservations…" : (rfs.user || '?') + " refreshing reservations…";
                    resEl.innerHTML = '<i class="fas fa-arrows-rotate fa-spin" style="font-size:0.55rem"></i> ' + who;
                    if (resIcon) { resIcon.style.color = '#f59e0b'; }
                } else {
                    const resCnt = json.res_count != null ? ` · ${json.res_count}r` : '';
                    resEl.textContent = "Reservations " + _fmtCaptureAge(json.res_fetched_at) + resCnt;
                    if (resIcon) { resIcon.style.color = ''; }
                }
            }
            // Reservas by station (lista colapsável — sucesso + falhas + parciais do último fetch)
            if (resStationsEl) {
                const stats = json.res_branch_stats || {};
                const failed = json.res_failed_branches || [];
                const incomplete = json.res_incomplete_branches || [];
                const failedIds = new Set(failed.map(f => String(f.id)));
                const incompleteById = new Map(incomplete.map(f => [String(f.id), f]));
                const rows = Object.keys(stats)
                    .filter(bid => !failedIds.has(String(bid)))
                    .map(bid => ({
                        name: stats[bid].name || bid, total: stats[bid].total,
                        failed: false, incomplete: incompleteById.get(String(bid)) || null,
                    }));
                failed.forEach(f => rows.push({ name: f.name || f.id, total: null, failed: true, incomplete: null }));
                rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
                if (!rows.length) {
                    resStationsEl.innerHTML = '<div class="text-[0.65rem] text-gray-400 pl-[1.35rem]">—</div>';
                } else {
                    resStationsEl.innerHTML = rows.map(r => {
                        let valueHtml;
                        if (r.failed) {
                            valueHtml = '<span class="text-red-400">falha a ler</span>';
                        } else if (r.incomplete) {
                            valueHtml = "<span class=\"text-amber-500\" title=\"API pagination limit — ~"
                                + r.incomplete.estimated_missing + " reservations awaiting confirmation\">"
                                + r.total + ' (parcial)</span>';
                        } else {
                            valueHtml = '<span class="text-gray-500 dark:text-gray-400">' + r.total + '</span>';
                        }
                        return '<div class="flex items-center justify-between gap-2 pl-[1.35rem] pr-1 text-[0.65rem] text-gray-500 dark:text-gray-400 truncate"><span class="truncate">' + nafEsc(r.name) + '</span>' + valueHtml + '</div>';
                    }).join('');
                }
                // If already expanded, keep it fitting the (possibly changed) content height
                if (!resStationsEl.classList.contains('collapsed')) {
                    resStationsEl.style.maxHeight = 'none';
                }
            }
            // Infleet
            if (infleetEl) {
                if (ifs.active) {
                    const who = ifs.me ? 'A atualizar Infleet…' : (ifs.user || '?') + ' a atualizar Infleet…';
                    infleetEl.innerHTML = '<i class="fas fa-arrows-rotate fa-spin" style="font-size:0.55rem"></i> ' + who;
                    if (infleetIcon) { infleetIcon.style.color = '#f59e0b'; }
                } else {
                    infleetEl.textContent = 'Infleet ' + _fmtCaptureAge(json.infleet_refreshed_at);
                    if (infleetIcon) { infleetIcon.style.color = ''; }
                }
            }
        } catch (e) { /* silent */ }
    }

    _pollDataStatus();
    setInterval(_pollDataStatus, 30_000);  // poll every 30s so active indicators show quickly

    // ── KPI Setter ──────────────────────────────────────────────
    window.nafSetKpi = function (id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    // ── UI STATE ────────────────────────────────────────────────
    window.nafSetState = function (state, errMsg) {
        const ids = ['nafStateLoading', 'nafStateNoData', 'nafStateError', 'nafTableSection'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        if (state === 'loading')  { const el = document.getElementById('nafStateLoading'); if (el) el.style.display = 'flex'; }
        else if (state === 'no-data') { const el = document.getElementById('nafStateNoData'); if (el) el.style.display = 'flex'; }
        else if (state === 'error')   { const el = document.getElementById('nafStateError'); if (el) { el.style.display = 'flex'; const msg = document.getElementById('nafStateErrorMsg'); if (msg) msg.textContent = errMsg || "Unknown error."; } }
        else if (state === 'table')   { const el = document.getElementById('nafTableSection'); if (el) el.style.display = 'block'; }
    };

    window.updateExtStatus = function (type, text) {
        const icon = document.getElementById('nafExtStatusIcon');
        const label = document.getElementById('nafExtStatusText');
        if (icon) {
            const colors = { connected: '#22c55e', disconnected: '#ef4444', 'no-data': '#94a3b8', refreshing: '#f59e0b' };
            icon.style.color = colors[type] || '#94a3b8';
        }
        if (label) label.textContent = text;
    };

    // ── MULTI-SELECT HELPERS ────────────────────────────────────
    window.nafMsGetValues = function (id) {
        const el = document.getElementById(id);
        if (!el) return [];
        return [...el.querySelectorAll('.naf-ms-panel input:checked')].map(cb => cb.value);
    };

    window.nafMsSetOptions = function (id, options, placeholder) {
        const el = document.getElementById(id);
        if (!el) return;
        const panel = el.querySelector('.naf-ms-panel');
        if (!panel) return;
        const checked = new Set(nafMsGetValues(id));
        const clearHtml = `<div class="naf-ms-clear" onclick="nafMsClear('${id}')"><i class="fas fa-times"></i> Clear</div>`;
        const optHtml = options.map(o => {
            const safeVal = o.value.replace(/"/g, '&quot;');
            return `<label class="naf-ms-option"><input type="checkbox" value="${safeVal}"${checked.has(o.value) ? ' checked' : ''} onchange="nafMsOnChange('${id}')"><span>${o.label}</span></label>`;
        }).join('');
        panel.innerHTML = clearHtml + optHtml;
        nafMsUpdateLabel(id, placeholder);
    };

    window.nafMsUpdateLabel = function (id, placeholder) {
        const el = document.getElementById(id);
        if (!el) return;
        const ph = placeholder || el.dataset.placeholder || '';
        const values = nafMsGetValues(id);
        const labelEl = el.querySelector('.naf-ms-label');
        if (!labelEl) return;
        if (values.length === 0) {
            labelEl.textContent = ph;
            labelEl.classList.remove('naf-ms-has-sel');
        } else if (values.length === 1) {
            const cb = el.querySelector('.naf-ms-panel input:checked');
            const text = cb ? cb.closest('label').querySelector('span').textContent : values[0];
            labelEl.textContent = text;
            labelEl.classList.add('naf-ms-has-sel');
        } else {
            labelEl.textContent = `${values.length} selecionados`;
            labelEl.classList.add('naf-ms-has-sel');
        }
    };

    window.nafMsToggle = function (id) {
        const el = document.getElementById(id);
        if (!el) return;
        const panel = el.querySelector('.naf-ms-panel');
        if (!panel) return;
        const isOpen = el.classList.contains('naf-ms-open');
        document.querySelectorAll('.naf-ms.naf-ms-open').forEach(m => {
            m.classList.remove('naf-ms-open');
            m.querySelector('.naf-ms-panel').style.display = 'none';
        });
        if (!isOpen) {
            panel.style.display = 'block';
            el.classList.add('naf-ms-open');
        }
    };

    window.nafMsClear = function (id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.querySelectorAll('.naf-ms-panel input:checked').forEach(cb => { cb.checked = false; });
        nafMsUpdateLabel(id);
        if (id === 'nafFilterPool') nafOnPoolChange();
        else nafApplyFilters();
    };

    window.nafMsOnChange = function (id) {
        nafMsUpdateLabel(id);
        if (id === 'nafFilterPool') nafOnPoolChange();
        else nafApplyFilters();
    };

})();
