/* ══════════════ R.E.N.A. — Capacity & Slot Control ══════════════ */
(function () {
    'use strict';

    var CC = {
        data:            null,
        loading:         false,
        days:            14,
        selectedStation: null,
        detailView:      'hourly',  // 'daily' | 'hourly'
        configMode:      'form',    // 'form' | 'json'
        _configDraft:    null,      // mutable draft for form editor
        radarVisible:    false,
        planningData:    null,
        radarLoading:    false,
    };

    // Region groupings (station config keys)
    var GROUPS = [
        { label: 'Porto',   icon: 'fa-bridge',          ids: ['41020', '42506', '43044', '46759'] },
        { label: "Lisbon",  icon: 'fa-monument',        ids: ['41019', '47900', '42977', '43601', '42103'] },
        { label: 'Faro',    icon: 'fa-umbrella-beach',  ids: ['42231', '44469'] },
        { label: 'Madeira', icon: 'fa-location-dot', ids: ['42693'] },
    ];

    // ── Helpers ──────────────────────────────────────────────────────
    function _esc(s) {
        var d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    }
    function _escAttr(s) { return _esc(s).replace(/"/g, '&quot;'); }

    var WD     = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var MONTHS = ['Jan', "Feb", 'Mar', "Apr", "May", 'Jun', 'Jul', "Aug", 'Set', "Oct", 'Nov', "Dec"];

    function _fmtDate(iso) {
        return _esc(window.renaFormatDate(iso, true));
    }
    function _fmtShort(iso) {
        return _esc(window.renaFormatDate(iso, true));
    }
    function _isWeekend(iso) { var d = new Date(iso + 'T00:00:00').getDay(); return d === 0 || d === 6; }
    function _isToday(iso)   { return iso === new Date().toISOString().slice(0, 10); }

    function _pct(count, max) { return (!max || max <= 0) ? null : (count / max) * 100; }

    function _pctBg(pct) {
        if (pct === null)  return 'bg-gray-100 dark:bg-gray-800';
        if (pct >= 100)    return 'bg-red-500';
        if (pct >= 85)     return 'bg-orange-400';
        if (pct >= 70)     return 'bg-amber-400';
        if (pct >= 40)     return 'bg-emerald-400';
        return 'bg-emerald-200 dark:bg-emerald-900/60';
    }
    function _pctTextCls(pct) {
        if (pct === null)  return 'text-gray-400';
        if (pct >= 100)    return 'text-red-600 dark:text-red-400 font-bold';
        if (pct >= 85)     return 'text-orange-500 dark:text-orange-400 font-semibold';
        if (pct >= 70)     return 'text-amber-500 dark:text-amber-400';
        return 'text-emerald-600 dark:text-emerald-400';
    }
    function _cellBg(pct) {
        if (pct === null)  return '';
        if (pct >= 100)    return 'bg-red-50 dark:bg-red-950/40';
        if (pct >= 85)     return 'bg-orange-50 dark:bg-orange-950/30';
        if (pct >= 70)     return 'bg-amber-50 dark:bg-amber-950/20';
        return '';
    }
    function _bar(count, max) {
        if (max == null || max <= 0)
            return '<span class="font-mono text-gray-600 dark:text-gray-300">' + count + '</span>';
        var p   = Math.min(Math.round((count / max) * 100), 100);
        var cls = p >= 100 ? 'bg-red-500' : p >= 85 ? 'bg-orange-400' : p >= 70 ? 'bg-amber-400' : 'bg-emerald-400 dark:bg-emerald-500';
        return '<div class="font-mono leading-none">' + count
             + '<span class="text-[0.6rem] text-gray-400 dark:text-gray-500">/' + max + '</span></div>'
             + '<div class="w-full h-1 mt-0.5 rounded bg-gray-100 dark:bg-gray-700 overflow-hidden">'
             + '<div class="h-full rounded ' + cls + '" style="width:' + p + '%"></div></div>';
    }

    // ── Init / Load ──────────────────────────────────────────────────
    window.capacityControlInit = function () {
        var c = document.getElementById('ccContent');
        if (!c) return;
        if (!CC.data) _load(); else _render();
    };

    window.capacityControlRefresh = function () { CC.data = null; _load(); };

    window.ccChangeDays = function (val) {
        CC.days = parseInt(val, 10) || 14;
        CC.data = null;
        _load();
    };

    function _load() {
        if (CC.loading) return;
        CC.loading = true;
        var c = document.getElementById('ccContent');
        if (c) c.innerHTML = '<div class="text-center text-gray-400 py-16">'
            + '<i class="fas fa-spinner fa-spin text-2xl"></i>'
            + "<p class=\"mt-3 text-sm\">Loading capacity data…</p></div>";
        fetch('/api/capacity-control?days=' + CC.days)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                CC.loading = false;
                if (d.error) { _showError(d.error); return; }
                CC.data = d;
                var ids = Object.keys(d.stations_config || {});
                if (!CC.selectedStation || !ids.includes(CC.selectedStation))
                    CC.selectedStation = ids.length > 0 ? ids[0] : null;
                _render();
            })
            .catch(function (e) { CC.loading = false; _showError(e.message); });
    }

    function _showError(msg) {
        var c = document.getElementById('ccContent');
        if (c) c.innerHTML = '<div class="text-center text-red-400 py-10">'
            + '<i class="fas fa-times-circle text-2xl mb-2"></i>'
            + "<p class=\"text-sm\">Error: " + _esc(msg) + '</p>'
            + "<button onclick=\"capacityControlInit()\" class=\"mt-4 text-xs px-3 py-1.5 rounded-lg bg-primary-500 text-white font-semibold\">Try again</button></div>";
    }

    // ── Main render ──────────────────────────────────────────────────
    function _render() {
        var c = document.getElementById('ccContent');
        if (!c || !CC.data) return;
        var ids = Object.keys(CC.data.stations_config || {});
        if (ids.length === 0) {
            c.innerHTML = '<div class="text-center text-gray-400 py-16">'
                + '<i class="fas fa-sliders-h text-4xl mb-4 opacity-30"></i>'
                + "<p class=\"text-sm font-medium text-gray-600 dark:text-gray-300 mb-1\">No stations configured</p>"
                + "<p class=\"text-xs text-gray-400 mb-5\">Configure stations to manage daily capacity and time slots.</p>"
                + '<button id="ccOpenConfigBtn" class="text-xs px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold hover:bg-primary-600">'
                + "<i class=\"fas fa-cog mr-1.5\"></i>Configure Stations</button></div>";
            var btn = document.getElementById('ccOpenConfigBtn');
            if (btn) btn.addEventListener('click', ccOpenConfig);
            return;
        }
        c.innerHTML = _renderKpis()
            + _renderAlerts()
            + _renderOverview();
    }

    // ── Compute aggregate stats over loaded days ─────────────────────
    function _computeStats() {
        var cfg  = CC.data.stations_config || {};
        var data = CC.data.data || {};
        var days = CC.data.days || [];

        var totalRes = 0, daysOver85 = 0, daysOver100 = 0;
        var alerts = []; // {sid, name, day, total, max, pct}
        var topDay = null, topDayCount = 0;

        Object.keys(cfg).forEach(function (sid) {
            var stn = cfg[sid];
            var sd = data[sid] || {};
            days.forEach(function (d) {
                var dd = sd[d] || { total: 0 };
                totalRes += (dd.total || 0);
                if ((dd.total || 0) > topDayCount) { topDayCount = dd.total || 0; topDay = { sid: sid, name: stn.name || sid, day: d, total: dd.total }; }
                var p = _pct(dd.total, stn.max_daily);
                if (p !== null && p >= 85)  daysOver85++;
                if (p !== null && p >= 100) daysOver100++;
                if (p !== null && p >= 85) {
                    alerts.push({ sid: sid, name: stn.name || sid, day: d, total: dd.total, max: stn.max_daily, pct: p });
                }
            });
        });
        alerts.sort(function (a, b) {
            // ordena por data ascendente, depois % desc
            if (a.day !== b.day) return a.day < b.day ? -1 : 1;
            return b.pct - a.pct;
        });
        return { totalRes: totalRes, daysOver85: daysOver85, daysOver100: daysOver100, alerts: alerts, topDay: topDay };
    }

    // ── KPI strip ────────────────────────────────────────────────────
    function _renderKpis() {
        var s = _computeStats();
        var ndays = (CC.data.days || []).length;
        var avgPerDay = ndays ? Math.round(s.totalRes / ndays) : 0;

        function card(icon, iconCls, label, value, sub) {
            return '<div class="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white dark:bg-gray-900 border border-lynx-divider flex-1 min-w-[10rem]">'
                + '<div class="w-9 h-9 rounded-lg flex items-center justify-center ' + iconCls + '"><i class="fas ' + icon + '"></i></div>'
                + '<div class="leading-tight">'
                + '<p class="text-[0.6rem] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">' + label + '</p>'
                + '<p class="text-lg font-bold text-gray-800 dark:text-gray-100">' + value + '</p>'
                + (sub ? '<p class="text-[0.6rem] text-gray-400 dark:text-gray-500">' + sub + '</p>' : '')
                + '</div></div>';
        }

        var topDayLbl = s.topDay
            ? _fmtDate(s.topDay.day) + ' \u00b7 ' + _esc(s.topDay.name)
            : '\u2014';
        var topDayVal = s.topDay ? s.topDay.total + ' res.' : '\u2014';

        return '<div class="flex flex-wrap gap-2 mb-4">'
            + card('fa-calendar-check', 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400',
                   "Reservations (" + ndays + 'd)', s.totalRes, '\u00f8 ' + avgPerDay + '/day')
            + card('fa-exclamation-triangle',
                   s.daysOver85 > 0 ? 'bg-orange-50 dark:bg-orange-950/30 text-orange-500' : 'bg-gray-50 dark:bg-gray-800 text-gray-400',
                   "Days ≥85%", s.daysOver85, s.daysOver85 > 0 ? "approaching capacity" : 'tudo controlado')
            + card('fa-times-circle',
                   s.daysOver100 > 0 ? 'bg-red-50 dark:bg-red-950/30 text-red-500' : 'bg-gray-50 dark:bg-gray-800 text-gray-400',
                   "Days ≥100%", s.daysOver100, s.daysOver100 > 0 ? 'over-capacity' : "within capacity")
            + card('fa-fire', 'bg-amber-50 dark:bg-amber-950/30 text-amber-500',
                   "Peak", topDayVal, topDayLbl)
            + '</div>';
    }

    // ── Critical alerts banner ──────────────────────────────────────
    function _renderAlerts() {
        var s = _computeStats();
        if (!s.alerts.length) return '';
        var show = s.alerts.slice(0, 6);
        var more = s.alerts.length - show.length;

        var chips = show.map(function (a) {
            var critical = a.pct >= 100;
            var cls = critical
                ? 'bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700/60'
                : 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700/60';
            return '<button onclick="ccSelectStation(\'' + _escAttr(a.sid) + '\')" '
                + 'class="text-[0.68rem] font-semibold px-2 py-1 rounded border ' + cls
                + ' hover:brightness-95 transition-all whitespace-nowrap" '
                + 'title="' + _escAttr(a.name + " — click to view details") + '">'
                + '<i class="fas ' + (critical ? 'fa-times-circle' : 'fa-exclamation-triangle') + ' mr-1 text-[0.6rem]"></i>'
                + Math.round(a.pct) + '% \u00b7 ' + _esc(a.name) + ' \u00b7 ' + _fmtDate(a.day)
                + '</button>';
        }).join('');

        return '<div class="mb-4 p-3 rounded-lg border border-orange-200 dark:border-orange-800/60 bg-orange-50/60 dark:bg-orange-950/20">'
            + '<p class="text-[0.65rem] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-2 flex items-center gap-1.5">'
            + "<i class=\"fas fa-bell\"></i>Capacity alerts"
            + "<span class=\"font-normal normal-case text-orange-500/80\">(≥85% — click to view)</span>"
            + '</p>'
            + '<div class="flex flex-wrap gap-1.5">' + chips
            + (more > 0 ? '<span class="text-[0.68rem] font-medium px-2 py-1 text-orange-600 dark:text-orange-400">+ ' + more + " more…</span>" : '')
            + '</div></div>';
    }

    // ── Section 1: Overview — compact station list ───────────────────
    function _renderOverview() {
        var allDays = CC.data.days || [];
        var days    = allDays.slice(0, 7);
        var cfg     = CC.data.stations_config || {};
        var data    = CC.data.data || {};

        var html = '<div>';

        GROUPS.forEach(function (grp) {
            var gIds = grp.ids.filter(function (id) { return id in cfg; });
            if (!gIds.length) return;

            html += '<div class="mb-4">'
                + '<p class="text-[0.58rem] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2 flex items-center gap-1.5">'
                + '<i class="fas ' + grp.icon + '"></i>' + grp.label + '</p>'
                + '<div class="space-y-2">';

            gIds.forEach(function (id) {
                var stn    = cfg[id];
                var stData = data[id] || {};
                var isSel  = id === CC.selectedStation;

                // Card wrapper
                html += '<div class="rounded-xl border overflow-hidden '
                    + (isSel ? 'border-primary-400 dark:border-primary-600 shadow-sm' : 'border-lynx-divider') + '"'
                    + (isSel ? ' data-cc-selected' : '') + '>';

                // ── Clickable header ──
                html += '<div onclick="ccSelectStation(\'' + _escAttr(id) + '\')" '
                    + 'class="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none '
                    + (isSel ? 'bg-primary-50/60 dark:bg-primary-900/20' : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50') + '">';

                // Station name + max
                html += '<div class="w-36 flex-shrink-0 min-w-0">'
                    + '<p class="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">' + _esc(stn.name || id) + '</p>'
                    + (stn.max_daily
                        ? "<p class=\"text-[0.6rem] text-gray-400\">max " + stn.max_daily + '/day</p>'
                        : "<p class=\"text-[0.6rem] text-gray-400 italic\">no limit</p>")
                    + '</div>';

                // 7-day mini grid: day label + date + colored count chip
                html += '<div class="flex items-end gap-1 flex-1">';
                days.forEach(function (d) {
                    var dd    = stData[d] || { total: 0 };
                    var p     = _pct(dd.total, stn.max_daily);
                    var isTod = _isToday(d);
                    var date  = new Date(d + 'T00:00:00');
                    var dayA  = WD[date.getDay()].substring(0, 3);
                    var dayN  = date.getDate();
                    var chipBg = p === null   ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                               : p >= 100     ? 'bg-red-500 text-white'
                               : p >= 85      ? 'bg-orange-400 text-white'
                               : p >= 70      ? 'bg-amber-400 text-white'
                               : p >= 40      ? 'bg-emerald-400 text-white'
                               : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400';
                    var todRing = isTod ? ' ring-2 ring-primary-400 dark:ring-primary-500' : '';
                    var labelCls = isTod ? 'text-primary-500 dark:text-primary-400 font-bold' : 'text-gray-400';

                    html += '<div class="flex flex-col items-center flex-shrink-0 w-10">'
                        + '<p class="text-[0.48rem] uppercase tracking-wide ' + labelCls + '">' + dayA + '</p>'
                        + '<p class="text-[0.48rem] ' + labelCls + '">' + dayN + '</p>'
                        + '<div class="w-full text-center rounded py-0.5 text-[0.6rem] font-mono font-semibold ' + chipBg + todRing + '">'
                        + dd.total + '</div>'
                        + '</div>';
                });
                html += '</div>';

                // Chevron indicator
                html += '<i class="fas ' + (isSel ? 'fa-chevron-up text-primary-400' : 'fa-chevron-down text-gray-400') + ' text-[0.6rem] flex-shrink-0 ml-1"></i>';
                html += '</div>'; // end clickable row

                // ── Inline expanded detail ──
                if (isSel) {
                    var combinedNote = (stn.station_ids && stn.station_ids.length > 1)
                        ? ' <span class="text-[0.55rem] bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 rounded px-1 py-0.5 ml-1">'
                          + '<i class="fas fa-link mr-0.5"></i>' + stn.station_ids.join(' + ') + '</span>' : '';

                    html += '<div class="border-t border-lynx-divider">';
                    // Toolbar
                    html += '<div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-lynx-divider">';
                    html += '<span class="text-xs font-semibold text-gray-700 dark:text-gray-200">' + _esc(stn.name || id) + combinedNote + '</span>';
                    if (stn.opens_at && stn.closes_at)
                        html += '<span class="text-[0.6rem] text-gray-400"><i class="fas fa-clock mr-1 text-primary-400 opacity-70"></i>' + _esc(stn.opens_at) + '\u2013' + _esc(stn.closes_at) + '</span>';
                    if (stn.max_daily)
                        html += "<span class=\"text-[0.6rem] text-gray-400\"><i class=\"fas fa-calendar-day mr-1 text-primary-400 opacity-70\"></i>Max. " + stn.max_daily + '/day</span>';
                    if (stn.oot_until && stn.oot_until !== '00:00')
                        html += "<span class=\"text-[0.6rem] text-orange-400\"><i class=\"fas fa-moon mr-1\"></i>Oct-of-hours until " + _esc(stn.oot_until) + '</span>';
                    html += '<span class="flex-1"></span>';
                    html += '<div class="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">'
                        + _viewBtn('daily',  "<i class=\"fas fa-calendar-day mr-1\"></i>Por Day")
                        + _viewBtn('hourly', "<i class=\"fas fa-clock mr-1\"></i>Por Time")
                        + '</div>';
                    html += '<button onclick="ccEditStation(\'' + _escAttr(id) + '\'); event.stopPropagation();" '
                        + 'class="text-[0.6rem] px-2 py-1 rounded border border-lynx-divider text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 ml-1">'
                        + "<i class=\"fas fa-pen mr-1\"></i>Edit</button>";
                    html += '</div>';
                    // Table
                    html += '<div class="p-3">'
                        + (CC.detailView === 'hourly' ? _renderHourlyTable(id) : _renderDailyTable(id))
                        + '</div>';
                    html += '</div>'; // end inline detail
                }

                html += '</div>'; // end card
            });

            html += '</div></div>'; // end group
        });

        // Legend
        html += '<div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[0.58rem] text-gray-400 dark:text-gray-500">'
            + '<span class="flex items-center gap-1"><span class="inline-block w-4 h-3 rounded bg-emerald-100 dark:bg-emerald-900/40"></span>&lt;40%</span>'
            + '<span class="flex items-center gap-1"><span class="inline-block w-4 h-3 rounded bg-emerald-400"></span>40\u201369%</span>'
            + '<span class="flex items-center gap-1"><span class="inline-block w-4 h-3 rounded bg-amber-400"></span>70\u201384%</span>'
            + '<span class="flex items-center gap-1"><span class="inline-block w-4 h-3 rounded bg-orange-400"></span>85\u201399%</span>'
            + '<span class="flex items-center gap-1"><span class="inline-block w-4 h-3 rounded bg-red-500"></span>\u2265100%</span>'
            + '</div>';

        html += '</div>';
        return html;
    }

    function _viewBtn(view, label) {
        var isActive = CC.detailView === view;
        return '<button onclick="ccSetView(\'' + view + '\')" class="text-xs px-3 py-1 rounded-md font-medium transition-colors'
            + (isActive
                ? ' bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 shadow-sm'
                : ' text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')
            + '">' + label + '</button>';
    }

    // ── Daily table (compact) ────────────────────────────────────────
    function _renderDailyTable(id) {
        var stn    = CC.data.stations_config[id];
        var stData = (CC.data.data || {})[id] || {};
        var days   = CC.data.days || [];
        if (!days.length) return "<p class=\"text-sm text-gray-400\">No data.</p>";

        // Summary pills
        var over85 = 0, over100 = 0;
        days.forEach(function (d) {
            var p = _pct(((stData[d] || {}).total || 0), stn.max_daily);
            if (p !== null && p >= 85)  over85++;
            if (p !== null && p >= 100) over100++;
        });

        var statsHtml = '<div class="flex flex-wrap gap-2 mb-3">'
            + '<span class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-lynx-divider text-gray-500">'
            + '<i class="fas fa-calendar-check text-gray-400 text-[0.65rem]"></i>' + days.length + " days</span>";
        if (over85 > 0)
            statsHtml += '<span class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400">'
                + '<i class="fas fa-exclamation-triangle text-[0.65rem]"></i>\u226585%: ' + over85 + " days</span>";
        if (over100 > 0)
            statsHtml += '<span class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400">'
                + '<i class="fas fa-times-circle text-[0.65rem]"></i>\u2265100%: ' + over100 + " days</span>";
        statsHtml += '</div>';

        var html = statsHtml
            + '<div class="rounded-lg border border-lynx-divider overflow-hidden">'
            + '<table class="w-full text-xs border-collapse">'
            + '<thead><tr class="bg-gray-50 dark:bg-gray-900">'
            + "<th class=\"px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300 border-b border-r border-lynx-divider w-32\">Date</th>"
            + "<th class=\"px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300 border-b border-r border-lynx-divider\">Occupancy</th>"
            + '<th class="px-3 py-2.5 text-center font-semibold text-gray-600 dark:text-gray-300 border-b border-r border-lynx-divider w-16">Total</th>'
            + (stn.max_daily ? '<th class="px-3 py-2.5 text-center font-semibold text-gray-600 dark:text-gray-300 border-b border-r border-lynx-divider w-14">%</th>' : '')
            + '<th class="px-3 py-2.5 text-center font-semibold text-gray-600 dark:text-gray-300 border-b w-14">OOT</th>'
            + '</tr></thead><tbody>';

        days.forEach(function (day) {
            var dd      = stData[day] || { total: 0, oot: 0 };
            var p       = _pct(dd.total, stn.max_daily);
            var pR      = p !== null ? Math.round(p) : null;
            var isWE    = _isWeekend(day);
            var isTod   = _isToday(day);
            var rowBg   = isTod ? 'bg-primary-50/50 dark:bg-primary-900/10' : isWE ? 'bg-blue-50/30 dark:bg-blue-950/10' : '';
            var bw      = stn.max_daily ? Math.min(Math.round((dd.total / stn.max_daily) * 100), 100) : 0;
            var barCls  = p >= 100 ? 'bg-red-500' : p >= 85 ? 'bg-orange-400' : p >= 70 ? 'bg-amber-400' : 'bg-emerald-400 dark:bg-emerald-500';

            html += '<tr class="border-b border-lynx-divider hover:bg-gray-50/80 dark:hover:bg-gray-800/40 ' + rowBg + '">';
            html += '<td class="px-3 py-2.5 border-r border-lynx-divider whitespace-nowrap font-medium'
                + (isTod ? ' text-primary-600 dark:text-primary-400' : ' text-gray-700 dark:text-gray-300') + '">'
                + _fmtDate(day)
                + (isTod ? ' <span class="text-[0.5rem] font-bold uppercase bg-primary-500 text-white px-1 py-0.5 rounded ml-0.5">hoje</span>' : '')
                + '</td>';
            html += '<td class="px-3 py-2.5 border-r border-lynx-divider">';
            if (stn.max_daily) {
                html += '<div class="w-full h-3 rounded bg-gray-100 dark:bg-gray-700 overflow-hidden">'
                    + '<div class="h-full rounded ' + barCls + '" style="width:' + bw + '%"></div></div>';
            } else {
                html += "<span class=\"text-gray-400 italic\">no limit</span>";
            }
            html += '</td>';
            html += '<td class="px-3 py-2.5 text-center border-r border-lynx-divider font-mono font-semibold ' + _pctTextCls(p) + '">' + dd.total + '</td>';
            if (stn.max_daily)
                html += '<td class="px-3 py-2.5 text-center border-r border-lynx-divider font-semibold ' + _pctTextCls(p) + '">' + (pR !== null ? pR + '%' : '\u2014') + '</td>';
            html += '<td class="px-3 py-2.5 text-center ' + (dd.oot > 0 ? 'text-orange-500 font-semibold' : 'text-gray-400') + '">'
                + (dd.oot > 0 ? '<i class="fas fa-moon text-[0.6rem] mr-0.5"></i>' + dd.oot : '\u2014') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    // ── Hourly table (detailed) ──────────────────────────────────────
    function _renderHourlyTable(id) {
        var stn    = CC.data.stations_config[id];
        var meta   = (CC.data.slots_meta || {})[id] || [];
        var stData = (CC.data.data || {})[id] || {};
        var days   = CC.data.days || [];
        if (!days.length) return "<p class=\"text-sm text-gray-400\">No data.</p>";

        var hasOther = days.some(function (d) { return ((stData[d] || {}).slots || {}).__other__ > 0; });
        var cols = meta.slice();
        if (hasOther) cols.push({ key: '__other__', label: "⚠ Other", max: null });

        var html = '<div class="overflow-x-auto rounded-lg border border-lynx-divider">'
            + '<table class="text-xs border-collapse" style="min-width:max-content">'
            + '<thead><tr class="bg-gray-50 dark:bg-gray-900">'
            + "<th class=\"px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-300 border-b border-r border-lynx-divider whitespace-nowrap sticky left-0 bg-gray-50 dark:bg-gray-900 z-10 w-28\">Date</th>";

        cols.forEach(function (sl) {
            var maxLbl = sl.max != null ? '<br><span class="font-normal text-gray-400 text-[0.58rem]">\u2191' + sl.max + '</span>' : '';
            html += '<th class="px-2 py-2 font-semibold text-gray-500 dark:text-gray-400 border-b border-r border-lynx-divider text-center whitespace-nowrap w-14">'
                + _esc(sl.label) + maxLbl + '</th>';
        });
        html += '<th class="px-2 py-2 font-semibold text-gray-600 dark:text-gray-300 border-b border-lynx-divider text-center whitespace-nowrap w-20">Total'
            + (stn.max_daily ? '<br><span class="font-normal text-gray-400 text-[0.58rem]">\u2191' + stn.max_daily + '</span>' : '')
            + '</th></tr></thead><tbody>';

        days.forEach(function (day) {
            var dd      = stData[day] || { total: 0, oot: 0, slots: {} };
            var isWE    = _isWeekend(day);
            var isTod   = _isToday(day);
            var totPct  = _pct(dd.total, stn.max_daily);
            var rowBg   = isTod ? 'bg-primary-50/50 dark:bg-primary-900/10' : isWE ? 'bg-blue-50/30 dark:bg-blue-950/10' : '';

            html += '<tr class="border-b border-lynx-divider hover:bg-gray-50/80 dark:hover:bg-gray-800/40 ' + rowBg + '">';
            html += '<td class="px-3 py-2 font-medium border-r border-lynx-divider whitespace-nowrap sticky left-0 z-10 '
                + (isTod ? 'text-primary-600 dark:text-primary-400 bg-primary-50/90 dark:bg-primary-900/30'
                         : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-950') + '">'
                + _fmtDate(day)
                + (isTod ? '<br><span class="text-[0.5rem] font-bold uppercase text-primary-500">hoje</span>' : '')
                + '</td>';
            cols.forEach(function (sl) {
                var cnt = (dd.slots || {})[sl.key] || 0;
                var p   = _pct(cnt, sl.max);
                html += '<td class="px-1.5 py-1.5 border-r border-lynx-divider text-center ' + _cellBg(p) + '">' + _bar(cnt, sl.max) + '</td>';
            });
            html += '<td class="px-1.5 py-1.5 text-center font-semibold ' + _cellBg(totPct) + ' ' + _pctTextCls(totPct) + '">'
                + _bar(dd.total, stn.max_daily) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>'
            + '<div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[0.6rem] text-gray-400 dark:text-gray-500">'
            + '<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400"></span>&lt;70%</span>'
            + '<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400"></span>70\u201384%</span>'
            + '<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-sm bg-orange-400"></span>85\u201399%</span>'
            + '<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-sm bg-red-500"></span>\u2265100%</span>'
            + '</div>';

        return html;
    }

    // ── Public controls ──────────────────────────────────────────────
    window.ccSelectStation = function (id) {
        CC.selectedStation = id;
        _render();
        setTimeout(function () {
            var el = document.querySelector('[data-cc-selected]');
            if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 60);
    };
    window.ccSetView = function (v) { CC.detailView = v; _render(); };

    // Edit a single station -> opens config modal pre-focused on it
    window.ccEditStation = function (sid) {
        ccOpenConfig();
        // expand its card
        setTimeout(function () {
            var card = document.querySelector('[data-cc-station="' + sid + '"]');
            if (card) {
                card.setAttribute('open', 'open');
                card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 80);
    };

    // ═════════════════════ CONFIG MODAL (form + JSON) ════════════════
    window.ccOpenConfig = function () {
        var existing = document.getElementById('ccConfigModal');
        if (existing) existing.remove();

        var stns = (CC.data && CC.data.stations_config) ? CC.data.stations_config : {};
        // Deep-clone into draft
        CC._configDraft = JSON.parse(JSON.stringify(stns));
        CC.configMode   = 'form';

        var modal = document.createElement('div');
        modal.id  = 'ccConfigModal';
        modal.className = 'fixed inset-0 z-50 flex items-start justify-center pt-10 px-4 pb-4';
        modal.style.background = 'rgba(0,0,0,0.5)';
        modal.innerHTML =
              '<div class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col">'
            +   '<div class="flex items-center justify-between px-5 py-4 border-b border-lynx-divider flex-shrink-0">'
            +     '<h3 class="font-semibold text-gray-800 dark:text-gray-100 text-sm flex items-center gap-2">'
            +       "<i class=\"fas fa-sliders-h text-primary-500\"></i>Capacity &amp; Time-Slot Configuration"
            +     '</h3>'
            +     '<div class="flex items-center gap-2">'
            +       '<div class="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">'
            +         "<button id=\"ccModeForm\" onclick=\"ccSetConfigMode('form')\" class=\"text-xs px-3 py-1 rounded-md font-medium\"><i class=\"fas fa-list mr-1\"></i>Form</button>"
            +         '<button id="ccModeJson" onclick="ccSetConfigMode(\'json\')" class="text-xs px-3 py-1 rounded-md font-medium"><i class="fas fa-code mr-1"></i>JSON</button>'
            +       '</div>'
            +       '<button onclick="ccCloseConfig()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-1"><i class="fas fa-times"></i></button>'
            +     '</div>'
            +   '</div>'
            +   '<div id="ccConfigBody" class="flex-1 overflow-y-auto p-5 min-h-0"></div>'
            +   '<div class="px-5 py-3.5 border-t border-lynx-divider flex items-center gap-2 justify-end flex-shrink-0">'
            +     '<span id="ccConfigStatus" class="text-xs text-gray-400 flex-1 mr-2"></span>'
            +     "<button onclick=\"ccAddStation()\" class=\"text-xs px-3 py-2 rounded-lg border border-lynx-divider text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800\"><i class=\"fas fa-plus mr-1\"></i>New station</button>"
            +     "<button onclick=\"ccCloseConfig()\" class=\"text-xs px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800\">Cancel</button>"
            +     "<button onclick=\"ccSaveConfig()\" class=\"text-xs px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold hover:bg-primary-600\"><i class=\"fas fa-save mr-1\"></i>Save</button>"
            +   '</div>'
            + '</div>';
        document.body.appendChild(modal);
        modal.addEventListener('click', function (e) { if (e.target === modal) ccCloseConfig(); });

        _renderConfigBody();
    };

    window.ccSetConfigMode = function (mode) {
        // Sync current view -> draft before switching
        if (CC.configMode === 'json') {
            var ta = document.getElementById('ccConfigJson');
            if (ta) {
                try {
                    var parsed = JSON.parse(ta.value);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) CC._configDraft = parsed;
                } catch (e) {
                    var st = document.getElementById('ccConfigStatus');
                    if (st) st.innerHTML = "<span class=\"text-red-500\"><i class=\"fas fa-times mr-1\"></i>Invalid JSON. Correct it before switching to form view.</span>";
                    return;
                }
            }
        }
        CC.configMode = mode;
        _renderConfigBody();
    };

    function _renderConfigBody() {
        var body = document.getElementById('ccConfigBody');
        if (!body) return;
        // Toggle btn highlight
        var btnF = document.getElementById('ccModeForm');
        var btnJ = document.getElementById('ccModeJson');
        if (btnF && btnJ) {
            var act   = 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 shadow-sm';
            var inact = 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200';
            btnF.className = 'text-xs px-3 py-1 rounded-md font-medium ' + (CC.configMode === 'form' ? act : inact);
            btnJ.className = 'text-xs px-3 py-1 rounded-md font-medium ' + (CC.configMode === 'json' ? act : inact);
        }
        body.innerHTML = CC.configMode === 'json' ? _renderConfigJson() : _renderConfigForm();
    }

    function _renderConfigForm() {
        var keys = Object.keys(CC._configDraft || {});
        if (!keys.length) {
            return '<div class="text-center text-gray-400 py-12">'
                + '<i class="fas fa-inbox text-3xl mb-3 opacity-30"></i>'
                + "<p class=\"text-sm\">No stations configured.</p>"
                + "<p class=\"text-xs mt-2\">Use the <strong>New station</strong> button below to add one.</p></div>";
        }
        return '<div class="space-y-3">' + keys.map(_renderStationCard).join('') + '</div>';
    }

    function _renderStationCard(sid) {
        var st = CC._configDraft[sid] || {};
        var slots = Array.isArray(st.slots) ? st.slots : [];

        var slotsHtml = slots.map(function (sl, idx) {
            return '<div class="grid grid-cols-12 gap-2 items-center text-xs">'
                + '<input type="time" value="' + _escAttr(sl.from || '') + '" onchange="ccUpdateSlot(\'' + _escAttr(sid) + '\',' + idx + ',\'from\',this.value)" class="col-span-3 px-2 py-1 border border-lynx-divider rounded bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300">'
                + '<input type="time" value="' + _escAttr(sl.to   || '') + '" onchange="ccUpdateSlot(\'' + _escAttr(sid) + '\',' + idx + ',\'to\',this.value)"   class="col-span-3 px-2 py-1 border border-lynx-divider rounded bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300">'
                + '<input type="number" min="0" placeholder="max" value="' + (sl.max != null ? sl.max : '') + '" onchange="ccUpdateSlot(\'' + _escAttr(sid) + '\',' + idx + ',\'max\',this.value)" class="col-span-2 px-2 py-1 border border-lynx-divider rounded bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300">'
                + '<input type="text" placeholder="r\u00f3tulo" value="' + _escAttr(sl.label || '') + '" oninput="ccUpdateSlot(\'' + _escAttr(sid) + '\',' + idx + ',\'label\',this.value)" class="col-span-3 px-2 py-1 border border-lynx-divider rounded bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300">'
                + '<button onclick="ccRemoveSlot(\'' + _escAttr(sid) + '\',' + idx + ')" class="col-span-1 text-red-500 hover:text-red-700 text-xs"><i class="fas fa-trash"></i></button>'
                + '</div>';
        }).join('');

        var stIdsValue = Array.isArray(st.station_ids) ? st.station_ids.join(', ') : sid;

        return '<details data-cc-station="' + _escAttr(sid) + '" class="rounded-lg border border-lynx-divider bg-white dark:bg-gray-900 overflow-hidden">'
            + '<summary class="px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between gap-2">'
            +   '<div class="flex items-center gap-2">'
            +     '<i class="fas fa-chevron-right text-xs text-gray-400 transition-transform"></i>'
            +     '<span class="font-semibold text-sm text-gray-700 dark:text-gray-200">' + _esc(st.name || sid) + '</span>'
            +     '<span class="text-[0.65rem] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">' + _esc(sid) + '</span>'
            +     (st.max_daily ? "<span class=\"text-[0.65rem] text-gray-400\">max " + st.max_daily + '/day</span>' : '')
            +     '<span class="text-[0.65rem] text-gray-400">' + slots.length + ' slot(s)</span>'
            +   '</div>'
            +   '<button onclick="event.preventDefault(); event.stopPropagation(); ccRemoveStation(\'' + _escAttr(sid) + '\')" class="text-red-500 hover:text-red-700 text-xs px-2 py-1"><i class="fas fa-trash"></i></button>'
            + '</summary>'
            + '<div class="px-4 py-3 border-t border-lynx-divider space-y-3">'
            // Basic fields grid
            +   '<div class="grid grid-cols-12 gap-2 text-xs">'
            +     "<label class=\"col-span-6\"><span class=\"block text-[0.6rem] font-semibold uppercase text-gray-400 mb-0.5\">Name</span>"
            +       '<input type="text" value="' + _escAttr(st.name || '') + '" oninput="ccUpdateStation(\'' + _escAttr(sid) + '\',\'name\',this.value)" class="w-full px-2 py-1 border border-lynx-divider rounded bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"></label>'
            +     "<label class=\"col-span-6\"><span class=\"block text-[0.6rem] font-semibold uppercase text-gray-400 mb-0.5\">station_ids (comma-separated)</span>"
            +       '<input type="text" value="' + _escAttr(stIdsValue) + '" oninput="ccUpdateStationIds(\'' + _escAttr(sid) + '\',this.value)" class="w-full px-2 py-1 border border-lynx-divider rounded bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-mono"></label>'
            +     '<label class="col-span-3"><span class="block text-[0.6rem] font-semibold uppercase text-gray-400 mb-0.5">Abre</span>'
            +       '<input type="time" value="' + _escAttr(st.opens_at || '') + '" onchange="ccUpdateStation(\'' + _escAttr(sid) + '\',\'opens_at\',this.value)" class="w-full px-2 py-1 border border-lynx-divider rounded bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"></label>'
            +     '<label class="col-span-3"><span class="block text-[0.6rem] font-semibold uppercase text-gray-400 mb-0.5">Fecha</span>'
            +       '<input type="time" value="' + _escAttr(st.closes_at || '') + '" onchange="ccUpdateStation(\'' + _escAttr(sid) + '\',\'closes_at\',this.value)" class="w-full px-2 py-1 border border-lynx-divider rounded bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"></label>'
            +     "<label class=\"col-span-3\"><span class=\"block text-[0.6rem] font-semibold uppercase text-gray-400 mb-0.5\">Oct-of-hours until</span>"
            +       '<input type="time" value="' + _escAttr(st.oot_until || '00:00') + '" onchange="ccUpdateStation(\'' + _escAttr(sid) + '\',\'oot_until\',this.value)" class="w-full px-2 py-1 border border-lynx-divider rounded bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"></label>'
            +     "<label class=\"col-span-3\"><span class=\"block text-[0.6rem] font-semibold uppercase text-gray-400 mb-0.5\">Daily maximum</span>"
            +       '<input type="number" min="0" value="' + (st.max_daily != null ? st.max_daily : '') + '" onchange="ccUpdateStation(\'' + _escAttr(sid) + '\',\'max_daily\',this.value)" class="w-full px-2 py-1 border border-lynx-divider rounded bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"></label>'
            +   '</div>'
            // Slots
            +   '<div>'
            +     '<div class="flex items-center justify-between mb-1.5">'
            +       "<p class=\"text-[0.6rem] font-semibold uppercase text-gray-400\">Time slots</p>"
            +       '<button onclick="ccAddSlot(\'' + _escAttr(sid) + '\')" class="text-[0.65rem] px-2 py-1 rounded bg-primary-500 text-white hover:bg-primary-600"><i class="fas fa-plus mr-1"></i>Slot</button>'
            +     '</div>'
            +     (slots.length === 0
                    ? "<p class=\"text-[0.7rem] text-gray-400 italic px-2 py-3 text-center bg-gray-50 dark:bg-gray-800/40 rounded border border-dashed border-lynx-divider\">No time slots defined. Reservations appear only in the daily total.</p>"
                    : '<div class="space-y-1.5"><div class="grid grid-cols-12 gap-2 text-[0.58rem] font-semibold uppercase text-gray-400 px-1">'
                      + "<span class=\"col-span-3\">From</span><span class=\"col-span-3\">Until</span><span class=\"col-span-2\">Max</span><span class=\"col-span-3\">Label</span><span class=\"col-span-1\"></span>"
                      + '</div>' + slotsHtml + '</div>')
            +   '</div>'
            + '</div></details>';
    }

    function _renderConfigJson() {
        return '<div class="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-700/50 rounded-lg px-4 py-3 text-xs text-blue-700 dark:text-blue-300 mb-3">'
            + "<p class=\"font-semibold mb-1\"><i class=\"fas fa-info-circle mr-1\"></i>Advanced mode</p>"
            + "<p>Edit the JSON directly. Use <code class=\"font-mono bg-blue-100 dark:bg-blue-900/50 px-1 rounded\">station_ids</code> to group multiple stations.</p>"
            + '</div>'
            + '<textarea id="ccConfigJson" class="w-full font-mono text-xs bg-gray-50 dark:bg-gray-800 border border-lynx-divider rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400" rows="22" spellcheck="false">'
            + _esc(JSON.stringify(CC._configDraft || {}, null, 2))
            + '</textarea>';
    }

    // ── Draft mutation helpers ──────────────────────────────────────
    window.ccUpdateStation = function (sid, field, value) {
        if (!CC._configDraft || !CC._configDraft[sid]) return;
        if (field === 'max_daily') {
            var n = parseInt(value, 10);
            CC._configDraft[sid][field] = isNaN(n) ? null : n;
        } else {
            CC._configDraft[sid][field] = value;
        }
    };
    window.ccUpdateStationIds = function (sid, value) {
        if (!CC._configDraft || !CC._configDraft[sid]) return;
        var arr = String(value || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        CC._configDraft[sid].station_ids = arr.length ? arr : [sid];
    };
    window.ccUpdateSlot = function (sid, idx, field, value) {
        var st = CC._configDraft && CC._configDraft[sid];
        if (!st || !Array.isArray(st.slots) || !st.slots[idx]) return;
        if (field === 'max') {
            var n = parseInt(value, 10);
            st.slots[idx][field] = isNaN(n) ? null : n;
        } else {
            st.slots[idx][field] = value;
        }
        // auto-update card header counter without full re-render of inputs
        var summary = document.querySelector('[data-cc-station="' + sid + '"] summary span:nth-last-child(1)');
        // (skip — re-render only on add/remove)
    };
    window.ccAddSlot = function (sid) {
        var st = CC._configDraft && CC._configDraft[sid];
        if (!st) return;
        if (!Array.isArray(st.slots)) st.slots = [];
        var last = st.slots[st.slots.length - 1];
        // defFrom: next hour after last slot's "from" (last.to is HH:59, so next from = HH+1:00)
        var defFrom = '08:00';
        if (last && last.from) {
            var parts = last.from.split(':');
            var nextH = (parseInt(parts[0], 10) + 1) % 24;
            defFrom = (nextH < 10 ? '0' : '') + nextH + ':00';
        }
        // default "to" = defFrom_hour:59
        var defToH = parseInt(defFrom.split(':')[0], 10);
        var defTo = (defToH < 10 ? '0' : '') + defToH + ':59';
        st.slots.push({ from: defFrom, to: defTo, max: null, label: '' });
        _renderConfigBody();
        // keep card open
        var card = document.querySelector('[data-cc-station="' + sid + '"]');
        if (card) card.setAttribute('open', 'open');
    };
    window.ccRemoveSlot = function (sid, idx) {
        var st = CC._configDraft && CC._configDraft[sid];
        if (!st || !Array.isArray(st.slots)) return;
        st.slots.splice(idx, 1);
        _renderConfigBody();
        var card = document.querySelector('[data-cc-station="' + sid + '"]');
        if (card) card.setAttribute('open', 'open');
    };
    window.ccAddStation = function () {
        var sid = prompt("New station ID (numeric):");
        if (sid == null) return;
        sid = String(sid).trim();
        if (!sid) return;
        if (!CC._configDraft) CC._configDraft = {};
        if (CC._configDraft[sid]) { alert("A station with that ID already exists."); return; }
        CC._configDraft[sid] = {
            name: '', station_ids: [sid],
            opens_at: '08:00', closes_at: '20:00', oot_until: '00:00',
            max_daily: null, slots: [],
        };
        CC.configMode = 'form';
        _renderConfigBody();
        setTimeout(function () {
            var card = document.querySelector('[data-cc-station="' + sid + '"]');
            if (card) { card.setAttribute('open', 'open'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        }, 50);
    };
    window.ccRemoveStation = function (sid) {
        if (!CC._configDraft || !CC._configDraft[sid]) return;
        if (!confirm("Remove station \"" + (CC._configDraft[sid].name || sid) + '"?')) return;
        delete CC._configDraft[sid];
        _renderConfigBody();
    };

    window.ccCloseConfig = function () {
        var m = document.getElementById('ccConfigModal');
        if (m) m.remove();
        CC._configDraft = null;
    };

    window.ccSaveConfig = function () {
        var st = document.getElementById('ccConfigStatus');
        var parsed;
        if (CC.configMode === 'json') {
            var ta = document.getElementById('ccConfigJson');
            if (!ta) return;
            try { parsed = JSON.parse(ta.value); }
            catch (e) {
                if (st) st.innerHTML = '<span class="text-red-500"><i class="fas fa-times mr-1"></i>JSON inv\u00e1lido: ' + _esc(e.message) + '</span>';
                return;
            }
            if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                if (st) st.innerHTML = "<span class=\"text-red-500\"><i class=\"fas fa-times mr-1\"></i>Expected an object, not an array.</span>";
                return;
            }
        } else {
            parsed = CC._configDraft || {};
        }

        // Light validation
        var bad = null;
        Object.keys(parsed).forEach(function (sid) {
            var s2 = parsed[sid];
            if (!s2 || typeof s2 !== 'object') { bad = "Station " + sid + ' inv\u00e1lida'; return; }
            if (Array.isArray(s2.slots)) {
                s2.slots.forEach(function (sl, i) {
                    if (!sl.from || !sl.to) bad = bad || "Station " + sid + ', slot ' + (i + 1) + ": missing start or end time";
                });
            }
        });
        if (bad) { if (st) st.innerHTML = '<span class="text-red-500"><i class="fas fa-times mr-1"></i>' + _esc(bad) + '</span>'; return; }

        if (st) st.innerHTML = '<span class="text-gray-400"><i class="fas fa-spinner fa-spin mr-1"></i>A guardar\u2026</span>';
        fetch('/api/capacity-control/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stations: parsed }),
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.error) { if (st) st.innerHTML = '<span class="text-red-500"><i class="fas fa-times mr-1"></i>' + _esc(d.error) + '</span>'; return; }
                if (st) st.innerHTML = '<span class="text-emerald-600 dark:text-emerald-400"><i class="fas fa-check mr-1"></i>Guardado!</span>';
                CC.data = null;
                setTimeout(function () { ccCloseConfig(); _load(); }, 700);
            })
            .catch(function (e) {
                if (st) st.innerHTML = '<span class="text-red-500"><i class="fas fa-times mr-1"></i>' + _esc(e.message) + '</span>';
            });
    };


    // ── Aceleração de Grupos Radar ───────────────────────────────

    // Load persisted tracked groups on init
    try {
        var _storedGroups = localStorage.getItem('rena-cc-radar-groups');
        if (_storedGroups) CC.radarGroups = JSON.parse(_storedGroups) || [];
    } catch (e) {}

    window.ccToggleRadar = function () {
        CC.radarVisible = !CC.radarVisible;
        var btn   = document.getElementById('ccRadarBtn');
        var panel = document.getElementById('ccRadarPanel');
        if (btn) {
            btn.classList.toggle('border-primary-500/50', CC.radarVisible);
            btn.classList.toggle('bg-primary-500/10', CC.radarVisible);
            btn.classList.toggle('text-primary-500', CC.radarVisible);
        }
        if (panel) {
            if (CC.radarVisible) { panel.classList.remove('hidden'); _loadGroupRadar(); }
            else panel.classList.add('hidden');
        }
    };

    window.ccRefreshRadar = function () {
        CC.planningData = null;
        _loadGroupRadar();
    };

    window.ccToggleRadarGroup = function (g) {
        var idx = CC.radarGroups.indexOf(g);
        if (idx >= 0) CC.radarGroups.splice(idx, 1);
        else CC.radarGroups.push(g);
        try { localStorage.setItem('rena-cc-radar-groups', JSON.stringify(CC.radarGroups)); } catch (e) {}
        _renderGroupRadar();
    };

    function _loadGroupRadar() {
        if (CC.planningData) { _renderGroupRadar(); return; }
        if (CC.radarLoading) return;
        CC.radarLoading = true;
        var panel = document.getElementById('ccRadarPanel');
        if (panel) panel.innerHTML = '<div class="lynx-card p-5 text-center text-gray-400">'
            + '<i class="fas fa-spinner fa-spin text-xl"></i>'
            + "<p class=\"mt-2 text-sm\">Loading data…</p></div>";
        fetch('/api/fleet-planning?days=30')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                CC.radarLoading = false;
                if (d.error) {
                    var p = document.getElementById('ccRadarPanel');
                    if (p) p.innerHTML = '<div class="lynx-card p-4 text-center text-red-400">'
                        + '<i class="fas fa-times-circle mr-2"></i>' + _esc(d.error) + '</div>';
                    return;
                }
                CC.planningData = d;
                _renderGroupRadar();
            })
            .catch(function (e) {
                CC.radarLoading = false;
                var p = document.getElementById('ccRadarPanel');
                if (p) p.innerHTML = '<div class="lynx-card p-4 text-center text-red-400">'
                    + "<i class=\"fas fa-times-circle mr-2\"></i>Error: " + _esc(e.message) + '</div>';
            });
    }

    /**
     * Aggregate per-group saldo and demand across all planning pools.
     * Returns { gd, allGroups } or null.
     */
    function _buildGroupData() {
        var pd = CC.planningData;
        if (!pd || !pd.pools) return null;
        var poolNames = Object.keys(pd.pools);
        if (!poolNames.length) return null;
        var nDays = (pd.pools[poolNames[0]].rows || []).length;
        var gd = {};

        function ensure(g) {
            if (!gd[g]) gd[g] = { saldo0: 0, totalDemand: 0, minSaldo: null };
        }

        poolNames.forEach(function (pname) {
            var pool = pd.pools[pname];
            if (!pool) return;
            Object.keys(pool.groups_available || {}).forEach(function (g) {
                ensure(g); gd[g].saldo0 += (pool.groups_available[g] || 0);
            });
            // Running balance to find min saldo
            var runGrp = Object.assign({}, pool.groups_available || {});
            (pool.rows || []).forEach(function (row) {
                Object.keys(row.groups_defleet_out || {}).forEach(function (g) {
                    ensure(g); runGrp[g] = (runGrp[g] || 0) - (row.groups_defleet_out[g] || 0);
                });
                // Min check after defleet
                Object.keys(runGrp).forEach(function (g) {
                    ensure(g);
                    if (gd[g].minSaldo === null || runGrp[g] < gd[g].minSaldo) gd[g].minSaldo = runGrp[g];
                });
                Object.keys(row.groups_out || {}).forEach(function (g) {
                    ensure(g); gd[g].totalDemand += (row.groups_out[g] || 0);
                });
                Object.keys(row.groups_fleet_in || {}).forEach(function (g) { ensure(g); runGrp[g] = (runGrp[g] || 0) + (row.groups_fleet_in[g] || 0); });
                Object.keys(row.groups_in      || {}).forEach(function (g) { ensure(g); runGrp[g] = (runGrp[g] || 0) + (row.groups_in[g]       || 0); });
                Object.keys(row.groups_out     || {}).forEach(function (g) { ensure(g); runGrp[g] = (runGrp[g] || 0) - (row.groups_out[g]      || 0); });
            });
        });

        Object.keys(gd).forEach(function (g) {
            var d = gd[g];
            if (d.minSaldo === null) d.minSaldo = d.saldo0;
            d.status = (d.minSaldo < 0 || d.saldo0 < 0) ? 'critical'
                     : (d.minSaldo <= 5 || d.saldo0 <= 3) ? 'warning' : 'ok';
        });

        var allGroups = Object.keys(gd)
            .filter(function (g) { return gd[g].saldo0 > 0 || gd[g].totalDemand > 0; })
            .sort();
        return { gd: gd, allGroups: allGroups };
    }

    /**
     * Diff current future reservation numbers vs. localStorage snapshot.
     * Returns { newByGroup, snapshotAge }.
     */
    function _computeNewRes() {
        var pd = CC.planningData;
        if (!pd || !pd.pools) return { newByGroup: {}, snapshotAge: null };
        var currentNos = {};
        Object.keys(pd.pools).forEach(function (pname) {
            (pd.pools[pname].rows || []).forEach(function (row) {
                (row.res_out_details || []).forEach(function (d) {
                    if (d.res_no && d.group) currentNos[d.res_no] = d.group;
                });
            });
        });
        var nowMs = Date.now();
        var newByGroup = {}, snapshotAge = null;
        try {
            var stored = localStorage.getItem('rena-fp-res-snapshot');
            if (stored) {
                var prev = JSON.parse(stored);
                var prevSet = new Set(prev.nos || []);
                snapshotAge = prev.ts ? Math.round((nowMs - prev.ts) / 60000) : null;
                Object.keys(currentNos).forEach(function (no) {
                    if (!prevSet.has(no)) {
                        var g = currentNos[no];
                        newByGroup[g] = (newByGroup[g] || 0) + 1;
                    }
                });
            }
        } catch (e) {}
        try {
            localStorage.setItem('rena-fp-res-snapshot', JSON.stringify({ nos: Object.keys(currentNos), ts: nowMs }));
        } catch (e) {}
        return { newByGroup: newByGroup, snapshotAge: snapshotAge };
    }

    function _renderGroupRadar() {
        var wrap = document.getElementById('ccRadarPanel');
        if (!wrap || !CC.radarVisible) return;

        var health = _buildGroupData();
        var allGroups = health ? health.allGroups : [];
        var gd        = health ? health.gd : {};
        var accel     = health ? _computeNewRes() : { newByGroup: {}, snapshotAge: null };

        var html = '<div class="lynx-card p-4">';

        // Header
        html += '<div class="flex items-center justify-between mb-4 flex-wrap gap-2">';
        html += '<div class="flex items-center gap-2">';
        html += "<h3 class=\"text-sm font-bold lynx-text-primary\"><i class=\"fas fa-satellite-dish text-primary-500 mr-2\"></i>Reservation Growth</h3>";
        if (accel.snapshotAge != null)
            html += "<span class=\"text-[0.65rem] text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full\">compared with " + accel.snapshotAge + ' min</span>';
        html += '</div>';
        html += '<button onclick="ccRefreshRadar()" class="text-xs px-2.5 py-1 rounded-lg border border-lynx-divider text-gray-400 hover:text-primary-500 transition-colors"><i class="fas fa-sync-alt mr-1"></i>Reload</button>';
        html += '</div>';

        // Group selector chips
        if (allGroups.length) {
            html += '<div class="flex flex-wrap items-center gap-1.5 mb-4 pb-3 border-b border-lynx-divider dark:border-gray-700">';
            html += "<span class=\"text-[0.6rem] text-gray-400 uppercase tracking-wider font-semibold self-center mr-1\">Groups:</span>";
            allGroups.forEach(function (g) {
                var isTracked = CC.radarGroups.indexOf(g) >= 0;
                var newHere   = accel.newByGroup[g] || 0;
                var chipCls = isTracked
                    ? 'bg-primary-500/15 border-primary-500/50 text-primary-500 font-bold'
                    : 'border-gray-300 dark:border-gray-700 text-gray-400 hover:border-primary-400 hover:text-primary-400';
                html += '<button onclick="ccToggleRadarGroup(\'' + _escAttr(g) + '\')" '
                    + 'class="text-[0.7rem] font-mono px-2 py-0.5 rounded-lg border transition-colors ' + chipCls + '">'
                    + _esc(g)
                    + (isTracked ? ' <i class="fas fa-check text-[0.55rem]"></i>' : '')
                    + (newHere > 0 && isTracked ? ' <span class="text-emerald-400">+' + newHere + '</span>' : '')
                    + '</button>';
            });
            html += '</div>';
        } else if (!health) {
            html += "<p class=\"text-sm text-gray-400 text-center py-4\"><i class=\"fas fa-spinner fa-spin mr-2\"></i>Loading groups…</p>";
        }

        // Cards for tracked groups
        var tracked = CC.radarGroups.filter(function (g) { return allGroups.indexOf(g) >= 0; });

        if (!tracked.length) {
            html += '<div class="text-center text-gray-400 py-6">'
                + '<i class="fas fa-hand-pointer text-2xl mb-2 block opacity-30"></i>'
                + "<p class=\"text-sm\">Select groups to track</p>"
                + "<p class=\"text-[0.65rem] mt-1 text-gray-500\">Click the groups above to add them</p>"
                + '</div>';
        } else {
            html += '<div class="flex flex-wrap gap-3">';
            tracked.forEach(function (g) {
                var d        = gd[g] || { saldo0: 0, totalDemand: 0, minSaldo: 0, status: 'ok' };
                var newCount = accel.newByGroup[g] || 0;

                var borderCls  = d.status === 'critical' ? 'border-red-400/50'    : d.status === 'warning' ? 'border-yellow-400/50' : 'border-gray-200 dark:border-gray-700';
                var headerBg   = d.status === 'critical' ? 'bg-red-500/10'        : d.status === 'warning' ? 'bg-yellow-500/10'     : 'bg-gray-50 dark:bg-gray-800/60';
                var accentBg   = d.status === 'critical' ? 'bg-red-500/10 border-red-400/30'    : d.status === 'warning' ? 'bg-yellow-500/10 border-yellow-400/30' : 'bg-emerald-500/10 border-emerald-400/30';
                var accentText = d.status === 'critical' ? 'text-red-400'         : d.status === 'warning' ? 'text-yellow-400'      : 'text-emerald-400';
                var saldoCls   = d.saldo0 < 0 ? 'text-red-500 font-bold'
                               : d.saldo0 === 0 ? 'text-orange-400 font-bold'
                               : d.saldo0 <= 3  ? 'text-yellow-400 font-semibold' : 'text-emerald-400 font-semibold';
                var statusLabel = d.status === 'critical' ? "Critical" : d.status === 'warning' ? "Attention" : 'OK';
                var statusBadge = d.status === 'critical' ? 'bg-red-500/20 text-red-400' : d.status === 'warning' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400';

                html += '<div class="rounded-xl border ' + borderCls + ' overflow-hidden bg-white dark:bg-gray-900/80 flex flex-col" style="width:190px">';

                // Card header
                html += '<div class="flex items-center justify-between px-3.5 py-2.5 ' + headerBg + '">';
                html += '<div class="flex items-center gap-2">'
                    + '<span class="font-mono font-bold text-lg text-primary-500">' + _esc(g) + '</span>'
                    + '<span class="text-[0.6rem] px-1.5 py-0.5 rounded-full font-semibold ' + statusBadge + '">' + statusLabel + '</span>'
                    + '</div>';
                html += '<button onclick="ccToggleRadarGroup(\'' + _escAttr(g) + '\')" '
                    + "class=\"text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors leading-none text-base\" title=\"Remove\">"
                    + '<i class="fas fa-times"></i></button>';
                html += '</div>';

                // Stats row
                html += '<div class="flex gap-0 divide-x divide-lynx-divider dark:divide-gray-700 px-0 py-2">';
                html += '<div class="flex-1 text-center px-2">'
                    + "<p class=\"text-[0.58rem] text-gray-400 uppercase tracking-wide mb-0.5\">Balance</p>"
                    + '<p class="text-xl font-bold ' + saldoCls + '">' + d.saldo0 + '</p>'
                    + '</div>';
                html += '<div class="flex-1 text-center px-2">'
                    + '<p class="text-[0.58rem] text-gray-400 uppercase tracking-wide mb-0.5">Procura 30d</p>'
                    + '<p class="text-xl font-bold text-gray-500 dark:text-gray-400">' + (d.totalDemand || 0) + '</p>'
                    + '</div>';
                html += '</div>';

                // Acceleration block — the focal metric
                html += '<div class="mx-3 mb-3 rounded-lg border text-center py-3 ' + accentBg + '">';
                if (newCount > 0) {
                    html += '<p class="text-3xl font-bold ' + accentText + '">+' + newCount + '</p>';
                    html += "<p class=\"text-[0.65rem] text-gray-400 mt-0.5\">new reservations</p>";
                } else {
                    html += '<p class="text-2xl font-bold text-gray-300 dark:text-gray-600">&mdash;</p>';
                    html += "<p class=\"text-[0.65rem] text-gray-500 mt-0.5\">no changes</p>";
                }
                if (accel.snapshotAge != null)
                    html += '<p class="text-[0.55rem] text-gray-500 mt-1">há ' + accel.snapshotAge + ' min</p>';
                html += '</div>';

                html += '</div>';  // end card
            });
            html += '</div>';
        }

        html += '</div>';  // end lynx-card
        wrap.innerHTML = html;
    }

})();
