#!/usr/bin/env bash
# Prepare a separate CLI identity; never copy the operator's login credentials.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run this preparation as root.' >&2; exit 1; }
[[ $(uname -sm) == 'Linux x86_64' ]] || { echo 'This preparation targets Linux x86_64.' >&2; exit 1; }
command -v python3 >/dev/null
command -v dbus-run-session >/dev/null
command -v gnome-keyring-daemon >/dev/null

if ! id cor-agent >/dev/null 2>&1; then
  useradd --system --user-group --create-home --home-dir /var/lib/cor-agent --shell /usr/sbin/nologin cor-agent
fi
[[ $(getent passwd cor-agent | cut -d: -f6) == /var/lib/cor-agent ]] || { echo 'Unexpected agent home; refusing changes.' >&2; exit 1; }
for group in sudo docker root; do
  if id -nG cor-agent | tr ' ' '\n' | grep -qx "$group"; then
    echo 'Agent identity has privileged group membership; refusing setup.' >&2; exit 1
  fi
done
install -d -o root -g root -m 0755 /opt/cor-agent /opt/cor-agent/bin
install -d -o cor-agent -g cor-agent -m 0700 /var/lib/cor-agent /var/lib/cor-agent/work /var/lib/cor-agent/run /var/lib/cor-agent/.gemini /var/lib/cor-agent/.gemini/antigravity-cli

# Same official release manifest used by Google's published CLI installer.
python3 - <<'PY'
import hashlib, json, os, shutil, tarfile, tempfile, urllib.request, urllib.parse
manifest_url = 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_amd64.json'
with urllib.request.urlopen(manifest_url, timeout=30) as response:
    manifest = json.load(response)
url = manifest['url']
if urllib.parse.urlsplit(url).scheme != 'https':
    raise RuntimeError('Release URL must use HTTPS')
target = '/opt/cor-agent/bin/agy'
fd, staging = tempfile.mkstemp(prefix='.agy-', dir='/opt/cor-agent/bin')
try:
    digest = hashlib.sha512()
    reuse = False
    if os.path.isfile(target):
        with open(target, 'rb') as existing:
            reuse = hashlib.file_digest(existing, 'sha512').hexdigest().lower() == manifest['sha512'].lower()
    source = open(target, 'rb') if reuse else urllib.request.urlopen(url, timeout=90)
    with os.fdopen(fd, 'wb') as output, source as response:
        if not reuse and urllib.parse.urlsplit(response.geturl()).scheme != 'https':
            raise RuntimeError('Insecure release redirect')
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk: break
            digest.update(chunk)
            output.write(chunk)
    if digest.hexdigest().lower() != manifest['sha512'].lower():
        raise RuntimeError('Release checksum mismatch')
    if tarfile.is_tarfile(staging):
        with tarfile.open(staging, 'r:*') as archive:
            member = archive.getmember('antigravity')
            if not member.isfile() or member.size > 512 * 1024 * 1024:
                raise RuntimeError('Unexpected archive entry')
            binary_fd, binary_staging = tempfile.mkstemp(prefix='.agy-bin-', dir='/opt/cor-agent/bin')
            try:
                with os.fdopen(binary_fd, 'wb') as output, archive.extractfile(member) as payload:
                    shutil.copyfileobj(payload, output)
                os.replace(binary_staging, staging)
            finally:
                if os.path.exists(binary_staging): os.unlink(binary_staging)
    with open(staging, 'rb') as binary:
        if binary.read(4) != b'\x7fELF': raise RuntimeError('Expected a Linux ELF executable')
    os.chmod(staging, 0o755)
    os.replace(staging, target)
    print('Verified official Linux CLI release:', manifest['version'], flush=True)
finally:
    if os.path.exists(staging): os.unlink(staging)
PY

python3 - <<'PY'
import json, os
target = '/var/lib/cor-agent/.gemini/antigravity-cli/settings.json'
profile = {'permissions': {'deny': [f'{action}(*)' for action in ('read_file', 'write_file', 'read_url', 'execute_url', 'command', 'unsandboxed', 'mcp')]}}
if os.path.exists(target):
    with open(target) as f: existing = json.load(f)
    permissions = existing.get('permissions', {})
    if not set(profile['permissions']['deny']).issubset(set(permissions.get('deny', []))) or permissions.get('allow') or permissions.get('ask'):
        raise RuntimeError('Existing permissions differ; refusing overwrite')
else:
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    with os.fdopen(fd, 'w') as f: json.dump(profile, f, indent=2)
os.chmod(target, 0o444)
PY

canary_dir=$(mktemp -d /var/tmp/cor-agent-canary.XXXXXX)
trap 'rm -f -- "$canary_dir/canary"; rmdir -- "$canary_dir"' EXIT
printf 'Synthetic isolation probe; contains no real secrets.\n' > "$canary_dir/canary"
chmod 0600 "$canary_dir/canary"
if runuser -u cor-agent -- test -r "$canary_dir/canary"; then
  echo 'Agent can read root-only canary; refusing verification.' >&2; exit 1
fi
echo 'PASS: separate unprivileged identity cannot read root-only canary.'
runuser -u cor-agent -- /opt/cor-agent/bin/agy --version
echo 'Preparation complete; dedicated login, OS service sandbox and adversarial tool-denial tests remain required.'
