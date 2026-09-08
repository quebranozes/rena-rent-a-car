"""Planning diagnostics using the same balances, occupancy and DayMin as the UI.

Pure calculations: no files, requests, model calls or writes. Percentages are
computed from denominators, never averaged between stations or groups.
"""
from rena_dates import date_label
from rena_language import normalize_query
from collections import defaultdict
import re
import unicodedata


def norm(value):
    text = ''.join(c for c in unicodedata.normalize('NFKD', str(value or '').lower()) if not unicodedata.combining(c))
    for source, target in [('lisbon', 'lisboa'), ('airport', 'aeroporto'), ('oporto', 'porto')]:
        text = re.sub(r'\b' + source + r'\b', target, text)
    return normalize_query(text)


def contains(text, label):
    return bool(label and re.search(r'(?<!\w)' + re.escape(label) + r'(?!\w)', text))


def category_matches(text, categories):
    selected = []
    for item in categories:
        name = norm(item.get('nome'))
        hit = contains(text, name)
        if re.search(r'7\s*[-/]\s*9\s*lugares', name):
            hit = hit or bool(re.search(r'\b(?:7|8|9)(?:\s*[/,-]\s*[789])*\s*(?:lugares|lugar)\b', text))
        if name == 'luxury':
            hit = hit or contains(text, 'luxo')
        if name == 'vcl':
            hit = hit or contains(text, 'comerciais')
        if hit:
            selected.append(item)
    return selected


