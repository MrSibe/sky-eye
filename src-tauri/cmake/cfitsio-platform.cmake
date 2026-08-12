# Toolchain files run before the compiler is identified, so MSVC is not set
# yet. Keep this a no-op on Unix even if Cargo exports the toolchain globally.
if(WIN32)
  set(USE_PTHREADS OFF CACHE BOOL "Use POSIX pthreads" FORCE)
  # The bundled legacy CFITSIO CMake project always compiles its optional
  # Fortran wrappers. Select its documented Visual C++ ABI so those otherwise
  # unused objects compile under MSVC.
  set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} /DPowerStationFortran" CACHE STRING "C flags" FORCE)
endif()
