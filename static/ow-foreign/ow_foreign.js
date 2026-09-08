/* ══════════════ R.E.N.A. — One Way Estrangeiro v2 ═══════════
   Reservas com retorno em estação estrangeira.
   Filtro por zona (Norte/Centro/Sul) + modal para solicitar
   autorização de viatura por email (Outlook).
══════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ── STATE ───────────────────────────────────────────────────
    const OWF = {
        rows: [],           // todos os OW estrangeiros (RS + CO)
        lastFetchTs: 0,
        loading: false,
        initialized: false,
        selectedRow: null,  // linha activa para compor email
        region: '',         // '' = todas | 'Norte' | 'Centro' | 'Sul' | ...
        sortBy: 'PICK_DATETIME',
        sortDir: 'ASC',
        fleetByPlate: {},   // { NORM_PLATE: { desc: str, group: str } }
        fleetLoaded: false,
    };

    const SLOT_MS = 15 * 60 * 1000;
    function _slotTs() { const n = Date.now(); return n - (n % SLOT_MS); }

    // ── HELPERS ─────────────────────────────────────────────────
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function _fmtDT(iso) {
        return _esc(window.renaFormatDate(iso));
    }

    function _fmtDate(iso) {
        return _esc(window.renaFormatDate(iso, true));
    }

    function _normPlate(v) {
        return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    async function _ensureFleetIndex() {
        if (OWF.fleetLoaded) return;
        try {
            const res = await fetch((window.API_BASE || '') + '/api/not-available-fleet/data');
            if (!res.ok) return;
            const json = await res.json();
            const vehicles = (json && json.success && Array.isArray(json.vehicles)) ? json.vehicles : [];
            const map = {};
            vehicles.forEach(function (v) {
                const key = _normPlate(v.licensePlate || v.licencePlate || '');
                if (!key) return;
                const name = (v.displayName || v.name || '').trim();
                const mk = (v.make || '').trim();
                const md = (v.model || '').trim();
                map[key] = {
                    desc: name || ((mk || md) ? (mk + ' ' + md).trim() : ''),
                    group: (v.acrissCode || v.acriss || '').trim(),
                };
            });
            OWF.fleetByPlate = map;
            OWF.fleetLoaded = true;
        } catch (_) {
            // Best-effort enrichment; keep email flow working without blocking.
        }
    }

    const STATUS_CFG = {
        RS:  { label: "Reservation", color: 'green',  bg: 'bg-green-500/10 text-green-500',  icon: 'fa-check-circle' },
        CO:  { label: 'Checkout',color: 'blue',   bg: 'bg-blue-500/10 text-blue-500',    icon: 'fa-sign-out-alt' },
        RQ:  { label: 'Request', color: 'purple', bg: 'bg-purple-500/10 text-purple-500',icon: 'fa-user-clock' },
        OF:  { label: "Offer",  color: 'yellow', bg: 'bg-yellow-500/10 text-yellow-500',icon: 'fa-paper-plane' },
    };

    function _statusBadge(s) {
        const c = STATUS_CFG[s] || { label: s, bg: 'bg-gray-500/10 text-gray-400', icon: 'fa-question' };
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.bg}">
            <i class="fas ${c.icon} text-[0.6rem]"></i>${_esc(c.label)}</span>`;
    }

    // ── API ─────────────────────────────────────────────────────
    async function _fetchAll(force) {
        if (OWF.loading) return;
        if (!force && OWF.rows.length > 0 && OWF.lastFetchTs >= _slotTs()) {
            _render(); return;
        }
        OWF.loading = true;
        _renderSpinner();

        try {
            let allRows = [];
            let page = 1;
            let pages = 1;
            do {
                const today = new Date().toISOString().slice(0, 10);
                const params = new URLSearchParams({
                    foreign: '1',
                    status: 'RS,CO',
                    per_page: '200',
                    sort_by: 'PICK_DATETIME',
                    sort_dir: 'ASC',
                    date_from: today,
                    page: String(page),
                });
                const resp = await fetch('/api/reservations?' + params.toString());
                const data = await resp.json();
                if (data.no_token) {
                    _renderNoToken();
                    OWF.loading = false;
                    return;
                }
                if (data.error) throw new Error(data.error);
                allRows = allRows.concat(data.rows || []);
                pages = data.pages || 1;
                page++;
            } while (page <= pages);

            OWF.rows = allRows;
            OWF.lastFetchTs = Date.now();
        } catch (e) {
            console.error('[OWF] fetch error:', e);
            _renderError(e.message);
            OWF.loading = false;
            return;
        }

        OWF.loading = false;
        _render();
    }

    // ── ZONE MAPPING ─────────────────────────────────────────────
    // Maps PICK_ZONE (pool name from API) to planning region
    var ZONE_MAP = {
        'Pool Porto':     "North",
        'Pool Porto LM':  "North",
        "Pool Lisbon":    "Central",
        "Pool Lisbon LM": "Central",
        'Pool Faro':      "South",
        'Pool Faro LM':   "South",
    };
    function _zoneOf(r) {
        return ZONE_MAP[r.PICK_ZONE] || r.PICK_REGION || '';
    }

    // ── REGION LIST ─────────────────────────────────────────────
    function _regions() {
        const set = new Set();
        OWF.rows.forEach(r => { const z = _zoneOf(r); if (z) set.add(z); });
        return [...set].sort();
    }

    // ── FILTERED ROWS ───────────────────────────────────────────
    function _filtered() {
        let rows = OWF.rows;
        if (OWF.region) rows = rows.filter(r => _zoneOf(r) === OWF.region);
        // sort
        const key = OWF.sortBy;
        const dir = OWF.sortDir === 'DESC' ? -1 : 1;
        rows = [...rows].sort((a, b) => {
            const av = a[key] ?? '', bv = b[key] ?? '';
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
        });
        return rows;
    }

    // ── RENDER HELPERS ──────────────────────────────────────────
    function _container() { return document.getElementById('owfContent'); }

    function _renderSpinner() {
        const el = _container();
        if (!el) return;
        el.innerHTML = `<div class="flex flex-col items-center justify-center py-24 text-gray-400">
            <div class="rena-spinner mb-4"></div>
            <p class="text-sm">Loading international one-way reservations…</p>
        </div>`;
    }

    function _renderNoToken() {
        const el = _container();
        if (!el) return;
        el.innerHTML = `<div class="flex flex-col items-center justify-center py-24 text-yellow-400 gap-3">
            <i class="fas fa-lock text-3xl"></i>
            <p class="text-sm font-medium">Demo session unavailable. Please reload the page.</p>
        </div>`;
    }

    function _renderError(msg) {
        const el = _container();
        if (!el) return;
        el.innerHTML = `<div class="flex flex-col items-center justify-center py-24 text-red-400 gap-3">
            <i class="fas fa-exclamation-triangle text-3xl"></i>
            <p class="text-sm">${_esc(msg)}</p>
        </div>`;
    }

    // ── MAIN RENDER ─────────────────────────────────────────────
    function _render() {
        const el = _container();
        if (!el) return;

        const rows = _filtered();

        // ── ZONE FILTER BAR ──────────────────────────────────────────
        // Always show Norte/Centro/Sul; add any extra regions found in data
        const BASE_ZONES = ["North", "Central", "South"];
        const extraZones = _regions().filter(z => BASE_ZONES.indexOf(z) === -1);
        const allZones = BASE_ZONES.concat(extraZones);

        const regionBtns = ([''].concat(allZones)).map(r => {
            const active = OWF.region === r;
            const label = r || "All";
            const cnt = r ? OWF.rows.filter(row => _zoneOf(row) === r).length : OWF.rows.length;
            const cls = active
                ? 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-500 text-white shadow-sm'
                : 'px-3 py-1.5 rounded-lg text-xs font-medium bg-lynx-subtle dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:text-primary-500 transition-colors';
            // Use single quotes inside onclick — JSON.stringify would produce double-quoted strings
            // that break the HTML attribute
            const safeR = r.replace(/\\/g, '\\').replace(/'/g, "\\'");
            return '<button class="' + cls + '" onclick="window._owfSetRegion(\'' + safeR + '\')">' + _esc(label) + ' <span class="opacity-60 text-[0.65rem]">(' + cnt + ')</span></button>';
        }).join('');

        const filterBar = `<div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-semibold text-gray-300 uppercase tracking-wider mr-1"><i class="fas fa-map-marker-alt mr-1"></i>Pickup zone:</span>
            ${regionBtns}
            <span class="ml-auto text-xs text-gray-300">${rows.length} reservation${rows.length !== 1 ? 's' : ''}</span>
            <button onclick="window._owfRefresh()" title="Reload"
                class="ml-1 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-lynx-subtle dark:bg-white/5 text-gray-300 hover:text-primary-500 transition-colors">
                <i class="fas fa-arrows-rotate"></i> Refresh
            </button>
        </div>`;

        // ── TABLE ────────────────────────────────────────────────
        if (rows.length === 0) {
            el.innerHTML = `<div class="lynx-card p-4 space-y-3">
                ${filterBar}
                <div class="flex flex-col items-center justify-center py-16 text-gray-300 gap-3">
                    <i class="fas fa-globe-europe text-3xl opacity-40"></i>
                    <p class="text-sm">None reserva One Way estrangeiro${OWF.region ? " for zone " + _esc(OWF.region) : ''}.</p>
                </div>
            </div>`;
            return;
        }

        function _thBtn(field, label) {
            const icon = OWF.sortBy === field
                ? (OWF.sortDir === 'ASC' ? ' <i class="fas fa-sort-up text-orange-500 text-[0.6rem]"></i>' : ' <i class="fas fa-sort-down text-orange-500 text-[0.6rem]"></i>')
                : ' <i class="fas fa-sort text-orange-700 text-[0.6rem]"></i>';
            return `<th class="px-3 py-2.5 text-left text-[0.68rem] font-semibold uppercase tracking-wider text-orange-700 cursor-pointer select-none whitespace-nowrap hover:text-orange-500 transition-colors"
                    onclick="window._owfSort('${field}')">${label}${icon}</th>`;
        }

        const thead = `<thead class="bg-lynx-subtle dark:bg-[#111]">
            <tr>
                ${_thBtn('RESERVATION_NO', "Reservation")}
                ${_thBtn('STATUS', "Status")}
                ${_thBtn('PICK_DATETIME', "Pickup Date")}
                ${_thBtn('PICK_STATION_NAME', "Pickup Station")}
                <th class="px-3 py-2.5 text-left text-[0.68rem] font-semibold uppercase tracking-wider text-orange-700 whitespace-nowrap">Zone</th>
                ${_thBtn('RET_STATION_NAME', "International Destination")}
                ${_thBtn('RET_DATETIME', "Return Date")}
                ${_thBtn('DURATION', "Days")}
                ${_thBtn('ZGROUP', "Category")}
                <th class="px-3 py-2.5 text-left text-[0.68rem] font-semibold uppercase tracking-wider text-orange-700 whitespace-nowrap">Assigned Vehicle</th>
                <th class="px-3 py-2.5 text-center text-[0.68rem] font-semibold uppercase tracking-wider text-orange-700 whitespace-nowrap">Action</th>
            </tr>
        </thead>`;

        const tbody = rows.map(r => {
            const isSelected = OWF.selectedRow && OWF.selectedRow.RESERVATION_NO === r.RESERVATION_NO;
            const plate = r.LICENCE_PLATE || '';
            const zone = _zoneOf(r);
            const zoneBadge = zone
                ? (zone === "North"
                    ? "<span class=\"text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400\">North</span>"
                    : zone === "Central"
                        ? "<span class=\"text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400\">Central</span>"
                        : zone === "South"
                            ? "<span class=\"text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-green-500/15 text-green-400\">South</span>"
                            : '<span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400">' + _esc(zone) + '</span>')
                : '<span class="text-orange-500 text-xs">—</span>';
            const plateBadge = plate
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 text-xs font-mono font-semibold" title="Already assigned in the demo">
                    <i class="fas fa-car text-[0.6rem]"></i>${_esc(plate)}</span>`
                : `<span class="text-orange-500 text-xs italic">—</span>`;

            const rowCls = isSelected
                ? 'bg-primary-500/10 border-l-2 border-primary-500'
                : 'hover:bg-lynx-subtle dark:hover:bg-white/[0.03] border-l-2 border-transparent transition-colors';

            const safeNo = r.RESERVATION_NO.replace(/\\/g, '\\').replace(/'/g, "\\'");
            return `<tr class="${rowCls} cursor-pointer" onclick="window._owfSelectRow('${safeNo}')">
                <td class="px-3 py-2.5 font-mono text-xs font-bold text-orange-300 whitespace-nowrap">${_esc(r.RESERVATION_NO)}</td>
                <td class="px-3 py-2.5 whitespace-nowrap">${_statusBadge(r.STATUS)}</td>
                <td class="px-3 py-2.5 text-xs text-orange-400 whitespace-nowrap">${_fmtDT(r.PICK_DATETIME)}</td>
                <td class="px-3 py-2.5 text-xs text-orange-400 font-semibold whitespace-nowrap max-w-[160px] truncate" title="${_esc(r.PICK_STATION_NAME)}">${_esc(r.PICK_STATION_NAME)}</td>
                <td class="px-3 py-2.5 whitespace-nowrap">
                    ${zoneBadge}
                </td>
                <td class="px-3 py-2.5 text-xs font-medium text-orange-400 whitespace-nowrap max-w-[160px] truncate" title="${_esc(r.RET_STATION_NAME)}">
                    <i class="fas fa-globe-europe text-[0.6rem] mr-1 opacity-70"></i>${_esc(r.RET_STATION_NAME)}
                </td>
                <td class="px-3 py-2.5 text-xs text-orange-400 whitespace-nowrap">${_fmtDate(r.RET_DATETIME)}</td>
                <td class="px-3 py-2.5 text-xs text-center font-semibold text-orange-300">${r.DURATION != null ? r.DURATION : '—'}</td>
                <td class="px-3 py-2.5 font-mono text-xs text-orange-400 whitespace-nowrap">${_esc(r.ZGROUP || r.ACRISS_CODE || '—')}</td>
                <td class="px-3 py-2.5 whitespace-nowrap">${plateBadge}</td>
                <td class="px-3 py-2.5 text-center">
                    <button onclick="event.stopPropagation();window._owfOpenModal('${safeNo}')"
                        class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg
                            bg-lynx-subtle dark:bg-white/5 text-orange-300 hover:text-orange-400 hover:bg-orange-500/10
                            transition-colors">
                        <i class="fas fa-envelope text-[0.65rem]"></i> Request
                    </button>
                </td>
            </tr>`;
        }).join('');

        el.innerHTML = `<div class="space-y-3">
            <div class="lynx-card p-4">${filterBar}</div>
            <div class="lynx-card overflow-hidden p-0">
                <div class="overflow-auto">
                    <table class="w-full text-sm" style="border-collapse:separate;border-spacing:0">
                        ${thead}
                        <tbody class="divide-y divide-lynx-divider dark:divide-gray-800">${tbody}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
    }

    function _vehicleDesc(plate) {
        // 1) Prefer NAF fleet dataset (same source used by Fleet page)
        // 2) fallback to OW reservation rows
        if (!plate) return '';
        const key = _normPlate(plate);
        const fromFleet = OWF.fleetByPlate[key] || null;
        if (fromFleet && typeof fromFleet === 'object' && fromFleet.desc) return fromFleet.desc;
        if (typeof fromFleet === 'string' && fromFleet) return fromFleet;
        const hit = OWF.rows.find(function (r) {
            return _normPlate(r.LICENCE_PLATE || '') === key;
        });
        if (hit && hit.VEHICLE_MAKE) {
            return (hit.VEHICLE_MAKE + ' ' + (hit.VEHICLE_MODEL || '')).trim();
        }
        return '';
    }

    function _vehicleGroup(plate) {
        if (!plate) return '';
        const key = _normPlate(plate);
        const fromFleet = OWF.fleetByPlate[key] || null;
        if (fromFleet && typeof fromFleet === 'object' && fromFleet.group) return fromFleet.group;
        const hit = OWF.rows.find(function (r) {
            return _normPlate(r.LICENCE_PLATE || '') === key;
        });
        return (hit && (hit.ZGROUP || hit.ACRISS_CODE)) ? (hit.ZGROUP || hit.ACRISS_CODE) : '';
    }

    // Fallback when desktop Outlook COM isn't available (most users don't have
    // the desktop app installed — they use Outlook Web). Opens the OWA compose
    // deeplink instead of a plain mailto:, which would otherwise hand off to
    // whatever the OS's default mail handler is (often nothing useful).
    // `popup` is a window handle opened SYNCHRONOUSLY inside the original click
    // handler (see _owfConfirmSend) — by the time we get here we're several
    // `await`s removed from that click, and browsers silently block a fresh
    // window.open() at that point (no error, it just does nothing — this is
    // exactly what was reported: the button spun and then nothing happened).
    // Navigating the pre-opened handle instead sidesteps the popup blocker.
    function _openOutlookWebFallback(subject, r, plate, popup) {
        var group = _vehicleGroup(plate);
        var bodyTxt = [
            'I hereby request authorisation to use the vehicle indicated below for the following One Way International reservation:',
            '',
            'Reservation: ' + r.RESERVATION_NO,
            'Pick-up Station: ' + r.PICK_STATION_NAME,
            'Destination: ' + r.RET_STATION_NAME + ' (International)',
            'Pick-up Date: ' + _fmtDT(r.PICK_DATETIME),
            'Return Date: ' + _fmtDT(r.RET_DATETIME),
            'Proposed Vehicle: ' + (plate || '(please indicate plate)'),
            'Vehicle Group: ' + (group || '—'),
            '',
            'Awaiting confirmation.'
        ].join('\n');
        var url = '#demo-email'
            + '?to=' + encodeURIComponent('contacto-demo@example.invalid')
            + '&cc=' + encodeURIComponent('contacto-demo@example.invalid')
            + '&subject=' + encodeURIComponent(subject)
            + '&body=' + encodeURIComponent(bodyTxt);
        if (popup && !popup.closed) {
            popup.location.href = url;
        } else {
            window.open(url, '_blank');
        }
    }

    async function _sendEmail(resRow, plate, popup) {
        const r = resRow || OWF.selectedRow;
        if (!r) { if (popup && !popup.closed) popup.close(); return false; }
        await _ensureFleetIndex();
        const subject = 'Authorization Request OW International — Reservation ' + r.RESERVATION_NO;
        const body = _buildEmailHtml(r, plate || '');
        try {
            const resp = await fetch('/api/open-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: 'contacto-demo@example.invalid',
                    cc: 'contacto-demo@example.invalid',
                    subject: subject,
                    body: body,
                }),
            });
            const raw = await resp.text();
            let result = null;
            try { result = raw ? JSON.parse(raw) : {}; } catch (_) { result = null; }

            if (resp.ok && result && result.success) {
                if (popup && !popup.closed) popup.close(); // desktop Outlook opened fine — no browser tab needed
                return true;
            }

            // Desktop Outlook COM failed (often just means Outlook isn't installed —
            // most users only have Outlook Web). Fall back to the OWA compose link.
            const err = (result && result.error) || ('HTTP ' + resp.status);
            if (raw && raw.trim().startsWith('<!doctype')) {
                alert("The desktop Outlook integration is unavailable. Opening Outlook in the browser.");
            } else {
                alert("Desktop Outlook unavailable (" + err + "). Opening Outlook in the browser.");
            }
            _openOutlookWebFallback(subject, r, plate || '', popup);
            return true;
        } catch (e) {
            alert("Could not contact the server: " + e.message + ". Opening Outlook in the browser.");
            _openOutlookWebFallback(subject, r, plate || '', popup);
            return true;
        }
    }

    // ── EMAIL HTML BODY ─────────────────────────────────────────
    function _buildEmailHtml(r, plate) {
        const zone    = _zoneOf(r);
        const desc    = _vehicleDesc(plate);
        const carGroup = _vehicleGroup(plate);
        const status  = (STATUS_CFG[r.STATUS] || {}).label || r.STATUS;
        const durStr  = r.DURATION != null ? r.DURATION + ' day(s)' : '—';
        const acriss  = r.ZGROUP || r.ACRISS_CODE || '—';

        function row(label, value, highlight) {
            var bg = highlight ? '#fffbeb' : '#ffffff';
            return '<tr style="background:' + bg + ';">'
                + '<td style="padding:8px 14px;border:1px solid #e5e7eb;font-size:12px;color:#6b7280;width:170px;white-space:nowrap;">' + label + '</td>'
                + '<td style="padding:8px 14px;border:1px solid #e5e7eb;font-size:13px;color:#111827;font-weight:600;">' + value + '</td>'
                + '</tr>';
        }

        var viaturaCell = '<span style="font-family:monospace;font-size:14px;font-weight:700;color:#FF6000;">' + _esc(plate || '(please indicate plate)') + '</span>';
        if (desc) viaturaCell += ' <span style="font-size:12px;color:#6b7280;font-weight:400;">— ' + _esc(desc) + '</span>';

        var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;">'
            + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:24px 0;">'
            + '<tr><td align="center">'
            + '<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">'

            // Header
            + '<tr><td style="background:#FF6000;padding:20px 24px;">'
            + '<p style="margin:0;font-size:11px;color:#1A1A1A;font-weight:600;text-transform:uppercase;letter-spacing:.08em;">Authorization Request</p>'
            + '<h1 style="margin:4px 0 0 0;font-size:18px;color:#ffffff;font-weight:700;">One Way International</h1>'
            + '</td></tr>'

            // Reservation info
            + '<tr><td style="padding:20px 24px 0 24px;">'
            + '<p style="margin:0 0 12px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;">Reservation Details</p>'
            + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">'
            + row('Reservation',      '<span style="font-family:monospace;font-size:14px;">' + _esc(r.RESERVATION_NO) + '</span>')
            + row('Status',           _esc(status))
            + row('Pick-up Station',  _esc(r.PICK_STATION_NAME) + (zone ? ' <span style="font-size:11px;color:#6b7280;">(' + _esc(zone) + ')</span>' : ''))
            + row('Destination',      _esc(r.RET_STATION_NAME) + ' <span style="font-size:11px;color:#FF6000;">(International)</span>')
            + row('Pick-up Date',     _esc(_fmtDT(r.PICK_DATETIME)))
            + row('Return Date',      _esc(_fmtDT(r.RET_DATETIME)))
            + row('Duration',         _esc(durStr))
            + row('ACRISS Category',  _esc(acriss))
            + '</table>'
            + '</td></tr>'

            // Vehicle
            + '<tr><td style="padding:16px 24px 0 24px;">'
            + '<p style="margin:0 0 12px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;">Proposed Vehicle</p>'
            + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">'
            + row('Plate / Model',    viaturaCell, true)
            + row('Vehicle Group',   _esc(carGroup || '—'))
            + '</table>'
            + '</td></tr>'

            // Body text (sem saudação/assinatura)
            + '<tr><td style="padding:20px 24px;">'
            + '<p style="margin:0;font-size:13px;color:#374151;line-height:1.6;">I hereby request authorisation to use the vehicle indicated above for the <strong>One Way International</strong> reservation identified in this request.</p>'
            + '<p style="margin:12px 0 0 0;font-size:13px;color:#374151;line-height:1.6;">Awaiting confirmation.</p>'
            + '</td></tr>'

            + '</table>'
            + '</td></tr></table>'
            + '</body></html>';
        return html;
    }

    function _openModal(resNo) {
        const row = OWF.rows.find(function (r) { return r.RESERVATION_NO === resNo; });
        if (!row) return;
        OWF.selectedRow = row;
        const existing = document.getElementById('owfModal');
        if (existing) existing.remove();

        const plateVal = _esc(row.LICENCE_PLATE || '');
        const alreadyAllocated = row.LICENCE_PLATE
            ? '<div class="mb-4 flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">'
              + '<i class="fas fa-exclamation-triangle text-yellow-400 flex-shrink-0"></i>'
              + "<div class=\"text-xs\"><span class=\"text-yellow-300 font-semibold\">Already assigned in the demo:</span>"
              + ' <span class="font-mono font-bold text-yellow-200">' + _esc(row.LICENCE_PLATE) + '</span>'
              + " <span class=\"text-yellow-500\">— use this vehicle or select another one.</span></div></div>"
            : '';

        const modal = document.createElement('div');
        modal.id = 'owfModal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4';
        modal.innerHTML = '<div class="absolute inset-0 bg-black/60 backdrop-blur-sm" onclick="window._owfCloseModal()"></div>'
            + '<div class="relative lynx-modal w-full max-w-lg p-6 space-y-4">'
            + '  <div class="flex items-start justify-between gap-3">'
            + '    <div>'
            + '      <h3 class="text-base font-bold lynx-text-primary flex items-center gap-2">'
            + "        <i class=\"fas fa-envelope text-primary-500\"></i> Request International One-Way Authorization"
            + '      </h3>'
            + '      <p class="text-xs text-gray-400 mt-1">'
            + "        Reservation <span class=\"font-mono font-bold text-gray-200\">" + _esc(row.RESERVATION_NO) + '</span>'
            + '        &nbsp;\u00b7&nbsp; ' + _esc(row.PICK_STATION_NAME)
            + '        &nbsp;\u2192&nbsp; <span class="text-primary-400">' + _esc(row.RET_STATION_NAME) + '</span>'
            + '        &nbsp;\u00b7&nbsp; ' + _fmtDate(row.PICK_DATETIME)
            + (row.DURATION != null ? '&nbsp;\u00b7&nbsp; <strong>' + row.DURATION + " days</strong>" : '')
            + '      </p>'
            + '    </div>'
            + '    <button onclick="window._owfCloseModal()" class="text-gray-500 hover:text-gray-300 transition-colors mt-0.5 flex-shrink-0">'
            + '      <i class="fas fa-times text-lg"></i>'
            + '    </button>'
            + '  </div>'
            + alreadyAllocated
            + '  <div>'
            + '    <label class="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">'
            + "      Proposed vehicle license plate"
            + '    </label>'
            + '    <input id="owfModalPlate" type="text" maxlength="20"'
            + '      placeholder="ex: 00-AA-00"'
            + '      value="' + plateVal + '"'
            + '      class="w-full px-3 py-2.5 rounded-lg text-sm font-mono font-bold'
            + '             bg-[#1a1a1a] border border-gray-700 text-white'
            + '             focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500'
            + '             placeholder-gray-600 uppercase tracking-widest">'
            + '  </div>'
            + '  <div class="bg-[#0d0d0d] rounded-lg p-3 border border-gray-800">'
            + "    <div class=\"text-[0.65rem] font-semibold uppercase tracking-wider text-gray-500 mb-2\">Email preview</div>"
            + '    <div class="text-[0.68rem] text-gray-400 space-y-0.5">'
            + '      <div><span class="text-gray-600 w-14 inline-block">Para:</span> <span class="text-gray-300">contacto-demo@example.invalid</span></div>'
            + '      <div><span class="text-gray-600 w-14 inline-block">CC:</span> <span class="text-gray-300">contacto-demo@example.invalid</span></div>'
            + "      <div><span class=\"text-gray-600 w-14 inline-block\">Subject:</span> <span class=\"text-gray-300\">International One-Way Authorization Request — Reservation " + _esc(row.RESERVATION_NO) + '</span></div>'
            + '    </div>'
            + '  </div>'
            + '  <div class="flex gap-3 pt-1">'
            + '    <button onclick="window._owfCloseModal()"'
            + '      class="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors">'
            + "      Cancel"
            + '    </button>'
            + '    <button onclick="window._owfConfirmSend()"'
            + '      class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">'
            + "      <i class=\"fas fa-envelope\"></i> Open in Outlook"
            + '    </button>'
            + '  </div>'
            + '</div>';

        document.body.appendChild(modal);
        setTimeout(function () {
            const inp = document.getElementById('owfModalPlate');
            if (inp) { inp.focus(); inp.select(); }
        }, 60);
    }

    // ── GLOBALS ─────────────────────────────────────────────────
    window._owfSetRegion = function (region) {
        OWF.region = region;
        _render();
    };

    window._owfOpenModal = function (resNo) { _openModal(resNo); };

    window._owfCloseModal = function () {
        const m = document.getElementById('owfModal');
        if (m) m.remove();
        OWF.selectedRow = null;
    };

    window._owfConfirmSend = async function () {
        const inp = document.getElementById('owfModalPlate');
        const plate = inp ? inp.value.trim().toUpperCase() : '';
        if (!OWF.selectedRow) return;
        const btn = document.querySelector('#owfModal button[onclick="window._owfConfirmSend()"]');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> A abrir Outlook…'; }
        // Open the tab NOW, synchronously, still inside this click handler —
        // once we're past the first `await` below, browsers no longer treat a
        // fresh window.open() as user-triggered and silently block it (no
        // error, nothing happens). Navigating this pre-opened handle later
        // avoids that.
        const popup = window.open('', '_blank');
        const ok = await _sendEmail(OWF.selectedRow, plate, popup);
        if (ok) {
            window._owfCloseModal();
            return;
        }
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = "<i class=\"fas fa-envelope\"></i> Open in Outlook";
        }
    };

    window._owfSort = function (field) {
        if (OWF.sortBy === field) {
            OWF.sortDir = OWF.sortDir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            OWF.sortBy = field;
            OWF.sortDir = 'ASC';
        }
        _render();
    };

    window._owfSelectRow = function (resNo) {
        // Row click highlights the row; use _owfOpenModal to compose email
        const same = OWF.selectedRow && OWF.selectedRow.RESERVATION_NO === resNo;
        OWF.selectedRow = same ? null : (OWF.rows.find(r => r.RESERVATION_NO === resNo) || null);
        _render();
    };

    window._owfRefresh = function () {
        OWF.rows = [];
        OWF.lastFetchTs = 0;
        OWF.selectedRow = null;
        _fetchAll(true);
    };

    // ── INIT ─────────────────────────────────────────────────────
    window.owForeignInit = function () {
        OWF.initialized = true;
        _ensureFleetIndex();
        _fetchAll();
    };

})();
