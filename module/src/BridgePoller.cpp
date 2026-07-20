// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module — bridge poller implementation.
// ----------------------------------------------------------------------------
#include "BridgePoller.h"
#include "BridgeHandlersJS.h"

#include <pcl/File.h>
#include <pcl/MetaModule.h>
#include <pcl/Variant.h>

namespace pcl
{

BridgePoller::BridgePoller()
{
}

// ----------------------------------------------------------------------------

bool BridgePoller::Initialize()
{
   String home = File::HomeDirectory();
   m_bridgeDir   = home + "/.pixinsight-mcp/bridge";
   m_commandsDir = m_bridgeDir + "/commands";
   m_resultsDir  = m_bridgeDir + "/results";

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

int BridgePoller::ProcessPending( int maxPerTick )
{
   // Re-entrancy guard. HandleCommandFile() below runs a command via
   // EvaluateScript on the root thread; a long process (SPFC/SPCC/MGC) pumps the
   // event loop internally (processEvents, to update its progress UI), which
   // re-fires THIS timer while we are still inside it. Without this guard the
   // re-entrant tick finds the same command file (we delete it only after the
   // process returns), executes it NESTED, and the outer result serialization
   // gets corrupted into raw non-JSON text — which the MCP client then cannot
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
         }
         catch ( ... )
         {
            // Never let one bad command break the tick.
         }
         ++processed;
         ++m_totalProcessed;
      }
   }
   catch ( ... )
   {
      // File::Find or anything else — must still clear the guard below.
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
   // command JSON is embedded directly as a JS object literal — JSON is a valid
   // JS expression, so no escaping is needed.
   //
   // CRITICAL: the wrapper WRITES its own result file (File.writeTextFile) from
   // the local __out it just built, and we do NOT trust EvaluateScript's return
   // value. Some processes (SPCC/SPFC/MGC — Gaia photometry) trigger *nested* JS
   // evaluation inside the engine while executing; that clobbers the outer
   // EvaluateScript completion value, so v.ToString() comes back as unrelated raw
   // text (e.g. "true\n<Gaia temp path>") instead of our JSON. __out is a local
   // computed AFTER the process returns, so it is immune. The result path is
   // derived in JS the same way C++ derives resPath.
   String script = String( MCP_HANDLERS_JS );
   script += "\n;(function(){"
             "var __start=Date.now();"
             "var __cmd=";
   script += rawJson;
   script += ";"
             "var __resPath=File.homeDirectory+\"/.pixinsight-mcp/bridge/results/\"+__cmd.id+\".json\";"
             "var __out;"
             "try{"
               "var __r=dispatchCommand(__cmd);"
               "__out=JSON.stringify({id:__cmd.id,timestamp:(new Date()).toISOString(),"
                 "status:__r.status,process:__cmd.process,duration_ms:Date.now()-__start,"
                 "outputs:__r.outputs||{},message:__r.message||\"\"});"
             "}catch(e){"
               "__out=JSON.stringify({id:__cmd.id,timestamp:(new Date()).toISOString(),"
                 "status:\"error\",process:__cmd.process,duration_ms:Date.now()-__start,"
                 "error:{message:String((e&&e.message)||e),type:(e&&e.name)||\"Error\"}});"
             "}"
             "try{File.writeTextFile(__resPath,__out);}catch(e2){}"
             "return __out;"
             "})()";

   String resultJson;
   bool jsWroteResult = false;
   try
   {
      // EvaluateScript must run on the root thread — the timer fires there.
      Variant v = Module->EvaluateScript( script, "JavaScript" );
      resultJson = v.ToString();
      // The wrapper writes the result itself; if that file exists, it is the
      // authoritative (uncorrupted) result — never overwrite it with v.ToString().
      jsWroteResult = File::Exists( resPath );
   }
   catch ( ... )
   {
      // Only reached on a parse-level failure; the wrapper catches JS runtime
      // errors internally and returns an error result.
      resultJson = "{\"status\":\"error\",\"message\":\"module EvaluateScript failed\"}";
   }

   // Fallback ONLY if the JS wrapper failed to write the result itself (e.g. a
   // parse-level failure, or File.writeTextFile threw). Otherwise the JS-written
   // file stands — writing v.ToString() here would risk clobbering it with the
   // corrupted completion value described above.
   if ( !jsWroteResult )
      File::WriteTextFile( resPath, resultJson.ToUTF8() );

   if ( File::Exists( cmdPath ) )
      File::Remove( cmdPath );
}

} // namespace pcl
