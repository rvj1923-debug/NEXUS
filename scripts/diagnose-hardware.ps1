<#
.SYNOPSIS
    Universal USB NFC / RFID Hardware Diagnostic Utility
    Discovers candidate NFC/RFID readers, PC/SC CCID devices, and HID Keyboard Wedge readers.
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   UNIVERSAL USB NFC READER DIAGNOSTIC & DISCOVERY UTILITY       " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Scanning system devices on Windows..." -ForegroundColor Gray

# 1. Query SmartCardReader Class (PC/SC CCID)
Write-Host "`n--- [1] Windows PC/SC Smart Card Reader Devices ---" -ForegroundColor Yellow
$scReaders = Get-PnpDevice -Class "SmartCardReader" -ErrorAction SilentlyContinue
if ($scReaders) {
    $scReaders | Select-Object Status, FriendlyName, InstanceId, Class | Format-Table -AutoSize
} else {
    Write-Host "No dedicated SmartCardReader class devices detected." -ForegroundColor DarkGray
}

# 2. Query Win32_PnPEntity for NFC, RFID, Smart Card, CCID, ACR keywords
Write-Host "`n--- [2] Keyword Discovery (NFC, RFID, Smart, Card, CCID, ACR) ---" -ForegroundColor Yellow
$keywords = @('*NFC*', '*RFID*', '*Smart*Card*', '*CCID*', '*ACR122*', '*Contactless*', '*Card*Reader*')
$foundDevices = @()
foreach ($kw in $keywords) {
    $matches = Get-PnpDevice | Where-Object { $_.FriendlyName -like $kw -or $_.InstanceId -like $kw } -ErrorAction SilentlyContinue
    if ($matches) {
        $foundDevices += $matches
    }
}
$uniqueCandidates = $foundDevices | Sort-Object -Property InstanceId -Unique
if ($uniqueCandidates) {
    $uniqueCandidates | Select-Object Status, Class, FriendlyName, InstanceId | Format-Table -AutoSize
} else {
    Write-Host "No specific NFC/RFID keyword-matched devices found." -ForegroundColor DarkGray
}

# 3. Query All Connected USB Devices with Vendor ID / Product ID Parsing
Write-Host "`n--- [3] Connected USB Devices (Present Only with VID/PID) ---" -ForegroundColor Yellow
$usbDevices = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\*' } -ErrorAction SilentlyContinue

$parsedUsb = foreach ($dev in $usbDevices) {
    $vid = "N/A"
    $prodId = "N/A"
    if ($dev.InstanceId -match 'VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})') {
        $vid = "0x" + $matches[1].ToUpper()
        $prodId = "0x" + $matches[2].ToUpper()
    }
    [PSCustomObject]@{
        Status        = $dev.Status
        Class         = $dev.Class
        FriendlyName  = if ($dev.FriendlyName) { $dev.FriendlyName } else { "(Unknown / Generic USB Device)" }
        VendorID      = $vid
        ProductID     = $prodId
        InstanceId    = $dev.InstanceId
    }
}
$parsedUsb | Format-Table Status, Class, VendorID, ProductID, FriendlyName, InstanceId -AutoSize

# 4. Query Connected Human Interface Devices (HID) - Candidates for Mode A (Keyboard Wedge)
Write-Host "`n--- [4] Connected HID Input Devices (Keyboard Wedge Candidates) ---" -ForegroundColor Yellow
$hidDevices = Get-PnpDevice -PresentOnly -Class "HIDClass" -ErrorAction SilentlyContinue
$parsedHid = foreach ($dev in $hidDevices) {
    $vid = "N/A"
    $prodId = "N/A"
    if ($dev.InstanceId -match 'VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})') {
        $vid = "0x" + $matches[1].ToUpper()
        $prodId = "0x" + $matches[2].ToUpper()
    }
    [PSCustomObject]@{
        Status       = $dev.Status
        FriendlyName = if ($dev.FriendlyName) { $dev.FriendlyName } else { "(Generic HID Device)" }
        VendorID     = $vid
        ProductID    = $prodId
        InstanceId   = $dev.InstanceId
    }
}
$parsedHid | Format-Table Status, VendorID, ProductID, FriendlyName, InstanceId -AutoSize

# 5. Check Windows Smart Card Service (SCardSvr) Status
Write-Host "`n--- [5] Windows Smart Card Service Status (SCardSvr) ---" -ForegroundColor Yellow
$scService = Get-Service -Name "SCardSvr" -ErrorAction SilentlyContinue
if ($scService) {
    Write-Host "Smart Card Service (SCardSvr): Status = $($scService.Status), StartType = $($scService.StartType)" -ForegroundColor Green
} else {
    Write-Host "Smart Card Service (SCardSvr) is not installed." -ForegroundColor Red
}

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "Diagnostic completed successfully." -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
