def flatten(d, prefix=''):
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}" if prefix == '' else f"{prefix}.{k}"
        if isinstance(v, dict) and v:
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out

def solution(input_text):
    import ast, json
    try:
        parsed = ast.literal_eval(input_text)
    except Exception:
        parsed = json.loads(input_text)
    return flatten(parsed)
