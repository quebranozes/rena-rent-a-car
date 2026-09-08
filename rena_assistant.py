"""Read-only operational assistant. No network calls or model-generated figures.

The host supplies snapshots and an allowlisted set of existing calculations.
Conversation context contains filters only, never cached answers or credentials.
"""
from collections import Counter
from datetime import date, datetime, timedelta, timezone
import re
import unicodedata
from rena_planning import refine_plan, analyse_planning, analyse_capacity
from rena_dates import date_label
from rena_language import normalize_query


PAGES = {
    'dashboard': ('Overview', 'Operational overview and fleet metrics.'),
    'fleet': ('Fleet', 'Search license plates, statuses, groups and vehicle locations.'),
    'island-blocking': ('Island Transfers', 'Find candidates using the island transfer eligibility rules.'),
    'rotation': ('Fleet Rotation', 'Review loads, origins, destinations and transport status.'),
    'match-vehicle': ('Vehicle Match', 'Find reservations matching a vehicle under the system rules.'),
    'analytics': ('Analytics', 'Analyze fleet distribution and statuses.'),
    'reservations': ('Reservations', 'Review reservations, pickups and returns by date, station and group.'),
    'ow-foreign': ('Foreign One-Way', 'Review foreign-registered vehicles.'),
    'duplicados': ('Duplicates', 'Review potential duplicate reservations before taking action.'),
    'capacity-control': ('Capacity & Slots', 'Compare pickups with configured daily and hourly limits.'),
    'planning': ('Planning', 'Review projected balances by pool, date and group.'),
    'settings': ('Settings', 'Review the settings available to your role.'),
}
INTENT_PAGES = {
    'briefing': ['planning'],
    'priorities': ['dashboard', 'fleet', 'reservations', 'capacity-control'],
    'overview': ['dashboard', 'fleet', 'analytics'], 'fleet': ['fleet', 'analytics'],
    'vehicle': ['fleet', 'match-vehicle'], 'models': ['fleet', 'match-vehicle'],
    'reservations': ['reservations'], 'foreign': ['ow-foreign'],
    'capacity': ['capacity-control'], 'planning': ['planning'],
    'duplicates': ['duplicados'], 'rotation': ['rotation'],
    'match': ['match-vehicle'], 'islands': ['island-blocking'],
}
EXAMPLES = [
    ('briefing', 'Analyze planning and capacity for the next 7 days'),
    ('planning', 'Which Luxury groups have shortages by pool over the next 7 days?'),
    ('planning', 'Occupancy by station above 90% tomorrow'),
    ('planning', 'LCV balances and occupancy by pool tomorrow'),
    ('capacity', 'Which time slots exceed capacity tomorrow?'),
    ('priorities', 'What should I prioritize today?'),
    ('overview', 'How is the fleet?'), ('fleet', 'How many vehicles are in the workshop?'),
    ('reservations', 'Which reservations are unassigned tomorrow?'),
    ('capacity', 'Where do we exceed capacity over the next 7 days?'),
    ('planning', 'Are there vehicle shortages over the next 7 days?'),
    ('duplicates', 'Which potential duplicate reservations do we have?'),
    ('rotation', 'Which transport loads are in transit?'),
    ('match', 'Find reservations for a license plate'),
    ('islands', 'Which vehicles are eligible for island transfers?'),
]


def norm(value):
    return normalize_query(''.join(c for c in unicodedata.normalize('NFKD', str(value or '').lower())
                   if not unicodedata.combining(c)))


def plate_key(value):
    return re.sub(r'[^A-Z0-9]', '', str(value or '').upper())


def branch(value):
    return str(value.get('id') or value.get('number') or '') if isinstance(value, dict) else str(value or '')


def can(me, page):
    return me.get('role') in ('owner', 'mod') or page in (me.get('pages') or [])


def can_intent(me, intent):
    return any(can(me, p) for p in INTENT_PAGES.get(intent, []))


def suggestions(me):
    return [text for intent, text in EXAMPLES if can_intent(me, intent)][:5]


def local_dt(value, tz=None):
    try:
        result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return result.astimezone(tz) if tz and result.tzinfo else result
    except (ValueError, TypeError):
        return None


def day_of(value, tz=None):
    parsed = local_dt(value, tz)
    return parsed.date().isoformat() if parsed else ''


def fleet_state(v):
    # Same buckets as the Frota page, including pending preparation separately.
    try:
        code = int(v.get('classicStatus'))
    except (ValueError, TypeError):
        return 'Unclassified'
    if code == 0:
        return 'Rented'
    if code in (1, 2, 3, 4, 7, 11):
        return 'Available'
    if code in (5, 6):
        return 'Workshop'
    if code in (9, 10):
        return 'Pending preparation'
    if code == 45:
        return 'Return'
    return 'Other statuses'


