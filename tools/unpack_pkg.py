"""Static unpacker for a vercel/yao-pkg payload. Never executes anything from the sample."""
import sys, os, json, mmap, re, collections

src, outdir = sys.argv[1], os.path.abspath(sys.argv[2])
PAYLOAD_POS, PAYLOAD_SIZE, PRELUDE_POS = 57423872, 87824528, 145248400

with open(src, 'rb') as f:
    m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    prelude = bytes(m[PRELUDE_POS:])
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, '_pkg_prelude.js.txt'), 'wb') as o:
        o.write(prelude)

    # VFS JSON is the argument that starts with {"C:\\snapshot and ends before \n,\n"<entrypoint>"
    start = prelude.rfind(b'\n{"C:\\\\snapshot') + 1
    tail = prelude[start:]
    dec = json.JSONDecoder()
    text = tail.decode('utf-8')
    vfs, end = dec.raw_decode(text)
    rest = text[end:]
    print('trailer after VFS:', repr(rest[:200]))

    kinds = collections.Counter()
    n_files = 0
    index = []
    for wpath, stores in vfs.items():
        rel = wpath.replace('\\', '/')
        rel = re.sub(r'^[A-Za-z]:/', '', rel)
        parts = [p for p in rel.split('/') if p not in ('', '.', '..')]
        dest = os.path.join(outdir, *parts)
        assert os.path.commonpath([outdir, os.path.abspath(dest)]) == outdir
        for k in stores: kinds[k] += 1
        stat = None
        if '3' in stores:
            o_, s_ = stores['3']
            try: stat = json.loads(bytes(m[PAYLOAD_POS+o_:PAYLOAD_POS+o_+s_]))
            except Exception as e: stat = {'err': str(e)}
        is_dir = '2' in stores or (stat and stat.get('isDirectoryValue'))
        if is_dir:
            os.makedirs(dest, exist_ok=True)
        else:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
        rec = {'path': wpath, 'stores': {k: v for k, v in stores.items()}, 'size': (stat or {}).get('size')}
        index.append(rec)
        if '1' in stores and not is_dir:
            o_, s_ = stores['1']
            with open(dest, 'wb') as o: o.write(m[PAYLOAD_POS+o_:PAYLOAD_POS+o_+s_])
            n_files += 1
        if '0' in stores and not is_dir:
            o_, s_ = stores['0']
            with open(dest + '.v8bytecode', 'wb') as o: o.write(m[PAYLOAD_POS+o_:PAYLOAD_POS+o_+s_])
    with open(os.path.join(outdir, '_pkg_index.json'), 'w') as o:
        json.dump(index, o, indent=0)
    print('entries:', len(vfs), 'store kinds:', dict(kinds), 'content files written:', n_files)
    only_bc = [r['path'] for r in index if '0' in r['stores'] and '1' not in r['stores']]
    print('bytecode-only (no source) entries:', len(only_bc))
    for p in only_bc[:40]: print('   ', p)
