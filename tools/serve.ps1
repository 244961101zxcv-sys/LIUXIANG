param(
  [int]$Port = 8080,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rootWithSep = $root.TrimEnd('\') + '\'

$mimeMap = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.webp' = 'image/webp'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.ico'  = 'image/x-icon'
  '.glb'  = 'model/gltf-binary'
  '.gltf' = 'model/gltf+json'
  '.bin'  = 'application/octet-stream'
  '.wasm' = 'application/wasm'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.ttf'  = 'font/ttf'
  '.txt'  = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.Sockets.TcpListener -ArgumentList ([System.Net.IPAddress]::Loopback), $Port
try {
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "Port $Port is already in use." -ForegroundColor Yellow
  Write-Host "If the site is already open, just visit http://127.0.0.1:$Port/" -ForegroundColor Gray
  Write-Host "Otherwise close the other preview window and run this file again." -ForegroundColor Gray
  Read-Host "Press Enter to close"
  exit 1
}

$url = "http://127.0.0.1:$Port/"
Write-Host ""
Write-Host "FORM / 10 local preview" -ForegroundColor Green
Write-Host $url -ForegroundColor Cyan
Write-Host "Keep this window open. Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""
if (-not $NoBrowser) {
  Start-Process $url
}

function Send-Response {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$Status,
    [string]$ContentType,
    [byte[]]$Body,
    [bool]$HeadOnly = $false
  )
  $reason = if ($Status -eq 200) { 'OK' } elseif ($Status -eq 404) { 'Not Found' } else { 'Method Not Allowed' }
  $header = "HTTP/1.1 $Status $reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
  $Stream.Flush()
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 5000
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

    while ($true) {
      $line = $reader.ReadLine()
      if ($null -eq $line -or $line -eq '') { break }
    }

    $parts = $requestLine -split ' '
    $method = $parts[0]
    $rawPath = $parts[1]

    if ($method -ne 'GET' -and $method -ne 'HEAD') {
      $body = [System.Text.Encoding]::UTF8.GetBytes('Method Not Allowed')
      Send-Response -Stream $stream -Status 405 -ContentType 'text/plain; charset=utf-8' -Body $body
      continue
    }

    $decoded = [System.Uri]::UnescapeDataString(($rawPath -split '\?')[0])
    if ($decoded -eq '/') { $decoded = '/index.html' }
    $relative = $decoded.TrimStart('/').Replace('/', '\')
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

    if (-not $fullPath.StartsWith($rootWithSep, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      $body = [System.Text.Encoding]::UTF8.GetBytes("Not Found: $decoded")
      Send-Response -Stream $stream -Status 404 -ContentType 'text/plain; charset=utf-8' -Body $body -HeadOnly ($method -eq 'HEAD')
      continue
    }

    $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
    $contentType = if ($mimeMap.ContainsKey($extension)) { $mimeMap[$extension] } else { 'application/octet-stream' }
    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    Send-Response -Stream $stream -Status 200 -ContentType $contentType -Body $bytes -HeadOnly ($method -eq 'HEAD')
  } catch {
    # A browser may close a speculative connection; keep serving.
  } finally {
    $client.Close()
  }
}
