/* ══════════════ R.E.N.A. — Settings Module ══════════════ */
(function () {
    'use strict';

    let _nafSettingsCfg = null;  // working copy for editing
    let _nafPlanCfg = null;       // planning config working copy

    window.nafRenderSettings = async function () {
        if (!_nafStationCfgLoaded) await nafLoadStationConfig();
        _nafSettingsCfg = JSON.parse(JSON.stringify(NAF_STATION_CFG));
        // Load planning config
        try {
            const res = await fetch(API_BASE + '/api/planning-config');
            const json = await res.json();
            if (json.success) _nafPlanCfg = json.config;
            else _nafPlanCfg = {};
        } catch (e) { _nafPlanCfg = {}; }
        _nafSettingsRenderStations();
        _nafSettingsRenderZones();
        _nafSettingsRenderTypes();
        _nafSettingsRenderCC();
        _nafSettingsRenderBloqueio();
        _nafSettingsRenderDupExcl();
        _nafSettingsRenderPools();
        _nafSettingsRenderCategories();
        _nafSettingsRenderAliases();
        _nafSettingsRenderRegions();
        _nafSettingsRenderUpgrades();
        _nafSettingsRenderDistances();
        _nafSettingsRenderOpenGroups();
        _nafSettingsRenderPlanParams();
    };

    function _nafSettingsRenderStations() {
        const tbody = document.getElementById('nafSettingsBody');
        if (!tbody || !_nafSettingsCfg) return;

        const stations = _nafSettingsCfg.stations || {};
        const zones = Object.keys(_nafSettingsCfg.zones || {});
        const tipos = [...new Set(Object.values(stations).map(s => s.tipo).filter(Boolean))].sort();
        const entries = Object.entries(stations).sort((a, b) => (a[1].zona || '').localeCompare(b[1].zona || '') || (a[1].nome || '').localeCompare(b[1].nome || ''));

        const countEl = document.getElementById('nafSettingsStationCount');
        if (countEl) countEl.textContent = entries.length + " stations";

        const zoneOpts = zones.map(z => '<option value="' + z + '">' + z + '</option>').join('');
        const tipoOpts = tipos.map(t => '<option value="' + t + '">' + t + '</option>').join('');

        tbody.innerHTML = entries.map(([code, s]) => {
            return '<tr class="naf-settings-row border-b border-gray-50 dark:border-gray-800 hover:bg-lynx-subtle dark:hover:bg-gray-800/30" data-code="' + nafEsc(code) + '">'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(code) + '" data-field="code" class="w-16 px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300 font-mono" readonly></td>'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(s.nome || '') + '" data-field="nome" class="w-full px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300"></td>'
                + '<td class="px-3 py-1.5"><select data-field="zona" class="px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300"><option value="">—</option>' + zoneOpts.replace('value="' + (s.zona || '') + '"', 'value="' + (s.zona || '') + '" selected') + '</select></td>'
                + '<td class="px-3 py-1.5"><select data-field="tipo" class="px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300"><option value="">—</option>' + tipoOpts.replace('value="' + (s.tipo || '') + '"', 'value="' + (s.tipo || '') + '" selected') + '</select></td>'
                + '<td class="px-3 py-1.5 text-center"><input type="text" value="' + (s.lat != null ? s.lat : '') + '" data-field="lat" class="w-20 px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300 text-center font-mono"></td>'
                + '<td class="px-3 py-1.5 text-center"><input type="text" value="' + (s.lon != null ? s.lon : '') + '" data-field="lon" class="w-20 px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300 text-center font-mono"></td>'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(s.paired || '') + '" data-field="paired" class="w-14 px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300 font-mono"></td>'
                + '<td class="px-3 py-1.5 text-center"><input type="checkbox" data-field="transporte" ' + (s.transporte !== false ? 'checked' : '') + ' class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-500 focus:ring-primary-500 cursor-pointer"></td>'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(s.emails || '') + '" data-field="emails" class="w-48 px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-500" placeholder="contacto-demo@example.invalid; contacto-demo@example.invalid"></td>'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(s.notas || '') + '" data-field="notas" class="w-full px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-400"></td>'
                + '<td class="px-3 py-1.5 text-center"><button onclick="nafSettingsDeleteStation(\'' + nafEsc(code) + "')\" class=\"text-red-400 hover:text-red-500 text-xs\" title=\"Remove\"><i class=\"fas fa-trash\"></i></button></td>"
                + '</tr>';
        }).join('');
    }

    function _nafSettingsRenderZones() {
        const body = document.getElementById('nafSettingsZonesBody');
        if (!body || !_nafSettingsCfg) return;

        const zones = _nafSettingsCfg.zones || {};
        body.innerHTML = Object.entries(zones).map(([name, cfg]) => {
            return '<div class="flex items-center gap-3 p-3 rounded-lg bg-lynx-subtle dark:bg-[#1A1A1A] border border-lynx-divider dark:border-gray-800" data-zone="' + nafEsc(name) + '">'
                + '<input type="color" value="' + (cfg.color || '#666666') + "\" data-field=\"color\" class=\"w-8 h-8 rounded cursor-pointer border-0\" title=\"Color\">"
                + '<input type="text" value="' + nafEsc(name) + '" data-field="name" class="flex-1 px-2 py-1 text-sm rounded bg-transparent border border-lynx-divider dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold">'
                + '<input type="text" value="' + nafEsc(cfg.icon || '') + '" data-field="icon" class="w-32 px-2 py-1 text-xs rounded bg-transparent border border-lynx-divider dark:border-gray-700 text-gray-500" placeholder="fa-icon">'
                + '<button onclick="nafSettingsDeleteZone(\'' + nafEsc(name) + "')\" class=\"text-red-400 hover:text-red-500 text-xs\" title=\"Remove\"><i class=\"fas fa-trash\"></i></button>"
                + '</div>';
        }).join('');
    }

    function _nafSettingsRenderTypes() {
        const input = document.getElementById('nafSettingsHiddenTypes');
        if (!input || !_nafSettingsCfg) return;
        input.value = (_nafSettingsCfg.hiddenTypes || []).join(', ');
    }

    function _nafSettingsRenderCC() {
        const tbody = document.getElementById('nafSettingsCcBody');
        if (!tbody || !_nafSettingsCfg) return;
        const ccs = _nafSettingsCfg.centros_custo || [];
        const countEl = document.getElementById('nafSettingsCcCount');
        if (countEl) countEl.textContent = ccs.length + ' entradas';

        tbody.innerHTML = ccs.map((cc, i) => {
            return '<tr class="naf-cc-row border-b border-gray-50 dark:border-gray-800 hover:bg-lynx-subtle dark:hover:bg-gray-800/30" data-idx="' + i + '">'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(cc.codigo || '') + '" data-field="codigo" class="w-28 px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300 font-mono"></td>'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(cc.nome || '') + '" data-field="nome" class="w-full px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300"></td>'
                + '<td class="px-3 py-1.5 text-center"><button onclick="nafSettingsDeleteCc(' + i + ")\" class=\"text-red-400 hover:text-red-500 text-xs\" title=\"Remove\"><i class=\"fas fa-trash\"></i></button></td>"
                + '</tr>';
        }).join('');
    }

    function _nafSettingsCollect() {
        if (!_nafSettingsCfg) return;

        // Stations
        const newStations = {};
        document.querySelectorAll('#nafSettingsBody tr.naf-settings-row').forEach(row => {
            const code = row.querySelector('[data-field="code"]').value.trim();
            if (!code) return;
            const entry = {};
            entry.nome = row.querySelector('[data-field="nome"]').value.trim();
            entry.zona = row.querySelector('[data-field="zona"]').value.trim();
            entry.tipo = row.querySelector('[data-field="tipo"]').value.trim();
            const lat = row.querySelector('[data-field="lat"]').value.trim();
            const lon = row.querySelector('[data-field="lon"]').value.trim();
            if (lat && lon) { entry.lat = parseFloat(lat); entry.lon = parseFloat(lon); }
            const paired = row.querySelector('[data-field="paired"]').value.trim();
            if (paired) entry.paired = paired;
            const notas = row.querySelector('[data-field="notas"]').value.trim();
            if (notas) entry.notas = notas;
            const emails = row.querySelector('[data-field="emails"]').value.trim();
            if (emails) entry.emails = emails;
            entry.transporte = row.querySelector('[data-field="transporte"]').checked;
            newStations[code] = entry;
        });
        _nafSettingsCfg.stations = newStations;

        // Zones
        const newZones = {};
        document.querySelectorAll('#nafSettingsZonesBody > div[data-zone]').forEach(div => {
            const name = div.querySelector('[data-field="name"]').value.trim();
            if (!name) return;
            newZones[name] = {
                color: div.querySelector('[data-field="color"]').value,
                icon: div.querySelector('[data-field="icon"]').value.trim()
            };
        });
        _nafSettingsCfg.zones = newZones;

        // Hidden types
        const hiddenInput = document.getElementById('nafSettingsHiddenTypes');
        if (hiddenInput) {
            _nafSettingsCfg.hiddenTypes = hiddenInput.value.split(',').map(s => s.trim()).filter(Boolean);
        }

        // Centros de Custo
        const newCC = [];
        document.querySelectorAll('#nafSettingsCcBody tr.naf-cc-row').forEach(row => {
            const codigo = row.querySelector('[data-field="codigo"]').value.trim();
            const nome = row.querySelector('[data-field="nome"]').value.trim();
            if (codigo) newCC.push({ codigo, nome });
        });
        _nafSettingsCfg.centros_custo = newCC;

        // Regras de Bloqueio
        const newBloqueio = [];
        document.querySelectorAll('#nafSettingsBloqueioBody tr.naf-bloqueio-row').forEach(row => {
            const sigla = row.querySelector('[data-field="sigla"]').value.trim().toUpperCase();
            const motivo = row.querySelector('[data-field="motivo"]').value.trim();
            const areas = row.querySelector('[data-field="areas"]').value.trim();
            if (sigla) newBloqueio.push({ sigla, motivo, areas });
        });
        _nafSettingsCfg.regras_bloqueio = newBloqueio;

        // Excluir Duplicados
        const newDupExcl = [];
        document.querySelectorAll('#nafSettingsDupExclBody tr.naf-dupexcl-row').forEach(row => {
            const nome = row.querySelector('[data-field="nome"]').value.trim();
            const email = row.querySelector('[data-field="email"]').value.trim().toLowerCase();
            const nota = row.querySelector('[data-field="nota"]').value.trim();
            if (nome || email) newDupExcl.push({ nome, email, nota });
        });
        _nafSettingsCfg.dup_exclusions = newDupExcl;

        // Planning Pools
        const newPools = [];
        document.querySelectorAll('#nafSettingsPoolsBody .naf-pool-card').forEach(card => {
            const nome = card.querySelector('[data-field="pool-nome"]').value.trim();
            if (!nome) return;
            const stations = [];
            card.querySelectorAll('.naf-pool-station-tag').forEach(tag => {
                const sid = tag.getAttribute('data-sid');
                if (sid) stations.push(sid);
            });
            newPools.push({ nome, stations });
        });
        _nafSettingsCfg.planning_pools = newPools;

        // ACRISS Categories
        const newCats = [];
        document.querySelectorAll('#nafSettingsCatBody .naf-cat-card').forEach(card => {
            const nome = card.querySelector('[data-field="cat-nome"]').value.trim();
            if (!nome) return;
            const groupsStr = card.querySelector('[data-field="cat-groups"]').value.trim();
            const groups = groupsStr.split(/[,;\s]+/).map(g => g.trim().toUpperCase()).filter(Boolean);
            newCats.push({ nome, groups });
        });
        _nafSettingsCfg.acriss_categories = newCats;

        // ACRISS Aliases
        const newAliases = {};
        document.querySelectorAll('#nafSettingsAliasBody .naf-alias-row').forEach(row => {
            const from = row.querySelector('[data-field="alias-from"]').value.trim().toUpperCase();
            const to = row.querySelector('[data-field="alias-to"]').value.trim().toUpperCase();
            if (from && to) newAliases[from] = to;
        });
        _nafSettingsCfg.acriss_aliases = newAliases;

        // Planning Regions
        const newRegions = [];
        document.querySelectorAll('#nafSettingsRegionBody .naf-region-card').forEach(card => {
            const nome = card.querySelector('[data-field="region-nome"]').value.trim();
            if (!nome) return;
            const pools = [];
            card.querySelectorAll('.naf-region-pool-tag').forEach(tag => {
                const pn = tag.getAttribute('data-pool');
                if (pn) pools.push(pn);
            });
            newRegions.push({ nome, pools });
        });
        _nafSettingsCfg.planning_regions = newRegions;
    }

    window.nafSettingsSave = async function () {
        _nafSettingsCollect();
        const statusEl = document.getElementById('nafSettingsStatus');
        try {
            const res = await fetch(API_BASE + '/api/not-available-fleet/stations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: _nafSettingsCfg })
            });
            const json = await res.json();
            if (json.success) {
                NAF_STATION_CFG = JSON.parse(JSON.stringify(_nafSettingsCfg));
                window.NAF_STATION_CFG = NAF_STATION_CFG;
                if (statusEl) { statusEl.textContent = "✓ Saved successfully"; statusEl.className = 'text-xs text-green-500'; statusEl.classList.remove('hidden'); }
                if (NAF.rawData.length) nafRenderFleetMap(NAF.rawData);
            } else {
                if (statusEl) { statusEl.textContent = "✗ Error: " + (json.error || ''); statusEl.className = 'text-xs text-red-500'; statusEl.classList.remove('hidden'); }
            }
        } catch (e) {
            if (statusEl) { statusEl.textContent = "✗ Connection error"; statusEl.className = 'text-xs text-red-500'; statusEl.classList.remove('hidden'); }
        }
        setTimeout(() => { if (statusEl) statusEl.classList.add('hidden'); }, 4000);
    };

    window.nafSettingsReload = async function () {
        await nafLoadStationConfig();
        _nafSettingsCfg = JSON.parse(JSON.stringify(NAF_STATION_CFG));
        try {
            const res = await fetch(API_BASE + '/api/planning-config');
            const json = await res.json();
            if (json.success) _nafPlanCfg = json.config;
        } catch (e) { /* keep current */ }
        _nafSettingsRenderStations();
        _nafSettingsRenderZones();
        _nafSettingsRenderTypes();
        _nafSettingsRenderCC();
        _nafSettingsRenderBloqueio();
        _nafSettingsRenderDupExcl();
        _nafSettingsRenderPools();
        _nafSettingsRenderCategories();
        _nafSettingsRenderAliases();
        _nafSettingsRenderRegions();
        _nafSettingsRenderUpgrades();
        _nafSettingsRenderDistances();
        _nafSettingsRenderOpenGroups();
        _nafSettingsRenderPlanParams();
        const statusEl = document.getElementById('nafSettingsStatus');
        if (statusEl) { statusEl.textContent = "↻ Reloaded from the server"; statusEl.className = 'text-xs text-blue-500'; statusEl.classList.remove('hidden'); }
        setTimeout(() => { if (statusEl) statusEl.classList.add('hidden'); }, 3000);
    };

    window.nafSettingsTab = function (tab) {
        const panels = { zones: 'settingsPanelZones', types: 'settingsPanelTypes', cc: 'settingsPanelCc', bloqueio: 'settingsPanelBloqueio', dupExcl: 'settingsPanelDupExcl', pools: 'settingsPanelPools', categories: 'settingsPanelCategories', regions: 'settingsPanelRegions', brands: 'settingsPanelBrands', upgrades: 'settingsPanelUpgrades', distances: 'settingsPanelDistances', openGroups: 'settingsPanelOpenGroups', planParams: 'settingsPanelPlanParams', users: 'settingsPanelUsers' };
        const tabs = { zones: 'settingsTabZones', types: 'settingsTabTypes', cc: 'settingsTabCc', bloqueio: 'settingsTabBloqueio', dupExcl: 'settingsTabDupExcl', pools: 'settingsTabPools', categories: 'settingsTabCategories', regions: 'settingsTabRegions', brands: 'settingsTabBrands', upgrades: 'settingsTabUpgrades', distances: 'settingsTabDistances', openGroups: 'settingsTabOpenGroups', planParams: 'settingsTabPlanParams', users: 'settingsTabUsers' };
        Object.entries(panels).forEach(([key, id]) => {
            const el = document.getElementById(id);
            if (el) el.style.display = key === tab ? '' : 'none';
        });
        Object.entries(tabs).forEach(([key, id]) => {
            const el = document.getElementById(id);
            if (el) {
                if (key === tab) {
                    el.className = key === 'users'
                        ? 'px-4 py-2 text-sm font-medium border-b-2 border-yellow-400 text-yellow-500'
                        : 'px-4 py-2 text-sm font-medium border-b-2 border-primary-500 text-primary-500';
                } else {
                    el.className = key === 'users'
                        ? 'px-4 py-2 text-sm font-medium border-b-2 border-transparent text-yellow-500 hover:text-yellow-400'
                        : 'px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-400 hover:text-primary-500';
                }
            }
        });
        if (tab === 'users') _renaUsersRender();
        if (tab === 'brands') _renaBrandsRender();
    };

    window.nafSettingsAddStation = function () {
        if (!_nafSettingsCfg) return;
        const code = prompt("New station code:");
        if (!code || !code.trim()) return;
        if (_nafSettingsCfg.stations[code.trim()]) { alert("Code already exists!"); return; }
        _nafSettingsCfg.stations[code.trim()] = { nome: '', zona: '', tipo: "Station" };
        _nafSettingsRenderStations();
    };

    window.nafSettingsDeleteStation = function (code) {
        if (!_nafSettingsCfg || !confirm("Remove station " + code + '?')) return;
        delete _nafSettingsCfg.stations[code];
        _nafSettingsRenderStations();
    };

    window.nafSettingsAddZone = function () {
        if (!_nafSettingsCfg) return;
        const name = prompt("New zone name:");
        if (!name || !name.trim()) return;
        if (!_nafSettingsCfg.zones) _nafSettingsCfg.zones = {};
        _nafSettingsCfg.zones[name.trim()] = { color: '#666666', icon: 'fa-circle' };
        _nafSettingsRenderZones();
    };

    window.nafSettingsDeleteZone = function (name) {
        if (!_nafSettingsCfg || !confirm("Remove zone " + name + '?')) return;
        delete _nafSettingsCfg.zones[name];
        _nafSettingsRenderZones();
    };

    window.nafSettingsFilterTable = function () {
        const q = (document.getElementById('nafSettingsSearch')?.value || '').toLowerCase();
        document.querySelectorAll('#nafSettingsBody tr.naf-settings-row').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = !q || text.includes(q) ? '' : 'none';
        });
    };

    window.nafSettingsAddCc = function () {
        if (!_nafSettingsCfg) return;
        const codigo = prompt("Cost center code (e.g. DEMO_01):");
        if (!codigo || !codigo.trim()) return;
        const nome = prompt("Cost center name:");
        if (!nome || !nome.trim()) return;
        if (!_nafSettingsCfg.centros_custo) _nafSettingsCfg.centros_custo = [];
        if (_nafSettingsCfg.centros_custo.some(cc => cc.codigo === codigo.trim())) { alert("Code already exists!"); return; }
        _nafSettingsCfg.centros_custo.push({ codigo: codigo.trim(), nome: nome.trim() });
        _nafSettingsRenderCC();
    };

    window.nafSettingsDeleteCc = function (idx) {
        if (!_nafSettingsCfg || !_nafSettingsCfg.centros_custo) return;
        const cc = _nafSettingsCfg.centros_custo[idx];
        if (!cc || !confirm("Remove cost center " + cc.codigo + '?')) return;
        _nafSettingsCfg.centros_custo.splice(idx, 1);
        _nafSettingsRenderCC();
    };

    window.nafSettingsFilterCc = function () {
        const q = (document.getElementById('nafSettingsCcSearch')?.value || '').toLowerCase();
        document.querySelectorAll('#nafSettingsCcBody tr.naf-cc-row').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = !q || text.includes(q) ? '' : 'none';
        });
    };

    // ── REGRAS DE BLOQUEIO ──────────────────────────────────────
    function _nafSettingsRenderBloqueio() {
        const tbody = document.getElementById('nafSettingsBloqueioBody');
        if (!tbody || !_nafSettingsCfg) return;
        const regras = _nafSettingsCfg.regras_bloqueio || [];
        const countEl = document.getElementById('nafSettingsBloqueioCount');
        if (countEl) countEl.textContent = regras.length + ' regras';

        tbody.innerHTML = regras.map((r, i) => {
            return '<tr class="naf-bloqueio-row border-b border-gray-50 dark:border-gray-800 hover:bg-lynx-subtle dark:hover:bg-gray-800/30" data-idx="' + i + '">'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(r.sigla || '') + '" data-field="sigla" class="w-20 px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300 font-mono font-semibold uppercase"></td>'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(r.motivo || '') + '" data-field="motivo" class="w-full px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300"></td>'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(r.areas || '') + '" data-field="areas" class="w-full px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-500 dark:text-gray-400"></td>'
                + '<td class="px-3 py-1.5 text-center"><button onclick="nafSettingsDeleteBloqueio(' + i + ")\" class=\"text-red-400 hover:text-red-500 text-xs\" title=\"Remove\"><i class=\"fas fa-trash\"></i></button></td>"
                + '</tr>';
        }).join('');
    }

    window.nafSettingsAddBloqueio = function () {
        if (!_nafSettingsCfg) return;
        const sigla = prompt("Hold code (e.g. TRANS):");
        if (!sigla || !sigla.trim()) return;
        const motivo = prompt("Hold reason:");
        if (!motivo || !motivo.trim()) return;
        const areas = prompt("Authorized roles (comma-separated):");
        if (!_nafSettingsCfg.regras_bloqueio) _nafSettingsCfg.regras_bloqueio = [];
        if (_nafSettingsCfg.regras_bloqueio.some(r => r.sigla === sigla.trim().toUpperCase())) { alert("Code already exists!"); return; }
        _nafSettingsCfg.regras_bloqueio.push({ sigla: sigla.trim().toUpperCase(), motivo: motivo.trim(), areas: (areas || '').trim() });
        _nafSettingsRenderBloqueio();
    };

    window.nafSettingsDeleteBloqueio = function (idx) {
        if (!_nafSettingsCfg || !_nafSettingsCfg.regras_bloqueio) return;
        const r = _nafSettingsCfg.regras_bloqueio[idx];
        if (!r || !confirm("Remove hold rule \"" + r.sigla + '"?')) return;
        _nafSettingsCfg.regras_bloqueio.splice(idx, 1);
        _nafSettingsRenderBloqueio();
    };

    window.nafSettingsFilterBloqueio = function () {
        const q = (document.getElementById('nafSettingsBloqueioSearch')?.value || '').toLowerCase();
        document.querySelectorAll('#nafSettingsBloqueioBody tr.naf-bloqueio-row').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = !q || text.includes(q) ? '' : 'none';
        });
    };

    // ── EXCLUIR DUPLICADOS ──────────────────────────────────────
    function _nafSettingsRenderDupExcl() {
        const tbody = document.getElementById('nafSettingsDupExclBody');
        if (!tbody || !_nafSettingsCfg) return;
        const entries = _nafSettingsCfg.dup_exclusions || [];
        const countEl = document.getElementById('nafSettingsDupExclCount');
        if (countEl) countEl.textContent = entries.length + ' entradas';

        tbody.innerHTML = entries.map((e, i) => {
            return '<tr class="naf-dupexcl-row border-b border-gray-50 dark:border-gray-800 hover:bg-lynx-subtle dark:hover:bg-gray-800/30" data-idx="' + i + '">'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(e.nome || '') + '" data-field="nome" class="w-full px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300"></td>'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(e.email || '') + '" data-field="email" class="w-full px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-700 dark:text-gray-300 font-mono"></td>'
                + '<td class="px-3 py-1.5"><input type="text" value="' + nafEsc(e.nota || '') + '" data-field="nota" class="w-full px-1 py-0.5 text-xs rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-400"></td>'
                + '<td class="px-3 py-1.5 text-center"><button onclick="nafSettingsDeleteDupExcl(' + i + ")\" class=\"text-red-400 hover:text-red-500 text-xs\" title=\"Remove\"><i class=\"fas fa-trash\"></i></button></td>"
                + '</tr>';
        }).join('');
    }

    window.nafSettingsAddDupExcl = function () {
        if (!_nafSettingsCfg) return;
        const nome = prompt("Customer name to exclude (optional):") || '';
        const email = prompt('Email a excluir (pode deixar vazio):') || '';
        if (!nome.trim() && !email.trim()) { alert("Enter at least a name or an email address."); return; }
        const nota = prompt("Note (opcional, ex: \"Corporate\"):") || '';
        if (!_nafSettingsCfg.dup_exclusions) _nafSettingsCfg.dup_exclusions = [];
        _nafSettingsCfg.dup_exclusions.push({ nome: nome.trim(), email: email.trim().toLowerCase(), nota: nota.trim() });
        _nafSettingsRenderDupExcl();
    };

    window.nafSettingsDeleteDupExcl = function (idx) {
        if (!_nafSettingsCfg || !_nafSettingsCfg.dup_exclusions) return;
        const e = _nafSettingsCfg.dup_exclusions[idx];
        if (!e || !confirm("Remove exclusion \"" + (e.nome || e.email) + '"?')) return;
        _nafSettingsCfg.dup_exclusions.splice(idx, 1);
        _nafSettingsRenderDupExcl();
    };

    window.nafSettingsFilterDupExcl = function () {
        const q = (document.getElementById('nafSettingsDupExclSearch')?.value || '').toLowerCase();
        document.querySelectorAll('#nafSettingsDupExclBody tr.naf-dupexcl-row').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = !q || text.includes(q) ? '' : 'none';
        });
    };

    // ── POOLS PLANNING ──────────────────────────────────────────
    function _nafSettingsRenderPools() {
        const body = document.getElementById('nafSettingsPoolsBody');
        if (!body || !_nafSettingsCfg) return;
        const pools = _nafSettingsCfg.planning_pools || [];
        const countEl = document.getElementById('nafSettingsPoolsCount');
        if (countEl) countEl.textContent = pools.length + ' pools';

        const stations = _nafSettingsCfg.stations || {};
        const stationList = Object.entries(stations).sort((a, b) => (a[1].nome || '').localeCompare(b[1].nome || ''));

        body.innerHTML = pools.map((pool, idx) => {
            const stationTags = (pool.stations || []).map(sid => {
                const sname = stations[sid] ? stations[sid].nome : sid;
                return '<span class="naf-pool-station-tag inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400 text-[0.65rem]" data-sid="' + nafEsc(sid) + '">'
                    + nafEsc(sname) + ' <span class="text-gray-400 font-mono text-[0.55rem]">' + nafEsc(sid) + '</span>'
                    + ' <button onclick="nafSettingsRemovePoolStation(' + idx + ',\'' + nafEsc(sid) + '\')" class="text-red-400 hover:text-red-500 ml-0.5">&times;</button>'
                    + '</span>';
            }).join(' ');

            const selectOpts = stationList.map(([sid, s]) => '<option value="' + nafEsc(sid) + '">' + nafEsc(s.nome || sid) + ' (' + nafEsc(sid) + ')</option>').join('');

            return '<div class="naf-pool-card p-3 rounded-lg bg-lynx-subtle dark:bg-[#1A1A1A] border border-lynx-divider dark:border-gray-800" data-pool-idx="' + idx + '">'
                + '<div class="flex items-center gap-2 mb-2">'
                + '<input type="text" value="' + nafEsc(pool.nome || '') + "\" data-field=\"pool-nome\" class=\"flex-1 px-2 py-1 text-sm font-semibold rounded bg-transparent border border-lynx-divider dark:border-gray-700 text-gray-700 dark:text-gray-300\" placeholder=\"Pool name\">"
                + '<button onclick="nafSettingsDeletePool(' + idx + ")\" class=\"text-red-400 hover:text-red-500 text-xs px-2\" title=\"Remove Pool\"><i class=\"fas fa-trash\"></i></button>"
                + '</div>'
                + '<div class="flex flex-wrap gap-1 mb-2">' + (stationTags || "<span class=\"text-xs text-gray-400 italic\">No stations</span>") + '</div>'
                + '<div class="flex gap-2">'
                + "<select class=\"naf-pool-station-select flex-1 text-xs px-2 py-1 rounded bg-white dark:bg-[#0A0A0A] border border-lynx-divider dark:border-gray-700 text-gray-600 dark:text-gray-400\"><option value=\"\">+ Add station…</option>" + selectOpts + '</select>'
                + '<button onclick="nafSettingsAddPoolStation(' + idx + ')" class="px-2 py-1 text-xs rounded bg-primary-500/10 text-primary-500 hover:bg-primary-500/20"><i class="fas fa-plus"></i></button>'
                + '</div>'
                + '</div>';
        }).join('');
    }

    window.nafSettingsAddPool = function () {
        if (!_nafSettingsCfg) return;
        const nome = prompt("New pool name (e.g. Pool Porto):");
        if (!nome || !nome.trim()) return;
        if (!_nafSettingsCfg.planning_pools) _nafSettingsCfg.planning_pools = [];
        _nafSettingsCfg.planning_pools.push({ nome: nome.trim(), stations: [] });
        _nafSettingsRenderPools();
    };

    window.nafSettingsDeletePool = function (idx) {
        if (!_nafSettingsCfg || !_nafSettingsCfg.planning_pools) return;
        const p = _nafSettingsCfg.planning_pools[idx];
        if (!p || !confirm("Remove pool \"" + p.nome + '"?')) return;
        _nafSettingsCfg.planning_pools.splice(idx, 1);
        _nafSettingsRenderPools();
    };

    window.nafSettingsAddPoolStation = function (poolIdx) {
        if (!_nafSettingsCfg || !_nafSettingsCfg.planning_pools) return;
        const pool = _nafSettingsCfg.planning_pools[poolIdx];
        if (!pool) return;
        const cards = document.querySelectorAll('#nafSettingsPoolsBody .naf-pool-card');
        const card = cards[poolIdx];
        if (!card) return;
        const sel = card.querySelector('.naf-pool-station-select');
        const sid = sel?.value;
        if (!sid) return;
        if (pool.stations.includes(sid)) { alert("Station already belongs to this pool!"); return; }
        pool.stations.push(sid);
        _nafSettingsRenderPools();
    };

    window.nafSettingsRemovePoolStation = function (poolIdx, sid) {
        if (!_nafSettingsCfg || !_nafSettingsCfg.planning_pools) return;
        const pool = _nafSettingsCfg.planning_pools[poolIdx];
        if (!pool) return;
        pool.stations = pool.stations.filter(s => s !== sid);
        _nafSettingsRenderPools();
    };

    // ── ACRISS CATEGORIES ───────────────────────────────────────
    function _nafSettingsRenderCategories() {
        const body = document.getElementById('nafSettingsCatBody');
        if (!body || !_nafSettingsCfg) return;
        const cats = _nafSettingsCfg.acriss_categories || [];
        const countEl = document.getElementById('nafSettingsCatCount');
        if (countEl) countEl.textContent = cats.length + ' categorias';

        body.innerHTML = cats.map((cat, idx) => {
            return '<div class="naf-cat-card p-3 rounded-lg bg-lynx-subtle dark:bg-[#1A1A1A] border border-lynx-divider dark:border-gray-800" data-cat-idx="' + idx + '">'
                + '<div class="flex items-center gap-2 mb-2">'
                + '<input type="text" value="' + nafEsc(cat.nome || '') + "\" data-field=\"cat-nome\" class=\"flex-1 px-2 py-1 text-sm font-semibold rounded bg-transparent border border-lynx-divider dark:border-gray-700 text-gray-700 dark:text-gray-300\" placeholder=\"Category name\">"
                + '<span class="text-[0.55rem] text-gray-400">' + (cat.groups || []).length + " groups</span>"
                + '<button onclick="nafSettingsDeleteCategory(' + idx + ")\" class=\"text-red-400 hover:text-red-500 text-xs px-2\" title=\"Remove\"><i class=\"fas fa-trash\"></i></button>"
                + '</div>'
                + "<textarea data-field=\"cat-groups\" rows=\"2\" class=\"w-full px-2 py-1 text-xs rounded bg-white dark:bg-[#0A0A0A] border border-lynx-divider dark:border-gray-700 text-gray-600 dark:text-gray-400 font-mono\" placeholder=\"ACRISS codes separated by commas or spaces\">"
                + nafEsc((cat.groups || []).join(', '))
                + '</textarea>'
                + '</div>';
        }).join('');
    }

    window.nafSettingsAddCategory = function () {
        if (!_nafSettingsCfg) return;
        const nome = prompt("New category name (e.g. Manual):");
        if (!nome || !nome.trim()) return;
        if (!_nafSettingsCfg.acriss_categories) _nafSettingsCfg.acriss_categories = [];
        _nafSettingsCfg.acriss_categories.push({ nome: nome.trim(), groups: [] });
        _nafSettingsRenderCategories();
    };

    window.nafSettingsDeleteCategory = function (idx) {
        if (!_nafSettingsCfg || !_nafSettingsCfg.acriss_categories) return;
        const c = _nafSettingsCfg.acriss_categories[idx];
        if (!c || !confirm("Remove categoria \"" + c.nome + '"?')) return;
        _nafSettingsCfg.acriss_categories.splice(idx, 1);
        _nafSettingsRenderCategories();
    };

    // ── ACRISS ALIASES ──────────────────────────────────────────
    function _nafSettingsRenderAliases() {
        const body = document.getElementById('nafSettingsAliasBody');
        if (!body || !_nafSettingsCfg) return;
        const aliases = _nafSettingsCfg.acriss_aliases || {};
        const entries = Object.entries(aliases);

        body.innerHTML = entries.map(([from, to], idx) => {
            return '<div class="naf-alias-row flex items-center gap-2">'
                + '<input type="text" value="' + nafEsc(from) + "\" data-field=\"alias-from\" class=\"w-20 px-2 py-1 text-xs font-mono rounded bg-white dark:bg-[#0A0A0A] border border-lynx-divider dark:border-gray-700 text-gray-600 dark:text-gray-400 uppercase\" placeholder=\"From\">"
                + '<span class="text-gray-400 text-xs">→</span>'
                + '<input type="text" value="' + nafEsc(to) + '" data-field="alias-to" class="w-20 px-2 py-1 text-xs font-mono rounded bg-white dark:bg-[#0A0A0A] border border-lynx-divider dark:border-gray-700 text-gray-600 dark:text-gray-400 uppercase" placeholder="Para">'
                + "<button onclick=\"this.closest('.naf-alias-row').remove()\" class=\"text-red-400 hover:text-red-500 text-xs\" title=\"Remove\"><i class=\"fas fa-trash\"></i></button>"
                + '</div>';
        }).join('');
    }

    window.nafSettingsAddAlias = function () {
        const body = document.getElementById('nafSettingsAliasBody');
        if (!body) return;
        const div = document.createElement('div');
        div.className = 'naf-alias-row flex items-center gap-2';
        div.innerHTML = "<input type=\"text\" value=\"\" data-field=\"alias-from\" class=\"w-20 px-2 py-1 text-xs font-mono rounded bg-white dark:bg-[#0A0A0A] border border-lynx-divider dark:border-gray-700 text-gray-600 dark:text-gray-400 uppercase\" placeholder=\"From\">"
            + '<span class="text-gray-400 text-xs">→</span>'
            + '<input type="text" value="" data-field="alias-to" class="w-20 px-2 py-1 text-xs font-mono rounded bg-white dark:bg-[#0A0A0A] border border-lynx-divider dark:border-gray-700 text-gray-600 dark:text-gray-400 uppercase" placeholder="Para">'
            + "<button onclick=\"this.closest('.naf-alias-row').remove()\" class=\"text-red-400 hover:text-red-500 text-xs\" title=\"Remove\"><i class=\"fas fa-trash\"></i></button>";
        body.appendChild(div);
    };

    // ── PLANNING REGIONS ────────────────────────────────────────
    function _nafSettingsRenderRegions() {
        const body = document.getElementById('nafSettingsRegionBody');
        if (!body || !_nafSettingsCfg) return;
        const regions = _nafSettingsCfg.planning_regions || [];
        const countEl = document.getElementById('nafSettingsRegionCount');
        if (countEl) countEl.textContent = regions.length + " regions";

        // Get available pool names (from planning_pools config or zona fallback)
        const poolNames = new Set();
        (_nafSettingsCfg.planning_pools || []).forEach(p => { if (p.nome) poolNames.add(p.nome); });
        if (!poolNames.size) {
            // Fallback: use unique zona values from stations
            Object.values(_nafSettingsCfg.stations || {}).forEach(s => { if (s.zona) poolNames.add(s.zona); });
        }
        const poolList = [...poolNames].sort();

        body.innerHTML = regions.map((reg, idx) => {
            const poolTags = (reg.pools || []).map(pn => {
                return '<span class="naf-region-pool-tag inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400 text-[0.65rem]" data-pool="' + nafEsc(pn) + '">'
                    + nafEsc(pn)
                    + ' <button onclick="nafSettingsRemoveRegionPool(' + idx + ',\'' + nafEsc(pn) + '\')" class="text-red-400 hover:text-red-500 ml-0.5">&times;</button>'
                    + '</span>';
            }).join(' ');

            const selectOpts = poolList.map(pn => '<option value="' + nafEsc(pn) + '">' + nafEsc(pn) + '</option>').join('');

            return '<div class="naf-region-card p-3 rounded-lg bg-lynx-subtle dark:bg-[#1A1A1A] border border-lynx-divider dark:border-gray-800" data-region-idx="' + idx + '">'
                + '<div class="flex items-center gap-2 mb-2">'
                + '<input type="text" value="' + nafEsc(reg.nome || '') + "\" data-field=\"region-nome\" class=\"flex-1 px-2 py-1 text-sm font-semibold rounded bg-transparent border border-lynx-divider dark:border-gray-700 text-gray-700 dark:text-gray-300\" placeholder=\"Region name\">"
                + '<button onclick="nafSettingsDeleteRegion(' + idx + ")\" class=\"text-red-400 hover:text-red-500 text-xs px-2\" title=\"Remove\"><i class=\"fas fa-trash\"></i></button>"
                + '</div>'
                + '<div class="flex flex-wrap gap-1 mb-2">' + (poolTags || "<span class=\"text-xs text-gray-400 italic\">No pools</span>") + '</div>'
                + '<div class="flex gap-2">'
                + "<select class=\"naf-region-pool-select flex-1 text-xs px-2 py-1 rounded bg-white dark:bg-[#0A0A0A] border border-lynx-divider dark:border-gray-700 text-gray-600 dark:text-gray-400\"><option value=\"\">+ Add pool...</option>" + selectOpts + '</select>'
                + '<button onclick="nafSettingsAddRegionPool(' + idx + ')" class="px-2 py-1 text-xs rounded bg-primary-500/10 text-primary-500 hover:bg-primary-500/20"><i class="fas fa-plus"></i></button>'
                + '</div>'
                + '</div>';
        }).join('');
    }

    window.nafSettingsAddRegion = function () {
        if (!_nafSettingsCfg) return;
        const nome = prompt("New region name (e.g. North):");
        if (!nome || !nome.trim()) return;
        if (!_nafSettingsCfg.planning_regions) _nafSettingsCfg.planning_regions = [];
        _nafSettingsCfg.planning_regions.push({ nome: nome.trim(), pools: [] });
        _nafSettingsRenderRegions();
    };

    window.nafSettingsDeleteRegion = function (idx) {
        if (!_nafSettingsCfg || !_nafSettingsCfg.planning_regions) return;
        const r = _nafSettingsCfg.planning_regions[idx];
        if (!r || !confirm("Remove region \"" + r.nome + '"?')) return;
        _nafSettingsCfg.planning_regions.splice(idx, 1);
        _nafSettingsRenderRegions();
    };

    window.nafSettingsAddRegionPool = function (regionIdx) {
        if (!_nafSettingsCfg || !_nafSettingsCfg.planning_regions) return;
        const region = _nafSettingsCfg.planning_regions[regionIdx];
        if (!region) return;
        const cards = document.querySelectorAll('#nafSettingsRegionBody .naf-region-card');
        const card = cards[regionIdx];
        if (!card) return;
        const sel = card.querySelector('.naf-region-pool-select');
        const pn = sel?.value;
        if (!pn) return;
        if (region.pools.includes(pn)) { alert("Pool already belongs to this region!"); return; }
        region.pools.push(pn);
        _nafSettingsRenderRegions();
    };

    window.nafSettingsRemoveRegionPool = function (regionIdx, poolName) {
        if (!_nafSettingsCfg || !_nafSettingsCfg.planning_regions) return;
        const region = _nafSettingsCfg.planning_regions[regionIdx];
        if (!region) return;
        region.pools = region.pools.filter(p => p !== poolName);
        _nafSettingsRenderRegions();
    };

    /* ═══════════════════════════════════════════════════════════════
       PLANNING CONFIG — Save / Load (separate file)
       ═══════════════════════════════════════════════════════════════ */

    function _nafCollectPlanningConfig() {
        if (!_nafPlanCfg) return;

        // Upgrade Matrix
        const newMatrix = {};
        document.querySelectorAll('#nafSettingsUpgradeBody .naf-upgrade-row').forEach(row => {
            const grp = row.querySelector('[data-field="up-group"]')?.value?.trim().toUpperCase();
            if (!grp) return;
            const pref = (row.querySelector('[data-field="up-pref"]')?.value || '').split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
            const acei = (row.querySelector('[data-field="up-acei"]')?.value || '').split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
            const evit = (row.querySelector('[data-field="up-evit"]')?.value || '').split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
            newMatrix[grp] = { preferencial: pref, aceitavel: acei, evitar: evit };
        });
        _nafPlanCfg.upgrade_matrix = newMatrix;

        // Proximity Matrix
        const newProx = {};
        document.querySelectorAll('#nafSettingsDistancesBody input[data-from][data-to]').forEach(inp => {
            const from = inp.getAttribute('data-from');
            const to = inp.getAttribute('data-to');
            const val = parseFloat(inp.value);
            if (from && to && !isNaN(val) && val > 0) {
                if (!newProx[from]) newProx[from] = {};
                newProx[from][to] = val;
            }
        });
        _nafPlanCfg.proximity_matrix = newProx;

        // Station Open Groups
        const newOG = {};
        document.querySelectorAll('#nafSettingsOpenGroupsBody .naf-og-card').forEach(card => {
            const sid = card.getAttribute('data-station');
            if (!sid) return;
            const groups = [];
            card.querySelectorAll('.naf-og-tag').forEach(tag => {
                const g = tag.getAttribute('data-group');
                if (g) groups.push(g);
            });
            newOG[sid] = groups;
        });
        _nafPlanCfg.station_open_groups = newOG;

        // Parameters
        const params = _nafPlanCfg.parametros || {};
        const fld = (id, def) => { const el = document.getElementById(id); return el ? (parseFloat(el.value) || def) : def; };
        params.horizon_curto = fld('planParamHorizCurto', 3);
        params.horizon_medio = fld('planParamHorizMedio', 7);
        params.margem_daymin = fld('planParamMargem', 1);
        params.horizon_check_days = fld('planParamHorizCheck', 4);
        params.retomas_safety_margin = fld('planParamRetomas', 0.01);
        const notasEl = document.getElementById('planParamNotas');
        if (notasEl) params.notas_operacionais = notasEl.value.split('\n').map(s => s.trim()).filter(Boolean);

        // Cascade Families
        const cascEl = document.getElementById('planParamCascade');
        if (cascEl) {
            try {
                const parsed = JSON.parse(cascEl.value);
                if (Array.isArray(parsed)) _nafPlanCfg.cascade_families = parsed;
            } catch (e) { /* keep current */ }
        }
        _nafPlanCfg.parametros = params;
    }

    window.nafSettingsSavePlanningConfig = async function () {
        _nafCollectPlanningConfig();
        const statusEl = document.getElementById('nafSettingsStatus');
        try {
            const res = await fetch(API_BASE + '/api/planning-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: _nafPlanCfg })
            });
            const json = await res.json();
            if (json.success) {
                if (statusEl) { statusEl.textContent = "✓ Planning configuration saved"; statusEl.className = 'text-xs text-green-500'; statusEl.classList.remove('hidden'); }
            } else {
                if (statusEl) { statusEl.textContent = "✗ Error: " + (json.error || ''); statusEl.className = 'text-xs text-red-500'; statusEl.classList.remove('hidden'); }
            }
        } catch (e) {
            if (statusEl) { statusEl.textContent = "✗ Connection error"; statusEl.className = 'text-xs text-red-500'; statusEl.classList.remove('hidden'); }
        }
        setTimeout(() => { if (statusEl) statusEl.classList.add('hidden'); }, 4000);
    };

    /* ═══════════════════════════════════════════════════════════════
       RENDER: Free Upgrade Matrix
       ═══════════════════════════════════════════════════════════════ */

    function _nafSettingsRenderUpgrades() {
        const body = document.getElementById('nafSettingsUpgradeBody');
        if (!body || !_nafPlanCfg) return;
        const matrix = _nafPlanCfg.upgrade_matrix || {};
        const groups = Object.keys(matrix).sort();
        const countEl = document.getElementById('nafSettingsUpgradeCount');
        if (countEl) countEl.textContent = groups.length + " groups";

        const inputCls = 'w-full px-2 py-1 text-xs rounded bg-transparent border border-lynx-divider dark:border-gray-700 focus:border-primary-500 text-gray-700 dark:text-gray-300 font-mono';

        body.innerHTML = groups.map((grp, idx) => {
            const m = matrix[grp];
            return '<div class="naf-upgrade-row grid grid-cols-[80px_1fr_1fr_1fr_32px] gap-2 items-center border-b border-gray-50 dark:border-gray-800 pb-2">'
                + '<input type="text" data-field="up-group" value="' + nafEsc(grp) + '" class="px-2 py-1 text-xs rounded bg-lynx-subtle dark:bg-[#0A0A0A] border border-lynx-divider dark:border-gray-700 text-primary-500 font-mono font-bold text-center" readonly>'
                + "<div><label class=\"text-[0.55rem] text-green-400 font-semibold uppercase\">Preferred</label><input type=\"text\" data-field=\"up-pref\" value=\"" + nafEsc((m.preferencial || []).join(', ')) + '" class="' + inputCls + '" placeholder="EDMR, CDMR..."></div>'
                + "<div><label class=\"text-[0.55rem] text-yellow-400 font-semibold uppercase\">Acceptable</label><input type=\"text\" data-field=\"up-acei\" value=\"" + nafEsc((m.aceitavel || []).join(', ')) + '" class="' + inputCls + '" placeholder="CDAR, CFAR..."></div>'
                + "<div><label class=\"text-[0.55rem] text-red-400 font-semibold uppercase\">Avoid</label><input type=\"text\" data-field=\"up-evit\" value=\"" + nafEsc((m.evitar || []).join(', ')) + '" class="' + inputCls + '" placeholder="IFMR..."></div>'
                + '<button onclick="nafSettingsDeleteUpgrade(' + idx + ")\" class=\"text-red-400 hover:text-red-500 text-xs\" title=\"Remove\"><i class=\"fas fa-trash\"></i></button>"
                + '</div>';
        }).join('');
    }

    window.nafSettingsAddUpgrade = function () {
        if (!_nafPlanCfg) return;
        const grp = prompt("New group ACRISS code:");
        if (!grp || !grp.trim()) return;
        const code = grp.trim().toUpperCase();
        if (!_nafPlanCfg.upgrade_matrix) _nafPlanCfg.upgrade_matrix = {};
        if (_nafPlanCfg.upgrade_matrix[code]) { alert("Group already exists in the matrix!"); return; }
        _nafPlanCfg.upgrade_matrix[code] = { preferencial: [], aceitavel: [], evitar: [] };
        _nafSettingsRenderUpgrades();
    };

    window.nafSettingsDeleteUpgrade = function (idx) {
        if (!_nafPlanCfg || !_nafPlanCfg.upgrade_matrix) return;
        const groups = Object.keys(_nafPlanCfg.upgrade_matrix).sort();
        const grp = groups[idx];
        if (!grp || !confirm("Remove group " + grp + " from the matrix?")) return;
        delete _nafPlanCfg.upgrade_matrix[grp];
        _nafSettingsRenderUpgrades();
    };

    /* ═══════════════════════════════════════════════════════════════
       RENDER: Distance Matrix (Proximity)
       ═══════════════════════════════════════════════════════════════ */

    function _nafSettingsRenderDistances() {
        const body = document.getElementById('nafSettingsDistancesBody');
        if (!body || !_nafPlanCfg) return;
        const prox = _nafPlanCfg.proximity_matrix || {};

        // Get all station names from pools
        const stations = _nafSettingsCfg ? Object.keys(_nafSettingsCfg.stations || {}).sort() : [];
        const stationNames = _nafSettingsCfg ? _nafSettingsCfg.stations || {} : {};

        // Gather all stations mentioned in proximity_matrix too
        const proxStations = new Set();
        for (const from in prox) {
            proxStations.add(from);
            for (const to in prox[from]) proxStations.add(to);
        }

        // Use pool stations if available, otherwise use proximity keys
        let matrixStations = [];
        if (_nafSettingsCfg && _nafSettingsCfg.planning_pools) {
            const poolSids = new Set();
            _nafSettingsCfg.planning_pools.forEach(p => (p.stations || []).forEach(s => poolSids.add(s)));
            matrixStations = [...poolSids].sort();
        }
        if (!matrixStations.length) matrixStations = [...proxStations].sort();

        if (!matrixStations.length) {
            body.innerHTML = "<div class=\"text-xs text-gray-400 py-4\">Configure pools first to populate the station distance matrix.</div>";
            return;
        }

        const getName = (sid) => (stationNames[sid] || {}).nome || sid;
        const inputCls = 'w-16 px-1 py-0.5 text-xs text-center rounded bg-transparent border border-lynx-divider dark:border-gray-700 focus:border-primary-500 text-gray-700 dark:text-gray-300 font-mono';

        let html = '<table class="text-xs border-collapse"><thead><tr>';
        html += '<th class="px-2 py-1 text-[0.6rem] text-gray-400 sticky left-0 lynx-surface"></th>';
        matrixStations.forEach(sid => {
            html += '<th class="px-1 py-1 text-[0.55rem] text-gray-400 font-normal" style="writing-mode:vertical-rl;transform:rotate(180deg)">' + nafEsc(getName(sid)) + '</th>';
        });
        html += '</tr></thead><tbody>';

        matrixStations.forEach(from => {
            html += '<tr><td class="px-2 py-1 text-[0.6rem] font-semibold text-gray-300 sticky left-0 lynx-surface whitespace-nowrap">' + nafEsc(getName(from)) + '</td>';
            matrixStations.forEach(to => {
                if (from === to) {
                    html += '<td class="px-1 py-1 bg-lynx-subtle dark:bg-gray-800/50 text-center text-gray-400">—</td>';
                } else {
                    const val = (prox[from] || {})[to] || (prox[to] || {})[from] || '';
                    html += '<td class="px-1 py-1"><input type="text" data-from="' + nafEsc(from) + '" data-to="' + nafEsc(to) + '" value="' + (val || '') + '" class="' + inputCls + '" placeholder="km"></td>';
                }
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        body.innerHTML = html;
    }

    /* ═══════════════════════════════════════════════════════════════
       RENDER: Station Open Groups
       ═══════════════════════════════════════════════════════════════ */

    function _nafSettingsRenderOpenGroups() {
        const body = document.getElementById('nafSettingsOpenGroupsBody');
        if (!body || !_nafPlanCfg) return;
        const og = _nafPlanCfg.station_open_groups || {};

        // Get stations from pools
        let poolStations = [];
        if (_nafSettingsCfg && _nafSettingsCfg.planning_pools) {
            const seen = new Set();
            _nafSettingsCfg.planning_pools.forEach(p => (p.stations || []).forEach(s => { if (!seen.has(s)) { seen.add(s); poolStations.push(s); } }));
        }

        // Get all known ACRISS groups
        let allGroups = [];
        if (_nafSettingsCfg && _nafSettingsCfg.acriss_categories) {
            _nafSettingsCfg.acriss_categories.forEach(c => (c.groups || []).forEach(g => { if (!allGroups.includes(g)) allGroups.push(g); }));
        }
        if (!allGroups.length) allGroups = Object.keys(_nafPlanCfg.upgrade_matrix || {}).sort();

        const stationNames = _nafSettingsCfg ? _nafSettingsCfg.stations || {} : {};
        const getName = (sid) => (stationNames[sid] || {}).nome || sid;

        if (!poolStations.length) {
            body.innerHTML = "<div class=\"text-xs text-gray-400 py-4\">Configure pools first to view stations.</div>";
            return;
        }

        body.innerHTML = poolStations.map(sid => {
            const open = og[sid] || [];
            const isAll = open.length === 0;
            return '<div class="naf-og-card bg-lynx-subtle dark:bg-[#0A0A0A] rounded-lg border border-lynx-divider dark:border-gray-800 p-3" data-station="' + nafEsc(sid) + '">'
                + '<div class="flex items-center justify-between mb-2">'
                + '<span class="text-xs font-semibold text-white">' + nafEsc(getName(sid)) + ' <span class="text-gray-400 font-normal font-mono">(' + nafEsc(sid) + ')</span></span>'
                + '<span class="text-[0.55rem] ' + (isAll ? 'text-green-400' : 'text-purple-400') + '">' + (isAll ? "Accepts all" : open.length + " groups") + '</span>'
                + '</div>'
                + '<div class="flex flex-wrap gap-1">'
                + allGroups.map(g => {
                    const active = isAll || open.includes(g);
                    const cls = active ? 'bg-primary-500/20 text-primary-400 border-primary-500/30' : 'bg-gray-200/10 text-gray-500 border-gray-300/20';
                    return '<button class="naf-og-toggle text-[0.55rem] px-1.5 py-0.5 rounded border ' + cls + ' font-mono cursor-pointer hover:opacity-80 transition-opacity" data-group="' + nafEsc(g) + '" data-station="' + nafEsc(sid) + '" onclick="nafSettingsToggleOG(this)">' + nafEsc(g) + '</button>';
                }).join('')
                + '</div>'
                + '<div class="flex flex-wrap gap-1 mt-1 hidden">'
                + open.map(g => '<span class="naf-og-tag" data-group="' + nafEsc(g) + '"></span>').join('')
                + '</div>'
                + '</div>';
        }).join('');
    }

    window.nafSettingsToggleOG = function (btn) {
        if (!_nafPlanCfg) return;
        const sid = btn.getAttribute('data-station');
        const grp = btn.getAttribute('data-group');
        if (!sid || !grp) return;
        if (!_nafPlanCfg.station_open_groups) _nafPlanCfg.station_open_groups = {};
        let open = _nafPlanCfg.station_open_groups[sid];

        // If no entry or empty (=accepts all), initialize with all groups
        if (!open || open.length === 0) {
            let allGroups = [];
            if (_nafSettingsCfg && _nafSettingsCfg.acriss_categories) {
                _nafSettingsCfg.acriss_categories.forEach(c => (c.groups || []).forEach(g => { if (!allGroups.includes(g)) allGroups.push(g); }));
            }
            open = allGroups.slice();
        }

        const idx = open.indexOf(grp);
        if (idx >= 0) open.splice(idx, 1);
        else open.push(grp);

        _nafPlanCfg.station_open_groups[sid] = open;
        _nafSettingsRenderOpenGroups();
    };

    /* ═══════════════════════════════════════════════════════════════
       RENDER: Planning Parameters
       ═══════════════════════════════════════════════════════════════ */

    function _nafSettingsRenderPlanParams() {
        const body = document.getElementById('nafSettingsPlanParamsBody');
        if (!body || !_nafPlanCfg) return;
        const p = _nafPlanCfg.parametros || {};
        const cascade = _nafPlanCfg.cascade_families || [];

        const inputCls = 'w-20 px-2 py-1 text-xs rounded bg-lynx-subtle dark:bg-[#0A0A0A] border border-lynx-divider dark:border-gray-700 focus:border-primary-500 text-gray-700 dark:text-gray-300 font-mono text-center';

        let html = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">';

        // Parameter fields
        html += '<div class="space-y-3">';
        html += '<h4 class="text-xs font-semibold text-white mb-2"><i class="fas fa-cog text-orange-500 mr-1"></i> Horizontes Temporais</h4>';
        html += "<div class=\"flex items-center gap-3\"><label class=\"text-xs text-gray-400 w-40\">Short-Term Horizon (days)</label><input id=\"planParamHorizCurto\" type=\"number\" value=\"" + (p.horizon_curto || 3) + '" class="' + inputCls + '"></div>';
        html += "<div class=\"flex items-center gap-3\"><label class=\"text-xs text-gray-400 w-40\">Medium-Term Horizon (days)</label><input id=\"planParamHorizMedio\" type=\"number\" value=\"" + (p.horizon_medio || 7) + '" class="' + inputCls + '"></div>';
        html += "<div class=\"flex items-center gap-3\"><label class=\"text-xs text-gray-400 w-40\">Check Horizon (days)</label><input id=\"planParamHorizCheck\" type=\"number\" value=\"" + (p.horizon_check_days || 4) + '" class="' + inputCls + '"></div>';
        html += '</div>';

        html += '<div class="space-y-3">';
        html += "<h4 class=\"text-xs font-semibold text-white mb-2\"><i class=\"fas fa-shield-alt text-blue-500 mr-1\"></i> Safety Margins</h4>";
        html += "<div class=\"flex items-center gap-3\"><label class=\"text-xs text-gray-400 w-40\">Minimum Daily Margin</label><input id=\"planParamMargem\" type=\"number\" value=\"" + (p.margem_daymin || 1) + '" class="' + inputCls + '"></div>';
        html += "<div class=\"flex items-center gap-3\"><label class=\"text-xs text-gray-400 w-40\">Headroom Retomas</label><input id=\"planParamRetomas\" type=\"number\" step=\"0.01\" value=\"" + (p.retomas_safety_margin || 0.01) + '" class="' + inputCls + '"></div>';
        html += '</div>';

        html += '</div>';

        // Cascade Families (JSON editor)
        html += '<div class="mt-4">';
        html += "<h4 class=\"text-xs font-semibold text-white mb-2\"><i class=\"fas fa-layer-group text-purple-500 mr-1\"></i> Cascade Families <span class=\"text-gray-400 font-normal\">(JSON array of arrays; groups that cascade into one another)</span></h4>";
        html += '<textarea id="planParamCascade" rows="6" class="w-full px-3 py-2 text-xs rounded-lg bg-lynx-subtle dark:bg-[#0A0A0A] border border-lynx-divider dark:border-gray-700 focus:border-primary-500 text-gray-300 font-mono">' + nafEsc(JSON.stringify(cascade, null, 2)) + '</textarea>';
        html += '</div>';

        // Operational Notes
        html += '<div class="mt-4">';
        html += "<h4 class=\"text-xs font-semibold text-white mb-2\"><i class=\"fas fa-sticky-note text-yellow-500 mr-1\"></i> Operational Notes</h4>";
        html += "<textarea id=\"planParamNotas\" rows=\"4\" class=\"w-full px-3 py-2 text-xs rounded-lg bg-lynx-subtle dark:bg-[#0A0A0A] border border-lynx-divider dark:border-gray-700 focus:border-primary-500 text-gray-300\" placeholder=\"One note per line…\">" + nafEsc((p.notas_operacionais || []).join('\n')) + '</textarea>';
        html += '</div>';

        body.innerHTML = html;
    }

    // ══════════════════════════════════════════════════════════════
    // Users & Permissions Panel (owner only)
    // ══════════════════════════════════════════════════════════════
    // ── Brands (Marca/Modelo abbreviations) ──────────────────────
    let _renaBrandsData = null;  // { CODE: 'Display Name' }

    async function _renaBrandsRender() {
        const body = document.getElementById('renaBrandsBody');
        if (!body) return;
        body.innerHTML = "<tr><td colspan=\"3\" class=\"px-4 py-6 text-center text-gray-400 text-xs\">Loading…</td></tr>";
        try {
            const r = await fetch(API_BASE + '/api/brand-abbreviations');
            const json = await r.json();
            _renaBrandsData = (json && json.data) || {};
        } catch (e) {
            _renaBrandsData = {};
            body.innerHTML = "<tr><td colspan=\"3\" class=\"px-4 py-6 text-center text-red-400 text-xs\">Loading failed.</td></tr>";
            return;
        }
        _renaBrandsRenderRows();
    }

    function _renaBrandsRenderRows() {
        const body = document.getElementById('renaBrandsBody');
        const countEl = document.getElementById('renaBrandsCount');
        if (!body || !_renaBrandsData) return;
        const codes = Object.keys(_renaBrandsData).sort();
        if (countEl) countEl.textContent = codes.length + ' marca' + (codes.length === 1 ? '' : 's');
        body.innerHTML = codes.length ? codes.map(code => `
            <tr class="border-b border-gray-50 dark:border-gray-800/50">
                <td class="px-4 py-1.5"><input type="text" value="${nafEsc(code)}" onchange="renaBrandsRenameCode('${nafEsc(code)}', this.value)" class="w-28 text-xs font-mono uppercase px-2 py-1 rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-600 dark:text-gray-300"></td>
                <td class="px-4 py-1.5"><input type="text" value="${nafEsc(_renaBrandsData[code])}" onchange="renaBrandsSetName('${nafEsc(code)}', this.value)" class="w-56 text-xs px-2 py-1 rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 text-gray-600 dark:text-gray-300"></td>
                <td class="px-4 py-1.5 text-center"><button onclick="renaBrandsDelete('${nafEsc(code)}')" class="text-red-400 hover:text-red-500 text-xs" title="Remove"><i class="fas fa-trash"></i></button></td>
            </tr>`).join('') : "<tr><td colspan=\"3\" class=\"px-4 py-6 text-center text-gray-400 text-xs\">No manufacturers recorded.</td></tr>";
    }

    window.renaBrandsAdd = function () {
        const code = prompt("Source manufacturer code (e.g. VW):");
        if (!code || !code.trim()) return;
        const key = code.trim().toUpperCase();
        if (!_renaBrandsData) _renaBrandsData = {};
        if (_renaBrandsData[key] !== undefined) { alert("That code already exists."); return; }
        const name = prompt("Display name (ex: Volkswagen):", key.charAt(0) + key.slice(1).toLowerCase());
        if (!name || !name.trim()) return;
        _renaBrandsData[key] = name.trim();
        _renaBrandsRenderRows();
    };

    window.renaBrandsSetName = function (code, name) {
        if (!_renaBrandsData) return;
        _renaBrandsData[code] = name.trim();
    };

    window.renaBrandsRenameCode = function (oldCode, newCode) {
        if (!_renaBrandsData) return;
        const key = newCode.trim().toUpperCase();
        if (!key || key === oldCode) { _renaBrandsRenderRows(); return; }
        if (_renaBrandsData[key] !== undefined) { alert("That code already exists."); _renaBrandsRenderRows(); return; }
        _renaBrandsData[key] = _renaBrandsData[oldCode];
        delete _renaBrandsData[oldCode];
        _renaBrandsRenderRows();
    };

    window.renaBrandsDelete = function (code) {
        if (!_renaBrandsData || !confirm("Remove a marca \"" + code + '"?')) return;
        delete _renaBrandsData[code];
        _renaBrandsRenderRows();
    };

    window.renaBrandsSave = async function () {
        const statusEl = document.getElementById('renaBrandsStatus');
        try {
            const res = await fetch(API_BASE + '/api/brand-abbreviations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: _renaBrandsData || {} })
            });
            const json = await res.json();
            if (json.success) {
                if (typeof window.nafSetBrandMap === 'function') window.nafSetBrandMap(_renaBrandsData);
                if (typeof window.nafRenderTable === 'function' && window.NAF && NAF.filtered && NAF.filtered.length) nafRenderTable();
                if (statusEl) { statusEl.textContent = "✓ Saved successfully"; statusEl.className = 'px-4 pt-2 text-xs text-green-500'; statusEl.classList.remove('hidden'); }
            } else if (statusEl) {
                statusEl.textContent = "✗ Error: " + (json.error || ''); statusEl.className = 'px-4 pt-2 text-xs text-red-500'; statusEl.classList.remove('hidden');
            }
        } catch (e) {
            if (statusEl) { statusEl.textContent = "✗ Connection error"; statusEl.className = 'px-4 pt-2 text-xs text-red-500'; statusEl.classList.remove('hidden'); }
        }
        setTimeout(() => { if (statusEl) statusEl.classList.add('hidden'); }, 4000);
    };

    const _PAGE_LABELS = {
        dashboard: "Overview", fleet: "Fleet", history: "Fleet history",
        'island-blocking': "Island Transfers", rotation: 'Fleet Rotation',
        analytics: "Analytics", reservations: "Reservations", duplicados: "Duplicates",
        planning: "Planning", 'naf-stats': 'NAF Stats',
        settings: "Settings", 'ow-foreign': "Foreign One-Way",
        'match-vehicle': 'Vehicle Match', 'capacity-control': "Capacity & Slots",
    };
    let _renaPermData = null;  // {perms, all_pages}

    async function _renaUsersRender() {
        const body = document.getElementById('renaUsersBody');
        if (!body) return;
        body.innerHTML = "<tr><td colspan=\"5\" class=\"px-3 py-6 text-center text-gray-400 text-xs\">Loading…</td></tr>";
        try {
            const r = await fetch(API_BASE + '/api/permissions');
            if (!r.ok) { body.innerHTML = "<tr><td colspan=\"5\" class=\"px-3 py-6 text-center text-red-400 text-xs\">Permission denied.</td></tr>"; return; }
            _renaPermData = await r.json();
        } catch (e) { body.innerHTML = "<tr><td colspan=\"5\" class=\"px-3 py-6 text-center text-red-400 text-xs\">Loading failed.</td></tr>"; return; }
        _renaUsersRenderRows();
    }

    function _renaUsersRenderRows() {
        const body = document.getElementById('renaUsersBody');
        if (!body || !_renaPermData) return;
        const { perms, all_pages } = _renaPermData;
        const owner = perms.owner || 'demo';
        const users = perms.users || {};
        const defaultPages = perms.default_pages || ['dashboard'];

        const rows = Object.entries(users).map(([uname, entry]) => {
            const role = uname === owner ? 'owner' : (entry.role || 'user');
            const isOwner = role === 'owner';
            const isMod = role === 'mod';
            const isUser = !isOwner && !isMod;
            const displayName = entry.display_name || '';
            const userPages = entry.pages || defaultPages;

            const roleColor = isOwner ? 'text-yellow-500' : isMod ? 'text-green-500' : 'text-blue-400';
            const roleBg = isOwner ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' : isMod ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
            const roleLabel = isOwner ? 'Owner' : isMod ? 'Mod' : "User";

            const pagesHtml = isOwner || isMod
                ? "<span class=\"text-[0.6rem] text-gray-400 italic\">all pages</span>"
                : (all_pages || []).map(p => {
                    const has = userPages.includes(p);
                    return `<button onclick="renaTogglePage('${nafEsc(uname)}','${nafEsc(p)}')" title="${nafEsc(_PAGE_LABELS[p] || p)}"
                        class="text-[0.6rem] px-1.5 py-0.5 rounded border transition-colors ${has ? 'bg-primary-500/15 border-primary-400 text-primary-400' : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:border-gray-400'}">${nafEsc(_PAGE_LABELS[p] || p)}</button>`;
                }).join('');

            const actionHtml = isOwner ? '<span class="text-[0.6rem] text-gray-400">—</span>' : `
                <div class="flex items-center gap-1 justify-center">
                    <select onchange="renaSetRole('${nafEsc(uname)}',this.value)" class="text-[0.6rem] px-1.5 py-0.5 rounded border border-lynx-divider dark:border-gray-700 bg-transparent text-gray-600 dark:text-gray-300 focus:border-primary-500">
                        <option value="mod" ${isMod ? 'selected' : ''}>Mod</option>
                        <option value="user" ${isUser ? 'selected' : ''}>User</option>
                    </select>
                    <button onclick="renaDeleteUser('${nafEsc(uname)}')" class="text-red-400 hover:text-red-500 text-xs ml-1" title="Remove"><i class="fas fa-trash"></i></button>
                </div>`;

            return `<tr class="hover:bg-lynx-subtle dark:hover:bg-gray-800/30">
                <td class="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">${nafEsc(uname)}</td>
                <td class="px-3 py-2"><input type="text" value="${nafEsc(displayName)}" onblur="renaSetDisplayName('${nafEsc(uname)}',this.value)" placeholder="Name…" class="text-xs px-1.5 py-0.5 rounded bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 w-32 text-gray-600 dark:text-gray-300"></td>
                <td class="px-3 py-2"><span class="text-[0.6rem] font-semibold px-2 py-0.5 rounded-full border ${roleBg} ${roleColor}">${roleLabel}</span></td>
                <td class="px-3 py-2"><div class="flex flex-wrap gap-1">${pagesHtml}</div></td>
                <td class="px-3 py-2 text-center">${actionHtml}</td>
            </tr>`;
        });

        body.innerHTML = rows.length ? rows.join('') : "<tr><td colspan=\"5\" class=\"px-3 py-6 text-center text-gray-400 text-xs\">No users recorded.</td></tr>";
    }

    window.renaSettingsAddUser = async function () {
        const uname = prompt("New username (matching the Windows username):");
        if (!uname || !uname.trim()) return;
        const username = uname.trim().toLowerCase();
        if (!_renaPermData) return;
        if (_renaPermData.perms.users[username]) { alert("User already exists."); return; }
        await fetch(API_BASE + '/api/permissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: username, role: 'user', pages: _renaPermData.perms.default_pages || ['dashboard'] })
        });
        await _renaUsersRender();
    };

    window.renaSetRole = async function (username, role) {
        await fetch(API_BASE + '/api/permissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: username, role })
        });
        await _renaUsersRender();
    };

    window.renaSetDisplayName = async function (username, displayName) {
        await fetch(API_BASE + '/api/permissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: username, display_name: displayName })
        });
        if (_renaPermData && _renaPermData.perms.users[username]) {
            _renaPermData.perms.users[username].display_name = displayName;
        }
    };

    window.renaTogglePage = async function (username, page) {
        if (!_renaPermData) return;
        const entry = _renaPermData.perms.users[username] || {};
        const defaultPages = _renaPermData.perms.default_pages || ['dashboard'];
        let pages = entry.pages ? [...entry.pages] : [...defaultPages];
        if (pages.includes(page)) {
            if (page === 'dashboard') return;  // always required
            pages = pages.filter(p => p !== page);
        } else {
            pages.push(page);
        }
        await fetch(API_BASE + '/api/permissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: username, pages })
        });
        if (_renaPermData.perms.users[username]) _renaPermData.perms.users[username].pages = pages;
        _renaUsersRenderRows();
    };

    window.renaDeleteUser = async function (username) {
        if (!confirm("Remove o utilizador \"" + username + "\"? Access will be reset to the default user role.")) return;
        await fetch(API_BASE + '/api/permissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: username, action: 'delete' })
        });
        await _renaUsersRender();
    };

})();
