/* ========== R.E.N.A. -- Analytics Module ========== */

// -- Chart instances --
var _nafChartPool = null;
var _nafChartSubStatus = null;
var _nafChartFuelType = null;
var _nafChartCategory = null;
var _nafChartOficinaLocal = null;
var _nafChartLongterm = null;

var _NAF_CHART_COLORS = ['#f97316','#3b82f6','#22c55e','#a855f7','#ef4444','#eab308','#06b6d4','#ec4899','#10b981','#f43f5e','#8b5cf6','#14b8a6'];

function _nafVehicleHasAlarm(v) {
    var mdCache = (typeof window.nafGetMasterDataCache === 'function') ? window.nafGetMasterDataCache() : {};
    var plate = (v.licensePlate || '').trim();
    return !!(mdCache[plate] && mdCache[plate].alarme);
}

// -- Legend helper --
function _nafRenderLegend(containerId, labels, values, colors, total) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var html = '';
    for (var i = 0; i < labels.length; i++) {
        var n = values[i];
        var pct = total > 0 ? ((n / total) * 100).toFixed(1) : '0';
        var c = colors[i % colors.length];
        html += '<div class="flex items-center justify-between text-xs py-0.5 px-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50">'
            + '<span class="flex items-center gap-1.5"><span style="width:8px;height:8px;border-radius:2px;background:' + c + ';display:inline-block"></span><span class="text-gray-600 dark:text-gray-300 truncate">' + labels[i] + '</span></span>'
            + '<span class="font-semibold lynx-text-primary ml-2 whitespace-nowrap">' + n.toLocaleString('en-GB') + ' <span class="text-gray-400 font-normal">(' + pct + '%)</span></span>'
            + '</div>';
    }
    el.innerHTML = html;
}

// -- ANALYTICS RENDERING (main entry point) --
window.nafRenderAnalytics = function () {
    var data = NAF.rawData;
    var noData = document.getElementById('analyticsNoData');
    var row1 = document.getElementById('analyticsRow1');
    var row2 = document.getElementById('analyticsRow2');
    var row3 = document.getElementById('analyticsRow3');
    var opsCards = document.getElementById('analyticsOpsCards');
    var opsCards2 = document.getElementById('analyticsOpsCards2');
    var opsCards3 = document.getElementById('analyticsOpsCards3');
    var blockedSection = document.getElementById('analyticsBlockedSection');

    if (!data || !data.length) {
        if (noData) noData.style.display = '';
        if (row1) row1.style.display = 'none';
        if (row2) row2.style.display = 'none';
        if (row3) row3.style.display = 'none';
        if (opsCards) opsCards.style.display = 'none';
        if (opsCards2) opsCards2.style.display = 'none';
        if (opsCards3) opsCards3.style.display = 'none';
        if (blockedSection) blockedSection.style.display = 'none';
        return;
    }

    if (noData) noData.style.display = 'none';
    if (row1) row1.style.display = '';
    if (row2) row2.style.display = '';
    if (row3) row3.style.display = '';
    if (opsCards) opsCards.style.display = '';
    if (opsCards2) opsCards2.style.display = '';
    if (opsCards3) opsCards3.style.display = '';

    var cap = document.getElementById('analyticsCapturedLabel');
    if (cap && NAF.capturedAt) cap.textContent = "Date as of: " + new Date(NAF.capturedAt).toLocaleString('en-GB');

    _nafComputeAnalyticsKpis(data);
    _nafUpdateOficinaLocalChart(data);
    _nafUpdatePoolChart(data);
    _nafUpdateSubStatusChart(data);
    _nafUpdateFuelTypeChart(data);
    _nafUpdateCategoryChart(data);
    _nafUpdateLongtermChart(data);
    if (typeof window._nafUpdateBlockedSection === 'function') window._nafUpdateBlockedSection(data);
};

// -- KPIs --
function _nafComputeAnalyticsKpis(data) {
    var oficina = 0, toDefleet = 0, infleeted = 0, longterm = 0;
    var stuck7 = 0, stuck15 = 0, stuck30 = 0;
    var defleetUrgentDays = 0, defleetUrgentKm = 0;
    var nearReturnDays = 0, nearReturnKm = 0;

    for (var i = 0; i < data.length; i++) {
        var v = data[i];
        var cs = v.classicStatus;
        var ss = (v.subStatus || '').toUpperCase();
        var hCode = (v.holdCodeForDueDate || '').toUpperCase();
        var hDesc = (v.holdDescriptionForDueDate || '').toUpperCase();

        if (cs === 5 || cs === 6) oficina++;
        if (ss.indexOf('DEFLEET') !== -1) toDefleet++;
        if (hCode.indexOf('INFLEET') !== -1 || hDesc.indexOf('INFLEET') !== -1 || ss.indexOf('INFLEET') !== -1) infleeted++;
        if (v.rentalActivity && v.rentalActivity.isLongterm && !_nafIsOficinaStation(v)) longterm++;

        if (cs !== 0) {
            var d = nafDaysAgo(v.inStatusSince);
            if (d !== null) {
                if (d >= 7) stuck7++;
                if (d >= 15) stuck15++;
                if (d >= 30) stuck30++;
            }
        }

        if (ss.indexOf('DEFLEET') !== -1) {
            var dDays = _nafDaysToDefleet(v);
            if (dDays !== null && dDays <= 10) defleetUrgentDays++;
            var dKm = _nafRemainingKm(v);
            if (dKm !== null && dKm <= 500) defleetUrgentKm++;
        } else {
            var rDays = _nafDaysToDefleet(v);
            if (rDays !== null && rDays > 0 && rDays <= 30 && !_nafVehicleHasAlarm(v)) nearReturnDays++;
            var rKm = _nafRemainingKm(v);
            if (rKm !== null && rKm <= 2000 && !_nafVehicleHasAlarm(v)) nearReturnKm++;
        }
    }

    nafSetKpi('statOficinaTotal', oficina.toLocaleString('en-GB'));
    nafSetKpi('statDefleet', toDefleet.toLocaleString('en-GB'));
    nafSetKpi('statInfleet', infleeted.toLocaleString('en-GB'));
    nafSetKpi('statLongterm', longterm.toLocaleString('en-GB'));
    nafSetKpi('statStuck7', stuck7.toLocaleString('en-GB'));
    nafSetKpi('statStuck15', stuck15.toLocaleString('en-GB'));
    nafSetKpi('statStuck30', stuck30.toLocaleString('en-GB'));
    nafSetKpi('statDefleetUrgentDays', defleetUrgentDays.toLocaleString('en-GB'));
    nafSetKpi('statDefleetUrgentKm', defleetUrgentKm.toLocaleString('en-GB'));
    nafSetKpi('statNearReturnDays', nearReturnDays.toLocaleString('en-GB'));
    nafSetKpi('statNearReturnKm', nearReturnKm.toLocaleString('en-GB'));
}

