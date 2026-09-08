/* Presentation controls for the self-contained, read-only demonstration. */
(function () {
    'use strict';
    function init() {
        const banner = document.createElement('aside'); banner.id = 'renaDemoNotice';
        banner.textContent = "DEMO · Synthetic examples · No operational system connections";
        document.body.prepend(banner);
        const hidden = ['nafTokenExpiredBanner','nafNoBearerBanner','nafSharedFetchBanner','nafLynxSessionBar','nafMasterPanel','nafOpStatus','resAdminBar'];
        hidden.forEach(id => { const node = document.getElementById(id); if (node) node.remove(); });
        // Operational writes are disabled in the UI and independently rejected by the server.
        const actions = /(?:nafClaimMaster|nafReleaseMaster|nafForceReleaseMaster|nafLynxSession|nafOpenLynxRefresh|nafSettingsSave|nafSave|resForce|resRefresh|fpRefreshInfleet|rotNova|rotCriar|rotGuardar|rotSalvar|rotConfirmar|rotEliminar|rotApagar|rotEnviar|rotAdjudicar|rotConcluir|rotSplit|rotVerificar|ccSave|ccOpenConfig)/i;
        function disableActions(root) {
            root.querySelectorAll('[onclick]').forEach(node => {
                if (actions.test(node.getAttribute('onclick'))) {
                    node.dataset.demoDisabled = 'true'; node.title = "This read-only demo keeps its example data unchanged.";
                    if ('disabled' in node) node.disabled = true;
                }
            });
        }
        disableActions(document);
        const observer = new MutationObserver(changes => {
            changes.forEach(change => change.addedNodes.forEach(node => { if (node.nodeType === 1) disableActions(node); }));
        });
        observer.observe(document.body, {childList:true, subtree:true});
        fetch('/api/demo/info').then(r => r.json()).then(info => {
            banner.textContent = "DEMO · Synthetic data · Scenario date: " + window.renaFormatDate(info.display_date, true);
            banner.title = "The scenario is shifted from 8 September 2026 to the current day. No external data is fetched.";
        });
        document.addEventListener('click', event => {
            const link = event.target.closest('a[href^="mailto:"], [data-demo-disabled]');
            if (link) { event.preventDefault(); event.stopImmediatePropagation(); }
        }, true);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
