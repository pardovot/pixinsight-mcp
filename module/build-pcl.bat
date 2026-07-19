@echo off
REM ==========================================================================
REM  One-time build of the PCL static library (PCL-pxi.lib) from the PCL
REM  source bundled with PixInsight. Output goes to a writable directory
REM  (%PCL_BUILD_OUT%), since C:\Program Files is read-only.
REM
REM  Run once. After it succeeds, build.bat links against the produced lib.
REM ==========================================================================
setlocal

set "PI_ROOT=C:\Program Files\PixInsight"
set "VS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
set "MSBUILD=%VS%\MSBuild\Current\Bin\MSBuild.exe"
set "PCL_VCXPROJ=%PI_ROOT%\src\pcl\windows\vc17\PCL.vcxproj"

REM Writable build output (override by setting PCL_BUILD_OUT before running).
if "%PCL_BUILD_OUT%"=="" set "PCL_BUILD_OUT=%USERPROFILE%\pcl-build"
set "OUTDIR=%PCL_BUILD_OUT%\lib"
set "INTDIR=%PCL_BUILD_OUT%\obj"

if not exist "%MSBUILD%"     ( echo [ERROR] MSBuild not found: %MSBUILD% & exit /b 1 )
if not exist "%PCL_VCXPROJ%" ( echo [ERROR] PCL.vcxproj not found: %PCL_VCXPROJ% & exit /b 1 )

mkdir "%OUTDIR%" 2>nul
mkdir "%INTDIR%" 2>nul

echo Building PCL-pxi.lib (Release^|x64) ...
echo   project : %PCL_VCXPROJ%
echo   output  : %OUTDIR%\PCL-pxi.lib
echo.

"%MSBUILD%" "%PCL_VCXPROJ%" ^
  /p:Configuration=Release /p:Platform=x64 ^
  /p:OutDir="%OUTDIR%\" /p:IntDir="%INTDIR%\" ^
  /m /verbosity:minimal

if errorlevel 1 ( echo. & echo [ERROR] PCL build failed. & exit /b 1 )

echo.
if exist "%OUTDIR%\PCL-pxi.lib" (
  echo [OK] PCL-pxi.lib -> %OUTDIR%\PCL-pxi.lib
  echo Set PCLLIBDIR to this directory when building the module, e.g.:
  echo   set "PCLLIBDIR=%OUTDIR%"
) else (
  echo [WARN] Build reported success but PCL-pxi.lib not found in %OUTDIR%.
  echo Check the MSBuild output above for the actual lib location.
)
endlocal
