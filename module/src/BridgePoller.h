// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module — bridge poller.
//
// Polls the file-based bridge (compatible with the JS watcher and the MCP
// server) and dispatches commands. Designed to be called ONCE per timer tick;
// it never loops or sleeps, so it returns control to PixInsight immediately.
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
   // Non-blocking: reads whatever command files exist right now and returns.
   int ProcessPending( int maxPerTick = 10 );

   size_type TotalProcessed() const { return m_totalProcessed; }

   String CommandsDir() const { return m_commandsDir; }
   String ResultsDir()  const { return m_resultsDir; }

private:

   String    m_bridgeDir;
   String    m_commandsDir;
   String    m_resultsDir;
   size_type m_totalProcessed = 0;

   // Execute one command file (absolute path). Writes the result JSON.
   void HandleCommandFile( const String& path );

   // Dispatch by tool name. Returns a result JSON body (outputs/status/message).
   // TODO(json): replace hand-built JSON with nlohmann/json for full params.
   String Dispatch( const IsoString& tool, const String& commandJson );

   // --- native handlers (MVP set) ---
   String HandlePing();
   String HandleListOpenImages();

   // Minimal envelope field extraction until a real JSON parser is dropped in.
   static IsoString ExtractStringField( const String& json, const IsoString& key );
};

} // namespace pcl

#endif // __BridgePoller_h
