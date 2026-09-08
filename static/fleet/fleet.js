/* ══════════════ R.E.N.A. — Fleet Module ══════════════ */
(function () {
    'use strict';

    // ── MASTERDATA CACHE (Cor + Alarme) ─────────────────────────
    let _nafMasterData = {};  // { plate: { cor, alarme, updated_at } }

    window.nafLoadMasterData = async function () {
        try {
            const res = await fetch((window.API_BASE || '') + '/api/vehicle-masterdata/data');
            if (!res.ok) return;
            const json = await res.json();
            if (json.success && json.masterdata) {
                _nafMasterData = json.masterdata;
                // Re-render table if data is already loaded
                if (NAF.filtered && NAF.filtered.length > 0) nafRenderTable();
            }
        } catch (e) { console.warn('MasterData load error:', e); }
    };

    function _nafGetMD(plate) {
        return _nafMasterData[(plate || '').trim()] || {};
    }

    function _nafHasAlarm(v) {
        return !!_nafGetMD(v.licensePlate).alarme;
    }

    // Expose masterdata cache for other modules (analytics)
    window.nafGetMasterDataCache = function () { return _nafMasterData; };

    // ── CAR MODEL (Marca/Modelo — sourced from Demo) ──────
    // Loading/formatting now lives in shared/utils.js (window.nafGetCarModel)
    // so Fleet and Planning always show identical text for the same plate.
    // This thin wrapper just keeps the existing local call sites unchanged.
    function _nafGetCarModel(v) { return window.nafGetCarModel(v); }
    window.nafOnCarModelUpdate(() => { if (NAF.filtered && NAF.filtered.length > 0) nafRenderTable(); });

    // ── MASTERDATA ENRICHMENT PROGRESS POLLING ──────────────────
    let _mdProgressTimer = null;
    let _mdWasActive = false;

    window.nafStartMdProgressPoll = function () {
        if (_mdProgressTimer) return;
        _mdProgressTimer = setInterval(_mdPollProgress, 2000);
        _mdPollProgress(); // immediate first poll
    };

    async function _mdPollProgress() {
        try {
            const res = await fetch((window.API_BASE || '') + '/api/vehicle-masterdata/progress');
            if (!res.ok) return;
            const json = await res.json();
            if (!json.success) return;
            const p = json.progress;
            const el = document.getElementById('nafMdProgress');
            const textEl = document.getElementById('nafMdProgressText');
            const barEl = document.getElementById('nafMdProgressBar');
            const pctEl = document.getElementById('nafMdProgressPct');
            if (!el) return;

            if (p.active) {
                _mdWasActive = true;
                el.classList.remove('hidden');
                el.classList.add('flex');
                const pct = p.total > 0 ? Math.round((p.fetched / p.total) * 100) : 0;
                const rpsText = p.rps > 0 ? ` · ${p.rps.toFixed(0)} req/s` : '';
                const colorsText = p.new_colors > 0 ? ` · ${p.new_colors} cores novas` : '';
                textEl.textContent = `A atualizar alarmes e cores: ${p.fetched} / ${p.total}${colorsText}${rpsText}`;
                barEl.style.width = pct + '%';
                pctEl.textContent = pct + '%';
            } else {
                el.classList.add('hidden');
                el.classList.remove('flex');
                // If it was active before, enrichment just finished — refresh masterdata
                if (_mdWasActive) {
                    _mdWasActive = false;
                    nafLoadMasterData();
                    // Stop polling until next trigger
                    clearInterval(_mdProgressTimer);
                    _mdProgressTimer = null;
                }
            }
        } catch (_) {}
    }

    // ── FILTER POPULATION ───────────────────────────────────────
    window.nafPopulateFilters = function () {
        const subStatuses = [...new Set(NAF.rawData.map(v => v.subStatus).filter(Boolean))].sort();
        nafMsSetOptions('nafFilterCategory', subStatuses.map(s => ({ value: s, label: nafFormatSubStatus(s) })), "All reasons");

        const statuses = [...new Set(NAF.rawData.map(v =>
            v.classicStatus !== null && v.classicStatus !== undefined ? String(v.classicStatus) : null
        ).filter(Boolean))].sort();
        nafMsSetOptions('nafFilterStatus', statuses.map(s => ({ value: s, label: s })), "All statuses");

        const pools = [...new Set(NAF.rawData.map(v => v.branch && v.branch.poolName).filter(Boolean))].sort();
        nafMsSetOptions('nafFilterPool', pools.map(p => ({ value: p, label: p })), "All pools");

        const selectedPools = new Set(nafMsGetValues('nafFilterPool'));
        const branches = [...new Set(NAF.rawData
            .filter(v => !selectedPools.size || selectedPools.has(v.branch && v.branch.poolName))
            .map(v => v.branch && v.branch.name).filter(Boolean))].sort();
        nafMsSetOptions('nafFilterBranch', branches.map(b => ({ value: b, label: b })), "All branches");

        const groups = [...new Set(NAF.rawData.map(v => (v.acrissCode || '').slice(0, 4)).filter(Boolean))].sort();
        nafMsSetOptions('nafFilterGroup', groups.map(g => ({ value: g, label: g })), "All groups");

        const returnStations = [...new Set(NAF.rawData.map(v => v.returnBranch && v.returnBranch.name).filter(Boolean))].sort();
        nafMsSetOptions('nafFilterReturnStation', returnStations.map(s => ({ value: s, label: s })), "Return station");
    };

    window.nafOnPoolChange = function () {
        const selectedPools = new Set(nafMsGetValues('nafFilterPool'));
        const branches = [...new Set(NAF.rawData
            .filter(v => !selectedPools.size || selectedPools.has(v.branch && v.branch.poolName))
            .map(v => v.branch && v.branch.name).filter(Boolean))].sort();
        nafMsSetOptions('nafFilterBranch', branches.map(b => ({ value: b, label: b })), "All branches");
        nafApplyFilters();
    };

    // ── FILTERING & SORTING ─────────────────────────────────────
    function nafIsRelevantVehicle(v) {
        const sub  = (v.subStatus || '').toUpperCase();
        const code = (v.holdCodeForDueDate || '').toUpperCase();
        const desc = (v.holdDescriptionForDueDate || '').toUpperCase();
        if (code.includes('INFLEET') || desc.includes('INFLEET') || sub.includes('INFLEET')) return true;
        if (sub.includes('DAMAGE') || sub.includes('REPAIR') || sub.includes('MAINTENANCE') || sub.includes('WORKSHOP')) return true;
        if (sub.includes('NOT_RENT') || sub.includes('NOTRENT') || (sub.includes('RENTABLE') && sub.includes('NOT'))) return true;
        if (sub.includes('DEFLEET')) return true;
        return false;
    }

    window.nafApplyFilters = function () {
        NAF.page = 0;
        const categories = new Set(nafMsGetValues('nafFilterCategory'));
        const statuses   = new Set(nafMsGetValues('nafFilterStatus'));
        const pools      = new Set(nafMsGetValues('nafFilterPool'));
        const branches   = new Set(nafMsGetValues('nafFilterBranch'));
        const groups     = new Set(nafMsGetValues('nafFilterGroup'));
        const retStations = new Set(nafMsGetValues('nafFilterReturnStation'));
        const retDateVal  = document.getElementById('nafFilterReturnDate')?.value || '';
        const search     = (document.getElementById('nafSearch')?.value || '').toLowerCase();

        NAF.filtered = NAF.rawData.filter(v => {
            if (categories.size && !categories.has(v.subStatus || '')) return false;
            if (statuses.size   && !statuses.has(String(v.classicStatus ?? ''))) return false;
            if (pools.size      && !pools.has((v.branch && v.branch.poolName) || '')) return false;
            if (branches.size   && !branches.has((v.branch && v.branch.name)  || '')) return false;
            if (groups.size     && ![...groups].some(g => (v.acrissCode || '').startsWith(g))) return false;
            if (retStations.size && !retStations.has((v.returnBranch && v.returnBranch.name) || '')) return false;
            if (retDateVal) {
                const rd = v.rentalActivity && v.rentalActivity.returnDateTime;
                if (!rd) return false;
                const rdDate = rd.slice(0, 10);
                if (rdDate !== retDateVal) return false;
            }
            if (search && !(v.licensePlate || '').toLowerCase().includes(search)
                       && !(v.displayName  || '').toLowerCase().includes(search)
                       && !(v.vin          || '').toLowerCase().includes(search)
                       && !String(v.internalNumber ?? '').toLowerCase().includes(search)
                       && !(v.make         || '').toLowerCase().includes(search)
                       && !(v.model        || '').toLowerCase().includes(search)
                       && !_nafGetCarModel(v).toLowerCase().includes(search)) return false;
            return true;
        });

        nafSortData();
        nafRenderTable();
        nafRenderKPIs();
    };

    // ── SORTING ─────────────────────────────────────────────────
    window.nafSort = function (col) {
        NAF.page = 0;
        if (NAF.sortCol === col) {
            NAF.sortDir = NAF.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            NAF.sortCol = col;
            NAF.sortDir = 'asc';
        }
        nafSortData();
        nafRenderTable();
        nafUpdateSortHeaders();
    };

    window.nafGoToPage = function (p) {
        const totalPages = Math.max(1, Math.ceil(NAF.filtered.length / NAF.PAGE_SIZE));
        NAF.page = Math.max(0, Math.min(p, totalPages - 1));
        nafRenderTable();
    };

    function nafSortData() {
        const col = NAF.sortCol;
        const dir = NAF.sortDir === 'asc' ? 1 : -1;
        function sortVal(v) {
            if (col === 'branch')       return (v.branch && v.branch.name) || '';
            if (col === 'branchPool')   return (v.branch && v.branch.poolName) || '';
            if (col === 'branchRegion') return (v.branch && v.branch.regionName) || '';
            if (col === 'pickupBranch') return (v.pickupBranch && v.pickupBranch.name) || '';
            if (col === 'returnBranch') return (v.returnBranch && v.returnBranch.name) || '';
            if (col === '_cor')         return _nafGetMD(v.licensePlate).cor || '';
            if (col === '_alarme')      return _nafGetMD(v.licensePlate).alarme || '';
            if (col === 'displayName')  return _nafGetCarModel(v);
            if (col === 'subStatus')    return nafFormatSubStatus(v.subStatus);
            if (col === 'defleetDate')     return v.defleetDate   || '';
            if (col === 'inStatusSince')   return v.inStatusSince || '';
            if (col === 'atBranchSince')   return v.atBranchSince || '';
            if (col === 'updatedAt')       return v.updatedAt     || '';
            if (col === 'rentalAgreement') return (v.rentalActivity && v.rentalActivity.rentalAgreementNumber) || '';
            if (col === 'rentalStatus')    return (v.rentalActivity && v.rentalActivity.status) || '';
            if (col === 'rentalPickup')    return (v.rentalActivity && v.rentalActivity.pickupDateTime) || '';
            if (col === 'rentalReturn')    return (v.rentalActivity && v.rentalActivity.returnDateTime) || '';
            if (col === 'isLongterm')      return (v.rentalActivity && v.rentalActivity.isLongterm) ? 1 : 0;
            if (col === 'rateCode')        return (v.rentalActivity && v.rentalActivity.rateCode) || '';
            if (col === 'holdsCount')      return Array.isArray(v.holds) ? v.holds.length : 0;
            if (col === 'passengers')      return (v.carGroup && v.carGroup.passengers) || 0;
            if (col === 'doors')           return (v.carGroup && v.carGroup.doors) || 0;
            if (col === 'winterTires')     return v.winterSuitableTires || v.winterSuitableTiresType || '';
            if (col === 'tankVolume')      return v.tankVolume || 0;
            return v[col] ?? '';
        }
        NAF.filtered.sort((a, b) => {
            const av = sortVal(a);
            const bv = sortVal(b);
            if (av < bv) return -1 * dir;
            if (av > bv) return  1 * dir;
            return 0;
        });
    }

    function nafUpdateSortHeaders() {
        document.querySelectorAll('.naf-table thead th').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.col === NAF.sortCol) {
                th.classList.add(NAF.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    // ── TABLE RENDERING ─────────────────────────────────────────
    function nafRenderTable() {
        const tbody = document.getElementById('nafTableBody');
        if (!tbody) return;

        const totalPages = Math.max(1, Math.ceil(NAF.filtered.length / NAF.PAGE_SIZE));
        if (NAF.page >= totalPages) NAF.page = totalPages - 1;

        const pagEl   = document.getElementById('nafPagination');
        const prevBtn = document.getElementById('nafPagePrev');
        const nextBtn = document.getElementById('nafPageNext');
        const labelEl = document.getElementById('nafPageLabel');
        if (pagEl)   pagEl.style.display = NAF.filtered.length > NAF.PAGE_SIZE ? 'flex' : 'none';
        if (prevBtn) prevBtn.disabled     = NAF.page === 0;
        if (nextBtn) nextBtn.disabled     = NAF.page >= totalPages - 1;
        if (labelEl) labelEl.textContent  = `Page ${NAF.page + 1} of ${totalPages}  ( ${NAF.filtered.length} vehicles )`;

        if (!NAF.filtered.length) {
            tbody.innerHTML = `<tr><td colspan="52" style="text-align:center;padding:30px;color:#6e7681;">
                No vehicles match the current filters.</td></tr>`;
            const rc = document.getElementById('nafResultsCount');
            if (rc) rc.textContent = "0 vehicles";
            return;
        }

        const start = NAF.page * NAF.PAGE_SIZE;
        const pageData = NAF.filtered.slice(start, start + NAF.PAGE_SIZE);

        tbody.innerHTML = pageData.map(v => {
            const catClass   = nafSubStatusClass(v.subStatus);
            const branchName = (v.branch && v.branch.name)     || '—';
            const poolName   = (v.branch && v.branch.poolName) || '—';
            const regionName = (v.branch && v.branch.regionName) || '—';
            const pickupBrName  = (v.pickupBranch && v.pickupBranch.name) || '—';
            const returnBrName  = (v.returnBranch && v.returnBranch.name) || '—';

            const defleetDiff = nafDaysDiff(v.defleetDate);
            let defleetCell = '—', defleetClass = '';
            if (defleetDiff !== null) {
                defleetCell = defleetDiff >= 0
                    ? `${defleetDiff}d`
                    : `<span style="color:#ef4444;font-weight:600">${defleetDiff}d</span>`;
                if (defleetDiff >= 0 && defleetDiff <= 14) defleetClass = 'date-expiring';
            }

            const statusDays = nafDaysAgo(v.inStatusSince);
            const statusCell = statusDays !== null ? `${statusDays}d` : '—';
            const atBranchCell = v.atBranchSince ? window.renaFormatDate(v.atBranchSince, false) : '—';
            const updatedCell = v.updatedAt ? window.renaFormatDate(v.updatedAt, false) : '—';

            // Fuel / Charge display
            const fuelRaw   = v.fuelLevel;
            const hasFuel   = fuelRaw != null;
            const hasCharge = v.chargeLevelPercentage != null && v.chargeLevelPercentage > 0;
            const fuelCode  = (v.fuelType || '').toUpperCase();
            const isElectric = fuelCode === 'E';
            let fuelChargeCell;

            if (isElectric || (!hasFuel && hasCharge)) {
                const pct = v.chargeLevelPercentage || 0;
                const pctColor = pct >= 60 ? '#22c55e' : pct >= 30 ? '#f59e0b' : '#ef4444';
                fuelChargeCell = `<span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:32px;height:7px;border-radius:3px;background:linear-gradient(90deg,${pctColor} ${pct}%,#374151 ${pct}%)"></span><span style="color:${pctColor};font-weight:600;font-size:0.75rem">${pct}%</span><span style="font-size:0.7rem">⚡</span></span>`;
            } else if (hasFuel) {
                const level = Math.max(0, Math.min(8, Math.round(fuelRaw)));
                const barColor = level >= 5 ? '#22c55e' : level >= 3 ? '#f59e0b' : '#ef4444';
                let bars = '';
                for (let i = 1; i <= 8; i++) {
                    const filled = i <= level;
                    bars += `<span style="display:inline-block;width:4px;height:10px;border-radius:1px;margin-right:1px;background:${filled ? barColor : '#374151'}"></span>`;
                }
                fuelChargeCell = `<span title="Fuel: ${level}/8" style="display:inline-flex;align-items:center;gap:4px">${bars}<span style="color:${barColor};font-weight:600;font-size:0.75rem">${level}/8</span></span>`;
                if (hasCharge) {
                    const pct = v.chargeLevelPercentage;
                    fuelChargeCell += `<span style="color:#6e7681;margin:0 2px">/</span><span style="color:#60a5fa;font-weight:600;font-size:0.75rem">${pct}%⚡</span>`;
                }
            } else {
                fuelChargeCell = '—';
            }

            // Rental activity
            const ra = v.rentalActivity || {};
            const rentalAgreement = ra.rentalAgreementNumber || '—';
            const rentalStatus    = ra.status || '—';
            const rentalPickup    = ra.pickupDateTime ? window.renaFormatDate(ra.pickupDateTime, false) : '—';
            const rentalReturn    = ra.returnDateTime ? window.renaFormatDate(ra.returnDateTime, false) : '—';
            const isLongterm      = ra.isLongterm != null ? (ra.isLongterm ? "Yes" : "No") : '—';
            const rateCode        = ra.rateCode || '—';

            const tankCell = v.tankVolume != null ? `${v.tankVolume} ${v.tankUnit || ''}` : '—';
            const cg = v.carGroup || {};
            const passengers = cg.passengers != null ? cg.passengers : '—';
            const doors      = cg.doors != null ? cg.doors : '—';
            const holdsCount = Array.isArray(v.holds) ? v.holds.length : '—';

            const vinTip = nafEsc(v.vin || '');
            const plateHtml = vinTip
                ? `<span class="plate naf-vin-tip" data-vin="${vinTip}" tabindex="0">${nafEsc(v.licensePlate || '—')}</span>`
                : `<span class="plate">${nafEsc(v.licensePlate || '—')}</span>`;

            return `<tr>
                <td>${plateHtml}</td>
                <td>${_nafGetMD(v.licensePlate).alarme ? '<span style="color:#ef4444;font-weight:600">' + nafEsc(_nafGetMD(v.licensePlate).alarme) + '</span>' : '—'}</td>
                <td>${nafEsc(_nafGetCarModel(v) || '—')}</td>
                <td>${nafEsc((v.acrissCode || '—').slice(0, 4))}</td>
                <td>${nafEsc(pickupBrName)}</td>
                <td>${rentalPickup}</td>
                <td>${nafEsc(returnBrName)}</td>
                <td>${rentalReturn}</td>
                <td class="${defleetClass}">${defleetCell}</td>
                <td>${v.mileage != null ? v.mileage.toLocaleString('en-GB') : '—'}</td>
                <td>${v.remainingMileage != null ? v.remainingMileage.toLocaleString('en-GB') : '—'}</td>
                <td>${v.maxMileage != null ? v.maxMileage.toLocaleString('en-GB') : '—'}</td>
                <td>${fuelChargeCell}</td>
                <td>${nafEsc(nafFuelLabel(v.fuelType))}</td>
                <td>${nafEsc(v.engineType || '—')}</td>
                <td>${nafEsc(v.transmissionType === 'A' ? 'Auto' : v.transmissionType === 'M' ? 'Manual' : (v.transmissionType || '—'))}</td>
                <td>${nafEsc(v.drivenWheels || '—')}</td>
                <td>${tankCell}</td>
                <td>${isLongterm}</td>
                <td>${nafEsc(_nafGetMD(v.licensePlate).cor || '—')}</td>
                <td>${nafEsc(String(v.internalNumber ?? '—'))}</td>
                <td><span class="status-pill ${catClass}">${nafEsc(nafFormatSubStatus(v.subStatus))}</span></td>
                <td>${nafEsc(v.classicActivityCode || '—')}</td>
                <td>${nafEsc(v.vehicleCategory || '—')}</td>
                <td>${nafEsc(v.vehicleType || '—')}</td>
                <td>${nafEsc(poolName)}</td>
                <td>${nafEsc(regionName)}</td>
                <td>${atBranchCell}</td>
                <td>${updatedCell}</td>
                <td>${rentalAgreement}</td>
                <td>${nafEsc(rentalStatus)}</td>
                <td>${nafEsc(rateCode)}</td>
                <td>${v.navigation ? '✓' : '—'}</td>
                <td>${v.drawBar ? '✓' : '—'}</td>
                <td>${nafEsc(v.vin || '—')}</td>
                <td>${nafEsc(v.make || '—')}</td>
                <td>${nafEsc(v.bodyType || '—')}</td>
                <td>${nafEsc(String(v.classicStatus ?? '—'))}</td>
                <td>${nafEsc(branchName)}</td>
                <td>${nafEsc(v.parkingSlot || '—')}</td>
                <td>${statusCell}</td>
                <td>${nafEsc(v.winterSuitableTires || v.winterSuitableTiresType || '—')}</td>
                <td>${nafEsc(v.holdCodeForDueDate || '—')}</td>
                <td>${nafEsc(v.holdDescriptionForDueDate || '—')}</td>
                <td>${nafEsc(window.renaFormatDate(v.holdDueDate))}</td>
                <td>${v.holdDueMileage != null ? v.holdDueMileage.toLocaleString('en-GB') : '—'}</td>
                <td>${nafEsc(v.holdCodeForMileage || '—')}</td>
                <td>${nafEsc(v.holdDescriptionForMileage || '—')}</td>
                <td>${v.holdRemainingMileage != null ? v.holdRemainingMileage.toLocaleString('en-GB') : '—'}</td>
                <td>${v.hasDueBlockingHold ? "<span style=\"color:#ef4444\">Yes</span>" : '—'}</td>
                <td>${holdsCount}</td>
                <td>${nafEsc(v.priority || '—')}</td>
                <td>${v.hasLongTermRestriction ? "Yes" : '—'}</td>
                <td>${v.customsCleared != null ? (v.customsCleared ? "Yes" : "No") : '—'}</td>
                <td>${passengers}</td>
                <td>${doors}</td>
            </tr>`;
        }).join('');

        const rc = document.getElementById('nafResultsCount');
        if (rc) {
            const end = Math.min(start + NAF.PAGE_SIZE, NAF.filtered.length);
            rc.textContent = `${start + 1}–${end} of ${NAF.filtered.length} vehicle${NAF.filtered.length !== 1 ? 's' : ''}`;
        }
        nafUpdateSortHeaders();
    }

    // ── KPI CARDS ───────────────────────────────────────────────
    function nafRenderKPIs() {
        const data = NAF.rawData;
        const total = data.length;
        if (!total) return;

        const _ptPlateRe = /^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/i;
        function _isPtPlate(v) {
            const p = (v.licensePlate || '').trim();
            return _ptPlateRe.test(p);
        }

        const outros    = data.filter(v => !_isPtPlate(v)).length;
        const ptData    = data.filter(v => _isPtPlate(v));
        const rented    = ptData.filter(v => v.classicStatus === 0).length;
        const available = ptData.filter(v => { const s = v.classicStatus; return s === 1 || s === 2 || s === 3 || s === 4 || s === 7 || s === 11; }).length;
        const oficina   = ptData.filter(v => { const s = v.classicStatus; return s === 5 || s === 6; }).length;
        const pendentes = ptData.filter(v => { const s = v.classicStatus; return s === 9 || s === 10; }).length;
        const devolucao = ptData.filter(v => v.classicStatus === 45).length;
        const semCategoria = total - outros - rented - available - oficina - pendentes - devolucao;

        const toDefleet = data.filter(v => (v.subStatus || '').toUpperCase().includes('DEFLEET')).length;
        const infleeted = data.filter(v => {
            const code = (v.holdCodeForDueDate || '').toUpperCase();
            const desc = (v.holdDescriptionForDueDate || '').toUpperCase();
            const sub  = (v.subStatus || '').toUpperCase();
            return code.includes('INFLEET') || desc.includes('INFLEET') || sub.includes('INFLEET');
        }).length;
        const longterm = data.filter(v => v.rentalActivity && v.rentalActivity.isLongterm).length;
        const preparation = data.filter(v => {
            const u = (v.subStatus || '').toUpperCase();
            return u.includes('PREP') || u.includes('CLEANING');
        }).length;
        const stuck30 = data.filter(v => {
            if (v.classicStatus === 0) return false;
            const d = nafDaysAgo(v.inStatusSince);
            return d !== null && d >= 30;
        }).length;

        const pct = (n) => total > 0 ? ((n / total) * 100).toFixed(1) : '0';

        nafSetKpi('statTotalFleet', total.toLocaleString('en-GB'));
        nafSetKpi('statAvailable', available.toLocaleString('en-GB'));
        nafSetKpi('statRented', rented.toLocaleString('en-GB'));
        nafSetKpi('statNAF', oficina.toLocaleString('en-GB'));
        nafSetKpi('statPendentes', pendentes.toLocaleString('en-GB'));
        nafSetKpi('statDevolucao', devolucao.toLocaleString('en-GB'));
        nafSetKpi('statOutros', (outros + semCategoria).toLocaleString('en-GB'));
        nafSetKpi('statDefleet', toDefleet.toLocaleString('en-GB'));
        nafSetKpi('statInfleet', infleeted.toLocaleString('en-GB'));
        nafSetKpi('statLongterm', longterm.toLocaleString('en-GB'));
        nafSetKpi('statPreparation', preparation.toLocaleString('en-GB'));
        nafSetKpi('statStuck30', stuck30.toLocaleString('en-GB'));

        nafSetKpi('statAvailPct', pct(available));
        nafSetKpi('statRentedPct', pct(rented));
        nafSetKpi('statNAFPct', pct(oficina));
        nafSetKpi('statPendentesPct', pct(pendentes));
        nafSetKpi('statDevolucaoPct', pct(devolucao));

        const badge = document.getElementById('nafTotalBadge');
        if (badge) badge.textContent = total;

        const dashCap = document.getElementById('dashCapturedLabel');
        if (dashCap && NAF.capturedAt) {
            dashCap.textContent = "Date as of: " + window.renaFormatDate(NAF.capturedAt);
        }

        nafRenderHealthBar(data, total, rented, available, oficina, pendentes, devolucao, outros);
        nafRenderFleetMap(data);
    }

    // ── HEALTH BAR ──────────────────────────────────────────────
    function nafRenderHealthBar(data, total, rented, available, oficina, pendentes, devolucao, outros) {
        const bar = document.getElementById('dashHealthBar');
        const legend = document.getElementById('dashHealthLegend');
        const section = document.getElementById('dashHealthSection');
        if (!bar || !legend || !total) return;
        if (section) section.style.display = '';

        const segments = [
            { label: "Rented",   count: rented,    color: '#3b82f6' },
            { label: "Available", count: available,  color: '#22c55e' },
            { label: "Workshop",    count: oficina,   color: '#FF5000' },
            { label: "Pending",  count: pendentes,  color: '#f59e0b' },
            { label: "Return",  count: devolucao,  color: '#a855f7' },
            { label: "Other",     count: outros,     color: '#6b7280' },
        ];
        bar.innerHTML = segments.filter(s => s.count > 0).map(s => {
            const w = ((s.count / total) * 100).toFixed(1);
            return `<div style="width:${w}%;background:${s.color};min-width:2px" title="${s.label}: ${s.count} (${w}%)"></div>`;
        }).join('');
        legend.innerHTML = segments.filter(s => s.count > 0).map(s =>
            `<span class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"><span style="width:8px;height:8px;border-radius:2px;background:${s.color};display:inline-block"></span>${s.label}: ${s.count.toLocaleString('en-GB')} (${((s.count/total)*100).toFixed(1)}%)</span>`
        ).join('');
    }

    // ── FLEET DISTRIBUTION MAP ─────────────────────────────────────────
    let _nafFleetMap = null;
    let _nafMapMarkers = [];
    let _nafMapLayers = {};
    let _nafExpandedZone = null;
    let _nafZoneMarkers = {};

    function _nafGetPairedMap() {
        const paired = {};
        const stations = NAF_STATION_CFG.stations || {};
        Object.entries(stations).forEach(([code, s]) => {
            if (s.paired) {
                paired[code] = s.paired;
                paired[s.paired] = code;
            }
        });
        return paired;
    }

    function _nafStationStats(vehicles) {
        let total = 0, avail = 0, rented = 0, oficina = 0, longterm = 0, pendentes = 0, devolucao = 0;
        vehicles.forEach(v => {
            total++;
            const s = v.classicStatus;
            if (s === 0) { rented++; if (v.rentalActivity && v.rentalActivity.isLongterm) longterm++; }
            else if (s === 1 || s === 2 || s === 3 || s === 4 || s === 7 || s === 11) avail++;
            else if (s === 5 || s === 6) oficina++;
            else if (s === 9 || s === 10) pendentes++;
            else if (s === 45) devolucao++;
        });
        return { total, avail, rented, oficina, longterm, pendentes, devolucao };
    }

    window.nafRenderFleetMap = function (data) {
        const mapEl = document.getElementById('nafFleetMap');
        const section = document.getElementById('dashMapSection');
        if (!mapEl || !data || !data.length || typeof L === 'undefined') return;
        if (section) section.style.display = '';

        const stations = NAF_STATION_CFG.stations || {};
        const zones = NAF_STATION_CFG.zones || {};
        const hiddenTypes = new Set(NAF_STATION_CFG.hiddenTypes || []);
        const pairedMap = _nafGetPairedMap();

        // ── Group vehicles by EFFECTIVE branch ──
        const branchGroups = {};
        data.forEach(v => {
            const eff = _nafEffectiveBranch(v);
            const num = eff.number || '';
            if (!num) return;
            if (!branchGroups[num]) branchGroups[num] = { name: eff.name, vehicles: [] };
            branchGroups[num].vehicles.push(v);
        });

        // ── Merge paired stations ──
        const merged = {};
        const processed = new Set();

        Object.entries(branchGroups).forEach(([key, info]) => {
            if (processed.has(key)) return;
            processed.add(key);

            let station = stations[key];
            if (!station) {
                if (info.name) {
                    const nl = info.name.toLowerCase();
                    for (const [code, s] of Object.entries(stations)) {
                        if (s.nome && s.nome.toLowerCase() === nl) {
                            station = s;
                            key = code;
                            break;
                        }
                    }
                }
                if (!station) {
                    merged['_unmapped_' + key] = { station: null, vehicles: info.vehicles, pool: '', code: key };
                    return;
                }
            }

            const entry = { station: { ...station, numero: key }, vehicles: [...info.vehicles], pool: '', code: key };

            const pairedCode = pairedMap[key];
            if (pairedCode && branchGroups[pairedCode] && !processed.has(pairedCode)) {
                processed.add(pairedCode);
                entry.vehicles.push(...branchGroups[pairedCode].vehicles);
                const paired = stations[pairedCode];
                if (paired) {
                    // Parque takes priority over Oficina in paired merge
                    if (paired.tipo === "Parking" && entry.station.tipo === "Workshop") {
                        entry.station.pairedName = entry.station.nome;
                        entry.station.nome = paired.nome;
                        entry.station.tipo = "Parking";
                        entry.station.zona = paired.zona || entry.station.zona;
                        entry.station.numero = pairedCode + ' / ' + key;
                        if (paired.lat) { entry.station.lat = paired.lat; entry.station.lon = paired.lon; }
                    } else {
                        entry.station.pairedName = paired.nome;
                        entry.station.numero = key + ' / ' + pairedCode;
                        if (!entry.station.lat && paired.lat) { entry.station.lat = paired.lat; entry.station.lon = paired.lon; }
                    }
                }
            } else if (pairedCode && !branchGroups[pairedCode]) {
                const paired = stations[pairedCode];
                if (paired && !entry.station.lat && paired.lat) {
                    entry.station.lat = paired.lat;
                    entry.station.lon = paired.lon;
                }
            }

            merged[key] = entry;
        });

        // ── Ensure every configured station appears ──
        Object.entries(stations).forEach(([code, s]) => {
            if (processed.has(code)) return;
            const pairedCode = pairedMap[code];
            if (pairedCode && processed.has(pairedCode)) return;
            merged[code] = { station: { ...s, numero: code }, vehicles: [], pool: '', code };
        });

        // ── Classify entries by type ──
        const zoneStations = {};
        const individualMarkers = [];
        const unmappedBranches = [];
        let mappedCount = 0, unmappedCount = 0;
        const zoneAgg = {};

        Object.values(merged).forEach(({ station, vehicles, pool, code }) => {
            const stats = _nafStationStats(vehicles);

            if (!station) {
                unmappedCount += stats.total;
                const v0 = vehicles[0];
                const bName = (v0 && v0.branch && v0.branch.name) || '?';
                const bNum = code || '?';
                if (stats.total > 0) unmappedBranches.push({ name: bName, number: bNum, count: stats.total });
                return;
            }

            const tipo = station.tipo || "Station";
            if (hiddenTypes.has(tipo)) return;

            mappedCount += stats.total;
            const entry = { station, stats, pool, code, tipo, vehicles };

            if (tipo === "Station") {
                const z = station.zona || "Other";
                if (!zoneStations[z]) zoneStations[z] = [];
                zoneStations[z].push(entry);
            } else {
                individualMarkers.push(entry);
            }

            const z = station.zona || "Other";
            if (!zoneAgg[z]) zoneAgg[z] = { total:0, avail:0, rented:0, oficina:0, longterm:0, pendentes:0, devolucao:0, stations:0, estacoes:0 };
            const za = zoneAgg[z];
            za.total += stats.total; za.avail += stats.avail; za.rented += stats.rented;
            za.oficina += stats.oficina; za.longterm += stats.longterm;
            za.pendentes += stats.pendentes; za.devolucao += stats.devolucao;
            za.stations++;
            if (tipo === "Station") za.estacoes++;
        });

        // ── Initialise Leaflet map (once) ──
        if (!_nafFleetMap) {
            const ptBounds = L.latLngBounds(L.latLng(32.0, -31.5), L.latLng(42.2, -6.0));
            _nafFleetMap = L.map('nafFleetMap', {
                zoomControl: false, attributionControl: true, scrollWheelZoom: true,
                maxBounds: ptBounds.pad(0.1), maxBoundsViscosity: 0.9, minZoom: 5, maxZoom: 18
            }).fitBounds(ptBounds, { padding: [20, 20] });

            L.geoJSON(window.RENA_DEMO_GEOGRAPHY, {style: {color: '#82919a', weight: 1, fillColor: '#28383f', fillOpacity: 0.85}}).addTo(_nafFleetMap);

            L.control.zoom({ position: 'topright' }).addTo(_nafFleetMap);
            setTimeout(() => { _nafFleetMap.invalidateSize(); }, 400);
        }

        // ── Clear old markers/layers ──
        _nafMapMarkers.forEach(m => _nafFleetMap.removeLayer(m));
        _nafMapMarkers = [];
        Object.values(_nafMapLayers).forEach(lg => _nafFleetMap.removeLayer(lg));
        _nafMapLayers = {};
        _nafZoneMarkers = {};
        _nafExpandedZone = null;

        // ── Zone centers ──
        const zoneCenters = {};
        Object.entries(zoneStations).forEach(([z, entries]) => {
            let latSum = 0, lonSum = 0, count = 0;
            entries.forEach(e => {
                if (e.station.lat && e.station.lon) { latSum += e.station.lat; lonSum += e.station.lon; count++; }
            });
            if (count > 0) zoneCenters[z] = { lat: latSum / count, lon: lonSum / count };
        });

        // ── Zone cluster markers ──
        const zoneOrder = Object.keys(zones).length > 0 ? Object.keys(zones) : ["North", "Central", "South", "Islands"];
        zoneOrder.forEach(z => {
            const entries = zoneStations[z];
            if (!entries || !entries.length) return;
            const center = zoneCenters[z];
            if (!center) return;

            const meta = zones[z] || { color: '#FF5000', icon: 'fa-circle' };
            const za = zoneAgg[z] || { total: 0 };
            const totalVehicles = entries.reduce((sum, e) => sum + e.stats.total, 0);
            const size = Math.max(44, Math.min(72, 38 + Math.sqrt(totalVehicles) * 3));

            const zoneMarker = L.marker([center.lat, center.lon], {
                icon: L.divIcon({
                    className: '',
                    html: '<div class="fleet-zone-cluster" style="width:' + size + 'px;height:' + size + 'px;background:' + meta.color + '">'
                        + '<div class="fzc-count">' + totalVehicles + '</div>'
                        + '<div class="fzc-label">' + z + '</div>'
                        + '</div>',
                    iconSize: [size, size], iconAnchor: [size / 2, size / 2]
                })
            });

            const pctAvail = totalVehicles > 0 ? Math.round(za.avail / totalVehicles * 100) : 0;
            const pctRent = totalVehicles > 0 ? Math.round(za.rented / totalVehicles * 100) : 0;
            const pctOfi = totalVehicles > 0 ? Math.round(za.oficina / totalVehicles * 100) : 0;

            const zonePopup = '<div class="fmp-header">'
                + '<h4><i class="fas ' + meta.icon + '" style="margin-right:6px"></i>' + z + '</h4>'
                + '<div class="fmp-sub">' + entries.length + " stations · Click to expand</div>"
                + '</div>'
                + '<div class="fmp-grid">'
                + '<div class="fmp-cell fmp-accent"><div class="fmp-val">' + totalVehicles + '</div><div class="fmp-lbl">Total</div></div>'
                + '<div class="fmp-cell"><div class="fmp-val" style="color:#4ade80">' + za.avail + "</div><div class=\"fmp-lbl\">Available</div></div>"
                + '<div class="fmp-cell"><div class="fmp-val" style="color:#60a5fa">' + za.rented + '</div><div class="fmp-lbl">Em contrato</div></div>'
                + '<div class="fmp-cell"><div class="fmp-val" style="color:#fbbf24">' + za.oficina + "</div><div class=\"fmp-lbl\">Workshop</div></div>"
                + '<div class="fmp-cell"><div class="fmp-val" style="color:#818cf8">' + za.longterm + "</div><div class=\"fmp-lbl\">Long-Term</div></div>"
                + '<div class="fmp-cell"><div class="fmp-val" style="color:#f472b6">' + (za.pendentes + za.devolucao) + '</div><div class="fmp-lbl">Pend./Devol.</div></div>'
                + '</div>'
                + '<div class="fmp-footer" style="padding:6px 14px">'
                + '<div class="fmp-bar"><div class="fmp-bar-seg" style="width:' + pctAvail + '%;background:#22c55e"></div><div class="fmp-bar-seg" style="width:' + pctRent + '%;background:#3b82f6"></div><div class="fmp-bar-seg" style="width:' + pctOfi + '%;background:#f59e0b"></div><div class="fmp-bar-seg" style="width:' + Math.max(0, 100 - pctAvail - pctRent - pctOfi) + '%;background:#6b7280"></div></div>'
                + '<div class="fmp-foot-legend" style="display:flex;gap:8px;margin-top:4px">'
                + '<span><i style="background:#22c55e"></i>Disp ' + pctAvail + '%</span>'
                + '<span><i style="background:#3b82f6"></i>Alug ' + pctRent + '%</span>'
                + '<span><i style="background:#f59e0b"></i>Ofic ' + pctOfi + '%</span>'
                + '</div></div>';

            zoneMarker.bindPopup(zonePopup, { className: 'fleet-map-popup', maxWidth: 280, minWidth: 220 });
            zoneMarker.on('click', function (e) {
                L.DomEvent.stopPropagation(e);
                _nafToggleZone(z, entries, zones);
            });

            zoneMarker.addTo(_nafFleetMap);
            _nafMapMarkers.push(zoneMarker);
            _nafZoneMarkers[z] = zoneMarker;

            const stationLayer = L.layerGroup();
            entries.forEach(entry => {
                if (!entry.station.lat || !entry.station.lon) return;
                const st = entry.station;
                const stats = entry.stats;
                const count = stats.total;
                const markerSize = Math.max(24, Math.min(48, 20 + Math.sqrt(count) * 4.5));

                const stMarker = L.marker([st.lat, st.lon], {
                    icon: L.divIcon({
                        className: '',
                        html: '<div class="fleet-map-marker" style="width:' + markerSize + 'px;height:' + markerSize + 'px;background:' + meta.color + '">' + count + '</div>',
                        iconSize: [markerSize, markerSize], iconAnchor: [markerSize / 2, markerSize / 2]
                    })
                });
                stMarker.bindPopup(_nafBuildStationPopup(st, stats, entry.vehicles), { className: 'fleet-map-popup', maxWidth: 300, minWidth: 240 });
                stationLayer.addLayer(stMarker);
            });
            _nafMapLayers[z] = stationLayer;
        });

        // ── Individual markers (Agentes, Parques, Oficinas) ──
        const typeIcons = {
            "Agent": { color: '#8b5cf6', icon: '<i class="fas fa-user-tie"></i>', shape: 'circle' },
            "Parking": { color: '#0d9488', icon: '<i class="fas fa-warehouse"></i>', shape: 'square' },
            "Workshop": { color: '#ef4444', icon: '<i class="fas fa-wrench"></i>', shape: 'square' }
        };

        individualMarkers.forEach(entry => {
            const st = entry.station;
            if (!st.lat || !st.lon) return;
            const stats = entry.stats;
            const count = stats.total;
            const tipo = entry.tipo;
            const tCfg = typeIcons[tipo] || { color: '#FF5000', icon: '<i class="fas fa-location-dot" aria-hidden="true"></i>', shape: 'circle' };
            const markerSize = Math.max(26, Math.min(42, 22 + Math.sqrt(count) * 4));
            const cssClass = tipo === "Agent" ? 'fleet-map-agent' : (tipo === "Parking" ? 'fleet-map-depot' : 'fleet-map-workshop');

            const marker = L.marker([st.lat, st.lon], {
                icon: L.divIcon({
                    className: '',
                    html: '<div class="' + cssClass + '" style="width:' + markerSize + 'px;height:' + markerSize + 'px;background:' + tCfg.color + '">'
                        + '<span class="fmi-icon">' + tCfg.icon + '</span>'
                        + '<span class="fmi-count">' + count + '</span>'
                        + '</div>',
                    iconSize: [markerSize, markerSize], iconAnchor: [markerSize / 2, markerSize / 2]
                })
            });

            if (tipo === "Workshop") {
                marker.bindPopup(_nafBuildDepotPopup(st, stats, entry.vehicles, tipo), { className: 'fleet-map-popup', maxWidth: 300, minWidth: 240 });
            } else {
                marker.bindPopup(_nafBuildStationPopup(st, stats, entry.vehicles), { className: 'fleet-map-popup', maxWidth: 300, minWidth: 240 });
            }

            marker.addTo(_nafFleetMap);
            _nafMapMarkers.push(marker);
        });

        // ── Zone summary cards ──
        const zoneSummaryEl = document.getElementById('nafZoneSummary');
        if (zoneSummaryEl) {
            zoneSummaryEl.innerHTML = zoneOrder.map(z => {
                const za = zoneAgg[z] || { total:0, avail:0, rented:0, oficina:0, stations:0, estacoes:0 };
                const meta = zones[z] || { color:'#666', icon:'fa-circle' };
                const utilPct = za.total > 0 ? Math.round(za.rented / za.total * 100) : 0;
                return '<div class="naf-zone-card" onclick="nafExpandZoneFromCard(\'' + z + '\')" style="cursor:pointer">'
                    + '<div class="flex items-center gap-2 mb-1">'
                    +   '<i class="fas ' + meta.icon + '" style="color:' + meta.color + ';font-size:10px"></i>'
                    +   '<span class="nzc-title" style="color:' + meta.color + '">' + z + '</span>'
                    + '</div>'
                    + '<div class="nzc-count">' + za.total + '</div>'
                    + '<div class="nzc-sub">'
                    +   '<span style="color:#4ade80">' + za.avail + ' disp</span> · '
                    +   '<span style="color:#60a5fa">' + za.rented + ' alug</span> · '
                    +   '<span style="color:#fbbf24">' + za.oficina + ' ofic</span>'
                    + '</div>'
                    + '<div class="nzc-sub mt-1">' + za.estacoes + " stations · utilization " + utilPct + '%</div>'
                    + '</div>';
            }).join('');
        }

        // ── Header summary ──
        const totalLabel = document.getElementById('dashMapTotal');
        if (totalLabel) {
            const totalStations = Object.values(zoneStations).reduce((sum, arr) => sum + arr.length, 0) + individualMarkers.length;
            totalLabel.textContent = totalStations + ' locais · ' + (mappedCount + unmappedCount) + " vehicles"
                + (unmappedCount ? ' (' + unmappedCount + ' no location)' : '');
        }

        // ── Unmapped warning ──
        const warnEl = document.getElementById('nafUnmappedWarn');
        if (warnEl) {
            if (unmappedBranches.length > 0) {
                warnEl.style.display = '';
                warnEl.innerHTML = '<i class="fas fa-exclamation-triangle text-yellow-500 mr-1"></i> '
                    + '<strong>' + unmappedBranches.length + " stations unmapped</strong> ("
                    + unmappedCount + " vehicles): "
                    + unmappedBranches.map(b => b.number + ' — ' + nafEsc(b.name) + ' (' + b.count + ')').join(' · ');
                console.table(unmappedBranches);
            } else {
                warnEl.style.display = 'none';
            }
        }

        _nafFleetMap.invalidateSize();
    };

    // ── Toggle zone expansion ──
    function _nafToggleZone(zone, entries, zones) {
        const layer = _nafMapLayers[zone];
        const zoneMarker = _nafZoneMarkers[zone];
        if (!layer) return;

        if (_nafExpandedZone === zone) {
            _nafFleetMap.removeLayer(layer);
            if (zoneMarker) zoneMarker.addTo(_nafFleetMap);
            _nafExpandedZone = null;
            _nafFleetMap.fitBounds(L.latLngBounds(L.latLng(32.0, -31.5), L.latLng(42.2, -6.0)), { padding: [20, 20] });
        } else {
            if (_nafExpandedZone && _nafMapLayers[_nafExpandedZone]) {
                _nafFleetMap.removeLayer(_nafMapLayers[_nafExpandedZone]);
                const prevZM = _nafZoneMarkers[_nafExpandedZone];
                if (prevZM) prevZM.addTo(_nafFleetMap);
            }
            if (zoneMarker) _nafFleetMap.removeLayer(zoneMarker);
            layer.addTo(_nafFleetMap);
            _nafExpandedZone = zone;
            const bounds = L.latLngBounds([]);
            entries.forEach(e => {
                if (e.station.lat && e.station.lon) bounds.extend([e.station.lat, e.station.lon]);
            });
            if (bounds.isValid()) {
                _nafFleetMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
            }
        }
    }

    window.nafExpandZoneFromCard = function (zone) {
        if (_nafExpandedZone !== zone) {
            if (_nafExpandedZone && _nafMapLayers[_nafExpandedZone]) {
                _nafFleetMap.removeLayer(_nafMapLayers[_nafExpandedZone]);
                const prevZM = _nafZoneMarkers[_nafExpandedZone];
                if (prevZM) prevZM.addTo(_nafFleetMap);
            }
            const layer = _nafMapLayers[zone];
            const zoneMarker = _nafZoneMarkers[zone];
            if (layer) {
                if (zoneMarker) _nafFleetMap.removeLayer(zoneMarker);
                layer.addTo(_nafFleetMap);
                _nafExpandedZone = zone;
                const bounds = L.latLngBounds([]);
                layer.eachLayer(m => bounds.extend(m.getLatLng()));
                if (bounds.isValid()) _nafFleetMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
            }
        } else {
            _nafToggleZone(zone, [], {});
        }
    };

    // ── Station popup ──
    function _nafBuildStationPopup(station, stats, vehicles) {
        const count = stats.total;
        const pctAvail = count > 0 ? Math.round(stats.avail / count * 100) : 0;
        const pctRent = count > 0 ? Math.round(stats.rented / count * 100) : 0;
        const pctOfi = count > 0 ? Math.round(stats.oficina / count * 100) : 0;
        const pctOther = Math.max(0, 100 - pctAvail - pctRent - pctOfi);
        const returningHere = vehicles.filter(v => v.classicStatus === 0 && v.returnBranch && _nafBranchId(v.returnBranch)).length;
        const pairedSub = station.pairedName
            ? '<div style="font-size:9px;color:#888;margin-top:1px">+ ' + nafEsc(station.pairedName) + '</div>'
            : '';

        return '<div class="fmp-header">'
            + '<h4>' + nafEsc(station.nome) + '</h4>'
            + '<div class="fmp-sub">' + nafEsc(station.zona || '') + ' · Nº ' + nafEsc(station.numero || '') + (station.tipo && station.tipo !== "Station" ? ' · ' + station.tipo : '') + '</div>'
            + pairedSub
            + '</div>'
            + '<div class="fmp-grid">'
            + '<div class="fmp-cell fmp-accent"><div class="fmp-val">' + count + '</div><div class="fmp-lbl">Total</div></div>'
            + '<div class="fmp-cell"><div class="fmp-val" style="color:#4ade80">' + stats.avail + "</div><div class=\"fmp-lbl\">Available</div></div>"
            + '<div class="fmp-cell"><div class="fmp-val" style="color:#60a5fa">' + stats.rented + '</div><div class="fmp-lbl">Em contrato</div></div>'
            + '<div class="fmp-cell"><div class="fmp-val" style="color:#fbbf24">' + stats.oficina + "</div><div class=\"fmp-lbl\">Workshop</div></div>"
            + '<div class="fmp-cell"><div class="fmp-val" style="color:#818cf8">' + stats.longterm + "</div><div class=\"fmp-lbl\">Long-Term</div></div>"
            + '<div class="fmp-cell"><div class="fmp-val" style="color:#f472b6">' + (stats.pendentes + stats.devolucao) + '</div><div class="fmp-lbl">Pend./Devol.</div></div>'
            + '</div>'
            + (returningHere > 0 ? '<div style="padding:4px 14px;font-size:10px;color:#60a5fa;border-top:1px solid #1a1a1a"><i class="fas fa-arrow-right" style="margin-right:4px"></i>' + returningHere + ' retornam aqui</div>' : '')
            + '<div class="fmp-footer" style="padding:6px 14px">'
            + '<div class="fmp-bar"><div class="fmp-bar-seg" style="width:' + pctAvail + '%;background:#22c55e"></div><div class="fmp-bar-seg" style="width:' + pctRent + '%;background:#3b82f6"></div><div class="fmp-bar-seg" style="width:' + pctOfi + '%;background:#f59e0b"></div><div class="fmp-bar-seg" style="width:' + pctOther + '%;background:#6b7280"></div></div>'
            + '<div class="fmp-foot-legend" style="display:flex;gap:8px;margin-top:4px">'
            + '<span><i style="background:#22c55e"></i>Disp ' + pctAvail + '%</span>'
            + '<span><i style="background:#3b82f6"></i>Alug ' + pctRent + '%</span>'
            + '<span><i style="background:#f59e0b"></i>Ofic ' + pctOfi + '%</span>'
            + '</div></div>';
    }

    // ── Depot/workshop popup ──
    function _nafBuildDepotPopup(station, stats, vehicles, tipo) {
        const count = stats.total;
        const subCounts = {};
        vehicles.forEach(v => {
            const sub = nafFormatSubStatus(v.subStatus) || "Other";
            subCounts[sub] = (subCounts[sub] || 0) + 1;
        });
        const subEntries = Object.entries(subCounts).sort((a, b) => b[1] - a[1]);

        const iconLabel = tipo === "Workshop" ? "Workshop" : "Support parking";
        const pairedSub2 = station.pairedName
            ? '<div style="font-size:9px;color:#888;margin-top:1px">+ ' + nafEsc(station.pairedName) + '</div>'
            : '';

        let html = '<div class="fmp-header">'
            + '<h4>' + nafEsc(station.nome) + '</h4>'
            + '<div class="fmp-sub">' + iconLabel + ' · ' + nafEsc(station.zona || '') + ' · Nº ' + nafEsc(station.numero || '') + '</div>'
            + pairedSub2
            + '</div>'
            + '<div class="fmp-grid">'
            + '<div class="fmp-cell fmp-accent"><div class="fmp-val">' + count + '</div><div class="fmp-lbl">Total</div></div>'
            + '<div class="fmp-cell"><div class="fmp-val" style="color:#fbbf24">' + stats.oficina + "</div><div class=\"fmp-lbl\">Under repair</div></div>"
            + '<div class="fmp-cell"><div class="fmp-val" style="color:#4ade80">' + stats.avail + "</div><div class=\"fmp-lbl\">Available</div></div>"
            + '<div class="fmp-cell"><div class="fmp-val" style="color:#f472b6">' + (stats.pendentes + stats.devolucao) + '</div><div class="fmp-lbl">Pend./Devol.</div></div>'
            + '</div>';

        if (subEntries.length > 0) {
            html += '<div style="padding:6px 14px;border-top:1px solid #1a1a1a">'
                + '<div style="font-size:9px;color:#777;text-transform:uppercase;margin-bottom:4px">Detalhe</div>';
            subEntries.slice(0, 6).forEach(([sub, cnt]) => {
                html += '<div style="display:flex;justify-content:space-between;font-size:11px;padding:1px 0"><span style="color:#ccc">' + nafEsc(sub) + '</span><span style="color:#FF5000;font-weight:600">' + cnt + '</span></div>';
            });
            html += '</div>';
        }
        return html;
    }

    // ── Fly to station ──
    window.nafMapFlyTo = function(lat, lon) {
        if (_nafFleetMap) {
            _nafFleetMap.flyTo([lat, lon], 13, { duration: 0.8 });
            _nafMapMarkers.forEach(m => {
                const ll = m.getLatLng();
                if (Math.abs(ll.lat - lat) < 0.001 && Math.abs(ll.lng - lon) < 0.001) {
                    setTimeout(() => m.openPopup(), 900);
                }
            });
        }
    };

    // ── Plate Conflicts (duplicate internalNumbers per plate) ───
    let _plateConflictsData = {};
    let _plateOverridesData = {};

    window.nafCheckPlateConflicts = async function () {
        try {
            const res = await fetch((window.API_BASE || '') + '/api/fleet/plate-conflicts');
            if (!res.ok) return;
            const json = await res.json();
            if (!json.success) return;
            _plateConflictsData = json.conflicts || {};
            _plateOverridesData = json.overrides || {};
            const banner = document.getElementById('nafPlateConflictBanner');
            if (!banner) return;
            const count = Object.keys(_plateConflictsData).length;
            if (count > 0) {
                document.getElementById('nafPlateConflictText').textContent =
                    count === 1
                        ? "One license plate has multiple internal IDs. Review the records."
                        : `There are ${count} license plates have multiple internal IDs. Review the records.`;
                banner.classList.remove('hidden');
                banner.classList.add('flex');
            } else {
                banner.classList.add('hidden');
                banner.classList.remove('flex');
            }
        } catch (e) { console.warn('Plate conflicts check error:', e); }
    };

    window.nafShowPlateConflicts = function () {
        const conflicts = _plateConflictsData;
        const overrides = _plateOverridesData;
        const plates = Object.keys(conflicts);
        if (plates.length === 0) return;

        // Build modal HTML
        let rows = '';
        plates.forEach(plate => {
            const entries = conflicts[plate];
            const savedId = overrides[plate] || null;
            rows += `<div class="mb-4 p-3 rounded-lg bg-lynx-subtle dark:bg-white/5 border border-lynx-divider dark:border-gray-700">
                <div class="font-semibold text-sm mb-2 text-gray-800 dark:text-gray-200">
                    <i class="fas fa-car mr-1"></i> ${nafEsc(plate)}
                    ${savedId ? '<span class="ml-2 text-xs text-green-500"><i class="fas fa-check-circle mr-1"></i>Resolvido: ' + nafEsc(savedId) + '</span>' : ''}
                </div>
                <div class="space-y-1">`;
            entries.forEach(e => {
                const isSaved = savedId === e.internalNumber;
                const sub = e.subStatus || '—';
                const cs = e.classicStatus != null ? e.classicStatus : '—';
                const km = e.mileage != null ? Number(e.mileage).toLocaleString('en-GB') : '—';
                rows += `<div class="flex items-center gap-3 p-2 rounded ${isSaved ? 'bg-green-50 dark:bg-green-500/10 border border-green-300 dark:border-green-700' : 'lynx-surface border border-lynx-divider dark:border-gray-700'}">
                    <div class="flex-1 text-xs">
                        <span class="font-mono font-bold text-sm">${nafEsc(e.internalNumber)}</span>
                        <span class="ml-2 text-gray-500">${nafEsc(e.displayName)}</span>
                        <span class="ml-2">Status: <b>${nafEsc(String(cs))}</b></span>
                        <span class="ml-2">Sub: <b>${nafEsc(sub)}</b></span>
                        <span class="ml-2">KM: <b>${km}</b></span>
                    </div>
                    <button onclick="nafSavePlateOverride('${nafEsc(plate)}','${nafEsc(e.internalNumber)}')"
                            class="px-3 py-1 text-xs font-medium rounded-lg ${isSaved
                                ? 'bg-green-500 text-white cursor-default'
                                : 'bg-primary-500 hover:bg-primary-600 text-white'}">
                        ${isSaved ? '<i class="fas fa-check mr-1"></i>Selecionado' : '<i class="fas fa-hand-pointer mr-1"></i>Usar este'}
                    </button>
                </div>`;
            });
            rows += '</div></div>';
        });

        const html = `<div id="nafPlateConflictModal" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onclick="if(event.target===this)this.remove()">
            <div class="lynx-modal w-full max-w-xl max-h-[80vh] overflow-hidden flex flex-col" onclick="event.stopPropagation()">
                <div class="flex items-center justify-between p-4 border-b border-lynx-divider dark:border-gray-700">
                    <h3 class="text-base font-bold text-gray-800 dark:text-white"><i class="fas fa-triangle-exclamation text-amber-500 mr-2"></i>License Plates with Multiple Internal IDs</h3>
                    <button onclick="document.getElementById('nafPlateConflictModal').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><i class="fas fa-xmark text-lg"></i></button>
                </div>
                <div class="p-4 overflow-y-auto text-sm text-gray-700 dark:text-gray-300">
                    <p class="mb-3 text-xs text-gray-500">Choose the correct internal ID for each license plate. The selected record will supply its alerts and details.</p>
                    ${rows}
                </div>
            </div>
        </div>`;

        // Remove existing modal if any
        const old = document.getElementById('nafPlateConflictModal');
        if (old) old.remove();
        document.body.insertAdjacentHTML('beforeend', html);
    };

    window.nafSavePlateOverride = async function (plate, internalNumber) {
        try {
            const res = await fetch((window.API_BASE || '') + '/api/fleet/plate-override', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plate, internalNumber })
            });
            if (!res.ok) return;
            const json = await res.json();
            if (json.success) {
                _plateOverridesData[plate] = internalNumber;
                // Remove from conflicts since resolved
                delete _plateConflictsData[plate];
                // Re-render modal with updated state
                const modal = document.getElementById('nafPlateConflictModal');
                if (modal) {
                    modal.remove();
                    if (Object.keys(_plateConflictsData).length > 0) {
                        nafShowPlateConflicts();
                    }
                }
                // Update banner
                const banner = document.getElementById('nafPlateConflictBanner');
                const remaining = Object.keys(_plateConflictsData).length;
                if (remaining === 0) {
                    if (banner) { banner.classList.add('hidden'); banner.classList.remove('flex'); }
                } else {
                    document.getElementById('nafPlateConflictText').textContent =
                        remaining === 1
                            ? "One license plate has multiple internal IDs. Review the records."
                            : `There are ${remaining} license plates have multiple internal IDs. Review the records.`;
                }
            }
        } catch (e) { console.warn('Save plate override error:', e); }
    };

})();
