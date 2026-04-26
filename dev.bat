@echo off
cd /d "%~dp0"

if not exist "node_modules\.bin\tauri.cmd" (
    echo [dev.bat] node_modules が見つかりません。npm install を実行します...
    call npm install
    if errorlevel 1 (
        echo [dev.bat] npm install に失敗しました。
        pause
        exit /b 1
    )
)

call npm run tauri dev
pause
