#!/usr/bin/env python3
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

INJECTED = re.compile(r'<(browser_instruction|ide_opened_file|ide_selection|system-reminder)>.*?</\1>', re.S)
SKIP_PREFIX = ('Another Claude session', '<command-', '<local-command', '<system-reminder', '<task-notification', 'Caveat:', '<cross-session-message', '[Request interrupted', 'This session is being continued')
UNCLEAR = re.compile(r'이해를? 못|무슨 ?말|쉽게 (풀어|설명)|뭔 ?소리|결론이 뭐')
VERIFY = [re.compile(pattern) for pattern in (r'\b(pnpm|npm|yarn|npx|nx)\b[^|;&]*\b(test|jest|vitest|test:e2e|test:int\w*)\b|\bpytest\b|\bswift test\b', r'\b(pnpm|npm|yarn|nx)\b[^|;&]*\bbuild\b|\btsc\b|\bswift build\b', r'\b(pnpm|npm|yarn|nx)\b[^|;&]*\blint\b|\beslint\b', r'\btypecheck\b|check:di|check:invariants')]
PIPED = re.compile(r'\|\s*(tail|head|grep|sed|awk|cut|wc)\b')
REVERT = re.compile(r'^Revert "|\brevert\b', re.I)
COMPANY_REMOTE = re.compile(r'github\.com[^/:]*[:/]schoolbell-e/', re.I)
NAME = re.compile(r'^[A-Za-z0-9:_.-]{1,80}$')
MODEL = re.compile(r'^[A-Za-z0-9:_.\[\]-]{1,80}$')
SCOPES = ('company', 'personal', 'unknown')

class BadArgs(Exception):
    pass

class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise BadArgs()

def parse_date(value):
    try:
        result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.utcoffset() is None:
            raise ValueError()
        return result
    except (ValueError, TypeError, AttributeError):
        raise BadArgs() from None

def empty_scope():
    return {'tokens': {}, 'reverts': 0, 'verify': {'total': 0, 'piped': 0}, 'clarify': {'humanTurns': 0, 'matched': 0}}

def invoke(command, timeout=10, env=None, raise_timeout=False):
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout, env=env, check=True)
        return result.stdout.decode('utf-8', errors='replace')
    except subprocess.TimeoutExpired:
        if raise_timeout:
            raise
        return None
    except (OSError, subprocess.SubprocessError):
        return None

class Git:
    def __init__(self):
        self.cache = {}
        self.deadline = time.monotonic() + 60
        self.failed = False

    def run(self, cwd, *args):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            self.failed = True
            return None
        try:
            result = invoke(['git', '-C', cwd, *args], min(10, remaining), raise_timeout=True)
        except subprocess.TimeoutExpired:
            # 시간 초과만 수집 실패다. 오류 종료(레포 아님·망가진 레포)는 다시 돌려도 못 읽으니 건너뛴다.
            self.failed = True
            return None
        if time.monotonic() >= self.deadline:
            self.failed = True
        return result

    def scope(self, cwd):
        if cwd in self.cache:
            return self.cache[cwd]
        remote = self.run(cwd, 'remote', 'get-url', 'origin') if cwd else None
        if not cwd:
            result = ('unknown', False)
        elif remote:
            result = ('company' if COMPANY_REMOTE.search(remote) else 'personal', False)
        else:
            lower = cwd.lower() if cwd else ''
            if any(part in lower for part in ('sbe-', 'schoolbell', 'conduct')):
                result = ('company', True)
            elif cwd and cwd.startswith(str(Path.home() / 'worktrees') + os.sep):
                result = ('personal', True)
            else:
                result = ('unknown', True)
        self.cache[cwd] = result
        return result

def content_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return '\n'.join(block.get('text', '') for block in content if isinstance(block, dict) and block.get('type') == 'text' and isinstance(block.get('text'), str))
    return ''

