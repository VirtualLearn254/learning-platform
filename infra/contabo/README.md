# Contabo deploy scripts

Two equivalent deploy scripts — pick the one that matches your shell.

| File | When to use |
|---|---|
| `deploy.sh` | macOS, Linux, Git Bash, WSL |
| `deploy.ps1` | Native Windows PowerShell |

Both do the same thing: rsync (or tar+scp) the repo over → rebuild + restart the docker compose stack → run DB migrations → poll the healthcheck.

## PowerShell quickstart (Windows)

From an elevated or normal PowerShell window at the repo root:

```powershell
# First-time provision (run once after ordering the VPS)
scp .\infra\contabo\provision.sh root@178.238.231.100:/root/
ssh root@178.238.231.100 'bash /root/provision.sh'
ssh root@178.238.231.100 'tailscale up --ssh'   # optional but recommended

# Deploy (the regular workflow)
.\infra\contabo\deploy.ps1 -Remote lp@178.238.231.100
```

### What the script needs

- `ssh` and `scp` from Windows OpenSSH Client (built into Win10 1803+; if missing: Settings → System → Optional Features → Add → OpenSSH Client)
- `tar` (built into Win10 1803+)
- Optionally `rsync` for faster incremental syncs (`scoop install rsync` or `choco install rsync`)

The script detects what's available and picks the best path automatically.

### Flags

| Flag | Effect |
|---|---|
| `-RemoteDir <path>` | Override deploy target on the VPS (default `/home/lp/app`) |
| `-SkipMigrations` | Skip the `db:push` step (useful when the schema hasn't changed) |
| `-SkipHealthcheck` | Don't poll `/healthz` after deploy (e.g., when running behind a closed firewall) |

### Common issues

| Symptom | Fix |
|---|---|
| `ssh: command not found` | Install Windows OpenSSH client (see above) |
| `Permission denied (publickey)` | Use password auth or add your public key with `ssh-copy-id` (Git Bash) or manually paste into `~/.ssh/authorized_keys` on the VPS |
| `tar: command not found` | You're on Win10 pre-1803 — install Git for Windows (provides tar) or install rsync |
| First build runs out of memory | The provisioner adds 8 GB swap; check `free -h`. Otherwise upgrade Contabo plan |
| Healthcheck never passes | `ssh lp@<vps-ip>` then `cd ~/app && docker compose -f docker-compose.prod.yml logs --tail 50` |
