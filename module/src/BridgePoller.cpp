// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module — bridge poller implementation.
// ----------------------------------------------------------------------------
#include "BridgePoller.h"

#include <pcl/File.h>
#include <pcl/FileInfo.h>
#include <pcl/ImageWindow.h>
#include <pcl/View.h>

namespace pcl
{

BridgePoller::BridgePoller()
{
}

// ----------------------------------------------------------------------------

bool BridgePoller::Initialize()
{
   // <home>/.pixinsight-mcp/bridge/{commands,results,logs}
   String home = File::HomeDirectory();
   m_bridgeDir   = home + "/.pixinsight-mcp/bridge";
   m_commandsDir = m_bridgeDir + "/commands";
   m_resultsDir  = m_bridgeDir + "/results";

   try
   {
      if ( !File::DirectoryExists( m_commandsDir ) )
         File::CreateDirectory( m_commandsDir, true/*createIntermediateDirectories*/ );
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

   int processed = 0;

   // Snapshot the current command files. Only *.json, oldest first is fine for
   // MVP (the MCP bridge sends one command at a time and waits for its result).
   StringList files = File::SearchDirectory( m_commandsDir + "/*.json" );

   for ( const String& name : files )
   {
      if ( processed >= maxPerTick )
         break;

      String path = m_commandsDir + '/' + File::ExtractNameAndSuffix( name );
      try
      {
         HandleCommandFile( path );
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

void BridgePoller::HandleCommandFile( const String& path )
{
   // Read the command JSON.
   IsoString utf8 = File::ReadTextFile( path );
   String commandJson( utf8.UTF8ToUTF16() );

   IsoString id   = ExtractStringField( commandJson, "id" );
   IsoString tool = ExtractStringField( commandJson, "tool" );

   String body = Dispatch( tool, commandJson );

   // Write result file: <results>/<id>.json
   if ( !id.IsEmpty() )
   {
      String resultPath = m_resultsDir + '/' + String( id ) + ".json";
      File::WriteTextFile( resultPath, IsoString( body.ToUTF8() ) );
   }

   // Remove the command file so it isn't reprocessed.
   if ( File::Exists( path ) )
      File::Remove( path );
}

// ----------------------------------------------------------------------------

String BridgePoller::Dispatch( const IsoString& tool, const String& /*commandJson*/ )
{
   // MVP native handlers. Extend this switch with the remaining tools, or route
   // to the JS logic — see MCPWatcherInterface // TODO(js-delegation).
   if ( tool == "list_open_images" || (tool.IsEmpty()) )
      return HandleListOpenImages();

   if ( tool == "ping" )
      return HandlePing();

   // Unknown / not-yet-ported tool.
   return "{\"status\":\"error\",\"message\":\"tool not implemented in native module (MVP): "
          + String( tool ) + "\"}";
}

// ----------------------------------------------------------------------------

String BridgePoller::HandlePing()
{
   return "{\"status\":\"success\",\"outputs\":{},\"message\":\"pong (native module)\"}";
}

String BridgePoller::HandleListOpenImages()
{
   String images = "[";
   Array<ImageWindow> windows = ImageWindow::AllWindows();
   for ( size_type i = 0; i < windows.Length(); ++i )
   {
      View v = windows[i].MainView();
      ImageVariant img = v.Image();
      if ( i > 0 )
         images += ',';
      images += "{\"id\":\"" + v.Id() + "\","
                 "\"width\":" + String( img.Width() ) + ","
                 "\"height\":" + String( img.Height() ) + ","
                 "\"channels\":" + String( img.NumberOfChannels() ) + ","
                 "\"isColor\":" + String( img.IsColor() ? "true" : "false" ) + "}";
   }
   images += "]";

   return "{\"status\":\"success\",\"outputs\":{\"images\":" + images + "},"
          "\"message\":\"Found " + String( windows.Length() ) + " open image(s)\"}";
}

// ----------------------------------------------------------------------------
// Minimal envelope-field extractor: finds  "key" : "value"  and returns value.
// Good enough for id/tool on the MVP. Replace with a real JSON parser for
// command parameters. TODO(json)
// ----------------------------------------------------------------------------
IsoString BridgePoller::ExtractStringField( const String& json, const IsoString& key )
{
   String needle = "\"" + String( key ) + "\"";
   size_type k = json.Find( needle );
   if ( k == String::notFound )
      return IsoString();

   size_type colon = json.Find( ':', k + needle.Length() );
   if ( colon == String::notFound )
      return IsoString();

   size_type q1 = json.Find( '"', colon + 1 );
   if ( q1 == String::notFound )
      return IsoString();
   size_type q2 = json.Find( '"', q1 + 1 );
   if ( q2 == String::notFound )
      return IsoString();

   return IsoString( json.Substring( q1 + 1, q2 - q1 - 1 ).ToUTF8() );
}

} // namespace pcl