def refine_plan(message, plan, data, previous, today):
    """Enrich operational queries with configured categories, geography and metrics."""
    text = norm(message)
    categories = category_matches(text, data.get('categories') or [])
    signal = bool(re.search(r'ocupacao|\btaxa\b|\bt\.o\b|saldos?|negativ|defici|daymin|minimo intradiario|planeamento|clusters?', text) or categories)
    if signal and plan['intent'] not in ('capacity', 'freshness', 'help'):
        plan['intent'] = 'planning'
    if re.search(r'(analisa|analise|verifica|diagnostico|resumo|prioriz)', text) and ('planeamento' in text or ('sald' in text and 'ocupacao' in text)):
        plan['intent'] = 'briefing' if re.search(r'capacidade|slots?|diagnostico|automatic', text) else 'planning'
    if plan['intent'] not in ('planning', 'capacity', 'briefing'):
        return plan
    for key in ('state', 'model_query', 'plate', 'unassigned', 'returns'):
        # These filters are not used by planning diagnostics.
        plan.pop(key, None)
    prior = previous if isinstance(previous, dict) else {}
    follow = bool(re.match(r'^(e\b|so\b|apenas\b)', text))
    if follow and prior.get('intent') in ('planning', 'capacity', 'briefing'):
        for key in ('groups', 'category', 'level', 'entity_ids', 'breakdown', 'negative_only', 'threshold', 'threshold_filter', 'threshold_direction', 'sort_low', 'metric'):
            if key in prior:
                plan.setdefault(key, prior[key])
    aliases = data.get('aliases') or {}
    configured_groups = {g for c in data.get('categories', []) for g in c.get('groups', [])}
    group_list = re.search(r'\bgrupos?\s+(.+?)(?=\s+(?:hoje|amanha|em|no|na|por|nos|nas|negativos?)\b|$)', text)
    explicit_codes = set()
    if group_list and group_list[1].split()[0].upper() in configured_groups and not re.search(r'\bgrupos\s+a\s+negativ', text):
        explicit_codes = {g.upper() for g in re.findall(r'\b[a-z]{1,4}\b', group_list[1]) if g.upper() in configured_groups}
    if categories:
        plan['groups'] = sorted({aliases.get(g, g) for c in categories for g in c.get('groups', [])})
        plan['category'] = ' + '.join(c['nome'] for c in categories)
        plan.pop('group', None)
        plan.pop('group_error', None)
        plan.pop('location_error', None)
    elif plan.get('group') or explicit_codes:
        codes = set(re.findall(r'\b[A-Z]{3,4}\b', message.upper()))
        known = {g for c in data.get('categories', []) for g in c.get('groups', [])}
        known.update(str(v.get('acrissCode') or '')[:4] for v in data.get('fleet') or [])
        selected = explicit_codes or codes & known or {plan['group']}
        plan['groups'] = sorted({aliases.get(g, g) for g in selected})
        if known and not set(plan['groups']).issubset({aliases.get(g, g) for g in known}):
            plan['analysis_error'] = 'The group was not found in the categories or planning data. Check the code.'
        plan.pop('category', None)
        plan.pop('group_error', None)
    if re.search(r'todos os grupos|sem filtro|todas as categorias', text):
        for key in ('group', 'groups', 'category', 'group_error'):
            plan.pop(key, None)
    if re.search(r'(?<!por )\bcluster\s+\w+', text) and not categories and not plan.get('groups'):
        plan['analysis_error'] = 'Unknown category. Use one of the configured categories: ' + ', '.join(c['nome'] for c in data.get('categories', [])) + '.'
    if re.search(r'\b[789]\s*lugares\b', text) and not re.search(r'7\s*[/,-]\s*[89]|7\s*[-/]\s*9', text):
        plan['category_note'] = 'The configuration combines 7–9 seaters; planning data does not distinguish individual seat counts.'
    plan.setdefault('level', 'pool')
    if re.search(r'por estac|nas estacoes|cada estacao|entre estacoes', text):
        plan['level'] = 'station'
        plan.pop('location_error', None)
    elif re.search(r'por pool|nas pools|cada pool|entre pools', text):
        plan['level'] = 'pool'
    if re.search(r'por grupos?|grupos? individuais|quais .*grupos|grupos .*negativ|grupos a negativo', text):
        plan['breakdown'] = 'group'
    elif re.search(r'por cluster|por categoria', text):
        plan['breakdown'] = 'category'
    plan.setdefault('breakdown', 'total')
    if re.search(r'negativ|defici|falta', text):
        plan['negative_only'] = True
    if re.search(r'mostra tudo|todos os saldos|inclui positivos', text):
        plan['negative_only'] = False
    if re.search(r'ocupacao|\btaxa\b', text):
        plan['metric'] = 'occupancy'
    elif re.search(r'saldo|daymin|negativ', text):
        plan['metric'] = 'balance'
    percent = re.search(r'(acima(?: de)?|superior(?: a)?|mais de|abaixo(?: de)?|inferior(?: a)?|menos de|>=|>|<=|<)\s*(\d+(?:[.,]\d+)?)\s*%', text)
    if percent:
        plan['threshold'] = float(percent[2].replace(',', '.'))
        plan['threshold_filter'] = True
        plan['threshold_direction'] = 'below' if re.match(r'abaixo|inferior|menos|<', percent[1]) else 'above'
    elif re.search(r'alta ocupacao|ocupacao alta', text):
        plan['threshold_filter'] = True
    plan.setdefault('threshold', 90)
    if re.search(r'menor|mais baixa|mais baixas|menos ocup', text) or plan.get('threshold_direction') == 'below':
        plan['sort_low'] = True
    elif re.search(r'maior|mais alta|mais altas|mais ocup', text):
        plan['sort_low'] = False
    if not plan.get('date_explicit') and not follow:
        from datetime import timedelta
        plan['start'] = today.isoformat()
        plan['end'] = (today + timedelta(days=6)).isoformat() if plan.get('metric') != 'occupancy' or plan['intent'] == 'briefing' else plan['start']
    # Resolve geography from stored names; exact pool names beat city aggregates.
    stations = data.get('stations') or {}
    pools = sorted({p for p in (data.get('pools') or {}).values() if p and norm(p).strip()})
    station_hits = []
    for sid, station in stations.items():
        name = norm(station.get('nome'))
        words = [w for w in name.split() if w not in {'de', 'do', 'da', 'dos', 'das'}]
        full = contains(text, name)
        city = next((w for w in words if w != 'aeroporto'), '')
        airport = len(words) == 2 and 'aeroporto' in words and bool(re.search(r'\baeroporto\s+(?:(?:de|do|da)\s+)?' + re.escape(city) + r'\b', text))
        if full or airport or re.search(r'\b(?:estacao\s+)?' + re.escape(str(sid)) + r'\b', text):
            station_hits.append((len(name), str(sid)))
    pool_positions = [(p, m.start(), m.end()) for p in pools for m in re.finditer(r'(?<!\w)' + re.escape(norm(p)) + r'(?!\w)', text)]
    pool_hits = list(dict.fromkeys(p for p, start, end in pool_positions if not any(a <= start and end <= b and b-a > end-start for _, a, b in pool_positions)))
    if station_hits and not re.search(r'\bpool\b', text):
        ids = sorted({sid for _, sid in station_hits if not any(sid != other and contains(norm(stations[other].get('nome')), norm(stations[sid].get('nome'))) for _, other in station_hits)})
        plan.update(level='station', entity_ids=ids, station_ids=ids, location=' + '.join(stations[sid]['nome'] for sid in ids))
        plan.pop('location_error', None)
    elif pool_hits:
        hits = pool_hits
        plan.update(level='pool', entity_ids=hits, station_ids=[sid for sid, pool in data.get('pools', {}).items() if pool in hits], location=' + '.join(hits))
        plan.pop('location_error', None)
    else:
        if re.search(r'(?<!por )\bpool\s+(?!amanha\b|hoje\b|nos\b|por\b|com\b)\w+', text):
            plan['analysis_error'] = 'Unknown pool. Use the configured planning name, for example Pool Porto.'
        cities = {norm(p).removeprefix('pool ').split()[0] for p in pools if norm(p).removeprefix('pool ')}
        mentioned = {c for c in cities if len(c) > 3 and contains(text, c)}
        regions = [r for r in data.get('regions', []) if contains(text, norm(r.get('nome')))]
        if len(mentioned) > 1:
            hits = [p for p in pools if norm(p).removeprefix('pool ').split()[0] in mentioned]
            plan['station_ids'] = [sid for sid, pool in data.get('pools', {}).items() if pool in hits]
            plan['entity_ids'] = hits if plan['level'] == 'pool' else list(plan['station_ids'])
            plan['location'] = ' + '.join(hits)
            plan.pop('location_error', None)
        elif regions:
            hits = sorted({p for r in regions for p in r.get('pools', [])})
            plan['station_ids'] = [sid for sid, pool in data.get('pools', {}).items() if pool in hits]
            plan['entity_ids'] = hits if plan['level'] == 'pool' else list(plan['station_ids'])
            plan['location'] = ' + '.join(r['nome'] for r in regions)
            plan.pop('location_error', None)
        elif plan.get('station_ids'):
            plan['entity_ids'] = list(plan['station_ids']) if plan['level'] == 'station' else sorted({data.get('pools', {}).get(sid) for sid in plan['station_ids']} - {None})
    if re.search(r'todas as estacoes|todas as pools|todo o pais|nacional', text):
        for key in ('entity_ids', 'station_ids', 'location', 'location_error'):
            plan.pop(key, None)
    if re.search(r'por estac|por pool', text) and not station_hits and not pool_hits and not follow and not plan.get('station_ids'):
        plan.pop('location_error', None)
    return plan


