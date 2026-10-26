"""Dump selected metrics_v2 symbols as JSON snapshots."""

import importlib
import inspect
import json
import re
import sys

sys.path.insert(0, sys.argv[1])
module = importlib.import_module("metrics_v2")
result = {}
for name in json.loads(sys.argv[2]):
    if not hasattr(module, name):
        result[name] = None
        continue
    value = getattr(module, name)
    if isinstance(value, (tuple, list)):
        result[name] = json.dumps(value, ensure_ascii=False)
    elif isinstance(value, re.Pattern):
        result[name] = value.pattern
    elif inspect.isfunction(value):
        result[name] = inspect.getsource(value)
    else:
        raise TypeError("Unsupported python symbol: " + name)
print(json.dumps(result, ensure_ascii=False))
