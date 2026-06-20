# deploy.ps1 — PowerShell deploy script for Contabo VPS.
#
# Native Windows alternative to deploy.sh. Uses built-in OpenSSH (ssh + scp)
# and tar (ships with Windows 10 1803+). If rsync is available on PATH it's
# used for faster incremental syncs; otherwise falls back to tar+scp.
#
# Usage:
#   .\infra\contabo\deploy.ps1 -Remote lp@178.238.231.100
#
# Optional:
#   .\infra\contabo\deploy.ps1 -Remote lp@<ip> -RemoteDir /home/lp/app -SkipMigrations

[CmdletBinding()]
param(
  [Parameter(Mandatory, Position=0, HelpMessage="user@vps-ip")]
  [string]$Remote,

  [Parameter(Position=1)]
  [string]$RemoteDir = "/home/lp/app",

  [switch]$SkipMigrations,
  [switch]$SkipHealthcheck
)

$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────
function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    [warn] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "    [error] $msg" -ForegroundColor Red }

function Test-Command($name) {
  $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

# ── Pre-flight ───────────────────────────────────────────────────────
Write-Step "preflight"
foreach ($cmd in @("ssh", "scp")) {
  if (-not (Test-Command $cmd)) {
    Write-Err "$cmd not found. Install Windows OpenSSH client:"
    Write-Host "        Settings > System > Optional Features > Add a feature > OpenSSH Client"
    exit 1
  }
}
$useRsync = Test-Command "rsync"
$useTar = Test-Command "tar"
if (-not $useRsync -and -not $useTar) {
  Write-Err "Neither rsync nor tar found. Install one:"
  Write-Host "        scoop install rsync   # or   choco install rsync"
  exit 1
}
Write-Ok ("sync method: " + $(if ($useRsync) { "rsync" } else { "tar+scp" }))

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot
Write-Ok "repo root: $repoRoot"

# Parse host from "user@host"
$hostIp = $Remote -replace '^.*@', ''

# ── Step 1: make sure remote dir exists ──────────────────────────────
Write-Step "ensure remote dir exists: $RemoteDir"
ssh $Remote "mkdir -p $RemoteDir"
if ($LASTEXITCODE -ne 0) { Write-Err "ssh failed — check credentials + IP"; exit 1 }

# ── Step 2: sync code ────────────────────────────────────────────────
Write-Step "[1/3] syncing code -> $Remote`:$RemoteDir"
$excludes = @(
  "node_modules", ".next", "dist", ".env", ".env.local", "captures",
  ".git", "out", "*.log", ".DS_Store", "Thumbs.db"
)

if ($useRsync) {
  $rsyncArgs = @("-avz", "--delete")
  foreach ($e in $excludes) { $rsyncArgs += @("--exclude", $e) }
  $rsyncArgs += @("./", "${Remote}:${RemoteDir}/")
  & rsync @rsyncArgs
  if ($LASTEXITCODE -ne 0) { Write-Err "rsync failed"; exit 1 }
} else {
  # tar + scp fallback. Bundle locally, scp the tarball, extract on remote.
  $tarName = "lp-deploy-$(Get-Date -Format 'yyyyMMddHHmmss').tar.gz"
  $tarLocal = Join-Path $env:TEMP $tarName
  Write-Host "    bundling -> $tarLocal"
  $tarArgs = @("-czf", $tarLocal)
  foreach ($e in $excludes) { $tarArgs += @("--exclude=$e") }
  $tarArgs += @(".")
  & tar @tarArgs
  if ($LASTEXITCODE -ne 0) { Write-Err "tar failed"; Remove-Item $tarLocal -ErrorAction SilentlyContinue; exit 1 }
  $bytes = (Get-Item $tarLocal).Length
  Write-Host ("    archive: {0:N1} MB" -f ($bytes / 1MB))

  Write-Host "    scp -> ${Remote}:/tmp/$tarName"
  & scp $tarLocal "${Remote}:/tmp/$tarName"
  if ($LASTEXITCODE -ne 0) { Write-Err "scp failed"; Remove-Item $tarLocal -ErrorAction SilentlyContinue; exit 1 }

  Write-Host "    extracting on remote"
  ssh $Remote "cd $RemoteDir && tar -xzf /tmp/$tarName && rm /tmp/$tarName"
  if ($LASTEXITCODE -ne 0) { Write-Err "remote extract failed"; exit 1 }

  Remove-Item $tarLocal -ErrorAction SilentlyContinue
}
Write-Ok "code synced"

# ── Step 3: build + restart stack ────────────────────────────────────
Write-Step "[2/3] rebuilding + restarting docker compose stack (first build = 5-8 min)"
ssh $Remote "cd $RemoteDir && docker compose -f docker-compose.prod.yml up -d --build"
if ($LASTEXITCODE -ne 0) {
  Write-Err "docker compose failed. Logs:"
  Write-Host "        ssh $Remote 'cd $RemoteDir && docker compose -f docker-compose.prod.yml logs --tail 100'"
  exit 1
}
Write-Ok "stack up"

if (-not $SkipMigrations) {
  Write-Step "running database migrations"
  # Wait briefly for postgres to be healthy before pushing schema.
  ssh $Remote "cd $RemoteDir && for i in `$(seq 1 30); do docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U lp -d learning_platform && break; sleep 2; done"
  ssh $Remote "cd $RemoteDir && docker compose -f docker-compose.prod.yml exec -T api npm run db:push"
  if ($LASTEXITCODE -ne 0) { Write-Warn "db:push had a non-zero exit — check it ran" }
  else { Write-Ok "schema synced" }
}

# ── Step 4: healthcheck ──────────────────────────────────────────────
if (-not $SkipHealthcheck) {
  Write-Step "[3/3] healthcheck (waiting up to 60s)"
  $url = "http://$hostIp/healthz"
  $alive = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri $url -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
      if ($resp.StatusCode -eq 200) { $alive = $true; break }
    } catch { Start-Sleep -Seconds 2 }
  }
  if ($alive) {
    Write-Host ""
    Write-Host "    [OK] alive at http://$hostIp/" -ForegroundColor Green
    Write-Host ""
    Write-Host "    dashboard:      http://$hostIp/"
    Write-Host "    health:         http://$hostIp/healthz"
    Write-Host "    minio console:  http://$hostIp/minio-console/"
    Write-Host ""
    exit 0
  } else {
    Write-Err "healthcheck did not pass within 60s. Check logs:"
    Write-Host "        ssh $Remote 'cd $RemoteDir && docker compose -f docker-compose.prod.yml logs --tail 100'"
    exit 1
  }
} else {
  Write-Ok "skipped healthcheck"
  exit 0
}
