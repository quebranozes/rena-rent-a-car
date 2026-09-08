(function () {
    'use strict';

    var IB = {
        data: null,
        zones: [],
        regions: [],
    };

    function _esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function _fmtNum(n) { return n != null ? n.toLocaleString('en-GB') : ''; }

    window.islandBlockingInit = function () {
        var content = document.getElementById('ibContent');
        if (!content) return;
        if (IB.data) { _render(); return; }
        // Load with defaults to populate zone list
        _search();
    };

    function _search() {
        var zone = document.getElementById('ibZone');
        var groups = document.getElementById('ibGroups');
        var tipo = document.getElementById('ibTipo');
        var minDays = document.getElementById('ibMinDays');

        var params = new URLSearchParams();
        if (zone && zone.value) params.set('zone', zone.value);
        if (groups && groups.value.trim()) params.set('groups', groups.value.trim());
        if (tipo && tipo.value) params.set('tipo', tipo.value);
        if (minDays && minDays.value) params.set('min_days', minDays.value);

        var content = document.getElementById('ibContent');
        if (content) content.innerHTML = '<div class="text-center text-gray-400 py-16"><i class="fas fa-spinner fa-spin text-2xl"></i><p class="mt-3">A pesquisar...</p></div>';

        fetch('/api/island-blocking?' + params.toString())
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) { content.innerHTML = '<div class="text-center text-red-400 py-8">' + _esc(d.error || "Error") + '</div>'; return; }
                IB.data = d;
                IB.zones = d.available_zones || [];
                IB.regions = d.available_regions || [];
                _render();
            })
            .catch(function (e) { content.innerHTML = "<div class=\"text-center text-red-400 py-8\">Error: " + _esc(e.message) + '</div>'; });
    }
    window.ibSearch = _search;

    function _render() {
        var d = IB.data;
        if (!d) return;
        var content = document.getElementById('ibContent');
        if (!content) return;

        var html = '';

        // ── Filters ──
        html += '<div class="lynx-card mb-4">';
        html += '<div class="flex flex-wrap items-end gap-3">';

        // Zone
        html += '<div class="flex flex-col gap-1">';
        html += "<label class=\"text-[0.6rem] font-bold text-gray-400 uppercase\">Zone / Region</label>";
        html += '<select id="ibZone" class="text-xs px-2 py-1.5 rounded-lg bg-lynx-subtle dark:bg-[#1A1A1A] border border-lynx-divider dark:border-gray-700 text-gray-700 dark:text-gray-300">';
        html += "<option value=\"\">All</option>";
        var curZone = (d.filters && d.filters.zone) || '';
        if (IB.regions.length) {
            html += "<optgroup label=\"Regions\">";
            IB.regions.forEach(function (r) {
                html += '<option value="' + _esc(r) + '"' + (curZone === r ? ' selected' : '') + '>' + _esc(r) + '</option>';
            });
            html += '</optgroup>';
        }
        if (IB.zones.length) {
            html += "<optgroup label=\"Zones\">";
            IB.zones.forEach(function (z) {
                html += '<option value="' + _esc(z) + '"' + (curZone === z ? ' selected' : '') + '>' + _esc(z) + '</option>';
            });
            html += '</optgroup>';
        }
        html += '</select></div>';

        // Groups
        var curGroups = (d.filters && d.filters.groups) ? d.filters.groups.join(', ') : '';
        html += '<div class="flex flex-col gap-1">';
        html += "<label class=\"text-[0.6rem] font-bold text-gray-400 uppercase\">Groups ACRISS</label>";
        html += '<input id="ibGroups" type="text" value="' + _esc(curGroups) + '" placeholder="CDMR, EDMR, ..." class="text-xs px-2 py-1.5 rounded-lg bg-lynx-subtle dark:bg-[#1A1A1A] border border-lynx-divider dark:border-gray-700 text-gray-700 dark:text-gray-300 w-40">';
        html += '</div>';

        // Tipo
        var curTipo = (d.filters && d.filters.tipo) || '';
        html += '<div class="flex flex-col gap-1">';
        html += "<label class=\"text-[0.6rem] font-bold text-gray-400 uppercase\">Type</label>";
        html += '<select id="ibTipo" class="text-xs px-2 py-1.5 rounded-lg bg-lynx-subtle dark:bg-[#1A1A1A] border border-lynx-divider dark:border-gray-700 text-gray-700 dark:text-gray-300">';
        html += "<option value=\"\">All</option>";
        html += '<option value="FP"' + (curTipo === 'FP' ? ' selected' : '') + ">Owned Fleet (FP)</option>";
        html += '<option value="BB"' + (curTipo === 'BB' ? ' selected' : '') + '>Buy Back (BB)</option>';
        html += '</select></div>';

        // Min days
        var curMinDays = (d.filters && d.filters.min_days) || 200;
        html += '<div class="flex flex-col gap-1">';
        html += "<label class=\"text-[0.6rem] font-bold text-gray-400 uppercase\">Minimum days</label>";
        html += '<input id="ibMinDays" type="number" value="' + curMinDays + '" min="0" max="999" class="text-xs px-2 py-1.5 rounded-lg bg-lynx-subtle dark:bg-[#1A1A1A] border border-lynx-divider dark:border-gray-700 text-gray-700 dark:text-gray-300 w-20">';
        html += '</div>';

        // Search button
        html += '<button onclick="ibSearch()" class="text-xs px-4 py-1.5 rounded-lg bg-primary-500 text-white font-semibold hover:bg-primary-600 transition-colors">';
        html += "<i class=\"fas fa-search mr-1\"></i> Search</button>";

        html += '</div></div>';

        // ── Summary ──
        var vehs = d.vehicles || [];
        html += '<div class="flex flex-wrap gap-3 mb-4">';
        html += _card("Results", vehs.length, 'primary', 'fa-car');
        // Group summary
        var grpCount = {};
        var tipoCount = { FP: 0, BB: 0, '?': 0 };
        var poolCount = {};
        var availCount = 0, rentedCount = 0;
        vehs.forEach(function (v) {
            grpCount[v.group] = (grpCount[v.group] || 0) + 1;
            tipoCount[v.tipo] = (tipoCount[v.tipo] || 0) + 1;
            poolCount[v.pool || v.region || '?'] = (poolCount[v.pool || v.region || '?'] || 0) + 1;
            if (v.is_available) availCount++; else rentedCount++;
        });
        if (tipoCount.FP) html += _card("Owned Fleet", tipoCount.FP, 'emerald', 'fa-tag');
        if (tipoCount.BB) html += _card('Buy Back', tipoCount.BB, 'amber', 'fa-tag');
        if (availCount) html += _card("Available", availCount, 'blue', 'fa-check-circle');
        if (rentedCount) html += _card("Em Contract", rentedCount, 'red', 'fa-clock');
        html += '</div>';

        if (!vehs.length) {
            html += "<div class=\"text-center text-gray-400 py-12\"><i class=\"fas fa-search text-3xl mb-3 opacity-30\"></i><p>No vehicles match the selected filters.</p></div>";
            content.innerHTML = html;
            return;
        }

        // ── Group breakdown ──
        var grpEntries = Object.entries(grpCount).sort(function (a, b) { return b[1] - a[1]; });
        html += '<div class="flex flex-wrap gap-1.5 mb-4">';
        grpEntries.forEach(function (e) {
            html += '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-lynx-subtle dark:bg-gray-800/60 border border-lynx-divider dark:border-gray-700 text-[0.65rem]">';
            html += '<span class="font-mono font-semibold text-primary-500">' + _esc(e[0]) + '</span>';
            html += '<span class="font-bold text-gray-700 dark:text-gray-200">' + e[1] + '</span>';
            html += '</span>';
        });
        html += '</div>';

        // ── Vehicle table ──
        html += '<div class="lynx-card overflow-auto" style="max-height:65vh">';
        html += '<table class="w-full text-xs border-collapse" id="ibTable">';
        html += '<thead class="sticky top-0 z-10 bg-lynx-subtle dark:bg-[#0A0A0A]">';
        html += '<tr class="text-left text-[0.55rem] text-gray-400 uppercase tracking-wider">';
        html += '<th class="py-2 pl-3 pr-2"><input type="checkbox" id="ibCheckAll" onchange="ibToggleAll(this)"></th>';
        html += "<th class=\"py-2 pr-2\">License Plate</th>";
        html += "<th class=\"py-2 pr-2\">Group</th>";
        html += "<th class=\"py-2 pr-2\">Type</th>";
        html += "<th class=\"py-2 pr-2\">Vehicle</th>";
        html += "<th class=\"py-2 pr-2\">Status</th>";
        html += "<th class=\"py-2 pr-2\">Station / Return</th>";
        html += "<th class=\"py-2 pr-2\">Zone</th>";
        html += "<th class=\"py-2 pr-2 text-center\">Days</th>";
        html += "<th class=\"py-2 pr-2 text-center\">Contract End</th>";
        html += '<th class="py-2 pr-2 text-right">KM Rest.</th>';
        html += '<th class="py-2 pr-2">Engine</th>';
        html += '</tr></thead>';
        html += '<tbody class="lynx-text-primary">';

        var prevAvail = null;
        vehs.forEach(function (v, i) {
            // Separator between available and rented sections
            if (prevAvail !== null && prevAvail && !v.is_available) {
                html += "<tr class=\"bg-gray-200 dark:bg-gray-700\"><td colspan=\"12\" class=\"py-1.5 pl-3 text-[0.6rem] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider\"><i class=\"fas fa-clock mr-1\"></i> On Rent — Ordered by Return Date</td></tr>";
            }
            prevAvail = v.is_available;

            var bg = i % 2 === 0 ? '' : 'bg-gray-50/30 dark:bg-gray-800/10';
            var daysCls = v.remaining_days >= 300 ? 'text-emerald-400 font-bold' : v.remaining_days >= 200 ? 'text-blue-400 font-semibold' : 'text-gray-400';
            var tipoCls = v.tipo === 'FP' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' :
                          v.tipo === 'BB' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' :
                          'bg-lynx-subtle dark:bg-gray-800 text-gray-500 border-lynx-divider dark:border-gray-700';
            var kmCls = v.remaining_km != null && v.remaining_km < 3000 ? 'text-orange-400' : '';

            // Status and location
            var statusHtml, locationHtml;
            if (v.is_available) {
                statusHtml = "<span class=\"text-[0.5rem] px-1.5 py-0.5 rounded-full border font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800\">Available</span>";
                locationHtml = _esc(v.station);
            } else {
                statusHtml = '<span class="text-[0.5rem] px-1.5 py-0.5 rounded-full border font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800">' + (v.return_time || 'Rented') + '</span>';
                locationHtml = v.return_station ? ('<i class="fas fa-arrow-right text-[0.5rem] text-gray-400 mr-1"></i>' + _esc(v.return_station)) : _esc(v.station);
            }

            html += '<tr class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-lynx-subtle dark:hover:bg-gray-800/30 ' + bg + '">';
            html += '<td class="py-1.5 pl-3 pr-2"><input type="checkbox" class="ibCheck" data-plate="' + _esc(v.plate) + '"></td>';
            html += '<td class="py-1.5 pr-2 font-mono font-bold text-[0.7rem]">' + _esc(v.plate) + '</td>';
            html += '<td class="py-1.5 pr-2"><span class="font-mono font-semibold text-primary-500">' + _esc(v.group) + '</span></td>';
            html += '<td class="py-1.5 pr-2"><span class="text-[0.5rem] px-1.5 py-0.5 rounded-full border font-semibold ' + tipoCls + '">' + _esc(v.tipo) + '</span></td>';
            html += '<td class="py-1.5 pr-2 whitespace-nowrap text-gray-400">' + _esc(v.name) + '</td>';
            html += '<td class="py-1.5 pr-2">' + statusHtml + '</td>';
            html += '<td class="py-1.5 pr-2 whitespace-nowrap">' + locationHtml + '</td>';
            html += '<td class="py-1.5 pr-2 text-[0.6rem] text-gray-400">' + _esc(v.pool) + '</td>';
            html += '<td class="py-1.5 pr-2 text-center ' + daysCls + '">' + v.remaining_days + '</td>';
            html += '<td class="py-1.5 pr-2 text-center text-gray-400">' + _esc(v.contract_end) + '</td>';
            html += '<td class="py-1.5 pr-2 text-right ' + kmCls + '">' + _fmtNum(v.remaining_km) + '</td>';
            html += '<td class="py-1.5 pr-2 text-gray-400">' + _esc(v.engine || '') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';

        // ── Export button ──
        html += '<div class="flex items-center gap-3 mt-3">';
        html += '<button onclick="ibCopySelected()" class="text-xs px-3 py-1.5 rounded-lg bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-colors">';
        html += '<i class="fas fa-copy mr-1"></i> Copiar Selecionadas</button>';
        html += '<button onclick="ibExportCsv()" class="text-xs px-3 py-1.5 rounded-lg bg-gray-600 text-white font-semibold hover:bg-gray-700 transition-colors">';
        html += "<i class=\"fas fa-file-csv mr-1\"></i> Export CSV</button>";
        html += "<span id=\"ibCopyMsg\" class=\"text-xs text-emerald-400 hidden\"><i class=\"fas fa-check\"></i> Copied!</span>";
        html += '</div>';

        content.innerHTML = html;
    }

    function _card(label, value, color, icon) {
        var colors = {
            primary: 'text-primary-500',
            emerald: 'text-emerald-400',
            amber: 'text-amber-400',
            blue: 'text-blue-400',
            red: 'text-red-400',
        };
        var c = colors[color] || colors.primary;
        var h = '<div class="lynx-card px-4 py-3 min-w-[120px]">';
        h += '<div class="flex items-center gap-2">';
        h += '<i class="fas ' + icon + ' ' + c + '"></i>';
        h += '<span class="text-[0.6rem] font-bold text-gray-400 uppercase">' + _esc(label) + '</span>';
        h += '</div>';
        h += '<div class="text-xl font-bold ' + c + ' mt-1">' + value + '</div>';
        h += '</div>';
        return h;
    }

    window.ibToggleAll = function (el) {
        var checks = document.querySelectorAll('.ibCheck');
        checks.forEach(function (c) { c.checked = el.checked; });
    };

    window.ibCopySelected = function () {
        var checks = document.querySelectorAll('.ibCheck:checked');
        if (!checks.length) { alert("Select at least one vehicle."); return; }
        var plates = [];
        checks.forEach(function (c) { plates.push(c.getAttribute('data-plate')); });

        // Build text with full info
        var vehs = (IB.data && IB.data.vehicles) || [];
        var lines = ["License Plate\tGroup\tType\tStatus\tStation/Return\tDays\tContract End"];
        plates.forEach(function (p) {
            var v = vehs.find(function (x) { return x.plate === p; });
            if (v) {
                var estado = v.is_available ? "Available" : (v.return_time || 'Rented');
                var local = v.is_available ? v.station : (v.return_station || v.station);
                lines.push(v.plate + '\t' + v.group + '\t' + v.tipo + '\t' + estado + '\t' + local + '\t' + v.remaining_days + '\t' + v.contract_end);
            }
        });

        navigator.clipboard.writeText(lines.join('\n')).then(function () {
            var msg = document.getElementById('ibCopyMsg');
            if (msg) { msg.classList.remove('hidden'); setTimeout(function () { msg.classList.add('hidden'); }, 2000); }
        });
    };

    window.ibExportCsv = function () {
        var vehs = (IB.data && IB.data.vehicles) || [];
        if (!vehs.length) return;

        var lines = ["License Plate;Group;Type;Vehicle;Status;Return;Station/Return;Zone;Days;Contract End;Remaining km;Engine"];
        vehs.forEach(function (v) {
            var estado = v.is_available ? "Available" : 'Rented';
            var retoma = v.is_available ? '' : (v.return_time || '');
            var local = v.is_available ? v.station : (v.return_station || v.station);
            lines.push([v.plate, v.group, v.tipo, v.name, estado, retoma, local, v.pool, v.remaining_days, v.contract_end, v.remaining_km || '', v.engine || ''].join(';'));
        });

        var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        var today = new Date();
        var ds = today.getDate().toString().padStart(2, '0') + '-' + (today.getMonth() + 1).toString().padStart(2, '0') + '-' + today.getFullYear();
        a.download = 'ilhas_bloqueio_' + ds + '.csv';
        a.click();
    };

})();
