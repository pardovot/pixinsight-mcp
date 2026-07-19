@echo off
REM ==========================================================================
REM  One-time build of the PCL static library (PCL-pxi.lib) from the PCL
REM  source bundled with PixInsight. Output goes to a writable directory
REM  (%PCL_BUILD_OUT%), since C:\Program Files is read-only.
REM
REM  NOTE: uses goto-based checks (not inline "( ... )" blocks) because the
REM  MSVC path contains "(x86)" whose ")" breaks parenthesized batch blocks.
REM ==========================================================================
setlocal

set "PI_ROOT=C:\Program Files\PixInsight"
set "VS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
set "MSBUILD=%VS%\MSBuild\Current\Bin\MSBuild.exe"
set "PCL_VCXPROJ=%PI_ROOT%\src\pcl\windows\vc17\PCL.vcxproj"

if "%PCL_BUILD_OUT%"=="" set "PCL_BUILD_OUT=%USERPROFILE%\pcl-build"
set "OUTDIR=%PCL_BUILD_OUT%\lib"
set "INTDIR=%PCL_BUILD_OUT%\obj"

REM PCL.vcxproj references these env vars for its include paths (and PCL's
REM standard build convention). Without them the compiler can't find pcl/*.h.
set "PCLDIR=%PI_ROOT%"
set "PCLINCDIR=%PI_ROOT%\include"
set "PCLSRCDIR=%PI_ROOT%\src"
set "PCLLIBDIR=%OUTDIR%"
set "PCLLIBDIR64=%OUTDIR%"
set "PCLBINDIR=%PI_ROOT%\bin"
set "PCLBINDIR64=%PI_ROOT%\bin"

if not exist "%MSBUILD%" goto :no_msbuild
if not exist "%PCL_VCXPROJ%" goto :no_vcxproj

mkdir "%OUTDIR%" 2>nul
mkdir "%INTDIR%" 2>nul

echo Building PCL-pxi.lib (Release^|x64) ...
echo   project : "%PCL_VCXPROJ%"
echo   output  : "%OUTDIR%\PCL-pxi.lib"
echo.

REM Doubled trailing backslash (\\") so MSBuild doesn't read \" as an escaped
REM quote and merge the OutDir/IntDir arguments.
"%MSBUILD%" "%PCL_VCXPROJ%" /p:Configuration=Release /p:Platform=x64 /p:OutDir="%OUTDIR%\\" /p:IntDir="%INTDIR%\\" /m /verbosity:minimal
if errorlevel 1 goto :build_failed

echo.
if exist "%OUTDIR%\PCL-pxi.lib" goto :ok
echo [WARN] Build reported success but PCL-pxi.lib not found in "%OUTDIR%".
echo Check the MSBuild output above for the actual lib location.
goto :end

:ok
echo [OK] PCL-pxi.lib -^> "%OUTDIR%\PCL-pxi.lib"
echo When building the module, set:  set "PCLLIBDIR=%OUTDIR%"
goto :end

:no_msbuild
echo [ERROR] MSBuild not found:
echo   "%MSBUILD%"
goto :fail

:no_vcxproj
echo [ERROR] PCL.vcxproj not found:
echo   "%PCL_VCXPROJ%"
goto :fail

:build_failed
echo.
echo [ERROR] PCL build failed. See MSBuild output above.
goto :fail

:fail
endlocal
exit /b 1

:end
endlocal
