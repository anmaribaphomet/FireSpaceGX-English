
@echo off
title Start FireSpace

echo ==================================
echo       STARTING FIRESPACE
echo ==================================

echo.
echo [1/2] Starting Flask server...

start "FireSpace - Flask" /D "%~dp0" cmd /k "python app.py"

echo Waiting for Flask to start...
timeout /t 3 /nobreak >nul

echo.
echo [2/2] Starting Cloudflare Tunnel...

start "FireSpace - Cloudflare" /D "%~dp0" cmd /k ""C:\Users\hectr\Downloads\cloudflared-windows-amd64.exe" tunnel --url http://localhost:5000"

echo.
echo FireSpace is starting.
echo Check the Cloudflare window to get your public URL.
echo.
pause