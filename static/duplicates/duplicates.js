/* ══════════════ R.E.N.A. — Duplicates Module v4 ══════════════ */
(function () {
    'use strict';

    const DUP = {
        groups: [],
        totalGroups: 0,
        totalReservations: 0,
        fetchedAt: null,
        loading: false,
        initialized: false,
        lastFetchTs: 0,
        activeTab: 'new',
        tracked: {},
    };

    // ── HELPERS ─────────────────────────────────────────────────
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function _fmtDateTime(iso) {
        return _esc(window.renaFormatDate(iso));
    }

    function _fmtDateOnly(iso) {
        return _esc(window.renaFormatDate(iso, true));
    }

    function _pickDate(r) {
        const dt = r.PICK_DATETIME;
        if (!dt) return null;
        const d = new Date(dt);
        return isNaN(d) ? null : d;
    }

    const STATUS_CFG = {
        RS:  { label: "Reservation", color: 'green',  icon: 'fa-check-circle' },
        RQ:  { label: 'On Request', color: 'purple', icon: 'fa-user-clock' },
        OF:  { label: "Offer",  color: 'yellow', icon: 'fa-paper-plane' },
        ARQ: { label: 'Alt. Req', color: 'yellow', icon: 'fa-random' },
        NS:  { label: 'No Show', color: 'orange', icon: 'fa-user-slash' },
        CO:  { label: "Em Contract", color: 'blue',   icon: 'fa-sign-out-alt' },
        CNL: { label: "Cancelled", color: 'red',   icon: 'fa-times-circle' },
        DEN: { label: "Declined", color: 'rose',  icon: 'fa-ban' },
        PD:  { label: "Paid",     color: 'sky',   icon: 'fa-receipt' },
        PP:  { label: 'Pag. Parcial', color: 'indigo', icon: 'fa-coins' },
    };

    function _statusBadge(status) {
        const cfg = STATUS_CFG[status] || { label: status, color: 'gray', icon: 'fa-question' };
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-${cfg.color}-500/10 text-${cfg.color}-500">
            <i class="fas ${cfg.icon} text-[0.6rem]"></i> ${_esc(cfg.label)}
        </span>`;
    }

    function _statusLabel(status) {
        const cfg = STATUS_CFG[status] || { label: status };
        return cfg.label;
    }

    function _sourceBadge(source) {
        if (!source) return '';
        return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 text-[0.6rem] font-semibold" title="Broker relay address; messages do not reach the customer directly"><i class="fas fa-exclamation-triangle text-[0.5rem]"></i>${_esc(source)}</span>`;
    }

    // ── API ─────────────────────────────────────────────────────
    async function _fetchDuplicates() {
        if (DUP.loading) return;
        if (DUP.groups.length > 0 && (Date.now() - DUP.lastFetchTs) < 5 * 60 * 1000) return;
        DUP.loading = true;
        _renderLoading();
        try {
            const [dupResp, trkResp] = await Promise.all([
                fetch('/api/reservations/duplicates'),
                fetch('/api/reservations/duplicates/tracked'),
            ]);
            const dupData = await dupResp.json();
            const trkData = await trkResp.json();
            if (dupData.error) throw new Error(dupData.error);
            DUP.groups = dupData.groups || [];
            DUP.totalGroups = dupData.total_groups || 0;
            DUP.totalReservations = dupData.total_reservations || 0;
            DUP.fetchedAt = dupData.fetched_at;
            DUP.tracked = trkData.tracked || {};
            DUP.lastFetchTs = Date.now();
        } catch (e) {
            console.error('Duplicates fetch error:', e);
            DUP.groups = [];
        }
        DUP.loading = false;
        _render();
    }

    // ── HELPERS: new vs sent, direct vs broker ──────────────────
    function _isBrokerGroup(group) {
        // A group is broker if SOURCE is non-empty (set by server for known intermediary relay emails)
        const res = group.reservations || [];
        return res.length > 0 && !!(res[0].SOURCE);
    }

    function _getNewGroups() {
        const result = [];
        for (const group of DUP.groups) {
            const newRes = group.reservations.filter(r => !DUP.tracked[r.RESERVATION_NO]);
            const sentRes = group.reservations.filter(r => !!DUP.tracked[r.RESERVATION_NO]);
            const sentDetails = sentRes.map(r => {
                const t = DUP.tracked[r.RESERVATION_NO] || {};
                return { ...r, current_status: t.current_status || t.status_when_sent || r.STATUS, sent_at: t.sent_at || '' };
            });
            if (newRes.length > 0) result.push({ ...group, reservations: newRes, alreadySent: sentRes.length, sentReservations: sentDetails });
        }
        return result;
    }

    function _getNewDirectGroups() {
        return _getNewGroups().filter(g => !_isBrokerGroup(g));
    }

    function _getNewBrokerGroups() {
        return _getNewGroups().filter(g => _isBrokerGroup(g));
    }

    function _getSentGroups() {
        // Group tracked reservations by client (name+email)
        const byClient = {};
        for (const [resNo, info] of Object.entries(DUP.tracked)) {
            const key = (info.client_name || '') + '|' + (info.client_email || '');
            if (!byClient[key]) {
                byClient[key] = {
                    client_name: info.client_name || "(no name)",
                    client_email: info.client_email || '',
                    reservations: [],
                };
            }
            byClient[key].reservations.push({ resNo, ...info });
        }
        // Sort reservations within each group by pick_datetime
        const groups = Object.values(byClient);
        for (const g of groups) {
            g.reservations.sort((a, b) => (a.pick_datetime || '').localeCompare(b.pick_datetime || ''));
        }
        // Sort groups by earliest pick_datetime ascending (nearest first)
        groups.sort((a, b) => {
            const la = Math.min(...a.reservations.map(r => new Date(r.pick_datetime || '9999').getTime()));
            const lb = Math.min(...b.reservations.map(r => new Date(r.pick_datetime || '9999').getTime()));
            return la - lb;
        });
        return groups;
    }

    function _getStats() {
        const sent = Object.values(DUP.tracked);
        const total = sent.length;
        const cancelled = sent.filter(s => ['CNL','DEN'].includes(s.current_status)).length;
        const noShow = sent.filter(s => s.current_status === 'NS').length;
        const active = sent.filter(s => ['RS','RQ','ARQ','OF'].includes(s.current_status)).length;
        const checkout = sent.filter(s => ['CO','PD','PP'].includes(s.current_status)).length;
        const pct = total > 0 ? Math.round((cancelled / total) * 100) : 0;

        // "Resolvidos" = clients where ALL duplicates were cancelled OR only 1 remains active
        const groups = _getSentGroups();
        let clientsResolved = 0;
        let noShowPrevented = 0;
        for (const g of groups) {
            const xxCount = g.reservations.filter(r => ['CNL','DEN'].includes(r.current_status)).length;
            noShowPrevented += xxCount;
            if (xxCount >= g.reservations.length - 1 && xxCount > 0) clientsResolved++;
        }
        return { total, cancelled, noShow, active, checkout, pct, clientsResolved, totalClients: DUP.totalGroups, noShowPrevented };
    }

    // ── RENDER ──────────────────────────────────────────────────
    function _renderLoading() {
        const wrap = document.getElementById('dupContent');
        if (wrap) wrap.innerHTML = `<div class="text-center py-16 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-2"></i><br>Loading duplicates…</div>`;
    }

    function _render() {
        const countEl = document.getElementById('dupCount');
        const resCountEl = document.getElementById('dupResCount');
        if (countEl) countEl.textContent = DUP.totalGroups.toLocaleString('en-GB');
        if (resCountEl) resCountEl.textContent = DUP.totalReservations.toLocaleString('en-GB');

        const directGroups = _getNewDirectGroups();
        const directResCount = directGroups.reduce((s, g) => s + g.reservations.length, 0);
        const brokerGroups = _getNewBrokerGroups();
        const brokerResCount = brokerGroups.reduce((s, g) => s + g.reservations.length, 0);
        const sentGroups = _getSentGroups();
        const sentResCount = sentGroups.reduce((s, g) => s + g.reservations.length, 0);

        const newCountEl = document.getElementById('dupNewCount');
        const brokersCountEl = document.getElementById('dupBrokersCount');
        const sentCountEl = document.getElementById('dupSentCount');
        if (newCountEl) newCountEl.textContent = directResCount;
        if (brokersCountEl) brokersCountEl.textContent = brokerResCount;
        if (sentCountEl) sentCountEl.textContent = sentResCount;

        _updateTabStyles();
        _renderActions();

        if (DUP.activeTab === 'new') _renderNewTab(directGroups);
        else if (DUP.activeTab === 'brokers') _renderBrokersTab(brokerGroups);
        else _renderSentTab(sentGroups);
    }

    function _updateTabStyles() {
        const tabs = ['dupTabNew', 'dupTabBrokers', 'dupTabSent'];
        const keys = ['new', 'brokers', 'sent'];
        const aCls = 'px-4 py-2 text-xs font-medium border-b-2 -mb-px border-primary-500 text-primary-500';
        const iCls = 'px-4 py-2 text-xs font-medium border-b-2 -mb-px border-transparent text-gray-400 hover:text-gray-300';
        tabs.forEach((id, i) => {
            const el = document.getElementById(id);
            if (el) el.className = DUP.activeTab === keys[i] ? aCls : iCls;
        });
    }

    function _renderActions() {
        const el = document.getElementById('dupActions');
        if (!el) return;
        if (DUP.activeTab === 'new') {
            el.innerHTML = `
                <button onclick="dupSendEmail()" class="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors border border-blue-500/20">
                    <i class="fas fa-envelope"></i> Email Preview
                </button>
                <button onclick="dupExportExcel()" class="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors border border-green-500/20">
                    <i class="fas fa-file-excel"></i> Export Excel
                </button>`;
        } else if (DUP.activeTab === 'brokers') {
            el.innerHTML = `
                <button onclick="dupTrackBrokers()" class="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors border border-amber-500/20">
                    <i class="fas fa-eye"></i> Mark for Monitoring
                </button>`;
        } else {
            el.innerHTML = `
                <button onclick="dupRefreshStatuses()" class="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-gray-500/10 text-gray-400 hover:bg-gray-500/20 transition-colors border border-gray-500/20">
                    <i class="fas fa-sync-alt"></i> Refresh Status
                </button>
                <button onclick="dupDownloadCsv()" class="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors border border-green-500/20">
                    <i class="fas fa-file-csv"></i> Export CSV
                </button>`;
        }
    }

    // ── NEW TAB ─────────────────────────────────────────────────
    function _renderNewTab(groups) {
        const wrap = document.getElementById('dupContent');
        if (!wrap) return;

        if (groups.length === 0) {
            wrap.innerHTML = `<div class="text-center py-16 text-gray-400">
                <i class="fas fa-check-circle text-3xl mb-2 text-green-400"></i><br>
                No new duplicate reservations to send.<br>
                <span class="text-xs">All duplicates have already been reported.</span>
            </div>`;
            return;
        }

        let html = '';
        groups.forEach((group, gi) => {
            const c = group.client;
            const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || "(no name)";
            const email = c.email || "(no email)";
            const count = group.reservations.length;

            const sortedRes = group.reservations.slice().sort((a, b) => {
                const da = _pickDate(a), db = _pickDate(b);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return da - db;
            });

            html += `<div class="lynx-card mb-4 overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3 bg-yellow-50 dark:bg-yellow-900/10 border-b border-yellow-200 dark:border-yellow-800/30 cursor-pointer" onclick="dupToggleGroup(${gi})">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-yellow-500/15 flex items-center justify-center flex-shrink-0">
                            <i class="fas fa-user text-yellow-500 text-sm"></i>
                        </div>
                        <div>
                            <span class="font-medium text-sm lynx-text-primary">${_esc(name)}</span>
                            <span class="ml-2 text-xs text-gray-400">${_esc(email)}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 text-xs font-bold px-2 py-0.5 rounded-full">${count} reservations</span>
                        ${group.alreadySent > 0 ? `<span class="bg-blue-500/15 text-blue-400 text-[0.6rem] font-medium px-2 py-0.5 rounded-full">+${group.alreadySent} already sent${group.alreadySent > 1 ? 's' : ''}</span>` : ''}
                        <i id="dupChevron${gi}" class="fas fa-chevron-down text-gray-400 text-xs transition-transform"></i>
                    </div>
                </div>
                <div id="dupGroup${gi}" class="overflow-x-auto">
                    <table class="w-full text-left">
                        <thead class="bg-lynx-subtle dark:bg-[#111] text-[0.6rem] uppercase tracking-wider text-gray-500">
                            <tr>
                                <th class="px-3 py-2">Reservation No.</th>
                                <th class="px-3 py-2">Status</th>
                                <th class="px-3 py-2">Group</th>
                                <th class="px-3 py-2">Pick-up</th>
                                <th class="px-3 py-2">Pickup Station</th>
                                <th class="px-3 py-2">Return</th>
                                <th class="px-3 py-2">Return Station</th>
                                <th class="px-3 py-2">Duration</th>
                                <th class="px-3 py-2">License Plate</th>
                            </tr>
                        </thead>
                        <tbody>`;

            sortedRes.forEach(r => {
                html += `<tr class="border-b border-lynx-divider dark:border-gray-800/50 text-xs hover:bg-lynx-subtle dark:hover:bg-white/5">
                    <td class="px-3 py-2 font-mono font-bold text-primary-500 whitespace-nowrap">${_esc(r.RESERVATION_NO)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_statusBadge(r.STATUS)}</td>
                    <td class="px-3 py-2 font-mono">${_esc(r.ZGROUP)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_fmtDateTime(r.PICK_DATETIME)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_esc(r.PICK_STATION_NAME || '—')}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_fmtDateTime(r.RET_DATETIME)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_esc(r.RET_STATION_NAME || '—')}</td>
                    <td class="px-3 py-2 text-right">${r.DURATION != null ? r.DURATION : '—'}</td>
                    <td class="px-3 py-2 font-mono">${_esc(r.LICENCE_PLATE || '—')}</td>
                </tr>`;
            });

            html += `</tbody></table></div>`;

            // Show previously sent reservations for comparison
            if (group.sentReservations && group.sentReservations.length > 0) {
                const sentId = 'dupSentHistory' + gi;
                const sentCount = group.sentReservations.length;
                const xxCount = group.sentReservations.filter(r => r.current_status === 'XX').length;
                const xxLabel = xxCount > 0 ? ` · <span class="text-green-400">${xxCount} cancelada${xxCount > 1 ? 's' : ''}</span>` : '';
                const sentNos = group.sentReservations.map(r => r.RESERVATION_NO).filter(Boolean).join(', ');

                html += `<div class="border-t border-blue-500/20 bg-blue-500/5">
                    <div class="px-4 py-2 flex items-center gap-2 cursor-pointer" onclick="dupToggleSentHistory(${gi})">
                        <i id="dupSentChevron${gi}" class="fas fa-chevron-right text-[0.5rem] text-blue-400 transition-transform"></i>
                        <span class="text-[0.65rem] font-medium text-blue-400">Previously sent: ${sentCount} reservation${sentCount > 1 ? 's' : ''}${xxLabel}</span>
                        <span class="text-[0.6rem] font-mono text-blue-300/70">Nº ${_esc(sentNos)}</span>
                    </div>
                    <div id="${sentId}" style="display:none" class="overflow-x-auto">
                        <table class="w-full text-left">
                            <thead class="bg-blue-500/5 text-[0.6rem] uppercase tracking-wider text-gray-500">
                                <tr>
                                    <th class="px-3 py-1.5">Reservation No.</th>
                                    <th class="px-3 py-1.5">Status Atual</th>
                                    <th class="px-3 py-1.5">Group</th>
                                    <th class="px-3 py-1.5">Pick-up</th>
                                    <th class="px-3 py-1.5">Pickup Station</th>
                                    <th class="px-3 py-1.5">Return</th>
                                    <th class="px-3 py-1.5">Duration</th>
                                    <th class="px-3 py-1.5">Sent on</th>
                                </tr>
                            </thead>
                            <tbody>`;

                group.sentReservations.forEach(r => {
                    const isCancelled = r.current_status === 'XX';
                    const rowCls = isCancelled ? 'opacity-50 line-through' : '';
                    html += `<tr class="border-b border-blue-500/10 text-xs ${rowCls}">
                        <td class="px-3 py-1.5 font-mono text-blue-400">${_esc(r.RESERVATION_NO)}</td>
                        <td class="px-3 py-1.5 whitespace-nowrap">${_statusBadge(r.current_status)}${isCancelled ? ' <i class="fas fa-check text-green-500 text-[0.55rem]"></i>' : ''}</td>
                        <td class="px-3 py-1.5 font-mono">${_esc(r.ZGROUP)}</td>
                        <td class="px-3 py-1.5 whitespace-nowrap">${_fmtDateTime(r.PICK_DATETIME)}</td>
                        <td class="px-3 py-1.5 whitespace-nowrap">${_esc(r.PICK_STATION_NAME || '—')}</td>
                        <td class="px-3 py-1.5 whitespace-nowrap">${_fmtDateTime(r.RET_DATETIME)}</td>
                        <td class="px-3 py-1.5 text-right">${r.DURATION != null ? r.DURATION : '—'}</td>
                        <td class="px-3 py-1.5 whitespace-nowrap text-gray-500">${_fmtDateTime(r.sent_at)}</td>
                    </tr>`;
                });

                html += `</tbody></table></div></div>`;
            }

            html += `</div>`;
        });

        wrap.innerHTML = html;
    }

    // ── BROKERS TAB ─────────────────────────────────────────────
    function _renderBrokersTab(groups) {
        const wrap = document.getElementById('dupContent');
        if (!wrap) return;

        if (groups.length === 0) {
            wrap.innerHTML = `<div class="text-center py-16 text-gray-400">
                <i class="fas fa-check-circle text-3xl mb-2 text-green-400"></i><br>
                No pending broker duplicates.<br>
                <span class="text-xs">All broker duplicates are already being monitored.</span>
            </div>`;
            return;
        }

        // Stats summary for broker groups
        const totalRes = groups.reduce((s, g) => s + g.reservations.length, 0);
        const brokerCounts = {};
        groups.forEach(g => {
            const src = g.reservations[0]?.SOURCE || '?';
            brokerCounts[src] = (brokerCounts[src] || 0) + g.reservations.length;
        });

        let html = `<div class="lynx-card px-5 py-3 flex items-center gap-5 flex-wrap mb-4">
            <div><span class="text-[0.65rem] text-gray-400">Total Reservations</span> <span class="font-bold text-sm">${totalRes}</span></div>
            <div><span class="text-[0.65rem] text-gray-400">Customers</span> <span class="font-bold text-sm">${groups.length}</span></div>
            <div class="border-l border-gray-700 pl-4 ml-1 flex items-center gap-3 flex-wrap">`;
        for (const [broker, cnt] of Object.entries(brokerCounts).sort((a, b) => b[1] - a[1])) {
            html += `<div>${_sourceBadge(broker)} <span class="text-xs font-bold ml-1">${cnt}</span></div>`;
        }
        html += `</div>
            <div class="ml-auto text-[0.6rem] text-gray-500"><i class="fas fa-info-circle mr-1"></i>Marked as automatically cancelled by the demo headquarters</div>
        </div>`;

        groups.forEach((group, gi) => {
            const c = group.client;
            const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || "(no name)";
            const email = c.email || "(no email)";
            const count = group.reservations.length;
            const broker = group.reservations[0]?.SOURCE || '';

            const sortedRes = group.reservations.slice().sort((a, b) => {
                const da = _pickDate(a), db = _pickDate(b);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return da - db;
            });

            const bgi = 'b' + gi;
            html += `<div class="lynx-surface rounded-xl border border-amber-200 dark:border-amber-800/30 shadow-sm mb-4 overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-200 dark:border-amber-800/30 cursor-pointer" onclick="dupToggleGroup('${bgi}')">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                            <i class="fas fa-globe text-amber-500 text-sm"></i>
                        </div>
                        <div>
                            <span class="font-medium text-sm lynx-text-primary">${_esc(name)}</span>
                            <span class="ml-2 text-xs text-gray-400">${_esc(email)}</span>
                            <span class="ml-2">${_sourceBadge(broker)}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-bold px-2 py-0.5 rounded-full">${count} reservations</span>
                        <i id="dupChevron${bgi}" class="fas fa-chevron-down text-gray-400 text-xs transition-transform"></i>
                    </div>
                </div>
                <div id="dupGroup${bgi}" class="overflow-x-auto">
                    <table class="w-full text-left">
                        <thead class="bg-lynx-subtle dark:bg-[#111] text-[0.6rem] uppercase tracking-wider text-gray-500">
                            <tr>
                                <th class="px-3 py-2">Reservation No.</th>
                                <th class="px-3 py-2">Status</th>
                                <th class="px-3 py-2">Group</th>
                                <th class="px-3 py-2">Pick-up</th>
                                <th class="px-3 py-2">Pickup Station</th>
                                <th class="px-3 py-2">Return</th>
                                <th class="px-3 py-2">Return Station</th>
                                <th class="px-3 py-2">Duration</th>
                                <th class="px-3 py-2">License Plate</th>
                            </tr>
                        </thead>
                        <tbody>`;

            sortedRes.forEach(r => {
                html += `<tr class="border-b border-lynx-divider dark:border-gray-800/50 text-xs hover:bg-lynx-subtle dark:hover:bg-white/5">
                    <td class="px-3 py-2 font-mono font-bold text-primary-500 whitespace-nowrap">${_esc(r.RESERVATION_NO)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_statusBadge(r.STATUS)}</td>
                    <td class="px-3 py-2 font-mono">${_esc(r.ZGROUP)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_fmtDateTime(r.PICK_DATETIME)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_esc(r.PICK_STATION_NAME || '—')}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_fmtDateTime(r.RET_DATETIME)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_esc(r.RET_STATION_NAME || '—')}</td>
                    <td class="px-3 py-2 text-right">${r.DURATION != null ? r.DURATION : '—'}</td>
                    <td class="px-3 py-2 font-mono">${_esc(r.LICENCE_PLATE || '—')}</td>
                </tr>`;
            });

            html += `</tbody></table></div></div>`;
        });

        wrap.innerHTML = html;
    }

    // ── TRACK BROKERS (mark for monitoring) ─────────────────────
    async function _trackBrokers() {
        const brokerGroups = _getNewBrokerGroups();
        if (!brokerGroups.length) { alert("No broker duplicates to monitor."); return; }

        const toTrack = [];
        for (const group of brokerGroups) {
            const c = group.client;
            const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
            for (const r of group.reservations) {
                toTrack.push({
                    res_no: r.RESERVATION_NO,
                    client_name: name,
                    client_email: c.email || '',
                    source: r.SOURCE || '',
                    status: r.STATUS || '',
                    group: r.ZGROUP || '',
                    pick_datetime: r.PICK_DATETIME || '',
                    pick_station: r.PICK_STATION_NAME || '',
                    pick_station_id: r.PICK_STATION_ID || '',
                    ret_datetime: r.RET_DATETIME || '',
                    ret_station: r.RET_STATION_NAME || '',
                    duration: r.DURATION || '',
                });
            }
        }

        try {
            await fetch('/api/reservations/duplicates/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reservations: toTrack }),
            });
            // Refresh data
            DUP.lastFetchTs = 0;
            await _fetchDuplicates();
        } catch (e) {
            alert('Could not record: ' + e.message);
        }
    }

    // ── SENT TAB ────────────────────────────────────────────────
    function _renderSentTab(groups) {
        const wrap = document.getElementById('dupContent');
        if (!wrap) return;

        if (groups.length === 0) {
            wrap.innerHTML = `<div class="text-center py-16 text-gray-400">
                <i class="fas fa-inbox text-3xl mb-2"></i><br>None reserva enviada ainda.
            </div>`;
            return;
        }

        const stats = _getStats();
        let html = '';

        // Stats bar
        html += `<div class="lynx-card px-5 py-3 flex items-center gap-6 flex-wrap mb-4">
            <div><span class="text-[0.65rem] text-gray-400">Reported Reservations</span> <span class="font-bold text-sm">${stats.total}</span></div>
            <div><span class="text-[0.65rem] text-gray-400">Canceladas</span> <span class="font-bold text-sm text-green-500">${stats.cancelled}</span></div>
            <div><span class="text-[0.65rem] text-gray-400">Ativas</span> <span class="font-bold text-sm text-yellow-500">${stats.active}</span></div>
            <div><span class="text-[0.65rem] text-gray-400">No-Show</span> <span class="font-bold text-sm text-orange-500">${stats.noShow}</span></div>
            <div><span class="text-[0.65rem] text-gray-400">Em Contract</span> <span class="font-bold text-sm text-blue-500">${stats.checkout}</span></div>
            <div class="border-l border-gray-700 pl-4 ml-2"><span class="text-[0.65rem] text-gray-400">Resolved Customers</span> <span class="font-bold text-sm text-green-500">${stats.clientsResolved}<span class="text-gray-500 font-normal">/${stats.totalClients}</span></span></div>
            <div><span class="text-[0.65rem] text-gray-400">No-Shows Prevenidos</span> <span class="font-bold text-sm text-green-400">${stats.noShowPrevented}</span></div>
            <div class="flex items-center gap-2">
                <span class="text-[0.65rem] text-gray-400">Taxa Cancelamento</span>
                <span class="font-bold text-sm ${stats.pct >= 80 ? 'text-green-500' : stats.pct >= 50 ? 'text-yellow-500' : 'text-red-500'}">${stats.pct}%</span>
                <div class="w-20 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div class="h-full rounded-full ${stats.pct >= 80 ? 'bg-green-500' : stats.pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}" style="width:${stats.pct}%"></div>
                </div>
            </div>
        </div>`;

        // Client cards — same format as New tab but with status tracking
        groups.forEach((group, gi) => {
            const name = group.client_name;
            const email = group.client_email;
            const total = group.reservations.length;
            const xxCount = group.reservations.filter(r => r.current_status === 'XX').length;
            const allCancelled = xxCount === total;
            const resolved = xxCount >= total - 1 && xxCount > 0;

            // Card header color based on resolution
            const hdrBg = allCancelled
                ? 'bg-green-50 dark:bg-green-900/10 border-b border-green-200 dark:border-green-800/30'
                : resolved
                    ? 'bg-blue-50 dark:bg-blue-900/10 border-b border-blue-200 dark:border-blue-800/30'
                    : 'bg-lynx-subtle dark:bg-gray-800/30 border-b border-lynx-divider dark:border-gray-700/30';
            const iconBg = allCancelled ? 'bg-green-500/15' : resolved ? 'bg-blue-500/15' : 'bg-gray-500/15';
            const iconColor = allCancelled ? 'text-green-500' : resolved ? 'text-blue-500' : 'text-gray-400';
            const iconCls = allCancelled ? 'fa-check-double' : resolved ? 'fa-check' : 'fa-user';

            // Status summary badge
            let statusSummary = '';
            if (allCancelled) {
                statusSummary = `<span class="bg-green-500/15 text-green-500 text-[0.6rem] font-bold px-2 py-0.5 rounded-full"><i class="fas fa-check mr-1"></i>All canceladas</span>`;
            } else if (xxCount > 0) {
                statusSummary = `<span class="bg-blue-500/15 text-blue-400 text-[0.6rem] font-bold px-2 py-0.5 rounded-full">${xxCount}/${total} canceladas</span>`;
            } else {
                statusSummary = `<span class="bg-gray-500/15 text-gray-400 text-[0.6rem] font-bold px-2 py-0.5 rounded-full">No cancellations</span>`;
            }

            const idx = 's' + gi; // prefix to avoid collision with New tab groups

            html += `<div class="lynx-card mb-4 overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3 ${hdrBg} cursor-pointer" onclick="dupToggleGroup('${idx}')">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0">
                            <i class="fas ${iconCls} ${iconColor} text-sm"></i>
                        </div>
                        <div>
                            <span class="font-medium text-sm lynx-text-primary">${_esc(name)}</span>
                            <span class="ml-2 text-xs text-gray-400">${_esc(email)}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        ${statusSummary}
                        <span class="bg-gray-500/15 text-gray-400 text-xs font-bold px-2 py-0.5 rounded-full">${total} reservations</span>
                        <i id="dupChevron${idx}" class="fas fa-chevron-down text-gray-400 text-xs transition-transform"></i>
                    </div>
                </div>
                <div id="dupGroup${idx}" class="overflow-x-auto">
                    <table class="w-full text-left">
                        <thead class="bg-lynx-subtle dark:bg-[#111] text-[0.6rem] uppercase tracking-wider text-gray-500">
                            <tr>
                                <th class="px-3 py-2">Reservation No.</th>
                                <th class="px-3 py-2">Type</th>
                                <th class="px-3 py-2">Status Envio</th>
                                <th class="px-3 py-2">Status Atual</th>
                                <th class="px-3 py-2">Group</th>
                                <th class="px-3 py-2">Pick-up</th>
                                <th class="px-3 py-2">Pickup Station</th>
                                <th class="px-3 py-2">Return</th>
                                <th class="px-3 py-2">Return Station</th>
                                <th class="px-3 py-2">Duration</th>
                                <th class="px-3 py-2">Sent on</th>
                            </tr>
                        </thead>
                        <tbody>`;

            for (const r of group.reservations) {
                const curStatus = r.current_status || r.status_when_sent || '';
                const isCancelled = ['CNL','DEN'].includes(curStatus);
                const isNoShow = curStatus === 'NS';
                const isCompleted = ['CO','PD','PP'].includes(curStatus);
                const statusChanged = curStatus !== r.status_when_sent;
                const rowBg = isCancelled ? 'bg-green-500/5' : isNoShow ? 'bg-orange-500/5' : isCompleted ? 'bg-blue-500/5' : statusChanged ? 'bg-yellow-500/5' : '';
                const tipo = r.source ? _sourceBadge(r.source) : '<span class="text-gray-400 text-[0.65rem]">Direto</span>';

                html += `<tr class="border-b border-lynx-divider dark:border-gray-800/50 text-xs hover:bg-lynx-subtle dark:hover:bg-white/5 ${rowBg}">
                    <td class="px-3 py-2 font-mono font-bold text-primary-500 whitespace-nowrap">${_esc(r.resNo)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${tipo}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_statusBadge(r.status_when_sent)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_statusBadge(curStatus)}${isCancelled ? " <i class=\"fas fa-check text-green-500 text-[0.6rem] ml-1\" title=\"Successfully cancelled\"></i>" : isNoShow ? ' <i class="fas fa-exclamation-triangle text-orange-500 text-[0.6rem] ml-1" title="No Show"></i>' : isCompleted ? " <i class=\"fas fa-car text-blue-400 text-[0.6rem] ml-1\" title=\"Checked out\"></i>" : statusChanged ? ' <span class="text-[0.5rem] text-yellow-400 font-bold">ALTERADO</span>' : ''}</td>
                    <td class="px-3 py-2 font-mono">${_esc(r.group)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_fmtDateTime(r.pick_datetime)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_esc(r.pick_station || '—')}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_fmtDateTime(r.ret_datetime)}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${_esc(r.ret_station || '—')}</td>
                    <td class="px-3 py-2 text-right">${r.duration || '—'}</td>
                    <td class="px-3 py-2 whitespace-nowrap text-gray-400">${_fmtDateTime(r.sent_at)}</td>
                </tr>`;
            }

            html += `</tbody></table></div></div>`;
        });

        wrap.innerHTML = html;
    }

    // ── GROUP TOGGLE ────────────────────────────────────────────
    function _toggleGroup(idx) {
        const el = document.getElementById('dupGroup' + idx);
        const chevron = document.getElementById('dupChevron' + idx);
        if (!el) return;
        if (el.style.display === 'none') {
            el.style.display = '';
            if (chevron) chevron.style.transform = '';
        } else {
            el.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(-90deg)';
        }
    }

    function _toggleSentHistory(idx) {
        const el = document.getElementById('dupSentHistory' + idx);
        const chevron = document.getElementById('dupSentChevron' + idx);
        if (!el) return;
        if (el.style.display === 'none') {
            el.style.display = '';
            if (chevron) chevron.style.transform = 'rotate(90deg)';
        } else {
            el.style.display = 'none';
            if (chevron) chevron.style.transform = '';
        }
    }

    // ── ACTIONS ─────────────────────────────────────────────────
    function _downloadFile(url) {
        const a = document.createElement('a');
        a.href = url;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    async function _sendEmail() {
        const newGroups = _getNewDirectGroups();
        if (!newGroups.length) { alert("No new duplicates to send."); return; }

        // Collect all new reservations to track
        const toTrack = [];
        for (const group of newGroups) {
            const c = group.client;
            const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
            for (const r of group.reservations) {
                toTrack.push({
                    res_no: r.RESERVATION_NO,
                    client_name: name,
                    client_email: c.email || '',
                    source: r.SOURCE || '',
                    status: r.STATUS || '',
                    group: r.ZGROUP || '',
                    pick_datetime: r.PICK_DATETIME || '',
                    pick_station: r.PICK_STATION_NAME || '',
                    pick_station_id: r.PICK_STATION_ID || '',
                    ret_datetime: r.RET_DATETIME || '',
                    ret_station: r.RET_STATION_NAME || '',
                    duration: r.DURATION || '',
                });
            }
        }

        try {
            await fetch('/api/reservations/duplicates/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reservations: toTrack }),
            });

            // 2. Download the Excel file for attachment
            _downloadFile('/api/reservations/duplicates/excel');

            // 3. Open mailto with short body
            const today = window.renaFormatDate(new Date(), true);

            // Check if any clients already had previous sends
            const clientsWithHistory = newGroups.filter(g => g.alreadySent > 0);
            const totalPreviouslySent = clientsWithHistory.reduce((s, g) => s + g.alreadySent, 0);

            let historyNote = '';
            if (clientsWithHistory.length > 0) {
                historyNote = '\r\nNOTA: ' + clientsWithHistory.length + ' cliente' + (clientsWithHistory.length > 1 ? 's' : '') +
                    ' previously had' + (clientsWithHistory.length > 1 ? 'm' : '') + " duplicate reservations reported previously (" +
                    totalPreviouslySent + ' reserva' + (totalPreviouslySent > 1 ? 's' : '') + " already reported" + (totalPreviouslySent > 1 ? 's' : '') +
                    "), but additional reservations have since been made.\r\n";
            }

            const subject = encodeURIComponent("Duplicate Reservations — " + today + ' (' + newGroups.length + " customers)");
            const body = encodeURIComponent(
                'Bom dia,\r\n\r\n' +
                "Please find attached the file containing " + toTrack.length + " newly detected duplicate reservations (" + newGroups.length + " customers).\r\n" +
                historyNote + '\r\n' +
                "Please review the duplicate reservations listed in the file.\r\n\r\n" +
                "Obrigado,\r\nFleet Management — RENA Demo"
            );
            window.location.href = 'mailto:?subject=' + subject + '&body=' + body;

            // 4. Refresh tracked
            const trkResp = await fetch('/api/reservations/duplicates/tracked');
            const trkData = await trkResp.json();
            DUP.tracked = trkData.tracked || {};
            _render();
        } catch (e) {
            console.error('Send email error:', e);
            alert('Could not record report: ' + e.message);
        }
    }

    function _exportExcel() {
        const newGroups = _getNewGroups();
        if (!newGroups.length) { alert("No new duplicates to export."); return; }
        _downloadFile('/api/reservations/duplicates/excel');
    }

    function _exportAllCsv() {
        _downloadFile('/api/reservations/duplicates/csv');
    }



    async function _refreshStatuses() {
        const btn = document.querySelector('#dupActions button');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> A atualizar...'; }
        try {
            await fetch('/api/reservations/duplicates/tracked/refresh', { method: 'POST' });
            const resp = await fetch('/api/reservations/duplicates/tracked');
            const data = await resp.json();
            DUP.tracked = data.tracked || {};
        } catch (e) {
            console.error('Refresh error:', e);
        }
        _render();
    }

    // ── TAB / INIT ──────────────────────────────────────────────
    function _switchTab(tab) {
        DUP.activeTab = tab;
        _render();
    }

    async function init() {
        if (DUP.initialized) {
            if ((Date.now() - DUP.lastFetchTs) > 5 * 60 * 1000) {
                await _fetchDuplicates();
            } else {
                _render();
            }
            return;
        }
        DUP.initialized = true;
        await _fetchDuplicates();
    }

    // ── GLOBAL EXPORTS ──────────────────────────────────────────
    window.duplicadosInit = init;
    window.dupToggleGroup = _toggleGroup;
    window.dupToggleSentHistory = _toggleSentHistory;
    window.dupDownloadEmail = _sendEmail;
    window.dupDownloadCsv = _exportAllCsv;
    window.dupSendEmail = _sendEmail;
    window.dupTrackBrokers = _trackBrokers;
    window.dupExportExcel = _exportExcel;
    window.dupExportAllCsv = _exportAllCsv;
    window.dupSwitchTab = _switchTab;
    window.dupRefreshStatuses = _refreshStatuses;

})();
