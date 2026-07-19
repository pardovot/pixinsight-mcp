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
   if ( m_commandsDir.IsEmpty() )
      return 0;

   // Snapshot matching command files first. HandleCommandFile() deletes files,
   // so we must not mutate the directory while still iterating it.
   StringList names;
   FindFileInfo info;
   for ( File::Find f( m_commandsDir + "/*.json" ); f.NextItem( info ); )
      if ( !info.IsDirectory() )
         names.Add( info.name );

   int processed = 0;
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
   // dispatchCommand) followed by a wrapper that runs THIS command and returns
   // the result JSON string. The raw command JSON is embedded directly as a JS
   // object literal — JSON is a valid JS expression, so no escaping is needed.
   String script = String( MCP_HANDLERS_JS );
   script += "\n;(function(){"
             "var __start=Date.now();"
             "var __cmd=";
   script += rawJson;
   script += ";"
             "try{"
               "var __r=dispatchCommand(__cmd);"
               "return JSON.stringify({id:__cmd.id,timestamp:(new Date()).toISOString(),"
                 "status:__r.status,process:__cmd.process,duration_ms:Date.now()-__start,"
                 "outputs:__r.outputs||{},message:__r.message||\"\"});"
             "}catch(e){"
               "return JSON.stringify({id:__cmd.id,timestamp:(new Date()).toISOString(),"
                 "status:\"error\",process:__cmd.process,duration_ms:Date.now()-__start,"
                 "error:{message:String((e&&e.message)||e),type:(e&&e.name)||\"Error\"}});"
             "}})()";

   String resultJson;
   try
   {
      // EvaluateScript must run on the root thread — the timer fires there.
      Variant v = Module->EvaluateScript( script, "JavaScript" );
      resultJson = v.ToString();
   }
   catch ( ... )
   {
      // Only reached on a parse-level failure; the wrapper catches JS runtime
      // errors internally and returns an error result.
      resultJson = "{\"status\":\"error\",\"message\":\"module EvaluateScript failed\"}";
   }

   File::WriteTextFile( resPath, resultJson.ToUTF8() );

   if ( File::Exists( cmdPath ) )
      File::Remove( cmdPath );
}

} // namespace pcl
