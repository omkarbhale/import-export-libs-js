#!/bin/sh
# Stages the probes into %LOCALAPPDATA%\libsjs23-probe and runs one on Windows PowerShell 5.1.
# usage: run.sh <probe.ps1>   (from this folder, in WSL; oracle/native/14.0.7 must already be staged in 14.0.7\)
L=/mnt/c/Users/omkarb/AppData/Local/libsjs23-probe
cp *.ps1 "$L/"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\Users\\omkarb\\AppData\\Local\\libsjs23-probe\\$1"
