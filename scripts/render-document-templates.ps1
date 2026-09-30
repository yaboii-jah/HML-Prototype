# Render the fixtures from document-template-check.mjs using Windows' PDF engine.
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType=WindowsRuntime] | Out-Null
function Await-Result($operation, $resultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.GetAwaiter().GetResult()
}
function Await-Action($operation) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
  $task = $method.Invoke($null, @($operation))
  $task.GetAwaiter().GetResult() | Out-Null
}
foreach ($name in @('po', 'mrf', 'comparison')) {
  $path = Join-Path (Get-Location) ".next/template-check/$name.pdf"
  $file = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $document = Await-Result ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  for ($index = 0; $index -lt $document.PageCount; $index++) {
    $page = $document.GetPage($index)
    $memory = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $options.DestinationWidth = 1600
    Await-Action ($page.RenderToStreamAsync($memory, $options))
    $reader = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($memory)
    $output = [System.IO.File]::Create((Join-Path (Get-Location) ".next/template-check/$name-page-$($index + 1).png"))
    try { $reader.CopyTo($output) } finally { $output.Dispose(); $reader.Dispose(); $memory.Dispose(); $page.Dispose() }
  }
}
