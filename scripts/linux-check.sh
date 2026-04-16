#!/usr/bin/env bash
#
# Run `cargo check` against a Linux VM without polluting git history.
#
# Sync flow:
#   1. Ping VM. If unreachable, prompt user to start the VM and exit.
#   2. `git fetch` + `git checkout <LOCAL_HEAD>` on the VM so the committed
#      baseline matches. --detach so no branch is disturbed.
#   3. `git diff HEAD --binary` piped to `git apply` on the VM, applying
#      whatever local uncommitted WIP we have on top.
#   4. `cargo check` on the VM, tail the output.
#
# Key principle: do NOT commit just to get code onto the VM. Commits are
# for real work, not transport.

set -euo pipefail

VM_HOST="${ONEBOX_LINUX_VM:-root@100.91.1.95}"
VM_PATH="${ONEBOX_LINUX_VM_PATH:-/home/z/Desktop/OneBox}"

SSH_OPTS=(-o ConnectTimeout=3 -o BatchMode=yes)

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()    { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m⚠\033[0m %s\n' "$*"; }
fail()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }

# Step 1: preflight — is the VM reachable?
if ! ssh "${SSH_OPTS[@]}" "$VM_HOST" true 2>/dev/null; then
    fail "Cannot reach $VM_HOST"
    echo ""
    echo "  The Linux VM is offline. Start it manually and retry:"
    echo "    • If using OrbStack: the VM snapshot lives under OrbStack → Machines"
    echo "    • If using UTM/VMware/VirtualBox: resume via their UI"
    echo ""
    echo "  Override target with ONEBOX_LINUX_VM=<user@host> if the VM moves."
    exit 1
fi
ok "VM reachable: $VM_HOST"

# Step 2: align committed baseline to local HEAD.
LOCAL_HEAD=$(git rev-parse HEAD)
LOCAL_SHORT=$(git rev-parse --short HEAD)
echo ""
bold "→ Syncing VM to local HEAD ($LOCAL_SHORT)"
ssh "${SSH_OPTS[@]}" "$VM_HOST" bash -s <<EOF
set -e
cd "$VM_PATH"
# Reset any previously-applied WIP patch from an earlier run.
git reset --hard HEAD --quiet
git fetch origin --quiet
if ! git cat-file -e $LOCAL_HEAD^{commit} 2>/dev/null; then
    echo "commit $LOCAL_HEAD not on VM after fetch — push it first or the VM is on the wrong remote"
    exit 1
fi
git checkout --detach $LOCAL_HEAD --quiet
EOF
ok "VM at $LOCAL_SHORT"

# Step 3: apply local uncommitted WIP as a patch (staged + unstaged).
if git diff HEAD --quiet --ignore-submodules; then
    ok "No local WIP to patch"
else
    DIFF_STAT=$(git diff HEAD --shortstat --ignore-submodules)
    bold "→ Applying local WIP patch:$DIFF_STAT"
    if ! git diff HEAD --binary --ignore-submodules | \
            ssh "${SSH_OPTS[@]}" "$VM_HOST" "cd $VM_PATH && git apply --whitespace=nowarn"; then
        fail "git apply on VM failed"
        exit 1
    fi
    ok "patch applied"
fi

# Step 4: run cargo check on the VM.
echo ""
bold "→ cargo check on VM"
ssh "${SSH_OPTS[@]}" "$VM_HOST" \
    "export PATH=\$HOME/.cargo/bin:\$PATH && cd $VM_PATH/src-tauri && cargo check 2>&1" \
    | sed 's/^/  /'
