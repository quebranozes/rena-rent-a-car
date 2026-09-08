/* Load only the fictional local snapshot. No extraction, credentials or background refresh. */
(function () {
    'use strict';
    window.nafLoadStationConfig = async function () {
        const response = await fetch('/api/not-available-fleet/stations');
        const data = await response.json();
        window.NAF_STATION_CFG = data.config;
        window._nafStationCfgLoaded = true;
    };
    window.nafFetchData = async function () {
        if (!NAF.rawData.length) nafSetState('loading');
        try {
            const response = await fetch('/api/not-available-fleet/data');
            if (!response.ok) throw new Error("Could not load the examples.");
            const data = await response.json();
            NAF.rawData = data.vehicles;
            NAF.capturedAt = data.captured_at;
            nafPopulateFilters(); nafApplyFilters(); nafSetState('table');
            await window.nafLoadMasterData?.();
            await window.nafLoadBrandMap?.();
            await window.nafLoadCarModelData?.();
            if (document.getElementById('pageAnalytics')?.style.display !== 'none') window.nafRenderAnalytics?.();
        } catch (error) { nafSetState('error', error.message); }
    };
    window.nafRefresh = window.nafFetchData;
    window.nafOpenLynxRefresh = window.nafFetchData;
    async function init() {
        NAF.initialized = true;
        await nafLoadStationConfig(); await nafFetchData();
        const name = document.getElementById('sidebarUsername'); if (name) name.textContent = "Demo User";
        const role = document.getElementById('sidebarUserRole'); if (role) role.textContent = "Portfolio · Synthetic data";
        document.addEventListener('click', event => {
            if (!event.target.closest('.naf-ms')) document.querySelectorAll('.naf-ms.naf-ms-open').forEach(node => {
                node.classList.remove('naf-ms-open');
                const panel = node.querySelector('.naf-ms-panel'); if (panel) panel.style.display = 'none';
            });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
