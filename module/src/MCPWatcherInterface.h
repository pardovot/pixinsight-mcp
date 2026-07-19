// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module — ProcessInterface.
//
// THE point of the module: it owns a pcl::Timer that fires on PixInsight's own
// event loop during idle. Because this is a compiled interface (not a running
// script), PixInsight is never "busy" — it stays fully interactive while the
// timer polls the bridge. This is what lets you review Claude's work at any
// time, in the same instance, with no stop/resume.
// ----------------------------------------------------------------------------
#ifndef __MCPWatcherInterface_h
#define __MCPWatcherInterface_h

#include <pcl/ProcessInterface.h>
#include <pcl/Timer.h>
#include <pcl/AutoPointer.h>
#include <pcl/Sizer.h>
#include <pcl/Label.h>
#include <pcl/PushButton.h>

#include "BridgePoller.h"

namespace pcl
{

class MCPWatcherInterface : public ProcessInterface
{
public:

   MCPWatcherInterface();
   virtual ~MCPWatcherInterface();

   IsoString Id() const override;
   MetaProcess* Process() const override;
   String IconImageSVGFile() const override;
   InterfaceFeatures Features() const override;

   bool Launch( const MetaProcess&, const ProcessImplementation*,
                bool& dynamic, unsigned& flags ) override;

   // Start/stop polling programmatically (also wired to the UI buttons).
   void StartWatcher();
   void StopWatcher();
   bool IsRunning() const { return !m_timer.IsNull() && m_timer->IsRunning(); }

private:

   BridgePoller        m_poller;
   // Lazily allocated: a Qt-backed Timer must NOT be constructed at module
   // install time (crashes InitializePixInsightModule). Created on first Start.
   AutoPointer<Timer>  m_timer;
   double              m_intervalSec = 0.3;  // 300 ms poll cadence

   void EnsureTimer();

   struct GUIData
   {
      GUIData( MCPWatcherInterface& );

      VerticalSizer Global_Sizer;
         Label      Status_Label;
         Label      Count_Label;
         HorizontalSizer Buttons_Sizer;
            PushButton Start_Button;
            PushButton Stop_Button;
   };

   GUIData* GUI = nullptr;

   void UpdateStatus();

   // Event handlers.
   void e_Timer( Timer& sender );
   void e_Click( Button& sender, bool checked );

   friend struct GUIData;
};

extern MCPWatcherInterface* TheMCPWatcherInterface;

} // namespace pcl

#endif // __MCPWatcherInterface_h
