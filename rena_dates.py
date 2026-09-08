"""Display dates without changing the ISO values used by operational calculations."""
from datetime import date, datetime
import re


def date_label(value, tz=None, *, date_only=False, missing='Not specified'):
    if value is None or value == '':
        return missing
    raw = str(value).strip()
    has_time = isinstance(value, datetime) or bool(re.search(r'\d{1,2}:\d{2}', raw))
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, datetime.min.time())
    else:
        try:
            parsed = datetime.fromisoformat(raw.replace('Z', '+00:00'))
        except ValueError:
            parsed = None
            for fmt in ('%d/%m/%Y', '%d/%m/%Y %H:%M', '%d/%m/%Y %H:%M:%S', '%H:%M / %d/%m/%Y'):
                try:
                    parsed = datetime.strptime(raw, fmt)
                    break
                except ValueError:
                    continue
            if parsed is None:
                return raw
    if tz and parsed.tzinfo:
        parsed = parsed.astimezone(tz)
    return parsed.strftime('%H:%M / %d/%m/%Y' if has_time and not date_only else '%d/%m/%Y')
