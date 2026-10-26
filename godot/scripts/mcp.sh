#!/usr/bin/env bash
# Calls one tool on the editor's MCP server (the godot_mcp addon) and prints the JSON result.
# The same server .mcp.json gives a Claude session; this lets a running session or a script use
# it without a client restart. The server is stateless and answers plain JSON.
#
#   godot/scripts/mcp.sh tools                         # list the tools
#   godot/scripts/mcp.sh <tool> '<json arguments>'     # e.g. mcp.sh get_editor_log '{}'
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="$(sed -n 's/^server\/port=//p' "$ROOT/project.godot")"
TOKEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["Authorization"])' "$ROOT/.godot/godot_mcp/headers.json")"

if [[ "${1:-}" == tools ]]; then
  BODY='{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
else
  BODY="$(python3 -c 'import json,sys; print(json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":sys.argv[1],"arguments":json.loads(sys.argv[2])}}))' "$1" "${2:-{\}}")"
fi
curl -sS --max-time 600 "http://127.0.0.1:$PORT/mcp" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -H 'MCP-Protocol-Version: 2025-06-18' \
  -d "$BODY"
echo
