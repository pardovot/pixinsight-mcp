// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module, bridge poller.
//
// Polls the file-based bridge (compatible with the JS watcher and the MCP
// server) and executes each command by delegating to the embedded JS handler
// logic via MetaModule::EvaluateScript(). This reuses the exact, proven watcher
// handlers (BridgeHandlersJS.h) instead of reimplementing every process in C++.
//
// Called ONCE per timer tick; never loops or sleeps, so it returns control to
// PixInsight immediately.
// ----------------------------------------------------------------------------
#ifndef __BridgePoller_h
#define __BridgePoller_h

#include <pcl/String.h>

#include <map>

namespace pcl
{

class BridgePoller
{
public:

   BridgePoller();

   // Resolve the per-instance bridge directory (shared slot convention with the
   // MCP server and PJSR watcher) and ensure it exists. Returns false if the
   // base dir can't be created.
   bool Initialize();

   // Process up to maxPerTick pending commands. Returns the number processed.
   int ProcessPending( int maxPerTick = 10 );

   // Refresh this instance's heartbeat file (bridgeDir/heartbeat.json), throttled
   // internally; call once per timer tick. Lets the MCP server auto-detect which
   // PixInsight instances are live (fresh mtime) without pinging the bridge.
   void WriteHeartbeat();
   // Drop the heartbeat on stop, so the server sees this instance go down at once
   // instead of waiting for the freshness window to lapse.
   void RemoveHeartbeat();

   size_type TotalProcessed() const { return m_totalProcessed; }
   int       Slot()           const { return m_slot; }

   String BridgeDir()   const { return m_bridgeDir; }
   String CommandsDir() const { return m_commandsDir; }
   String ResultsDir()  const { return m_resultsDir; }

private:

   String    m_bridgeDir;
   String    m_commandsDir;
   String    m_resultsDir;
   int       m_slot = 1;             // this instance's bridge slot (identity)
   int       m_pid  = 0;             // PixInsight PID, for the heartbeat payload
   int       m_heartbeatTicks = 0;   // throttles WriteHeartbeat (see .cpp)
   size_type m_totalProcessed = 0;
   // Re-entrancy guard: true while a command is executing. A long process pumps
   // the event loop, which can re-fire the poll timer; nested ticks must no-op.
   bool      m_busy = false;
   // Consecutive failures per command file; a file failing repeatedly is
   // deleted instead of being retried every tick forever.
   std::map<String, int> m_failCounts;

   // Execute one command file (by name, e.g. "<id>.json") and write its result.
   void HandleCommandFile( const String& fileName );

   // Resolve the bridge dir for THIS PixInsight instance. See the .cpp for the
   // precedence (explicit env dir > PIXINSIGHT_MCP_INSTANCE > CoreApplication
   // instance number > slot 1). Kept in sync with the MCP server + watcher.
   static String ResolveBridgeDir( int slot );
   static int    ResolveSlot();
   static int    ResolvePid();
};

} // namespace pcl

#endif // __BridgePoller_h