def total(mapping, groups=None):
    mapping = mapping or {}
    return sum((mapping.get(g) or 0) for g in groups) if groups is not None else sum(mapping.values())


def day_minimum(opening, row, groups=None):
    events = []
    for key, time_key, delta in [('res_out_details', 'pick_time', -1), ('res_in_details', 'ret_time', 1), ('fleet_in_details', 'ret_time', 1)]:
        for record in row.get(key) or []:
            if groups is not None and record.get('group') not in groups:
                continue
            if delta > 0 and (record.get('is_lt') or (key == 'fleet_in_details' and (record.get('will_defleet') or record.get('will_exceed_km')))):
                continue
            at = str(record.get(time_key) or '')[11:16] or ('00:00' if delta < 0 else '23:59')
            events.append((at, delta))
    running = minimum = opening
    at_min = None
    for at, delta in sorted(events):
        running += delta
        if running < minimum:
            minimum, at_min = running, at
    return minimum, at_min


def series(info, groups=None):
    """Port of planning.js _filterPoolByGroups + _computeDayMin."""
    selected = set(groups) if groups is not None else None
    by_group = info.get('occupancy_by_group') or {}
    if selected is None:
        size = info.get('fleet_total', 0)
        unknown = info.get('unknown_status_count', 0)
        impro = info.get('impro_count', 0)
        stopped = sum(info.get(k, 0) for k in ('oficina_count', 'pronto_of_count', 'blocked_count'))
        running = info.get('available_today', total(info.get('groups_available')))
    else:
        size = sum((by_group.get(g) or {}).get('total', 0) for g in selected)
        unknown = sum((by_group.get(g) or {}).get('unknown', 0) for g in selected)
        impro = sum((by_group.get(g) or {}).get('impro', 0) for g in selected)
        stopped = sum(total(info.get(k), selected) for k in ('groups_oficina', 'groups_pronto_of', 'blocked_groups'))
        running = total(info.get('groups_available'), selected)
    for index, row in enumerate(info.get('rows') or []):
        defleet = total(row.get('groups_defleet_out'), selected) if selected is not None else row.get('defleet_out', 0)
        running -= defleet
        size -= defleet
        # Group figures are recomputed even when forecast_groups suppresses negatives.
        opening = running if selected is not None else row.get('saldo', running)
        pickups = total(row.get('groups_out'), selected) if selected is not None else row.get('res_out', 0)
        returns = (total(row.get('groups_in'), selected) + total(row.get('groups_fleet_in'), selected)) if selected is not None else row.get('res_in', 0) + row.get('fleet_in', 0)
        arrivals = total(row.get('groups_fleet_in'), selected) if selected is not None else row.get('fleet_in', 0)
        base = max(size - unknown, 0)
        rented = base - stopped - impro - opening
        occupancy = round(100 * rented / base, 1) if base > 0 else None
        minimum, at = day_minimum(opening, row, selected)
        yield {'date': row['date'], 'opening': opening, 'closing': opening + returns - pickups,
               'minimum': minimum, 'minimum_at': at, 'occupancy': occupancy, 'base': base,
               'rented': rented, 'pickups': pickups, 'returns': returns}
        running = opening + returns - pickups
        size += arrivals


