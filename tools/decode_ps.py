import sys, re, base64, json
src = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'-Encoded ([A-Za-z0-9+/=]+)', src)
ps = base64.b64decode(m.group(1)).decode('utf-16le')
print('=== outer PowerShell (%d chars) ===' % len(ps))
print(ps[:600] + (' ...' if len(ps) > 600 else ''))
print('... tail:', ps[-400:])
# inner layers: any long base64 blobs
for i, b in enumerate(re.findall(r"[A-Za-z0-9+/=]{80,}", ps)):
    try:
        raw = base64.b64decode(b)
        txt = raw.decode('utf-8')
    except Exception as e:
        print('blob', i, 'not utf8', e); continue
    print('=== inner blob %d decoded (%d chars) ===' % (i, len(txt)))
    print(txt[:300])
    try:
        j = json.loads(txt)
        for k, v in j.items():
            try: v2 = base64.b64decode(v).decode('utf-8')
            except Exception: v2 = v
            print('--- key %s ---' % k); print(v2)
    except Exception as e:
        print('(not json)', e)