// -- Oficina por Local --
function _nafUpdateOficinaLocalChart(data) {
    var canvas = document.getElementById('nafChartOficinaLocal');
    if (!canvas || !window.Chart) return;

    var nafOnly = [];
    for (var i = 0; i < data.length; i++) {
        if (data[i].classicStatus === 5 || data[i].classicStatus === 6) nafOnly.push(data[i]);
    }
    var branchCounts = {};
    for (var j = 0; j < nafOnly.length; j++) {
        var v = nafOnly[j];
        var name = _nafGetBranchName(v);
        name = name.replace(/^PT\s*\d+\s*[-\u2013]\s*/i, '').trim();
        var zone = _nafGetVehicleZone(v);
        if (!branchCounts[name]) branchCounts[name] = { total: 0, s5: 0, s6: 0, zone: zone || '' };
        branchCounts[name].total++;
        if (v.classicStatus === 5) branchCounts[name].s5++;
        else branchCounts[name].s6++;
    }
    var sorted = Object.entries(branchCounts).sort(function(a, b) { return b[1].total - a[1].total; });
    var labels = sorted.map(function(s) { return s[0]; });
    var valuesS5 = sorted.map(function(s) { return s[1].s5; });
    var valuesS6 = sorted.map(function(s) { return s[1].s6; });

    var zoneColors = { Norte: '#1e3a8a', Centro: '#dc2626', Sul: '#16a34a', Ilhas: '#2563eb' };

    if (_nafChartOficinaLocal) { _nafChartOficinaLocal.destroy(); _nafChartOficinaLocal = null; }

    var chartHeight = Math.max(200, sorted.length * 32 + 60);
    canvas.parentElement.style.height = chartHeight + 'px';

    _nafChartOficinaLocal = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: "Quick Repair (05)", data: valuesS5, backgroundColor: '#f97316', borderRadius: 4 },
                { label: 'Rep. Longa (06)', data: valuesS6, backgroundColor: '#ef4444', borderRadius: 4 }
            ]
        },
        options: {
            indexAxis: 'y',
            plugins: {
                legend: { display: true, labels: { color: '#94a3b8', font: { size: 10 } } },
                tooltip: {
                    callbacks: {
                        title: function(items) {
                            var idx = items[0].dataIndex;
                            var entry = sorted[idx];
                            return entry[0] + (entry[1].zone ? ' (' + entry[1].zone + ')' : '');
                        },
                        afterLabel: function(ctx) {
                            var entry = sorted[ctx.dataIndex];
                            return 'Total: ' + entry[1].total;
                        }
                    }
                }
            },
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: {
                    stacked: true,
                    ticks: { color: '#94a3b8', font: { size: 10 }, autoSkip: false,
                        callback: function(val) { var label = this.getLabelForValue(val); return label.length > 24 ? label.substring(0, 22) + '\u2026' : label; }
                    },
                    grid: { display: false }
                },
                x: { beginAtZero: true, stacked: true, ticks: { precision: 0, color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(148,163,184,.15)' } }
            }
        }
    });

    var legendEl = document.getElementById('nafOficinaLocalLegend');
    if (legendEl) {
        var html = '';
        for (var k = 0; k < sorted.length; k++) {
            var sname = sorted[k][0];
            var info = sorted[k][1];
            var pct = nafOnly.length > 0 ? ((info.total / nafOnly.length) * 100).toFixed(1) : '0';
            var zc = zoneColors[info.zone] || '#94a3b8';
            html += '<div class="flex items-center justify-between text-xs py-0.5 px-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50">'
                + '<span class="flex items-center gap-1.5 truncate">'
                + '<span style="width:6px;height:6px;border-radius:50%;background:' + zc + ';display:inline-block;flex-shrink:0" title="' + (info.zone || 'N/A') + '"></span>'
                + '<span class="text-gray-600 dark:text-gray-300 truncate">' + sname + '</span></span>'
                + '<span class="font-semibold lynx-text-primary ml-2 whitespace-nowrap">' + info.total + ' <span class="text-gray-400 font-normal">(R' + info.s5 + '|L' + info.s6 + ')</span> <span class="text-gray-400 font-normal">' + pct + '%</span></span></div>';
        }
        legendEl.innerHTML = html;
    }
}

// -- Pool / Zone Chart --
function _nafUpdatePoolChart(data) {
    var canvas = document.getElementById('nafChartPool');
    if (!canvas || !window.Chart) return;

    var zoneCounts = {};
    for (var i = 0; i < data.length; i++) {
        var zone = _nafGetVehicleZone(data[i]) || "No Zone";
        zoneCounts[zone] = (zoneCounts[zone] || 0) + 1;
    }
    var zoneOrder = ["North", "Central", "South", "Islands", "No Zone"];
    var sorted = [];
    for (var z = 0; z < zoneOrder.length; z++) {
        if (zoneCounts[zoneOrder[z]]) sorted.push([zoneOrder[z], zoneCounts[zoneOrder[z]]]);
    }
    var keys = Object.keys(zoneCounts);
    for (var k = 0; k < keys.length; k++) {
        if (zoneOrder.indexOf(keys[k]) === -1) sorted.push([keys[k], zoneCounts[keys[k]]]);
    }
    var labels = sorted.map(function(s) { return s[0]; });
    var values = sorted.map(function(s) { return s[1]; });
    var zColors = { "North": '#1e3a8a', "Central": '#dc2626', "South": '#16a34a', "Islands": '#2563eb', "No Zone": '#6b7280' };
    var colors = labels.map(function(l) { return zColors[l] || _NAF_CHART_COLORS[labels.indexOf(l) % _NAF_CHART_COLORS.length]; });

    if (_nafChartPool) { _nafChartPool.destroy(); _nafChartPool = null; }
    _nafChartPool = new Chart(canvas, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: "Vehicles", data: values, backgroundColor: colors, borderRadius: 4 }] },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: function(ctx) { var pct = data.length > 0 ? ((ctx.raw / data.length) * 100).toFixed(1) : 0; return ' ' + ctx.raw.toLocaleString('en-GB') + ' (' + pct + '%)'; } } }
            },
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0, color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.15)' } },
                x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } }
            }
        }
    });
    _nafRenderLegend('nafPoolLegend', labels, values, colors, data.length);
}

