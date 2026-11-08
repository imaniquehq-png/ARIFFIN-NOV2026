@echo off
setlocal DisableDelayedExpansion
title Ariffin Jewels - Pelayan Tempatan
pushd "%~dp0" || exit /b 1
set "AJ_NODE_BIN=node.exe"
call :checknode
if not errorlevel 1 goto run
set "AJ_NODE_BIN=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%AJ_NODE_BIN%" call :checknode
if exist "%AJ_NODE_BIN%" if not errorlevel 1 goto run
echo Pasang Node.js versi 22.13 atau lebih baharu yang menyokong node:sqlite, kemudian buka MULA.cmd lagi.
pause
popd
exit /b 1

:checknode
"%AJ_NODE_BIN%" -e "const [a,b]=process.versions.node.split('.').map(Number); require('node:sqlite'); process.exit(a>22||(a===22&&b>=13)?0:1)" >nul 2>nul
exit /b %errorlevel%

:run
if /i "%~1"=="--no-browser" goto headless
"%AJ_NODE_BIN%" launcher.mjs
goto finished
:headless
"%AJ_NODE_BIN%" launcher.mjs --no-browser
:finished
set "AJ_LAUNCH_RESULT=%errorlevel%"
if not "%AJ_LAUNCH_RESULT%"=="0" pause
popd
exit /b %AJ_LAUNCH_RESULT%
