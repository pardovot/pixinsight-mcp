# ============================================================================
# PixInsight MCP Watcher module — CMake build (cross-platform).
#
# Windows/MSVC flags mirror PixInsight's own PCL.vcxproj (C++20, /MD,
# AVX2+FMA, __PCL_WINDOWS ...); the macOS/Linux/FreeBSD branches are written
# from PixInsight's bundled PCL g++ makefiles. Links the static PCL library,
# built once from the bundled PCL source — see module/build-pcl.mjs.
#
# Verified on: Windows (MSVC). The other branches are written but not yet
# verified on their platforms (unverified ≠ unsupported).
#
# Paths come from environment variables (set by module/build.mjs), with
# per-platform defaults for a standard PixInsight install:
#   PCLINCDIR  -> <PixInsight>/include              (contains pcl/*.h)
#   PCLLIBDIR  -> directory containing the PCL static lib (from build-pcl.mjs)
# ============================================================================
cmake_minimum_required(VERSION 3.20)
project(MCPWatcher CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(WIN32 AND NOT MSVC)
  message(FATAL_ERROR "PixInsight modules on Windows require MSVC (not MinGW/GCC).")
endif()

# --- locate PCL SDK ---------------------------------------------------------
# Fallbacks only — module/build.mjs sets PCLINCDIR/PCLLIBDIR from the resolved
# PixInsight install (see module/config.mjs).
if(WIN32)
  set(PI_ROOT "C:/Program Files/PixInsight")
elseif(APPLE)
  set(PI_ROOT "/Applications/PixInsight")
else()
  set(PI_ROOT "/opt/PixInsight")
endif()
set(PCLINCDIR "$ENV{PCLINCDIR}")
if(PCLINCDIR STREQUAL "")
  set(PCLINCDIR "${PI_ROOT}/include")
endif()
set(PCLLIBDIR "$ENV{PCLLIBDIR}")
if(PCLLIBDIR STREQUAL "")
  set(PCLLIBDIR "${PI_ROOT}/lib/x64")   # place the PCL static lib here (build-pcl.mjs)
endif()

find_library(PCL_LIB NAMES PCL-pxi PATHS "${PCLLIBDIR}" NO_DEFAULT_PATH)
if(NOT PCL_LIB)
  message(WARNING "PCL static library not found in ${PCLLIBDIR}. "
                  "Build it first with module/build-pcl.mjs, then reconfigure.")
endif()

# --- the module -------------------------------------------------------------
file(GLOB MCP_SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp")

add_library(MCPWatcher SHARED ${MCP_SOURCES})

target_include_directories(MCPWatcher PRIVATE "${PCLINCDIR}")

if(MSVC)
  # Preprocessor defines copied from PCL.vcxproj (Release).
  target_compile_definitions(MCPWatcher PRIVATE
    WIN32 WIN64 _WINDOWS UNICODE
    __PCL_WINDOWS __PCL_NO_WIN32_MINIMUM_VERSIONS
    __PCL_AVX2 __PCL_FMA _NDEBUG)

  # /MD (MultiThreadedDLL), AVX2 codegen, exceptions, big object files.
  set_property(TARGET MCPWatcher PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")
  target_compile_options(MCPWatcher PRIVATE /arch:AVX2 /EHsc /bigobj /W3)

  # Windows system libs PCL depends on (add more here if the linker reports
  # further unresolved __imp_* symbols):
  #   userenv  -> GetUserProfileDirectoryW (File::HomeDirectory)
  target_link_libraries(MCPWatcher PRIVATE userenv)
else()
  # macOS / Linux / FreeBSD — per PCL's bundled g++ makefiles
  # (src/pcl/{macosx,linux,freebsd}/g++). UNVERIFIED on real installs.
  if(APPLE)
    target_compile_definitions(MCPWatcher PRIVATE __PCL_MACOSX _NDEBUG)
  elseif(CMAKE_SYSTEM_NAME STREQUAL "FreeBSD")
    target_compile_definitions(MCPWatcher PRIVATE __PCL_FREEBSD _NDEBUG)
  else()
    target_compile_definitions(MCPWatcher PRIVATE __PCL_LINUX _NDEBUG)
  endif()

  target_compile_options(MCPWatcher PRIVATE -O3 -fPIC -Wall)
  # AVX2/FMA is an x86-64 flag set; Apple Silicon / ARM builds must not use it.
  if(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64")
    target_compile_definitions(MCPWatcher PRIVATE __PCL_AVX2 __PCL_FMA)
    target_compile_options(MCPWatcher PRIVATE -mavx2 -mfma)
  endif()
endif()

if(PCL_LIB)
  target_link_libraries(MCPWatcher PRIVATE "${PCL_LIB}")
endif()

# PixInsight modules are "<Id>-pxm.<ext>" with no lib prefix.
set_target_properties(MCPWatcher PROPERTIES
  PREFIX ""
  OUTPUT_NAME "MCPWatcher-pxm")
if(WIN32)
  set_target_properties(MCPWatcher PROPERTIES SUFFIX ".dll")
elseif(APPLE)
  set_target_properties(MCPWatcher PROPERTIES SUFFIX ".dylib")
else()
  set_target_properties(MCPWatcher PROPERTIES SUFFIX ".so")
endif()

# NOTE: additional link libraries may surface at first link (host/Qt-backed
# symbols). Resolve them by adding the corresponding libs here as they appear;
# see module/README.md.
