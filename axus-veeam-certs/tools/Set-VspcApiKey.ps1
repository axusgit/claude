#Requires -Version 5.1
<#
.SYNOPSIS
  One-time, run on the admin workstation in your own PowerShell window. Hands the VSPC REST API key
  to the VSPC server so the renewal task can install the VSPC *Server* certificate unattended.

  The key is never shown, logged, written to disk in clear text, or sent anywhere in clear text:
    1. the VSPC server creates a non-exportable RSA-3072 machine key and returns its PUBLIC half;
    2. you paste the API key at a hidden prompt; it is encrypted here (RSA-OAEP-SHA256);
    3. only the ciphertext is sent (az vm run-command); the server stores it and tests it with two
       read-only API calls. If the test fails, the key is not kept.

  Create the key first (Portal Administrator): VSPC > Configuration > Access Management >
  REST API Keys > New > Simple Key, description "Axus cert renewal", NOT read-only, Create, Copy.
  https://helpcenter.veeam.com/docs/vac/provider_admin/api_keys.html

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\tools\Set-VspcApiKey.ps1
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '', Justification = 'Interactive tool run by a person; progress text must go to the console, not the pipeline.')]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSReviewUnusedParameter', '', Justification = 'Used inside Invoke-OnServer via script scope.')]
[CmdletBinding()]
param(
    [string]$ResourceGroup = 'USEAST2RG01',
    [string]$VmName = 'axususeast2srv1'
)
$ErrorActionPreference = 'Stop'
$azDir = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin'
if (-not (Get-Command az -ErrorAction SilentlyContinue) -and (Test-Path $azDir)) { $env:Path += ";$azDir" }
$module = 'C:\ProgramData\Axus\CertRenewal\bin\AxusCertRenewal.psm1'

function Invoke-OnServer([string]$Script) {
    $f = Join-Path $env:TEMP ("axus-vspckey-{0}.ps1" -f [guid]::NewGuid().ToString('N'))
    try {
        [IO.File]::WriteAllText($f, $Script)
        $r = az vm run-command invoke -g $ResourceGroup -n $VmName --command-id RunPowerShellScript --scripts "@$f" -o json | ConvertFrom-Json
        $out = ($r.value | Where-Object code -like '*StdOut*').message
        $err = ($r.value | Where-Object code -like '*StdErr*').message
        if ($err) { Write-Warning $err }
        $out
    } finally { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}

Write-Host "1/3 Getting the VSPC server's public key..."
$o = Invoke-OnServer "Import-Module '$module' -Force; Export-CRVspcApiPublicKey"
$line = ($o -split "`n" | Where-Object { $_ -like 'PUBKEY:*' } | Select-Object -First 1)
if (-not $line) { throw "Server did not return a public key. Output: $o" }
$parts = $line.Substring(7).Trim().Split(';')
$p = New-Object System.Security.Cryptography.RSAParameters
$p.Modulus = [Convert]::FromBase64String($parts[0]); $p.Exponent = [Convert]::FromBase64String($parts[1])
$rsa = New-Object System.Security.Cryptography.RSACng
$rsa.ImportParameters($p)

Write-Host '2/3 Paste the VSPC API key (input is hidden), then press Enter:'
$sec = Read-Host -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
    if ($plain.Length -lt 20) { throw 'That does not look like an API key (too short).' }
    $bytes = [Text.Encoding]::UTF8.GetBytes($plain)
    if ($bytes.Length -gt 318) { throw "API key is $($bytes.Length) bytes; maximum for RSA-3072 OAEP-SHA256 is 318." }
    $cipher = [Convert]::ToBase64String($rsa.Encrypt($bytes, [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256))
    [Array]::Clear($bytes, 0, $bytes.Length); $plain = $null
} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

Write-Host '3/3 Storing the encrypted key on the server and testing it (read-only API calls)...'
Invoke-OnServer "Import-Module '$module' -Force; Save-CRVspcApiKeyBlob -CipherBase64 '$cipher'"
