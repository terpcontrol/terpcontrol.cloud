#!/usr/bin/env python3
"""
What the catalogues and the CSS modules hold that nothing names, and what the source names that they do not hold.
No test guards these, and knip reads neither file kind; run it before a clearing-up and check each lead by grep:

    python3 scripts/unused.py        (from webapp/)

A catalogue key counts as used when its full name stands in the source (webapp, server and contract), or when the
source builds it from a prefix (`home.metric.${metric}`) and names the rest of it somewhere. Keys built with a
suffix (`${side}Often`, `...Was`, `...Note`) or an i18next context (`_you`) are listed as suspects, to be read by a
person; the `message-*` keys are the firmware's and are looked up by what a device sends.

A class of a CSS module counts as used when the binding the module is imported under names it, or indexes it by an
expression in a file that spells the class as a string; a class inside `:global(...)` belongs to no module.
"""
import glob
import json
import os
import re

WEBAPP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(WEBAPP)
SRC = os.path.join(WEBAPP, 'src')
PLURAL = re.compile(r'_(zero|one|two|few|many|other)$')


def flat(tree, prefix=''):
    for key, value in tree.items():
        if isinstance(value, dict):
            yield from flat(value, prefix + key + '.')
        else:
            yield prefix + key


def keys():
    names = set()
    for language in ('de', 'en'):
        names |= set(flat(json.load(open(os.path.join(WEBAPP, 'public/assets/i18n', language + '.json')))))
    files = [f for pattern in ('webapp/src/**/*.ts', 'webapp/src/**/*.tsx', 'server/src/**/*.ts', 'shared-types/src/**/*.ts')
             for f in glob.glob(os.path.join(ROOT, pattern), recursive=True)]
    source = '\n'.join(open(f, errors='ignore').read() for f in files)
    tokens = set(re.findall(r'[A-Za-z0-9_][A-Za-z0-9_.\-]*', source))
    prefixes = set(re.findall(r"[`'\"]([A-Za-z0-9_][A-Za-z0-9_.\-]*\.)['\"`]", source))
    prefixes |= {start for start in re.findall(r"[`'\"]([A-Za-z0-9_][A-Za-z0-9_.\-]*)\$\{", source) if '.' in start}
    for key in sorted(names):
        if key in tokens or PLURAL.sub('', key) in tokens or key.startswith('message-'):
            continue
        built = [prefix for prefix in prefixes if key.startswith(prefix)]
        if not built:
            print('unused key ', key)
            continue
        rest = PLURAL.sub('', key[len(max(built, key=len)):])
        if rest not in tokens and rest.split('.')[0] not in tokens and not rest.split('.')[0].isdigit():
            print('suspect key', key)


def classes_of(css):
    text = re.sub(r'/\*.*?\*/', '', open(css).read(), flags=re.S)
    text = re.sub(r':global\([^)]*\)', '', text)
    return set(re.findall(r'\.([A-Za-z_][A-Za-z0-9_-]*)', re.sub(r'\{[^{}]*\}', '{}', text)))


def classes():
    sources = {f: open(f).read() for f in glob.glob(SRC + '/**/*.ts*', recursive=True)}
    named = {}
    for f, text in sources.items():
        body = re.sub(r'^import .*$', '', text, flags=re.M)
        for match in re.finditer(r"import\s+(\w+)\s+from\s+'([^']*\.module\.css)'", text):
            binding, path = match.groups()
            css = os.path.normpath(os.path.join(os.path.dirname(f), path)) if path.startswith('.') else os.path.join(SRC, path.replace('@/', ''))
            if not os.path.isfile(css):
                continue
            have = classes_of(css)
            used = set(re.findall(r'(?<![\'"`.\w])' + binding + r'\.([A-Za-z_][A-Za-z0-9_]*)', body))
            used |= set(re.findall(r'\b' + binding + r"\[\s*'([A-Za-z0-9_-]+)'\s*\]", body))
            for name in sorted(used - have):
                print('undefined class', os.path.relpath(f, WEBAPP), binding + '.' + name)
            if re.search(r'\b' + binding + r"\[(?!\s*')", body) or re.search(r'[(,=:]\s*' + binding + r'\s*[,)]', body):
                used |= set(re.findall(r"['\"`]([A-Za-z_][A-Za-z0-9_-]*)['\"`]", body)) & have
                used |= {name for start in re.findall(r'`([A-Za-z_-]+)\$\{', body) for name in have if name.startswith(start)}
                used |= {name for end in re.findall(r'\}([A-Za-z_-]+)`', body) for name in have if name.endswith(end)}
            named.setdefault(css, set()).update(used)
    for css in sorted(glob.glob(SRC + '/**/*.module.css', recursive=True)):
        for name in sorted(classes_of(css) - named.get(css, set())):
            print('dead class  ', os.path.relpath(css, WEBAPP), '.' + name)


if __name__ == '__main__':
    keys()
    classes()
