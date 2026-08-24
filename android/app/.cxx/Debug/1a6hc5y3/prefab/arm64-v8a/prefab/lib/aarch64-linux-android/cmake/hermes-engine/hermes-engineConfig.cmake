if(NOT TARGET hermes-engine::libhermes)
add_library(hermes-engine::libhermes SHARED IMPORTED)
set_target_properties(hermes-engine::libhermes PROPERTIES
    IMPORTED_LOCATION "C:/Users/phili/.gradle/caches/8.14.3/transforms/9f8bf174426a62033c5396f3e1842ab7/transformed/hermes-android-0.81.5-debug/prefab/modules/libhermes/libs/android.arm64-v8a/libhermes.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/phili/.gradle/caches/8.14.3/transforms/9f8bf174426a62033c5396f3e1842ab7/transformed/hermes-android-0.81.5-debug/prefab/modules/libhermes/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

