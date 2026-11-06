import sys, pefile, hashlib, datetime
p = sys.argv[1]
pe = pefile.PE(p, fast_load=True)
pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_RESOURCE'], pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_DEBUG']])
print('compile timestamp:', datetime.datetime.utcfromtimestamp(pe.FILE_HEADER.TimeDateStamp).isoformat() + 'Z')
sec = pe.OPTIONAL_HEADER.DATA_DIRECTORY[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_SECURITY']]
print('authenticode signature:', 'present' if sec.Size else 'NONE (unsigned)')
if hasattr(pe, 'DIRECTORY_ENTRY_DEBUG'):
    for d in pe.DIRECTORY_ENTRY_DEBUG:
        e = getattr(d, 'entry', None)
        if e is not None and hasattr(e, 'PdbFileName'): print('pdb:', e.PdbFileName.rstrip(b'\0').decode(errors='replace'))
if hasattr(pe, 'FileInfo'):
    for fi in pe.FileInfo:
        for e in fi:
            if hasattr(e, 'StringTable'):
                for st in e.StringTable:
                    for k, v in st.entries.items(): print('version-info:', k.decode(errors='replace'), '=', v.decode(errors='replace'))
if hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
    for t in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        name = pefile.RESOURCE_TYPE.get(t.struct.Id, t.name or t.struct.Id)
        n = 0
        for e in t.directory.entries:
            for l in e.directory.entries:
                n += 1
                if name == 'RT_MANIFEST':
                    data = pe.get_data(l.data.struct.OffsetToData, l.data.struct.Size)
                    print('manifest:', data.decode(errors='replace').replace('\r','').replace('\n',' ')[:700])
        print('resource type', name, 'count', n)
