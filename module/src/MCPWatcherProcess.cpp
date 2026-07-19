// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module — MetaProcess implementation.
// ----------------------------------------------------------------------------
#include "MCPWatcherProcess.h"
#include "MCPWatcherInterface.h"

#include <pcl/ProcessImplementation.h>

namespace pcl
{

MCPWatcherProcess* TheMCPWatcherProcess = nullptr;

// A do-nothing process implementation. The watcher's behaviour lives entirely
// on the interface's background timer, so global execution simply reports that
// the poller state is controlled from the interface.
class MCPWatcherInstance : public ProcessImplementation
{
public:

   MCPWatcherInstance( const MetaProcess* m ) : ProcessImplementation( m ) {}
   MCPWatcherInstance( const MCPWatcherInstance& x ) : ProcessImplementation( x ) {}

   void Assign( const ProcessImplementation& ) override {}

   bool CanExecuteGlobal( String& whyNot ) const override
   {
      whyNot.Clear();
      return true;
   }

   bool ExecuteGlobal() override
   {
      // No-op: use the MCP Watcher interface (Start/Stop) to control polling.
      return true;
   }
};

// ----------------------------------------------------------------------------

MCPWatcherProcess::MCPWatcherProcess()
{
   TheMCPWatcherProcess = this;
}

IsoString MCPWatcherProcess::Id() const
{
   return "MCPWatcher";
}

IsoString MCPWatcherProcess::Category() const
{
   return "Utilities";
}

uint32 MCPWatcherProcess::Version() const
{
   return 0x100;
}

String MCPWatcherProcess::Description() const
{
   return "Non-blocking MCP bridge watcher. Polls ~/.pixinsight-mcp/bridge and "
          "executes commands from AI assistants while PixInsight stays usable.";
}

String MCPWatcherProcess::IconImageSVGFile() const
{
   return String(); // TODO(pcl): supply an SVG icon resource if desired.
}

ProcessInterface* MCPWatcherProcess::DefaultInterface() const
{
   return TheMCPWatcherInterface;
}

ProcessImplementation* MCPWatcherProcess::Create() const
{
   return new MCPWatcherInstance( this );
}

ProcessImplementation* MCPWatcherProcess::Clone( const ProcessImplementation& p ) const
{
   const MCPWatcherInstance* i = dynamic_cast<const MCPWatcherInstance*>( &p );
   return (i != nullptr) ? new MCPWatcherInstance( *i ) : nullptr;
}

bool MCPWatcherProcess::IsAssignable() const
{
   return false;
}

bool MCPWatcherProcess::NeedsValidation() const
{
   return false;
}

bool MCPWatcherProcess::CanProcessGlobal() const
{
   return true;
}

} // namespace pcl
