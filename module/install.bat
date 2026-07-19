@echo off
REM ==========================================================================
REM  Copy the built module into PixInsight's bin directory.
REM  Run as Administrator (Program Files is protected). Close PixInsight first
REM  so the old DLL isn't locked.
REM ==========================================================================
setlocal
set "PI_BIN=C:\Program Files\PixInsight\bin"
set "DLL=%~dp0build\MCPWatcher-pxm.dll"

if not exist "%DLL%" goto :no_dll

echo Copying module to PixInsight bin...
copy /Y "%DLL%" "%PI_BIN%\" >nul
if errorlevel 1 goto :copy_failed

echo [OK] Installed: "%PI_BIN%\MCPWatcher-pxm.dll"
echo Start PixInsight; it auto-loads *-pxm.dll from bin, or use
echo   Process ^> Modules ^> Install Modules to register it.
goto :end

:no_dll
echo [ERROR] Not built yet: "%DLL%"  (run build.bat first)
goto :fail
:copy_failed
echo [ERROR] Copy failed. Run this as Administrator and close PixInsight first.
goto :fail

:fail
endlocal
exit /b 1
:end
endlocal
