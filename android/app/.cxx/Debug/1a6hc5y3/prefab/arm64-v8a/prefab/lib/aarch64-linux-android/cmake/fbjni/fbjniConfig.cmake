if(NOT TARGET fbjni::fbjni)
add_library(fbjni::fbjni SHARED IMPORTED)
set_target_properties(fbjni::fbjni PROPERTIES
    IMPORTED_LOCATION "C:/Users/phili/.gradle/caches/8.14.3/transforms/c4ed38aee617328a15ca67287b31027e/transformed/fbjni-0.7.0/prefab/modules/fbjni/libs/android.arm64-v8a/libfbjni.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/phili/.gradle/caches/8.14.3/transforms/c4ed38aee617328a15ca67287b31027e/transformed/fbjni-0.7.0/prefab/modules/fbjni/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