// -- SubStatus Doughnut --
function _nafUpdateSubStatusChart(data) {
    var canvas = document.getElementById('nafChartSubStatus');
    if (!canvas || !window.Chart) return;

    var nafOnly = [];
    for (var i = 0; i < data.length; i++) {
        if (data[i].classicStatus === 5 || data[i].classicStatus === 6) nafOnly.push(data[i]);
    }
    var counts = {};
    for (var j = 0; j < nafOnly.length; j++) {
        var ss = nafFormatSubStatus(nafOnly[j].subStatus) || "Other";
        counts[ss] = (counts[ss] || 0) + 1;
    }
    var labels = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
    var values = labels.map(function(k) { return counts[k]; });
    var colors = labels.map(function(_, i) { return _NAF_CHART_COLORS[i % _NAF_CHART_COLORS.length]; });

    if (_nafChartSubStatus) { _nafChartSubStatus.destroy(); _nafChartSubStatus = null; }
    _nafChartSubStatus = new Chart(canvas, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { display: false } } }
    });
    _nafRenderLegend('nafSubStatusLegend', labels, values, colors, nafOnly.length);
}

// -- Fuel Type Doughnut --
function _nafUpdateFuelTypeChart(data) {
    var canvas = document.getElementById('nafChartFuelType');
    if (!canvas || !window.Chart) return;

    var counts = {};
    for (var i = 0; i < data.length; i++) {
        var label = nafFuelLabel(data[i].fuelType);
        counts[label] = (counts[label] || 0) + 1;
    }
    var labels = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
    var values = labels.map(function(k) { return counts[k]; });
    var fuelColors = { 'Diesel': '#3b82f6', "Petrol": '#f97316', "Electric": '#22c55e', "Hybrid": '#a855f7', 'GPL': '#eab308' };
    var colors = labels.map(function(l, i) { return fuelColors[l] || _NAF_CHART_COLORS[i % _NAF_CHART_COLORS.length]; });

    if (_nafChartFuelType) { _nafChartFuelType.destroy(); _nafChartFuelType = null; }
    _nafChartFuelType = new Chart(canvas, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { display: false } } }
    });
    _nafRenderLegend('nafFuelLegend', labels, values, colors, data.length);
}

// -- Vehicle Category Bar (ACRISS) --
function _nafUpdateCategoryChart(data) {
    var canvas = document.getElementById('nafChartCategory');
    if (!canvas || !window.Chart) return;

    var catData = {};
    for (var i = 0; i < data.length; i++) {
        var v = data[i];
        var cat = v.vehicleCategory || "Other";
        var acriss = (v.acrissCode || '?').substring(0, 4).toUpperCase();
        if (!catData[cat]) catData[cat] = { total: 0, acriss: {} };
        catData[cat].total++;
        catData[cat].acriss[acriss] = (catData[cat].acriss[acriss] || 0) + 1;
    }
    var sortedCats = Object.entries(catData).sort(function(a, b) { return b[1].total - a[1].total; });
    var labels = sortedCats.map(function(s) { return s[0]; });
    var allAcriss = {};
    for (var j = 0; j < sortedCats.length; j++) {
        var ak = Object.keys(sortedCats[j][1].acriss);
        for (var m = 0; m < ak.length; m++) allAcriss[ak[m]] = true;
    }
    var acrissArr = Object.keys(allAcriss).sort();
    var datasets = [];
    for (var a = 0; a < acrissArr.length; a++) {
        var ac = acrissArr[a];
        var dd = [];
        for (var s = 0; s < sortedCats.length; s++) dd.push(sortedCats[s][1].acriss[ac] || 0);
        datasets.push({ label: ac, data: dd, backgroundColor: _NAF_CHART_COLORS[a % _NAF_CHART_COLORS.length], borderRadius: 2 });
    }

    if (_nafChartCategory) { _nafChartCategory.destroy(); _nafChartCategory = null; }
    _nafChartCategory = new Chart(canvas, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: function(ctx) { return ' ' + ctx.dataset.label + ': ' + ctx.raw; } } }
            },
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, stacked: true, ticks: { precision: 0, color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.15)' } },
                x: { stacked: true, ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } }
            }
        }
    });

    var legendEl = document.getElementById('nafCategoryLegend');
    if (legendEl) {
        var html = '';
        for (var c = 0; c < sortedCats.length; c++) {
            var catName = sortedCats[c][0];
            var catInfo = sortedCats[c][1];
            var pct = data.length > 0 ? ((catInfo.total / data.length) * 100).toFixed(1) : '0';
            var acrissSorted = Object.entries(catInfo.acriss).sort(function(a, b) { return b[1] - a[1]; });
            var acrissStr = acrissSorted.map(function(x) { return x[0] + '(' + x[1] + ')'; }).join(', ');
            html += '<div class="text-xs py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-gray-50 dark:border-gray-700">'
                + '<div class="flex items-center justify-between">'
                + '<span class="font-semibold text-gray-600 dark:text-gray-300">' + catName + '</span>'
                + '<span class="font-semibold lynx-text-primary">' + catInfo.total.toLocaleString('en-GB') + ' <span class="text-gray-400 font-normal">(' + pct + '%)</span></span>'
                + '</div>'
                + '<div class="text-[0.6rem] text-gray-400 mt-0.5 leading-relaxed">' + acrissStr + '</div>'
                + '</div>';
        }
        legendEl.innerHTML = html;
    }
}

