#!/usr/bin/python3
"""Root-owned deployment controller. Repository code runs only as cor-build.

Install manually after review; this controller never updates itself from Git.
Activation is gated by /etc/cor/deploy-enabled and Cloudflare production config.
"""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import time

BASE = Path('/var/lib/cor-deploy')
RELEASES = Path('/opt/cor-releases')
REPO = BASE / 'repo.git'
CURRENT = Path('/opt/cor-current')


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def fetch(*args, **kwargs):
    return run(['runuser', '-u', 'cor-fetch', '--', 'env', '-i',
                'HOME=/var/lib/cor-fetch', 'PATH=/usr/bin:/bin',
                'GIT_SSH_COMMAND=ssh -F /var/lib/cor-fetch/ssh_config',
                'git', '-c', 'core.hooksPath=/dev/null', '--git-dir=' + str(REPO),
                *args], **kwargs)


def extract(archive, destination):
    with tarfile.open(archive) as source:
        for entry in source.getmembers():
            if next((p for p in Path(entry.name).parts if p != '.'), '') in ('.env', '.git', '.runtime'):
                raise ValueError('Forbidden release content')
            if not (entry.isfile() or entry.isdir() or entry.issym() or entry.islnk()):
                raise ValueError('Unsupported archive entry')
        source.extractall(destination, filter='data')


def state(**values):
    temporary = BASE / 'status.tmp'
    temporary.write_text(json.dumps({'updatedAt': int(time.time()), **values}) + '\n')
    temporary.replace(BASE / 'status.json')


def main():
    BASE.mkdir(mode=0o755, exist_ok=True)
    with (BASE / 'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fetch('fetch', '--no-tags', 'origin', '+refs/heads/main:refs/heads/main',
              stdout=subprocess.DEVNULL)
        sha = fetch('rev-parse', 'refs/heads/main', capture_output=True, text=True).stdout.strip()
        if not re.fullmatch('[a-f0-9]{40}', sha):
            raise ValueError('Invalid commit')
        RELEASES.mkdir(mode=0o755, exist_ok=True)
        RELEASES.chmod(0o755)
        release = RELEASES / sha
        if not release.exists():
            work = BASE / 'build'
            if work.exists():
                shutil.rmtree(work)
            work.mkdir(mode=0o755)
            work.chmod(0o755)
            archive = BASE / 'source.tar'
            with archive.open('wb') as output:
                fetch('archive', sha, stdout=output)
            extract(archive, work)
            archive.unlink()
            shutil.chown(work, user='cor-build', group='cor-build')
            for folder, dirs, files in os.walk(work):
                for name in dirs + files:
                    os.lchown(Path(folder) / name,
                              __import__('pwd').getpwnam('cor-build').pw_uid,
                              __import__('grp').getgrnam('cor-build').gr_gid)
            # No application environment, Google tokens, Docker, SSH key or sudo.
            run(['systemd-run', '--quiet', '--wait', '--collect', '--pipe',
                 '--unit=cor-build-' + sha[:12],
                 '-p', 'User=cor-build', '-p', 'Group=cor-build',
                 '-p', 'WorkingDirectory=' + str(work),
                 '-p', 'ProtectSystem=strict', '-p', 'ProtectHome=true',
                 '-p', 'PrivateTmp=true', '-p', 'PrivateDevices=true',
                 '-p', 'NoNewPrivileges=true', '-p', 'RestrictSUIDSGID=true',
                 '-p', 'KillMode=control-group', '-p', 'RuntimeMaxSec=900',
                 '-p', 'InaccessiblePaths=/etc/cor /var/lib/cor /var/lib/cor-agent /var/lib/cor-fetch /run/docker.sock',
                 '-p', 'ReadWritePaths=' + str(work),
                 '/usr/bin/env', '-i', 'PATH=/opt/cor-runtime:/usr/bin:/bin',
                 'HOME=/tmp', 'CI=true', 'npm_config_cache=/tmp/cor-npm-cache',
                 '/bin/bash', '-ec',
                 'npm ci --ignore-scripts --no-audit --no-fund; npm test; npm run build; '
                 "if test -f deploy/test_update.py; then python3 -m unittest discover -s deploy -p 'test_*.py'; fi; "
                 'tar --exclude=./artifact.tar -cf artifact.tar .'])
            # Build process tree is gone before root consumes its artifact.
            incoming = RELEASES / (sha + '.incoming')
            if incoming.exists():
                shutil.rmtree(incoming)
            incoming.mkdir(mode=0o755)
            try:
                extract(work / 'artifact.tar', incoming)
                for folder, dirs, files in os.walk(incoming):
                    os.chmod(folder, 0o755)
                    for name in files:
                        file = Path(folder) / name
                        if not file.is_symlink():
                            file.chmod(0o755 if file.stat().st_mode & 0o111 else 0o644)
                incoming.rename(release)
            except BaseException:
                shutil.rmtree(incoming)
                raise
            shutil.rmtree(work)
        # Fetch/build continues while public activation is deliberately gated.
        if not Path('/etc/cor/deploy-enabled').is_file():
            state(commit=sha, phase='staged', reason='Awaiting Access and final cutover')
            print('Validated release staged:', sha)
            return
        if CURRENT.is_symlink() and CURRENT.resolve() == release:
            state(commit=sha, phase='active')
            return
        # A fixed, separately audited backup helper must succeed before activation.
        run(['/usr/local/sbin/cor-predeploy-backup'])
        previous = CURRENT.resolve() if CURRENT.is_symlink() else Path('/opt/cor')
        link = Path('/opt/cor-next')
        link.unlink(missing_ok=True)
        link.symlink_to(release)
        link.replace(CURRENT)
        try:
            run(['systemctl', 'restart', 'cor.service'])
            for attempt in range(30):
                result = subprocess.run(['curl', '--fail', '--silent', '--max-time', '2',
                                         '--unix-socket', '/run/cor/http.sock',
                                         'http://localhost/healthz'], capture_output=True)
                if result.returncode == 0:
                    state(commit=sha, phase='active')
                    print('Activated:', sha)
                    return
                time.sleep(1)
            raise RuntimeError('Health verification failed')
        except BaseException:
            link.symlink_to(previous)
            link.replace(CURRENT)
            run(['systemctl', 'restart', 'cor.service'])
            state(commit=sha, phase='rolled-back', reason='Health verification failed')
            raise


if __name__ == '__main__':
    try:
        main()
    except BlockingIOError:
        pass
    except Exception as error:
        state(phase='failed', reason=type(error).__name__)
        raise
