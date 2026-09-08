"""Local calculation environment. No connectors, external paths or background jobs."""
from pathlib import Path
from datetime import timedelta
from demo_clock import DemoDate as date, DemoDateTime as datetime, LISBON
import json
import logging
import os
import re
import time
from flask import Flask, jsonify, request

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 16384
logger = logging.getLogger('rena-demo')
DATA_DIR = str(ROOT/'data')
STATIONS_FILE = str(ROOT/'data/stations.json')
PLANNING_CONFIG_FILE = str(ROOT/'data/planning_config.json')
CACHE_FILE = str(ROOT/'data/unused.json')
_TZ_LISBON = LISBON
_ACRISS_ALIAS = {}
_plate_overrides = {}
_zone_cache = {'id_zona': {}, 'id_region': {}, 'zona_to_region': {}, 'zonas': [], 'ts': 0}
_RESERVATIONS_SORT_WHITELIST = {'RESERVATION_NO','STATUS','ZGROUP','PICK_DATETIME','RET_DATETIME','DURATION','PICK_STATION_NAME','RET_STATION_NAME','LICENCE_PLATE'}
SNAPSHOT = {}


def configure(snapshot):
    global SNAPSHOT, _not_avail_fleet_cache, _res_bulk_cache, _infleet_cache, _DEMO_ALL_BRANCHES
    SNAPSHOT = snapshot
    _not_avail_fleet_cache = {'data': snapshot['fleet'], 'captured_at': snapshot['captured_at']}
    _res_bulk_cache = {'rows': snapshot['reservations'], 'fetched_at': snapshot['fetched_at']}
    _infleet_cache = {'data': snapshot['infleet']}
    _DEMO_ALL_BRANCHES = snapshot['stations']['stations']
    _zone_cache['ts'] = 0


def _stations_config():
    return SNAPSHOT['stations']


def _read_fleet_type_map(*, read_only=False):
    return SNAPSHOT['types']


def _res_ensure_bulk():
    return None


def _load_capacity_config():
    return SNAPSHOT['capacity']


def _infleet_fetch_status():
    return {'active': False}


def _derive_booking_source(email):
    return 'Demo'


def _rotation_load_cargas():
    return SNAPSHOT['rotation']


def _rotation_load_historico():
    return SNAPSHOT['history']
