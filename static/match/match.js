/* ══════════════════════════════════════════════════════════════════════
   R.E.N.A. — Alocador de Viaturas  (v1)
   O utilizador insere uma matrícula; o sistema deteta o tipo (FP/BB),
   grupo e estação, e sugere as melhores reservas para alocar o carro.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var _state = {
        loading: false,
        result:  null,  // last single API result
        results: [],    // last batch results
        lastInput: '',
        history: [],    // session history (last 20 searches)
    };

    // ── Helpers ───────────────────────────────────────────────────────
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function _plate(raw) {
        return (raw || '').trim().toUpperCase().replace(/[^A-Z0-9\-]/g, '');
    }

    function _parsePlates(raw) {
        var seen = {};
        var out = [];
        String(raw || '').split(/[\n,;\t ]+/).forEach(function (p) {
            var n = _plate(p);
            if (!n || seen[n]) return;
            seen[n] = true;
            out.push(n);
        });
        return out;
    }

    function _fmtPlate(p) {
        // Normalize XX-XX-XX display
        return p || '—';
    }

    // ── Public API ────────────────────────────────────────────────────
    window.matchInit = function () {
        _render();
        _focusInput();
    };

    window.matchDestroy = function () {};

    window.matchSearch = function () {
        var input = document.getElementById('matchPlateInput');
        var raw   = input ? input.value : '';
        var plates = _parsePlates(raw);
        if (!plates.length) { _shakeInput(); return; }
        _doSearch(plates);
    };

    window.matchCopyRes = function (resNo) {
        if (!resNo) return;
        try {
            navigator.clipboard.writeText(resNo);
            _toast("Reservation No. copiado: " + resNo);
        } catch (_) {}
    };

    window.matchSearchAlt = function (stationId) {
        // Trigger a plate search filtered to that station — just show a toast for now
        _toast("Alternative station: " + stationId + ' — pesquisa manual via Lynx/Demo.');
    };

    window.matchRefreshData = async function () {
        var btn = document.getElementById('matchRefreshBtn');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
        _toast("Requesting updated fleet and reservation data…");
        try {
            var results = await Promise.allSettled([
                fetch('/api/not-available-fleet/request-refresh', { method: 'POST' }).then(function (r) { return r.json(); }),
                fetch('/api/reservations/refresh', { method: 'POST' }).then(function (r) { return r.json(); }),
            ]);
            var skippedFleet = results[0].status === 'fulfilled' && results[0].value && results[0].value.skipped;
            var skippedRes   = results[1].status === 'fulfilled' && results[1].value && results[1].value.skipped;
            if (skippedFleet && skippedRes) {
                _toast("The data is already up to date. Reusing the cached snapshot.");
            } else if (skippedFleet || skippedRes) {
                _toast("Request submitted. Some data was already up to date.");
            } else {
                _toast("Request submitted. Updated data will appear shortly.");
            }
        } catch (e) {
            _toast("Could not request a refresh.");
        } finally {
            setTimeout(function () {
                if (btn) { btn.disabled = false; btn.style.opacity = ''; }
            }, 3000);
        }
    };

    // ── Search ────────────────────────────────────────────────────────
    function _similarityKey(v) {
        if (!v) return '?:?:?';
        var rd = (v.remaining_days === null || v.remaining_days === undefined) ? '?' : String(v.remaining_days);
        return [v.tipo || '?', v.group || '?', rd].join('|');
    }

    function _dedupeBatchSuggestions(results) {
        var arr = (results || []).map(function (r) {
            if (!r || r.error) return r;
            var c = Object.assign({}, r);
            c._similarity_key = _similarityKey(c.vehicle || {});
            c._orig_suggestions = Array.isArray(c.suggestions) ? c.suggestions.slice() : [];
            c.suggestions = [];
            c._deduped = 0;
            return c;
        });

        var groups = {};
        arr.forEach(function (r, idx) {
            if (!r || r.error) return;
            var key = r._similarity_key || '?:?:?';
            if (!groups[key]) groups[key] = [];
            groups[key].push(idx);
        });

        Object.keys(groups).forEach(function (key) {
            var idxs = groups[key];
            var used = {};
            var cursor = {};

            idxs.forEach(function (i) { cursor[i] = 0; });

            // Fair distribution: each similar car gets one unique suggestion per round.
            // This prevents "first car gets all, second gets none".
            var progressed = true;
            while (progressed) {
                progressed = false;
                idxs.forEach(function (i) {
                    var r = arr[i];
                    var src = r._orig_suggestions || [];
                    var p = cursor[i] || 0;

                    while (p < src.length) {
                        var s = src[p++];
                        var resNo = s && s.res_no;
                        if (!resNo || used[resNo]) continue;
                        used[resNo] = true;
                        r.suggestions.push(s);
                        progressed = true;
                        break;
                    }

                    cursor[i] = p;
                });
            }

            idxs.forEach(function (i) {
                var r = arr[i];
                r._deduped = (r._orig_suggestions || []).length - (r.suggestions || []).length;
                delete r._orig_suggestions;
            });
        });

        return arr;
    }

    async function _doSearch(plates) {
        if (_state.loading) return;
        _state.loading = true;
        _state.lastInput = (plates || []).join('\n');
        _renderLoading(_state.lastInput || '');
        try {
            var arr = [];
            for (var i = 0; i < plates.length; i++) {
                var p = plates[i];
                var res  = await fetch('/api/match-vehicle?plate=' + encodeURIComponent(p));
                var data = await res.json();
                data._plate_input = p;
                arr.push(data);
            }

            arr = _dedupeBatchSuggestions(arr);
            _state.results = arr;
            _state.result  = arr.length === 1 ? arr[0] : null;

            arr.forEach(function (data) {
                if (data.error) return;
                var v = data.vehicle || {};
                fetch('/api/match-vehicle/log', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        plate:            v.plate || data._plate_input,
                        group:            v.group  || '',
                        tipo:             v.tipo   || '',
                        station:          v.eff_station || v.station || '',
                        remaining_days:   v.remaining_days,
                        had_suggestions:  (data.suggestions || []).length > 0,
                        suggestion_count: (data.suggestions || []).length,
                        top_res:          (data.suggestions || [])[0]?.res_no || '',
                    }),
                }).catch(function () {});

                _state.history.unshift({
                    plate:    v.plate || data._plate_input,
                    group:    v.group,
                    tipo:     v.tipo,
                    station:  v.eff_station || v.station,
                    count:    (data.suggestions || []).length,
                    ts:       window.renaFormatDate(new Date()),
                });
            });
            if (_state.history.length > 20) _state.history = _state.history.slice(0, 20);
        } catch (e) {
            _state.result = { error: "Network error: " + String(e) };
            _state.results = [_state.result];
        }
        _state.loading = false;
        try {
            _render();
        } catch (renderErr) {
            var el = document.getElementById('matchContent');
            if (el) el.innerHTML = _buildSearchBar()
                + '<div class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">'
                + "<b>Display error:</b> " + _esc(String(renderErr)) + '</div>';
        }
    }

    // ── Render ────────────────────────────────────────────────────────
    function _render() {
        var el = document.getElementById('matchContent');
        if (!el) return;
        var html = _buildSearchBar();
        if (_state.loading) {
            html += '<div class="flex items-center justify-center py-20 text-gray-400">'
                + '<i class="fas fa-circle-notch fa-spin text-xl mr-3"></i>A pesquisar\u2026</div>';
        } else if (_state.results && _state.results.length > 1) {
            html += _buildBatchResults(_state.results);
        } else if (_state.result) {
            html += _buildResult(_state.result);
        } else {
            html += _buildEmptyState();
        }
        el.innerHTML = html;

        // Re-focus input after render
        _focusInput();
    }

    function _buildBatchResults(results) {
        var unique = {};
        var html = '<div class="mt-4 space-y-4">';

        results.forEach(function (data, idx) {
            var plate = (data && data.vehicle && data.vehicle.plate) ? data.vehicle.plate : (data && data._plate_input ? data._plate_input : '—');
            var ded = data && data._deduped ? data._deduped : 0;
            var sugg = (data && data.suggestions) ? data.suggestions : [];
            sugg.forEach(function (s) { if (s && s.res_no) unique[s.res_no] = true; });

            html += '<div class="rounded-2xl border border-lynx-divider overflow-hidden">'
                + '<div class="px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-b border-lynx-divider flex items-center gap-3 flex-wrap">'
                + '<span class="text-xs font-semibold text-gray-500 dark:text-gray-400">#' + (idx + 1) + '</span>'
                + '<span class="font-mono font-bold text-sm text-gray-800 dark:text-gray-100">' + _esc(plate) + '</span>'
                + (ded > 0
                    ? '<span class="ml-auto text-[0.68rem] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">'
                        + ded + " reassigned suggestion(s)</span>"
                    : "<span class=\"ml-auto text-[0.68rem] text-gray-400\">no conflicts</span>")
                + '</div>'
                + '<div class="p-4">' + _buildResult(data) + '</div>'
                + '</div>';
        });

        html = '<div class="mt-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-xs text-blue-700 dark:text-blue-300">'
            + '<i class="fas fa-circle-info mr-1.5"></i>'
            + "Batch search: " + results.length + " license plates · " + Object.keys(unique).length + " unique suggested reservations"
            + '</div>' + html;

        html += '</div>';
        return html;
    }

    function _renderLoading(plate) {
        var el = document.getElementById('matchContent');
        if (!el) return;
        el.innerHTML = _buildSearchBar()
            + '<div class="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">'
            + '<i class="fas fa-circle-notch fa-spin text-2xl text-primary-400"></i>'
            + '<p class="text-sm">A pesquisar <span class="font-mono font-bold text-gray-600 dark:text-gray-300">' + _esc(plate) + '</span>\u2026</p>'
            + '</div>';
    }

    function _buildSearchBar() {
        var val = _state.lastInput || ((_state.result && !_state.result.error && _state.result.vehicle)
            ? _state.result.vehicle.plate : '');
        return '<div class="flex gap-2 items-start">'
            + '<div class="relative flex-1 max-w-md">'
            + '<i class="fas fa-car absolute left-3 top-3 text-gray-400 text-sm pointer-events-none"></i>'
            + "<textarea id=\"matchPlateInput\" rows=\"2\" aria-label=\"Vehicle license plates\" placeholder=\"License Plate(s) — ex: AA-00-AA, BB-11-BB\""
            + ' onkeydown="if(event.key===\'Enter\' && !event.shiftKey){event.preventDefault();matchSearch();}"'
            + ' oninput="this.value=this.value.toUpperCase()"'
            + ' class="w-full pl-9 pr-4 py-2.5 rounded-xl border border-lynx-divider bg-white dark:bg-gray-900 text-sm font-mono'
            + ' text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-400 placeholder-gray-400 transition-shadow resize-y min-h-[44px]">'
            + _esc(val) + '</textarea>'
            + "<p class=\"mt-1 text-[0.68rem] text-gray-400\">Separate with commas, spaces or line breaks. Enter to search; Shift+Enter for a new line.</p>"
            + '</div>'
            + "<button type=\"button\" aria-label=\"Find reservations for these license plates\" onclick=\"matchSearch()\" class=\"px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-colors flex items-center gap-2 flex-shrink-0\">"
            + "<i class=\"fas fa-magnifying-glass\"></i><span class=\"hidden sm:inline\">Search</span></button>"
            + '</div>';
    }

    function _buildEmptyState() {
        return '<div class="ui-empty-state text-center">'
            + '<svg class="ui-icon" aria-hidden="true"><use href="/shared/icons.svg#car"></use></svg>'
            + "<p class=\"text-base font-semibold\">Enter a license plate to start</p>"
            + '<p class="text-sm mt-2 max-w-sm mx-auto">'
            + "The system detects the ownership type (Owned Fleet / Buy Back), "
            + "the vehicle group and the best matching reservations.</p>"
            + '</div>';
    }

    function _buildResult(data) {
        if (data.error) {
            return '<div class="mt-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-4 flex items-start gap-3">'
                + '<i class="fas fa-triangle-exclamation text-red-500 mt-0.5 flex-shrink-0"></i>'
                + "<div><p class=\"text-sm font-semibold text-red-700 dark:text-red-400\">Error</p>"
                + '<p class="text-xs text-red-600 dark:text-red-400 mt-0.5">' + _esc(data.error) + '</p>'
                + '</div></div>';
        }

        return _buildVehicleCard(data.vehicle)
            + '<div class="h-4"></div>'
            + _buildSuggestions(data);
    }

    function _buildVehicleCard(v) {
        if (!v) return '';

        var tipoColor = v.tipo === 'BB'
            ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700'
            : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700';

        var statusDot = v.status === 'rented'    ? 'bg-orange-400'
            : v.status === 'available' ? 'bg-emerald-500'
            : 'bg-gray-400';

        var statusLabel = v.status === 'rented' ? "Rented" : v.status === 'available' ? "Available" : "Other";

        var html = '<div class="rounded-2xl border border-lynx-divider overflow-hidden">'
            + '<div class="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-lynx-divider flex-wrap">'
            + '<span class="w-2 h-2 rounded-full flex-shrink-0 ' + statusDot + '"></span>'
            + '<span class="font-mono font-bold text-base text-gray-800 dark:text-gray-100">' + _esc(v.plate) + '</span>'
            + (v.name ? '<span class="text-xs text-gray-500 dark:text-gray-400">' + _esc(v.name) + '</span>' : '')
            + '<span class="border rounded-full text-[0.65rem] font-bold px-2 py-0.5 ' + tipoColor + '">' + _esc(v.tipo_label) + '</span>'
            + '<span class="text-xs text-gray-400">' + statusLabel + '</span>'
            + '</div>'
            + '<div class="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-y divide-lynx-divider bg-white dark:bg-gray-950">';

        html += _kpi("Group", '<span class="font-mono font-bold text-lg text-primary-600 dark:text-primary-400">' + _esc(v.group || '\u2014') + '</span>');

        var poolLabel = v.eff_pool !== v.pool && v.eff_pool
            ? _esc(v.eff_station) + '<span class="text-[0.6rem] text-gray-400 ml-1">(' + _esc(v.eff_pool) + ')</span>'
            : _esc(v.eff_station);
        html += _kpi("Effective Station", '<span class="text-sm font-semibold text-gray-700 dark:text-gray-200">' + poolLabel + '</span>');

        html += _kpi("Available", '<span class="text-sm text-gray-600 dark:text-gray-300">' + _esc(v.avail_label) + '</span>');

        var rd = v.remaining_days;
        var rdHtml;
        if (rd === null || rd === undefined) {
            rdHtml = '<span class="text-sm text-gray-400">—</span>';
        } else if (rd <= 0) {
            rdHtml = '<span class="text-sm font-semibold text-red-500">' + rd + 'd</span>';
        } else if (rd <= 5) {
            rdHtml = '<span class="text-sm font-semibold text-orange-500">' + rd + 'd</span>';
        } else {
            rdHtml = '<span class="text-sm font-semibold text-emerald-500">' + rd + 'd</span>';
        }
        html += _kpi("Days in Fleet", rdHtml + (v.contract_end ? '<div class="text-[0.6rem] text-gray-400 mt-0.5">até ' + _esc(v.contract_end) + '</div>' : ''));

        html += '</div></div>';
        return html;
    }

    function _kpi(label, valueHtml) {
        return '<div class="px-4 py-3">'
            + '<p class="text-[0.58rem] font-semibold uppercase text-gray-400 mb-1">' + label + '</p>'
            + '<div>' + valueHtml + '</div>'
            + '</div>';
    }

    function _buildSuggestions(data) {
        var sugg    = data.suggestions || [];
        var blocked = data.already_blocked || [];
        var v       = data.vehicle || {};
        var isBB    = v.tipo === 'BB';

        var html = '<div class="rounded-2xl border border-lynx-divider overflow-hidden">'
            + '<div class="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-lynx-divider">'
            + '<i class="fas fa-' + (isBB ? 'route' : 'handshake') + ' text-primary-500 text-sm flex-shrink-0"></i>'
            + '<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-200 flex-1">'
            + (isBB ? "One-Way Reservations to Central Portugal / Lisbon" : "Best Reservation Matches")
            + '</h3>'
            + ((sugg.length > 0 || blocked.length > 0)
                ? '<span class="text-xs text-gray-400">'
                    + (sugg.length > 0 ? (sugg.length + ' suggestion' + (sugg.length === 1 ? '' : 's')) : '0 suggestions')
                    + (blocked.length > 0 ? (' · ' + blocked.length + " already assigned") : '')
                    + '</span>'
                : '')
            + '</div>';

        if (blocked.length) {
            html += _buildAlreadyBlocked(blocked);
        }

        if (!sugg.length) {
            html += '<div class="p-6 text-center text-gray-400">'
                + '<i class="fas fa-inbox text-2xl mb-3 opacity-25 block"></i>'
                + "<p class=\"text-sm font-semibold\">No suggestions available</p>"
                + (data.no_match_reason ? '<p class="text-xs mt-1 opacity-70 max-w-xs mx-auto">' + _esc(data.no_match_reason) + '</p>' : '')
                + '</div>';

            if (data.nearby_alternatives && data.nearby_alternatives.length) {
                html += _buildNearbyAlts(data.nearby_alternatives, isBB);
            }
        } else {
            html += '<div class="divide-y divide-lynx-divider">';
            sugg.forEach(function (s, i) { html += _buildSuggCard(s, i + 1, v); });
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function _buildAlreadyBlocked(blocked) {
        var html = '<div class="border-b border-lynx-divider bg-red-50 dark:bg-red-950/20">'
            + '<div class="px-4 py-2.5 text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">'
            + '<i class="fas fa-triangle-exclamation"></i>'
            + "Matching reservations that already have a vehicle assigned"
            + '</div>'
            + '<div class="divide-y divide-red-100 dark:divide-red-900/40">';

        blocked.forEach(function (b) {
            html += '<div class="px-4 py-2.5 flex items-center gap-2 text-xs flex-wrap">'
                + '<span class="font-mono font-bold text-red-800 dark:text-red-300">' + _esc(b.res_no) + '</span>'
                + '<span class="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700 font-mono">' + _esc(b.assigned_plate) + '</span>'
                + '<span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-lynx-divider font-mono">' + _esc(b.group || '—') + '</span>'
                + '<span class="text-gray-500 dark:text-gray-400">' + _esc(b.pick_station || '—') + '</span>'
                + '<span class="text-gray-400">' + _esc(window.renaFormatDate(b.pick_time, false, '')) + '</span>'
                + '<button onclick="matchCopyRes(\'' + _esc(b.res_no) + '\')" title="Copiar nº reserva"'
                + ' class="ml-auto flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg border border-red-200 dark:border-red-800 text-red-500 hover:text-red-600 transition-colors text-xs">'
                + '<i class="fas fa-copy"></i></button>'
                + '</div>';
        });

        html += '</div></div>';
        return html;
    }

    function _buildSuggCard(s, rank, vehicle) {
        var isExact  = s.match_type === "Exact";
        var isOw     = s.one_way;
        var isExt    = s.needs_extension;

        var matchBadge = isExact
            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-600'
            : s.match_type === "Preferred"
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-600'
                : s.match_type === "Acceptable"
                    ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-600'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600';

        var locIcon = s.loc_match === "Same Station" ? 'fa-building'
            : s.loc_match === "Same Pool" ? 'fa-circle-nodes'
            : 'fa-map-location-dot';

        var rankBg = rank === 1
            ? 'bg-primary-500 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400';

        var html = '<div class="flex items-start gap-3 p-4 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">'
            // Rank badge
            + '<div class="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ' + rankBg + '">' + rank + '</div>'
            + '<div class="flex-1 min-w-0 space-y-1.5">'
            // Row 1: res_no + badges
            + '<div class="flex items-center gap-2 flex-wrap">'
            + '<span class="font-mono font-bold text-sm text-gray-800 dark:text-gray-100">' + _esc(s.res_no) + '</span>'
            + '<span class="font-mono text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-lynx-divider">' + _esc(s.group) + '</span>'
            + '<span class="text-xs border rounded-full px-2 py-0.5 font-semibold ' + matchBadge + '">' + _esc(s.match_type) + '</span>'
            + (isOw ? '<span class="text-xs border rounded-full px-2 py-0.5 font-semibold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-700">One-Way</span>' : '')
            + (isExt ? '<span class="text-xs border rounded-full px-2 py-0.5 font-semibold bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700"><i class="fas fa-clock mr-0.5 text-[0.55rem]"></i>+' + s.extension_days + 'd ext.</span>' : '')
            + '</div>'
            // Row 2: stations + dates
            + '<div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-wrap">'
            + '<i class="fas ' + locIcon + ' text-[0.65rem] text-primary-400 flex-shrink-0"></i>'
            + '<span class="font-medium text-gray-700 dark:text-gray-200">' + _esc(s.pick_station) + '</span>'
            + '<span class="opacity-50">' + _esc(window.renaFormatDate(s.pick_time)) + '</span>'
            + (isOw ? '<i class="fas fa-arrow-right text-[0.6rem] text-orange-400 flex-shrink-0"></i>'
                    + '<span class="font-medium text-gray-700 dark:text-gray-200">' + _esc(s.ret_station) + '</span>' : '')
            + '<span class="opacity-50">' + (s.ret_time ? '\u2192 ' + _esc(window.renaFormatDate(s.ret_time)) : '') + '</span>'
            + '</div>'
            // Row 3: loc match + duration
            + '<div class="flex items-center gap-3 text-[0.65rem] text-gray-400">'
            + '<span><i class="fas fa-map-pin text-[0.6rem] mr-0.5"></i>' + _esc(s.loc_match) + '</span>'
            + (s.duration ? '<span><i class="fas fa-calendar-days text-[0.6rem] mr-0.5"></i>' + s.duration + ' dia' + (s.duration !== 1 ? 's' : '') + '</span>' : '')
            + '</div>'
            + '</div>'
            // Copy button
            + '<button onclick="matchCopyRes(\'' + _esc(s.res_no) + '\')" title="Copiar n\u00ba reserva"'
            + ' class="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-lynx-divider text-gray-400 hover:text-primary-500 hover:border-primary-400 transition-colors text-sm">'
            + '<i class="fas fa-copy"></i></button>'
            + '</div>';

        return html;
    }

    function _buildNearbyAlts(alts, isBB) {
        var html = '<div class="border-t border-lynx-divider px-4 py-3 bg-amber-50 dark:bg-amber-950/20">'
            + '<p class="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-1.5">'
            + '<i class="fas fa-location-crosshairs text-[0.65rem]"></i>'
            + (isBB ? "Nearby stations with one-way reservations to Central Portugal:"
                    : "Stations in the same zone with available reservations:")
            + '</p>'
            + '<div class="flex flex-wrap gap-2">';
        alts.forEach(function (a) {
            html += '<div class="flex items-center gap-1.5 text-xs bg-white dark:bg-gray-800 border border-lynx-divider rounded-full px-2.5 py-1">'
                + '<i class="fas fa-building text-[0.55rem] text-gray-400"></i>'
                + '<span class="font-medium text-gray-700 dark:text-gray-200">' + _esc(a.station) + '</span>'
                + '<span class="text-gray-400">' + a.res_count + ' res.</span>'
                + '</div>';
        });
        html += '</div></div>';
        return html;
    }

    function _buildHistory() {
        var html = '<div class="rounded-2xl border border-lynx-divider overflow-hidden">'
            + '<div class="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-lynx-divider">'
            + '<i class="fas fa-clock-rotate-left text-gray-400 text-sm flex-shrink-0"></i>'
            + "<h3 class=\"text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide\">Searches in this session</h3>"
            + '</div>'
            + '<div class="flex flex-wrap gap-2 p-3">';

        _state.history.forEach(function (h) {
            var tipoBg = h.tipo === 'BB'
                ? 'border-purple-200 dark:border-purple-800'
                : 'border-emerald-200 dark:border-emerald-800';
            html += '<button onclick="matchGoToPlate(\'' + _esc(h.plate) + '\')"'
                + ' class="flex items-center gap-1.5 text-xs bg-white dark:bg-gray-900 border rounded-full px-2.5 py-1 hover:border-primary-400 hover:text-primary-600 transition-colors ' + tipoBg + '">'
                + '<span class="font-mono font-semibold">' + _esc(h.plate) + '</span>'
                + (h.group ? '<span class="text-gray-400 font-mono">' + _esc(h.group) + '</span>' : '')
                + '<span class="text-gray-300 dark:text-gray-600">' + h.ts + '</span>'
                + (h.count > 0 ? '<span class="bg-emerald-400 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center text-[0.5rem] font-bold">' + h.count + '</span>'
                               : '<span class="bg-gray-300 dark:bg-gray-600 rounded-full w-2 h-2"></span>')
                + '</button>';
        });

        html += '</div></div>';
        return html;
    }

    window.matchGoToPlate = function (plate) {
        var input = document.getElementById('matchPlateInput');
        if (input) { input.value = plate; }
        _doSearch([plate]);
    };

    // ── Utils ─────────────────────────────────────────────────────────
    function _focusInput() {
        var input = document.getElementById('matchPlateInput');
        if (input && !input.value) {
            try { input.focus(); } catch (_) {}
        }
    }

    function _shakeInput() {
        var input = document.getElementById('matchPlateInput');
        if (!input) return;
        input.classList.add('ring-2', 'ring-red-400');
        setTimeout(function () { input.classList.remove('ring-2', 'ring-red-400'); }, 800);
    }

    function _toast(msg) {
        var el = document.createElement('div');
        el.className = 'fixed top-4 right-4 z-[70] bg-gray-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2';
        el.innerHTML = '<i class="fas fa-check-circle text-emerald-400"></i>' + _esc(msg);
        document.body.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2500);
    }

})();
