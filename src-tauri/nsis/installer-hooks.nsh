!macro NSIS_HOOK_POSTINSTALL
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.daiw\UserChoice"
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.daiw" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.daiw" "Content Type" "application/x-daiwari-project"
  WriteRegStr SHELL_CONTEXT "Software\Classes\.daiw" "PerceivedType" "document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\.daiw\DefaultIcon" "" "$\"$INSTDIR\resources\daidori-project.ico$\",0"
  ${If} $0 != ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\$0" "FriendlyTypeName" "Daiwari project file"
    WriteRegStr SHELL_CONTEXT "Software\Classes\$0\DefaultIcon" "" "$\"$INSTDIR\resources\daidori-project.ico$\",0"
  ${EndIf}
  !insertmacro UPDATEFILEASSOC
!macroend
