# Ivent - Setup and Run Script
# Usage: .\run.ps1 [command]
# Commands: setup, server, client, dev, db-init, build, proof, test

param(
    [Parameter(Position=0)]
    [ValidateSet("setup", "server", "client", "dev", "db-init", "build", "proof", "test")]
    [string]$Command = "dev"
)

$Root = $PSScriptRoot
if (-not $Root) { $Root = Get-Location }
$ServerDir = Join-Path $Root "server"
$ClientDir = Join-Path $Root "client"

function Install-Dependencies {
    Write-Host "`n[1/2] Installing server dependencies..." -ForegroundColor Cyan
    Push-Location $ServerDir
    npm install
    Pop-Location

    Write-Host "`n[2/2] Installing client dependencies..." -ForegroundColor Cyan
    Push-Location $ClientDir
    npm install
    Pop-Location

    Write-Host "`nAll dependencies installed." -ForegroundColor Green
}

function Start-Server {
    Write-Host "`nStarting Express server on port 3001..." -ForegroundColor Cyan
    Push-Location $ServerDir
    npm run dev
    Pop-Location
}

function Start-Client {
    Write-Host "`nStarting Next.js client on port 3000..." -ForegroundColor Cyan
    Push-Location $ClientDir
    npm run dev
    Pop-Location
}

function Build-Client {
    Write-Host "`nBuilding Next.js client..." -ForegroundColor Cyan
    Push-Location $ClientDir
    npm run build
    Pop-Location
}

function Test-ServerIsUp {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3001/" -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
        return ($response.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Run-WithServer {
    param([scriptblock]$Action)

    $wasRunning = Test-ServerIsUp
    $tempJob = $null

    if (-not $wasRunning) {
        Write-Host "Backend server not detected on port 3001. Starting temporary background server..." -ForegroundColor DarkGray
        $tempJob = Start-Job -ScriptBlock {
            param($dir)
            Set-Location $dir
            node src/index.js 2>&1
        } -ArgumentList $ServerDir

        $ready = $false
        for ($i = 0; $i -lt 15; $i++) {
            Start-Sleep -Milliseconds 500
            if (Test-ServerIsUp) {
                $ready = $true
                break
            }
        }

        if (-not $ready) {
            Write-Host "[Error] Failed to start backend server for testing." -ForegroundColor Red
            if ($tempJob) { Receive-Job $tempJob; Remove-Job $tempJob -Force -ErrorAction SilentlyContinue }
            return
        }
    }

    try {
        & $Action
    } finally {
        if ($tempJob) {
            Write-Host "`nStopping temporary background server..." -ForegroundColor DarkGray
            Stop-Job $tempJob -ErrorAction SilentlyContinue
            Remove-Job $tempJob -Force -ErrorAction SilentlyContinue
        }
    }
}

function Run-Proof {
    Run-WithServer {
        Write-Host "`nRunning Concurrency Load Test..." -ForegroundColor Cyan
        Push-Location $ServerDir
        node scripts/test-concurrency.js
        Pop-Location
    }
}

function Run-Test {
    Run-WithServer {
        Write-Host "`nRunning PDF Requirements & End-to-End Suite..." -ForegroundColor Cyan
        Push-Location $ServerDir
        node scripts/test-pdf-requirements.js
        if ($LASTEXITCODE -eq 0) {
            Write-Host "`nRunning Concurrency & Race-Condition Suite..." -ForegroundColor Cyan
            node scripts/test-concurrency.js
        }
        Pop-Location
    }
}

function Initialize-Database {
    Write-Host "`nInitializing database schema..." -ForegroundColor Cyan
    Push-Location $ServerDir
    node src/db-init.js
    Pop-Location
}

function Start-Dev {
    Write-Host "`nStarting Ivent (server + client)..." -ForegroundColor Cyan
    Write-Host "Server will run on http://localhost:3001" -ForegroundColor Yellow
    Write-Host "Client will run on http://localhost:3000`n" -ForegroundColor Yellow

    # Start server in background job
    $serverJob = Start-Job -ScriptBlock {
        param($dir)
        Set-Location $dir
        node src/index.js 2>&1
    } -ArgumentList $ServerDir

    # Give server a moment to start
    Start-Sleep -Seconds 2

    # Check if server job is running
    if ($serverJob.State -ne "Running") {
        Write-Host "[Error] Server failed to start. Logs:" -ForegroundColor Red
        Receive-Job $serverJob
        Remove-Job $serverJob -ErrorAction SilentlyContinue
        return
    }

    Write-Host "[Server] Running in background (Job ID: $($serverJob.Id))" -ForegroundColor DarkGray
    Write-Host "[Client] Starting Next.js in foreground...`n" -ForegroundColor DarkGray

    Push-Location $ClientDir
    try {
        npm run dev
    } finally {
        Write-Host "`nStopping server..." -ForegroundColor Yellow
        Stop-Job $serverJob -ErrorAction SilentlyContinue
        Remove-Job $serverJob -ErrorAction SilentlyContinue
        Pop-Location
    }
}

switch ($Command) {
    "setup" {
        Install-Dependencies
        Write-Host "`nSetup complete. Next steps:" -ForegroundColor Green
        Write-Host "  1. Run: .\run.ps1 db-init" -ForegroundColor White
        Write-Host "  2. Run: .\run.ps1 dev" -ForegroundColor White
    }
    "server" { Start-Server }
    "client" { Start-Client }
    "build" { Build-Client }
    "proof" { Run-Proof }
    "test" { Run-Test }
    "dev" { Start-Dev }
    "db-init" { Initialize-Database }
}
