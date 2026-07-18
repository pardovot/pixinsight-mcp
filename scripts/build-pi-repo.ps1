$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo = 'C:\code\pixinsight-mcp'
$src  = Join-Path $repo 'pjsr\pixinsight-mcp-watcher.js'
$zip  = Join-Path $repo 'pi-repo\pixinsight-mcp-watcher.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
$fs = [IO.File]::Open($zip, 'Create')
$arch = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
$entryName = 'src/scripts/PixInsightMCP/pixinsight-mcp-watcher.js'
$entry = $arch.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
$es = $entry.Open()
$bytes = [IO.File]::ReadAllBytes($src)
$es.Write($bytes, 0, $bytes.Length)
$es.Close()
$arch.Dispose(); $fs.Close()
Write-Host '=== entries ==='
$r = [IO.Compression.ZipFile]::OpenRead($zip)
$r.Entries | ForEach-Object { $_.FullName }
$r.Dispose()
Write-Host '=== sha1 ==='
(Get-FileHash $zip -Algorithm SHA1).Hash.ToLower()