def collect_claude(root, since, until, output, git):
    projects = root / 'projects'
    if not root.exists():
        return 'missing', set(), set()
    used = set()
    cwd_set = set()
    try:
        if not projects.exists():
            return 'missing', used, cwd_set
        paths = list(projects.rglob('*.jsonl'))
        for path in paths:
            if path.stat().st_mtime < (since - dt.timedelta(days=7)).timestamp():
                continue
            records = []
            with path.open(encoding='utf-8', errors='replace') as stream:
                for line in stream:
                    if '\ufffd' in line:
                        output['corrupt'] += 1
                        continue
                    try:
                        record = json.loads(line)
                        if isinstance(record, dict):
                            records.append(record)
                        else:
                            output['corrupt'] += 1
                    except (ValueError, UnicodeError):
                        output['corrupt'] += 1
            counts = collections.Counter(record.get('cwd') for record in records if isinstance(record.get('cwd'), str))
            cwd = counts.most_common(1)[0][0] if counts else ''
            scope, inferred = git.scope(cwd)
            if cwd:
                cwd_set.add(cwd)
            weeks = set()
            seen = set()
            for record in records:
                try:
                    timestamp = parse_date(record.get('timestamp'))
                except BadArgs:
                    continue
                week = 'thisWeek' if since <= timestamp < until else 'prevWeek' if since - dt.timedelta(days=7) <= timestamp < since else None
                if week is None:
                    continue
                weeks.add(week)
                message = record.get('message') if isinstance(record.get('message'), dict) else {}
                content = message.get('content', record.get('content'))
                if record.get('type') == 'assistant' and message.get('model') != '<synthetic>' and record.get('error') != 'rate_limit' and not record.get('isApiErrorMessage'):
                    usage = message.get('usage')
                    key = message.get('id') or record.get('requestId') or record.get('uuid')
                    if isinstance(usage, dict) and (not key or key not in seen):
                        if key:
                            seen.add(key)
                        model = message.get('model')
                        if not isinstance(model, str) or not MODEL.fullmatch(model):
                            model = 'other'
                        total = sum(value for name in ('input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens') if isinstance((value := usage.get(name)), int) and value >= 0)
                        tokens = output['tokens']['claude'][week]
                        tokens[model] = tokens.get(model, 0) + total
                        if week == 'thisWeek':
                            scope_tokens = output['scopes'][scope]['tokens']
                            scope_tokens[model] = scope_tokens.get(model, 0) + total
                if week != 'thisWeek':
                    continue
                if record.get('type') == 'user' and not record.get('isMeta') and not record.get('isSidechain') and 'subagents' not in path.parts:
                    text = INJECTED.sub('', content_text(content)).strip()
                    if text and not text.startswith(SKIP_PREFIX):
                        for target in (output, output['scopes'][scope]):
                            target['clarify']['humanTurns'] += 1
                            target['clarify']['matched'] += int(bool(UNCLEAR.search(text)))
                if isinstance(content, list):
                    for block in content:
                        if not isinstance(block, dict) or block.get('type') != 'tool_use':
                            continue
                        name = block.get('name', '')
                        data = block.get('input') if isinstance(block.get('input'), dict) else {}
                        if name == 'Bash' and isinstance(data.get('command'), str):
                            command = data['command']
                            if any(pattern.search(command) for pattern in VERIFY):
                                for target in (output, output['scopes'][scope]):
                                    target['verify']['total'] += 1
                                    target['verify']['piped'] += int(bool(PIPED.search(command)))
                        for key in ('skill', 'subagent_type'):
                            if isinstance(data.get(key), str):
                                used.add(data[key])
                        if isinstance(name, str) and name.startswith('mcp__'):
                            used.add(name)
                for match in re.findall(r'<command-name>/?([^<]+)</command-name>', content_text(content)):
                    used.add(match)
            if inferred and weeks:
                output['inferredSessions'] += 1
        return 'ok', used, cwd_set
    except (OSError, UnicodeError):
        return 'error', used, cwd_set

def make_output(since, until):
    previous = since - dt.timedelta(days=7)
    return {'version': 1, 'period': {'since': since.isoformat(), 'until': until.isoformat(), 'prevSince': previous.isoformat()}, 'scope_rule': 'origin remote and path inference', 'sources': dict.fromkeys(('claude', 'codex', 'git', 'inventory', 'hooks'), 'missing'), 'scopes': {scope: empty_scope() for scope in SCOPES}, 'inferredSessions': 0, 'tokens': {'claude': {'thisWeek': {}, 'prevWeek': {}}, 'codex': {'thisWeek': 0, 'prevWeek': 0, 'zstSkipped': 0}}, 'reverts': 0, 'verify': {'total': 0, 'piped': 0}, 'clarify': {'humanTurns': 0, 'matched': 0}, 'inventory': {name: {'total': 0, 'added': 0, 'unused': []} for name in ('skills', 'plugins', 'agents')} | {'hooks': {'total': 0}}, 'hooks': {'hooks': []}, 'corrupt': 0}