// -- Long-Term por Zona --
function _nafUpdateLongtermChart(data) {
    var canvas = document.getElementById('nafChartLongterm');
    if (!canvas || !window.Chart) return;

    var ltVehicles = [];
    for (var i = 0; i < data.length; i++) {
        var v = data[i];
        if (v.rentalActivity && v.rentalActivity.isLongterm && !_nafIsOficinaStation(v)) ltVehicles.push(v);
    }

    var zoneData = {};
    for (var j = 0; j < ltVehicles.length; j++) {
        var lv = ltVehicles[j];
        var zone = _nafGetVehicleZone(lv) || "No Zone";
        if (!zoneData[zone]) zoneData[zone] = { total: 0, lt30: 0, lt90: 0, lt180: 0, gt180: 0 };
        zoneData[zone].total++;
        var days = nafDaysAgo(lv.inStatusSince);
        if (days !== null) {
            if (days <= 30) zoneData[zone].lt30++;
            else if (days <= 90) zoneData[zone].lt90++;
            else if (days <= 180) zoneData[zone].lt180++;
            else zoneData[zone].gt180++;
        }
    }

    var zoneOrder = ["North", "Central", "South", "Islands", "No Zone"];
    var sorted = [];
    for (var z = 0; z < zoneOrder.length; z++) {
        if (zoneData[zoneOrder[z]]) sorted.push([zoneOrder[z], zoneData[zoneOrder[z]]]);
    }
    var zk = Object.keys(zoneData);
    for (var k = 0; k < zk.length; k++) {
        if (zoneOrder.indexOf(zk[k]) === -1) sorted.push([zk[k], zoneData[zk[k]]]);
    }
    var labels = sorted.map(function(s) { return s[0]; });
    var zoneColors = { "North": '#1e3a8a', "Central": '#dc2626', "South": '#16a34a', "Islands": '#2563eb', "No Zone": '#6b7280' };

    if (_nafChartLongterm) { _nafChartLongterm.destroy(); _nafChartLongterm = null; }
    _nafChartLongterm = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: '\u226430d', data: sorted.map(function(s) { return s[1].lt30; }), backgroundColor: '#22c55e', borderRadius: 2 },
                { label: '31-90d', data: sorted.map(function(s) { return s[1].lt90; }), backgroundColor: '#f59e0b', borderRadius: 2 },
                { label: '91-180d', data: sorted.map(function(s) { return s[1].lt180; }), backgroundColor: '#f97316', borderRadius: 2 },
                { label: '>180d', data: sorted.map(function(s) { return s[1].gt180; }), backgroundColor: '#ef4444', borderRadius: 2 }
            ]
        },
        options: {
            plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { size: 10 } } } },
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, stacked: true, ticks: { precision: 0, color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.15)' } },
                x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { display: false } }
            }
        }
    });

    var legendEl = document.getElementById('nafLongtermLegend');
    if (legendEl) {
        var html = '';
        for (var m = 0; m < sorted.length; m++) {
            var zn = sorted[m][0];
            var info = sorted[m][1];
            var c = zoneColors[zn] || '#6b7280';
            html += '<div class="flex items-center justify-between text-xs py-0.5 px-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50">'
                + '<span class="flex items-center gap-1.5"><span style="width:8px;height:8px;border-radius:2px;background:' + c + ';display:inline-block"></span><span class="text-gray-600 dark:text-gray-300">' + zn + '</span></span>'
                + '<span class="font-semibold lynx-text-primary ml-2 whitespace-nowrap">' + info.total + ' <span class="text-gray-400 font-normal">(\u226430d:' + info.lt30 + ' | 31-90d:' + info.lt90 + ' | 91-180d:' + info.lt180 + ' | >180d:' + info.gt180 + ')</span></span>'
                + '</div>';
        }
        legendEl.innerHTML = html;
    }
}

