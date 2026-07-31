def flatten(d, prefix=''):
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}" if prefix == '' else f"{prefix}.{k}"
        if isinstance(v, dict) and v:
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out
