@echo off
cd /d "%~dp0"
node bin\cli.js serve --open
if errorlevel 1 pause
