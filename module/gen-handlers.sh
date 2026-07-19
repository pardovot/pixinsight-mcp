#!/usr/bin/env bash
# Regenerate src/BridgeHandlersJS.h from the JS watcher's handler section.
# Run from the repo root (or anywhere; paths are resolved relative to this file).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="$here/pjsr/pixinsight-mcp-watcher.js"
out="$here/module/src/BridgeHandlersJS.h"

# Extract the handler block between the sentinels in the watcher (Command
# Handlers + Process handlers + XTerminator + Utility fns + dispatchCommand).
# Sentinels make this robust to line-number changes.
{
  echo '// Auto-generated from pjsr/pixinsight-mcp-watcher.js (handler section).'
  echo '// Regenerate with: module/gen-handlers.sh'
  echo '#ifndef __BridgeHandlersJS_h'
  echo '#define __BridgeHandlersJS_h'
  echo 'namespace pcl {'
  # Emit the handler block as multiple adjacent raw-string literals (C++
  # concatenates them). A single literal would exceed MSVC's ~16 KB limit
  # (C2026). Chunk every 80 lines.
  echo 'static const char* const MCP_HANDLERS_JS ='
  awk '/__MCP_HANDLERS_BEGIN__/{f=1;next} /__MCP_HANDLERS_END__/{f=0}
       f {
         if (n % 80 == 0) { if (n) print ")MCPJS\""; print "R\"MCPJS(" }
         print; n++
       }
       END { print ")MCPJS\"" }' "$src"
  echo ';'
  echo '} // namespace pcl'
  echo '#endif'
} > "$out"
echo "wrote $out ($(grep -c . "$out") lines)"
