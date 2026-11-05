import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


def max_user(data, token, now=None):
    if not token or not data or len(data) > 16384:
        raise ValueError('Invalid MAX data')
    pairs = parse_qsl(data, keep_blank_values=True, strict_parsing=True, max_num_fields=100)
    values = dict(pairs)
    if len(values) != len(pairs) or 'hash' not in values:
        raise ValueError('Invalid MAX data')
    signature = values.pop('hash')
    text = '\n'.join(f'{key}={value}' for key, value in sorted(values.items()))
    secret = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, text.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise ValueError('Invalid MAX signature')
    auth_date = int(values['auth_date'])
    now = time.time() if now is None else now
    if auth_date > now + 60 or now - auth_date > 86400:
        raise ValueError('Expired MAX data')
    user = json.loads(values['user'])
    user_id = user.get('id')
    if type(user_id) is not int or user_id <= 0:
        raise ValueError('Invalid MAX user')
    return user_id
