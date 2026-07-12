#!/usr/bin/env python3
"""Generiert params.json für die VolmeSlice-Settings aus dem Orca-Quellcode:
- Seiten/Gruppen/Parameter-Struktur aus TabPrint::build() (Tab.cpp)
- Typ/Einheit/Enums je Parameter aus PrintConfig.cpp
- Deutsche Labels aus localization/i18n/de/OrcaSlicer_de.po
So bleibt das Web-Panel automatisch synchron mit dem echten Orca."""
import json
import re
import sys
from pathlib import Path

ORCA = Path.home() / 'orca-wasm' / 'OrcaSlicer'
OUT = Path(__file__).parent / 'params.json'


def parse_po(path):
    tr = {}
    msgid, msgstr, mode = [], [], None
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('msgid '):
            if msgid and msgstr and ''.join(msgstr):
                tr[''.join(msgid)] = ''.join(msgstr)
            msgid, msgstr, mode = [json.loads(line[6:])], [], 'id'
        elif line.startswith('msgstr '):
            msgstr, mode = [json.loads(line[7:])], 'str'
        elif line.startswith('"'):
            (msgid if mode == 'id' else msgstr).append(json.loads(line))
    if msgid and msgstr and ''.join(msgstr):
        tr[''.join(msgid)] = ''.join(msgstr)
    return tr


def parse_tab_structure(tab_cpp):
    """TabPrint::build(): Reihenfolge von add_options_page / new_optgroup /
    append_single_option_line einsammeln."""
    src = tab_cpp.read_text(encoding='utf-8', errors='replace')
    start = src.index('void TabPrint::build()')
    end = src.index('void TabPrint::', start + 10)
    body = src[start:end]
    pages = []
    for kind, arg in re.findall(
            r'(add_options_page|new_optgroup|append_single_option_line)\s*\(\s*(?:L\(\s*)?"([^"]*)"', body):
        if kind == 'add_options_page':
            pages.append({'name': arg, 'groups': []})
        elif kind == 'new_optgroup':
            if pages:
                pages[-1]['groups'].append({'name': arg, 'options': []})
        else:
            if pages and pages[-1]['groups']:
                pages[-1]['groups'][-1]['options'].append(arg)
    return pages


def parse_print_config(cfg_cpp):
    """PrintConfig.cpp: je add("key", coTyp) Label/Sidetext/Enums extrahieren."""
    src = cfg_cpp.read_text(encoding='utf-8', errors='replace')
    opts = {}
    blocks = re.split(r'def\s*=\s*this->add\(', src)
    for block in blocks[1:]:
        m = re.match(r'"([^"]+)"\s*,\s*(co\w+)\)', block)
        if not m:
            continue
        key, ctype = m.group(1), m.group(2)
        seg = block[:block.find('this->add(')] if 'this->add(' in block else block
        opt = {'type': ctype}
        lm = re.search(r'def->label\s*=\s*L?\(?"([^"]*)"', seg)
        if lm:
            opt['label'] = lm.group(1)
        sm = re.search(r'def->sidetext\s*=\s*L?\(?"([^"]*)"', seg)
        if sm and sm.group(1):
            opt['sidetext'] = sm.group(1)
        evs = re.findall(r'def->enum_values\.(?:emplace|push)_back\("([^"]*)"\)', seg)
        els = re.findall(r'def->enum_labels\.(?:emplace|push)_back\(L?\(?"([^"]*)"\)?\)', seg)
        if evs:
            opt['enums'] = [[v, els[i] if i < len(els) else v] for i, v in enumerate(evs)]
        opts[key] = opt
    return opts


def main():
    tr = parse_po(ORCA / 'localization' / 'i18n' / 'de' / 'OrcaSlicer_de.po')
    pages = parse_tab_structure(ORCA / 'src' / 'slic3r' / 'GUI' / 'Tab.cpp')
    options = parse_print_config(ORCA / 'src' / 'libslic3r' / 'PrintConfig.cpp')
    t = lambda s: tr.get(s, s)

    out_pages = []
    for p in pages:
        groups = []
        for g in p['groups']:
            opts = [o for o in g['options'] if o in options]
            if opts:
                groups.append({'name': t(g['name']), 'options': opts})
        if groups:
            out_pages.append({'name': t(p['name']), 'groups': groups})

    out_options = {}
    for key, o in options.items():
        e = {'type': o['type'], 'label': t(o.get('label', key))}
        if 'sidetext' in o:
            e['sidetext'] = o['sidetext']
        if 'enums' in o:
            e['enums'] = [[v, t(l)] for v, l in o['enums']]
        out_options[key] = e

    OUT.write_text(json.dumps({'pages': out_pages, 'options': out_options},
                              ensure_ascii=False), encoding='utf-8')
    n_opts = sum(len(g['options']) for p in out_pages for g in p['groups'])
    print(f"params.json: {len(out_pages)} Seiten, {n_opts} Parameter, "
          f"{len(out_options)} Options-Defs, {len(tr)} Übersetzungen")
    for p in out_pages:
        print(f"  {p['name']}: {len(p['groups'])} Gruppen")


if __name__ == '__main__':
    sys.exit(main())
