/* ══════════════ R.E.N.A. — Fleet Rotation Module ══════════════ */
(function () {
    'use strict';

    // ── CONFIG ──────────────────────────────────────────────────
    const API_BASE = '';   // same origin — Flask serves both API and static

    // ── MODULE STATE ────────────────────────────────────────────
    const ROT = {
        cargas       : [],
        estadoAtual  : null,       // null = Todas
        viaturasCarga: [],         // viaturas na criação de carga
        contadores   : {},
        filtrosAbertos: false,
        ccSelecionado: '',         // centro de custo selecionado ("CODIGO - NOME")
    };

    const ESTADOS = ["Pending", 'Requested', "Confirmed", "In Transit", "Completed", "Cancelled", "Split"];
    const ESTADO_CFG = {
        "Pending":  { icon: 'fa-clock',         color: 'yellow',  bg: 'bg-yellow-500/10',  text: 'text-yellow-500',  border: 'border-yellow-500/30' },
        'Requested':  { icon: 'fa-paper-plane',    color: 'blue',    bg: 'bg-blue-500/10',    text: 'text-blue-500',    border: 'border-blue-500/30' },
        "Confirmed":  { icon: 'fa-check-circle',   color: 'purple',  bg: 'bg-purple-500/10',  text: 'text-purple-500',  border: 'border-purple-500/30' },
        "In Transit": { icon: 'fa-truck-moving',   color: 'orange',  bg: 'bg-orange-500/10',  text: 'text-orange-500',  border: 'border-orange-500/30' },
        "Completed":   { icon: 'fa-check-double',   color: 'green',   bg: 'bg-green-500/10',   text: 'text-green-500',   border: 'border-green-500/30' },
        "Cancelled":   { icon: 'fa-times-circle',   color: 'red',     bg: 'bg-red-500/10',     text: 'text-red-500',     border: 'border-red-500/30' },
        "Split":    { icon: 'fa-code-branch',    color: 'teal',    bg: 'bg-teal-500/10',    text: 'text-teal-500',    border: 'border-teal-500/30' },
    };
    const URGENCIA_OPTS = ['Normal (48h)', "Urgent (24h)", "Very Urgent (Today)"];
    const MOTIVO_OPTS = ["Transfer", "Fleet Rebalancing", "Workshop", 'Defleet', 'Infleet', "Customer", "Other"];

    // ── HELPERS ─────────────────────────────────────────────────
    function _esc(s) { return typeof nafEsc === 'function' ? nafEsc(s) : String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }

    // ── GRUPO SEM MATRÍCULA ─────────────────────────────────────
    // A viatura pode ser adicionada por matrícula (como sempre) OU, quando
    // ainda não se sabe qual viatura exacta vai ser usada, só pelo código de
    // grupo ACRISS (ex: "FWAH") — nesse caso não se garante uma matrícula,
    // mostra-se antes um modelo de exemplo (o mais comum na frota para esse
    // grupo). Matrículas PT têm sempre dígitos (AA-00-AA); um código de grupo
    // não — por isso um token só de letras (1-4 caracteres) é tratado como
    // grupo em vez de matrícula, tal como o chatbot já faz.
    function _rotIsGroupToken(raw) {
        const t = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        return /^[A-Z]{1,4}$/.test(t);
    }

    async function _rotResolveGroup(grupo) {
        try {
            const json = await _api(`/api/rotation/group-lookup?grupo=${encodeURIComponent(grupo)}`);
            return json;
        } catch (e) {
            return { success: false, error: "Connection error" };
        }
    }

    // Gera uma matrícula sintética única (ex: "SEM-FWAH-1") para uma viatura
    // "sem matrícula" — mantém todas as funcionalidades existentes que usam
    // matricula como chave única (guias, adjudicações, checkboxes) a
    // funcionar sem alterações, mesmo havendo várias placeholders do mesmo
    // grupo na mesma carga.
    function _rotMakeSemMatricula(existingList, grupo) {
        let n = 1;
        let id;
        do {
            id = `SEM-${grupo}-${n}`;
            n++;
        } while (existingList.some(v => v.matricula === id));
        return id;
    }

    // Label a mostrar ao utilizador em vez da matrícula — devolve texto puro
    // (por escapar no ponto de interpolação, tal como o resto do ficheiro).
    function _rotViaturaLabel(v) {
        if (!v) return '';
        if (v.sem_matricula) return `Group ${v.grupo || v.acriss || '?'} — unassigned`;
        return v.matricula || '';
    }

    function _currentUser() {
        const el = document.getElementById('sidebarUsername');
        const txt = el ? (el.textContent || '').trim() : '';
        if (txt && txt !== '—') return txt;
        return 'utilizador';
    }

    function _getStationInfo(code) {
        if (!code || code === 'OUTRO') return { code: 'OUTRO', nome: "Other", zona: '' };
        const cfg = window.NAF_STATION_CFG || {};
        const s = (cfg.stations || {})[code];
        if (!s) return { code, nome: code, zona: '' };
        return { code, nome: s.nome || code, zona: s.zona || '' };
    }

    function _stationsTransporteHtml(selectedCode) {
        const cfg = window.NAF_STATION_CFG || {};
        const stations = cfg.stations || {};
        // Only stations with transporte=true; group by tipo (Parque, Estação, Agente)
        const transp = Object.entries(stations)
            .filter(([, s]) => s && s.transporte === true && (s.tipo === "Station" || s.tipo === "Parking" || s.tipo === "Agent"))
            .map(([code, s]) => ({ code, nome: s.nome || code, zona: s.zona || '', tipo: s.tipo }));

        const parques  = transp.filter(s => s.tipo === "Parking").sort((a, b) => a.nome.localeCompare(b.nome));
        const estacoes = transp.filter(s => s.tipo === "Station").sort((a, b) => a.nome.localeCompare(b.nome));
        const agentes  = transp.filter(s => s.tipo === "Agent").sort((a, b) => a.nome.localeCompare(b.nome));

        let html = "<option value=\"\">— Select a station —</option>";

        const addGroup = (label, list) => {
            if (!list.length) return;
            html += `<optgroup label="${_esc(label)}">`;
            list.forEach(s => {
                const lbl = `${s.nome} (${s.code})`;
                html += `<option value="${_esc(s.code)}"${s.code === selectedCode ? ' selected' : ''}>${_esc(lbl)}</option>`;
            });
            html += '</optgroup>';
        };

        addGroup("Parking Sites", parques);
        addGroup("Stations", estacoes);
        addGroup("Agents", agentes);

        html += `<option value="OUTRO"${selectedCode === 'OUTRO' ? ' selected' : ''}>— Other (manual address) —</option>`;
        return html;
    }

    function _stationLabel(code) {
        if (!code) return '—';
        const info = _getStationInfo(code);
        return info.nome + (info.zona ? ` (${info.zona})` : '');
    }

    function _formatDate(iso) {
        return _esc(window.renaFormatDate(iso, true));
    }
    function _formatDateTime(iso) {
        return _esc(window.renaFormatDate(iso));
    }

    function _timeAgo(iso) {
        if (!iso) return '';
        const diff = Date.now() - new Date(iso).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h`;
        return `${Math.floor(hrs / 24)}d`;
    }

    // ── API calls ───────────────────────────────────────────────
    async function _api(url, opts) {
        const res = await fetch(API_BASE + url, opts);
        const json = await res.json();
        if (res.status === 403 && json.access_error) {
            const banner = document.getElementById('rotNoAccessBanner');
            const msg    = document.getElementById('rotNoAccessMsg');
            if (banner) banner.classList.remove('hidden');
            if (msg)    msg.textContent = json.access_error;
        }
        return json;
    }

    // ── OUTRO TOGGLE ────────────────────────────────────────────
    window.rotToggleOutro = function (tipo) {
        const sel = document.getElementById(tipo === 'origem' ? 'rotEstacaoOrigem' : 'rotEstacaoDestino');
        const grp = document.getElementById(tipo === 'origem' ? 'rotOutroOrigem' : 'rotOutroDestino');
        if (!sel || !grp) return;
        if (sel.value === 'OUTRO') {
            grp.classList.remove('hidden');
        } else {
            grp.classList.add('hidden');
            const inp = grp.querySelector('input');
            if (inp) inp.value = '';
        }
        rotUpdateViaturas();
    };

    function _resolveStation(tipo) {
        const sel = document.getElementById(tipo === 'origem' ? 'rotEstacaoOrigem' : 'rotEstacaoDestino');
        const code = sel?.value || '';
        if (code === 'OUTRO') {
            const inp = document.getElementById(tipo === 'origem' ? 'rotOutroOrigemInput' : 'rotOutroDestinoInput');
            const custom = (inp?.value || '').trim();
            return { code: 'OUTRO', nome: custom || "Other", zona: '' };
        }
        return _getStationInfo(code);
    }

    // ── CENTRO DE CUSTO SELECTOR ────────────────────────────────
    window.rotSelecionarCC = function () {
        const cfg = window.NAF_STATION_CFG || {};
        const ccs = cfg.centros_custo || [];
        if (ccs.length === 0) {
            _toast("No cost centers configured. Add them in Settings.", 'warning');
            return;
        }

        const modal = document.getElementById('rotGenericModal');
        const title = document.getElementById('rotModalTitle');
        const body = document.getElementById('rotModalBody');
        if (!modal) return;

        title.textContent = "Select Cost Center";
        body.innerHTML = `
            <div class="space-y-3">
                <input id="rotCcSearch" type="text" oninput="rotFilterCC()" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary" placeholder="Search CC..." autofocus>
                <div id="rotCcList" class="space-y-1 max-h-64 overflow-y-auto">
                    ${ccs.map(cc => {
                        const tipo = cc.tipo || '';
                        const tipoBadge = tipo
                            ? `<span class="ml-auto text-[0.6rem] px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-500">${_esc(tipo)}</span>`
                            : '';
                        return `
                        <button onclick="rotEscolherCC('${_esc(cc.codigo)}','${_esc(cc.nome)}')"
                            class="rotCcItem w-full flex items-center gap-2 text-left px-3 py-2 text-sm rounded-lg hover:bg-primary-500/10 dark:hover:bg-primary-500/10 border border-transparent hover:border-primary-500/30 transition-colors"
                            data-search="${_esc((cc.codigo + ' ' + cc.nome + ' ' + tipo).toLowerCase())}">
                            <span class="font-mono font-semibold text-primary-500">${_esc(cc.codigo)}</span>
                            <span class="text-gray-500 dark:text-gray-400">${_esc(cc.nome)}</span>
                            ${tipoBadge}
                        </button>`;
                    }).join('')}
                </div>
                <div class="flex justify-between pt-3">
                    <button onclick="rotEscolherCC('','')" class="px-4 py-2 text-sm rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
                        <i class="fas fa-times mr-1"></i>Clear CC
                    </button>
                    <button onclick="rotCloseModal()" class="px-4 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                </div>
            </div>`;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => document.getElementById('rotCcSearch')?.focus(), 100);
    };

    window.rotFilterCC = function () {
        const q = (document.getElementById('rotCcSearch')?.value || '').toLowerCase();
        document.querySelectorAll('.rotCcItem').forEach(el => {
            el.style.display = !q || el.getAttribute('data-search').includes(q) ? '' : 'none';
        });
    };

    window.rotEscolherCC = function (codigo, nome) {
        if (codigo && nome) {
            ROT.ccSelecionado = codigo + ' - ' + nome;
        } else {
            ROT.ccSelecionado = '';
        }
        const input = document.getElementById('rotCentroCusto');
        if (input) input.value = ROT.ccSelecionado;
        rotCloseModal();
    };

    // ── AUTO-REFRESH ─────────────────────────────────────────────
    let _refreshTimer = null;
    const _REFRESH_MS  = 20000; // 20 seconds

    function _fingerprintCargas(cargas) {
        return (cargas || [])
            .map(c => `${c.referencia}|${c.estado}|${c.data_atualizacao || ''}`)
            .sort()
            .join('~');
    }

    function _setRefreshIndicator(state, ts) {
        const el = document.getElementById('rotRefreshIndicator');
        if (!el) return;
        const t = ts || window.renaFormatDate(new Date());
        if (state === 'updated') {
            el.innerHTML = `<span class="text-green-500 font-medium"><i class="fas fa-sync-alt mr-1"></i>Updated ${t}</span>`;
            setTimeout(() => _setRefreshIndicator('idle', t), 3000);
        } else if (state === 'idle') {
            el.innerHTML = `<span class="text-gray-400"><i class="fas fa-circle text-[7px] mr-1 align-middle"></i>Live · ${t}</span>`;
        }
    }

    async function _silentRefresh() {
        // Skip if Ver panel not visible
        if (document.getElementById('rotPanelVer')?.classList.contains('hidden')) return;
        // Skip if user is actively typing in search
        if (document.activeElement?.id === 'rotSearchInput') return;
        // Skip if any modal overlay is open
        if (document.querySelector('[id$="ModalOverlay"]:not([style*="none"])')) return;

        try {
            const url = '/api/rotation/cargas' +
                (ROT.estadoAtual ? '?estado=' + encodeURIComponent(ROT.estadoAtual) : '');
            const json = await _api(url);
            if (!json.success) return;

            const oldPrint = _fingerprintCargas(ROT.cargas);
            const newPrint = _fingerprintCargas(json.cargas);
            if (oldPrint === newPrint) {
                _setRefreshIndicator('idle');
                return;
            }

            // Preserve scroll position
            const container = document.getElementById('rotCargasContainer');
            const scrollY = container ? container.scrollTop : 0;

            ROT.cargas = json.cargas;
            // Re-apply current search — preserves search text and state filter
            rotPesquisar();

            if (container) container.scrollTop = scrollY;

            // Update KPI counters silently
            _loadContadores();
            _setRefreshIndicator('updated');
        } catch (_) { /* silent — background task */ }
    }

    function _startAutoRefresh() {
        if (_refreshTimer) clearInterval(_refreshTimer);
        _setRefreshIndicator('idle');
        _refreshTimer = setInterval(_silentRefresh, _REFRESH_MS);
    }

    // ── INIT ────────────────────────────────────────────────────
    window.nafInitRotation = async function () {
        // Populate station dropdowns
        const selOrigem = document.getElementById('rotEstacaoOrigem');
        const selDestino = document.getElementById('rotEstacaoDestino');
        if (selOrigem) selOrigem.innerHTML = _stationsTransporteHtml('');
        if (selDestino) selDestino.innerHTML = _stationsTransporteHtml('');

        // Reset CC
        ROT.ccSelecionado = '';
        const ccInput = document.getElementById('rotCentroCusto');
        if (ccInput) ccInput.value = '';

        await _loadCargas();
        _loadContadores();
        _renderRotasRecentes();
        _startAutoRefresh();
    };

    // ── LOAD CARGAS ─────────────────────────────────────────────
    async function _loadCargas(estado) {
        try {
            let url = '/api/rotation/cargas';
            if (estado) url += '?estado=' + encodeURIComponent(estado);
            const json = await _api(url);
            if (json.success) {
                ROT.cargas = json.cargas;
                _renderCargas();
            }
        } catch (e) {
            console.error('Rotation: load error', e);
        }
    }

    // ── CONTADORES ──────────────────────────────────────────────
    async function _loadContadores() {
        try {
            const json = await _api('/api/rotation/stats');
            if (json.success) {
                ROT.contadores = json.por_estado || {};
                _renderContadores();
            }
        } catch (e) { /* silent */ }
    }

    function _renderContadores() {
        ESTADOS.forEach(est => {
            const el = document.getElementById('rotCount_' + est.replace(/\s/g, '_'));
            if (el) el.textContent = ROT.contadores[est] || 0;
        });
        const totalEl = document.getElementById('rotCountTotal');
        if (totalEl) {
            const ACTIVE_ESTADOS = ["Pending", 'Requested', "Confirmed", "In Transit"];
            const total = ACTIVE_ESTADOS.reduce((a, e) => a + (ROT.contadores[e] || 0), 0);
            totalEl.textContent = total;
        }
    }

    // ── TAB SWITCH (Criar / Ver Cargas) ─────────────────────────
    window.rotSwitchTab = function (tab) {
        const criar     = document.getElementById('rotTabCriar');
        const ver       = document.getElementById('rotTabVer');
        const stats     = document.getElementById('rotTabStats');
        const panelCriar  = document.getElementById('rotPanelCriar');
        const panelVer    = document.getElementById('rotPanelVer');
        const panelStats  = document.getElementById('rotPanelStats');
        if (!criar || !ver) return;
        const active   = 'border-primary-500 text-primary-500';
        const inactive = 'border-transparent text-gray-400 hover:text-primary-500';
        // Reset all tabs/panels
        criar.className = `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${inactive}`;
        ver.className   = `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${inactive}`;
        if (stats) stats.className = `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${inactive}`;
        [panelCriar, panelVer, panelStats].forEach(p => p && p.classList.add('hidden'));

        if (tab === 'criar') {
            criar.className = `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${active}`;
            if (panelCriar) panelCriar.classList.remove('hidden');
            _renderRotasRecentes();
        } else if (tab === 'stats') {
            if (stats) stats.className = `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${active}`;
            if (panelStats) panelStats.classList.remove('hidden');
            _renderStatsPanel();
        } else {
            ver.className = `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${active}`;
            if (panelVer) panelVer.classList.remove('hidden');
            _loadCargas(ROT.estadoAtual);
            _loadContadores();
            _setRefreshIndicator('idle');
        }
    };

    // ── ESTADO FILTER ───────────────────────────────────────────
    window.rotFiltrarEstado = function (estado) {
        ROT.estadoAtual = estado || null;
        // Highlight KPI active
        document.querySelectorAll('.rot-kpi').forEach(btn => {
            const e = btn.getAttribute('data-estado') || '';
            const isActive = (estado || '') === e;
            btn.classList.toggle('ring-2', isActive);
            btn.classList.toggle('ring-primary-500', isActive);
            btn.classList.toggle('shadow-md', isActive);
        });
        // Show filter label
        const lbl = document.getElementById('rotEstadoFiltroLabel');
        if (lbl) {
            if (estado) {
                lbl.textContent = `Filtered by status: ${estado}`;
                lbl.classList.remove('hidden');
            } else {
                lbl.classList.add('hidden');
            }
        }
        // Switch to "Ver" panel and load
        if (document.getElementById('rotPanelVer')?.classList.contains('hidden')) {
            rotSwitchTab('ver');
        } else {
            _loadCargas(ROT.estadoAtual);
        }
    };

    // ── SEARCH ──────────────────────────────────────────────────
    window.rotPesquisar = function () {
        const q = (document.getElementById('rotSearchInput')?.value || '').toLowerCase();
        // When not in the Concluído state view, exclude Concluídas from search results
        const base = ROT.estadoAtual === "Completed"
            ? ROT.cargas
            : ROT.cargas.filter(c => c.estado !== "Completed");
        if (!q) { _renderCargaList(base); return; }
        const filtered = base.filter(c =>
            c.referencia?.toLowerCase().includes(q) ||
            c.zona_origem?.toLowerCase().includes(q) ||
            c.zona_destino?.toLowerCase().includes(q) ||
            (c.estacao_origem_nome || '').toLowerCase().includes(q) ||
            (c.estacao_destino_nome || '').toLowerCase().includes(q) ||
            (c.viaturas || []).some(v => v.matricula?.toLowerCase().includes(q)) ||
            (c.adjudicacoes || []).some(a => (a.transportador || '').toLowerCase().includes(q)) ||
            (c.motivo || '').toLowerCase().includes(q)
        );
        _renderCargaList(filtered);
    };

    // ── ADD VIATURA TO CARGA ────────────────────────────────────
    window.rotAddViatura = async function () {
        const input = document.getElementById('rotMatriculaInput');
        const raw = (input?.value || '').trim();
        if (!raw) return;

        // "Só grupo" — ainda não se sabe a matrícula exacta, só o grupo ACRISS.
        if (_rotIsGroupToken(raw)) {
            const grupo = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const res = await _rotResolveGroup(grupo);
            if (!res.success) {
                _toast(res.error || "Unknown group", 'error');
                return;
            }
            const top = res.top_model;
            ROT.viaturasCarga.push({
                matricula: _rotMakeSemMatricula(ROT.viaturasCarga, grupo),
                sem_matricula: true,
                grupo,
                descricao: top ? `${top.brand} ${top.model} (viatura similar)` : `Group ${grupo} (no example available)`,
                marca: top ? top.brand : '',
                modelo: top ? top.model : '',
                acriss: grupo,
                categoria: '',
                branch: '', branchCode: '',
                urgencia: document.getElementById('rotUrgencia')?.value || 'Normal (48h)',
                motivo: document.getElementById('rotMotivo')?.value || "Transfer",
                centro_custo: ROT.ccSelecionado || '',
            });
            if (input) { input.value = ''; input.focus(); }
            _renderViaturasCarga();
            return;
        }

        const mat = raw.toUpperCase().replace(/[^A-Z0-9\-]/g, '').trim();
        if (!mat) return;
        if (ROT.viaturasCarga.some(v => v.matricula === mat)) {
            _toast("License plate already added", 'warning');
            return;
        }
        // Warn if vehicle is already in another active carga
        const matNorm = mat.replace(/[^A-Z0-9]/g, '');
        const activeCargaWithPlate = (ROT.cargas || []).find(c =>
            !["Completed", "Cancelled"].includes(c.estado) &&
            (c.viaturas || []).some(v => (v.matricula || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === matNorm)
        );
        if (activeCargaWithPlate) {
            _toast(`Attention: ${mat} is already in load ${activeCargaWithPlate.referencia} (${activeCargaWithPlate.estado})`, 'warning');
        }
        let info = {};
        const rawData = (window.NAF && window.NAF.rawData) || [];
        if (rawData.length) {
            const found = rawData.find(v => (v.licensePlate || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === mat.replace(/[^A-Z0-9]/g, ''));
            if (found) {
                info = {
                    descricao: found.displayName || `${found.make || ''} ${found.model || ''}`.trim() || '',
                    marca: found.make || '',
                    modelo: found.model || '',
                    acriss: (found.acrissCode || '').substring(0, 4),
                    categoria: found.vehicleCategory || '',
                    branch: (found.branch && found.branch.name) || '',
                    branchCode: (found.branch && found.branch.number) || '',
                };
            }
        }

        if (!info.descricao) {
            _toast("License plate not found in the demo; added without vehicle details", 'warning');
        }

        ROT.viaturasCarga.push({
            matricula: mat,
            sem_matricula: false,
            grupo: '',
            descricao: info.descricao || '',
            marca: info.marca || '',
            modelo: info.modelo || '',
            acriss: info.acriss || '',
            categoria: info.categoria || '',
            branch: info.branch || '',
            branchCode: info.branchCode || '',
            urgencia: document.getElementById('rotUrgencia')?.value || 'Normal (48h)',
            motivo: document.getElementById('rotMotivo')?.value || "Transfer",
            centro_custo: ROT.ccSelecionado || '',
        });
        if (input) { input.value = ''; input.focus(); }
        _renderViaturasCarga();
    };

    window.rotRemoverViatura = function (idx) {
        ROT.viaturasCarga.splice(idx, 1);
        _renderViaturasCarga();
    };

    // Re-render viaturas when header fields change
    window.rotUpdateViaturas = function () {
        if (ROT.viaturasCarga.length) _renderViaturasCarga();
    };

    function _renderViaturasCarga() {
        const tbody = document.getElementById('rotViaturasBody');
        const badge = document.getElementById('rotViaturasCount');
        if (!tbody) return;
        if (badge) badge.textContent = ROT.viaturasCarga.length;

        if (ROT.viaturasCarga.length === 0) {
            tbody.innerHTML = "<tr><td colspan=\"11\" class=\"py-8 text-center text-gray-400 text-sm\">No vehicles added. Use the field above to add one.</td></tr>";
            return;
        }

        // Get current header station/date selections for display
        const origemInfo = _resolveStation('origem');
        const destinoInfo = _resolveStation('destino');
        const origemLabel = origemInfo.code && origemInfo.code !== 'OUTRO' ? `${origemInfo.nome} (${origemInfo.code})` : (origemInfo.nome || '—');
        const destinoLabel = destinoInfo.code && destinoInfo.code !== 'OUTRO' ? `${destinoInfo.nome} (${destinoInfo.code})` : (destinoInfo.nome || '—');
        const dataLev = document.getElementById('rotDataLev')?.value || '';
        const dataDes = document.getElementById('rotDataDes')?.value || '';

        // CC options for per-vehicle CC selector
        const cfg = window.NAF_STATION_CFG || {};
        const ccs = cfg.centros_custo || [];

        tbody.innerHTML = ROT.viaturasCarga.map((v, i) => {
            const urgColor = v.urgencia.includes("Very") ? 'text-red-500' : v.urgencia.includes("Urgent") ? 'text-yellow-500' : 'text-green-500';
            const ccDisplay = v.centro_custo || '<span class="italic text-gray-400">—</span>';
            return `
            <tr class="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 text-xs">
                <td class="py-2 px-3">
                    <span class="inline-block w-2 h-2 rounded-full ${v.sem_matricula ? 'bg-amber-400' : (v.descricao ? 'bg-green-500' : 'bg-red-500')} mr-1"></span>
                    <span class="font-mono font-bold ${v.sem_matricula ? 'text-amber-500' : 'text-primary-500'}">${_esc(_rotViaturaLabel(v))}</span>
                </td>
                <td class="py-2 px-3 text-gray-500 dark:text-gray-400 max-w-[150px] truncate" title="${_esc(v.descricao)}">${_esc(v.descricao) || '<span class="italic text-gray-400">N/A</span>'}</td>
                <td class="py-2 px-3 text-center"><span class="font-mono bg-lynx-subtle dark:bg-gray-700 px-1.5 py-0.5 rounded text-[0.6rem]">${_esc(v.acriss) || '—'}</span></td>
                <td class="py-2 px-3 text-gray-500 max-w-[120px] truncate" title="${_esc(origemLabel)}">${_esc(origemLabel)}</td>
                <td class="py-2 px-3 text-center text-gray-500">${dataLev ? _formatDate(dataLev) : 'N/A'}</td>
                <td class="py-2 px-3 text-gray-500 max-w-[120px] truncate" title="${_esc(destinoLabel)}">${_esc(destinoLabel)}</td>
                <td class="py-2 px-3 text-center text-gray-500">${dataDes ? _formatDate(dataDes) : 'N/A'}</td>
                <td class="py-2 px-3">
                    <select onchange="ROT_viaturasCarga[${i}].urgencia=this.value" class="text-[0.6rem] bg-transparent border border-lynx-divider dark:border-gray-700 rounded px-1.5 py-0.5 ${urgColor}">
                        ${URGENCIA_OPTS.map(opt => `<option value="${opt}"${v.urgencia === opt ? ' selected' : ''}>${opt}</option>`).join('')}
                    </select>
                </td>
                <td class="py-2 px-3">
                    <select onchange="ROT_viaturasCarga[${i}].motivo=this.value" class="text-[0.6rem] bg-transparent border border-lynx-divider dark:border-gray-700 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300">
                        ${MOTIVO_OPTS.map(opt => `<option value="${opt}"${v.motivo === opt ? ' selected' : ''}>${opt}</option>`).join('')}
                    </select>
                </td>
                <td class="py-2 px-3 max-w-[120px] truncate text-gray-500" title="${_esc(v.centro_custo || '')}">${ccDisplay}</td>
                <td class="py-2 px-3 text-center">
                    <button onclick="rotRemoverViatura(${i})" class="text-red-400 hover:text-red-500 transition-colors" title="Remove">
                        <i class="fas fa-times text-xs"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');
    }
    // Expose for inline select change
    window.ROT_viaturasCarga = ROT.viaturasCarga;

    // ── CRIAR CARGA ─────────────────────────────────────────────
    window.rotCriarCarga = async function () {
        const estOrigem = document.getElementById('rotEstacaoOrigem')?.value;
        const estDestino = document.getElementById('rotEstacaoDestino')?.value;
        const dataLev = document.getElementById('rotDataLev')?.value;
        const dataDes = document.getElementById('rotDataDes')?.value;
        const urgencia = document.getElementById('rotUrgencia')?.value || 'Normal (48h)';
        const motivo = document.getElementById('rotMotivo')?.value || "Transfer";
        const obs = document.getElementById('rotObservacoes')?.value || '';

        if (!estOrigem || !estDestino) { _toast("Select origin and destination stations", 'error'); return; }
        if (estOrigem === estDestino && estOrigem !== 'OUTRO') { _toast("Origin and destination must be different", 'error'); return; }
        if (ROT.viaturasCarga.length === 0) { _toast("Add at least one vehicle", 'error'); return; }

        // Validate Outro text inputs
        if (estOrigem === 'OUTRO') {
            const txt = (document.getElementById('rotOutroOrigemInput')?.value || '').trim();
            if (!txt) { _toast("Enter the pickup address (Other)", 'error'); return; }
        }
        if (estDestino === 'OUTRO') {
            const txt = (document.getElementById('rotOutroDestinoInput')?.value || '').trim();
            if (!txt) { _toast("Enter the delivery address (Other)", 'error'); return; }
        }

        // Validate CC on all vehicles
        const semCC = ROT.viaturasCarga.some(v => !v.centro_custo);
        if (semCC) { _toast("Every vehicle needs a cost center. Select one before adding vehicles.", 'error'); return; }

        // Resolve station info (handles Outro)
        const origemInfo = _resolveStation('origem');
        const destinoInfo = _resolveStation('destino');

        const btn = document.getElementById('rotBtnCriar');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>A criar...'; }

        try {
            const user = _currentUser();
            const json = await _api('/api/rotation/cargas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    zona_origem: origemInfo.zona || origemInfo.nome,
                    zona_destino: destinoInfo.zona || destinoInfo.nome,
                    estacao_origem: estOrigem === 'OUTRO' ? 'OUTRO' : estOrigem,
                    estacao_destino: estDestino === 'OUTRO' ? 'OUTRO' : estDestino,
                    estacao_origem_nome: origemInfo.nome,
                    estacao_destino_nome: destinoInfo.nome,
                    data_levantamento: dataLev,
                    data_entrega: dataDes,
                    motivo, urgencia, observacoes: obs,
                    utilizador: user,
                    viaturas: ROT.viaturasCarga
                })
            });

            if (json.success) {
                _toast(`Load ${json.referencia} created successfully!`, 'success');
                ROT.viaturasCarga.length = 0;
                ROT.ccSelecionado = '';
                _renderViaturasCarga();
                // Reset form
                ['rotEstacaoOrigem', 'rotEstacaoDestino'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                });
                ['rotDataLev', 'rotDataDes', 'rotObservacoes', 'rotCentroCusto', 'rotOutroOrigemInput', 'rotOutroDestinoInput'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                });
                // Hide outro fields
                ['rotOutroOrigem', 'rotOutroDestino'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hidden');
                });
                // Switch to ver tab
                rotSwitchTab('ver');
            } else {
                _toast("Error: " + (json.error || 'desconhecido'), 'error');
            }
        } catch (e) {
            _toast("Could not connect to the server", 'error');
        }
        if (btn) { btn.disabled = false; btn.innerHTML = "<i class=\"fas fa-truck-loading mr-2\"></i> Create Load"; }
    };

    // ── ROTAS RECENTES ──────────────────────────────────────────
    function _renderRotasRecentes() {
        const container = document.getElementById('rotRotasRecentes');
        const chips     = document.getElementById('rotRotasChips');
        if (!container || !chips) return;
        const seen   = new Set();
        const routes = [];
        [...(ROT.cargas || [])]
            .filter(c => c.estado !== "Cancelled" && c.estacao_origem && c.estacao_destino)
            .sort((a, b) => ((b.data_criacao || '') > (a.data_criacao || '') ? 1 : -1))
            .forEach(c => {
                const key = `${c.estacao_origem}|${c.estacao_destino}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    routes.push({
                        origemCode:  c.estacao_origem,
                        destinoCode: c.estacao_destino,
                        origemNome:  c.estacao_origem_nome || c.zona_origem || c.estacao_origem,
                        destinoNome: c.estacao_destino_nome || c.zona_destino || c.estacao_destino,
                    });
                }
            });
        const recent = routes.slice(0, 5);
        if (recent.length === 0) { container.classList.add('hidden'); return; }
        container.classList.remove('hidden');
        chips.innerHTML = recent.map(r =>
            `<button onclick="rotAplicarRota('${_esc(r.origemCode)}','${_esc(r.destinoCode)}')"
                class="text-[0.65rem] px-2.5 py-1 rounded-full bg-primary-500/10 text-primary-500 hover:bg-primary-500/20 transition-colors font-medium border border-primary-500/20">
                ${_esc(r.origemNome)} → ${_esc(r.destinoNome)}
            </button>`
        ).join('');
    }

    window.rotAplicarRota = function (origemCode, destinoCode) {
        const selOrig = document.getElementById('rotEstacaoOrigem');
        const selDest = document.getElementById('rotEstacaoDestino');
        if (selOrig && origemCode) { selOrig.value = origemCode; rotToggleOutro('origem'); }
        if (selDest && destinoCode) { selDest.value = destinoCode; rotToggleOutro('destino'); }
        rotUpdateViaturas();
    };

    // ── ESTATÍSTICAS ────────────────────────────────────────────
    function _renderStatsPanel() {
        const el = document.getElementById('rotStatsContent');
        if (!el) return;
        const cargas = ROT.cargas || [];
        const today  = new Date(); today.setHours(0,0,0,0);
        const in7d   = new Date(today); in7d.setDate(in7d.getDate() + 7);

        // ── Estado counts ────────────────────────────────────────
        const ESTADOS_ALL = ["Pending",'Requested',"Confirmed","In Transit","Completed","Cancelled","Split"];
        const estadoCounts = {};
        ESTADOS_ALL.forEach(e => estadoCounts[e] = 0);
        cargas.forEach(c => { estadoCounts[c.estado] = (estadoCounts[c.estado] || 0) + 1; });

        // ── Operacional em tempo real ────────────────────────────
        const emTransito = cargas.filter(c => c.estado === "In Transit");
        const viaturasEmTransito = emTransito.reduce((s, c) => s + (c.num_viaturas || (c.viaturas || []).length), 0);
        const atrasadas   = emTransito.filter(c => c.data_entrega && new Date(c.data_entrega) < today);
        const iminentes   = emTransito.filter(c => c.data_entrega && new Date(c.data_entrega) >= today && new Date(c.data_entrega) <= in7d);
        const porEnviar   = cargas.filter(c => c.estado === "Pending");
        // Concluded this month
        const thisMonth   = today.getMonth();
        const thisYear    = today.getFullYear();
        const concMes     = cargas.filter(c => c.estado === "Completed" && (c.data_atualizacao || c.data_entrega || c.data_criacao) && (() => { const d = new Date(c.data_atualizacao || c.data_entrega || c.data_criacao); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; })());
        const concMesViaturas  = concMes.reduce((s, c) => s + (c.num_viaturas || (c.viaturas || []).length), 0);
        const concMesPrecoReal = concMes.reduce((s, c) => s + (c.adjudicacoes || []).reduce((sa, a) => sa + (Number(a.preco_total) || 0), 0), 0);
        const CUSTO_POR_VIATURA = 80;
        const concMesCusto = concMesPrecoReal > 0 ? concMesPrecoReal : concMesViaturas * CUSTO_POR_VIATURA;
        const concMesReal  = concMesPrecoReal > 0;
        // Viaturas em cargas activas (not Concluído/Cancelado)
        const viaturasActivas = cargas.filter(c => !["Completed","Cancelled"].includes(c.estado)).reduce((s, c) => s + (c.num_viaturas || (c.viaturas || []).length), 0);

        // ── Por Motivo ───────────────────────────────────────────
        const motivoCounts = {};
        cargas.filter(c => c.estado !== "Cancelled").forEach(c => {
            const m = c.motivo || "Transfer";
            motivoCounts[m] = (motivoCounts[m] || 0) + 1;
        });
        const motivosSorted = Object.entries(motivoCounts).sort((a, b) => b[1] - a[1]);
        const totalMotivo   = motivosSorted.reduce((s, [, v]) => s + v, 0);

        // ── Movimento pendente por destino ──────────────────────
        // Cargas activas (Requested/Confirmado/Em Trânsito) agrupadas por zona de destino
        const ESTADOS_ACTIVOS = ['Requested',"Confirmed","In Transit"];
        const ESTADO_PILL_CLS = {
            "Pending":  'bg-gray-400/20 text-gray-400',
            'Requested':  'bg-blue-500/15 text-blue-400',
            "Confirmed":  'bg-purple-500/15 text-purple-400',
            "In Transit": 'bg-orange-500/15 text-orange-400',
        };
        const ESTADO_ORDER = { "In Transit": 0, "Confirmed": 1, 'Requested': 2, "Pending": 3 };
        const destStats = {};
        cargas.filter(c => ESTADOS_ACTIVOS.includes(c.estado)).forEach(c => {
            const zona  = c.estacao_destino_nome || c.zona_destino || c.estacao_destino || "Unknown";
            const nViat = c.num_viaturas || (c.viaturas || []).length;
            if (!destStats[zona]) destStats[zona] = { total: 0, estados: {}, grupos: [], acriss: {} };
            destStats[zona].total += nViat;
            destStats[zona].estados[c.estado] = (destStats[zona].estados[c.estado] || 0) + nViat;
            destStats[zona].grupos.push(c);
            // Breakdown por grupo ACRISS
            (c.viaturas || []).forEach(v => {
                const gr = (v.acriss || v.categoria || '').toUpperCase() || '—';
                destStats[zona].acriss[gr] = (destStats[zona].acriss[gr] || 0) + 1;
            });
        });
        // Sort grupos inside each destino by estado priority then by delivery date
        Object.values(destStats).forEach(d => {
            d.grupos.sort((a, b) => {
                const oDiff = (ESTADO_ORDER[a.estado] ?? 9) - (ESTADO_ORDER[b.estado] ?? 9);
                if (oDiff !== 0) return oDiff;
                return (a.data_entrega || '') < (b.data_entrega || '') ? -1 : 1;
            });
        });
        const destSorted  = Object.entries(destStats).sort((a, b) => b[1].total - a[1].total);
        const maxDestViat = destSorted.length > 0 ? destSorted[0][1].total : 1;

        // ── Relatório mensal ─────────────────────────────────────
        const MESES_PT = ['Jan',"Feb",'Mar',"Apr","May",'Jun','Jul',"Aug",'Set',"Oct",'Nov',"Dec"];
        const monthStats = {};
        cargas.filter(c => c.estado === "Completed").forEach(c => {
            const dateStr = c.data_atualizacao || c.data_entrega || c.data_criacao;
            if (!dateStr) return;
            const d = new Date(dateStr);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = `${MESES_PT[d.getMonth()]} ${d.getFullYear()}`;
            const nViat = c.num_viaturas || (c.viaturas || []).length;
            if (!monthStats[key]) monthStats[key] = { label, viaturas: 0, cargas: 0, motivos: {}, preco_real: 0 };
            monthStats[key].viaturas  += nViat;
            monthStats[key].cargas    += 1;
            monthStats[key].preco_real += (c.adjudicacoes || []).reduce((s, a) => s + (Number(a.preco_total) || 0), 0);
            const m = c.motivo || "Transfer";
            monthStats[key].motivos[m] = (monthStats[key].motivos[m] || 0) + nViat;
        });
        // Last 12 months, most recent first
        const monthsSorted = Object.entries(monthStats).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
        const maxMonthViat = monthsSorted.length > 0 ? Math.max(...monthsSorted.map(([, v]) => v.viaturas)) : 1;
        const motivoColors = { 'Defleet':'text-orange-400','Infleet':'text-emerald-400',"Workshop":'text-yellow-500',"Transfer":'text-blue-400',"Fleet Rebalancing":'text-purple-400',"Customer":'text-pink-400' };
        const currentMonthKey = `${thisYear}-${String(thisMonth + 1).padStart(2, '0')}`;

        const monthRows = monthsSorted.length === 0
            ? `<p class="text-xs text-gray-400 italic">No completed loads</p>`
            : monthsSorted.map(([key, m]) => {
                const isCurrent = key === currentMonthKey;
                const pct = Math.round(m.viaturas / maxMonthViat * 100);
                const custoRow  = m.preco_real > 0 ? m.preco_real : m.viaturas * CUSTO_POR_VIATURA;
                const custoLabel = m.preco_real > 0 ? '' : '<span class="text-gray-400 font-normal"> est.</span>';
                const custoFmt  = custoRow >= 1000 ? `${(custoRow / 1000).toFixed(1)}k€` : `${custoRow.toFixed(0)}€`;
                const motivoPills = Object.entries(m.motivos)
                    .sort((a, b) => b[1] - a[1])
                    .map(([mot, n]) => {
                        const cls = motivoColors[mot] || 'text-gray-400';
                        return `<span class="text-[0.58rem] ${cls} font-medium" title="${_esc(mot)}">${_esc(mot.split(' ')[0])} ${n}</span>`;
                    }).join('<span class="text-gray-600 mx-0.5">·</span>');
                const currentBadge = isCurrent ? '<span class="ml-1 text-[0.55rem] bg-primary-500/15 text-primary-500 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide">atual</span>' : '';
                const rowBg = isCurrent ? 'bg-primary-500/5 dark:bg-primary-500/10 ring-1 ring-primary-500/20' : 'hover:bg-lynx-subtle dark:hover:bg-gray-900/40';
                return `<div class="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 px-2 py-1.5 rounded-lg transition-colors ${rowBg}">
                    <div class="text-right">
                        <span class="text-xs font-semibold ${isCurrent ? 'text-primary-500' : 'text-gray-500'}">${_esc(m.label)}</span>
                        ${currentBadge}
                    </div>
                    <div class="space-y-0.5">
                        <div class="flex items-center gap-2">
                            <div class="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                                <div class="h-full rounded-full ${isCurrent ? 'bg-primary-500' : 'bg-primary-500/60'}" style="width:${pct}%"></div>
                            </div>
                            <span class="text-xs font-bold lynx-text-primary w-6 text-right">${m.viaturas}</span>
                        </div>
                        <div class="flex flex-wrap gap-x-1 gap-y-0 text-[0.58rem] text-gray-400 leading-tight">${motivoPills}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-xs font-bold text-emerald-500">${custoFmt}${custoLabel}</div>
                        <div class="text-[0.58rem] text-gray-400">${m.cargas} carga${m.cargas !== 1 ? 's' : ''}</div>
                    </div>
                </div>`;
            }).join('');

        const totalViatConc = monthsSorted.reduce((s, [, m]) => s + m.viaturas, 0);
        const totalCustoEst = totalViatConc * CUSTO_POR_VIATURA;
        const transCounts = {};
        cargas.filter(c => !["Cancelled"].includes(c.estado)).forEach(c => {
            (c.adjudicacoes || []).forEach(a => {
                const t = a.transportador || "Not defined";
                if (!transCounts[t]) transCounts[t] = { cargas: 0, viaturas: 0 };
                transCounts[t].cargas++;
                transCounts[t].viaturas += (a.viaturas || []).length;
            });
        });
        const transSorted = Object.entries(transCounts).sort((a, b) => b[1].viaturas - a[1].viaturas);

        // ── Build HTML ───────────────────────────────────────────
        const kpiCard = (icon, iconColor, value, label, extra = '') =>
            `<div class="bg-white dark:bg-gray-800 border border-lynx-divider dark:border-gray-700 rounded-xl p-4 flex items-center gap-4">
                <div class="w-10 h-10 rounded-xl ${iconColor} flex items-center justify-center flex-shrink-0">
                    <i class="fas ${icon} text-lg"></i>
                </div>
                <div>
                    <div class="text-2xl font-bold lynx-text-primary leading-none">${value}</div>
                    <div class="text-[0.65rem] uppercase tracking-wider text-gray-400 mt-0.5">${label}</div>
                    ${extra ? `<div class="text-[0.6rem] text-gray-400 mt-0.5">${extra}</div>` : ''}
                </div>
            </div>`;

        const estadoRows = ESTADOS_ALL
            .filter(e => estadoCounts[e] > 0)
            .map(e => {
                const cfg = ESTADO_CFG[e] || {};
                const pct = cargas.length > 0 ? Math.round(estadoCounts[e] / cargas.length * 100) : 0;
                return `<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-lynx-subtle dark:hover:bg-gray-900/40 cursor-pointer transition-colors" onclick="rotSwitchTab('ver');rotFiltrarEstado('${_esc(e)}')">
                    <i class="fas ${cfg.icon || 'fa-circle'} ${cfg.text || 'text-gray-400'} w-4 text-center text-xs"></i>
                    <span class="text-xs flex-1 lynx-text-primary">${_esc(e)}</span>
                    <div class="flex items-center gap-2">
                        <div class="w-16 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                            <div class="h-full rounded-full bg-primary-500/60" style="width:${pct}%"></div>
                        </div>
                        <span class="font-bold text-xs lynx-text-primary w-4 text-right">${estadoCounts[e]}</span>
                    </div>
                </div>`;
            }).join('');

        const motivoRows = motivosSorted.map(([m, count]) => {
            const pct = totalMotivo > 0 ? Math.round(count / totalMotivo * 100) : 0;
            const colors = { 'Defleet':'text-orange-400','Infleet':'text-emerald-400',"Workshop":'text-yellow-500',"Transfer":'text-blue-400',"Fleet Rebalancing":'text-purple-400',"Customer":'text-pink-400' };
            const col = colors[m] || 'text-gray-400';
            return `<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-lynx-subtle dark:hover:bg-gray-900/40 transition-colors">
                <span class="text-xs flex-1 ${col} font-medium">${_esc(m)}</span>
                <div class="flex items-center gap-2">
                    <div class="w-16 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                        <div class="h-full rounded-full bg-primary-500/60" style="width:${pct}%"></div>
                    </div>
                    <span class="font-bold text-xs lynx-text-primary w-4 text-right">${count}</span>
                </div>
            </div>`;
        }).join('');

        const destRows = destSorted.length === 0
            ? `<p class="text-xs text-gray-400 italic px-2">No pending movements</p>`
            : destSorted.map(([zona, d], idx) => {
                const pct = Math.round(d.total / maxDestViat * 100);
                const pillsHtml = Object.entries(d.estados)
                    .sort((a, b) => (ESTADO_ORDER[a[0]] ?? 9) - (ESTADO_ORDER[b[0]] ?? 9))
                    .map(([est, n]) => {
                        const cls = ESTADO_PILL_CLS[est] || 'bg-gray-400/20 text-gray-400';
                        return `<span class="text-[0.6rem] px-1.5 py-0.5 rounded font-semibold ${cls}" title="${_esc(est)}">${n}</span>`;
                    }).join('');
                const gruposHtml = d.grupos.map(c => {
                    const nViat = c.num_viaturas || (c.viaturas || []).length;
                    const pillCls = ESTADO_PILL_CLS[c.estado] || 'bg-gray-400/20 text-gray-400';                    let dataTxt = '';
                    if (c.data_entrega) {
                        const daysLeft = Math.ceil((new Date(c.data_entrega) - new Date()) / 86400000);
                        const dateStr  = window.renaFormatDate(c.data_entrega, true);
                        if      (daysLeft <  0) dataTxt = `<span class="text-red-400 font-bold">ATRASO ${Math.abs(daysLeft)}d</span>`;
                        else if (daysLeft === 0) dataTxt = `<span class="text-orange-400 font-bold">HOJE</span>`;
                        else                    dataTxt = `<span class="text-gray-400">${dateStr}</span>`;
                    }
                    // ACRISS breakdown per carga
                    const acrissPerCarga = {};
                    (c.viaturas || []).forEach(v => {
                        const gr = (v.acriss || v.categoria || '').toUpperCase() || '—';
                        acrissPerCarga[gr] = (acrissPerCarga[gr] || 0) + 1;
                    });
                    const acrissChips = Object.entries(acrissPerCarga)
                        .sort((a, b) => b[1] - a[1])
                        .map(([g, n]) => `<span class="font-mono text-[0.55rem] bg-gray-100 dark:bg-gray-700/80 rounded px-1 py-0.5 whitespace-nowrap"><span class="font-bold text-primary-400">${_esc(g)}</span><span class="text-gray-400 ml-0.5">${n}</span></span>`)
                        .join('');
                    return `<div class="py-1.5 border-t border-gray-50 dark:border-gray-700/50 first:border-t-0">
                        <div class="flex items-center gap-2">
                            <button onclick="rotSwitchTab('ver');setTimeout(()=>{const el=document.querySelector('[data-ref=\\'${_esc(c.referencia)}\\']');if(el)el.scrollIntoView({behavior:'smooth',block:'center'})},200)"
                                class="font-mono font-bold text-xs text-primary-500 hover:underline">${_esc(c.referencia)}</button>
                            <span class="text-[0.6rem] px-1.5 py-0.5 rounded font-semibold ${pillCls}">${_esc(c.estado)}</span>
                            <span class="text-xs font-bold lynx-text-primary ml-auto">${nViat} <span class="font-normal text-gray-400 text-[0.65rem]">viat.</span></span>
                            ${dataTxt ? `<span class="text-[0.65rem]">${dataTxt}</span>` : ''}
                        </div>
                        ${acrissChips ? `<div class="flex flex-wrap gap-1 mt-1 pl-0.5">${acrissChips}</div>` : ''}
                    </div>`;
                }).join('');
                const acrissHtml = Object.entries(d.acriss).length > 0
                    ? Object.entries(d.acriss)
                        .sort((a, b) => b[1] - a[1])
                        .map(([g, n]) => `<span class="inline-flex items-center gap-1 text-[0.6rem] font-mono bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5"><span class="font-bold text-primary-500">${_esc(g)}</span><span class="text-gray-400">${n}</span></span>`)
                        .join('')
                    : '';
                return `<details class="group rounded-lg border border-lynx-divider dark:border-gray-700 overflow-hidden" ${idx === 0 ? 'open' : ''}>
                    <summary class="flex items-center gap-2 px-3 py-2.5 cursor-pointer bg-lynx-subtle dark:bg-gray-900/40 hover:bg-gray-100 dark:hover:bg-gray-900/60 transition-colors list-none select-none">
                        <i class="fas fa-chevron-right text-[0.6rem] text-gray-400 transition-transform group-open:rotate-90"></i>
                        <i class="fas fa-location-dot text-emerald-400 text-xs"></i>
                        <span class="text-xs font-bold lynx-text-primary flex-1">${_esc(zona)}</span>
                        <div class="flex items-center gap-1.5">
                            ${pillsHtml}
                            <span class="text-sm font-bold text-emerald-500 ml-1">${d.total}</span>
                            <span class="text-[0.6rem] text-gray-400">viat.</span>
                        </div>
                    </summary>
                    <div class="px-3 py-1 bg-white dark:bg-gray-800">
                        ${acrissHtml ? `<div class="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 mb-1 border-b border-gray-50 dark:border-gray-700/50">${acrissHtml}</div>` : ''}
                        ${gruposHtml}
                    </div>
                </details>`;
            }).join('');

        const transRows = transSorted.length === 0
            ? `<p class="text-xs text-gray-400 italic px-2">No carrier assignments recorded</p>`
            : transSorted.map(([t, v]) =>
                `<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-lynx-subtle dark:hover:bg-gray-900/40 transition-colors">
                    <i class="fas fa-truck text-gray-300 dark:text-gray-600 text-xs w-4 text-center"></i>
                    <span class="text-xs flex-1 lynx-text-primary font-medium">${_esc(t)}</span>
                    <span class="text-[0.65rem] text-gray-400">${v.cargas} carga${v.cargas !== 1 ? 's' : ''}</span>
                    <span class="text-xs font-bold text-purple-500 bg-purple-500/10 px-2 py-0.5 rounded-full ml-1">${v.viaturas} viat.</span>
                </div>`).join('');

        el.innerHTML = `
        <div class="space-y-4">
            <!-- KPI row -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                ${kpiCard('fa-car-on',   'bg-blue-500/10 text-blue-500',   viaturasActivas, "Active vehicles", `in active loads`)}
                ${kpiCard('fa-truck-moving','bg-orange-500/10 text-orange-500', viaturasEmTransito, "Currently in transit", `${emTransito.length} carga${emTransito.length !== 1 ? 's' : ''}`)}
                ${kpiCard('fa-triangle-exclamation', atrasadas.length > 0 ? 'bg-red-500/15 text-red-500' : 'bg-gray-500/10 text-gray-400',
                    atrasadas.length, "Overdue Loads",
                    iminentes.length > 0 ? `${iminentes.length} due within 7 days` : (atrasadas.length === 0 ? "all up to date" : ''))}
                ${kpiCard('fa-check-double', 'bg-emerald-500/10 text-emerald-500', concMes.length, "Completed this month",
                    `<span class="font-bold text-emerald-400">${concMesCusto >= 1000 ? (concMesCusto/1000).toFixed(1)+'k€' : concMesCusto.toFixed(0)+'€'}${!concMesReal ? '<span class="text-gray-400"> est.</span>' : ''}</span>&ensp;·&ensp;${concMesViaturas} viat.`)}
            </div>
            <!-- Detail row -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div class="bg-white dark:bg-gray-800 border border-lynx-divider dark:border-gray-700 rounded-xl p-4">
                    <div class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
                        <i class="fas fa-layer-group text-primary-500"></i> Por Status
                        <span class="ml-auto text-gray-400 font-normal normal-case tracking-normal text-[0.6rem]">click to filter</span>
                    </div>
                    <div class="space-y-0.5">${estadoRows || "<p class=\"text-xs text-gray-400 italic px-2\">No loads</p>"}</div>
                </div>
                <div class="bg-white dark:bg-gray-800 border border-lynx-divider dark:border-gray-700 rounded-xl p-4">
                    <div class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
                        <i class="fas fa-tag text-blue-400"></i> Por Reason
                    </div>
                    <div class="space-y-0.5">${motivoRows || "<p class=\"text-xs text-gray-400 italic px-2\">No data</p>"}</div>
                </div>
                <div class="bg-white dark:bg-gray-800 border border-lynx-divider dark:border-gray-700 rounded-xl p-4">
                    <div class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-2">
                        <i class="fas fa-location-dot text-emerald-500"></i> Movimento pendente
                        <span class="ml-auto text-gray-400 font-normal normal-case tracking-normal text-[0.6rem]">by destination</span>
                    </div>
                    <div class="flex gap-2 mb-3 text-[0.58rem] text-gray-400 pl-6">
                        <span class="bg-gray-400/20 text-gray-400 px-1.5 py-0.5 rounded font-semibold">Pending</span>
                        <span class="bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded font-semibold">Requested</span>
                        <span class="bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded font-semibold">Confirmed</span>
                        <span class="bg-orange-500/15 text-orange-400 px-1.5 py-0.5 rounded font-semibold">In Transit</span>
                    </div>
                    <div class="space-y-1">${destRows}</div>
                </div>
                <div class="bg-white dark:bg-gray-800 border border-lynx-divider dark:border-gray-700 rounded-xl p-4">
                    <div class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
                        <i class="fas fa-truck text-purple-400"></i> Transportadores
                    </div>
                    <div class="space-y-0.5">${transRows}</div>
                </div>
            </div>
            <!-- Relatório mensal -->
            <div class="bg-white dark:bg-gray-800 border border-lynx-divider dark:border-gray-700 rounded-xl p-4">
                <div class="flex items-center justify-between mb-3">
                    <div class="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                        <i class="fas fa-calendar-alt text-primary-500"></i> Monthly Report — Completed Loads
                    </div>
                    ${monthsSorted.length > 0 ? `
                    <div class="flex items-center gap-4 text-xs text-gray-400">
                        <span>Last ${monthsSorted.length} meses</span>
                        <span class="font-semibold lynx-text-primary">${totalViatConc} vehicles</span>
                        <span class="font-bold text-emerald-500">${(totalCustoEst / 1000).toFixed(1)}k€ est.</span>
                        <span class="text-[0.6rem] text-gray-400 italic">@ ${CUSTO_POR_VIATURA}€/viatura</span>
                    </div>` : ''}
                </div>
                <div class="space-y-0.5">${monthRows}</div>
            </div>
        </div>`;
    }

    // ── RENDER CARGA LIST ───────────────────────────────────────
    function _renderCargas() {
        _renderCargaList(ROT.cargas);
    }

    function _renderCargaList(cargas) {
        const container = document.getElementById('rotCargasContainer');
        if (!container) return;

        if (!cargas || cargas.length === 0) {
            container.innerHTML = `
                <div class="text-center py-16 text-gray-400">
                    <i class="fas fa-inbox text-4xl mb-3 block opacity-40"></i>
                    <p class="text-sm">None carga encontrada</p>
                </div>`;
            return;
        }

        container.innerHTML = cargas.map(c => {
            const cfg = ESTADO_CFG[c.estado] || ESTADO_CFG["Pending"];
            const nViat = c.num_viaturas || (c.viaturas || []).length;
            const plates = (c.viaturas || []).slice(0, 4).map(v => _rotViaturaLabel(v)).join(', ');
            const moreCount = nViat > 4 ? ` +${nViat - 4}` : '';
            const origemNome = c.estacao_origem_nome || c.zona_origem || '—';
            const destinoNome = c.estacao_destino_nome || c.zona_destino || '—';
            const origemZona = c.estacao_origem && c.estacao_origem !== 'OUTRO' ? c.estacao_origem : '';
            const destinoZona = c.estacao_destino && c.estacao_destino !== 'OUTRO' ? c.estacao_destino : '';

            // Variante / parent badges
            const varianteBadge = c.variante
                ? `<span class="text-xs font-bold bg-teal-500/15 text-teal-500 px-2 py-0.5 rounded-full ml-1">V${c.variante}</span>`
                : '';
            const paiBadge = c.pai
                ? `<span class="text-[0.65rem] text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full ml-1" title="Parent load"><i class="fas fa-code-branch mr-1"></i>${_esc(c.pai)}</span>`
                : '';
            const variantesInfo = (c.variantes || []).length > 0
                ? `<span class="text-teal-500 text-xs"><i class="fas fa-code-branch mr-1"></i>${c.variantes.length} variante${c.variantes.length > 1 ? 's' : ''}: ${c.variantes.map(v => `<span class="font-mono font-semibold">${_esc(v)}</span>`).join(', ')}</span>`
                : '';

            // Countdown badge for Em Trânsito cards
            const countdownBadge = (() => {
                if (c.estado !== "In Transit" || !c.data_entrega) return '';
                const daysLeft = Math.ceil((new Date(c.data_entrega) - new Date()) / 86400000);
                if (daysLeft < 0) return `<span class="text-[0.65rem] font-bold bg-red-500/15 text-red-500 px-2 py-0.5 rounded-full animate-pulse">ATRASO ${Math.abs(daysLeft)}d</span>`;
                if (daysLeft === 0) return `<span class="text-[0.65rem] font-bold bg-orange-500/15 text-orange-500 px-2 py-0.5 rounded-full animate-pulse">DELIVERY TODAY</span>`;
                if (daysLeft <= 2)  return `<span class="text-[0.65rem] font-bold bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded-full">${daysLeft}d p/ entrega</span>`;
                return `<span class="text-[0.65rem] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">${daysLeft}d p/ entrega</span>`;
            })();

            return `
            <div class="lynx-dropdown overflow-hidden hover:shadow-md transition-shadow${c.pai ? ' border-l-2 border-teal-400/50' : ''}" data-ref="${_esc(c.referencia)}">
                <!-- Header -->
                <div class="flex items-center justify-between px-5 py-3 border-b border-gray-50 dark:border-gray-800">
                    <div class="flex items-center gap-3 min-w-0">
                        <span class="${cfg.bg} ${cfg.text} w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">
                            <i class="fas ${cfg.icon} text-sm"></i>
                        </span>
                        <div class="min-w-0">
                            <div class="flex items-center flex-wrap gap-1">
                                <span class="font-mono font-bold lynx-text-primary text-sm">${_esc(c.referencia)}</span>
                                ${varianteBadge}
                                ${paiBadge}
                                <span class="text-xs ${cfg.text} ${cfg.bg} px-2 py-0.5 rounded-full font-medium">${_esc(c.estado)}</span>
                                ${countdownBadge}
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <span class="text-xs text-gray-400" title="${_formatDateTime(c.data_criacao)}">${_timeAgo(c.data_criacao)}</span>
                        <div class="relative">
                            <button onclick="rotToggleMenu('${_esc(c.referencia)}')" class="w-7 h-7 rounded-lg hover:bg-lynx-subtle dark:hover:bg-gray-800 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                                <i class="fas fa-ellipsis-v text-xs"></i>
                            </button>
                            <div id="rotMenu_${_esc(c.referencia)}" class="hidden absolute right-0 top-8 z-50 w-48 bg-white dark:bg-[#222] rounded-lg shadow-xl border border-lynx-divider dark:border-gray-700 py-1 text-sm">
                                <button onclick="rotEditarCarga('${_esc(c.referencia)}')" class="w-full text-left px-4 py-2 hover:bg-lynx-subtle dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                                    <i class="fas fa-edit w-5 text-blue-400"></i> Edit
                                </button>
                                ${c.estado === "Pending" ? `
                                <button onclick="rotSolicitarCarga('${_esc(c.referencia)}')" class="w-full text-left px-4 py-2 hover:bg-lynx-subtle dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                                    <i class="fas fa-paper-plane w-5 text-blue-400"></i> Solicitar
                                </button>` : ''}
                                ${c.estado === 'Requested' ? `
                                <button onclick="rotSolicitarCarga('${_esc(c.referencia)}')" class="w-full text-left px-4 py-2 hover:bg-lynx-subtle dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                                    <i class="fas fa-redo w-5 text-blue-400"></i> Reenviar Email
                                </button>` : ''}
                                ${c.estado === "Confirmed" ? `
                                <button onclick="rotEmailSeguimento('${_esc(c.referencia)}')" class="w-full text-left px-4 py-2 hover:bg-lynx-subtle dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                                    <i class="fas fa-bell w-5 text-emerald-400"></i> Follow-Up Email
                                </button>` : ''}
                                ${(c.estado === 'Requested' || c.estado === "Confirmed") && nViat > 0 ? `
                                <button onclick="rotAdjudicar('${_esc(c.referencia)}')" class="w-full text-left px-4 py-2 hover:bg-lynx-subtle dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                                    <i class="fas fa-handshake w-5 text-purple-400"></i> Adjudicar
                                </button>` : ''}
                                ${c.estado === "Confirmed" ? `
                                <button onclick="rotRegistarTransito('${_esc(c.referencia)}')" class="w-full text-left px-4 py-2 hover:bg-lynx-subtle dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                                    <i class="fas fa-truck-moving w-5 text-orange-400"></i> Record Transit
                                </button>` : ''}
                                ${c.estado === "In Transit" ? `
                                <button onclick="rotConcluirCarga('${_esc(c.referencia)}')" class="w-full text-left px-4 py-2 hover:bg-lynx-subtle dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                                    <i class="fas fa-check-double w-5 text-green-400"></i> Concluir
                                </button>` : ''}
                                <button onclick="rotMostrarHistorico('${_esc(c.referencia)}')" class="w-full text-left px-4 py-2 hover:bg-lynx-subtle dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
                                    <i class="fas fa-history w-5 text-gray-400"></i> History
                                </button>
                                <hr class="my-1 border-lynx-divider dark:border-gray-700">
                                <button onclick="rotEliminarCarga('${_esc(c.referencia)}')" class="w-full text-left px-4 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400">
                                    <i class="fas fa-trash w-5"></i> Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- Body -->
                <div class="px-5 py-4 space-y-3">
                    <!-- Route -->
                    <div class="flex items-center gap-3">
                        <div class="flex-1 bg-lynx-subtle dark:bg-[#111] rounded-lg px-3 py-2 text-center">
                            <div class="text-[0.65rem] text-gray-400 uppercase tracking-wider">Origin</div>
                            <div class="text-sm font-semibold lynx-text-primary truncate" title="${_esc(origemNome)}">${_esc(origemNome)}</div>
                            ${origemZona ? `<div class="text-[0.6rem] text-gray-400">${_esc(origemZona)}</div>` : ''}
                        </div>
                        <i class="fas fa-arrow-right text-gray-300 dark:text-gray-600"></i>
                        <div class="flex-1 bg-lynx-subtle dark:bg-[#111] rounded-lg px-3 py-2 text-center">
                            <div class="text-[0.65rem] text-gray-400 uppercase tracking-wider">Destination</div>
                            <div class="text-sm font-semibold lynx-text-primary truncate" title="${_esc(destinoNome)}">${_esc(destinoNome)}</div>
                            ${destinoZona ? `<div class="text-[0.6rem] text-gray-400">${_esc(destinoZona)}</div>` : ''}
                        </div>
                    </div>
                    <!-- Info row -->
                    <div class="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                        <span><i class="fas fa-car mr-1"></i>${nViat} vehicle${nViat !== 1 ? 's' : ''}</span>
                        <span><i class="fas fa-tag mr-1"></i>${_esc(c.motivo || "Transfer")}</span>
                        ${c.data_levantamento ? `<span><i class="fas fa-calendar mr-1"></i>Lev: ${_formatDate(c.data_levantamento)}</span>` : ''}
                        ${c.data_entrega ? `<span><i class="fas fa-calendar-check mr-1"></i>Ent: ${_formatDate(c.data_entrega)}</span>` : ''}
                        ${(c.adjudicacoes || []).length > 0 ? (() => {
                            const transportadores = [...new Set((c.adjudicacoes || []).map(a => a.transportador).filter(Boolean))];
                            const custoTotal = (c.adjudicacoes || []).reduce((sum, a) => sum + (a.preco_total || a.preco_viatura * (a.viaturas || []).length || 0), 0);
                            return `<span class="text-purple-400"><i class="fas fa-handshake mr-1"></i>${_esc(transportadores.join(', '))}${custoTotal > 0 ? ` · <span class="font-semibold">${custoTotal.toFixed(2)}€</span>` : ''}</span>`;
                        })() : ''}
                        ${(c.guias || []).length > 0 ? `<span class="text-blue-400"><i class="fas fa-file-alt mr-1"></i>${c.guias.map(g => g.numero || '').filter(Boolean).join(', ') || c.guias.length + ' guia' + (c.guias.length > 1 ? 's' : '')}</span>` : ''}
                        ${c.estado === "Confirmed" ? (c.seguimento_enviado_at
                            ? `<span class="text-emerald-500"><i class="fas fa-bell mr-1"></i>Seguimento enviado ${_timeAgo(c.seguimento_enviado_at)}</span>`
                            : `<span class="text-orange-400"><i class="fas fa-bell mr-1"></i>Follow-up pending</span>`
                        ) : ''}
                    </div>
                    ${variantesInfo ? `<div class="text-xs">${variantesInfo}</div>` : ''}
                    <!-- Plates with per-vehicle status -->
                    ${nViat > 0 ? (() => {
                        const viaturas = c.viaturas || [];
                        // Concluído: simplified — no tracking needed, all arrived
                        if (c.estado === "Completed") {
                            return `<div class="flex items-center gap-2 flex-wrap mt-0.5">
                                <span class="text-[0.6rem] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400"><i class="fas fa-check-circle mr-1"></i>Arrived at destination</span>
                                <span class="text-xs font-mono text-gray-500 dark:text-gray-400">${_esc(plates)}${moreCount ? `<span class="text-gray-400"> ${moreCount}</span>` : ''}</span>
                            </div>`;
                        }
                        const hasInfo = viaturas.some(v => v.viatura_info);
                        if (!hasInfo) {
                            return `<div class="text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
                                ${_esc(plates)}${moreCount ? `<span class="text-gray-300 dark:text-gray-600">${moreCount}</span>` : ''}
                            </div>`;
                        }

                        // Group vehicles by effective status
                        const groups = {
                            chegou:           { label: "Arrived at destination",                                       cls: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300', hdrCls: 'text-emerald-600 dark:text-emerald-400', items: [] },
                            a_caminho:        { label: `Being moved to ${destinoNome}`,                    cls: 'bg-teal-500/15 text-teal-600 dark:text-teal-300',          hdrCls: 'text-teal-500 dark:text-teal-400',        items: [] },
                            local:            { label: `Available at ${origemNome}`,                            cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', hdrCls: 'text-emerald-500',                        items: [] },
                            disponivel:       { label: 'Noutro local — deslocar',                                cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',          hdrCls: 'text-blue-500',                           items: [] },
                            em_contrato:      { label: 'Em contrato',                                            cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',       hdrCls: 'text-amber-500',                          items: [] },
                            em_contrato_late: { label: "Overdue contract",                                      cls: 'bg-red-500/15 text-red-600 dark:text-red-400',             hdrCls: 'text-red-500',                            items: [] },
                            oficina:          { label: "In workshop",                                             cls: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',    hdrCls: 'text-yellow-600',                         items: [] },
                            sem_matricula:    { label: "Group — no vehicle assigned",                          cls: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',    hdrCls: 'text-purple-500',                         items: [] },
                            desconhecido:     { label: "No demo data",                                         cls: 'bg-gray-200/60 text-gray-400 dark:text-gray-500',          hdrCls: 'text-gray-400',                         items: [] },
                        };
                        viaturas.forEach(v => {
                            const info = v.viatura_info || {};
                            const st = info.chegou ? 'chegou'
                                     : info.a_caminho_destino ? 'a_caminho'
                                     : (info.status || 'desconhecido');
                            (groups[st] || groups.desconhecido).items.push(v);
                        });

                        const _fmtDate = d => d ? d.slice(8,10) + '/' + d.slice(5,7) + '/' + d.slice(0,4) : '';

                        const sectionHtml = Object.entries(groups).map(([st, g]) => {
                            if (!g.items.length) return '';
                            const pillsHtml = g.items.map(v => {
                                const info = v.viatura_info || {};
                                let extra = '';
                                if (st === 'a_caminho')
                                    extra = info.data_retorno ? ` · ${_fmtDate(info.data_retorno)}` : '';
                                else if (st === 'disponivel' && info.station)
                                    extra = ` · ${_esc(info.station)}, move to ${_esc(origemNome)}`;
                                else if (st === 'em_contrato')
                                    extra = ` · retoma${info.ret_station ? ` em ${_esc(info.ret_station)}` : (info.station ? ` em ${_esc(info.station)}` : '')}${info.data_retorno ? ` ${_fmtDate(info.data_retorno)}` : ''}`;
                                else if (st === 'em_contrato_late')
                                    extra = ` · retoma${info.ret_station ? ` em ${_esc(info.ret_station)}` : (info.station ? ` em ${_esc(info.station)}` : '')}${info.data_retorno ? ` ${_fmtDate(info.data_retorno)}` : ''} (atrasado)`;
                                else if (st === 'oficina' && info.station)
                                    extra = ` · ${_esc(info.station)}`;
                                const pulse = st === 'em_contrato_late' ? ' animate-pulse' : '';
                                return `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[0.6rem] font-mono ${g.cls}${pulse}">${_esc(_rotViaturaLabel(v))}${extra}</span>`;
                            }).join('');
                            const isMove = st === 'disponivel';
                            return `<div class="mt-1.5">
                                <div class="mb-0.5">
                                    <span class="text-[0.6rem] font-semibold uppercase tracking-wide ${g.hdrCls}">${g.label}${isMove ? ` (${g.items.length})` : ''}</span>
                                </div>
                                <div class="flex flex-wrap gap-1 pl-2">${pillsHtml}</div>
                            </div>`;
                        }).join('');

                        return sectionHtml;
                    })() : `<div class="text-xs text-gray-300 dark:text-gray-600 italic">All vehicles allocated to split loads</div>`}
                    <!-- User -->
                    <div class="text-[0.65rem] text-gray-300 dark:text-gray-600">
                        <i class="fas fa-user mr-1"></i>${_esc(c.utilizador || '—')} · ${_formatDateTime(c.data_criacao)}
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    // ── MENU TOGGLE ─────────────────────────────────────────────
    window.rotToggleMenu = function (ref) {
        const el = document.getElementById('rotMenu_' + ref);
        if (!el) return;
        const wasHidden = el.classList.contains('hidden');
        document.querySelectorAll('[id^="rotMenu_"]').forEach(m => m.classList.add('hidden'));
        if (wasHidden) el.classList.remove('hidden');
        if (wasHidden) {
            const handler = (e) => {
                if (!el.contains(e.target)) { el.classList.add('hidden'); document.removeEventListener('click', handler, true); }
            };
            setTimeout(() => document.addEventListener('click', handler, true), 0);
        }
    };

    // ── SOLICITAR (build email + open Outlook + mark as Requested) ─
    function _buildEmailHtml(c) {
        const dataPedido = _formatDateTime(c.data_criacao || new Date().toISOString());
        const origemLbl  = (c.estacao_origem_nome || c.zona_origem || '—') +
                           (c.estacao_origem && c.estacao_origem !== 'OUTRO' ? ` (${c.estacao_origem})` : '');
        const destinoLbl = (c.estacao_destino_nome || c.zona_destino || '—') +
                           (c.estacao_destino && c.estacao_destino !== 'OUTRO' ? ` (${c.estacao_destino})` : '');
        const dataLev = c.data_levantamento ? _formatDate(c.data_levantamento) : '';
        const dataDes = c.data_entrega      ? _formatDate(c.data_entrega)      : '';
        const utiliz  = (c.utilizador && c.utilizador !== "System") ? c.utilizador : _currentUser();
        const motivo  = c.motivo || "Transfer";
        const obs     = (c.observacoes || '').trim();
        const ccLev   = (c.cc_origem || '').trim();
        const ccDes   = (c.cc_destino || '').trim();
        const viaturas = Array.isArray(c.viaturas) ? c.viaturas : [];
        const origemNome  = c.estacao_origem_nome  || c.zona_origem  || '—';
        const destinoNome = c.estacao_destino_nome || c.zona_destino || '—';

        const rowsHtml = viaturas.map((v, i) => {
            const bg  = i % 2 === 0 ? '#ffffff' : '#f8f9fa';
            const urg = (v.urgencia || 'Normal').toString();
            const urgColor = /muito.*urgente|hoje/i.test(urg) ? '#dc2626'
                           : /urgente/i.test(urg)              ? '#f59e0b'
                           : '#10b981';
            const cc = v.cc || v.centro_custo || v.COST_CENTER || '';
            // Per-vehicle Demo status column
            const info = v.viatura_info || {};
            let statusTxt = '', statusColor = '#888', statusBg = '#f8f9fa';
            if (info.status === 'local') {
                statusTxt = "Available at " + origemNome; statusColor = '#059669'; statusBg = '#ecfdf5';
            } else if (info.status === 'disponivel') {
                statusTxt = "Available" + (info.station ? ` em ${info.station}` : '') + ` — move to ${origemNome}`;
                statusColor = '#2563eb'; statusBg = '#eff6ff';
            } else if (info.status === 'em_contrato') {
                statusTxt = 'Em contrato — retoma' + (info.station ? ` em ${info.station}` : '') + (info.data_retorno ? ` a ${info.data_retorno.slice(8,10)}/${info.data_retorno.slice(5,7)}/${info.data_retorno.slice(0,4)}` : '');
                statusColor = '#d97706'; statusBg = '#fffbeb';
            } else if (info.status === 'em_contrato_late') {
                statusTxt = "⚠ Overdue contract — retoma" + (info.station ? ` em ${info.station}` : '') + (info.data_retorno ? ` (prevista ${info.data_retorno.slice(8,10)}/${info.data_retorno.slice(5,7)}/${info.data_retorno.slice(0,4)})` : '');
                statusColor = '#dc2626'; statusBg = '#fef2f2';
            } else if (info.status === 'oficina') {
                statusTxt = "In workshop" + (info.station ? ` (${info.station})` : '');
                statusColor = '#b45309'; statusBg = '#fffbeb';
            } else if (info.status === 'sem_matricula') {
                statusTxt = "No assigned vehicle — group " + (v.grupo || '');
                statusColor = '#7c3aed'; statusBg = '#f5f3ff';
            } else if (info.status) {
                statusTxt = info.status;
            }
            const statusCell = statusTxt
                ? `<td style="padding:8px;border:1px solid #ddd;font-size:11px;background-color:${statusBg};color:${statusColor};font-weight:600;">${_esc(statusTxt)}</td>`
                : `<td style="padding:8px;border:1px solid #ddd;color:#ccc;font-size:11px;">—</td>`;

            return `
                <tr style="background-color:${bg};">
                    <td style="padding:8px;border:1px solid #ddd;text-align:center;color:#333;">${i + 1}</td>
                    <td style="padding:8px;border:1px solid #ddd;font-weight:bold;color:#333;">${_esc(_rotViaturaLabel(v))}</td>
                    <td style="padding:8px;border:1px solid #ddd;color:#333;">${_esc(v.descricao || v.modelo || v.DESCRIPTION || '')}</td>
                    <td style="padding:8px;border:1px solid #ddd;color:#333;">${_esc(v.acri || v.acriss || v.ACRI || '')}</td>
                    <td style="padding:8px;border:1px solid #ddd;color:#333;">${_esc(cc)}</td>
                    <td style="padding:8px;border:1px solid #ddd;text-align:center;color:${urgColor};font-weight:bold;">${_esc(urg.split(' ')[0])}</td>
                    <td style="padding:8px;border:1px solid #ddd;color:#333;">${_esc(v.motivo || motivo)}</td>
                    ${statusCell}
                </tr>`;
        }).join('');

        const cc_lev_html  = ccLev ? `<p style="margin:5px 0 0 0;font-size:12px;color:#666;"><strong>CC:</strong> ${_esc(ccLev)}</p>` : '';
        const cc_des_html  = ccDes ? `<p style="margin:5px 0 0 0;font-size:12px;color:#666;"><strong>CC:</strong> ${_esc(ccDes)}</p>` : '';
        const data_lev_html = dataLev ? `<p style="margin:0;font-size:13px;color:#666;">${_esc(dataLev)}</p>` : '';
        const data_des_html = dataDes ? `<p style="margin:0;font-size:13px;color:#666;">${_esc(dataDes)}</p>` : '';
        const obs_html = obs ? `
            <table width="100%" cellpadding="15" cellspacing="0" border="0" style="margin:20px 0;background-color:#fff8e1;border-left:4px solid #f59e0b;">
                <tr><td style="padding:15px;color:#7c5e10;font-size:13px;">
                    <strong>Notes:</strong><br>${_esc(obs).replace(/\n/g, '<br>')}
                </td></tr>
            </table>` : '';

        // Build preparação section — viaturas that need action before pickup
        const prepItems = viaturas.filter(v => {
            const st = (v.viatura_info || {}).status;
            return st && st !== 'local' && st !== 'desconhecido';
        });
        const prepHtml = prepItems.length > 0 ? (() => {
            const rows = prepItems.map(v => {
                const info = v.viatura_info || {};
                let acao = '', cor = '#333';
                const _fd = d => d ? `${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(0,4)}` : '';
                if (info.status === 'disponivel') {
                    acao = `Available${info.station ? ` em ${info.station}` : ''} — move to ${origemNome}`;
                    cor = '#1d4ed8';
                } else if (info.status === 'em_contrato') {
                    acao = `Em contrato — retoma${info.station ? ` em ${info.station}` : ''}${info.data_retorno ? ` a ${_fd(info.data_retorno)}` : ''} — wait for return before pickup`;
                    cor = '#b45309';
                } else if (info.status === 'em_contrato_late') {
                    acao = `⚠ Overdue contract — retoma${info.station ? ` em ${info.station}` : ''}${info.data_retorno ? ` (prevista ${_fd(info.data_retorno)})` : ''} — verificar urgentemente`;
                    cor = '#dc2626';
                } else if (info.status === 'oficina') {
                    acao = `In workshop${info.station ? ` em ${info.station}` : ''} — confirmar disponibilidade`;
                    cor = '#92400e';
                } else if (info.status === 'sem_matricula') {
                    acao = `Choose and assign a vehicle from this group ${v.grupo || ''} before pickup`;
                    cor = '#7c3aed';
                }
                return acao ? `<tr><td style="padding:6px 10px;border:1px solid #fed7aa;font-weight:bold;color:#333;">${_esc(_rotViaturaLabel(v))}</td><td style="padding:6px 10px;border:1px solid #fed7aa;color:${cor};">${acao}</td></tr>` : '';
            }).filter(Boolean).join('');
            return rows ? `
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;border-left:4px solid #ea580c;">
              <tr><td style="padding:12px 15px;background-color:#fff7ed;border:1px solid #fed7aa;">
                <p style="margin:0 0 8px;font-weight:bold;color:#c2410c;font-size:13px;">⚠ Preparation Required</p>
                <p style="margin:0 0 10px;font-size:12px;color:#7c3aed;">Please ensure these vehicles are available at the pickup location on the scheduled date:</p>
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:12px;">
                  <thead><tr style="background-color:#ea580c;color:#fff;">
                    <th style="padding:6px 10px;border:1px solid #fed7aa;text-align:left;width:120px;">License Plate</th>
                    <th style="padding:6px 10px;border:1px solid #fed7aa;text-align:left;">Required Action</th>
                  </tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </td></tr>
            </table>` : '';
        })() : '';

        return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;background-color:#fff;color:#333;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:820px;margin:0 auto;">
  <tr><td style="padding:20px 0;border-bottom:3px solid #ff5f00;">
    <h2 style="margin:0;color:#ff5f00;font-size:20px;">Vehicle Transport Request</h2>
  </td></tr>
  <tr><td>
    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="margin:18px 0;background-color:#f8f9fa;border:1px solid #dee2e6;">
      <tr><td>
        <p style="margin:0 0 6px;"><strong>Reference:</strong> ${_esc(c.referencia)}</p>
        <p style="margin:0 0 6px;"><strong>Requested by:</strong> ${_esc(utiliz)}</p>
        <p style="margin:0 0 6px;"><strong>Request date:</strong> ${_esc(dataPedido)}</p>
        <p style="margin:0 0 6px;"><strong>Reason:</strong> ${_esc(motivo)}</p>
        <p style="margin:0;"><strong>Number of vehicles:</strong> ${viaturas.length}</p>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
      <tr>
        <td width="48%" style="padding:15px;background-color:#e3f2fd;border:1px solid #90caf9;vertical-align:top;">
          <p style="margin:0 0 6px;font-weight:bold;">Pickup</p>
          <p style="margin:0 0 4px;">${_esc(origemLbl)}</p>
          ${data_lev_html}${cc_lev_html}
        </td>
        <td width="4%"></td>
        <td width="48%" style="padding:15px;background-color:#f3e5f5;border:1px solid #ce93d8;vertical-align:top;">
          <p style="margin:0 0 6px;font-weight:bold;">Descarga</p>
          <p style="margin:0 0 4px;">${_esc(destinoLbl)}</p>
          ${data_des_html}${cc_des_html}
        </td>
      </tr>
    </table>
    <h3 style="margin:24px 0 8px;color:#333;font-size:16px;">Vehicle List</h3>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background-color:#ff5f00;color:#fff;">
          <th style="padding:10px;border:1px solid #ddd;text-align:center;">#</th>
          <th style="padding:10px;border:1px solid #ddd;text-align:left;">License Plate</th>
          <th style="padding:10px;border:1px solid #ddd;text-align:left;">Description</th>
          <th style="padding:10px;border:1px solid #ddd;text-align:left;">ACRI</th>
          <th style="padding:10px;border:1px solid #ddd;text-align:left;">Central Custo</th>
          <th style="padding:10px;border:1px solid #ddd;text-align:center;">Urgency</th>
          <th style="padding:10px;border:1px solid #ddd;text-align:left;">Reason</th>
          <th style="padding:10px;border:1px solid #ddd;text-align:left;">Status Atual</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    ${obs_html}
    ${prepHtml}
    <table width="100%" cellpadding="15" cellspacing="0" border="0" style="margin:24px 0;background-color:#fff3cd;border-left:4px solid #ffc107;">
      <tr><td style="color:#856404;font-size:13px;">
        <strong>Note:</strong> Please confirm availability and the scheduled transport date.
      </td></tr>
    </table>
    <p style="margin:18px 0 0;color:#888;font-size:11px;border-top:1px solid #ddd;padding-top:10px;">
      Automatically generated request — Operation Fleet · ${_esc(_formatDateTime(new Date().toISOString()))}
    </p>
  </td></tr>
</table>
</body></html>`;
    }

    window.rotSolicitarCarga = async function (ref) {
        const c = ROT.cargas.find(x => x.referencia === ref);
        if (!c) { _toast("Load not found", 'error'); return; }

        const subject = `Transport Request — ${ref} (${window.renaFormatDate(new Date(), true)})`;

        // Open in-page modal with loading state
        const modal = document.getElementById('rotGenericModal');
        const titleEl = document.getElementById('rotModalTitle');
        const bodyEl  = document.getElementById('rotModalBody');
        if (!modal) { _toast("Dialog not found", 'error'); return; }
        titleEl.textContent = "Request Transport";
        bodyEl.innerHTML = `
            <div class="flex items-center justify-center py-10 text-gray-500">
                <i class="fas fa-circle-notch fa-spin mr-2"></i> Preparing recipients…
            </div>`;
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // Fetch resolved TO/CC (no body sent → preview mode)
        let preview;
        try {
            preview = await _api('/api/rotation/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ referencia: ref, subject, preview: true })
            });
        } catch (e) {
            bodyEl.innerHTML = `<div class="text-red-500 text-sm py-6 text-center">Connection error: ${_esc(String(e))}</div>`;
            return;
        }
        if (!preview || !preview.success) {
            bodyEl.innerHTML = `<div class="text-red-500 text-sm py-6 text-center">${_esc((preview && preview.error) || "Unknown error")}</div>`;
            return;
        }

        const toList = preview.to || [];
        const ccList = preview.cc || [];
        const chip = (e, color) => `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${color} mr-1 mb-1"><i class="fas fa-envelope text-[0.6rem]"></i> ${_esc(e)}</span>`;
        const toHtml = toList.length
            ? toList.map(e => chip(e, 'bg-primary-500/10 text-primary-600 dark:text-primary-300')).join('')
            : '<span class="text-xs text-gray-400 italic">— vazio —</span>';
        const ccHtml = ccList.length
            ? ccList.map(e => chip(e, 'bg-blue-500/10 text-blue-600 dark:text-blue-300')).join('')
            : '<span class="text-xs text-gray-400 italic">— vazio —</span>';

        // Build a set of which stations contributed to CC (for info display)
        const stationsInvolved = [];
        const origemNome = c.estacao_origem_nome || c.zona_origem || '—';
        const destinoNome = c.estacao_destino_nome || c.zona_destino || '—';
        if (origemNome !== '—') stationsInvolved.push(origemNome);
        if (destinoNome !== '—' && destinoNome !== origemNome) stationsInvolved.push(destinoNome);
        (c.viaturas || []).forEach(v => {
            const st = (v.viatura_info || {}).station;
            if (st && !stationsInvolved.includes(st)) stationsInvolved.push(st);
        });
        const stationsHtml = stationsInvolved.map(s =>
            `<span class="inline-flex items-center px-2 py-0.5 rounded text-[0.65rem] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 mr-1">${_esc(s)}</span>`
        ).join('');

        const nViat = (c.viaturas || []).length;

        bodyEl.innerHTML = `
            <div class="space-y-4">
                <!-- Resumo da carga -->
                <div class="rounded-lg border border-lynx-divider dark:border-gray-700 bg-lynx-subtle dark:bg-[#111] px-4 py-3">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-sm font-mono font-bold text-primary-500">${_esc(ref)}</span>
                        <span class="text-xs text-gray-500">${nViat} vehicle${nViat !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="flex items-center gap-2 text-sm lynx-text-primary">
                        <span class="truncate" title="${_esc(origemNome)}">${_esc(origemNome)}</span>
                        <i class="fas fa-arrow-right text-gray-400 text-xs"></i>
                        <span class="truncate" title="${_esc(destinoNome)}">${_esc(destinoNome)}</span>
                    </div>
                </div>

                <!-- Subject -->
                <div>
                    <label class="block text-xs uppercase tracking-wider text-gray-500 mb-1">Subject</label>
                    <input id="rotEmailSubject" type="text" value="${_esc(preview.subject || subject)}"
                        class="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#0a0a0a] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                </div>

                <!-- Para -->
                <div>
                    <label class="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                        <i class="fas fa-paper-plane mr-1"></i> Para
                    </label>
                    <div class="px-3 py-2 rounded-lg bg-white dark:bg-[#0a0a0a] border border-lynx-divider dark:border-gray-700 min-h-[36px]">
                        ${toHtml}
                    </div>
                </div>

                <!-- CC -->
                <div>
                    <label class="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                        <i class="fas fa-users mr-1"></i> Copy (CC)
                    </label>
                    <div class="px-3 py-2 rounded-lg bg-white dark:bg-[#0a0a0a] border border-lynx-divider dark:border-gray-700 min-h-[36px]">
                        ${ccHtml}
                    </div>
                    <p class="mt-1 text-[0.65rem] text-gray-400">Stations included automatically: ${stationsHtml || '<span class="italic">nenhuma</span>'}</p>
                </div>

                <!-- Info bar -->
                <div class="flex items-start gap-2 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300 px-3 py-2 text-xs">
                    <i class="fas fa-info-circle mt-0.5"></i>
                    <span>Outlook opens a draft you can review and edit. The load would be marked as <strong>Requested</strong> after opening the email.</span>
                </div>

                <!-- Buttons -->
                <div class="flex justify-end gap-2 pt-2">
                    <button id="rotEmailCancelBtn" class="px-4 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">
                        Cancel
                    </button>
                    <button id="rotEmailSendBtn" class="px-4 py-2 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600 font-semibold">
                        <i class="fas fa-paper-plane mr-1"></i> Open in Outlook
                    </button>
                </div>
            </div>`;

        document.getElementById('rotEmailCancelBtn').onclick = () => rotCloseModal();
        document.getElementById('rotEmailSendBtn').onclick = async () => {
            const finalSubject = (document.getElementById('rotEmailSubject').value || subject).trim();
            const sendBtn = document.getElementById('rotEmailSendBtn');
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> A abrir Outlook…';

            try {
                const html = _buildEmailHtml(c);
                const mail = await _api('/api/rotation/email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ referencia: ref, subject: finalSubject, body: html })
                });
                if (!mail || !mail.success) {
                    _toast("Error a abrir o Outlook: " + ((mail && mail.error) || 'desconhecido'), 'error');
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = "<i class=\"fas fa-paper-plane mr-1\"></i> Open in Outlook";
                    return;
                }
                if (mail.warning) _toast("Notice: " + mail.warning, 'warning');

                const upd = await _api(`/api/rotation/cargas/${encodeURIComponent(ref)}/estado`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ estado: c.estado === "Pending" ? 'Requested' : c.estado, utilizador: _currentUser() })
                });
                if (upd && upd.success) {
                    const estadoMsg = c.estado === "Pending" ? "Load marked as Requested." : "Email resent.";
                    _toast(`Email aberto (${mail.method}). ${estadoMsg}`, 'success');
                } else {
                    _toast('Email aberto, mas falhou marcar Requested.', 'warning');
                }
                rotCloseModal();
                _loadCargas(ROT.estadoAtual);
                _loadContadores();
            } catch (e) {
                console.error(e);
                _toast("Could not generate the email", 'error');
                sendBtn.disabled = false;
                sendBtn.innerHTML = "<i class=\"fas fa-paper-plane mr-1\"></i> Open in Outlook";
            }
        };
    };

    // ── EMAIL DE SEGUIMENTO (Confirmado) ─────────────────────
    function _buildEmailSeguimentoHtml(c) {
        const origemLbl  = (c.estacao_origem_nome || c.zona_origem || '—') +
                           (c.estacao_origem && c.estacao_origem !== 'OUTRO' ? ` (${c.estacao_origem})` : '');
        const destinoLbl = (c.estacao_destino_nome || c.zona_destino || '—') +
                           (c.estacao_destino && c.estacao_destino !== 'OUTRO' ? ` (${c.estacao_destino})` : '');
        const origemNome  = c.estacao_origem_nome  || c.zona_origem  || '—';
        const dataLev = c.data_levantamento ? _formatDate(c.data_levantamento) : '';
        const dataDes = c.data_entrega      ? _formatDate(c.data_entrega)      : '';
        const viaturas = Array.isArray(c.viaturas) ? c.viaturas : [];
        const _fd = d => d ? `${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(0,4)}` : '';

        // Transportador(es) adjudicados
        const adjList = c.adjudicacoes || [];
        const transportadores = [...new Set(adjList.map(a => a.transportador).filter(Boolean))];
        const transpNomes = transportadores.join(', ');

        let transpHtml = '';
        if (transpNomes) {
            transpHtml = `
    <table width="100%" cellpadding="14" cellspacing="0" style="margin:16px 0;background:#f0f4ff;border:1px solid #93c5fd;">
      <tr><td style="color:#1e3a8a;font-size:13px;">
        <strong>Carrier:</strong> ${_esc(transpNomes)}
      </td></tr>
    </table>`;
        }

        const slabels = {
            local:            { txt: "Available at origin",          color: '#065f46', bg: '#ecfdf5', border: '#6ee7b7' },
            disponivel:       { txt: "Relocation needed",          color: '#1e40af', bg: '#eff6ff', border: '#93c5fd' },
            em_contrato:      { txt: 'Em contrato — aguardar retoma', color: '#92400e', bg: '#fffbeb', border: '#fcd34d' },
            em_contrato_late: { txt: "Overdue contract",             color: '#991b1b', bg: '#fef2f2', border: '#fca5a5' },
            oficina:          { txt: "In workshop — confirmar",        color: '#78350f', bg: '#fffbeb', border: '#fcd34d' },
            sem_matricula:    { txt: "Group — select a vehicle",      color: '#5b21b6', bg: '#f5f3ff', border: '#c4b5fd' },
            desconhecido:     { txt: "No data; check manually",         color: '#374151', bg: '#f9fafb', border: '#d1d5db' },
        };

        const groups = { local: [], disponivel: [], em_contrato: [], em_contrato_late: [], oficina: [], sem_matricula: [], desconhecido: [] };
        viaturas.forEach(v => {
            const st = (v.viatura_info || {}).status || 'desconhecido';
            (groups[st] ? groups[st] : groups.desconhecido).push(v);
        });

        let sectionsHtml = '';
        for (const [st, vlist] of Object.entries(groups)) {
            if (!vlist.length) continue;
            const lbl = slabels[st];
            const rows = vlist.map((v, i) => {
                const info = v.viatura_info || {};
                let nota = '';
                if (st === 'disponivel')
                    nota = `Available${info.station ? ` em <b>${_esc(info.station)}</b>` : ''} — move to <b>${_esc(origemNome)}</b> before ${_esc(dataLev || '—')}`;
                else if (st === 'em_contrato')
                    nota = `Em contrato — retoma${info.station ? ` em <b>${_esc(info.station)}</b>` : ''}${info.data_retorno ? ` a <b>${_fd(info.data_retorno)}</b>` : ''} — wait for return before pickup`;
                else if (st === 'em_contrato_late')
                    nota = `⚠ Overdue contract — retoma${info.station ? ` em <b>${_esc(info.station)}</b>` : ''}${info.data_retorno ? ` (prevista <b>${_fd(info.data_retorno)}</b>)` : ''} — confirmar urgentemente`;
                else if (st === 'oficina')
                    nota = `In workshop${info.station ? ` em <b>${_esc(info.station)}</b>` : ''} — confirm availability date`;
                else if (st === 'local')
                    nota = `Available at <b>${_esc(origemNome)}</b> — prepare for pickup at ${_esc(dataLev || '—')}`;
                else if (st === 'sem_matricula')
                    nota = `Choose and assign a vehicle from this group <b>${_esc(v.grupo || '')}</b> before pickup`;
                else
                    nota = `No data available; check location and availability`;
                const rowBg = i % 2 === 0 ? '#ffffff' : lbl.bg;
                const grp = _esc(v.acriss || v.acri || v.ACRI || '');
                return `<tr style="background:${rowBg}">
                    <td style="padding:7px 10px;border:1px solid ${lbl.border};font-weight:bold;">${_esc(_rotViaturaLabel(v))}</td>
                    <td style="padding:7px 10px;border:1px solid ${lbl.border};font-size:12px;color:#555;">${_esc(v.descricao || v.modelo || '')}</td>
                    <td style="padding:7px 10px;border:1px solid ${lbl.border};font-size:12px;font-weight:bold;color:#ff5f00;text-align:center;">${grp || '—'}</td>
                    <td style="padding:7px 10px;border:1px solid ${lbl.border};font-size:12px;color:${lbl.color};">${nota}</td>
                </tr>`;
            }).join('');
            sectionsHtml += `
            <div style="margin:16px 0;">
              <div style="padding:8px 12px;background:${lbl.bg};border-left:4px solid ${lbl.border};">
                <span style="font-size:13px;font-weight:bold;color:${lbl.color};">${lbl.txt}</span>
                <span style="font-size:12px;color:#888;margin-left:8px;">(${vlist.length} vehicle${vlist.length !== 1 ? 's' : ''})</span>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f3f4f6;">
                  <th style="padding:6px 10px;border:1px solid ${lbl.border};text-align:left;width:110px;">License Plate</th>
                  <th style="padding:6px 10px;border:1px solid ${lbl.border};text-align:left;width:180px;">Description</th>
                  <th style="padding:6px 10px;border:1px solid ${lbl.border};text-align:center;width:65px;">Group</th>
                  <th style="padding:6px 10px;border:1px solid ${lbl.border};text-align:left;">Required Action</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`;
        }

        const obsHtml = (c.observacoes || '').trim()
            ? `<table width="100%" cellpadding="15" cellspacing="0" style="margin:20px 0;background:#fff8e1;border-left:4px solid #f59e0b;">
                <tr><td style="color:#7c5e10;font-size:13px;"><strong>Notes:</strong><br>${_esc(c.observacoes).replace(/\n/g, '<br>')}</td></tr>
               </table>` : '';

        return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;background:#fff;color:#333;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:820px;margin:0 auto;">
  <tr><td style="padding:20px 0;border-bottom:3px solid #059669;">
    <h2 style="margin:0;color:#059669;font-size:20px;">✅ Load Confirmada — Seguimento Operacional</h2>
  </td></tr>
  <tr><td>
    <table width="100%" cellpadding="14" cellspacing="0" style="margin:16px 0;background:#ecfdf5;border:1px solid #6ee7b7;">
      <tr><td style="color:#065f46;font-size:13px;">
        A carga <strong>${_esc(c.referencia)}</strong> has been confirmed. Complete the actions below so the vehicles are available at the pickup location on the scheduled date.
      </td></tr>
    </table>
    ${transpHtml}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr>
        <td width="48%" style="padding:14px;background:#e3f2fd;border:1px solid #90caf9;vertical-align:top;">
          <p style="margin:0 0 4px;font-weight:bold;">Pickup</p>
          <p style="margin:0;font-size:13px;">${_esc(origemLbl)}</p>
          ${dataLev ? `<p style="margin:4px 0 0;font-size:13px;color:#1d4ed8;"><strong>${_esc(dataLev)}</strong></p>` : ''}
        </td>
        <td width="4%"></td>
        <td width="48%" style="padding:14px;background:#f3e5f5;border:1px solid #ce93d8;vertical-align:top;">
          <p style="margin:0 0 4px;font-weight:bold;">Descarga</p>
          <p style="margin:0;font-size:13px;">${_esc(destinoLbl)}</p>
          ${dataDes ? `<p style="margin:4px 0 0;font-size:13px;color:#7c3aed;"><strong>${_esc(dataDes)}</strong></p>` : ''}
        </td>
      </tr>
    </table>
    <h3 style="margin:24px 0 4px;color:#333;font-size:15px;border-bottom:1px solid #ddd;padding-bottom:6px;">Vehicle Status</h3>
    ${sectionsHtml}
    ${obsHtml}
    <table width="100%" cellpadding="15" cellspacing="0" style="margin:24px 0;background:#f0fdf4;border-left:4px solid #22c55e;">
      <tr><td style="color:#166534;font-size:13px;">
        <strong>Please acknowledge this email and confirm the status of these vehicles.</strong>
        Contact the operations coordinator with any questions.
      </td></tr>
    </table>
    <p style="margin:18px 0 0;color:#888;font-size:11px;border-top:1px solid #ddd;padding-top:10px;">
      Automatically generated — Operation Fleet · ${_esc(_formatDateTime(new Date().toISOString()))}
    </p>
  </td></tr>
</table>
</body></html>`;
    }

    window.rotEmailSeguimento = async function (ref) {
        const modal = document.getElementById('rotGenericModal');
        const titleEl = document.getElementById('rotModalTitle');
        const bodyEl  = document.getElementById('rotModalBody');
        if (!modal) { _toast("Dialog not found", 'error'); return; }
        titleEl.textContent = "Follow-Up Email";
        bodyEl.innerHTML = `<div class="flex items-center justify-center py-10 text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i> Preparing recipients…</div>`;
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // Always fetch fresh carga data so dates/adjudicações reflect latest edits
        let c;
        try {
            const fresh = await _api(`/api/rotation/cargas/${encodeURIComponent(ref)}`);
            c = (fresh && fresh.carga) ? fresh.carga : ROT.cargas.find(x => x.referencia === ref);
        } catch (_) {
            c = ROT.cargas.find(x => x.referencia === ref);
        }
        if (!c) {
            bodyEl.innerHTML = `<div class="text-red-500 text-sm py-6 text-center">Load not found.</div>`;
            return;
        }
        // Update in-memory list too
        const idx = ROT.cargas.findIndex(x => x.referencia === ref);
        if (idx >= 0) ROT.cargas[idx] = c;

        const subject = `[Seguimento] Load Confirmada — ${ref} · Lev. ${c.data_levantamento ? _formatDate(c.data_levantamento) : '—'}`;

        let preview;
        try {
            preview = await _api('/api/rotation/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ referencia: ref, subject, preview: true, seguimento: true })
            });
        } catch (e) {
            bodyEl.innerHTML = `<div class="text-red-500 text-sm py-6 text-center">Connection error: ${_esc(String(e))}</div>`;
            return;
        }
        if (!preview || !preview.success) {
            bodyEl.innerHTML = `<div class="text-red-500 text-sm py-6 text-center">${_esc((preview && preview.error) || "Unknown error")}</div>`;
            return;
        }

        const toList = preview.to || [];
        const ccList = preview.cc || [];
        const chip = (e, color) => `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${color} mr-1 mb-1"><i class="fas fa-envelope text-[0.6rem]"></i> ${_esc(e)}</span>`;
        const toHtml = toList.length ? toList.map(e => chip(e, 'bg-primary-500/10 text-primary-600 dark:text-primary-300')).join('') : '<span class="text-xs text-gray-400 italic">— vazio —</span>';
        const ccHtml = ccList.length ? ccList.map(e => chip(e, 'bg-blue-500/10 text-blue-600 dark:text-blue-300')).join('') : '<span class="text-xs text-gray-400 italic">— vazio —</span>';

        const origemNome  = c.estacao_origem_nome  || c.zona_origem  || '—';
        const destinoNome = c.estacao_destino_nome || c.zona_destino || '—';
        const nViat = (c.viaturas || []).length;
        const transpNomesPreview = [...new Set((c.adjudicacoes || []).map(a => a.transportador).filter(Boolean))].join(', ');
        const needsAction = (c.viaturas || []).filter(v => {
            const st = (v.viatura_info || {}).status;
            return !st || st === 'desconhecido' || st === 'disponivel' || st === 'em_contrato' || st === 'em_contrato_late' || st === 'oficina';
        });
        const actionBadge = needsAction.length
            ? `<span class="ml-2 text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">${needsAction.length} with pending actions</span>`
            : `<span class="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">all available</span>`;

        bodyEl.innerHTML = `
            <div class="space-y-4">
                <div class="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3">
                    <div class="flex items-center gap-2 mb-1">
                        <i class="fas fa-check-circle text-emerald-500"></i>
                        <span class="text-sm font-bold text-emerald-700 dark:text-emerald-300">${_esc(ref)}</span>
                        ${actionBadge}
                    </div>
                    <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <span>${_esc(origemNome)}</span>
                        <i class="fas fa-arrow-right text-gray-400 text-xs"></i>
                        <span>${_esc(destinoNome)}</span>
                        <span class="text-gray-400">·</span>
                        <span>${nViat} vehicle${nViat !== 1 ? 's' : ''}</span>
                        ${transpNomesPreview ? `<span class="text-gray-400">·</span><span class="text-blue-600 dark:text-blue-400"><i class="fas fa-truck mr-1"></i>${_esc(transpNomesPreview)}</span>` : ''}
                    </div>
                </div>
                <div>
                    <label class="block text-xs uppercase tracking-wider text-gray-500 mb-1">Subject</label>
                    <input id="rotSeguimentoSubject" type="text" value="${_esc(subject)}"
                        class="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#0a0a0a] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                </div>
                <div>
                    <label class="block text-xs uppercase tracking-wider text-gray-500 mb-1"><i class="fas fa-paper-plane mr-1"></i> Para</label>
                    <div class="px-3 py-2 rounded-lg bg-white dark:bg-[#0a0a0a] border border-lynx-divider dark:border-gray-700 min-h-[36px]">${toHtml}</div>
                </div>
                <div>
                    <label class="block text-xs uppercase tracking-wider text-gray-500 mb-1"><i class="fas fa-users mr-1"></i> Copy (CC)</label>
                    <div class="px-3 py-2 rounded-lg bg-white dark:bg-[#0a0a0a] border border-lynx-divider dark:border-gray-700 min-h-[36px]">${ccHtml}</div>
                </div>
                <div class="flex items-start gap-2 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-2 text-xs">
                    <i class="fas fa-bell mt-0.5"></i>
                    <span>Operational follow-up preview with vehicle statuses and actions needed before pickup.</span>
                </div>
                <div class="flex justify-end gap-2 pt-2">
                    <button id="rotSeguimentoCancelBtn" class="px-4 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                    <button id="rotSeguimentoSendBtn" class="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-semibold">
                        <i class="fas fa-paper-plane mr-1"></i> Open in Outlook
                    </button>
                </div>
            </div>`;

        document.getElementById('rotSeguimentoCancelBtn').onclick = () => rotCloseModal();
        document.getElementById('rotSeguimentoSendBtn').onclick = async () => {
            const finalSubject = (document.getElementById('rotSeguimentoSubject').value || subject).trim();
            const sendBtn = document.getElementById('rotSeguimentoSendBtn');
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> A abrir Outlook…';
            try {
                const html = _buildEmailSeguimentoHtml(c);
                const mail = await _api('/api/rotation/email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ referencia: ref, subject: finalSubject, body: html, seguimento: true })
                });
                if (!mail || !mail.success) {
                    _toast("Error a abrir o Outlook: " + ((mail && mail.error) || 'desconhecido'), 'error');
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = "<i class=\"fas fa-paper-plane mr-1\"></i> Open in Outlook";
                    return;
                }
                if (mail.warning) _toast("Notice: " + mail.warning, 'warning');
                _toast("Follow-up email opened in Outlook.", 'success');
                rotCloseModal();
                _loadCargas(ROT.estadoAtual);
                _loadContadores();
            } catch (e) {
                console.error(e);
                _toast("Could not generate the email", 'error');
                sendBtn.disabled = false;
                sendBtn.innerHTML = "<i class=\"fas fa-paper-plane mr-1\"></i> Open in Outlook";
            }
        };
    };

    // ── ADJUDICAR (modal) ───────────────────────────────────────
    window.rotAdjudicar = async function (ref) {
        const carga = ROT.cargas.find(c => c.referencia === ref);
        if (!carga) return;

        const alreadyAdj = (carga.adjudicacoes || []).flatMap(a => a.viaturas || []);
        const available = (carga.viaturas || []).filter(v => !alreadyAdj.includes(v.matricula));

        // Count existing variantes so we can show next V number
        const existingV = ROT.cargas.filter(c => c.pai === ref).length;
        const nextV = existingV + 1;

        const modal = document.getElementById('rotGenericModal');
        const title = document.getElementById('rotModalTitle');
        const body = document.getElementById('rotModalBody');
        if (!modal) return;

        title.textContent = `Adjudicar — ${ref}`;
        body.innerHTML = `
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Carrier <span class="text-red-400">*</span></label>
                    <input id="rotAdjTransp" type="text" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary" placeholder="Carrier name">
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Pickup Date</label>
                        <input id="rotAdjDataLev" type="date" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Delivery Date</label>
                        <input id="rotAdjDataEnt" type="date" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Price / Vehicle (€)</label>
                        <input id="rotAdjPreco" type="number" step="0.01" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary" placeholder="0.00">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Notes</label>
                        <input id="rotAdjObs" type="text" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary" placeholder="">
                    </div>
                </div>
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <label class="text-sm font-medium text-gray-600 dark:text-gray-300">Vehicles a confirmar</label>
                        <div class="flex items-center gap-2">
                            <button type="button" onclick="rotAdjSelAll(true)"  class="text-xs text-primary-500 hover:underline">All</button>
                            <span class="text-gray-300">|</span>
                            <button type="button" onclick="rotAdjSelAll(false)" class="text-xs text-gray-400 hover:underline">None</button>
                            <span id="rotAdjCount" class="text-xs text-gray-400 ml-2"></span>
                        </div>
                    </div>
                    <div class="space-y-1 max-h-48 overflow-y-auto">
                        ${available.length === 0 ? "<p class=\"text-gray-400 text-sm italic\">All vehicles have already been assigned to a carrier.</p>" :
                available.map(v => `
                            <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 p-1.5 rounded hover:bg-lynx-subtle dark:hover:bg-gray-800 cursor-pointer">
                                <input type="checkbox" class="rotAdjCheck" value="${_esc(v.matricula)}" checked onchange="rotAdjUpdateCount()">
                                <span class="font-mono font-semibold ${v.sem_matricula ? 'text-amber-500' : 'text-primary-500'}">${_esc(_rotViaturaLabel(v))}</span>
                                <span class="text-gray-400">${_esc(v.descricao || '')}</span>
                            </label>`).join('')}
                    </div>
                    <p id="rotAdjHint" class="mt-2 text-[0.7rem] text-teal-500 hidden">
                        <i class="fas fa-code-branch mr-1"></i>Partial selection; a split load will be created: <strong>${ref}-V${nextV}</strong>. The remaining vehicles stay in the parent load.
                    </p>
                </div>
                <div class="flex justify-end gap-3 pt-3">
                    <button onclick="rotCloseModal()" class="px-4 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                    <button id="rotAdjBtn" onclick="rotGuardarAdjudicacao('${_esc(ref)}', ${available.length})" class="px-4 py-2 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600 font-medium">
                        <i class="fas fa-handshake mr-1"></i>Adjudicar
                    </button>
                </div>
            </div>`;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        rotAdjUpdateCount();
    };

    window.rotAdjSelAll = function(state) {
        document.querySelectorAll('.rotAdjCheck').forEach(cb => { cb.checked = state; });
        rotAdjUpdateCount();
    };

    window.rotAdjUpdateCount = function() {
        const all  = document.querySelectorAll('.rotAdjCheck');
        const sel  = document.querySelectorAll('.rotAdjCheck:checked');
        const hint = document.getElementById('rotAdjHint');
        const btn  = document.getElementById('rotAdjBtn');
        const count = document.getElementById('rotAdjCount');
        if (count) count.textContent = `${sel.length}/${all.length} selec.`;
        const partial = sel.length > 0 && sel.length < all.length;
        if (hint) hint.classList.toggle('hidden', !partial);
        if (btn) {
            btn.innerHTML = partial
                ? "<i class=\"fas fa-code-branch mr-1\"></i>Create Split Load"
                : '<i class="fas fa-handshake mr-1"></i>Adjudicar';
        }
    };

    window.rotGuardarAdjudicacao = async function (ref, totalAvail) {
        const transp = document.getElementById('rotAdjTransp')?.value.trim();
        if (!transp) { _toast("Enter the carrier name", 'error'); return; }
        const viaturas = Array.from(document.querySelectorAll('.rotAdjCheck:checked')).map(cb => cb.value);
        if (viaturas.length === 0) { _toast("Select at least one vehicle", 'error'); return; }

        const carga = ROT.cargas.find(c => c.referencia === ref);
        if (!carga) return;

        const adjData = {
            transportador: transp,
            data_levantamento: document.getElementById('rotAdjDataLev')?.value || null,
            data_entrega: document.getElementById('rotAdjDataEnt')?.value || null,
            preco_viatura: parseFloat(document.getElementById('rotAdjPreco')?.value) || 0,
            observacoes: document.getElementById('rotAdjObs')?.value || '',
        };

        const isPartial = viaturas.length < totalAvail;

        try {
            if (isPartial) {
                // Split: create child variante
                const json = await _api(`/api/rotation/cargas/${ref}/split`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ viaturas, adjudicacao: adjData, utilizador: _currentUser() })
                });
                if (json.success) {
                    _toast(`Split Load ${json.nova_ref} criada (${viaturas.length} vehicle${viaturas.length > 1 ? 's' : ''})`, 'success');
                    rotCloseModal();
                    _loadCargas(ROT.estadoAtual);
                    _loadContadores();
                } else {
                    _toast(json.error || "Could not create the split load", 'error');
                }
            } else {
                // All selected → normal adjudicar on parent
                const adj = [...(carga.adjudicacoes || [])];
                adj.push({
                    transportador: adjData.transportador,
                    viaturas,
                    data_levantamento: adjData.data_levantamento,
                    data_entrega: adjData.data_entrega,
                    preco_viatura: adjData.preco_viatura,
                    preco_total: adjData.preco_viatura * viaturas.length,
                    observacoes: adjData.observacoes,
                    data_adjudicado: new Date().toISOString()
                });
                const json = await _api(`/api/rotation/cargas/${ref}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        adjudicacoes: adj,
                        estado: "Confirmed",
                        utilizador: _currentUser(),
                        // Update carga dates from adjudicação if provided
                        ...(adjData.data_levantamento ? { data_levantamento: adjData.data_levantamento } : {}),
                        ...(adjData.data_entrega ? { data_entrega: adjData.data_entrega } : {}),
                    })
                });
                if (json.success) {
                    _toast("Carrier assignment saved", 'success');
                    rotCloseModal();
                    _loadCargas(ROT.estadoAtual);
                    _loadContadores();
                }
            }
        } catch (e) { _toast("Connection error", 'error'); }
    };

    // ── REGISTAR TRÂNSITO (modal) ───────────────────────────────
    window.rotRegistarTransito = async function (ref) {
        const carga = ROT.cargas.find(c => c.referencia === ref);
        if (!carga) return;

        const guiasExist = (carga.guias || []).flatMap(g => g.viaturas || []);
        const available = (carga.viaturas || []).filter(v => !guiasExist.includes(v.matricula));

        const modal = document.getElementById('rotGenericModal');
        const title = document.getElementById('rotModalTitle');
        const body = document.getElementById('rotModalBody');
        if (!modal) return;

        title.textContent = `Record Transit — ${ref}`;
        body.innerHTML = `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Dispatch Note No. <span class="text-red-400">*</span></label>
                        <input id="rotGuiaNum" type="text" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary" placeholder="GT-2026-001">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Departure Date</label>
                        <input id="rotGuiaData" type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">Vehicles in transit</label>
                    <div class="space-y-1 max-h-48 overflow-y-auto">
                        ${available.length === 0 ? "<p class=\"text-gray-400 text-sm italic\">All vehicles have already been added to dispatch notes.</p>" :
                available.map(v => `
                            <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 p-1.5 rounded hover:bg-lynx-subtle dark:hover:bg-gray-800 cursor-pointer">
                                <input type="checkbox" class="rotTransCheck" value="${_esc(v.matricula)}" checked>
                                <span class="font-mono font-semibold ${v.sem_matricula ? 'text-amber-500' : 'text-primary-500'}">${_esc(_rotViaturaLabel(v))}</span>
                                <span class="text-gray-400">${_esc(v.descricao || '')}</span>
                            </label>`).join('')}
                    </div>
                </div>
                <div class="flex justify-end gap-3 pt-3">
                    <button onclick="rotCloseModal()" class="px-4 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                    <button onclick="rotGuardarTransito('${_esc(ref)}')" class="px-4 py-2 text-sm rounded-lg bg-orange-500 text-white hover:bg-orange-600 font-medium">
                        <i class="fas fa-truck-moving mr-1"></i>Confirm Transit
                    </button>
                </div>
            </div>`;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    };

    window.rotGuardarTransito = async function (ref) {
        const num = document.getElementById('rotGuiaNum')?.value.trim();
        if (!num) { _toast("Enter the dispatch note number", 'error'); return; }
        const viaturas = Array.from(document.querySelectorAll('.rotTransCheck:checked')).map(cb => cb.value);
        if (viaturas.length === 0) { _toast("Select at least one vehicle", 'error'); return; }

        const carga = ROT.cargas.find(c => c.referencia === ref);
        if (!carga) return;

        const guias = [...(carga.guias || [])];
        guias.push({
            numero: num,
            data_partida: document.getElementById('rotGuiaData')?.value || null,
            data_entrega: null,
            viaturas,
            estado: "In Transit",
            data_registo: new Date().toISOString()
        });

        try {
            const json = await _api(`/api/rotation/cargas/${ref}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guias, estado: "In Transit", utilizador: _currentUser() })
            });
            if (json.success) {
                _toast("Transit recorded", 'success');
                rotCloseModal();
                _loadCargas(ROT.estadoAtual);
                _loadContadores();
            }
        } catch (e) { _toast("Connection error", 'error'); }
    };

    // ── CONCLUIR CARGA (modal) ──────────────────────────────────
    window.rotConcluirCarga = async function (ref) {
        const carga = ROT.cargas.find(c => c.referencia === ref);
        if (!carga) return;

        // Any vehicle with a guia has already been dispatched (whether that guia is
        // still "In Transit" or already "Entregue" from an earlier attempt) —
        // vehicles with no guia at all are the only ones still waiting for
        // transport, and must not be swept in.
        const matriculasDespachadas = (carga.guias || []).flatMap(g => g.viaturas || []);
        if (matriculasDespachadas.length === 0) {
            _toast("No dispatch note is available to complete", 'error');
            return;
        }
        const pendentes = (carga.viaturas || []).filter(v => !matriculasDespachadas.includes(v.matricula));

        const modal = document.getElementById('rotGenericModal');
        const title = document.getElementById('rotModalTitle');
        const body = document.getElementById('rotModalBody');
        if (!modal) return;

        title.textContent = `Concluir Transport — ${ref}`;
        body.innerHTML = `
            <div class="space-y-4">
                <div class="bg-green-500/5 border border-green-500/20 rounded-lg p-4">
                    <p class="text-sm text-gray-600 dark:text-gray-300">
                        <i class="fas fa-info-circle text-green-500 mr-2"></i>
                        Confirm delivery of ${matriculasDespachadas.length} vehicle(s) (${matriculasDespachadas.map(m => _esc(_rotViaturaLabel((carga.viaturas || []).find(v => v.matricula === m)) || m)).join(', ')}) at destination <strong>${_esc(carga.estacao_destino_nome || carga.zona_destino)}</strong>.
                    </p>
                </div>
                ${pendentes.length > 0 ? `
                <div class="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
                    <p class="text-sm text-amber-600 dark:text-amber-400">
                        <i class="fas fa-triangle-exclamation mr-2"></i>
                        ${pendentes.length} vehicle(s) ainda aguardam transporte (${pendentes.map(v => _esc(_rotViaturaLabel(v))).join(', ')}) e ficam nesta carga (${_esc(ref)}), which returns to "Confirmed". Delivered vehicles move to a new, completed split load.
                    </p>
                </div>` : ''}
                <div>
                    <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Delivery Date</label>
                    <input id="rotConcData" type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Notes</label>
                    <textarea id="rotConcObs" rows="2" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary resize-none" placeholder="All delivered in good condition…"></textarea>
                </div>
                <div class="flex justify-end gap-3 pt-3">
                    <button onclick="rotCloseModal()" class="px-4 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                    <button onclick="rotGuardarConclusao('${_esc(ref)}')" class="px-4 py-2 text-sm rounded-lg bg-green-500 text-white hover:bg-green-600 font-medium">
                        <i class="fas fa-check-double mr-1"></i>Concluir
                    </button>
                </div>
            </div>`;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    };

    window.rotGuardarConclusao = async function (ref) {
        const dataEntrega = document.getElementById('rotConcData')?.value;
        const obs = document.getElementById('rotConcObs')?.value || '';

        const carga = ROT.cargas.find(c => c.referencia === ref);
        if (!carga) return;

        try {
            // Server splits off a concluded variante for the in-transit vehicles when
            // some vehicles in the carga still have no guia (never dispatched) —
            // same mechanism used for partial adjudicações — so the parent never
            // gets marked "Completed" while part of its load is still at the origin.
            const json = await _api(`/api/rotation/cargas/${ref}/concluir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data_entrega: dataEntrega, observacoes: obs, utilizador: _currentUser() })
            });
            if (json.success) {
                _toast(json.nova_ref
                    ? `Delivered vehicle(s) — completed on ${json.nova_ref}, the remainder stays in ${ref}`
                    : "Load completed successfully!", 'success');
                rotCloseModal();
                // Auto-conclude parent if all variantes are now Concluído (only when
                // this carga concluded in place, i.e. no new variante was created)
                if (!json.nova_ref && carga.pai) {
                    const pai = ROT.cargas.find(p => p.referencia === carga.pai);
                    if (pai && (pai.estado === "Split" || pai.estado === 'Requested')) {
                        const irmas = ROT.cargas.filter(x => x.pai === pai.referencia);
                        // Include this variante as Concluído (not yet updated in ROT.cargas)
                        const todasConcluidas = irmas.every(x => x.referencia === ref || x.estado === "Completed");
                        if (todasConcluidas && irmas.length > 0 && pai.num_viaturas === 0) {
                            try {
                                await _api(`/api/rotation/cargas/${pai.referencia}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ estado: "Completed", utilizador: _currentUser() })
                                });
                            } catch (_) { /* silent */ }
                        }
                    }
                }
                _loadCargas(ROT.estadoAtual);
                _loadContadores();
            } else {
                _toast(json.error || "Could not complete the load", 'error');
            }
        } catch (e) { _toast("Connection error", 'error'); }
    };

    // ── EDITAR CARGA ────────────────────────────────────────────
    // ── EDIT VIATURAS STATE ──────────────────────────────────────
    ROT.editViaturas = [];   // working copy during edit

    function _lookupViaturaInfo(mat) {
        const rawData = (window.NAF && window.NAF.rawData) || [];
        const found = rawData.find(v => (v.licensePlate || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === mat.replace(/[^A-Z0-9]/g, ''));
        if (!found) return { descricao: '', marca: '', modelo: '', acriss: '', categoria: '', branch: '', branchCode: '' };
        return {
            descricao: found.displayName || `${found.make || ''} ${found.model || ''}`.trim() || '',
            marca: found.make || '',
            modelo: found.model || '',
            acriss: (found.acrissCode || '').substring(0, 4),
            categoria: found.vehicleCategory || '',
            branch: (found.branch && found.branch.name) || '',
            branchCode: (found.branch && found.branch.number) || '',
        };
    }

    function _renderEditViaturas() {
        const el = document.getElementById('rotEditViaturasBody');
        if (!el) return;
        if (!ROT.editViaturas.length) {
            el.innerHTML = "<div class=\"text-xs text-gray-400 italic py-2\">None viatura.</div>";
            const badge = document.getElementById('rotEditViaturasBadge');
            if (badge) badge.textContent = '0';
            return;
        }
        const badge = document.getElementById('rotEditViaturasBadge');
        if (badge) badge.textContent = ROT.editViaturas.length;

        el.innerHTML = ROT.editViaturas.map((v, i) => {
            return `
            <tr class="border-b border-gray-100 dark:border-gray-700/50 text-xs group">
                <td class="py-1.5 px-2">
                    ${v._editing
                        ? `<input id="rotEditMat_${i}" class="font-mono font-bold text-primary-500 bg-lynx-subtle dark:bg-[#111] border border-primary-500 rounded px-1.5 py-0.5 w-24 uppercase text-xs"
                               value="${_esc(v.matricula)}"
                               onkeydown="if(event.key==='Enter')rotEditConfirmarAlteracao(${i})"
                               placeholder="XX-00-XX">`
                        : `<span class="font-mono font-bold ${v.sem_matricula ? 'text-amber-500' : 'text-primary-500'}">${_esc(_rotViaturaLabel(v))}</span>`
                    }
                </td>
                <td class="py-1.5 px-2 text-gray-500 dark:text-gray-400 max-w-[140px] truncate" title="${_esc(v.descricao)}">${_esc(v.descricao) || '<span class="italic text-gray-300">N/A</span>'}</td>
                <td class="py-1.5 px-2 text-center"><span class="font-mono bg-lynx-subtle dark:bg-gray-700 px-1 py-0.5 rounded text-[0.6rem]">${_esc(v.acriss) || '—'}</span></td>
                <td class="py-1.5 px-2 text-right whitespace-nowrap">
                    ${v._editing
                        ? `<button onclick="rotEditConfirmarAlteracao(${i})" class="text-emerald-500 hover:text-emerald-400 mr-2" title="Confirm"><i class="fas fa-check text-xs"></i></button>
                           <button onclick="rotEditCancelarAlteracao(${i})" class="text-gray-400 hover:text-gray-500" title="Cancel"><i class="fas fa-times text-xs"></i></button>`
                        : `<button onclick="rotEditIniciarAlteracao(${i})" class="text-blue-400 hover:text-blue-500 mr-2 opacity-0 group-hover:opacity-100 transition-opacity" title="Change license plate"><i class="fas fa-exchange-alt text-xs"></i></button>
                           <button onclick="rotEditRemoverViatura(${i})" class="text-red-400 hover:text-red-500" title="Remove viatura"><i class="fas fa-trash text-xs"></i></button>`
                    }
                </td>
            </tr>`;
        }).join('');
    }

    window.rotEditIniciarAlteracao = function (i) {
        ROT.editViaturas[i]._editing = true;
        ROT.editViaturas[i]._matOriginal = ROT.editViaturas[i].matricula;
        _renderEditViaturas();
        setTimeout(() => document.getElementById(`rotEditMat_${i}`)?.focus(), 50);
    };

    window.rotEditConfirmarAlteracao = async function (i) {
        const input = document.getElementById(`rotEditMat_${i}`);
        const raw = (input?.value || '').trim();
        if (!raw) { _toast("Enter a valid license plate or group", 'error'); return; }
        const v = ROT.editViaturas[i];

        // "Só grupo" — troca esta linha para uma viatura de exemplo do grupo.
        if (_rotIsGroupToken(raw)) {
            const grupo = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const res = await _rotResolveGroup(grupo);
            if (!res.success) { _toast(res.error || "Unknown group", 'error'); return; }
            const top = res.top_model;
            ROT.editViaturas[i] = {
                ...v,
                matricula: _rotMakeSemMatricula(ROT.editViaturas.filter((_, j) => j !== i), grupo),
                sem_matricula: true, grupo,
                descricao: top ? `${top.brand} ${top.model} (viatura similar)` : `Group ${grupo} (no example available)`,
                marca: top ? top.brand : '', modelo: top ? top.model : '',
                acriss: grupo, categoria: '', branch: '', branchCode: '',
                _editing: false, _matOriginal: undefined,
            };
            _renderEditViaturas();
            return;
        }

        const novaMat = raw.toUpperCase().replace(/[^A-Z0-9\-]/g, '').trim();
        if (!novaMat) { _toast("Enter a valid license plate", 'error'); return; }
        const oldMat = ROT.editViaturas[i]._matOriginal;
        if (novaMat === oldMat) { ROT.editViaturas[i]._editing = false; _renderEditViaturas(); return; }
        // Check for duplicate
        if (ROT.editViaturas.some((vv, j) => j !== i && vv.matricula === novaMat)) {
            _toast("License plate already exists in this load", 'error'); return;
        }
        const info = _lookupViaturaInfo(novaMat);
        if (!info.descricao) _toast("License plate not found in the demo; added without vehicle details", 'warning');
        ROT.editViaturas[i] = {
            ...v, ...info, matricula: novaMat, sem_matricula: false, grupo: '',
            _editing: false, _matOriginal: undefined,
        };
        _renderEditViaturas();
    };

    window.rotEditCancelarAlteracao = function (i) {
        ROT.editViaturas[i]._editing = false;
        ROT.editViaturas[i]._matOriginal = undefined;
        _renderEditViaturas();
    };

    window.rotEditRemoverViatura = function (i) {
        ROT.editViaturas.splice(i, 1);
        _renderEditViaturas();
    };

    window.rotEditAdicionarViatura = async function () {
        const input = document.getElementById('rotEditAddMatInput');
        const raw = (input?.value || '').trim();
        if (!raw) return;

        const cfg = window.NAF_STATION_CFG || {};
        const ccs = cfg.centros_custo || [];

        // "Só grupo" — ainda não se sabe a matrícula exacta.
        if (_rotIsGroupToken(raw)) {
            const grupo = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const res = await _rotResolveGroup(grupo);
            if (!res.success) { _toast(res.error || "Unknown group", 'error'); return; }
            const top = res.top_model;
            ROT.editViaturas.push({
                matricula: _rotMakeSemMatricula(ROT.editViaturas, grupo),
                sem_matricula: true, grupo,
                descricao: top ? `${top.brand} ${top.model} (viatura similar)` : `Group ${grupo} (no example available)`,
                marca: top ? top.brand : '', modelo: top ? top.model : '',
                acriss: grupo, categoria: '', branch: '', branchCode: '',
                centro_custo: ccs[0] || '',
                urgencia: 'Normal (48h)',
                motivo: "Transfer",
            });
            input.value = '';
            input.focus();
            _renderEditViaturas();
            return;
        }

        const mat = raw.toUpperCase().replace(/[^A-Z0-9\-]/g, '').trim();
        if (!mat) return;
        if (ROT.editViaturas.some(v => v.matricula === mat)) {
            _toast("License plate already exists in this load", 'warning'); return;
        }
        // Warn if in another active carga
        const matNorm = mat.replace(/[^A-Z0-9]/g, '');
        const activeCarga = (ROT.cargas || []).find(c =>
            !["Completed", "Cancelled"].includes(c.estado) &&
            c.referencia !== document.getElementById('rotModalTitle')?.textContent.split('—')[1]?.trim() &&
            (c.viaturas || []).some(v => (v.matricula || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === matNorm)
        );
        if (activeCarga) _toast(`Attention: ${mat} is already in load ${activeCarga.referencia}`, 'warning');

        const info = _lookupViaturaInfo(mat);
        if (!info.descricao) _toast("License plate not found in the demo; added without vehicle details", 'warning');

        ROT.editViaturas.push({
            matricula: mat, sem_matricula: false, grupo: '', ...info,
            centro_custo: ccs[0] || '',
            urgencia: 'Normal (48h)',
            motivo: "Transfer",
        });
        input.value = '';
        input.focus();
        _renderEditViaturas();
    };

    window.rotEditarCarga = async function (ref) {
        const carga = ROT.cargas.find(c => c.referencia === ref);
        if (!carga) return;

        const modal = document.getElementById('rotGenericModal');
        const title = document.getElementById('rotModalTitle');
        const body = document.getElementById('rotModalBody');
        if (!modal) return;

        // Clone viaturas into working state (strip viatura_info runtime data)
        ROT.editViaturas = (carga.viaturas || []).map(v => ({ ...v, _editing: false }));

        title.textContent = `Edit Load — ${ref}`;
        body.innerHTML = `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Origin Station</label>
                        <select id="rotEditOrigem" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                            ${_stationsTransporteHtml(carga.estacao_origem || '')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Destination Station</label>
                        <select id="rotEditDestino" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                            ${_stationsTransporteHtml(carga.estacao_destino || '')}
                        </select>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Reason</label>
                        <select id="rotEditMotivo" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                            ${MOTIVO_OPTS.map(m => `<option value="${m}"${m === carga.motivo ? ' selected' : ''}>${m}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Status</label>
                        <select id="rotEditEstado" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                            ${ESTADOS.map(e => `<option value="${e}"${e === carga.estado ? ' selected' : ''}>${e}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Pickup Date</label>
                        <input id="rotEditDataLev" type="date" value="${carga.data_levantamento ? carga.data_levantamento.slice(0,10) : ''}" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Delivery Date</label>
                        <input id="rotEditDataEnt" type="date" value="${carga.data_entrega ? carga.data_entrega.slice(0,10) : ''}" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary">
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Notes</label>
                    <textarea id="rotEditObs" rows="2" class="w-full px-3 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary resize-none">${_esc(carga.observacoes || '')}</textarea>
                </div>

                <!-- ── VIATURAS ── -->
                <div class="border border-lynx-divider dark:border-gray-700 rounded-lg overflow-hidden">
                    <div class="flex items-center justify-between px-3 py-2 bg-lynx-subtle dark:bg-[#111] border-b border-lynx-divider dark:border-gray-700">
                        <span class="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                            <i class="fas fa-car mr-1 text-gray-400"></i>Vehicles
                            <span id="rotEditViaturasBadge" class="ml-1 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold">${(carga.viaturas || []).length}</span>
                        </span>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-xs">
                            <thead><tr class="text-[0.6rem] uppercase tracking-wider text-gray-400 bg-gray-50 dark:bg-gray-800/50">
                                <th class="py-1.5 px-2 text-left">License Plate</th>
                                <th class="py-1.5 px-2 text-left">Description</th>
                                <th class="py-1.5 px-2 text-center">ACRISS</th>
                                    <th class="py-1.5 px-2"></th>
                            </tr></thead>
                            <tbody id="rotEditViaturasBody"></tbody>
                        </table>
                    </div>
                    <!-- Add vehicle row -->
                    <div class="flex items-center gap-2 px-3 py-2 border-t border-lynx-divider dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/20">
                        <input id="rotEditAddMatInput" type="text" placeholder="License Plate or Group (e.g. IFAR)"
                            title="Enter a license plate or a group code if a vehicle has not been selected"
                            class="flex-1 px-2 py-1.5 text-xs rounded-md bg-lynx-subtle dark:bg-[#111] border border-lynx-divider dark:border-gray-700 lynx-text-primary font-mono uppercase"
                            onkeydown="if(event.key==='Enter')rotEditAdicionarViatura()"
                            oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9\\-]/g,'')">
                        <button onclick="rotEditAdicionarViatura()"
                            class="flex-none px-3 py-1.5 text-xs rounded-md bg-primary-500 text-white hover:bg-primary-600 font-medium">
                            <i class="fas fa-plus mr-1"></i>Add
                        </button>
                    </div>
                </div>

                <div class="flex justify-end gap-3 pt-1">
                    <button onclick="rotCloseModal()" class="px-4 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                    <button onclick="rotSalvarEdicao('${_esc(ref)}')" class="px-4 py-2 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600 font-medium">
                        <i class="fas fa-save mr-1"></i>Save
                    </button>
                </div>
            </div>`;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        // Render viaturas table after DOM is ready
        _renderEditViaturas();
    };

    window.rotSalvarEdicao = async function (ref) {
        // Block save if any row is in edit mode
        if (ROT.editViaturas.some(v => v._editing)) {
            _toast("Confirm the license plate change before saving", 'warning'); return;
        }
        if (ROT.editViaturas.length === 0) {
            _toast("A load must contain at least one vehicle", 'error'); return;
        }

        const estOrigem = document.getElementById('rotEditOrigem')?.value;
        const estDestino = document.getElementById('rotEditDestino')?.value;
        const origemInfo = _getStationInfo(estOrigem);
        const destinoInfo = _getStationInfo(estDestino);

        // Strip internal state flags before sending
        const viaturas = ROT.editViaturas.map(({ _editing, _matOriginal, ...rest }) => rest);

        const data = {
            zona_origem: origemInfo.zona || origemInfo.nome,
            zona_destino: destinoInfo.zona || destinoInfo.nome,
            estacao_origem: estOrigem,
            estacao_destino: estDestino,
            estacao_origem_nome: origemInfo.nome,
            estacao_destino_nome: destinoInfo.nome,
            motivo: document.getElementById('rotEditMotivo')?.value,
            estado: document.getElementById('rotEditEstado')?.value,
            data_levantamento: document.getElementById('rotEditDataLev')?.value || null,
            data_entrega: document.getElementById('rotEditDataEnt')?.value || null,
            observacoes: document.getElementById('rotEditObs')?.value,
            viaturas,
            utilizador: _currentUser(),
        };
        try {
            const json = await _api(`/api/rotation/cargas/${ref}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (json.success) {
                _toast("Load updated", 'success');
                rotCloseModal();
                _loadCargas(ROT.estadoAtual);
                _loadContadores();
            } else {
                _toast("Error: " + (json.error || 'desconhecido'), 'error');
            }
        } catch (e) { _toast("Connection error", 'error'); }
    };

    // ── ELIMINAR CARGA ──────────────────────────────────────────
    window.rotEliminarCarga = async function (ref) {
        if (!confirm(`Delete load ${ref}?`)) return;
        try {
            const json = await _api(`/api/rotation/cargas/${ref}?utilizador=${encodeURIComponent(_currentUser())}`, { method: 'DELETE' });
            if (json.success) {
                _toast("Load deleted", 'success');
                _loadCargas(ROT.estadoAtual);
                _loadContadores();
            }
        } catch (e) { _toast("Connection error", 'error'); }
    };

    // ── VERIFICAR Demo ──────────────────────────────────────────
    window.rotVerificarCarga = async function (ref) {
        _toast("Checking vehicles in the demo…", 'info');
        const menu = document.getElementById('rotMenu_' + ref);
        if (menu) menu.classList.add('hidden');
        try {
            const json = await _api(`/api/rotation/cargas/${ref}/verificar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ utilizador: _currentUser() }),
            });
            if (!json.success) { _toast(json.error || "Verification failed", 'error'); return; }

            const counts = json.counts || {};
            const chegaram = json.chegaram || [];
            let parts = [];
            const LABELS = { local: "At station", disponivel: "Available", em_contrato: 'Em contrato',
                             em_contrato_late: "Overdue contract", oficina: "Workshop", sem_matricula: "Unassigned",
                             desconhecido: "Unknown", chegou: "Arrived" };
            for (const [s, n] of Object.entries(counts)) parts.push(`${n} ${LABELS[s] || s}`);
            let msg = "Verified: " + parts.join(', ');
            if (chegaram.length) msg += ` · ${chegaram.length} arrived at destination!`;

            const hasProblems = (counts.em_contrato_late || 0) > 0 || chegaram.length > 0;
            _toast(msg, hasProblems ? 'warning' : 'success');

            // Refresh list to show updated pills
            await _loadCargas(ROT.estadoAtual);
        } catch (e) { _toast("Connection error", 'error'); }
    };

    // ── HISTÓRICO (modal) ───────────────────────────────────────
    window.rotMostrarHistorico = async function (ref) {
        const modal = document.getElementById('rotGenericModal');
        const title = document.getElementById('rotModalTitle');
        const body = document.getElementById('rotModalBody');
        if (!modal) return;

        title.textContent = `History — ${ref}`;
        body.innerHTML = '<div class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin text-lg"></i></div>';
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        try {
            const json = await _api(`/api/rotation/historico?referencia=${ref}`);
            if (json.success && json.historico.length > 0) {
                body.innerHTML = `
                    <div class="space-y-3 max-h-96 overflow-y-auto pr-1">
                        ${json.historico.map(h => `
                            <div class="flex gap-3 text-sm">
                                <div class="flex flex-col items-center">
                                    <div class="w-2 h-2 rounded-full bg-primary-500 mt-1.5"></div>
                                    <div class="w-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
                                </div>
                                <div class="flex-1 pb-4">
                                    <div class="text-gray-600 dark:text-gray-300">${_esc(h.descricao)}</div>
                                    <div class="text-xs text-gray-400 mt-0.5">
                                        <i class="fas fa-user mr-1"></i>${_esc(h.utilizador)} · ${_formatDateTime(h.timestamp)}
                                    </div>
                                </div>
                            </div>`).join('')}
                    </div>
                    <div class="flex justify-end pt-3">
                        <button onclick="rotCloseModal()" class="px-4 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">Close</button>
                    </div>`;
            } else {
                body.innerHTML = `
                    <div class="text-center py-8 text-gray-400 text-sm">No history records.</div>
                    <div class="flex justify-end pt-3">
                        <button onclick="rotCloseModal()" class="px-4 py-2 text-sm rounded-lg bg-lynx-subtle dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">Close</button>
                    </div>`;
            }
        } catch (e) {
            body.innerHTML = "<div class=\"text-center py-8 text-red-400 text-sm\">Could not load history.</div>";
        }
    };

    // ── EXPORT CSV ──────────────────────────────────────────────
    window.rotExportarCSV = function () {
        const cargas = ROT.cargas;
        if (!cargas.length) { _toast("No loads to export", 'warning'); return; }

        const rows = [];
        cargas.forEach(c => {
            (c.viaturas || []).forEach(v => {
                rows.push({
                    "Reference": c.referencia,
                    "Status": c.estado,
                    "User": c.utilizador || '',
                    "Created On": _formatDateTime(c.data_criacao),
                    "Vehicle": _rotViaturaLabel(v),
                    "Description": v.descricao || '',
                    "Manufacturer": v.marca || '',
                    "Model": v.modelo || '',
                    'ACRISS': v.acriss || '',
                    "Urgency": v.urgencia || '',
                    "Reason": c.motivo || '',
                    "Origin Station": c.estacao_origem_nome || c.zona_origem || '',
                    "Origin Zone": c.zona_origem || '',
                    "Destination Station": c.estacao_destino_nome || c.zona_destino || '',
                    "Destination Zone": c.zona_destino || '',
                    "Pickup Date": _formatDate(c.data_levantamento),
                    "Delivery Date": _formatDate(c.data_entrega),
                    "Carrier Assignments": (c.adjudicacoes || []).map(a => a.transportador).join('; '),
                    "Last Updated": _formatDateTime(c.data_atualizacao),
                });
            });
        });
        if (!rows.length) { _toast("No data", 'warning'); return; }

        const headers = Object.keys(rows[0]);
        const csv = [
            headers.join(';'),
            ...rows.map(r => headers.map(h => {
                let v = String(r[h] || '').replace(/"/g, '""');
                if (v.includes(';') || v.includes('\n') || v.includes('"')) v = `"${v}"`;
                return v;
            }).join(';'))
        ].join('\n');

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Fleet_Rotation_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        _toast(`Exported ${cargas.length} cargas`, 'success');
    };

    // ── GENERIC MODAL CLOSE ─────────────────────────────────────
    window.rotCloseModal = function () {
        const modal = document.getElementById('rotGenericModal');
        if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    };

    // ── TOAST NOTIFICATION ──────────────────────────────────────
    function _toast(msg, type) {
        const colors = { success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-yellow-500', info: 'bg-blue-500' };
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
        const container = document.getElementById('rotToastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `${colors[type] || 'bg-gray-700'} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm transition-all transform translate-x-full`;
        toast.innerHTML = `<i class="fas ${icons[type] || 'fa-info-circle'}"></i><span>${_esc(msg)}</span>`;
        container.appendChild(toast);
        requestAnimationFrame(() => { toast.classList.remove('translate-x-full'); });
        setTimeout(() => {
            toast.classList.add('translate-x-full', 'opacity-0');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

})();