class Assistant:
    def __init__(self, data, me, calculate=None, today=None, tz=None):
        self.data, self.me = data, me
        self.calculate = calculate or (lambda name, args: {})
        self.tz = tz
        self.today = today or datetime.now(tz).date()
        allowed = me.get('allowed_stations')
        self.allowed = None if allowed is None else set(map(str, allowed))
        self.stations = {str(k): v for k, v in data.get('stations', {}).items()
                         if self.allowed is None or str(k) in self.allowed}
        self.fleet = []
        seen = set()
        for v in data.get('fleet') or []:
            key = plate_key(v.get('licensePlate'))
            sid = branch(v.get('branch')) or str(v.get('currentBranchId') or '')
            if key and key not in seen and (self.allowed is None or sid in self.allowed):
                self.fleet.append(v)
                seen.add(key)
        self.reservations = []
        seen = set()
        for r in data.get('reservations') or []:
            sid = str(r.get('PICK_STATION_ID') or '')
            key = str(r.get('RESERVATION_NO') or '')
            if (self.allowed is None or sid in self.allowed) and (not key or key not in seen):
                self.reservations.append(r)
                if key:
                    seen.add(key)
        self.groups = {str(v.get('acrissCode') or '')[:4].upper() for v in self.fleet}
        self.groups.update(str(r.get('ZGROUP') or '').upper() for r in self.reservations)
        self.groups.discard('')

    def name(self, sid):
        return (self.stations.get(str(sid)) or {}).get('nome') or str(sid or 'Not specified')

    def datetime_label(self, value):
        return date_label(value, self.tz)

    def response(self, reply, *, intent='', rows=None, columns=None, sources=(), notes=(), plan=None):
        source_rows, warnings = [], list(notes)
        for source in dict.fromkeys(sources):
            meta = self.data.get('sources', {}).get(source, {})
            source_rows.append({'label': meta.get('label', source), 'updated_at': meta.get('updated_at') or None,
                                'updated_at_label': date_label(meta.get('updated_at'), self.tz, missing='Date unavailable')})
            ts = local_dt(meta.get('updated_at'), self.tz)
            if not ts:
                warnings.append(f'{meta.get("label", source)}: update time unavailable.')
            else:
                now = datetime.now(ts.tzinfo)
                if (now - ts).total_seconds() > meta.get('stale_minutes', 90) * 60:
                    warnings.append(f'{meta.get("label", source)}: outdated snapshot; check the source page.')
            warnings.extend(meta.get('warnings') or [])
        pages = [p for p in INTENT_PAGES.get(intent, []) if can(self.me, p)]
        items = rows or []
        result = {
            'success': True, 'reply': reply, 'intent': intent, 'mode': 'local',
            'sources': source_rows, 'warnings': list(dict.fromkeys(warnings)),
            'actions': [{'page': p, 'label': 'Open ' + PAGES[p][0]} for p in pages[:2]],
            'suggestions': suggestions(self.me), 'context': plan or {},
        }
        if columns:
            result['table'] = {'columns': columns, 'rows': items[:20], 'total': len(items)}
        return result

    def parse(self, message, previous=None):
        text = norm(message).strip()
        previous = previous if isinstance(previous, dict) else {}
        follow = bool(re.match(r'^(e\b|dess[ae]|ness[ae]|dest[ae]|nessas|desses|so\b|apenas\b)', text) or re.search(r'\b(?:essa|esta|dessa|desta|mesma|este|esse|desse|deste)\s+(?:viatura|matricula|grupo|estacao|reserva)\b', text))
        plan = {k: previous[k] for k in ('intent', 'station_ids', 'group', 'state', 'plate', 'start', 'end', 'unassigned', 'returns', 'one_way', 'reservation', 'location', 'min_days', 'rotation_state', 'date_explicit', 'model_query') if follow and k in previous}
        intent = None
        rules = [
            ('priorities', r'prioriz|prioridad|riscos?|o que .*verificar|pontos? de atencao'),
            ('freshness', r'atualiz|captur|desatualiz|dados.*(antigos|recentes)'),
            ('help', r'^ola\b|^bom dia|ajuda|o que (sabes|podes|consegues)|como (usar|funciona)|como .*sistema'),
            ('duplicates', r'duplicad'), ('capacity', r'capacidade|slots?|limite.*(diario|horario)'),
            ('planning', r'planeamento|previsao|prever|saldo|ocupacao|negativ|defici|daymin|cluster|falta de (frota|viaturas|carros)|frota.*(chega|suficiente)'),
            ('rotation', r'cargas?|rotation|transportes?|em transito'),
            ('islands', r'ilhas|madeira.*bloque|acores.*bloque'),
            ('match', r'match|compativ|alocar|encontrar reservas para|reservas para .*matricula'),
            ('foreign', r'estrangeir'),
            ('reservations', r'reservas?|levantamentos?|pick.?up|check.?out|devolucoes'),
            ('models', r'modelos?|marcas?|que carros .*grupo|grupo .*modelos'),
            ('overview', r'resumo|visao geral|como esta .*frota|situacao.*operacao'),
            ('fleet', r'frota|viaturas?|carros?|oficina|disponive|alugad|preparacao'),
        ]
        for candidate, pattern in rules:
            if re.search(pattern, text):
                intent = candidate
                break
        if intent and not follow:
            plan = {}
        if intent:
            plan['intent'] = intent
        # Explicit, formatted or compact Portuguese plates; lookup also accepts foreign plates.
        plate_match = re.search(r'\b(?:[a-z]{2}[- ]\d{2}[- ][a-z]{2}|\d{2}[- ]\d{2}[- ][a-z]{2}|[a-z]{2}[- ]\d{2}[- ]\d{2}|[a-z]{2}\d{2}[a-z]{2})\b', text)
        known = {plate_key(v.get('licensePlate')): v.get('licensePlate') for v in self.fleet}
        if plate_match:
            plan['plate'] = known.get(plate_key(plate_match[0]), plate_match[0].upper().replace(' ', '-'))
        else:
            for token in re.findall(r'\b[a-z0-9-]{5,12}\b', text):
                if plate_key(token) in known:
                    plan['plate'] = known[plate_key(token)]
                    break
        if plan.get('plate') and (not intent or intent in ('fleet', 'models')):
            plan['intent'] = 'vehicle'
        if plan.get('plate') and intent == 'reservations' and re.search(r'para|suger|compativ', text):
            plan['intent'] = 'match'
        res_match = re.search(r'\breserva\s*(?:n[ºo.]?\s*)?([a-z]*\d{5,}[a-z0-9]*)\b', text)
        if res_match:
            plan['reservation'] = res_match[1].upper()
            plan['intent'] = 'reservations'
        explicit_group = re.search(r'(?<!por )\bgrupo\s+([a-z]{1,4})\b', text)
        group = explicit_group[1].upper() if explicit_group else None
        if not group:
            group = next((t.upper() for t in re.findall(r'\b[a-z]{3,4}\b', text) if t.upper() in self.groups), None)
        if group:
            plan['group'] = self.data.get('aliases', {}).get(group, group)
            plan.setdefault('intent', 'models')
            codes = {t.upper() for t in re.findall(r'\b[a-z]{3,4}\b', text) if t.upper() in self.groups}
            if len(codes) > 1:
                plan['group_error'] = True
        elif re.search(r'todos os grupos|sem filtro de grupo', text):
            plan.pop('group', None)
        # Longest known name wins ("Porto Aeroporto" is more specific than "Porto").
        candidates = []
        for sid, station in self.stations.items():
            labels = [station.get('nome'), station.get('zona'), station.get('regiao'), self.data.get('pools', {}).get(sid)]
            for label in labels:
                token = norm(label)
                if token and re.search(r'(?<!\w)' + re.escape(token) + r'(?!\w)', text):
                    candidates.append((len(token), sid, str(label)))
            if re.search(r'\b(?:estacao|station)\s+' + re.escape(sid) + r'\b', text):
                candidates.append((1000, sid, self.name(sid)))
        if not candidates:
            # City-level requests intentionally aggregate every matching station.
            for city in ('lisboa', 'porto', 'faro', 'madeira', 'funchal', 'acores', 'ponta delgada', 'braga', 'coimbra'):
                if re.search(r'\b' + city + r'\b', text):
                    for sid, station in self.stations.items():
                        labels = ' '.join(str(station.get(k) or '') for k in ('nome', 'zona', 'regiao')) + ' ' + str(self.data.get('pools', {}).get(sid) or '')
                        if city in norm(labels):
                            candidates.append((len(city), sid, city.title()))
                    if not candidates:
                        plan['location_error'] = city.title()
        if candidates:
            size = max(c[0] for c in candidates)
            plan['station_ids'] = sorted({sid for length, sid, _ in candidates if length == size})
            plan['location'] = next(c[2] for c in candidates if c[0] == size)
        elif re.search(r'todas as estacoes|todo o pais|nacional', text):
            plan.pop('station_ids', None)
            plan.pop('location', None)
        elif re.search(r'\bestacao\s+\S+', text):
            plan['location_error'] = 'the requested station'
        elif not follow and not candidates:
            location = re.search(r'\b(?:em|no|na)\s+(?:aeroporto\s+(?:de\s+)?)?([a-z][a-z -]*)', text)
            if location:
                place = location[1].split()[0]
                if place not in {'oficina', 'transito', 'preparacao', 'grupo', 'sistema', 'frota', 'cache', 'estado', 'situacao', 'dia', 'semana', 'que', 'cada', 'todos', 'todas', 'portugal', 'proxima', 'proximo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'}:
                    plan['location_error'] = 'the requested location'
        for pattern, state in ((r'oficina', 'Workshop'), (r'disponive', 'Available'), (r'alugad', 'Rented'), (r'preparacao|pendentes', 'Pending preparation')):
            if re.search(pattern, text):
                plan['state'] = state
        if re.search(r'todos os estados', text):
            plan.pop('state', None)
        if re.search(r'sem (matricula|viatura|carro)|nao alocad', text):
            plan['unassigned'] = True
        elif re.search(r'com (matricula|viatura)|todas as reservas', text):
            plan['unassigned'] = False
        if re.search(r'devolucoes|retornos|regressam', text):
            plan['returns'] = True
        elif re.search(r'levantamentos|pick.?up', text):
            plan['returns'] = False
        if re.search(r'one.?way|\bow\b', text):
            plan['one_way'] = True
        if re.search(r'em transito', text):
            plan['rotation_state'] = 'In Transit'
        elif re.search(r'concluid', text):
            plan['rotation_state'] = 'Completed'
        min_days = re.search(r'(?:minimo|pelo menos)\s+(\d+)\s*dias', text)
        if min_days:
            plan['min_days'] = min(int(min_days[1]), 1000)
        date_text = re.sub(r'\b[789](?:\s*[/,-]\s*[789])+\s*lugares\b', '', text)
        dates = re.findall(r'\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}(?:/\d{4})?)\b', date_text)
        start = end = None
        try:
            if dates:
                parsed = []
                for value in dates[:2]:
                    if '/' in value:
                        if value.count('/') == 1:
                            value += '/' + str(self.today.year)
                        parsed.append(datetime.strptime(value, '%d/%m/%Y').date())
                    else:
                        parsed.append(date.fromisoformat(value))
                start, end = parsed[0], parsed[-1]
            elif 'depois de amanha' in text:
                start = end = self.today + timedelta(days=2)
            elif 'amanha' in text:
                start = end = self.today + timedelta(days=1)
            elif 'hoje' in text:
                start = end = self.today
            elif 'ontem' in text:
                start = end = self.today - timedelta(days=1)
            elif (days := re.search(r'proximos?\s+(\d+)\s*dias?', text)):
                count = int(days[1])
                if not 1 <= count <= 90:
                    raise ValueError()
                start, end = self.today, self.today + timedelta(days=count - 1)
            elif 'proxima semana' in text:
                start = self.today + timedelta(days=7 - self.today.weekday())
                end = start + timedelta(days=6)
            elif 'esta semana' in text:
                start, end = self.today, self.today + timedelta(days=6 - self.today.weekday())
            elif 'semana' in text:
                start, end = self.today, self.today + timedelta(days=6)
            else:
                for name, weekday in [('segunda', 0), ('terca', 1), ('quarta', 2), ('quinta', 3), ('sexta', 4), ('sabado', 5), ('domingo', 6)]:
                    if re.search(r'\b' + name + r'(?:-feira)?\b', text):
                        offset = (weekday - self.today.weekday()) % 7
                        start = end = self.today + timedelta(days=offset)
                        break
            if start and (end < start or (end - start).days > 89):
                raise ValueError()
        except ValueError:
            plan['date_error'] = True
        if start:
            plan['start'], plan['end'] = start.isoformat(), end.isoformat()
            plan['date_explicit'] = True
        plan.setdefault('start', self.today.isoformat())
        plan.setdefault('end', plan['start'])
        plan.setdefault('intent', 'unknown')
        plan['query'] = message
        if plan['intent'] in ('fleet', 'models', 'unknown') and self.matching_models(message):
            plan['model_query'] = message
        return refine_plan(message, plan, {**self.data, 'stations': self.stations}, previous, self.today)

    def answer(self, message, previous=None):
        if re.match(r'^\s*(cancela|apaga|elimina|altera|envia|cria|bloqueia|confirma|atualiza)\b', norm(message)):
            return self.response('The assistant only reads and analyzes data. This demo does not modify records. I can help review the information before you decide what to do.')
        plan = self.parse(message, previous)
        intent = plan['intent']
        if plan.get('analysis_error'):
            return self.response(plan['analysis_error'])
        if plan.get('date_error'):
            return self.response('Enter a valid date or a range of up to 90 days, for example 2026-09-10 to 2026-09-15.')
        if plan.get('location_error'):
            return self.response('I could not identify ' + plan['location_error'] + ' among the available stations. Enter the full station name or its ID.')
        if plan.get('group_error'):
            return self.response('Use one vehicle group per query, for example “IFAR reservations tomorrow”.')
        cities = [city for city in ('lisboa', 'porto', 'faro', 'funchal', 'braga', 'coimbra') if re.search(r'\b' + city + r'\b', norm(message))]
        if len(cities) > 1 and intent not in ('planning', 'briefing', 'capacity'):
            return self.response('Use one location per query. To search a route between two cities, use the pickup and return filters on the Reservations page.', intent=intent)
        if intent in INTENT_PAGES and not can_intent(self.me, intent):
            return self.response('Your role cannot access the area required for this query. I can help with the areas listed below.')
        if intent in ('rotation', 'islands', 'match') and plan.get('date_explicit'):
            return self.response('This query follows the horizon and rules of its source page. Repeat the question without a date, or use the filters on that page.', intent=intent)
        if intent in ('rotation', 'duplicates') and plan.get('group'):
            return self.response('Group filters are not supported for this query. Open the relevant page, or repeat the question without a group filter.', intent=intent)
        if intent == 'help':
            rows = [[title, detail] for p, (title, detail) in PAGES.items() if can(self.me, p)]
            return self.response('I can query the demo data and explain operational metrics. Specify a license plate, station, group or date. Follow up with “And tomorrow?” or “And in Porto?”.', rows=rows, columns=['Area', 'How I can help'])
        if intent == 'freshness':
            sources = []
            if any(can_intent(self.me, x) for x in ('fleet', 'overview', 'vehicle')):
                sources.append('fleet')
            if any(can_intent(self.me, x) for x in ('reservations', 'match', 'capacity', 'planning')):
                sources.append('reservations')
            return self.response('These are the update times for the available sources. Answers use the latest snapshot in the system.', sources=sources)
        if intent == 'priorities':
            return self.priorities_answer(plan)
        if intent in ('unknown', 'models') and not plan.get('group'):
            # Model/brand recognition uses the same SAP descriptions as group lookup.
            models = self.model_rows(plan)
            if models and can_intent(self.me, 'models'):
                return self.response('Models found in the current fleet:', intent='models', rows=models, columns=['Model', 'Group', 'Vehicles'], sources=['fleet'], plan=plan)
            return self.response('Please be more specific: provide a station and date for reservations, or a license plate to inspect a vehicle. You can also choose a suggested question.')
        if plan.get('group') and plan['group'] not in self.groups and intent not in ('planning', 'briefing', 'capacity'):
            return self.response(f'I could not find group {plan["group"]} in the available data. Check the ACRISS code or the snapshot date.', intent=intent)
        if intent in ('fleet', 'overview', 'vehicle', 'models', 'foreign', 'islands', 'match', 'planning', 'briefing') and self.data.get('fleet') is None:
            return self.response('The fleet snapshot is unavailable. Open the source page before running this query.', intent=intent, sources=['fleet'])
        if intent in ('reservations', 'capacity', 'planning', 'briefing', 'duplicates', 'match') and self.data.get('reservations') is None:
            return self.response('The reservation snapshot is unavailable. This does not mean there are no reservations.', intent=intent, sources=['reservations'])
        if intent in ('fleet', 'overview', 'foreign', 'models', 'vehicle'):
            return self.fleet_answer(plan)
        if intent == 'reservations':
            return self.reservation_answer(plan)
        try:
            return self.calculated_answer(plan)
        except (OSError, ValueError, RuntimeError, KeyError, TypeError):
            return self.response('This source is currently unavailable. Try again or open the source page to check the data.', intent=intent)

    def scope(self, plan):
        labels = []
        if plan.get('location'):
            labels.append(plan['location'] + f' ({len(plan.get("station_ids", []))} station(s))')
        if plan.get('group'):
            labels.append('grupo ' + plan['group'])
        if self.allowed is not None:
            labels.append('authorized stations only')
        return ' · '.join(labels) or 'All accessible stations'

    def priorities_answer(self, plan):
        rows, sources, notes = [], [], ['Review priorities calculated from the snapshot. An unassigned reservation can still be part of the normal preparation workflow.']
        if can_intent(self.me, 'reservations'):
            sources.append('reservations')
            if self.data.get('reservations') is None:
                notes.append('Reservations unavailable; assignments could not be evaluated.')
            else:
                reservations = self.select_reservations({**plan, 'unassigned': True})
                rows.append(['Unassigned reservations', len(reservations), 'Review preparation and find compatible vehicles in Vehicle Match.'])
        if can_intent(self.me, 'fleet') or can_intent(self.me, 'overview'):
            sources.append('fleet')
            if self.data.get('fleet') is None:
                notes.append('Fleet unavailable; workshop vehicles and returns could not be evaluated.')
            else:
                vehicles = self.select_fleet(plan)
                workshop = sum(fleet_state(v) == 'Workshop' for v in vehicles)
                pending = sum(fleet_state(v) == 'Pending preparation' for v in vehicles)
                overdue = 0
                for v in vehicles:
                    ret = local_dt(v.get('returnTime'), self.tz)
                    if fleet_state(v) == 'Rented' and ret and ret < datetime.now(ret.tzinfo):
                        overdue += 1
                rows.extend([['In workshop', workshop, 'Check expected release dates and their planning impact.'],
                             ['Pending preparation', pending, 'Confirm preparation before counting these vehicles as available.'],
                             ['Expected return overdue', overdue, 'Confirm the return or contract extension; the snapshot may be delayed.']])
        if can_intent(self.me, 'capacity') and self.data.get('reservations') is not None:
            try:
                result = self.calculated_answer({**plan, 'intent': 'capacity'})
                if result.get('table'):
                    # The reply contains the full count; displayed table may be truncated.
                    rows.append(['Capacity & Slots', result['reply'].split('\n')[0], 'Review exceeded limits by station and time period.'])
                    sources += ['reservations', 'capacity']
            except (OSError, ValueError, RuntimeError, KeyError, TypeError):
                notes.append('Capacity could not be evaluated at this time.')
        return self.response(f'Review priorities · {self.scope(plan)}.\nReservas e capacidade: {date_label(plan["start"])} to {date_label(plan["end"])}. Fleet: latest snapshot.', intent='priorities', rows=rows, columns=['Check', 'Result', 'Next step'], sources=sources, notes=notes, plan=plan)

    def select_fleet(self, plan):
        result = []
        models = self.matching_models(plan['model_query']) if plan.get('model_query') else None
        for v in self.fleet:
            sid = branch(v.get('branch')) or str(v.get('currentBranchId') or '')
            group = str(v.get('acrissCode') or '')[:4].upper()
            if plan.get('station_ids') and sid not in plan['station_ids']:
                continue
            if plan.get('group') and self.data.get('aliases', {}).get(group, group) != plan['group']:
                continue
            if plan.get('plate') and plate_key(v.get('licensePlate')) != plate_key(plan['plate']):
                continue
            if plan.get('state') and fleet_state(v) != plan['state']:
                continue
            if models is not None and self.model_name(v) not in models:
                continue
            result.append(v)
        return result

    def model_name(self, v):
        return self.data.get('models', {}).get(plate_key(v.get('licensePlate'))) or v.get('name') or v.get('displayName') or 'Unknown model'

    def matching_models(self, query):
        text = norm(query)
        stop = {'sem', 'com', 'para', 'modelo', 'nao', 'identificado', 'carro', 'viatura', 'grupo', 'de', 'da', 'do', 'the', 'all', 'novo'}
        scores = {}
        for model in {self.model_name(v) for v in self.fleet}:
            words = {w for w in re.findall(r'\w+', norm(model)) if w not in stop and (len(w) >= 3 or any(c.isdigit() for c in w))}
            score = sum(bool(re.search(r'\b' + re.escape(w) + r'\b', text)) for w in words)
            if score:
                scores[model] = score
        best = max(scores.values(), default=0)
        return {model for model, score in scores.items() if score == best}

    def model_rows(self, plan):
        counts = Counter()
        matches = self.matching_models(plan.get('model_query') or plan.get('query')) if not plan.get('group') else None
        for v in self.select_fleet(plan):
            model = self.model_name(v)
            if matches is not None and model not in matches:
                continue
            counts[(model, str(v.get('acrissCode') or '')[:4])] += 1
        return [[m, g, n] for (m, g), n in counts.most_common()]

    def fleet_answer(self, plan):
        intent = plan['intent']
        if intent == 'models':
            rows = self.model_rows(plan)
            return self.response(f'{self.scope(plan)}: {sum(r[2] for r in rows)} vehicle(s).', intent=intent, rows=rows, columns=['Model', 'Group', 'Vehicles'], sources=['fleet'], plan=plan)
        vehicles = self.select_fleet(plan)
        if intent == 'foreign':
            pt = re.compile(r'^(?:[A-Z]{2}\d{2}[A-Z]{2}|\d{4}[A-Z]{2}|[A-Z]{2}\d{4})$')
            vehicles = [v for v in vehicles if not pt.match(plate_key(v.get('licensePlate')))]
        if intent == 'vehicle':
            if not vehicles:
                return self.response('That license plate was not found in the available data and stations.', intent=intent, sources=['fleet'], plan=plan)
            v = vehicles[0]
            sid = branch(v.get('branch')) or v.get('currentBranchId')
            rows = [['Model', self.model_name(v)], ['Group', v.get('acrissCode') or 'Not specified'],
                    ['Reason', v.get('subStatus') or 'Not specified'],
                    ['Current station', self.name(sid)], ['Expected return', self.datetime_label(v.get('returnTime'))],
                    ['Return station', self.name(branch(v.get('returnBranch')))],
                    ['Contract end', date_label(v.get('defleetDate'), self.tz, date_only=True, missing='Not specified')], ['Kilometers', v.get('mileage', 'Not specified')]]
            return self.response(f'Status of {v.get("licensePlate")} in the latest snapshot:', intent=intent, rows=rows, columns=['Field', 'Value'], sources=['fleet'], plan=plan, notes=['This query shows the current snapshot. Check holds and conditions before handing over a vehicle.'])
        states = Counter(fleet_state(v) for v in vehicles)
        reply = f'{self.scope(plan)}: {len(vehicles)} vehicle(s)' + (f' · {plan["state"]}.' if plan.get('state') else '.')
        notes = []
        if plan['start'] != self.today.isoformat() or plan['end'] != self.today.isoformat():
            notes.append('This query shows the current fleet snapshot. For future availability, ask for projected planning balances.')
        if intent == 'overview':
            rows = [[k, n] for k, n in states.most_common()]
            return self.response(reply, intent=intent, rows=rows, columns=['Status', 'Vehicles'], sources=['fleet'], plan=plan, notes=notes)
        rows = [[v.get('licensePlate'), self.model_name(v), v.get('acrissCode'), fleet_state(v), self.name(branch(v.get('branch')) or v.get('currentBranchId'))] for v in vehicles]
        return self.response(reply, intent=intent, rows=rows, columns=['License Plate', 'Model', 'Group', 'Status', 'Station'], sources=['fleet'], plan=plan, notes=notes)

    def select_reservations(self, plan):
        result = []
        key = 'RET' if plan.get('returns') else 'PICK'
        for r in self.reservations:
            if plan.get('reservation'):
                if str(r.get('RESERVATION_NO')).upper() != plan['reservation']:
                    continue
            elif not plan.get('plate'):
                d = day_of(r.get(key + '_DATETIME'), self.tz)
                if not d or not plan['start'] <= d <= plan['end']:
                    continue
            if not plan.get('reservation') and r.get('STATUS') not in ('RS', 'CO'):
                continue
            if plan.get('station_ids') and str(r.get(key + '_STATION_ID')) not in plan['station_ids']:
                continue
            group = str(r.get('ZGROUP') or r.get('ACRISS_CODE') or '').upper()
            if plan.get('group') and self.data.get('aliases', {}).get(group, group) != plan['group']:
                continue
            if plan.get('unassigned') and r.get('LICENCE_PLATE'):
                continue
            if plan.get('plate') and plate_key(r.get('LICENCE_PLATE')) != plate_key(plan['plate']):
                continue
            if plan.get('one_way') and not r.get('ONE_WAY'):
                continue
            result.append(r)
        return sorted(result, key=lambda r: str(r.get(key + '_DATETIME') or ''))

    def reservation_answer(self, plan):
        reservations = self.select_reservations(plan)
        key = 'RET' if plan.get('returns') else 'PICK'
        rows = [[r.get('RESERVATION_NO'), r.get('STATUS'), r.get('ZGROUP') or r.get('ACRISS_CODE'), self.datetime_label(r.get(key + '_DATETIME')), r.get(key + '_STATION_NAME') or self.name(r.get(key + '_STATION_ID')), r.get('LICENCE_PLATE') or 'Unassigned'] for r in reservations]
        period = 'All available records for this reference' if plan.get('reservation') or plan.get('plate') else date_label(plan['start']) + ' to ' + date_label(plan['end'])
        reply = f'{len(rows)} reservation(s) · {self.scope(plan)}.\n{period} · ' + ('returns' if plan.get('returns') else 'pickups') + (' · unassigned' if plan.get('unassigned') else '') + (' · one-way' if plan.get('one_way') else '') + '.'
        return self.response(reply, intent='reservations', rows=rows, columns=['Reservation', 'Status', 'Group', 'Date/hora', 'Station', 'License Plate'], sources=['reservations'], plan=plan, notes=['Counts include RS and CO statuses. Searching by reservation number includes other statuses. Dates are limited to the available snapshot.'])

    def planning_answer(self, plan):
        intent = plan['intent']
        source = 'capacity' if intent == 'capacity' else 'planning'
        payload = self.calculate(source, plan)
        if not isinstance(payload, dict) or payload.get('error') or payload.get('success') is False:
            raise RuntimeError('Planning source unavailable')
        if source == 'planning' and 'pools' not in payload:
            raise RuntimeError('Planning payload incomplete')
        if source == 'capacity' and 'stations_config' not in payload:
            raise RuntimeError('Capacity payload incomplete')
        result = analyse_capacity(payload, plan, self.allowed) if source == 'capacity' else analyse_planning(payload, plan, self.allowed, self.data.get('categories', []))
        sources = ['reservations', 'capacity'] if source == 'capacity' else ['fleet', 'reservations']
        if intent == 'briefing' and plan.get('level', 'pool') == 'pool':
            station_plan = {**plan, 'level': 'station', 'entity_ids': plan.get('station_ids', []), 'breakdown': 'group', 'negative_only': True}
            stations = analyse_planning(payload, station_plan, self.allowed, self.data.get('categories', []))
            result['analysis']['negative_station_group_days'] = stations['analysis']['negative_group_days']
            result['analysis']['negative_station_locations'] = stations['analysis']['negative_locations']
            result['reply'] += f'\nBy station: {stations["analysis"]["negative_group_days"]} negative group-days across {stations["analysis"]["negative_locations"]} station(s).'
            if stations['table']['total']:
                result['sections'].append({**stations['table'], 'title': 'Station shortages, including pools with positive balances'})
        if intent == 'briefing' and can_intent(self.me, 'capacity'):
            try:
                capacity = self.calculate('capacity', plan)
                if not isinstance(capacity, dict) or 'stations_config' not in capacity:
                    raise RuntimeError('Capacity source unavailable')
                additional = analyse_capacity(capacity, {**plan, 'threshold_filter': False}, self.allowed)
                result['reply'] += '\n\n' + additional['reply']
                result['sections'].append(additional['table'])
                result['notes'].extend(additional['notes'])
                result['analysis'].update(additional['analysis'])
                sources.append('capacity')
            except (OSError, ValueError, RuntimeError, KeyError, TypeError):
                result['notes'].append('Capacity could not be included in this analysis. Planning results remain available.')
        reply = self.response(result['reply'], intent=intent, sources=sources, notes=result['notes'], plan=plan)
        reply.update(table=result['table'], sections=result['sections'], analysis=result['analysis'])
        if intent == 'briefing' and can_intent(self.me, 'capacity'):
            reply['actions'].append({'page': 'capacity-control', 'label': 'Open Capacity & Slots'})
        reply['suggestions'] = ([f'Which groups {plan["category"]} have shortages by station over the next 7 days?' if plan.get('category') else 'Which groups have shortages by station over the next 7 days?',
                                 'And occupancy above 95%?', '7/8/9-seater balances by pool tomorrow'] if can_intent(self.me, 'planning') else [])
        if can_intent(self.me, 'capacity'):
            reply['suggestions'].append('Which time slots exceed capacity tomorrow?')
        return reply

    def calculated_answer(self, plan):
        intent = plan['intent']
        if intent in ('planning', 'capacity', 'briefing'):
            end = date.fromisoformat(plan['end'])
            if date.fromisoformat(plan['start']) < self.today or end >= self.today + timedelta(days=90):
                return self.response('This query supports dates from today through the next 90 days. For history, use the records on the relevant page.', intent=intent)
            return self.planning_answer(plan)
        if intent == 'match' and not plan.get('plate'):
            return self.response('Enter a license plate to find compatible reservations. For example: “Find reservations for ZZ-01-DA”.', intent=intent)
        if intent == 'match' and not self.select_fleet({'plate': plan['plate']}):
            return self.response('That license plate was not found at the available stations.', intent=intent)
        result = self.calculate(intent, plan)
        if not isinstance(result, dict) or result.get('error') or result.get('success') is False:
            raise RuntimeError('Source unavailable')
        notes = []
        if intent == 'match':
            candidates = result.get('suggestions') or []
            if self.allowed is not None:
                valid = {str(r.get('RESERVATION_NO')) for r in self.reservations}
                candidates = [r for r in candidates if str(r.get('res_no')) in valid]
            rows = [[r.get('res_no'), r.get('group'), r.get('pick_station'), self.datetime_label(r.get('pick_time')), r.get('ret_station'), self.datetime_label(r.get('ret_time')), 'Contract extension required' if r.get('needs_extension') else 'No extension required'] for r in candidates]
            reply = f'{len(rows)} suggestion(s) for {plan["plate"]}, under the Vehicle Match rules.'
            if not rows:
                reply += '\n' + (result.get('no_match_reason') if result.get('no_match_reason') and self.allowed is None else 'No accessible suggestions for this query.')
            return self.response(reply, intent=intent, rows=rows, columns=['Reservation', 'Group', 'Pickup', 'Date/hora', 'Return', 'Date/hora', 'Condition'], sources=['fleet', 'reservations'], plan=plan, notes=['Suggestions follow Vehicle Match conditions and priorities. No reservation has been assigned or modified.', 'The search returns the top five candidates. Station restrictions limit visibility to the accessible candidates in that selection.'])
        if intent == 'duplicates':
            groups = []
            visible = {str(r.get('RESERVATION_NO')) for r in self.reservations}
            for group in result.get('groups', []):
                members = [r for r in group.get('reservations', []) if str(r.get('RESERVATION_NO')) in visible]
                if plan.get('station_ids'):
                    members = [r for r in members if str(r.get('PICK_STATION_ID')) in plan['station_ids']]
                if plan.get('date_explicit'):
                    members = [r for r in members if plan['start'] <= day_of(r.get('PICK_DATETIME'), self.tz) <= plan['end']]
                if len(members) >= 2:
                    groups.append(members)
            rows = [[i + 1, ', '.join(str(r.get('RESERVATION_NO')) for r in members), self.datetime_label(min(str(r.get('PICK_DATETIME') or '') for r in members)), len(members)] for i, members in enumerate(groups)]
            return self.response(f'{len(groups)} set(s) of potential duplicates in accessible upcoming reservations.\n{self.scope(plan)}' + (f' · {date_label(plan["start"])} to {date_label(plan["end"])}' if plan.get('date_explicit') else ''), intent=intent, rows=rows, columns=['Set', 'Reservations', 'First pickup', 'Count'], sources=['reservations'], plan=plan, notes=['Applies the exclusions and overlap rules from Duplicates. Only sets with at least two reservations in scope are shown. These are candidates for review; no reservations have been cancelled.'])
        if intent == 'rotation':
            self.data['sources']['rotation']['updated_at'] = result.get('consulted_at')
            rows = []
            for carga in result.get('cargas', []):
                ids = {str(carga.get('estacao_origem') or ''), str(carga.get('estacao_destino') or '')}
                if self.allowed is not None and not ids.issubset(self.allowed):
                    continue
                if plan.get('station_ids') and not ids.intersection(plan['station_ids']):
                    continue
                if plan.get('rotation_state') and carga.get('estado') != plan['rotation_state']:
                    continue
                if not plan.get('rotation_state') and carga.get('estado') in ('Completed', 'Cancelled'):
                    continue
                rows.append([carga.get('referencia'), carga.get('estado'), self.name(carga.get('estacao_origem')), self.name(carga.get('estacao_destino')), len(carga.get('viaturas') or [])])
            return self.response(f'{len(rows)} load(s) · ' + (plan.get('rotation_state') or 'ativas') + '.', intent=intent, rows=rows, columns=['Reference', 'Status', 'Origin', 'Destination', 'Vehicles'], sources=['rotation'], plan=plan)
        if intent == 'islands':
            rows = []
            for v in result.get('vehicles', []):
                sid = str(v.get('station_id'))
                if self.allowed is not None and sid not in self.allowed:
                    continue
                if plan.get('station_ids') and sid not in plan['station_ids']:
                    continue
                rows.append([v.get('plate'), v.get('group'), v.get('station'), 'Available' if v.get('is_available') else 'Rented', v.get('remaining_days'), date_label(v.get('return_time'), self.tz, missing='—')])
            return self.response(f'{len(rows)} candidate(s) under the Island Transfer rules, with at least {plan.get("min_days", 200)} days remaining on the contract.', intent=intent, rows=rows, columns=['License Plate', 'Group', 'Station', 'Status', 'Remaining days', 'Expected return'], sources=['fleet'], plan=plan, notes=['Check availability and the remaining eligibility criteria before placing a vehicle on hold.'])
        return self.response('Specify the area you want to query.')
