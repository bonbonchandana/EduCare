# Run EduCare prototype server (PowerShell)
# Usage: Open PowerShell in the project root and run: .\run_server.ps1
# This script creates a virtual environment if missing, installs requirements from model/requirements.txt,
# and starts the Flask API on the configured port (default 8000)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$venvPath = Join-Path $root '.venv'
if (-Not (Test-Path $venvPath)) {
    Write-Host "Creating virtual environment at $venvPath..."
    python -m venv $venvPath
}

$activate = Join-Path $venvPath 'Scripts\Activate.ps1'
if (-Not (Test-Path $activate)) {
    Write-Error "Virtualenv activate script not found at $activate. Ensure Python is installed and venv module is available."
    exit 1
}

Write-Host "Activating virtual environment..."
# dot-source the activation script so the environment is active in this shell
. $activate

$req = Join-Path $root 'model\requirements.txt'
if (Test-Path $req) {
    Write-Host "Installing Python dependencies from $req (this may take a minute)..."
    pip install -r $req
} else {
    Write-Host "No requirements file found at $req - skipping pip install"
}

# Determine port (can be overridden by EDUCARE_PORT environment variable)
$port = $env:EDUCARE_PORT
if ([string]::IsNullOrWhiteSpace($port)) { $port = '8000' }

Write-Host "Starting server (model/server_no_reload.py) on 127.0.0.1:$port..."
# Run the server with the chosen port
try {
    # Ensure the environment variable is set for the child process
    $env:EDUCARE_PORT = $port
    & python (Join-Path $root 'model\server_no_reload.py')
} catch {
    Write-Error "Failed to start server: $_"
    exit 1
}