def known_groups(info):
    groups = set(info.get('occupancy_by_group') or {}) | set(info.get('groups_available') or {})
    for row in info.get('rows') or []:
        for key in ('groups_out', 'groups_in', 'groups_fleet_in', 'groups_defleet_out'):
            groups.update(row.get(key) or {})
    return groups - {''}


def section(title, columns, rows):
    return {'title': title, 'columns': columns, 'rows': rows[:20], 'total': len(rows)}


def analyse_planning(payload, plan, allowed=None, categories=()):
    level = plan.get('level', 'pool')
    entities = payload.get('assistant_stations', {}) if level == 'station' else payload.get('pools', {})
    explicit = set(plan.get('entity_ids') or [])
    groups = plan.get('groups') or ([plan['group']] if plan.get('group') else None)
    grouping = plan.get('breakdown', 'total')
    threshold = plan.get('threshold', 90)
    main, negative, all_metrics, eligible, omitted = [], [], [], [], 0
    for key, info in entities.items():
        if explicit and str(key) not in explicit:
            continue
        members = set(map(str, info.get('station_ids', [key]))) if level == 'station' else set(map(str, payload.get('assistant_pool_members', {}).get(key, [s['id'] for s in payload.get('pool_stations', {}).get(key, [])])))
        if allowed is not None and (not members or not members.issubset(allowed)):
            omitted += 1
            continue
        eligible.append(key)
        name = info.get('name', str(key)) if level == 'station' else str(key)
        cluster = plan.get('category') or ', '.join(groups or []) or 'All'
        scope_series = list(series(info, groups))
        for row in scope_series:
            if plan['start'] <= row['date'] <= plan['end']:
                all_metrics.append({**row, 'entity': name, 'cluster': cluster})
        group_series = {}
        for group in sorted(set(groups) if groups else known_groups(info)):
            values = list(series(info, [group]))
            group_series[group] = values
            for row in values:
                if plan['start'] <= row['date'] <= plan['end'] and min(row['opening'], row['minimum'], row['closing']) < 0:
                    negative.append({**row, 'entity': name, 'cluster': group})
        if grouping == 'group':
            choices = list(group_series.items())
        elif grouping == 'category':
            choices = [(c['nome'], list(series(info, set(c.get('groups', [])) & set(groups) if groups else c.get('groups', [])))) for c in categories]
        else:
            choices = [(cluster, scope_series)]
        for label, values in choices:
            for row in values:
                if not plan['start'] <= row['date'] <= plan['end']:
                    continue
                if plan.get('negative_only') and min(row['opening'], row['minimum'], row['closing']) >= 0:
                    continue
                if plan.get('threshold_filter'):
                    if row['occupancy'] is None:
                        continue
                    if plan.get('threshold_direction') == 'below':
                        if row['occupancy'] >= threshold:
                            continue
                    elif row['occupancy'] <= threshold:
                        continue
                main.append({**row, 'entity': name, 'cluster': label})
    def risk(r):
        return (min(r['opening'], r['minimum'], r['closing']) >= 0, r['date'], min(r['opening'], r['minimum'], r['closing']), -(r['occupancy'] or 0), r['entity'], r['cluster'])
    if plan.get('metric') == 'occupancy' and not plan.get('negative_only'):
        main.sort(key=lambda r: (r['occupancy'] is None, (r['occupancy'] or 0) * (1 if plan.get('sort_low') else -1), r['date'], r['entity']))
    else:
        main.sort(key=risk)
    negative.sort(key=risk)
    columns = ['Station' if level == 'station' else 'Pool', 'Date', 'Group / category', 'Occupancy', 'Opening', 'Minimum', 'Time', 'Closing', 'Departures', 'Arrivals']
    def display(r):
        return [r['entity'], date_label(r['date']), r['cluster'], f'{r["occupancy"]:.1f}%' if r['occupancy'] is not None else 'No fleet baseline', r['opening'], r['minimum'], date_label(r['date'] + 'T' + r['minimum_at']) if r['minimum_at'] else 'Opening', r['closing'], r['pickups'], r['returns']]
    # Exact weighted occupancy per day, not an average across time or entities.
    weighted = defaultdict(lambda: {'base': 0, 'rented': 0})
    for row in all_metrics:
        weighted[row['date']]['base'] += row['base']
        weighted[row['date']]['rented'] += row['rented']
    rates = [round(100 * v['rented'] / v['base'], 1) for v in weighted.values() if v['base']]
    deficit_entities = len({r['entity'] for r in negative})
    high = sum(r['occupancy'] is not None and r['occupancy'] > threshold for r in all_metrics)
    title = f'{date_label(plan["start"])} to {date_label(plan["end"])} · {len(eligible)} ' + ('station(s)' if level == 'station' else 'pool(s)') + (' · ' + plan['category'] if plan.get('category') else '')
    reply = title + f'.\n{len(negative)} group-days with a negative balance or intraday minimum across {deficit_entities} location(s).'
    if rates:
        reply += f' Weighted overall occupancy during the period: {min(rates):.1f}% to {max(rates):.1f}%.'
    if negative:
        first = negative[0]
        reply += f'\nFirst item to review: {first["entity"]}, {first["cluster"]}, {date_label(first["date"])} — opening {first["opening"]}, minimum {first["minimum"]} {('at ' + date_label(first["date"] + "T" + first["minimum_at"])) if first["minimum_at"] else 'at opening'}, closing {first["closing"]}. Confirm returns and whether vehicles from this group can be relocated before that time.'
    elif eligible:
        reply += '\nNo group shortages were found in this scope. Also check hourly service limits.'
    else:
        reply = 'No planning data is available for the selected scope.'
    notes = ['Occupancy uses the planning baseline, excluding unknown statuses and non-revenue movements. Future dates are projections; workshop, workshop-ready and hold counts remain constant.',
             'Intraday minimum: departures precede arrivals at the same time. Long-term, defleet and over-mileage returns do not restore availability. Browser simulations and redistributions are excluded.',
             'A positive category or pool balance does not automatically cover an individual group shortage. Check the upgrade matrix before substituting vehicles.']
    if omitted:
        notes.append(f'{omitted} aggregate(s) excluded because they contain unauthorized stations. Request a station-level analysis to review accessible stations only.')
    if plan.get('category_note'):
        notes.append(plan['category_note'])
    if plan.get('threshold_filter'):
        notes.append(f'Filter: occupancy strictly {"below" if plan.get("threshold_direction") == "below" else "above"} {threshold:g}%.')
    sections = []
    if grouping != 'group' and negative:
        sections.append(section('Individual Group Shortages', columns, [display(r) for r in negative]))
    return {'reply': reply, 'table': section('Occupancy and Balances', columns, [display(r) for r in main]), 'sections': sections,
            'notes': notes, 'analysis': {'negative_group_days': len(negative), 'negative_locations': deficit_entities,
                                        'high_occupancy_days': high, 'entities': len(eligible), 'threshold': threshold,
                                        'occupancy_min': min(rates) if rates else None, 'occupancy_max': max(rates) if rates else None}}


