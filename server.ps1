$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:8001/")
$listener.Start()
Write-Host "Listening on http://localhost:8001/ (serving ground-station-v2)"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response
        $request = $context.Request
        
        $localPath = $request.Url.LocalPath.TrimStart('/')
        if ($localPath -eq "") { $localPath = "index.html" }
        $localPath = $localPath -replace '/', '\'
        $fullPath = Join-Path (Get-Location).Path $localPath
        
        if (Test-Path $fullPath -PathType Leaf) {
            $content = [System.IO.File]::ReadAllBytes($fullPath)
            $response.ContentLength64 = $content.Length
            if ($localPath.EndsWith(".html")) { $response.ContentType = "text/html; charset=utf-8" }
            elseif ($localPath.EndsWith(".js"))  { $response.ContentType = "application/javascript; charset=utf-8" }
            elseif ($localPath.EndsWith(".css")) { $response.ContentType = "text/css; charset=utf-8" }
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
    }
} finally {
    $listener.Stop()
}