// -- Detail List Modal --
var _nafDetailFilters = {
    oficina: {
        label: "Workshop (Status 05/06)",
        filter: function(v) { return v.classicStatus === 5 || v.classicStatus === 6; },
        columns: ["License Plate", "Vehicle", 'ACRISS', 'Status', 'Sub-Status', 'Local', "Zone", "Days"],
        row: function(v) {
            var days = nafDaysAgo(v.inStatusSince);
            var statusLabel = v.classicStatus === 5 ? "Quick Repair" : 'Rep. Longa';
            return [
                v.licensePlate || '\u2014', v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                (v.acrissCode || '?').substring(0, 4), statusLabel, nafFormatSubStatus(v.subStatus),
                _nafGetBranchName(v), _nafGetVehicleZone(v) || '\u2014', days !== null ? days + 'd' : '\u2014'
            ];
        }
    },
    defleet: {
        label: 'To Defleet',
        filter: function(v) { return (v.subStatus || '').toUpperCase().indexOf('DEFLEET') !== -1; },
        columns: ["License Plate", "Vehicle", 'ACRISS', 'Branch', "Zone", "Defleet Date", "Days to Defleet", "Remaining km"],
        row: function(v) {
            var daysTo = _nafDaysToDefleet(v);
            var km = _nafRemainingKm(v);
            var defleetStr = v.defleetDate ? window.renaFormatDate(v.defleetDate, true) : '\u2014';
            var daysClass = daysTo !== null && daysTo <= 10 ? 'text-red-500 font-semibold' : '';
            var kmClass = km !== null && km <= 500 ? 'text-red-500 font-semibold' : '';
            return {
                cells: [v.licensePlate || '\u2014', v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                    (v.acrissCode || '?').substring(0, 4), (v.branch && v.branch.name) || '\u2014',
                    _nafGetVehicleZone(v) || '\u2014', defleetStr,
                    daysTo !== null ? daysTo + 'd' : '\u2014', km !== null ? km.toLocaleString('en-GB') + ' km' : '\u2014'],
                classes: ['', '', '', '', '', '', daysClass, kmClass]
            };
        }
    },
    infleet: {
        label: 'Infleet',
        filter: function(v) {
            var code = (v.holdCodeForDueDate || '').toUpperCase();
            var desc = (v.holdDescriptionForDueDate || '').toUpperCase();
            var sub  = (v.subStatus || '').toUpperCase();
            return code.indexOf('INFLEET') !== -1 || desc.indexOf('INFLEET') !== -1 || sub.indexOf('INFLEET') !== -1;
        },
        columns: ["License Plate", "Vehicle", 'ACRISS', 'Sub-Status', 'Branch', "Zone", "Days"],
        row: function(v) {
            var days = nafDaysAgo(v.inStatusSince);
            return [v.licensePlate || '\u2014', v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                (v.acrissCode || '?').substring(0, 4), nafFormatSubStatus(v.subStatus),
                (v.branch && v.branch.name) || '\u2014', _nafGetVehicleZone(v) || '\u2014', days !== null ? days + 'd' : '\u2014'];
        }
    },
    longterm: {
        label: "Long-Term (excl. Workshop)",
        filter: function(v) {
            if (!(v.rentalActivity && v.rentalActivity.isLongterm)) return false;
            return !_nafIsOficinaStation(v);
        },
        columns: ["License Plate", "Vehicle", 'ACRISS', 'Branch', "Zone", "Contract Duration"],
        row: function(v) {
            var days = nafDaysAgo(v.inStatusSince);
            var durLabel = '\u2014';
            if (days !== null) {
                if (days <= 30) durLabel = days + 'd (\u22641 m\u00eas)';
                else if (days <= 90) durLabel = days + 'd (1-3 meses)';
                else if (days <= 180) durLabel = days + 'd (3-6 meses)';
                else durLabel = days + 'd (>6 meses)';
            }
            return [v.licensePlate || '\u2014', v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                (v.acrissCode || '?').substring(0, 4), (v.branch && v.branch.name) || '\u2014',
                _nafGetVehicleZone(v) || '\u2014', durLabel];
        }
    },
    stuck7: {
        label: "Idle Vehicles >7 days",
        filter: function(v) { if (v.classicStatus === 0) return false; var d = nafDaysAgo(v.inStatusSince); return d !== null && d >= 7; },
        columns: ["License Plate", "Vehicle", 'ACRISS', 'Status', 'Sub-Status', 'Local', "Zone", "Days"],
        row: function(v) {
            var days = nafDaysAgo(v.inStatusSince);
            var statusMap = { 1: "Available", 2: 'Check-in', 3: "Transfer", 4: 'Check-out', 5: "Quick Repair", 6: 'Rep. Longa', 7: "Inactive", 9: 'Pending', 10: 'Pending', 11: "Available", 45: "Return" };
            return [v.licensePlate || '\u2014', v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                (v.acrissCode || '?').substring(0, 4), statusMap[v.classicStatus] || ('Status ' + (v.classicStatus || '?')),
                nafFormatSubStatus(v.subStatus), _nafGetBranchName(v), _nafGetVehicleZone(v) || '\u2014', days !== null ? days + 'd' : '\u2014'];
        }
    },
    stuck15: {
        label: "Idle Vehicles >15 days",
        filter: function(v) { if (v.classicStatus === 0) return false; var d = nafDaysAgo(v.inStatusSince); return d !== null && d >= 15; },
        columns: ["License Plate", "Vehicle", 'ACRISS', 'Status', 'Sub-Status', 'Local', "Zone", "Days"],
        row: function(v) {
            var days = nafDaysAgo(v.inStatusSince);
            var statusMap = { 1: "Available", 2: 'Check-in', 3: "Transfer", 4: 'Check-out', 5: "Quick Repair", 6: 'Rep. Longa', 7: "Inactive", 9: 'Pending', 10: 'Pending', 11: "Available", 45: "Return" };
            return [v.licensePlate || '\u2014', v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                (v.acrissCode || '?').substring(0, 4), statusMap[v.classicStatus] || ('Status ' + (v.classicStatus || '?')),
                nafFormatSubStatus(v.subStatus), _nafGetBranchName(v), _nafGetVehicleZone(v) || '\u2014', days !== null ? days + 'd' : '\u2014'];
        }
    },
    stuck30: {
        label: "Idle Vehicles >30 days",
        filter: function(v) { if (v.classicStatus === 0) return false; var d = nafDaysAgo(v.inStatusSince); return d !== null && d >= 30; },
        columns: ["License Plate", "Vehicle", 'ACRISS', 'Status', 'Sub-Status', 'Local', "Zone", "Days"],
        row: function(v) {
            var days = nafDaysAgo(v.inStatusSince);
            var statusMap = { 1: "Available", 2: 'Check-in', 3: "Transfer", 4: 'Check-out', 5: "Quick Repair", 6: 'Rep. Longa', 7: "Inactive", 9: 'Pending', 10: 'Pending', 11: "Available", 45: "Return" };
            return [v.licensePlate || '\u2014', v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                (v.acrissCode || '?').substring(0, 4), statusMap[v.classicStatus] || ('Status ' + (v.classicStatus || '?')),
                nafFormatSubStatus(v.subStatus), _nafGetBranchName(v), _nafGetVehicleZone(v) || '\u2014', days !== null ? days + 'd' : '\u2014'];
        }
    },
    defleet_urgent_days: {
        label: "Defleet < 10 days",
        filter: function(v) { if ((v.subStatus || '').toUpperCase().indexOf('DEFLEET') === -1) return false; var days = _nafDaysToDefleet(v); return days !== null && days <= 10; },
        columns: ["License Plate", "Vehicle", 'ACRISS', 'Branch', "Defleet Date", "Remaining Days", "Remaining km"],
        row: function(v) {
            var daysTo = _nafDaysToDefleet(v); var km = _nafRemainingKm(v);
            return [v.licensePlate || '\u2014', v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                (v.acrissCode || '?').substring(0, 4), (v.branch && v.branch.name) || '\u2014',
                v.defleetDate ? window.renaFormatDate(v.defleetDate, true) : '\u2014',
                daysTo !== null ? daysTo + 'd' : '\u2014', km !== null ? km.toLocaleString('en-GB') + ' km' : '\u2014'];
        }
    },
    defleet_urgent_km: {
        label: 'Defleet < 500 km',
        filter: function(v) { if ((v.subStatus || '').toUpperCase().indexOf('DEFLEET') === -1) return false; var km = _nafRemainingKm(v); return km !== null && km <= 500; },
        columns: ["License Plate", "Vehicle", 'ACRISS', 'Branch', "Remaining km", "Defleet Date", "Remaining Days"],
        row: function(v) {
            var daysTo = _nafDaysToDefleet(v); var km = _nafRemainingKm(v);
            return [v.licensePlate || '\u2014', v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                (v.acrissCode || '?').substring(0, 4), (v.branch && v.branch.name) || '\u2014',
                km !== null ? km.toLocaleString('en-GB') + ' km' : '\u2014',
                v.defleetDate ? window.renaFormatDate(v.defleetDate, true) : '\u2014',
                daysTo !== null ? daysTo + 'd' : '\u2014'];
        }
    },
    near_return_days: {
        label: "Approaching Return (<30 days)",
        filter: function(v) { if ((v.subStatus || '').toUpperCase().indexOf('DEFLEET') !== -1) return false; if (_nafVehicleHasAlarm(v)) return false; var days = _nafDaysToDefleet(v); return days !== null && days > 0 && days <= 30; },
        columns: ["License Plate", "Vehicle", 'ACRISS', 'Status', 'Sub-Status', 'Branch', "Defleet Date", "Remaining Days", "Remaining km"],
        row: function(v) {
            var daysTo = _nafDaysToDefleet(v); var km = _nafRemainingKm(v);
            var statusMap = { 1: "Available", 2: 'Em contrato', 3: "Transfer", 5: "Quick Repair", 6: 'Rep. Longa' };
            var daysClass = daysTo !== null && daysTo <= 10 ? 'text-red-500 font-semibold' : daysTo !== null && daysTo <= 20 ? 'text-orange-400 font-semibold' : '';
            return {
                cells: [v.licensePlate || '\u2014', v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                    (v.acrissCode || '?').substring(0, 4), statusMap[v.classicStatus] || ('Status ' + (v.classicStatus || '?')),
                    nafFormatSubStatus(v.subStatus), _nafGetBranchName(v),
                    v.defleetDate ? window.renaFormatDate(v.defleetDate, true) : '\u2014',
                    daysTo !== null ? daysTo + 'd' : '\u2014', km !== null ? km.toLocaleString('en-GB') + ' km' : '\u2014'],
                classes: ['', '', '', '', '', '', '', daysClass, '']
            };
        }
    },
    near_return_km: {
        label: "Approaching Return (<2000 km)",
        filter: function(v) { if ((v.subStatus || '').toUpperCase().indexOf('DEFLEET') !== -1) return false; if (_nafVehicleHasAlarm(v)) return false; var km = _nafRemainingKm(v); return km !== null && km <= 2000; },
        columns: ["License Plate", "Vehicle", 'ACRISS', 'Status', 'Sub-Status', 'Branch', "Remaining km", "Defleet Date", "Remaining Days"],
        row: function(v) {
            var daysTo = _nafDaysToDefleet(v); var km = _nafRemainingKm(v);
            var statusMap = { 1: "Available", 2: 'Em contrato', 3: "Transfer", 5: "Quick Repair", 6: 'Rep. Longa' };
            var kmClass = km !== null && km <= 500 ? 'text-red-500 font-semibold' : km !== null && km <= 1000 ? 'text-orange-400 font-semibold' : '';
            return {
                cells: [v.licensePlate || '\u2014', v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                    (v.acrissCode || '?').substring(0, 4), statusMap[v.classicStatus] || ('Status ' + (v.classicStatus || '?')),
                    nafFormatSubStatus(v.subStatus), _nafGetBranchName(v),
                    km !== null ? km.toLocaleString('en-GB') + ' km' : '\u2014',
                    v.defleetDate ? window.renaFormatDate(v.defleetDate, true) : '\u2014',
                    daysTo !== null ? daysTo + 'd' : '\u2014'],
                classes: ['', '', '', '', '', '', kmClass, '', '']
            };
        }
    }
};