def analyse_capacity(payload, plan, allowed=None):
    rows, missing, excluded = [], [], 0
    selected = set(plan.get('station_ids') or [])
    covered = set()
    for key, cfg in payload.get('stations_config', {}).items():
        ids = set(map(str, cfg.get('station_ids', [key])))
        if selected and not ids.intersection(selected):
            continue
        if allowed is not None and not ids.issubset(allowed):
            excluded += 1
            continue
        covered.update(ids)
        for day, values in payload.get('data', {}).get(key, {}).items():
            if not plan['start'] <= day <= plan['end']:
                continue
            intervals = [('Day', values.get('total', 0), cfg.get('max_daily'))]
            intervals += [(slot.get('label') or slot['key'], values.get('slots', {}).get(slot['key'], 0), slot.get('max')) for slot in payload.get('slots_meta', {}).get(key, [])]
            other = values.get('slots', {}).get('__other__', 0)
            if other:
                intervals.append(('Outside configured slots', other, None))
            for label, count, limit in intervals:
                defined = isinstance(limit, (int, float)) and not isinstance(limit, bool) and limit > 0
                pct = round(count / limit * 100, 1) if defined else None
                state = 'Exceeded' if defined and count > limit else ('At capacity' if defined and count == limit else ('Attention' if pct is not None and pct >= 90 else ('Within limit' if defined else 'No limit defined')))
                if plan.get('threshold_filter'):
                    if pct is None or (pct >= plan['threshold'] if plan.get('threshold_direction') == 'below' else pct <= plan['threshold']):
                        continue
                rows.append([cfg.get('name') or key, day, label, count, limit if defined else '—', limit - count if defined else '—', f'{pct:.1f}%' if pct is not None else '—', state])
    exceeded = [r for r in rows if r[-1] == 'Exceeded']
    near = [r for r in rows if r[-1] in ('At capacity', 'Attention')]
    rows.sort(key=lambda r: ({'Exceeded': 0, 'At capacity': 1, 'Attention': 2, 'No limit defined': 3, 'Within limit': 4}[r[-1]], r[1], r[5] if isinstance(r[5], (int, float)) else 0, r[0], r[2]))
    notes = ['Capacity measures pickup workload; occupancy measures fleet utilization. An hourly service limit can be exceeded even when vehicles are available.',
             'Applies configured out-of-hours rules and station groupings. Warnings start at 90% of capacity; missing limits are not treated as zero.']
    if selected - covered:
        notes.append('Some selected stations have no accessible capacity configuration and were excluded from this assessment.')
    if excluded:
        notes.append('Aggregates containing unauthorized stations were excluded.')
    if plan.get('groups') or plan.get('category'):
        notes.append('Capacity limits apply to the station total. This section counts all vehicle groups, including those outside the selected category.')
    if plan.get('threshold_filter'):
        notes.append(f'Capacity utilization filter: {"below" if plan.get("threshold_direction") == "below" else "above"} {plan["threshold"]:g}%.')
    reply = f'{len(exceeded)} daily or hourly limit(s) exceeded; {len(near)} at or above 90% of capacity.\n{date_label(plan["start"])} to {date_label(plan["end"])}.' if rows else 'No capacity configuration is available for that scope.'
    if exceeded:
        top = exceeded[0]
        reply += f'\nReview first: {top[0]}, {date_label(top[1])}, {top[2]} — {top[3]} pickups against a limit of {top[4]} (excess {top[3] - top[4]}). Review staffing and service distribution for that period.'
    rows = [[r[0], date_label(r[1]), *r[2:]] for r in rows]
    return {'reply': reply, 'table': section('Capacity and Time Slots', ['Station', 'Date', 'Period', 'Reservations', 'Limit', 'Headroom', 'Utilization', 'Status'], rows),
            'sections': [], 'notes': notes, 'analysis': {'capacity_exceeded': len(exceeded), 'capacity_near': len(near), 'capacity_intervals': len(rows)}}
