"""Calendar offsets for the fictional snapshot, including day rollover."""
from datetime import date, datetime, timedelta
import os
import re
from zoneinfo import ZoneInfo

LISBON = ZoneInfo('Europe/Lisbon')


def today():
    override = os.environ.get('RENA_DEMO_DATE')
    return date.fromisoformat(override) if override else datetime.now(LISBON).date()


class DemoDate(date):
    @classmethod
    def today(cls):
        value = today()
        return cls(value.year, value.month, value.day)


class DemoDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        value = datetime.now(tz or LISBON)
        target = today()
        value = value.replace(year=target.year, month=target.month, day=target.day)
        if tz is None:
            value = value.replace(tzinfo=None)
        return value


def shift_snapshot(value, offset):
    """Shift dates in values and dictionary keys, without touching time-only slots or IDs."""
    if isinstance(value, dict):
        return {shift_snapshot(k, offset): shift_snapshot(v, offset) for k, v in value.items()}
    if isinstance(value, list):
        return [shift_snapshot(v, offset) for v in value]
    if isinstance(value, str) and re.match(r'^\d{4}-\d{2}-\d{2}(?:$|[T ])', value):
        try:
            moved = date.fromisoformat(value[:10]) + timedelta(days=offset)
            return moved.isoformat() + value[10:]
        except ValueError:
            pass
    return value
