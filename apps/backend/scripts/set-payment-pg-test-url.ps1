# Run in the owner's interactive PowerShell. Stores no credentials on disk.
$testSchema = 'electrohub_payment_concurrency_20261012'
$testLogin = 'eh_payment_concurrency_runner.pzxekjybdiulzmssalfo'
$testPassword = Read-Host 'Dedicated test-role password (hidden)' -AsSecureString
try {
    $testCredential = [System.Net.NetworkCredential]::new('', $testPassword)
    $encodedPassword = [System.Uri]::EscapeDataString($testCredential.Password)
    $env:PAYMENT_PG_TEST_DATABASE_URL = 'postgresql://' + $testLogin + ':' + $encodedPassword + '@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require&connection_limit=4&schema=' + $testSchema + '&options=-csearch_path%3D' + $testSchema
    Write-Host 'Test URL configured in this PowerShell process only. No execution approval was set.'
} finally {
    $encodedPassword = $null
    $testCredential = $null
    $testPassword.Dispose()
    $testPassword = $null
}
