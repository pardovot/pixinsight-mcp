# Builds the PixInsight update package zip and syncs updates.xri sha1.
# Bundles the watcher .js and, if present, its .xsgn signature — both under
# src/scripts/PixInsightMCP/ (paths extract relative to the PixInsight install).
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-pi-repo.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repo   = Split-Path $PSScriptRoot -Parent
$srcJs  = Join-Path $repo 'pjsr\pixinsight-mcp-watcher.js'
$srcSgn = Join-Path $repo 'pjsr\pixinsight-mcp-watcher.xsgn'   # optional
$zip    = Join-Path $repo 'pi-repo\pixinsight-mcp-watcher.zip'
$xri    = Join-Path $repo 'pi-repo\updates.xri'
$base   = 'src/scripts/PixInsightMCP/'

if (Test-Path $zip) { Remove-Item $zip -Force }
$fs   = [IO.File]::Open($zip, 'Create')
$arch = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)

function Add-Entry($srcPath, $entryName) {
   $e  = $arch.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
   $os = $e.Open()
   $b  = [IO.File]::ReadAllBytes($srcPath)
   $os.Write($b, 0, $b.Length); $os.Close()
   Write-Host "  + $entryName"
}

Add-Entry $srcJs ($base + 'pixinsight-mcp-watcher.js')
if (Test-Path $srcSgn) {
   Add-Entry $srcSgn ($base + 'pixinsight-mcp-watcher.xsgn')
   Write-Host 'signature: INCLUDED'
} else {
   Write-Host 'signature: none (unsigned package)'
}
$arch.Dispose(); $fs.Close()

$sha1 = (Get-FileHash $zip -Algorithm SHA1).Hash.ToLower()
Write-Host "sha1: $sha1"

# Patch the sha1 attribute in updates.xri
$content = Get-Content $xri -Raw
$content = [regex]::Replace($content, 'sha1="[0-9a-f]{40}"', "sha1=`"$sha1`"")
Set-Content $xri -Value $content -NoNewline -Encoding UTF8
Write-Host "updated $xri"