def collect_codex(root, since, until, output, no_zstd):
    if not root.exists():
        return 'missing'
    try:
        sessions = root / 'sessions'
        if not sessions.exists():
            return 'missing'
        for path in sessions.rglob('rollout-*.jsonl*') if sessions.exists() else []:
            try:
                date = dt.date(*map(int, path.relative_to(sessions).parts[:3]))
            except (ValueError, TypeError):
                continue
            if not (since.date() - dt.timedelta(days=7) <= date < until.date()):
                continue
            if path.name.endswith('.zst'):
                if no_zstd:
                    output['tokens']['codex']['zstSkipped'] += 1
                    continue
                text = invoke(['zstdcat', str(path)], 30)
                if text is None:
                    output['tokens']['codex']['zstSkipped'] += 1
                    continue
                lines = text.splitlines()
            elif path.name.endswith('.jsonl'):
                lines = path.read_text(encoding='utf-8').splitlines()
            else:
                continue
            total = None
            for line in lines:
                try:
                    record = json.loads(line)
                    payload = record.get('payload', {})
                    if record.get('type') == 'event_msg' and payload.get('type') == 'token_count':
                        value = payload.get('info', {}).get('total_token_usage', {}).get('total_tokens')
                        if isinstance(value, int) and value >= 0:
                            total = value
                except (ValueError, AttributeError, TypeError):
                    output['corrupt'] += 1
            if total is not None:
                week = 'thisWeek' if date >= since.date() else 'prevWeek'
                output['tokens']['codex'][week] += total
        return 'ok'
    except (OSError, UnicodeError):
        return 'error'

def collect_inventory(root, since, until, used, output):
    if not root.exists():
        return 'missing'
    try:
        inventory = output['inventory']
        if not (root / 'settings.json').is_file() or not (root / 'plugins' / 'installed_plugins.json').is_file() or not (root / 'skills').is_dir() or not (root / 'agents').is_dir():
            return 'missing'
        names = set()
        for category in ('skills', 'agents'):
            directory = root / category
            entries = list(directory.iterdir()) if directory.exists() else []
            if category == 'skills':
                entries = [entry for entry in entries if entry.is_dir() and not entry.name.startswith(('.', '_')) and (entry / 'SKILL.md').is_file()]
            else:
                entries = [entry for entry in entries if entry.is_file() and entry.suffix == '.md']
            valid = {entry.name if category == 'skills' else entry.stem for entry in entries}
            valid = {name for name in valid if NAME.fullmatch(name)}
            names.update(valid)
            inventory[category]['total'] = len(entries)
            inventory[category]['unused'] = sorted(valid - used)
            inventory[category]['added'] = sum(1 for entry in entries if since.timestamp() <= getattr(entry.stat(), 'st_birthtime', entry.stat().st_ctime) < until.timestamp())
        settings_path = root / 'settings.json'
        settings = json.loads(settings_path.read_text(encoding='utf-8'))
        plugins_path = root / 'plugins' / 'installed_plugins.json'
        if plugins_path.exists():
            data = json.loads(plugins_path.read_text(encoding='utf-8'))
            plugins = data.get('plugins', {})
            if not isinstance(plugins, dict):
                raise ValueError()
            enabled = settings.get('enabledPlugins')
            if enabled is not None and not isinstance(enabled, dict):
                raise ValueError()
            plugin_keys = {key for key, value in enabled.items() if value is True} if enabled is not None else set(plugins)
            inventory['plugins']['total'] = len(plugin_keys)
            valid = {key.split('@', 1)[0] for key in plugin_keys}
            valid = {name for name in valid if NAME.fullmatch(name)}
            names.update(valid)
            inventory['plugins']['unused'] = sorted(name for name in valid if not any(tool.startswith(name + ':') or tool.startswith('mcp__plugin_' + name + '_') for tool in used))
            for key in plugin_keys:
                installations = plugins.get(key, [])
                for installation in installations if isinstance(installations, list) else []:
                    try:
                        installed = parse_date(installation.get('installedAt'))
                        if since <= installed < until:
                            inventory['plugins']['added'] += 1
                            break
                    except (BadArgs, AttributeError):
                        continue
        hooks = settings.get('hooks', {})
        if not isinstance(hooks, dict):
            raise ValueError()
        inventory['hooks']['total'] = sum(len(item.get('hooks', [])) for groups in hooks.values() if isinstance(groups, list) for item in groups if isinstance(item, dict) and isinstance(item.get('hooks', []), list))
        inventory['other'] = len(used - names)
        return 'ok'
    except (OSError, UnicodeError, ValueError, TypeError, AttributeError):
        return 'error'

