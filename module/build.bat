@echo off
REM ==========================================================================
REM  Build the MCP Watcher PixInsight module (MCPWatcher-pxm.dll).
REM
REM  Prereqs: VS 2022 BuildTools (MSVC) + bundled CMake/Ninja, and PCL-pxi.lib
REM  built once via build-pcl.bat.
REM
REM  NOTE: uses goto-based checks (not inline "( ... )" blocks) because the
REM  MSVC path contains "(x86)" whose ")" breaks parenthesized batch blocks.
REM ==========================================================================
setlocal

set "PI_ROOT=C:\Program Files\PixInsight"
set "VS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
set "VCVARS=%VS%\VC\Auxiliary\Build\vcvars64.bat"
set "CMAKE=%VS%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
set "NINJA_DIR=%VS%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja"

if "%PCLINCDIR%"=="" set "PCLINCDIR=%PI_ROOT%\include"
if "%PCLLIBDIR%"=="" set "PCLLIBDIR=%USERPROFILE%\pcl-build\lib"

if not exist "%VCVARS%" goto :no_vcvars
if not exist "%CMAKE%" goto :no_cmake
if not exist "%PCLLIBDIR%\PCL-pxi.lib" echo [WARN] PCL-pxi.lib not found in "%PCLLIBDIR%" - run build-pcl.bat first.

echo Activating MSVC x64 environment...
call "%VCVARS%" >nul
if errorlevel 1 goto :no_env

set "PATH=%NINJA_DIR%;%PATH%"
set "SRC=%~dp0"
set "BUILD=%SRC%build"

echo Configuring (Ninja) ...
echo   PCLINCDIR="%PCLINCDIR%"
echo   PCLLIBDIR="%PCLLIBDIR%"
"%CMAKE%" -S "%SRC%." -B "%BUILD%" -G Ninja -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 goto :cfg_failed

echo Building ...
"%CMAKE%" --build "%BUILD%" --config Release
if errorlevel 1 goto :build_failed

echo.
if exist "%BUILD%\MCPWatcher-pxm.dll" goto :ok
echo [WARN] Build finished but MCPWatcher-pxm.dll not found in "%BUILD%".
goto :end

:ok
echo [OK] Module -^> "%BUILD%\MCPWatcher-pxm.dll"
echo Install: copy to "%PI_ROOT%\bin\" (admin), or
echo   PixInsight ^> Process ^> Modules ^> Install Modules ^> select the dll.
goto :end

:no_vcvars
echo [ERROR] vcvars64 not found: "%VCVARS%"
goto :fail
:no_cmake
echo [ERROR] CMake not found: "%CMAKE%"
goto :fail
:no_env
echo [ERROR] vcvars64 failed.
goto :fail
:cfg_failed
echo [ERROR] CMake configure failed.
goto :fail
:build_failed
echo [ERROR] Build failed. Paste the errors to resolve missing libs.
goto :fail

:fail
endlocal
exit /b 1
:end
endlocal
