// Read-only checks. Shared or unverifiable ledger permissions reject launcher installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
function windowsEnvironment(directory) {
  const inherited = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'COMSPEC', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  return { ...inherited, ELECTROHUB_LEDGER_CHECK_PATH: directory,
    PSModulePath: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') };
}
function secureNewLedger(directory) {
  assert.equal(process.env.NODE_ENV, 'test');
  const root = path.resolve(directory);
  assert.equal(path.dirname(root), path.resolve(__dirname, '../.cache/stripe-acceptance-budget'));
  assert.match(path.basename(root), /^[a-f0-9-]{36}$/i);
  assert.equal(fs.realpathSync(root), root);
  assert.deepEqual(fs.readdirSync(root), ['config.json'], 'Only a fresh unspent test ledger can be secured');
  if (process.platform !== 'win32') fs.chmodSync(root, 0o700);
  else {
    const script = `$ErrorActionPreference='Stop'; $p=$env:ELECTROHUB_LEDGER_CHECK_PATH; ` +
      `$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; ` +
      `$a=New-Object System.Security.AccessControl.DirectorySecurity; $a.SetOwner($sid); $a.SetAccessRuleProtection($true,$false); ` +
      `foreach($id in @($sid.Value,'S-1-5-18','S-1-5-32-544')) { ` +
      `$rule=New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.SecurityIdentifier]$id,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); ` +
      `$a.AddAccessRule($rule) }; Set-Acl -LiteralPath $p -AclObject $a`;
    try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: windowsEnvironment(root), windowsHide: true, timeout: 5000, stdio: 'ignore',
    }); } catch { throw Error('Fresh test ledger permissions could not be secured'); }
  }
  return assertLedgerPermissions(root);
}
function assertLedgerPermissions(directory) {
  const stat = fs.lstatSync(directory);
  assert.equal(stat.isDirectory() && !stat.isSymbolicLink(), true);
  if (process.platform !== 'win32') {
    assert.equal(stat.uid, process.getuid()); assert.equal(stat.mode & 0o077, 0, 'Shared ledger permissions');
    for (const name of fs.readdirSync(directory)) {
      const child = fs.lstatSync(path.join(directory, name));
      assert.equal(child.isFile() && !child.isSymbolicLink(), true);
      assert.equal(child.uid, process.getuid()); assert.equal(child.mode & 0o077, 0, 'Shared ledger file');
    }
    return { verified: true, kind: 'POSIX-owner-only' };
  }
  const script = `$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; ` +
    `$items=@(Get-Item -LiteralPath $env:ELECTROHUB_LEDGER_CHECK_PATH)+@(Get-ChildItem -LiteralPath $env:ELECTROHUB_LEDGER_CHECK_PATH); ` +
    `$rows=@(foreach($item in $items) { if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected ledger'}; ` +
    `$a=Get-Acl -LiteralPath $item.FullName; $owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; ` +
    `$writers=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ` +
    `Where-Object { $_.AccessControlType -eq 'Allow' -and ([int]$_.FileSystemRights -band 0xD0116) -ne 0 } | ` +
    `ForEach-Object { $_.IdentityReference.Value }); ` +
    `@{owner=$owner;current=$sid;writers=$writers;protected=$a.AreAccessRulesProtected;directory=$item.PSIsContainer} }); ` +
    `@{rows=$rows}|ConvertTo-Json -Compress -Depth 5`;
  let value;
  try { value = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: windowsEnvironment(directory), windowsHide: true, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  })); } catch { throw Error('Ledger permissions unverifiable'); }
  assert.ok(Array.isArray(value.rows) && value.rows.length > 0);
  value.rows.forEach((row, index) => {
    assert.equal(row.owner, row.current, 'Foreign ledger owner');
    assert.equal(row.directory, index === 0, 'Unexpected ledger subdirectory');
    if (index === 0) assert.equal(row.protected, true, 'Inherited shared ledger permissions');
    assert.ok(Array.isArray(row.writers) && row.writers.length > 0);
    assert.ok(row.writers.every(sid => [row.current, 'S-1-5-18', 'S-1-5-32-544'].includes(sid)), 'Foreign ledger writer');
  });
  return { verified: true, kind: 'Windows-owner/SYSTEM/Administrators-only' };
}
module.exports = { assertLedgerPermissions, secureNewLedger };
