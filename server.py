"""RENA demo: fictional local examples, no operational integrations."""
from datetime import date, datetime
from pathlib import Path
import argparse
import gzip
import json
import secrets
import threading
import webbrowser
from flask import jsonify, request, send_from_directory, abort
from itsdangerous import URLSafeTimedSerializer, BadSignature
import calculations as calc
from demo_clock import today, shift_snapshot, LISBON
from rena_assistant import Assistant, suggestions, PAGES
from rena_dates import date_label

ROOT = Path(__file__).resolve().parent
app = calc.app
ME = {'username': 'demo', 'display_name': 'Demo User', 'role': 'owner', 'pages': None, 'can_lynx': False, 'allowed_stations': None}
signer = URLSafeTimedSerializer(secrets.token_hex(32), salt='rena-demo')
with gzip.open(ROOT/'data/examples.json.gz', 'rt', encoding='utf-8') as handle:
    ORIGINAL = json.load(handle)
BASE = date.fromisoformat(ORIGINAL['metadata']['base_date'])
_loaded_day = None
_calculated = {}
_lock = threading.RLock()


def load_day():
    global _loaded_day
    with _lock:
        if today() != _loaded_day:
            data = shift_snapshot(ORIGINAL, (today() - BASE).days)
            data['metadata'] = dict(ORIGINAL['metadata'], display_date=today().isoformat())
            calc.configure(data)
            _loaded_day = today()
            _calculated.clear()


@app.before_request
def local_only():
    # All data is immutable. Only local chat questions and harmless preview actions accept POST.
    load_day()
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and request.path not in ('/api/chatbot/message', '/api/match-vehicle/log', '/api/demo/reset'):
        return jsonify(success=False, error='This is a read-only demo. Examples are never modified or sent.'), 409


@app.after_request
def headers(response):
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
    response.headers['X-Content-Type-Options'] = 'nosniff'
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response


def calculated(intent, plan):
    if intent == 'rotation':
        return {'cargas': calc.SNAPSHOT['rotation'], 'consulted_at': calc.SNAPSHOT['captured_at']}
    if intent == 'match':
        return calc._match_vehicle_by_plate(plan['plate'], read_only=True)
    days = min(90, max(1, (date.fromisoformat(plan['end']) - today()).days + 1))
    fn, args = {
        'planning': (lambda: calc.api_fleet_planning(_assistant=True), {'days': str(days)}),
        'capacity': (calc.api_capacity_control, {'days': str(days)}),
        'duplicates': (lambda: calc.api_reservations_duplicates(_assistant=True), {}),
        'islands': (lambda: calc.api_island_blocking(_assistant=True), {'groups': plan.get('group', ''), 'min_days': str(plan.get('min_days', 200))}),
    }[intent]
    key = (today().isoformat(), intent, json.dumps(args, sort_keys=True))
    with _lock:
        if key not in _calculated:
            with app.test_request_context('/demo-calculation', query_string=args):
                response = app.make_response(fn())
                if response.status_code >= 400:
                    raise RuntimeError('Could not calculate this example.')
                _calculated[key] = response.get_json()
        return _calculated[key]


def assistant():
    s = calc.SNAPSHOT
    source_time = datetime.now(LISBON).isoformat()
    data = {'fleet': s['fleet'], 'reservations': s['reservations'], 'stations': s['stations']['stations'],
            'categories': s['stations']['acriss_categories'], 'regions': s['stations']['planning_regions'],
            'pools': calc._load_station_pool_map(), 'aliases': {},
            'models': {k.replace('-', ''): v for k, v in s['models'].items()},
            'sources': {key: {'label': label + ' · Synthetic examples', 'updated_at': source_time,
                             'warnings': ['Demo: synthetic data with dates adjusted to the current day.']}
                        for key, label in [('fleet','Fleet'),('reservations','Reservations'),('capacity','Capacity'),('infleet','Infleet'),('rotation','Transport')]}}
    return Assistant(data, ME, calculate=calculated, today=today(), tz=LISBON)


@app.get('/api/chatbot/capabilities')
def capabilities():
    return jsonify(success=True, mode='local', version=3, auto_briefing=True, suggestions=suggestions(ME))


@app.get('/api/chatbot/briefing')
def briefing():
    result = assistant().answer('Analyze planning and capacity for the next 7 days')
    result['context'] = signer.dumps(result.get('context') or {})
    return jsonify(result)


@app.post('/api/chatbot/message')
def message():
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or not isinstance(body.get('message'), str) or not 1 <= len(body['message'].strip()) <= 2000:
        return jsonify(success=False, error='Enter a question of up to 2,000 characters.'), 400
    previous = {}
    if isinstance(body.get('context'), str) and body['context']:
        try:
            previous = signer.loads(body['context'], max_age=3600)
        except BadSignature:
            pass
    result = assistant().answer(body['message'].strip(), previous)
    result['context'] = signer.dumps(result.get('context') or {})
    return jsonify(result)


@app.get('/api/match-vehicle')
def match():
    return jsonify(calc._match_vehicle_by_plate(request.args.get('plate', ''), read_only=True))


@app.post('/api/match-vehicle/log')
@app.post('/api/demo/reset')
def no_persistence():
    return jsonify(success=True, demo=True)


