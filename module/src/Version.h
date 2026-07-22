// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module — version.
// Bump MCPWATCHER_VERSION_* on each change; the dialog also shows the build
// timestamp so distinct builds are always distinguishable. The timestamp comes
// from the generated BuildTimestamp.h (written by build.mjs on every build);
// __DATE__/__TIME__ is only a fallback for raw CMake builds and can be stale
// under incremental compilation.
// ----------------------------------------------------------------------------
#ifndef __MCPWatcher_Version_h
#define __MCPWatcher_Version_h

#define MCPWATCHER_VERSION_MAJOR   1
#define MCPWATCHER_VERSION_MINOR   2
#define MCPWATCHER_VERSION_RELEASE 0

#define MCPWATCHER_VERSION_STR     "1.2.0"

#if __has_include("BuildTimestamp.h")
# include "BuildTimestamp.h"
#else
# define MCPWATCHER_BUILD_STR      __DATE__ " " __TIME__
#endif

#endif // __MCPWatcher_Version_h