def collect_hooks(path, since, until, output):
    if not path.exists():
        return 'missing'
    raw = invoke(['python3', '-I', str(path), '--since', since.date().isoformat(), '--until', (until.date() - dt.timedelta(days=1)).isoformat()], 30)
    if raw is None:
        return 'error'
    try:
        data = json.loads(raw)
        if any(not isinstance(data.get(key), str) for key in ('since', 'until', 'scope_rule')):
            return 'error'
        hooks = data['hooks']
        scopes = data['by_scope']
        if not isinstance(hooks, list) or not isinstance(scopes, dict) or any(not isinstance(scopes.get(scope), list) for scope in SCOPES):
            return 'error'
        scoped_hooks = [hook for scope in SCOPES for hook in scopes[scope]]
        for hook in scoped_hooks:
            if not isinstance(hook, dict) or not isinstance(hook.get('name'), str) or any(not isinstance(hook.get(key), int) or isinstance(hook.get(key), bool) or hook[key] < 0 for key in ('fired', 'delivered', 'blocked')):
                return 'error'
        clean = []
        for hook in hooks:
            if not isinstance(hook, dict) or not isinstance(hook.get('name'), str) or any(not isinstance(hook.get(key), int) or isinstance(hook.get(key), bool) or hook[key] < 0 for key in ('fired', 'delivered', 'blocked')):
                return 'error'
            if NAME.fullmatch(hook['name']):
                clean.append({key: hook[key] for key in ('name', 'fired', 'delivered', 'blocked')})
        output['hooks']['hooks'] = clean
        return 'ok'
    except (ValueError, TypeError, KeyError):
        return 'error'

