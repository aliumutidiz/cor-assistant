#!/usr/bin/env bash
# Interactive login/diagnostics launcher. Does not expose a model service or grant sudo.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run with sudo to establish the restricted service identity.' >&2; exit 1; }
[[ -x /opt/cor-agent/bin/agy ]] || { echo 'Prepare the dedicated agent first.' >&2; exit 1; }
[[ -f /var/lib/cor-agent/.gemini/antigravity-cli/settings.json ]] || exit 1
login_mode=false
if [[ ${1:-} == --login ]]; then
  login_mode=true
  shift
  [[ $# == 0 ]] || { echo 'Login mode accepts no model/task arguments.' >&2; exit 1; }
fi
# Authentication/onboarding persists CLI preferences using atomic replacement.
# Only this explicit interactive setup mode omits the settings-file bind mount.
# The surrounding operating-system restrictions are identical in both modes.
policy_properties=(--property=ReadOnlyPaths=/var/lib/cor-agent/.gemini/antigravity-cli/settings.json)
if "$login_mode"; then policy_properties=(); fi
python3 - <<'PY'
import json, os, stat
directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
try:
    for name in ('var', 'lib', 'cor-agent', '.gemini', 'antigravity-cli'):
        child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
        os.close(directory)
        directory = child
    fd = os.open('settings.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(fd) as f:
        info = os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024: raise RuntimeError('Invalid settings file')
        permissions = json.load(f).get('permissions', {})
    required = {f'{action}(*)' for action in ('read_file', 'write_file', 'read_url', 'execute_url', 'command', 'unsandboxed', 'mcp')}
    if not required.issubset(set(permissions.get('deny', []))) or permissions.get('allow') or permissions.get('ask'):
        raise RuntimeError('Required deny policy missing; refusing session')
finally:
    os.close(directory)
PY
io_mode=--pty
for argument in "$@"; do
  case "$argument" in -p|--print|--prompt|models|--version|--input-format) io_mode=--pipe;; esac
done
exec systemd-run --quiet --wait --collect "$io_mode" \
  --uid=cor-agent --gid=cor-agent \
  --working-directory=/var/lib/cor-agent/work \
  --property=ProtectHome=yes \
  --property=ProtectSystem=strict \
  --property=ReadWritePaths=/var/lib/cor-agent \
  "${policy_properties[@]}" \
  --property='InaccessiblePaths=-/etc/cor -/opt/cor -/var/lib/postgresql -/run/docker.sock -/run/containerd/containerd.sock' \
  --property=PrivateTmp=yes --property=PrivateDevices=yes \
  --property=NoNewPrivileges=yes --property=RestrictSUIDSGID=yes \
  --property=RestrictNamespaces=yes --property=CapabilityBoundingSet= \
  --property=UMask=0077 --property=KillMode=control-group \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
  /usr/bin/env -i HOME=/var/lib/cor-agent USER=cor-agent LOGNAME=cor-agent \
  PATH=/usr/local/bin:/usr/bin:/bin XDG_RUNTIME_DIR=/var/lib/cor-agent/run \
  TERM="${TERM:-xterm-256color}" \
  /usr/bin/dbus-run-session -- /opt/cor-agent/bin/agy "$@"
