// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module — MetaProcess.
//
// Minimal process: it exists so the module has a launchable entry in the
// Process Explorer and a home for the MCPWatcherInterface. It does not process
// images itself — all work happens on the interface's background timer.
// ----------------------------------------------------------------------------
#ifndef __MCPWatcherProcess_h
#define __MCPWatcherProcess_h

#include <pcl/MetaProcess.h>

namespace pcl
{

class MCPWatcherProcess : public MetaProcess
{
public:

   MCPWatcherProcess();

   IsoString Id() const override;
   IsoString Category() const override;
   uint32    Version() const override;
   String    Description() const override;
   String    IconImageSVGFile() const override;

   ProcessInterface* DefaultInterface() const override;

   ProcessImplementation* Create() const override;
   ProcessImplementation* Clone( const ProcessImplementation& ) const override;

   bool IsAssignable() const override;      // not assignable to views
   bool NeedsValidation() const override;
   bool CanProcessGlobal() const override;  // it's a global/utility process
};

extern MCPWatcherProcess* TheMCPWatcherProcess;

} // namespace pcl

#endif // __MCPWatcherProcess_h
