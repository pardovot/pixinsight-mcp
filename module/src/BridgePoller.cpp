// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module, bridge poller implementation.
// ----------------------------------------------------------------------------
#include "BridgePoller.h"
#include "BridgeHandlersJS.h"
#include "Version.h"

#include <pcl/File.h>
#include <pcl/MetaModule.h>
#include <pcl/Variant.h>

#include <cstdlib>   // std::getenv, std::atoi

namespace pcl
{

BridgePoller::BridgePoller()
{
}

// ----------------------------------------------------------------------------
// Per-instance slot, so N PixInsight instances (PixInsight.exe -n=N) never poll
// the same commands dir. Precedence mirrors the MCP server (src/types.ts
// resolveBridgeDir) so both ends of the bridge agree:
//   1. PIXINSIGHT_MCP_INSTANCE=N   explicit override (also the fallback if the
//      native instance number ever misreports).
//   2. CoreApplication.instance    the -n=N slot, read via a one-shot
//      EvaluateScript. Legal here: ResolveSlot runs from Initialize(), which
//      runs at StartWatcher on the root thread, long past module-install time
//      (the same reason HandleCommandFile's EvaluateScript is legal).
//   3. slot 1.
// ----------------------------------------------------------------------------
int BridgePoller::ResolveSlot()
{
   const char* envSlot = std::getenv( "PIXINSIGHT_MCP_INSTANCE" );
   if ( envSlot != nullptr && *envSlot != '\0' )
   {
      int n = std::atoi( envSlot );
      if ( n > 0 )
         return n;
   }

   try
   {
      Variant v = Module->EvaluateScript( "CoreApplication.instance", "JavaScript" );
      if ( v.IsValid() && v.CanConvertToInt() )
      {
         int n = v.ToInt();
         if ( n > 0 )
            return n;
      }
   }
   catch ( ... )
   {
      // Fall through to slot 1 if the instance number can't be read.
   }
   return 1;
}

// ----------------------------------------------------------------------------
// PixInsight PID, for the heartbeat identity payload (informational; the server
// judges liveness by heartbeat mtime, not this). One-shot EvaluateScript, same
// safe context as ResolveSlot.
// ----------------------------------------------------------------------------
int BridgePoller::ResolvePid()
{
   try
   {
      Variant v = Module->EvaluateScript( "CoreApplication.pid", "JavaScript" );
      if ( v.IsValid() && v.CanConvertToInt() )
         return v.ToInt();
   }
   catch ( ... )
   {
   }
   return 0;
}

// ----------------------------------------------------------------------------

String BridgePoller::ResolveBridgeDir( int slot )
{
   // Explicit path wins over everything, must match the server's
   // PIXINSIGHT_MCP_BRIDGE_DIR when that override is used.
   const char* explicitDir = std::getenv( "PIXINSIGHT_MCP_BRIDGE_DIR" );
   if ( explicitDir != nullptr && *explicitDir != '\0' )
      return String( explicitDir );

   String base = File::HomeDirectory() + "/.pixinsight-mcp/bridge";
   if ( slot > 1 )
      return base + "-" + String( slot );  // slot 1 keeps the historical path
   return base;
}

// ----------------------------------------------------------------------------

bool BridgePoller::Initialize()
{
   m_slot        = ResolveSlot();
   m_pid         = ResolvePid();
   m_bridgeDir   = ResolveBridgeDir( m_slot );
   m_commandsDir = m_bridgeDir + "/commands";
   m_resultsDir  = m_bridgeDir + "/results";
   m_heartbeatTicks = 0;   // write a heartbeat on the very first tick after Start

   try
   {
      if ( !File::DirectoryExists( m_commandsDir ) )
         File::CreateDirectory( m_commandsDir, true );
      if ( !File::DirectoryExists( m_resultsDir ) )
         File::CreateDirectory( m_resultsDir, true );
      return true;
   }
   catch ( ... )
   {
      return false;
   }
}

// ----------------------------------------------------------------------------

void BridgePoller::WriteHeartbeat()
{
   // Timer ticks ~every 300 ms; refresh the heartbeat ~every 2 s (every 7th
   // tick), and on the first tick after Start so liveness appears promptly.
   // Written directly (no temp+rename): the freshness signal is the file's
   // mtime, which is always valid; a reader that catches a partial JSON body
   // just skips the identity fields and still sees a fresh mtime.
   if ( m_heartbeatTicks++ % 7 != 0 )
      return;
   if ( m_bridgeDir.IsEmpty() )
      return;
   try
   {
      String hb = "{\"slot\":" + String( m_slot )
                + ",\"pid\":" + String( m_pid )
                + ",\"version\":\"" MCPWATCHER_VERSION_STR "\"}";
      File::WriteTextFile( m_bridgeDir + "/heartbeat.json", hb.ToUTF8() );
   }
   catch ( ... )
   {
   }
}

// ----------------------------------------------------------------------------

void BridgePoller::RemoveHeartbeat()
{
   if ( m_bridgeDir.IsEmpty() )
      return;
   try
   {
      String path = m_bridgeDir + "/heartbeat.json";
      if ( File::Exists( path ) )
         File::Remove( path );
   }
   catch ( ... )
   {
   }
}

// ----------------------------------------------------------------------------

int BridgePoller::ProcessPending( int maxPerTick )
{
   // Re-entrancy guard. HandleCommandFile() below runs a command via
   // EvaluateScript on the root thread; a long process (SPFC/SPCC/MGC) pumps the
   // event loop internally (processEvents, to update its progress UI), which
   // re-fires THIS timer while we are still inside it. Without this guard the
   // re-entrant tick finds the same command file (we delete it only after the
   // process returns), executes it NESTED, and the outer result serialization
   // gets corrupted into raw non-JSON text, which the MCP client then cannot
   // parse and waits out as a phantom timeout. This was Run 1's "timeouts on
   // success". One command runs at a time; nested ticks are no-ops.
   if ( m_busy )
      return 0;

   if ( m_commandsDir.IsEmpty() )
      return 0;

   m_busy = true;
   int processed = 0;
   try
   {
      // Snapshot matching command files first. HandleCommandFile() deletes files,
      // so we must not mutate the directory while still iterating it.
      StringList names;
      FindFileInfo info;
      for ( File::Find f( m_commandsDir + "/*.json" ); f.NextItem( info ); )
         if ( !info.IsDirectory() )
            names.Add( info.name );

      for ( const String& name : names )
      {
         if ( processed >= maxPerTick )
            break;
         try
         {
            HandleCommandFile( name );
            m_failCounts.erase( name );
         }
         catch ( ... )
         {
            // Never let one bad command break the tick. But don't retry it
            // forever either: a file that keeps failing before its delete (e.g.
            // unreadable) would otherwise be re-attempted every tick for the
            // life of the session. Give it a few tries, then drop it.
            if ( ++m_failCounts[name] >= 3 )
            {
               try
               {
                  File::Remove( m_commandsDir + '/' + name );
               }
               catch ( ... ) {}
               m_failCounts.erase( name );
            }
         }
         ++processed;
         ++m_totalProcessed;
      }
   }
   catch ( ... )
   {
      // File::Find or anything else, must still clear the guard below.
   }

   m_busy = false;
   return processed;
}

// ----------------------------------------------------------------------------

void BridgePoller::HandleCommandFile( const String& fileName )
{
   // Command file is "<id>.json"; the result uses the same basename.
   String cmdPath = m_commandsDir + '/' + fileName;
   String resPath = m_resultsDir  + '/' + fileName;

   String rawJson = File::ReadTextFile( cmdPath ).UTF8ToUTF16();

   // Build the delegating script: the proven JS handlers (which define
   // dispatchCommand) followed by a wrapper that runs THIS command. The raw
   // command JSON is embedded directly as a JS object literal, JSON is a valid
   // JS expression, so no escaping is needed.
   //
   // CRITICAL: the wrapper WRITES its own result file (File.writeTextFile) from
   // the local __out it just built, and we do NOT trust EvaluateScript's return
   // value. Some processes (SPCC/SPFC/MGC, Gaia photometry) trigger *nested* JS
   // evaluation inside the engine while executing; that clobbers the outer
   // EvaluateScript completion value, so v.ToString() comes back as unrelated raw
   // text (e.g. "true\n<Gaia temp path>") instead of our JSON. __out is a local
   // computed AFTER the process returns, so it is immune. The results dir is
   // injected from m_resultsDir (NOT re-derived from File.homeDirectory) so the
   // JS writes into THIS instance's per-slot bridge, matching resPath above.
   String resDirLit = m_resultsDir;
   resDirLit.ReplaceString( String( "\\" ), String( "\\\\" ) ); // escape for a JS
   resDirLit.ReplaceString( String( "\"" ), String( "\\\"" ) ); //   string literal

   String script = String( MCP_HANDLERS_JS );
   script += "\n;(function(){"
             "var __start=Date.now();"
             "var __cmd=";
   script += rawJson;
   script += ";"
             "var __resDir=\"";
   script += resDirLit;
   script += "\";"
             "var __resPath=__resDir+\"/\"+__cmd.id+\".json\";"
             "var __tmpPath=__resDir+\"/\"+__cmd.id+\".tmp\";"
             "var __out;"
             "try{"
               "var __r=dispatchCommand(__cmd);"
               "__out=JSON.stringify({id:__cmd.id,timestamp:(new Date()).toISOString(),"
                 "status:__r.status,process:__cmd.process,duration_ms:Date.now()-__start,"
                 "outputs:__r.outputs||{},message:__r.message||\"\"});"
             "}catch(e){"
               "__out=JSON.stringify({id:__cmd.id,timestamp:(new Date()).toISOString(),"
                 "status:\"error\",process:__cmd.process,duration_ms:Date.now()-__start,"
                 "error:{message:String((e&&e.message)||e),type:(e&&e.name)||\"Error\","
                 "stack:String((e&&e.stack)||\"\")}});"
             "}"
             "try{File.writeTextFile(__tmpPath,__out);File.move(__tmpPath,__resPath);}catch(e2){}"
             "return __out;"
             "})()";

   String resultJson;
   bool jsWroteResult = false;
   try
   {
      // EvaluateScript must run on the root thread, the timer fires there.
      Variant v = Module->EvaluateScript( script, "JavaScript" );
      resultJson = v.ToString();
      // The wrapper writes the result itself; if that file exists, it is the
      // authoritative (uncorrupted) result, never overwrite it with v.ToString().
      jsWroteResult = File::Exists( resPath );
   }
   catch ( ... )
   {
      // Only reached on a parse-level failure; the wrapper catches JS runtime
      // errors internally and returns an error result. Must conform to the
      // BridgeResult error shape (id + error.message), the MCP client's tools
      // read result.error.message unconditionally on status "error".
      String id = File::ExtractName( fileName ); // "<id>.json" -> "<id>"
      resultJson = "{\"id\":\"" + id + "\","
                   "\"timestamp\":\"\","
                   "\"status\":\"error\","
                   "\"process\":\"__module__\","
                   "\"duration_ms\":0,"
                   "\"error\":{\"message\":\"module EvaluateScript failed "
                   "(script-level failure; the command may not have run)\","
                   "\"type\":\"EvaluateScriptError\"}}";
   }

   // Fallback ONLY if the JS wrapper failed to write the result itself (e.g. a
   // parse-level failure, or File.writeTextFile threw). Otherwise the JS-written
   // file stands, writing v.ToString() here would risk clobbering it with the
   // corrupted completion value described above.
   // Atomic: write "<id>.tmp" (outside the *.json glob) then rename, so the MCP
   // client never sees a partial result file.
   if ( !jsWroteResult )
   {
      String resTmpPath = File::ChangeExtension( resPath, ".tmp" );
      File::WriteTextFile( resTmpPath, resultJson.ToUTF8() );
      File::Move( resTmpPath, resPath );
   }

   if ( File::Exists( cmdPath ) )
      File::Remove( cmdPath );
}

} // namespace pcl
