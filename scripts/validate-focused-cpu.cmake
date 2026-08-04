if(NOT DEFINED GEODESIC_SOURCE_ROOT)
  message(FATAL_ERROR "GEODESIC_SOURCE_ROOT is required")
endif()

string(CONCAT forbidden_backend "cu" "da")
string(CONCAT forbidden_device "g" "pu")
string(CONCAT forbidden_flag "--g" "pu")
string(CONCAT forbidden_field "\"g" "pu\"")
string(CONCAT forbidden_claim "g" "pu ")
string(CONCAT forbidden_vendor "nvi" "dia")
string(CONCAT forbidden_sparse "cu" "sparse")
string(CONCAT forbidden_blas "cu" "blas")
set(forbidden_terms
  "${forbidden_backend}"
  "${forbidden_device}"
  "${forbidden_flag}"
  "${forbidden_field}"
  "${forbidden_claim}"
  "${forbidden_vendor}"
  "${forbidden_sparse}"
  "${forbidden_blas}")

execute_process(
  COMMAND git -C "${GEODESIC_SOURCE_ROOT}" ls-files --cached --others --exclude-standard
  RESULT_VARIABLE list_result
  OUTPUT_VARIABLE candidate_output
  ERROR_VARIABLE list_error
  OUTPUT_STRIP_TRAILING_WHITESPACE)
if(NOT list_result EQUAL 0)
  message(FATAL_ERROR "Could not enumerate working-tree files: ${list_error}")
endif()
string(REPLACE "\n" ";" candidate_files "${candidate_output}")

set(violations "")
foreach(relative_path IN LISTS candidate_files)
  set(path "${GEODESIC_SOURCE_ROOT}/${relative_path}")
  if(NOT EXISTS "${path}" OR relative_path MATCHES "(^|/)package-lock\\.json$")
    continue()
  endif()
  if(NOT path MATCHES "(CMakeLists\\.txt|\\.cmake|\\.cpp|\\.hpp|\\.ts|\\.css|\\.html|\\.md|\\.json|\\.mjs|\\.sh|\\.ya?ml|\\.gitignore|\\.clang-format)$")
    continue()
  endif()
  file(READ "${path}" content)
  string(TOLOWER "${content}" lower_content)
  foreach(term IN LISTS forbidden_terms)
    string(FIND "${lower_content}" "${term}" offset)
    if(NOT offset EQUAL -1)
      list(APPEND violations "${relative_path}: forbidden accelerator term '${term}'")
    endif()
  endforeach()
endforeach()

if(violations)
  list(JOIN violations "\n  " details)
  message(FATAL_ERROR "Focused CPU source guard failed:\n  ${details}")
endif()

message(STATUS "Focused CPU source guard passed")
