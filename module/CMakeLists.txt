# ============================================================================
# PixInsight MCP Watcher module — CMake build (Windows / MSVC).
#
# Flags mirror PixInsight's own PCL.vcxproj (C++20, /MD, AVX2+FMA,
# __PCL_WINDOWS ...). Links the static PCL library (PCL-pxi.lib), which you
# build once from the bundled PCL source — see build-pcl.bat.
#
# Paths come from environment variables (set by build.bat), with sensible
# defaults for a standard PixInsight install:
#   PCLINCDIR  -> <PixInsight>/include            (contains pcl/*.h)
#   PCLLIBDIR  -> directory containing PCL-pxi.lib (from build-pcl.bat)
# ============================================================================
cmake_minimum_required(VERSION 3.20)
project(MCPWatcher CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT MSVC)
  message(FATAL_ERROR "PixInsight modules on Windows require MSVC (not MinGW/GCC).")
endif()

# --- locate PCL SDK ---------------------------------------------------------
set(PI_ROOT "C:/Program Files/PixInsight")
set(PCLINCDIR "$ENV{PCLINCDIR}")
if(PCLINCDIR STREQUAL "")
  set(PCLINCDIR "${PI_ROOT}/include")
endif()
set(PCLLIBDIR "$ENV{PCLLIBDIR}")
if(PCLLIBDIR STREQUAL "")
  set(PCLLIBDIR "${PI_ROOT}/lib/x64")   # place PCL-pxi.lib here (build-pcl.bat)
endif()

find_library(PCL_LIB NAMES PCL-pxi PATHS "${PCLLIBDIR}" NO_DEFAULT_PATH)
if(NOT PCL_LIB)
  message(WARNING "PCL-pxi.lib not found in ${PCLLIBDIR}. "
                  "Build it first with build-pcl.bat, then reconfigure.")
endif()

# --- the module -------------------------------------------------------------
file(GLOB MCP_SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp")

add_library(MCPWatcher SHARED ${MCP_SOURCES})

target_include_directories(MCPWatcher PRIVATE "${PCLINCDIR}")

# Preprocessor defines copied from PCL.vcxproj (Release).
target_compile_definitions(MCPWatcher PRIVATE
  WIN32 WIN64 _WINDOWS UNICODE
  __PCL_WINDOWS __PCL_NO_WIN32_MINIMUM_VERSIONS
  __PCL_AVX2 __PCL_FMA _NDEBUG)

# /MD (MultiThreadedDLL), AVX2 codegen, exceptions, big object files.
set_property(TARGET MCPWatcher PROPERTY
  MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")
target_compile_options(MCPWatcher PRIVATE /arch:AVX2 /EHsc /bigobj /W3)

if(PCL_LIB)
  target_link_libraries(MCPWatcher PRIVATE "${PCL_LIB}")
endif()

# Windows system libs PCL depends on (add more here if the linker reports
# further unresolved __imp_* symbols):
#   userenv  -> GetUserProfileDirectoryW (File::HomeDirectory)
target_link_libraries(MCPWatcher PRIVATE userenv)

# PixInsight modules are DLLs named "<Id>-pxm.dll" with no lib prefix.
set_target_properties(MCPWatcher PROPERTIES
  PREFIX ""
  OUTPUT_NAME "MCPWatcher-pxm"
  SUFFIX ".dll")

# NOTE: additional link libraries may surface at first link (host/Qt-backed
# symbols). Resolve them by adding the corresponding *.lib here as they appear;
# see module/README.md.
