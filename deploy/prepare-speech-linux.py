#!/usr/bin/python3
"""Provision offline speech assets without running downloaded code as root.

Run as root on the native Linux host. This only stages dependencies and a model;
it does not change application settings or restart the live service.
"""
import os
from pathlib import Path
import pwd
import subprocess

ROOT = Path('/opt/cor-speech')


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Root provisioning required')
    if ROOT.exists():
        raise RuntimeError('Speech directory already exists; inspect before replacing')
    account = pwd.getpwnam('cor-build')
    ROOT.mkdir(mode=0o755)
    os.chown(ROOT, account.pw_uid, account.pw_gid)
    provision = '''set -euo pipefail
python3 -m venv /opt/cor-speech/venv
/opt/cor-speech/venv/bin/pip install --only-binary=:all: --disable-pip-version-check 'faster-whisper>=1.2,<2' 'av>=14,<19'
/opt/cor-speech/venv/bin/python - <<'PY'
import json,pathlib
from huggingface_hub import HfApi,snapshot_download
repo='Systran/faster-whisper-small'
revision=HfApi(token=False).model_info(repo).sha
snapshot_download(repo_id=repo,revision=revision,local_dir='/opt/cor-speech/models/small',token=False,
                  allow_patterns=['config.json','preprocessor_config.json','model.bin','tokenizer.json','vocabulary.*'])
pathlib.Path('/opt/cor-speech/model.json').write_text(json.dumps({'repo':repo,'revision':revision})+'\\n')
PY
/opt/cor-speech/venv/bin/pip freeze > /opt/cor-speech/requirements.lock
'''
    subprocess.run([
        'systemd-run', '--quiet', '--wait', '--collect', '--pipe',
        '--unit=cor-speech-provision', '-p', 'User=cor-build', '-p', 'Group=cor-build',
        '-p', 'ProtectSystem=strict', '-p', 'ProtectHome=true', '-p', 'PrivateTmp=true',
        '-p', 'PrivateDevices=true', '-p', 'NoNewPrivileges=true',
        '-p', 'RestrictSUIDSGID=true', '-p', 'KillMode=control-group',
        '-p', 'RuntimeMaxSec=1200', '-p', 'ReadWritePaths=/opt/cor-speech',
        '-p', 'InaccessiblePaths=/etc/cor /var/lib/cor /var/lib/cor-agent /var/lib/cor-fetch /run/docker.sock',
        '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/tmp',
        'HF_HUB_DISABLE_TELEMETRY=1', 'HF_HUB_DISABLE_IMPLICIT_TOKEN=1',
        '/bin/bash', '-c', provision,
    ], check=True)
    # The entire build process tree is gone. Freeze ownership and permissions.
    for folder, directories, files in os.walk(ROOT, followlinks=False):
        os.chown(folder, 0, 0)
        os.chmod(folder, 0o755)
        for name in directories + files:
            path = Path(folder) / name
            os.lchown(path, 0, 0)
            if path.is_file() and not path.is_symlink():
                path.chmod(0o755 if path.stat().st_mode & 0o111 else 0o644)
    (ROOT / 'ready').touch(mode=0o644)
    print('Offline speech assets staged; application is unchanged')


if __name__ == '__main__':
    main()
