param([Parameter(Mandatory = $true)][string]$CertificatePath)
# Supply only the root downloaded through the verified DEV Dashboard SSL link.
$resolvedCaPath = (Resolve-Path -LiteralPath $CertificatePath -ErrorAction Stop).Path
& node (Join-Path $PSScriptRoot 'payment-pg-ca.cjs') $resolvedCaPath
if ($LASTEXITCODE -ne 0) { throw 'CA validation failed; trust configuration unchanged.' }
if ($env:NODE_TLS_REJECT_UNAUTHORIZED -eq '0') { throw 'Unsafe TLS override present; refusing readiness.' }
if ($env:NODE_EXTRA_CA_CERTS -and $env:NODE_EXTRA_CA_CERTS -ne $resolvedCaPath) {
    throw 'Different process CA setting exists; refusing to overwrite it.'
}
$env:NODE_EXTRA_CA_CERTS = $resolvedCaPath
# Node loads NODE_EXTRA_CA_CERTS at process startup; descendants inherit this setting.
& node (Join-Path $PSScriptRoot 'payment-pg-readiness.cjs')