window.nafShowDetailList = function (key) {
    var cfg = _nafDetailFilters[key];
    if (!cfg) return;
    var vehicles = [];
    for (var i = 0; i < NAF.rawData.length; i++) {
        if (cfg.filter(NAF.rawData[i])) vehicles.push(NAF.rawData[i]);
    }
    var modal = document.getElementById('nafDetailModal');
    var title = document.getElementById('nafDetailTitle');
    var thead = document.getElementById('nafDetailHead');
    var tbody = document.getElementById('nafDetailBody');
    if (!modal || !tbody) return;

    title.textContent = cfg.label + ' \u2014 ' + vehicles.length + " vehicles";

    // Build row data for all vehicles (so we can sort later)
    var allRows = [];
    for (var j = 0; j < vehicles.length; j++) {
        var rowData = cfg.row ? cfg.row(vehicles[j]) : null;
        if (!rowData) continue;
        var cells, classes;
        if (Array.isArray(rowData)) { cells = rowData; classes = []; }
        else { cells = rowData.cells; classes = rowData.classes || []; }
        allRows.push({ cells: cells, classes: classes });
    }

    // Sort state for this modal
    var sortCol = -1;
    var sortAsc = true;

    function renderHead() {
        if (!thead || !cfg.columns) return;
        var headHtml = '<tr class="text-left text-gray-400 border-b border-lynx-divider dark:border-gray-700">';
        for (var h = 0; h < cfg.columns.length; h++) {
            var arrow = '';
            if (h === sortCol) arrow = sortAsc ? ' <i class="fas fa-sort-up text-primary-400 ml-0.5"></i>' : ' <i class="fas fa-sort-down text-primary-400 ml-0.5"></i>';
            else arrow = ' <i class="fas fa-sort text-gray-600 ml-0.5 text-[0.5rem]"></i>';
            headHtml += '<th class="pb-2 pr-3 cursor-pointer select-none hover:text-gray-200 transition-colors" data-col="' + h + '">' + cfg.columns[h] + arrow + '</th>';
        }
        headHtml += '</tr>';
        thead.innerHTML = headHtml;

        // Attach click handlers
        var ths = thead.querySelectorAll('th[data-col]');
        for (var ti = 0; ti < ths.length; ti++) {
            ths[ti].addEventListener('click', function () {
                var col = parseInt(this.getAttribute('data-col'), 10);
                if (sortCol === col) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = true; }
                sortAndRender();
            });
        }
    }

    function renderBody() {
        var colCount = cfg.columns ? cfg.columns.length : 7;
        var bodyHtml = '';
        for (var r = 0; r < allRows.length; r++) {
            var row = allRows[r];
            bodyHtml += '<tr class="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">';
            for (var c = 0; c < row.cells.length; c++) {
                var cls = row.classes[c] || '';
                var baseClass = c === 0 ? 'py-2 pr-3 font-mono font-semibold text-primary-500' : 'py-2 pr-3';
                bodyHtml += '<td class="' + baseClass + ' ' + cls + '">' + row.cells[c] + '</td>';
            }
            bodyHtml += '</tr>';
        }
        if (!bodyHtml) bodyHtml = '<tr><td colspan="' + colCount + "\" class=\"py-8 text-center text-gray-400\">None viatura encontrada</td></tr>";
        tbody.innerHTML = bodyHtml;
    }

    function sortAndRender() {
        if (sortCol >= 0) {
            allRows.sort(function (a, b) {
                var va = (a.cells[sortCol] || '').toString().replace(/<[^>]*>/g, '').replace(/\u2014/g, '').trim();
                var vb = (b.cells[sortCol] || '').toString().replace(/<[^>]*>/g, '').replace(/\u2014/g, '').trim();
                // Try numeric comparison first (handles "12d", "+3", "45.6%")
                var na = parseFloat(va.replace(/[^0-9.\-]/g, ''));
                var nb = parseFloat(vb.replace(/[^0-9.\-]/g, ''));
                var cmp;
                if (!isNaN(na) && !isNaN(nb)) { cmp = na - nb; }
                else { cmp = va.localeCompare(vb, 'pt', { sensitivity: 'base' }); }
                return sortAsc ? cmp : -cmp;
            });
        }
        renderHead();
        renderBody();
    }

    // Initial render (unsorted)
    renderHead();
    renderBody();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.nafCloseDetailList = function () {
    var modal = document.getElementById('nafDetailModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
};

// ── BLOCKED VEHICLES (Alarmes → Regras de Bloqueio) ─────────────────────────

var _nafChartBlocked = null;

// Known blocking rule codes, ordered longest-first for greedy matching.
// The list is rebuilt at render time from NAF_STATION_CFG.regras_bloqueio.
var _nafBlockingRulesCache = null;

function _nafGetBlockingRules() {
    if (_nafBlockingRulesCache) return _nafBlockingRulesCache;
    var cfg = (window.NAF_STATION_CFG || {}).regras_bloqueio || [];
    // Build sorted list: longest sigla first so CODCHV matches before COD, ILHAS before I, etc.
    var rules = [];
    for (var i = 0; i < cfg.length; i++) {
        rules.push({ sigla: cfg[i].sigla.toUpperCase(), motivo: cfg[i].motivo, areas: cfg[i].areas || '' });
    }
    // Add common codes not in config (will show as-is, or fallback to Outros)
    var existing = {};
    for (var j = 0; j < rules.length; j++) existing[rules[j].sigla] = true;
    var extras = [
        { sigla: 'AXIS', motivo: "Business Use", areas: '' },
        { sigla: 'SEG', motivo: "Insurance", areas: '' },
        { sigla: 'FURTO', motivo: "Theft", areas: 'Security' },
        { sigla: 'MODT', motivo: "Technical Modification", areas: '' },
        { sigla: 'TARGA', motivo: 'Targa (Parceiro)', areas: '' },
        { sigla: 'EXKM', motivo: "Mileage Limit Exceeded", areas: '' },
        { sigla: 'CERTTOMOG', motivo: "Tachograph Certificate", areas: '' },
        { sigla: 'IHAS', motivo: "Islands (typo)", areas: '' },
        { sigla: 'CODCH', motivo: 'Codificar Chave (abrev.)', areas: '' }
    ];
    for (var e = 0; e < extras.length; e++) {
        if (!existing[extras[e].sigla]) rules.push(extras[e]);
    }
    rules.sort(function(a, b) { return b.sigla.length - a.sigla.length; });
    _nafBlockingRulesCache = rules;
    return rules;
}

/**
 * Parse an alarm string like "26/9ACIPO", "IPORETOM", "05/02VS", "CERTTOMOG"
 * Returns { codes: ['AC','IPO'], primary: 'AC', date: '26/9', raw: '26/9ACIPO' }
 *
 * Priority: first code found after stripping the date prefix is the primary one.
 * Special case: IPORETOM → codes are [IPO, RETOM], but RETOM is primary because
 * IPO is auxiliary (vehicle goes to IPO to return to customer).
 */
function _nafParseAlarm(alarm) {
    if (!alarm) return null;
    var raw = alarm.trim();
    if (!raw) return null;
    var rules = _nafGetBlockingRules();

    // Strip optional date prefix: DD/MM or D/M (1-2 digit day, 1-2 digit month)
    var datePrefix = '';
    var codeStr = raw;
    var dateMatch = raw.match(/^(\d{1,2}\/\d{1,2})\s*/);
    if (dateMatch) {
        datePrefix = dateMatch[1];
        codeStr = raw.substring(dateMatch[0].length);
    }

    // Also handle " " inside: "13/01 AC"
    codeStr = codeStr.replace(/\s+/g, '').toUpperCase();

    // Extract all matching siglas from codeStr (greedy, longest first)
    var remaining = codeStr;
    var codes = [];
    var maxIter = 20;
    while (remaining.length > 0 && maxIter-- > 0) {
        var found = false;
        for (var i = 0; i < rules.length; i++) {
            if (remaining.indexOf(rules[i].sigla) === 0) {
                codes.push(rules[i].sigla);
                remaining = remaining.substring(rules[i].sigla.length);
                found = true;
                break;
            }
        }
        if (!found) {
            // Unknown char/code — skip one character and keep trying
            remaining = remaining.substring(1);
        }
    }

    if (codes.length === 0) return { codes: [], primary: "Other", date: datePrefix, raw: raw };

    // Normalize common typos/aliases
    var aliases = { 'IHAS': 'ILHAS', 'CODCH': 'CODCHV' };
    for (var a = 0; a < codes.length; a++) {
        if (aliases[codes[a]]) codes[a] = aliases[codes[a]];
    }

    // Determine primary code with special priority rules:
    // If RETOM is present alongside IPO/TROC, RETOM takes priority
    var primary = codes[0];
    if (codes.length > 1) {
        // RETOM takes priority over IPO
        if (codes.indexOf('RETOM') !== -1 && codes.indexOf('IPO') !== -1) {
            primary = 'RETOM';
        }
        // AC takes priority over IPO
        if (codes.indexOf('AC') !== -1 && codes.indexOf('IPO') !== -1 && primary === 'IPO') {
            primary = 'AC';
        }
    }

    return { codes: codes, primary: primary, date: datePrefix, raw: raw };
}

function _nafRuleLabel(sigla) {
    var rules = _nafGetBlockingRules();
    for (var i = 0; i < rules.length; i++) {
        if (rules[i].sigla === sigla) return rules[i].motivo;
    }
    return sigla;
}

// Color palette for blocking reasons
var _nafBlockColors = {
    'AC': '#ef4444', 'VS': '#3b82f6', 'IPO': '#f59e0b', 'RETOM': '#8b5cf6',
    'PERIT': '#ec4899', 'TRANS': '#06b6d4', 'APREE': '#dc2626', 'VM': '#10b981',
    'VV': '#14b8a6', 'TROC': '#f97316', 'CARAC': '#a855f7', 'CODCHV': '#84cc16',
    'REV': '#eab308', 'ILHAS': '#2563eb', 'AXIS': '#6366f1', 'TARGA': '#0ea5e9',
    'SEG': '#f43f5e', 'FURTO': '#b91c1c', 'MODT': '#059669', 'EXKM': '#d97706',
    'CERTTOMOG': '#7c3aed', "Other": '#6b7280'
};

function _nafBlockColor(sigla) {
    return _nafBlockColors[sigla] || _nafBlockColors["Other"];
}

// Icons for each blocking reason
var _nafBlockIcons = {
    'AC': 'fa-user-secret', 'VS': 'fa-briefcase', 'IPO': 'fa-clipboard-check',
    'RETOM': 'fa-undo-alt', 'PERIT': 'fa-search', 'TRANS': 'fa-truck',
    'APREE': 'fa-gavel', 'VM': 'fa-wheelchair', 'VV': 'fa-road',
    'TROC': 'fa-exchange-alt', 'CARAC': 'fa-paint-brush', 'CODCHV': 'fa-key',
    'REV': 'fa-oil-can', 'ILHAS': 'fa-ship', 'AXIS': 'fa-handshake',
    'TARGA': 'fa-car-side', 'SEG': 'fa-shield-alt', 'FURTO': 'fa-mask',
    'MODT': 'fa-cogs', 'EXKM': 'fa-tachometer-alt', 'CERTTOMOG': 'fa-certificate',
    "Other": 'fa-question-circle'
};

function _nafBlockIcon(sigla) {
    return _nafBlockIcons[sigla] || _nafBlockIcons["Other"];
}

// Main blocked vehicles analysis — called from nafRenderAnalytics
window._nafUpdateBlockedSection = function (data) {
    var section = document.getElementById('analyticsBlockedSection');
    if (!section) return;

    // Reset rules cache so fresh regras are used
    _nafBlockingRulesCache = null;

    // Get masterdata cache
    var mdCache = (typeof window.nafGetMasterDataCache === 'function') ? window.nafGetMasterDataCache() : {};

    // Count blocked vehicles by primary reason
    var counts = {};    // sigla → count
    var vehicles = {};  // sigla → [vehicle]
    var totalBlocked = 0;

    for (var i = 0; i < data.length; i++) {
        var v = data[i];
        var plate = (v.licensePlate || '').trim();
        var md = mdCache[plate] || {};
        var alarme = md.alarme || '';
        if (!alarme) continue;

        var parsed = _nafParseAlarm(alarme);
        if (!parsed) continue;

        var key = parsed.primary;
        totalBlocked++;
        counts[key] = (counts[key] || 0) + 1;
        if (!vehicles[key]) vehicles[key] = [];
        vehicles[key].push({ vehicle: v, parsed: parsed });
    }

    if (totalBlocked === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';
    nafSetKpi('statBlockedTotal', totalBlocked.toLocaleString('en-GB') + " vehicles on hold");

    // Sort by count descending
    var sorted = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });

    // Build clickable cards grid
    var gridEl = document.getElementById('nafBlockedGrid');
    if (gridEl) {
        var html = '';
        for (var s = 0; s < sorted.length; s++) {
            var sigla = sorted[s];
            var n = counts[sigla];
            var pct = ((n / totalBlocked) * 100).toFixed(1);
            var color = _nafBlockColor(sigla);
            var icon = _nafBlockIcon(sigla);
            var label = _nafRuleLabel(sigla);
            html += '<div class="bg-white dark:bg-[#0a0a0a] rounded-xl border border-lynx-divider dark:border-gray-800 p-3 shadow-sm text-center cursor-pointer hover:ring-2 transition-all" '
                + 'style="--tw-ring-color:' + color + '" '
                + 'onclick="nafShowDetailList(\'blocked_' + sigla + '\')">'
                + '<div class="w-7 h-7 mx-auto mb-1.5 rounded-lg flex items-center justify-center" style="background:' + color + '15">'
                + '<i class="fas ' + icon + ' text-xs" style="color:' + color + '"></i></div>'
                + '<p class="text-[0.6rem] text-gray-400 mb-0.5 truncate" title="' + label + '">' + sigla + '</p>'
                + '<p class="text-base font-bold lynx-text-primary">' + n + '</p>'
                + '<p class="text-[0.55rem] text-gray-400">' + pct + '%</p>'
                + '</div>';
        }
        gridEl.innerHTML = html;
    }

    // Chart — horizontal bar
    var canvas = document.getElementById('nafChartBlocked');
    if (canvas && window.Chart) {
        var labels = sorted.map(function(s) { return _nafRuleLabel(s) + ' (' + s + ')'; });
        var values = sorted.map(function(s) { return counts[s]; });
        var colors = sorted.map(function(s) { return _nafBlockColor(s); });

        if (_nafChartBlocked) { _nafChartBlocked.destroy(); _nafChartBlocked = null; }

        var chartHeight = Math.max(200, sorted.length * 36 + 40);
        canvas.parentElement.style.height = chartHeight + 'px';

        _nafChartBlocked = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{ label: "Vehicles", data: values, backgroundColor: colors, borderRadius: 4 }]
            },
            options: {
                indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(ctx) {
                                var pct = totalBlocked > 0 ? ((ctx.raw / totalBlocked) * 100).toFixed(1) : '0';
                                return ' ' + ctx.raw + ' (' + pct + '%)';
                            }
                        }
                    }
                },
                responsive: true, maintainAspectRatio: false,
                scales: {
                    y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
                    x: { beginAtZero: true, ticks: { precision: 0, color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(148,163,184,.15)' } }
                }
            }
        });
    }

    // Register detail filters for each blocking reason
    for (var r = 0; r < sorted.length; r++) {
        (function(sigla) {
            _nafDetailFilters['blocked_' + sigla] = {
                label: _nafRuleLabel(sigla) + ' (' + sigla + ')',
                filter: function(v) {
                    var plate = (v.licensePlate || '').trim();
                    var md = mdCache[plate] || {};
                    if (!md.alarme) return false;
                    var parsed = _nafParseAlarm(md.alarme);
                    return parsed && parsed.primary === sigla;
                },
                columns: ["License Plate", "Vehicle", 'ACRISS', "Alert", "Hold Date", "Days on Hold", "Codes", 'Branch', "Zone"],
                row: function(v) {
                    var plate = (v.licensePlate || '').trim();
                    var md = mdCache[plate] || {};
                    var parsed = _nafParseAlarm(md.alarme);
                    var dateStr = parsed && parsed.date ? parsed.date : '\u2014';
                    // Calculate days since blocking from the date prefix
                    var diasBloq = '\u2014';
                    if (parsed && parsed.date) {
                        var parts = parsed.date.split('/');
                        if (parts.length === 2) {
                            var day = parseInt(parts[0], 10);
                            var month = parseInt(parts[1], 10);
                            var now = new Date();
                            var year = now.getFullYear();
                            var blockDate = new Date(year, month - 1, day);
                            // If the block date is in the future, it must be from last year
                            if (blockDate > now) blockDate = new Date(year - 1, month - 1, day);
                            var diff = Math.round((now - blockDate) / 86400000);
                            diasBloq = diff + 'd';
                        }
                    }
                    var codesStr = parsed ? parsed.codes.join(' + ') : '\u2014';
                    return [
                        plate || '\u2014',
                        v.displayName || ((v.make || '') + ' ' + (v.model || '')).trim() || '\u2014',
                        (v.acrissCode || '?').substring(0, 4),
                        md.alarme || '\u2014',
                        dateStr,
                        diasBloq,
                        codesStr,
                        _nafGetBranchName(v),
                        _nafGetVehicleZone(v) || '\u2014'
                    ];
                }
            };
        })(sorted[r]);
    }
};