def collect_reverts(cwds, git, since, until, output):
    repositories = set()
    for cwd in cwds:
        common = git.run(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')
        if not common:
            continue
        key = common.strip()
        if key in repositories:
            continue
        repositories.add(key)
        ref = 'origin/HEAD' if git.run(cwd, 'rev-parse', '--verify', 'origin/HEAD') else 'HEAD'
        subjects = git.run(cwd, 'log', ref, '--since=' + since.isoformat(), '--until=' + until.isoformat(), '--no-merges', '--format=%s')
        if subjects is None:
            git.failed = True
            continue
        count = sum(bool(REVERT.search(line)) for line in subjects.splitlines())
        scope, _ = git.scope(cwd)
        output['reverts'] += count
        output['scopes'][scope]['reverts'] += count
    return 'error' if git.failed else 'ok'

def collect(args):
    since, until = parse_date(args.since), parse_date(args.until)
    if since >= until:
        raise BadArgs()
    output = make_output(since, until)
    git = Git()
    output['sources']['claude'], used, cwd_set = collect_claude(Path(args.claude_dir), since, until, output, git)
    output['sources']['codex'] = collect_codex(Path(args.codex_dir), since, until, output, args.no_zstd)
    output['sources']['inventory'] = collect_inventory(Path(args.claude_dir), since, until, used, output)
    output['sources']['hooks'] = collect_hooks(Path(args.hook_audit), since, until, output)
    if output['sources']['claude'] == 'ok':
        output['sources']['git'] = collect_reverts(cwd_set, git, since, until, output)
    else:
        output['sources']['git'] = output['sources']['claude']
    return output

def self_check():
    import contextlib
    import io
    import tempfile
    from unittest import mock

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        projects = root / 'claude' / 'projects'
        projects.mkdir(parents=True)
        marker = 'PII_MARKER_7f3a'
        company = root / ('company-' + marker)
        company.mkdir()
        environment = dict(os.environ, GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1', GIT_COMMITTER_DATE='2026-11-03T12:00:00+09:00')
        def git_fixture(*arguments):
            result = invoke(['git', *arguments], 10, environment)
            if result is None:
                raise RuntimeError('fixture git failed')
        git_fixture('init', str(company))
        git_fixture('-C', str(company), 'remote', 'add', 'origin', 'git@github.com-work:schoolbell-e/x.git')
        git_fixture('-C', str(company), '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Revert ' + marker, '--date=2026-11-03T12:00:00+09:00')
        linked = root / 'linked'
        git_fixture('-C', str(company), 'worktree', 'add', '-b', 'fixture-linked', str(linked))
        personal = root / 'personal'
        personal.mkdir()
        git_fixture('init', str(personal))
        git_fixture('-C', str(personal), 'remote', 'add', 'origin', 'https://github.com/someone/y')
        git_fixture('-C', str(personal), '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'initial')
        records = [{'type': 'user', 'timestamp': '2026-11-03T00:00:00+09:00', 'cwd': str(root / ('sbe-' + marker)), 'message': {'content': marker + ' 이해 못'}}]
        records.extend([
            {'type': 'assistant', 'timestamp': '2026-11-03T00:00:00+09:00', 'cwd': str(company), 'message': {'id': 'one', 'model': 'opus', 'usage': {'input_tokens': 5}, 'content': [{'type': 'tool_use', 'name': 'Bash', 'input': {'command': 'pnpm test | tail ' + marker}}, {'type': 'tool_use', 'name': 'Skill', 'input': {'skill': 'a'}}]}},
            {'type': 'assistant', 'timestamp': '2026-11-03T01:00:00+09:00', 'cwd': str(company), 'message': {'id': 'one', 'model': 'opus', 'usage': {'input_tokens': 5}, 'content': [{'type': 'tool_use', 'name': 'Bash', 'input': {'command': 'pnpm build'}}]}},
            {'type': 'assistant', 'timestamp': '2026-10-28T00:00:00+09:00', 'cwd': str(company), 'message': {'id': 'old', 'model': 'opus', 'usage': {'output_tokens': 7}}},
        ])
        (projects / 'linked.jsonl').write_text(json.dumps({'type': 'user', 'timestamp': '2026-11-03T00:00:00+09:00', 'cwd': str(linked), 'message': {'content': 'hello'}}), encoding='utf-8')
        (projects / 'unknown.jsonl').write_text(json.dumps({'type': 'assistant', 'timestamp': '2026-11-03T00:00:00+09:00', 'message': {}}), encoding='utf-8')
        (projects / 'gone.jsonl').write_text(json.dumps({'type': 'assistant', 'timestamp': '2026-11-03T00:00:00+09:00', 'cwd': str(root / 'sbe-gone'), 'message': {}}), encoding='utf-8')
        (projects / 'personal.jsonl').write_text(json.dumps({'type': 'user', 'timestamp': '2026-11-03T00:00:00+09:00', 'cwd': str(personal), 'message': {'content': 'hello'}}), encoding='utf-8')
        plain = root / 'plain-directory'
        plain.mkdir()
        (projects / 'plain.jsonl').write_text(json.dumps({'type': 'assistant', 'timestamp': '2026-11-03T00:00:00+09:00', 'cwd': str(plain), 'message': {}}), encoding='utf-8')
        subagents = projects / 'subagents'
        subagents.mkdir()
        (subagents / 'x.jsonl').write_text(json.dumps({'type': 'user', 'timestamp': '2026-11-03T00:00:00+09:00', 'cwd': str(company), 'message': {'content': '이해 못'}}), encoding='utf-8')
        (projects / 'sidechain.jsonl').write_text(json.dumps({'type': 'user', 'isSidechain': True, 'timestamp': '2026-11-03T00:00:00+09:00', 'cwd': str(company), 'message': {'content': '이해 못'}}), encoding='utf-8')
        (projects / 'bad-bytes.jsonl').write_bytes(b'\xff\n')
        (projects / 'bad-string.jsonl').write_bytes(b'{"type":"user","timestamp":"2026-11-03T00:00:00+09:00","message":{"content":"\xff"}}\n')
        (projects / 'test.jsonl').write_text('\n'.join(json.dumps(record) for record in records), encoding='utf-8')
        args = argparse.Namespace(since='2026-11-02T00:00:00+09:00', until='2026-11-09T00:00:00+09:00', claude_dir=str(root / 'claude'), codex_dir=str(root / 'missing-codex'), hook_audit=str(root / 'missing-audit'), no_zstd=True)
        result = collect(args)
        assert result['clarify'] == {'humanTurns': 3, 'matched': 1}
        assert result['corrupt'] == 2
        assert result['sources']['claude'] == 'ok'
        assert result['sources']['git'] == 'ok'
        assert result['tokens']['claude']['thisWeek'] == {'opus': 5}
        assert result['tokens']['claude']['prevWeek'] == {'opus': 7}
        assert result['verify'] == {'total': 2, 'piped': 1}
        assert result['reverts'] == 1
        assert result['scopes']['company']['clarify']['humanTurns'] == 2
        assert result['scopes']['personal']['clarify']['humanTurns'] == 1
        assert result['scopes']['unknown']['clarify']['humanTurns'] == 0
        assert result['inferredSessions'] == 2
        assert marker not in json.dumps(result)
        codex = root / 'codex' / 'sessions' / '2026' / '11' / '03'
        codex.mkdir(parents=True)
        (codex / 'rollout-test.jsonl').write_text(json.dumps({'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {'total_token_usage': {'total_tokens': 17}}}}), encoding='utf-8')
        (codex / 'rollout-test.jsonl.zst').write_bytes(b'fixture')
        skills = root / 'claude' / 'skills'
        (skills / 'a').mkdir(parents=True)
        (skills / 'b').mkdir()
        for name in ('a', 'b'):
            (skills / name / 'SKILL.md').write_text('fixture', encoding='utf-8')
        for name in ('.trash', '_archive', 'synced'):
            (skills / name).mkdir()
        for name in ('.trash', '_archive'):
            (skills / name / 'SKILL.md').write_text('fixture', encoding='utf-8')
        plugins = root / 'claude' / 'plugins'
        plugins.mkdir()
        (plugins / 'installed_plugins.json').write_text(json.dumps({'plugins': {'plugin-a@m': [{'installedAt': '2026-11-03T00:00:00+09:00'}], 'plugin-b@m': [{'installedAt': '2026-10-03T00:00:00+09:00'}], 'plugin-c@m': []}}), encoding='utf-8')
        agents = root / 'claude' / 'agents'
        agents.mkdir()
        (agents / 'c.md').write_text('fixture', encoding='utf-8')
        (root / 'claude' / 'settings.json').write_text(json.dumps({'hooks': {'Stop': [{'hooks': [{}, {}, {}]}]}, 'enabledPlugins': {'plugin-a@m': True, 'plugin-b@m': True, 'plugin-c@m': False}}), encoding='utf-8')
        with (projects / 'test.jsonl').open('a', encoding='utf-8') as stream:
            stream.write('\n' + json.dumps({'type': 'assistant', 'timestamp': '2026-11-03T02:00:00+09:00', 'cwd': str(company), 'message': {'content': [{'type': 'tool_use', 'name': 'Skill', 'input': {'skill': 'plugin-a:x'}}]}}))
        audit = root / 'audit.py'
        audit.write_text('import json; print(json.dumps({"hooks":[{"name":"test","runs":2,"fired":2,"delivered":1,"blocked":1}],"by_scope":{"company":[],"personal":[],"unknown":[]}}))', encoding='utf-8')
        args.codex_dir = str(root / 'codex')
        args.hook_audit = str(audit)
        args.no_zstd = True
        result = collect(args)
        assert result['tokens']['codex']['thisWeek'] == 17
        assert result['tokens']['codex']['zstSkipped'] == 1
        assert result['inventory']['hooks']['total'] == 3
        assert result['inventory']['plugins']['added'] == 1
        assert result['inventory']['plugins']['total'] == 2
        assert result['inventory']['plugins']['unused'] == ['plugin-b']
        assert result['inventory']['agents']['total'] == 1
        assert result['sources']['hooks'] == 'error'
        audit.write_text('import json; print(json.dumps({"since":"2026-11-02","until":"2026-11-08","scope_rule":"fixture","hooks":[{"name":"test","runs":2,"fired":2,"delivered":1,"blocked":1}],"by_scope":{"company":[],"personal":[],"unknown":[]}}))', encoding='utf-8')
        assert collect(args)['sources']['hooks'] == 'ok'
        audit.write_text('import json; print(json.dumps({"since":"2026-11-02","until":"2026-11-08","scope_rule":"fixture","hooks":[{"name":"test","fired":2,"delivered":1,"blocked":1}],"by_scope":{"company":[{"name":"test","fired":2,"delivered":1,"blocked":1}],"personal":[],"unknown":[]}}))', encoding='utf-8')
        assert collect(args)['sources']['hooks'] == 'ok'
        assert result['inventory']['skills']['total'] == 2
        assert result['inventory']['skills']['unused'] == ['b']
        audit.write_text('print("invalid")', encoding='utf-8')
        assert collect(args)['sources']['hooks'] == 'error'
        args.hook_audit = str(root / 'missing-audit')
        assert collect(args)['sources']['hooks'] == 'missing'
        empty_codex = root / 'empty-codex'
        empty_codex.mkdir()
        args.codex_dir = str(empty_codex)
        assert collect(args)['sources']['codex'] == 'missing'
        args.codex_dir = str(root / 'missing-codex')
        assert collect(args)['sources']['codex'] == 'missing'
        empty_claude = root / 'empty-claude'
        empty_claude.mkdir()
        args.claude_dir = str(empty_claude)
        assert collect(args)['sources']['claude'] == 'missing'
        args.claude_dir = str(root / 'absent')
        assert collect(args)['sources']['claude'] == 'missing'
        assert collect(args)['sources']['git'] == 'missing'
        inaccessible = root / 'inaccessible'
        inaccessible.mkdir()
        inaccessible.chmod(0)
        try:
            if os.geteuid() != 0:
                args.claude_dir = str(inaccessible)
                assert collect(args)['sources']['claude'] == 'error'
        finally:
            inaccessible.chmod(0o700)
        broken = root / 'broken-git'
        broken.mkdir()
        (broken / '.git').mkdir()
        broken_child = broken / 'child'
        broken_child.mkdir()
        assert collect_reverts({str(broken_child)}, Git(), parse_date(args.since), parse_date(args.until), make_output(parse_date(args.since), parse_date(args.until))) == 'ok'
        timeout_git = Git()
        with mock.patch.object(subprocess, 'run', side_effect=subprocess.TimeoutExpired('git', 1)):
            assert collect_reverts({str(company)}, timeout_git, parse_date(args.since), parse_date(args.until), make_output(parse_date(args.since), parse_date(args.until))) == 'error'
        stale = root / 'stale-gitfile'
        stale.mkdir()
        (stale / '.git').write_text('gitdir: ' + str(root / 'pruned'), encoding='utf-8')
        assert collect_reverts({str(stale)}, Git(), parse_date(args.since), parse_date(args.until), make_output(parse_date(args.since), parse_date(args.until))) == 'ok'
        assert collect_reverts({str(company / 'deleted-worktree')}, Git(), parse_date(args.since), parse_date(args.until), make_output(parse_date(args.since), parse_date(args.until))) == 'ok'
        assert collect_reverts({str(plain)}, Git(), parse_date(args.since), parse_date(args.until), make_output(parse_date(args.since), parse_date(args.until))) == 'ok'
        failed_git = Git()
        failed_git.deadline = 0
        assert collect_reverts({str(company)}, failed_git, parse_date(args.since), parse_date(args.until), make_output(parse_date(args.since), parse_date(args.until))) == 'error'
        budget_git = Git()
        budget_git.deadline = 60
        with mock.patch(__name__ + '.invoke', return_value=None), mock.patch(__name__ + '.time.monotonic', side_effect=[0, 61]):
            assert budget_git.run(str(plain), 'rev-parse', '--git-common-dir') is None
        assert budget_git.failed
        error_output = io.StringIO()
        with mock.patch(__name__ + '.collect', side_effect=RuntimeError(marker)), contextlib.redirect_stderr(error_output), contextlib.redirect_stdout(io.StringIO()):
            assert main(['--since', args.since, '--until', args.until]) == 3
        assert error_output.getvalue() == 'AIWM_ERROR INTERNAL\n'

def main(argv):
    parser = Parser(add_help=False, exit_on_error=False)
    parser.add_argument('--self-check', action='store_true')
    parser.add_argument('--since')
    parser.add_argument('--until')
    parser.add_argument('--claude-dir', default=str(Path.home() / '.claude'))
    parser.add_argument('--codex-dir', default=str(Path.home() / '.codex'))
    parser.add_argument('--hook-audit', default=str(Path.home() / '.claude/scripts/hook-delivery-audit.py'))
    parser.add_argument('--no-zstd', action='store_true')
    try:
        args = parser.parse_args(argv)
        if args.self_check:
            self_check()
            print('self-check ok')
        else:
            print(json.dumps(collect(args), ensure_ascii=False))
        return 0
    except (BadArgs, argparse.ArgumentError):
        print('AIWM_ERROR BAD_ARGS', file=sys.stderr)
        return 2
    except BaseException:
        print('AIWM_ERROR INTERNAL', file=sys.stderr)
        return 3

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
