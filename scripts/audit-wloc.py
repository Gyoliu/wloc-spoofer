#!/usr/bin/env python3
"""Lightweight suspicious API triage, NOT a proof of safety.

Usage:
    python3 scripts/audit-wloc.py vendor/wloc
    python3 scripts/audit-wloc.py /var/www/wloc
"""
from pathlib import Path
import hashlib
import re
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'vendor/wloc')
paths = [root / 'wloc.js', root / 'wloc-settings.js']
if not all(p.is_file() for p in paths):
    paths = [root / 'scripts' / 'wloc.js', root / 'scripts' / 'wloc-settings.js']
if not all(p.is_file() for p in paths):
    raise SystemExit(f'WLOC JS assets missing under {root}')
for path in paths:
    data = path.read_bytes()
    src = data.decode('utf-8', errors='replace')
    print(f'\n{path}: {len(data)} bytes; sha256={hashlib.sha256(data).hexdigest()}')
    checks = {
        'dynamic evaluation': r'\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(',
        'network-capable APIs': r'\$httpClient|\$task\.fetch|\bfetch\s*\(|XMLHttpRequest|WebSocket',
        'process/exec': r'child_process|execSync|spawnSync|process\.env',
    }
    for label, pattern in checks.items():
        print(f'  {label}: {len(re.findall(pattern, src))} textual matches')
    domains = sorted(set(re.findall(r'https?://[a-zA-Z0-9][a-zA-Z0-9.:-]*', src)))
    print('  hardcoded URL hosts (first 20):', domains[:20])
print('\nWARNING: Prebuilt code may hide runtime-built URLs or indirect calls.')
print('Absence of matches does NOT establish that code is safe. Review before MITM use.')
