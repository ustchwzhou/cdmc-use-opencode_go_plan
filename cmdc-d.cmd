@ECHO off
REM cmdc-d wrapper: temporarily set HOME and the Windows profile to the D-drive data root,
REM so every Command Code home-path lookup resolves to D:\WSL2Backup\cache_mv.
REM
REM Default: route models through the OpenCode Go subscription via
REM the cc-switch local proxy (http://127.0.0.1:15721). Use --command-code to
REM temporarily use the official Command Code provider. Wrapper flags are not passed to cmdc.

REM Capture script dir BEFORE any GOTO/labels (avoids dp0 resolution quirks).
SET "CMDC_D0=%~dp0"

SETLOCAL ENABLEDELAYEDEXPANSION
SET "ORIG_USERPROFILE=%USERPROFILE%"
SET "USERPROFILE=D:\WSL2Backup\cache_mv"
SET "HOME=D:\WSL2Backup\cache_mv"
SET "HOMEDRIVE=D:"
SET "HOMEPATH=\WSL2Backup\cache_mv"

SET "CMDC_USE_OPENCODE_GO=1"
SET "CMDC_ARGS="

:parse
IF "%~1"=="" GOTO run
IF /I "%~1"=="--opencode-go" (
    SET "CMDC_USE_OPENCODE_GO=1"
) ELSE IF /I "%~1"=="--command-code" (
    SET "CMDC_USE_OPENCODE_GO=0"
) ELSE (
    SET CMDC_ARGS=!CMDC_ARGS! "%~1"
)
SHIFT
GOTO parse

:run
"%SystemRoot%\System32\cmd.exe" /c ""!CMDC_D0!cmdc.cmd" !CMDC_ARGS!"
SET "USERPROFILE=%ORIG_USERPROFILE%"
ENDLOCAL
