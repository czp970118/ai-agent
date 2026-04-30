#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 \"<prompt>\" <output.png> [size]"
  exit 1
fi

PROMPT="$1"
OUTFILE="$2"
SIZE="${3:-${DASHSCOPE_IMAGE_SIZE:-1024*1024}}"
MODEL="${DASHSCOPE_IMAGE_MODEL:-z-image-turbo}"
API_KEY="${DASHSCOPE_API_KEY:-}"

if [[ -z "$API_KEY" ]]; then
  echo "Missing DASHSCOPE_API_KEY in environment."
  exit 1
fi

TMP_JSON="$(mktemp)"
export PROMPT SIZE MODEL

curl -sS "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -X POST \
  -d "$(python3 - <<'PY'
import json, os
print(json.dumps({
  "model": os.environ["MODEL"],
  "input": {
    "messages": [
      {
        "role": "user",
        "content": [{"text": os.environ["PROMPT"]}]
      }
    ]
  },
  "parameters": {
    "size": os.environ["SIZE"],
    "prompt_extend": False
  }
}, ensure_ascii=False))
PY
)" > "$TMP_JSON"

export TMP_JSON OUTFILE
python3 - <<'PY'
import base64
import json
import os
import pathlib
import urllib.request

data = json.loads(pathlib.Path(os.environ["TMP_JSON"]).read_text(encoding="utf-8"))
if data.get("code"):
    raise SystemExit(f"DashScope error: {data.get('code')} {data.get('message', '')}")

choices = (((data.get("output") or {}).get("choices")) or [])
if not choices:
    raise SystemExit("No image in DashScope response")

first = choices[0]
messages = first.get("message", {})
content = messages.get("content", [])
first_content = content[0] if content else {}
url = first_content.get("image")
b64 = first_content.get("base64_data")
out = pathlib.Path(os.environ["OUTFILE"])
out.parent.mkdir(parents=True, exist_ok=True)

if url:
    with urllib.request.urlopen(url) as r:
        out.write_bytes(r.read())
elif b64:
    out.write_bytes(base64.b64decode(b64))
else:
    raise SystemExit("DashScope response has neither url nor base64_data")

print(f"Saved: {out}")
PY

rm -f "$TMP_JSON"
