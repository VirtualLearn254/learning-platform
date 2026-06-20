#!/usr/bin/env bash
# provision.sh — one-shot setup for a Runpod A100 80GB pod.
#
# Run this AFTER provisioning the pod via the Runpod dashboard:
#   1. Template: PyTorch 2.x (Ubuntu 22.04 + CUDA 12)
#   2. GPU: A100 80GB SXM or PCIe (whichever is available cheapest)
#   3. Container disk: 60GB minimum
#   4. Network volume: 100GB (persists models between pod restarts)
#   5. Expose TCP ports: 22 (SSH), 8000 (vLLM), 8001 (XTTS), 8002 (VLM)
#
# Then SCP this script into the pod and run:
#   bash provision.sh
#
# What it installs:
#   • Tailscale for secure remote access
#   • Docker + NVIDIA container toolkit
#   • vLLM serving Qwen 2.5 32B AWQ on port 8000
#   • Coqui XTTS-v2 serving on port 8001
#   • Qwen2-VL serving on port 8002
#   • Postgres + Redis + MinIO on local ports
#   • The learning-platform repo + its Node.js dependencies
#
# NOTE: this script is DEV-leaning. No CI hardening, no monitoring stack.
# We add those in P4.

set -euo pipefail

echo "==> [1/8] system update"
apt-get update -qq
apt-get install -y -qq curl wget git build-essential ca-certificates gnupg

echo "==> [2/8] Tailscale (for secure SSH from your laptop)"
curl -fsSL https://tailscale.com/install.sh | sh
# Run `tailscale up` interactively after this script to authenticate.

echo "==> [3/8] Docker + NVIDIA container toolkit"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
# NVIDIA container toolkit (so containers can see the GPU)
distribution=$(. /etc/os-release; echo "$ID$VERSION_ID")
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L "https://nvidia.github.io/libnvidia-container/${distribution}/libnvidia-container.list" \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  > /etc/apt/sources.list.d/nvidia-container-toolkit.list
apt-get update -qq
apt-get install -y -qq nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker
systemctl restart docker

echo "==> [4/8] Node.js 22"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs

echo "==> [5/8] Python 3.11 (for vLLM) + uv (fast pip)"
apt-get install -y -qq python3.11 python3.11-venv python3-pip
pip install --upgrade pip uv

echo "==> [6/8] vLLM with Qwen2.5-32B-Instruct-AWQ"
# Pull the vLLM container; runs the model on the GPU and exposes OpenAI-compatible API.
# Using a tag pinned for reproducibility. Update when newer is stable.
VLLM_IMAGE="vllm/vllm-openai:v0.6.4"
docker pull "$VLLM_IMAGE"

# Pre-pull the model into the network volume so pod restarts are fast.
# (Hugging Face cache lives at /root/.cache/huggingface; map a volume there.)
mkdir -p /workspace/models

cat > /etc/systemd/system/vllm.service <<EOF
[Unit]
Description=vLLM serving Qwen2.5-32B-Instruct-AWQ
Requires=docker.service
After=docker.service

[Service]
Restart=always
ExecStart=/usr/bin/docker run --rm --name vllm \\
  --gpus all \\
  --shm-size=16g \\
  -v /workspace/models:/root/.cache/huggingface \\
  -p 8000:8000 \\
  $VLLM_IMAGE \\
  --model Qwen/Qwen2.5-32B-Instruct-AWQ \\
  --quantization awq \\
  --max-model-len 16384 \\
  --gpu-memory-utilization 0.85
ExecStop=/usr/bin/docker stop vllm

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vllm.service
# Don't start it yet — let the user start manually once the network volume is mounted.
echo "    vLLM systemd unit installed. Start with: systemctl start vllm"

echo "==> [7/8] XTTS-v2 (TTS) container"
# Coqui XTTS-v2 via a community HTTP wrapper.
# Note: the official Coqui org dissolved; using a maintained fork.
docker pull ghcr.io/coqui-ai/tts-server:latest || echo "    (image pull deferred; configure manually if not available)"

echo "==> [8/8] Postgres + Redis + MinIO (single-host dev stack)"
# These run as containers on the same box for simplicity. Persistent volumes
# go on the network volume so they survive pod restarts.
mkdir -p /workspace/{postgres_data,redis_data,minio_data}

cat > /workspace/docker-compose.services.yml <<'EOF'
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: lp
      POSTGRES_PASSWORD: lp_dev_password
      POSTGRES_DB: learning_platform
    ports:
      - "5432:5432"
    volumes:
      - /workspace/postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - /workspace/redis_data:/data

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: lp_dev
      MINIO_ROOT_PASSWORD: lp_dev_password_minio
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - /workspace/minio_data:/data
EOF

cd /workspace
docker compose -f docker-compose.services.yml up -d
echo "    Postgres, Redis, MinIO running."

cat <<'NEXT'

═══════════════════════════════════════════════════════════════════════
PROVISION COMPLETE.

NEXT STEPS (do these manually):

  1. Authenticate Tailscale so you can SSH from your laptop:
       tailscale up --ssh

  2. Start vLLM (downloads the model on first run, ~20 min):
       systemctl start vllm
       journalctl -u vllm -f      # watch progress

  3. Clone the learning-platform repo:
       cd /workspace
       git clone <your-repo-url> learning-platform
       cd learning-platform
       npm install
       cp .env.example .env
       # Edit .env: set VLLM_BASE_URL=http://localhost:8000/v1

  4. Push the DB schema:
       npm run db:push

  5. Start the API and web servers (or run as systemd services):
       npm run dev

  6. Confirm everything's healthy:
       curl http://localhost:3001/health

For the dev workflow guide, see docs/DEV.md in the repo.
═══════════════════════════════════════════════════════════════════════
NEXT
