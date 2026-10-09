param([string]$Directory, [string]$Pattern = '*.pdf', [int]$Width = 1500, [string]$RenderDirectory = '.next/sample-render')
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
$target = Join-Path (Get-Location) $RenderDirectory
New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($item in Get-ChildItem -Path $Directory -Filter $Pattern) {
  $file = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($item.FullName)) ([Windows.Storage.StorageFile])
  $document = Await-Result ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  for ($index = 0; $index -lt $document.PageCount; $index++) {
    $page = $document.GetPage($index)
    $memory = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $options.DestinationWidth = $Width
    Await-Action ($page.RenderToStreamAsync($memory, $options))
    $reader = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($memory)
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($item.Name) -replace '[^A-Za-z0-9]+', '-'
    $output = [System.IO.File]::Create((Join-Path $target "$stem-page-$($index + 1).png"))
    try { $reader.CopyTo($output) } finally { $output.Dispose(); $reader.Dispose(); $memory.Dispose(); $page.Dispose() }
  }
  "$($item.Name): $($document.PageCount) page(s)"
}