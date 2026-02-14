@echo off
REM Simple script to upload to GitHub (run this AFTER installing Git and creating repo)

setlocal enabledelayedexpansion

echo.
echo ===================================
echo  Batch Relay dApp - GitHub Upload
echo ===================================
echo.

REM Check if .git exists
if exist .git (
    echo ✓ Repository already initialized
) else (
    echo ✓ Initializing Git repository...
    call git init
    echo.
)

REM Configure git (optional - skip if already done)
echo What's your GitHub username?
set /p USERNAME="Enter your GitHub username: "

if "!USERNAME!"=="" (
    echo Error: Username required
    exit /b 1
)

REM Add all files except those in .gitignore
echo.
echo ✓ Staging files...
call git add .

REM Create commit
echo.
echo ✓ Creating commit...
call git commit -m "Initial commit: Batch relay dApp with deployed contracts to Sepolia"

REM Add remote
echo.
echo ✓ Connecting to GitHub...
call git remote remove origin 2>nul
call git remote add origin https://github.com/!USERNAME!/batch-relay-dapp.git

REM Rename main branch
call git branch -M main

REM Push to GitHub
echo.
echo ✓ Pushing code to GitHub...
call git push -u origin main

if !ERRORLEVEL! equ 0 (
    echo.
    echo ===================================
    echo ✓ Upload successful!
    echo Repository: https://github.com/!USERNAME!/batch-relay-dapp
    echo ===================================
) else (
    echo.
    echo Error: Push failed. Check your GitHub credentials and internet connection.
)

pause
