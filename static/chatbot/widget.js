// Shared assistant interface: floating panel and dedicated page.
(function () {
    'use strict';
    if (window.__renaChatbotLoaded) return;
    window.__renaChatbotLoaded = true;
    const ready = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn();
    ready(function () {
        const sheet = document.createElement('link');
        sheet.rel = 'stylesheet'; sheet.href = '/chatbot/assistant.css?v=2'; document.head.appendChild(sheet);
        const planningSheet = document.createElement('link');
        planningSheet.rel = 'stylesheet'; planningSheet.href = '/chatbot/planning-assistant.css?v=1'; document.head.appendChild(planningSheet);
        const standalone = document.body.hasAttribute('data-assistant-page');
        const root = document.createElement('div'); root.id = 'renaChatbotRoot';
        root.innerHTML = `
            <button id="renaChatFab" type="button" aria-label="Open RENA assistant" aria-controls="renaChatPanel" aria-expanded="false">
                <svg class="ui-icon" aria-hidden="true"><use href="/shared/icons.svg#chat"></use></svg><span>Assistant</span>
            </button>
            <section id="renaChatPanel" role="dialog" aria-labelledby="renaChatTitle">
                <header id="renaChatHeader">
                    <img src="/shared/rena.svg" width="30" height="30" alt="">
                    <div><div id="renaChatTitle" class="title">RENA Assistant</div><p>Occupancy · Balances · Capacity</p></div>
                    <button id="renaChatReset" type="button" title="Start a new conversation" aria-label="Start a new conversation">New conversation</button>
                    <button id="renaChatClose" type="button" title="Close" aria-label="Close assistant">&times;</button>
                </header>
                <div id="renaChatBriefing" hidden aria-live="polite">
                    <div><strong>Automatic briefing · next 7 days</strong><p id="renaChatBriefingText"></p></div>
                    <button id="renaChatBriefingOpen" type="button" disabled>View analysis</button>
                </div>
                <div id="renaChatLog" role="log" aria-live="polite" aria-relevant="additions text"></div>
                <div id="renaChatSuggestions" aria-label="Suggested questions"></div>
                <form id="renaChatComposer">
                    <label class="ui-sr-only" for="renaChatInput">Ask the assistant</label>
                    <textarea id="renaChatInput" rows="2" maxlength="2000" placeholder="Ask about a license plate, station, group or date…"></textarea>
                    <button id="renaChatSend" type="submit">Send</button>
                    <button id="renaChatCancel" type="button" hidden>Cancel</button>
                </form>
                <p class="rcb-footer">Enter to send · Shift+Enter for a new line</p>
            </section>`;
        document.body.appendChild(root);
        const byId = id => document.getElementById(id);
        const fab = byId('renaChatFab'), panel = byId('renaChatPanel'), log = byId('renaChatLog');
        const input = byId('renaChatInput'), form = byId('renaChatComposer'), send = byId('renaChatSend');
        const cancel = byId('renaChatCancel'), prompts = byId('renaChatSuggestions');
        let context = '', controller = null, generation = 0, greeted = false, capabilityVersion = 0;
        let serverNeedsRestart = false;
        let briefingData = null, briefingController = null, autoBriefing = false, lastBriefingAt = 0;

        function element(tag, text, cls) {
            const node = document.createElement(tag);
            if (text !== undefined) node.textContent = text == null ? '—' : String(text);
            if (cls) node.className = cls;
            return node;
        }
        function scroll() { log.scrollTop = log.scrollHeight; }
        function addMessage(text, cls) {
            const node = element('article', undefined, 'rcb-msg ' + cls);
            node.appendChild(element('p', text)); log.appendChild(node);
            while (log.children.length > 60) log.firstElementChild.remove();
            scroll(); return node;
        }
        function showSuggestions(items) {
            prompts.replaceChildren();
            (items || []).slice(0, 4).forEach(text => {
                const button = element('button', text); button.type = 'button';
                button.addEventListener('click', () => { if (!controller) { input.value = text; input.focus(); } });
                prompts.appendChild(button);
            });
        }
        async function capabilities() {
            const version = ++capabilityVersion;
            try {
                const response = await fetch((window.API_BASE || '') + '/api/chatbot/capabilities');
                if (response.status === 404 && version === capabilityVersion) {
                    serverNeedsRestart = true;
                    addMessage("The server is running an older version. Restart RENA to enable the updated assistant.", 'bot');
                    return;
                }
                const data = await response.json();
                if (response.ok && data.success && version === capabilityVersion) {
                    if (Number(data.version || 0) < 3) {
                        serverNeedsRestart = true;
                        addMessage("Restart RENA to enable the updated occupancy, group and time-slot analysis.", 'bot');
                        return;
                    }
                    serverNeedsRestart = false; showSuggestions(data.suggestions);
                    autoBriefing = data.auto_briefing === true;
                    if (autoBriefing) loadBriefing();
                }
            } catch (_) { /* The composer remains usable if suggestions fail to load. */ }
        }
        function greet() {
            if (greeted) return;
            greeted = true;
            addMessage("I can check occupancy, opening balances and intraday minimums, including shortages within Luxury, light commercial vehicles and 7–9 seaters. I also compare pickups with daily capacity and time-slot limits.\nTry “occupancy by station tomorrow” or “negative Luxury groups in Pool Porto”.", 'bot');
            capabilities();
        }
        function render(data) {
            const node = addMessage(data.reply || "No response available.", 'bot');
            const tables = [data.table, ...(data.sections || [])].filter(Boolean);
            tables.forEach(table => {
            if (Array.isArray(table.columns) && Array.isArray(table.rows)) {
                if (table.title) node.appendChild(element('h3', table.title, 'rcb-section-title'));
                const wrap = element('div', undefined, 'rcb-table-wrap');
                wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', "Query results; horizontally scrollable table");
                const grid = element('table'), head = element('thead'), header = element('tr'), body = element('tbody');
                table.columns.forEach(title => { const th = element('th', title); th.scope = 'col'; header.appendChild(th); });
                head.appendChild(header); grid.appendChild(head);
                table.rows.forEach(row => {
                    const tr = element('tr');
                    table.columns.forEach((_, i) => {
                        const cell = element('td', row[i]);
                        if (typeof row[i] === 'number' && row[i] < 0) cell.className = 'rcb-negative';
                        if (row[i] === "Exceeded") cell.className = 'rcb-negative';
                        tr.appendChild(cell);
                    }); body.appendChild(tr);
                });
                grid.appendChild(body); wrap.appendChild(grid); node.appendChild(wrap);
                node.appendChild(element('p', table.rows.length ? `Showing ${table.rows.length} of ${table.total} result(s).` : "No results match the selected filters.", 'rcb-meta'));
            }
            });
            (data.warnings || []).forEach(text => node.appendChild(element('p', text, 'rcb-note')));
            if (data.sources && data.sources.length) {
                const sources = element('div', undefined, 'rcb-sources');
                sources.appendChild(element('strong', "Date sources"));
                data.sources.forEach(source => {
                    const timestamp = source.updated_at_label || window.renaFormatDate(source.updated_at, false, "Date unavailable");
                    sources.appendChild(element('p', source.label + ' · ' + timestamp));
                });
                node.appendChild(sources);
            }
            const actions = element('div', undefined, 'rcb-actions');
            (data.actions || []).forEach(action => {
                if (typeof window.renaNavigateTo !== 'function' || !window.renaHasPage || !window.renaHasPage(action.page)) return;
                const button = element('button', action.label); button.type = 'button';
                button.addEventListener('click', () => { window.renaNavigateTo(action.page); closePanel(); });
                actions.appendChild(button);
            });
            if (navigator.clipboard) {
                const copy = element('button', "Copy response"); copy.type = 'button';
                const plain = node.innerText;
                copy.addEventListener('click', async () => {
                    try { await navigator.clipboard.writeText(plain); copy.textContent = "Copied"; }
                    catch (_) { copy.textContent = "Select the text to copy it"; }
                }); actions.appendChild(copy);
            }
            if (actions.children.length) node.appendChild(actions);
            showSuggestions(data.suggestions);
            if (node.offsetHeight > log.clientHeight) {
                log.scrollTop += node.getBoundingClientRect().top - log.getBoundingClientRect().top - 12;
            } else { scroll(); }
        }
        function openPanel() {
            panel.classList.add('open'); fab.setAttribute('aria-expanded', 'true');
            fab.setAttribute('aria-label', "Close RENA assistant"); greet(); input.focus();
            if (autoBriefing && Date.now() - lastBriefingAt > 120000) loadBriefing();
        }
        function closePanel() {
            if (standalone) return;
            panel.classList.remove('open'); fab.setAttribute('aria-expanded', 'false');
            fab.setAttribute('aria-label', "Open RENA assistant"); fab.focus();
        }
        function reset() {
            generation++; capabilityVersion++; if (controller) controller.abort(); controller = null;
            context = ''; greeted = false; log.replaceChildren(); prompts.replaceChildren(); input.value = '';
            if (briefingController) briefingController.abort(); briefingController = null;
            autoBriefing = false; briefingData = null; lastBriefingAt = 0; byId('renaChatBriefing').hidden = true;
            send.disabled = false; cancel.hidden = true; input.removeAttribute('aria-busy');
            if (panel.classList.contains('open')) { greet(); input.focus(); }
        }
        byId('renaChatReset').addEventListener('click', reset);
        async function loadBriefing() {
            if (!autoBriefing || briefingController || !panel.classList.contains('open')) return;
            const version = generation;
            const active = new AbortController(); briefingController = active;
            const timeout = setTimeout(() => active.abort(), 45000);
            const box = byId('renaChatBriefing'), label = byId('renaChatBriefingText'), open = byId('renaChatBriefingOpen');
            box.hidden = false; label.textContent = "Checking occupancy, balances and limits…"; open.disabled = true;
            try {
                const response = await fetch((window.API_BASE || '') + '/api/chatbot/briefing', {signal:active.signal});
                const data = await response.json();
                if (version !== generation) return;
                if (!response.ok || !data.success) throw new Error(data.error || "Query unavailable");
                briefingData = data; lastBriefingAt = Date.now();
                const metrics = data.analysis;
                if (metrics) {
                    const parts = [];
                    if (metrics.negative_group_days != null) parts.push(`${metrics.negative_group_days} negative group-days by pool`);
                    if (metrics.negative_station_group_days != null) parts.push(`${metrics.negative_station_group_days} by station`);
                    if (metrics.capacity_exceeded != null) parts.push(`${metrics.capacity_exceeded} limits exceeded`);
                    label.textContent = parts.join(' · ') + ". See the sources and notes in the analysis.";
                } else { label.textContent = data.reply; }
                open.disabled = false;
            } catch (_) {
                if (version === generation) label.textContent = "The briefing is currently unavailable. You can still ask about a station or pool.";
            } finally {
                clearTimeout(timeout);
                if (version === generation) briefingController = null;
            }
        }
        byId('renaChatBriefingOpen').addEventListener('click', () => {
            if (!briefingData || controller) return;
            context = briefingData.context || ''; render(briefingData); input.focus();
        });
        setInterval(() => { if (!document.hidden && !controller) loadBriefing(); }, 300000);
        byId('renaChatClose').addEventListener('click', closePanel);
        fab.addEventListener('click', () => panel.classList.contains('open') ? closePanel() : openPanel());
        panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closePanel(); } });
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!controller) form.requestSubmit(); }
        });
        cancel.addEventListener('click', () => { if (controller) controller.abort(); });
        document.addEventListener('rena:permissions', reset);
        form.addEventListener('submit', async event => {
            event.preventDefault(); const text = input.value.trim();
            if (!text || controller) return;
            if (/^(?:celebrate|receba)[\s!?.…]*$/iu.test(text)) {
                addMessage(text, 'user'); input.value = '';
                const node = addMessage("Let's go!", 'bot');
                const gif = element('img', undefined, 'rcb-reaction');
                gif.alt = "RENA celebration";
                gif.width = 220; gif.height = 220;
                gif.addEventListener('load', scroll, { once: true });
                gif.src = '/chatbot/assets/celebration.svg';
                node.appendChild(gif); scroll(); input.focus();
                return;
            }
            if (serverNeedsRestart) {
                addMessage("Restart RENA to load the updated assistant queries.", 'bot');
                capabilities(); return;
            }
            greet(); addMessage(text, 'user'); input.value = ''; send.disabled = true; cancel.hidden = false;
            const typing = addMessage("Querying the data…", 'bot rcb-loading');
            input.setAttribute('aria-busy', 'true');
            const currentGeneration = generation;
            const active = new AbortController(); controller = active;
            let timedOut = false;
            const timeout = setTimeout(() => { timedOut = true; active.abort(); }, 45000);
            try {
                const response = await fetch((window.API_BASE || '') + '/api/chatbot/message', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text, context }), signal: active.signal,
                });
                const data = await response.json();
                if (currentGeneration !== generation) return;
                typing.remove();
                if (!response.ok || !data.success) throw new Error(data.error || "I could not process that question.");
                context = typeof data.context === 'string' ? data.context : '';
                render(data);
            } catch (error) {
                if (currentGeneration !== generation) return;
                typing.remove();
                const message = active.signal.aborted ? (timedOut ? "The query timed out. Please try again." : "Query cancelled.") : "I could not complete the query. " + (error.message || "Check your connection to the local server.");
                const node = addMessage(message, 'bot error');
                const retry = element('button', "Try again", 'rcb-retry'); retry.type = 'button';
                retry.addEventListener('click', () => { if (!controller) { input.value = text; form.requestSubmit(); } });
                node.appendChild(retry); scroll();
            } finally {
                clearTimeout(timeout);
                if (currentGeneration === generation) {
                    controller = null; send.disabled = false; cancel.hidden = true; input.removeAttribute('aria-busy');
                    if (panel.classList.contains('open')) input.focus();
                }
            }
        });
        if (standalone) { fab.hidden = true; byId('renaChatClose').hidden = true; openPanel(); }
    });
})();
