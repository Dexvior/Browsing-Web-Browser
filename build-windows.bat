@echo off
title Browsing - Build Installer
call npm install
call npm run dist
echo.
echo Done. Your installer is in the "dist" folder.
pause
