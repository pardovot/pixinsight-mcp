// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module — bridge poller.
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

namespace pcl
{

class BridgePoller
{
public:

   BridgePoller();

   // Resolve bridge directories under <home>/.pixinsight-mcp/bridge and ensure
   // they exist. Returns false if the base dir can't be created.
   bool Initialize();

   // Process up to maxPerTick pending commands. Returns the number processed.
   int ProcessPending( int maxPerTick = 10 );

   size_type TotalProcessed() const { return m_totalProcessed; }

   String CommandsDir() const { return m_commandsDir; }
   String ResultsDir()  const { return m_resultsDir; }

private:

   String    m_bridgeDir;
   String    m_commandsDir;
   String    m_resultsDir;
   size_type m_totalProcessed = 0;
   // Re-entrancy guard: true while a command is executing. A long process pumps
   // the event loop, which can re-fire the poll timer; nested ticks must no-op.
   bool      m_busy = false;

   // Execute one command file (by name, e.g. "<id>.json") and write its result.
   void HandleCommandFile( const String& fileName );
};

} // namespace pcl

#endif // __BridgePoller_h
