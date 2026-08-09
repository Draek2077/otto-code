!macro customInstall
  WriteRegStr HKCU "Software\Classes\Directory\shell\Otto" "" "Open with Otto"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Otto\command" "" '"$INSTDIR\Otto.exe" --open-with-otto "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Otto" "" "Open with Otto"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Otto\command" "" '"$INSTDIR\Otto.exe" --open-with-otto "%V"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Otto"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Otto"
!macroend
