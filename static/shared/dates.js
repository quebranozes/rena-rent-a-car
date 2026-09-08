/* One display convention for RENA. Keep ISO values in inputs and calculations. */
(function () {
    'use strict';
    window.renaFormatDate = function (value, dateOnly = false, missing = '—') {
        if (value === null || value === undefined || value === '') return missing;
        const raw = String(value).trim();
        let date, time = '';
        const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
        const pt = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::\d{2})?)?$/);
        const formatted = raw.match(/^(\d{2}):(\d{2}) \/ (\d{2}\/\d{2}\/\d{4})$/);
        if (formatted) return dateOnly ? formatted[3] : raw;
        if (iso && !iso[6]) {
            date = `${iso[3]}/${iso[2]}/${iso[1]}`;
            if (iso[4]) time = `${iso[4]}:${iso[5]}`;
        } else if (pt) {
            date = `${pt[1]}/${pt[2]}/${pt[3]}`;
            if (pt[4]) time = `${pt[4]}:${pt[5]}`;
        } else if (value instanceof Date || (iso && iso[6])) {
            const parsed = value instanceof Date ? value : new Date(raw);
            if (Number.isNaN(parsed.getTime())) return missing;
            const parts = new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
            }).formatToParts(parsed);
            const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
            date = `${p.day}/${p.month}/${p.year}`;
            time = `${p.hour}:${p.minute}`;
        } else {
            return raw;
        }
        return time && !dateOnly ? `${time} / ${date}` : date;
    };
})();
