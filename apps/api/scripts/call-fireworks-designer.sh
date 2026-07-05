#!/usr/bin/env bash
# Call Fireworks GLM 5.2 with the exact production designer prompt and save
# the composition HTML for the local test harness.
# Requires: apps/api/scripts/.fireworks-key (one line, the fw_ key)
set -euo pipefail
cd "$(dirname "$0")"

KEY=$(tr -d '[:space:]' < .fireworks-key)
SYSTEM=$(cat playground-system.txt)
USERMSG=$(cat playground-user.txt)

node -e '
const fs = require("fs");
const payload = {
  model: "accounts/fireworks/models/glm-5p2",
  max_tokens: 20000,
  temperature: 0.6,
  messages: [
    { role: "system", content: fs.readFileSync("playground-system.txt", "utf8") },
    { role: "user",   content: fs.readFileSync("playground-user.txt", "utf8") },
  ],
};
fs.writeFileSync("fw-payload.json", JSON.stringify(payload));
'

echo "calling fireworks glm-5p2 (max_tokens=20000)…"
curl -s --max-time 600 \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  --data @fw-payload.json \
  https://api.fireworks.ai/inference/v1/chat/completions > fw-response.json

node -e '
const r = JSON.parse(require("fs").readFileSync("fw-response.json", "utf8"));
if (r.error) { console.error("API ERROR:", JSON.stringify(r.error)); process.exit(1); }
const msg = r.choices?.[0]?.message?.content ?? "";
const finish = r.choices?.[0]?.finish_reason;
require("fs").writeFileSync("glm-output.html", msg);
console.log(`finish_reason=${finish} · ${msg.length} chars · usage: ${JSON.stringify(r.usage)}`);
if (finish === "length") console.log("WARNING: output truncated at max_tokens");
'
rm -f fw-payload.json
echo "saved → glm-output.html"
