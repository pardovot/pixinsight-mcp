// ----------------------------------------------------------------------------
// PixInsight MCP Watcher module — ProcessInterface implementation.
// ----------------------------------------------------------------------------
#include "MCPWatcherInterface.h"
#include "MCPWatcherProcess.h"

#include <pcl/Console.h>

namespace pcl
{

MCPWatcherInterface* TheMCPWatcherInterface = nullptr;

// ----------------------------------------------------------------------------

MCPWatcherInterface::MCPWatcherInterface()
{
   TheMCPWatcherInterface = this;

   // Configure the periodic timer. It is NOT started until StartWatcher():
   // starting binds it to the event loop, where it fires during idle without
   // blocking the application.
   m_timer.SetInterval( m_intervalSec );
   m_timer.SetPeriodic( true );
   m_timer.OnTimer( (Timer::timer_event_handler)&MCPWatcherInterface::e_Timer, *this );
}

MCPWatcherInterface::~MCPWatcherInterface()
{
   if ( GUI != nullptr )
   {
      delete GUI;
      GUI = nullptr;
   }
}

IsoString MCPWatcherInterface::Id() const
{
   return "MCPWatcher";
}

MetaProcess* MCPWatcherInterface::Process() const
{
   return TheMCPWatcherProcess;
}

String MCPWatcherInterface::IconImageSVGFile() const
{
   return String(); // TODO(pcl): optional icon.
}

InterfaceFeatures MCPWatcherInterface::Features() const
{
   // No Apply/real-time; this is a control panel for the background poller.
   return InterfaceFeature::None;
}

// ----------------------------------------------------------------------------

void MCPWatcherInterface::StartWatcher()
{
   if ( m_timer.IsRunning() )
      return;

   if ( !m_poller.Initialize() )
   {
      Console().CriticalLn( "<end><cbr>[MCP Watcher] Failed to initialize bridge directories." );
      return;
   }

   m_timer.Start();
   Console().NoteLn( "<end><cbr>[MCP Watcher] Started (non-blocking). PixInsight stays usable." );
   UpdateStatus();
}

void MCPWatcherInterface::StopWatcher()
{
   if ( !m_timer.IsRunning() )
      return;

   m_timer.Stop();
   Console().NoteLn( "<end><cbr>[MCP Watcher] Stopped. Processed "
                     + String( m_poller.TotalProcessed() ) + " command(s)." );
   UpdateStatus();
}

// ----------------------------------------------------------------------------
// The heart of the module: one non-blocking poll per tick, on the main thread's
// event loop. Returns immediately, so PixInsight is never held.
// ----------------------------------------------------------------------------
void MCPWatcherInterface::e_Timer( Timer& sender )
{
   if ( &sender != &m_timer )
      return;

   int n = m_poller.ProcessPending( /*maxPerTick=*/10 );
   if ( n > 0 )
      UpdateStatus();

   // TODO(js-delegation): to reuse the existing JS handlers instead of the
   // native C++ dispatch, run the JS watcher's non-looping processPendingCommands()
   // here once per tick, via the core script-execution API.
}

// ----------------------------------------------------------------------------

void MCPWatcherInterface::e_Click( Button& sender, bool /*checked*/ )
{
   if ( GUI == nullptr )
      return;

   if ( sender == GUI->Start_Button )
      StartWatcher();
   else if ( sender == GUI->Stop_Button )
      StopWatcher();
}

// ----------------------------------------------------------------------------

void MCPWatcherInterface::UpdateStatus()
{
   if ( GUI == nullptr )
      return;

   GUI->Status_Label.SetText( m_timer.IsRunning() ? "Watcher: running (non-blocking)"
                                                  : "Watcher: stopped" );
   GUI->Count_Label.SetText( "Processed: " + String( m_poller.TotalProcessed() ) + " command(s)" );
   GUI->Start_Button.Enable( !m_timer.IsRunning() );
   GUI->Stop_Button.Enable( m_timer.IsRunning() );
}

// ----------------------------------------------------------------------------

MCPWatcherInterface::GUIData::GUIData( MCPWatcherInterface& w )
{
   Status_Label.SetText( "Watcher: stopped" );
   Count_Label.SetText( "Processed: 0 command(s)" );

   Start_Button.SetText( "Start" );
   Start_Button.OnClick( (Button::click_event_handler)&MCPWatcherInterface::e_Click, w );

   Stop_Button.SetText( "Stop" );
   Stop_Button.Disable();
   Stop_Button.OnClick( (Button::click_event_handler)&MCPWatcherInterface::e_Click, w );

   Buttons_Sizer.SetSpacing( 6 );
   Buttons_Sizer.Add( Start_Button );
   Buttons_Sizer.Add( Stop_Button );

   Global_Sizer.SetMargin( 8 );
   Global_Sizer.SetSpacing( 6 );
   Global_Sizer.Add( Status_Label );
   Global_Sizer.Add( Count_Label );
   Global_Sizer.AddSpacing( 4 );
   Global_Sizer.Add( Buttons_Sizer );

   w.SetSizer( Global_Sizer );
   w.AdjustToContents();
   w.SetFixedHeight();
}

// ----------------------------------------------------------------------------

bool MCPWatcherInterface::Launch( const MetaProcess& P, const ProcessImplementation*,
                                  bool& dynamic, unsigned& /*flags*/ )
{
   if ( GUI == nullptr )
   {
      GUI = new GUIData( *this );
      SetWindowTitle( "MCP Watcher" );
      UpdateStatus();
   }
   dynamic = false;
   return &P == TheMCPWatcherProcess;
}

} // namespace pcl
