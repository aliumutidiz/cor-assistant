#!/usr/bin/env bash
# Synthetic checks only. No model request and no access to real credentials.
set -euo pipefail
[[ $(id -u) == 0 ]] || exit 1
result=$(systemd-run --quiet --wait --collect --pipe \
  --uid=cor-agent --gid=cor-agent --working-directory=/var/lib/cor-agent/work \
  --property=ProtectHome=yes --property=ProtectSystem=strict \
  --property=ReadWritePaths=/var/lib/cor-agent \
  --property=ReadOnlyPaths=/var/lib/cor-agent/.gemini/antigravity-cli/settings.json \
  --property='InaccessiblePaths=-/etc/cor -/opt/cor -/var/lib/postgresql -/run/docker.sock -/run/containerd/containerd.sock' \
  --property=PrivateTmp=yes --property=PrivateDevices=yes \
  --property=NoNewPrivileges=yes --property=RestrictSUIDSGID=yes \
  --property=RestrictNamespaces=yes --property=CapabilityBoundingSet= \
  --property=UMask=0077 --property=KillMode=control-group \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
  /usr/bin/env -i HOME=/var/lib/cor-agent USER=cor-agent PATH=/usr/bin:/bin \
  /usr/bin/python3 -c '
import json, os, subprocess, tempfile
assert os.getuid() != 0
assert not os.access("/home/ali", os.R_OK)
assert not os.access("/run/docker.sock", os.R_OK)
status = open("/proc/self/status").read()
assert "NoNewPrivs:\t1" in status
assert "CapEff:\t0000000000000000" in status
policy = "/var/lib/cor-agent/.gemini/antigravity-cli/settings.json"
profile = json.load(open(policy))
assert len(profile["permissions"]["deny"]) == 7
try:
    fd = os.open(policy, os.O_WRONLY)
except OSError:
    pass
else:
    os.close(fd)
    raise RuntimeError("Policy unexpectedly writable")
with tempfile.TemporaryFile(dir="/var/lib/cor-agent/work") as f:
    f.write(b"synthetic workspace probe")
child = subprocess.Popen(["/usr/bin/sleep", "120"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(json.dumps({"unprivileged": True, "homeBlocked": True, "dockerBlocked": True, "noNewPrivileges": True, "policyReadOnly": True, "workspaceWritable": True, "descendantPid": child.pid}), flush=True)
')
printf '%s\n' "$result"
descendant=$(printf '%s' "$result" | python3 -c 'import json,sys; print(json.load(sys.stdin)["descendantPid"])')
if kill -0 "$descendant" 2>/dev/null; then
  state=$(ps -o stat= -p "$descendant" || true)
  [[ "$state" == Z* ]] || { echo 'FAIL: descendant survived service shutdown.' >&2; exit 1; }
fi
echo 'PASS: descendant stopped with its service control group.'
