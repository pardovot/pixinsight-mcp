#!/usr/bin/env bash
# Regenerate src/BridgeHandlersJS.h from the JS watcher's handler section.
# Run from the repo root (or anywhere; paths are resolved relative to this file).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="$here/pjsr/pixinsight-mcp-watcher.js"
out="$here/module/src/BridgeHandlersJS.h"

# Lines 76..546 = Command Handlers + Process handlers + Utility fns + router
# (dispatchCommand). Excludes the file/config helpers and the polling loop.
{
  echo '// Auto-generated from pjsr/pixinsight-mcp-watcher.js (handler section).'
  echo '// Regenerate with: module/gen-handlers.sh'
  echo '#ifndef __BridgeHandlersJS_h'
  echo '#define __BridgeHandlersJS_h'
  echo 'namespace pcl {'
  echo 'static const char* const MCP_HANDLERS_JS = R"MCPJS('
  sed -n '76,546p' "$src"
  echo ')MCPJS";'
  echo '} // namespace pcl'
  echo '#endif'
} > "$out"
echo "wrote $out"
