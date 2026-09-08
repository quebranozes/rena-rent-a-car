"""Create repeatable fictional examples. This script reads no operational files."""
from datetime import date, datetime, timedelta
from pathlib import Path
import gzip
import json
import random

ROOT = Path(__file__).resolve().parents[1]
BASE = date(2026, 9, 8)
RNG = random.Random(9082026)


def stamp(days=0, hour=9, minute=0):
    return datetime.combine(BASE + timedelta(days=days), datetime.min.time()).replace(hour=hour, minute=minute).isoformat()


def generate():
    RNG.seed(9082026)
    locations = [('101', 'Lisbon · Demo Airport', 'Pool Lisbon', 38.775, -9.135),
                 ('102', 'Lisbon · Demo Downtown', 'Pool Lisbon', 38.724, -9.15),
                 ('201', 'Porto · Demo Airport', 'Pool Porto', 41.235, -8.675),
                 ('202', 'Porto · Demo Downtown', 'Pool Porto', 41.155, -8.625),
                 ('301', 'Faro · Demo Airport', 'Pool Algarve', 37.02, -7.968),
                 ('401', 'Funchal · Demo Downtown', 'Pool Madeira', 32.65, -16.91)]
    groups = ['EDMR', 'CDMR', 'CDAR', 'IFAR', 'LFAE', 'XDAR', 'CVMV', 'LVMR', 'XVAR', 'A', 'AX', 'EDAE']
    categories = [{'nome': 'Compact', 'groups': groups[:4]}, {'nome': 'Luxury', 'groups': groups[4:6]},
                  {'nome': '7-9 Seaters', 'groups': groups[6:9]}, {'nome': 'VCL', 'groups': groups[9:11]},
                  {'nome': 'Electric', 'groups': ['EDAE']}]
    stations = {sid: {'nome': name, 'zona': pool, 'tipo': 'Parking' if sid == '102' else 'Station', 'lat': lat, 'lon': lon,
                      'emails': [], 'transporte': '', 'nota': 'Fictional demo station'}
                for sid, name, pool, lat, lon in locations}
    config = {'stations': stations, 'acriss_categories': categories, 'acriss_aliases': {},
              'planning_pools': [], 'planning_regions': [
                  {'nome': 'Central', 'pools': ['Pool Lisbon']}, {'nome': 'North', 'pools': ['Pool Porto']},
                  {'nome': 'South', 'pools': ['Pool Algarve']}, {'nome': 'Islands', 'pools': ['Pool Madeira']}],
              'pool_folders': [], 'zones': {name: {'color': '#ff5000', 'icon': 'fas fa-map-marker-alt'} for name in ('Pool Lisbon', 'Pool Porto', 'Pool Algarve', 'Pool Madeira')},
              'hiddenTypes': [], 'dup_exclusions': [], 'centros_custo': [], 'regras_bloqueio': [],
              'classicStatusMap': {str(i): label for i, label in [(0, 'Rented'), (1, 'Available'), (5, 'Workshop'), (9, 'Preparation'), (45, 'Return')]}}
    fleet, models, types, master = [], {}, {}, {}
    names = {g: 'Demo Model ' + g for g in groups}
    for station_index, (sid, name, pool, _, _) in enumerate(locations):
        for i in range(84):
            idx = len(fleet) + 1
            group = groups[i % len(groups)]
            # Fictional plates retain a recognisable Portuguese format for existing UI filters.
            plate = f'ZZ-{idx % 100:02d}-D{chr(65 + idx // 100)}'
            if i == 83:
                plate = f'DEMO-F{station_index + 1:04d}'
            status = RNG.choices([0, 1, 5, 9, 45], [64, 24, 5, 5, 2])[0]
            branch = {'id': sid, 'name': name, 'poolName': pool, 'regionName': pool, 'timezone': 'Europe/Lisbon'}
            return_days = RNG.randint(-2, 12)
            end_date = (BASE + timedelta(days=RNG.randint(20, 450))).isoformat()
            vehicle = {'id': f'demo-vehicle-{idx}', 'internalNumber': 900000 + idx, 'licensePlate': plate,
                       'trimmedLicensePlate': plate.replace('-', ''), 'vin': f'DEMOVIN{idx:010d}', 'name': names[group],
                       'displayName': names[group], 'make': 'DEMO', 'model': group, 'imageUrl': '',
                       'vehicleCategory': next(c['nome'] for c in categories if group in c['groups']),
                       'acrissCode': group, 'classicStatus': status, 'classicActivityCode': '',
                       'subStatus': {0: 'RENTED', 1: 'AVAILABLE', 5: 'WORKSHOP', 9: 'PREPARATION', 45: 'RETURN'}[status],
                       'branch': branch, 'currentBranchId': sid, 'pickupBranch': branch, 'returnBranch': branch,
                       'updatedAt': stamp(), 'currentTime': stamp(), 'inStatusSince': stamp(-RNG.randint(0, 14)),
                       'atBranchSince': stamp(-RNG.randint(1, 20)), 'defleetDate': end_date,
                       'returnTime': stamp(return_days, 14) if status == 0 else None,
                       'rentalActivity': {'pickupDateTime': stamp(-4, 10), 'returnDateTime': stamp(return_days, 14),
                                          'rentalAgreementNumber': str(8000000 + idx), 'rateCode': 'DEMO', 'isLongTerm': False} if status == 0 else None,
                       'mileage': RNG.randint(500, 85000), 'maxMileage': 100000, 'remainingMileage': RNG.randint(5000, 50000),
                       'fuelType': 'E' if group == 'EDAE' else 'D', 'engineType': 'ELE' if group == 'EDAE' else 'DIE',
                       'fuelLevel': RNG.randint(2, 8), 'fuelPercentage': 75, 'transmissionType': 'A' if group.endswith(('A', 'E', 'R')) else 'M',
                       'vehicleType': 'VAN' if group in ('A', 'AX') else 'CAR', 'parkingSlot': f'D-{i+1:03d}',
                       'holds': [], 'carGroup': {'acrissCode': group, 'passengers': 9 if group in ('LVMR', 'XVAR') else 7 if group == 'CVMV' else 5}}
            fleet.append(vehicle)
            models[plate] = names[group]
            types[plate] = {'tipo_compra': 'FP' if idx % 3 else 'BB', 'contract_end': end_date, 'group': group, 'arrival': (BASE - timedelta(days=90)).isoformat()}
            master[plate] = {'cor': ['White', 'Black', 'Grey'][idx % 3], 'alarme': 'Example' if idx % 41 == 0 else ''}
    reservations = []
    for day in range(-7, 36):
        for station_index, (sid, name, pool, _, _) in enumerate(locations):
            count = 10 + (station_index * 3 + day) % 9
            if day in (0, 1, 2) and station_index == 0:
                count = 38
            candidates = [v for v in fleet if v['currentBranchId'] == sid]
            for j in range(count):
                idx = len(reservations) + 1
                group = groups[j % len(groups)]
                duration = 1 + idx % 9
                dest = locations[(station_index + 1) % len(locations)] if idx % 5 == 0 else locations[station_index]
                vehicle = candidates[j % len(candidates)]
                hour = 10 if j < 12 else 7 + j % 13
                reservations.append({'RESERVATION_NO': str(9100000 + idx), 'STATUS': 'CO' if day < 0 else ('CNL' if idx % 29 == 0 else 'RS'),
                    'ZGROUP': group, 'ACRISS_CODE': group, 'DURATION': duration, 'IS_LONGTERM': False,
                    'ONE_WAY': dest[0] != sid, 'IS_PREPAID': idx % 4 == 0, 'IS_VIP': idx % 17 == 0,
                    'LOYALTY_STATUS': 'DEMO' if idx % 9 == 0 else '', 'PICK_DATETIME': stamp(day, hour, (j % 4)*15),
                    'RET_DATETIME': stamp(day + duration, 14), 'PICK_STATION_ID': sid, 'PICK_STATION_NAME': name,
                    'RET_STATION_ID': '999' if idx % 37 == 0 else dest[0], 'RET_STATION_NAME': 'Demo International Destination' if idx % 37 == 0 else dest[1], 'PICK_TIMEZONE': 'Europe/Lisbon',
                    'LICENCE_PLATE': vehicle['licensePlate'] if idx % 3 else '', 'VEHICLE_MODEL': names[group],
                    'VEHICLE_MAKE': 'DEMO', 'VEHICLE_TYPE': 'CAR', 'CHECKOUT_AGENT': 'Demo Team',
                    '_EMAIL': f'cliente{idx:05d}@example.invalid', '_FIRST_NAME': 'Customer', '_LAST_NAME': f'Demo {idx:05d}',
                    'CAN_CHECKOUT': True, 'IS_DELIVERY': False, 'IS_COLLECTION': False, 'CANCEL_COMMENT': ''})
    # Repeated fictional customer identities illustrate duplicate detection.
    for row in [r for r in reservations if r['PICK_DATETIME'].startswith(BASE.isoformat())][:6]:
        twin = dict(row, RESERVATION_NO=str(9800000 + len(reservations)), LICENCE_PLATE='')
        reservations.append(twin)
    infleet = {'vehicles': [], 'by_park': {}, 'by_park_date': {}, 'total': 0, 'total_pending': 0, 'total_in_fleet': 0, 'total_overdue': 0, 'refreshed_at': stamp()}
    for idx in range(16):
        sid, name, *_ = locations[idx % len(locations)]
        entry = {'plate': f'ZZ-{idx:02d}-IA', 'group': groups[idx % len(groups)], 'arrival': (BASE + timedelta(days=idx % 5)).isoformat(),
                 'park_id': sid, 'dest_code': sid, 'dest_name': name, 'make': 'DEMO', 'model': 'Model Infleet Demo',
                 'contract_end': (BASE + timedelta(days=500)).isoformat(), 'tipo_compra': 'FP', 'in_fleet': False, 'overdue': False}
        infleet['vehicles'].append(entry)
        entry['park_id'] = '102'
        group_counts = infleet['by_park'].setdefault('102', {})
        group_counts[entry['group']] = group_counts.get(entry['group'], 0) + 1
        day_counts = infleet['by_park_date'].setdefault('102', {}).setdefault(entry['arrival'], {})
        day_counts[entry['group']] = day_counts.get(entry['group'], 0) + 1
    infleet['total'] = infleet['total_pending'] = len(infleet['vehicles'])
    capacity = {'stations': {sid: {'name': name, 'station_ids': [sid], 'max_daily': 30 if sid == '101' else 20,
        'opens_at': '07:00', 'closes_at': '22:00', 'oot_until': '06:00',
        'slots': [{'from': f'{hour:02d}:00', 'to': f'{hour:02d}:59', 'max': 5, 'label': f'{hour:02d}:00–{hour:02d}:59'} for hour in range(7, 22)]}
        for sid, name, *_ in locations}}
    planning = {'upgrade_matrix': {g: {'preferencial': [g], 'aceitavel': [], 'evitar': []} for g in groups},
                'cascade_families': [], 'categorias_especiais': {}, 'parametros': {'retomas_safety_margin': 60},
                'proximity_matrix': {}, 'station_schedules': {}, 'station_open_groups': {}}
    cargas = []
    for idx in range(12):
        origin, dest = locations[idx % 6], locations[(idx + 1) % 6]
        vehicles = [v for v in fleet if v['currentBranchId'] == origin[0]][idx:idx+3]
        cargas.append({'referencia': f'DEMO-{idx+1:04d}', 'estado': ['Pending', 'Requested', 'Confirmed', 'In Transit', 'Completed'][idx % 5],
            'data_criacao': stamp(-idx), 'data_atualizacao': stamp(), 'utilizador': 'Demo Team',
            'zona_origem': origin[2], 'zona_destino': dest[2], 'estacao_origem': origin[0], 'estacao_destino': dest[0],
            'estacao_origem_nome': origin[1], 'estacao_destino_nome': dest[1],
            'data_levantamento': (BASE + timedelta(days=idx % 3)).isoformat(), 'data_entrega': (BASE + timedelta(days=idx % 3 + 1)).isoformat(),
            'motivo': 'Rebalancing', 'urgencia': 'Normal', 'observacoes': 'Fictional demonstration scenario.',
            'viaturas': [{'matricula': v['licensePlate'], 'descricao': v['name'], 'marca': 'DEMO', 'modelo': v['model'], 'grupo': v['acrissCode'],
                         'acriss': v['acrissCode'], 'categoria': v['acrissCode'], 'branch': origin[1], 'branchCode': origin[0],
                         'viatura_info': {'status': 'Available', 'station_id': origin[0], 'station': origin[1]}} for v in vehicles],
            'num_viaturas': len(vehicles), 'adjudicacoes': [], 'guias': [], 'viatura_info_at': stamp()})
    payload = {'metadata': {'base_date': BASE.isoformat(), 'synthetic': True, 'seed': 9082026,
                            'description': 'Synthetic examples generated from scratch; no operational data imports.'},
               'fleet': fleet, 'reservations': reservations, 'captured_at': stamp(), 'fetched_at': stamp(),
               'stations': config, 'planning_config': planning, 'capacity': capacity,
               'models': models, 'types': types, 'masterdata': master, 'infleet': infleet,
               'rotation': cargas, 'brands': {'DEMO': 'Demo Model'}, 'history': [], 'tracked': {}}
    (ROOT/'data').mkdir(exist_ok=True)
    with gzip.open(ROOT/'data/examples.json.gz', 'wt', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(',', ':'))
    for name, obj in [('stations.json', config), ('planning_config.json', planning)]:
        (ROOT/'data'/name).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Generated examples: {len(fleet)} vehicles, {len(reservations)} reservations, {len(cargas)} loads.')


if __name__ == '__main__':
    generate()