@app.get('/api/rotation/cargas')
def rotation():
    rows = calc._rotation_filter(calc.SNAPSHOT['rotation'], **{k: request.args.get(k) for k in ('estado','utilizador','motivo','data_inicio','data_fim','pesquisa')})
    return jsonify(success=True, cargas=rows, total=len(rows), lynx_available=False)


@app.get('/api/rotation/cargas/<reference>')
def carga(reference):
    row = next((r for r in calc.SNAPSHOT['rotation'] if r['referencia'] == reference), None)
    return jsonify(success=bool(row), carga=row), 200 if row else 404


@app.get('/api/reservations/duplicates/csv')
@app.get('/api/reservations/duplicates/excel')
def duplicate_export():
    import csv
    import io
    groups = calc.api_reservations_duplicates(_assistant=True).get_json()['groups']
    headers = ['Set', 'Reservation', 'Synthetic customer', 'Group', 'Pickup', 'Return', 'Station']
    rows = [[i + 1, row['RESERVATION_NO'], (row.get('_FIRST_NAME', '') + ' ' + row.get('_LAST_NAME', '')).strip(),
             row.get('ZGROUP', ''), date_label(row.get('PICK_DATETIME'), LISBON),
             date_label(row.get('RET_DATETIME'), LISBON), row.get('PICK_STATION_NAME', '')]
            for i, group in enumerate(groups) for row in group['reservations']]
    if request.path.endswith('/excel'):
        from openpyxl import Workbook
        book = Workbook(); sheet = book.active; sheet.title = 'Duplicate examples'
        sheet.append(headers)
        for row in rows:
            sheet.append(row)
        sheet.freeze_panes = 'A2'
        buffer = io.BytesIO(); book.save(buffer); book.close()
        return app.response_class(buffer.getvalue(), mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                  headers={'Content-Disposition': 'attachment; filename="duplicate_reservations.xlsx"'})
    buffer = io.StringIO(); buffer.write('\ufeff')
    writer = csv.writer(buffer, delimiter=';'); writer.writerow(headers); writer.writerows(rows)
    return app.response_class(buffer.getvalue(), mimetype='text/csv', headers={'Content-Disposition': 'attachment; filename="duplicate_reservations.csv"'})


@app.get('/api/<path:name>')
def local_data(name):
    s = calc.SNAPSHOT
    payloads = {
        'me': ME, 'ping': {'success': True, 'demo': True},
        'user-profile': {'success': True, 'profile': {'name': 'Demo User', 'role': 'Portfolio · Synthetic data', 'is_admin': False, 'has_photo': False}},
        'not-available-fleet/data': {'success': True, 'vehicles': s['fleet'], 'captured_at': s['captured_at'], 'token_expired': False, 'shared_fetch': {'active': False}},
        'not-available-fleet/stations': {'success': True, 'config': s['stations']},
        'vehicle-masterdata/data': {'success': True, 'data': s['masterdata'], 'masterdata': s['masterdata']},
        'vehicle-masterdata/progress': {'active': False, 'total': 0, 'fetched': 0},
        'car-model/data': {'success': True, 'data': s['models']}, 'brand-abbreviations': {'success': True, 'data': s['brands']},
        'planning-config': {'success': True, 'config': s['planning_config']},
        'infleet/data': {'success': True, **s['infleet']},
        'reservations/duplicates/tracked': {'success': True, 'tracked': {}},
        'reservations/progress': {'running': False, 'active': False, 'done': 6, 'total': 6, 'failed': 0, 'rows_so_far': len(s['reservations']), 'cache_count': len(s['reservations']), 'fetched_at': s['fetched_at'], 'completed': True},
        'data-status': {'fleet_captured_at': s['captured_at'], 'res_fetched_at': s['fetched_at'], 'infleet_refreshed_at': s['infleet']['refreshed_at'], 'fleet_count': len(s['fleet']), 'res_count': len(s['reservations']), 'shared_fetch': {'active': False}, 'res_fetch': {'active': False}},
        'permissions': {'success': True, 'perms': {'users': {}, 'default_pages': list(PAGES)}, 'all_pages': [{'id': k, 'label': v[0]} for k, v in PAGES.items()]},
        'fleet/plate-conflicts': {'success': True, 'conflicts': [], 'overrides': {}},
        'match-vehicle/history': {'success': True, 'searches': [], 'history': []},
        'system/onedrive-health': {'success': True, 'status': 'ok', 'issues': []},
        'rotation/health': {'success': True, 'ok': True},
        'demo/info': {'success': True, **s['metadata'], 'counts': {'fleet': len(s['fleet']), 'reservations': len(s['reservations']), 'rotation': len(s['rotation'])}, 'example_plate': s['fleet'][0]['licensePlate']},
    }
    if name not in payloads:
        return jsonify(success=False, error='This operation is unavailable in the demo.'), 404
    return jsonify(payloads[name])


@app.get('/')
def home():
    return send_from_directory(ROOT/'static', 'index.html')


@app.get('/<path:filename>')
def files(filename):
    return send_from_directory(ROOT/'static', filename)


load_day()
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='RENA — Local demo with synthetic data')
    parser.add_argument('--port', type=int, default=5051)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not args.no_browser:
        threading.Timer(1, lambda: webbrowser.open(f'http://127.0.0.1:{args.port}')).start()
    app.run(host='127.0.0.1', port=args.port, debug=False, use_reloader=False)
