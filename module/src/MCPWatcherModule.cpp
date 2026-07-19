// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module — module metadata + install entry point.
// ----------------------------------------------------------------------------
#include "MCPWatcherModule.h"
#include "MCPWatcherProcess.h"
#include "MCPWatcherInterface.h"

namespace pcl
{

MCPWatcherModule::MCPWatcherModule()
{
}

const char* MCPWatcherModule::Version() const
{
   return "1.0.0";
}

IsoString MCPWatcherModule::Name() const
{
   return "MCPWatcher";
}

String MCPWatcherModule::Description() const
{
   return "PixInsight MCP Watcher — non-blocking bridge for AI assistants (MCP).";
}

String MCPWatcherModule::Company() const
{
   return String();
}

String MCPWatcherModule::Author() const
{
   return "Alain Escaffre (original project); native module by pardovot";
}

String MCPWatcherModule::Copyright() const
{
   return "Copyright (c) 2026. MIT License.";
}

String MCPWatcherModule::TradeMarks() const
{
   return "MCP";
}

String MCPWatcherModule::OriginalFileName() const
{
#ifdef __PCL_WINDOWS
   return "MCPWatcher-pxm.dll";
#endif
#ifdef __PCL_LINUX
   return "MCPWatcher-pxm.so";
#endif
#ifdef __PCL_FREEBSD
   return "MCPWatcher-pxm.so";
#endif
#ifdef __PCL_MACOSX
   return "MCPWatcher-pxm.dylib";
#endif
}

void MCPWatcherModule::GetReleaseDate( int& year, int& month, int& day ) const
{
   year  = 2026;
   month = 7;
   day   = 19;
}

} // namespace pcl

// ----------------------------------------------------------------------------
// Module installation entry point. PixInsight calls this when the module is
// loaded. On Install mode we also instantiate the process and its interface;
// both self-register with the platform via their base-class constructors.
// ----------------------------------------------------------------------------
PCL_MODULE_EXPORT int InstallPixInsightModule( int mode )
{
   new pcl::MCPWatcherModule;

   if ( mode == pcl::InstallMode::Install )
   {
      new pcl::MCPWatcherProcess;
      new pcl::MCPWatcherInterface;
   }

   return 0;
}
