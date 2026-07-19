@echo off
REM ==========================================================================
REM  Build the MCP Watcher PixInsight module (MCPWatcher-pxm.dll).
REM
REM  Prereqs:
REM    - VS 2022 BuildTools (MSVC)              [detected on this machine]
REM    - CMake + Ninja bundled with BuildTools  [detected]
REM    - PCL-pxi.lib built once via build-pcl.bat
REM
REM  Sets up the MSVC environment (vcvars64), points CMake at the PCL SDK,
REM  and builds into module\build\.
REM ==========================================================================
setlocal

set "PI_ROOT=C:\Program Files\PixInsight"
set "VS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
set "VCVARS=%VS%\VC\Auxiliary\Build\vcvars64.bat"
set "CMAKE=%VS%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
set "NINJA_DIR=%VS%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja"

REM --- PCL SDK locations (override by setting these before running) ---
if "%PCLINCDIR%"=="" set "PCLINCDIR=%PI_ROOT%\include"
if "%PCLLIBDIR%"=="" set "PCLLIBDIR=%USERPROFILE%\pcl-build\lib"

if not exist "%VCVARS%" ( echo [ERROR] vcvars64 not found: %VCVARS% & exit /b 1 )
if not exist "%CMAKE%"  ( echo [ERROR] CMake not found: %CMAKE% & exit /b 1 )
if not exist "%PCLLIBDIR%\PCL-pxi.lib" (
  echo [WARN] PCL-pxi.lib not found in %PCLLIBDIR%.
  echo        Run build-pcl.bat first ^(one-time^), or set PCLLIBDIR.
)

echo Activating MSVC x64 environment...
call "%VCVARS%" >nul || ( echo [ERROR] vcvars64 failed & exit /b 1 )

set "PATH=%NINJA_DIR%;%PATH%"

set "SRC=%~dp0"
set "BUILD=%SRC%build"

echo Configuring (Ninja, PCLINCDIR=%PCLINCDIR%, PCLLIBDIR=%PCLLIBDIR%) ...
"%CMAKE%" -S "%SRC%." -B "%BUILD%" -G Ninja -DCMAKE_BUILD_TYPE=Release ^
  || ( echo [ERROR] CMake configure failed & exit /b 1 )

echo Building ...
"%CMAKE%" --build "%BUILD%" --config Release ^
  || ( echo [ERROR] Build failed & exit /b 1 )

echo.
if exist "%BUILD%\MCPWatcher-pxm.dll" (
  echo [OK] Module -> %BUILD%\MCPWatcher-pxm.dll
  echo Install: copy to "%PI_ROOT%\bin\" ^(admin^), or
  echo   PixInsight ^> Process ^> Modules ^> Install Modules ^> select the dll.
) else (
  echo [WARN] Build finished but MCPWatcher-pxm.dll not found in %BUILD%.
)
endlocal
