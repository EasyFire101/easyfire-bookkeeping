import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = resolve(root, "deploy/windows/migration-windows.psm1");
const quote = (value) => `'${value.replaceAll("'", "''")}'`;

function ps(script) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8" },
  );
}

function createTaskFixture() {
  const fixture = mkdtempSync(resolve(tmpdir(), "easyfire-migration-task-"));
  const authorityRoot = resolve(fixture, "authority");
  const scriptPath = resolve(
    fixture,
    "sealed",
    "migration-scheduled-backup.ps1",
  );
  mkdirSync(authorityRoot, { recursive: true });
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, "# synthetic sealed controller\n", "utf8");
  return { fixture, authorityRoot, scriptPath };
}

test("Windows mutation surface names only the three approved runtime objects", () => {
  const source = readFileSync(modulePath, "utf8");
  const taskNames = [
    ...source.matchAll(/easyfire-bookkeeping-prod-(?:backup|startup)/g),
  ].map((match) => match[0]);
  assert.ok(taskNames.length > 0);
  assert.deepEqual([...new Set(taskNames)].sort(), [
    "easyfire-bookkeeping-prod-backup",
    "easyfire-bookkeeping-prod-startup",
  ]);
  const serviceNames = [
    ...source.matchAll(/EasyFireBookkeeping[A-Za-z0-9_-]*/g),
  ].map((match) => match[0]);
  assert.deepEqual([...new Set(serviceNames)], [
    "EasyFireBookkeepingCloudflared",
  ]);
  assert.doesNotMatch(source, /Get-ScheduledTask\s+[^\r\n]*\*/i);
  assert.doesNotMatch(source, /Get-Service\s+[^\r\n]*\*/i);
});

test("daily task definition is fully-qualified, migration-bound, SYSTEM-owned, and bounded", () => {
  const item = createTaskFixture();
  try {
    const result = ps(`
      Import-Module ${quote(modulePath)} -Force
      Get-EasyFireMigrationBackupTaskDefinition \
        -ScriptPath ${quote(item.scriptPath)} \
        -MigrationId '11111111-1111-4111-8111-111111111111' \
        -AuthorityRoot ${quote(item.authorityRoot)} \
        -AuthorityOwnerSid 'S-1-5-21-100-200-300-1001' | ConvertTo-Json -Depth 6 -Compress
    `);
    assert.equal(result.status, 0, result.stderr);
    const definition = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(definition.TaskName, "easyfire-bookkeeping-prod-backup");
    assert.equal(definition.Execute, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    assert.equal(definition.ScriptPath, item.scriptPath);
    assert.equal(definition.AuthorityRoot, item.authorityRoot);
    assert.equal(definition.PrincipalUserId, "SYSTEM");
    assert.equal(definition.PrincipalLogonType, "ServiceAccount");
    assert.equal(definition.PrincipalRunLevel, "Highest");
    assert.equal(definition.TriggerKind, "Daily");
    assert.equal(definition.TriggerClass, "MSFT_TaskDailyTrigger");
    assert.equal(definition.ActionClass, "MSFT_TaskExecAction");
    assert.equal(definition.SettingsClass, "MSFT_TaskSettings3");
    assert.equal(definition.TriggerAt, "02:00");
    assert.equal(definition.DaysInterval, 1);
    assert.equal(definition.StartWhenAvailable, true);
    assert.equal(definition.AllowStartIfOnBatteries, true);
    assert.equal(definition.DontStopIfGoingOnBatteries, true);
    assert.equal(definition.Enabled, true);
    assert.equal(definition.ExecutionTimeLimitHours, 8);
    assert.equal(definition.MultipleInstances, "IgnoreNew");
    assert.equal(definition.Hidden, false);
    assert.equal(definition.RunOnlyIfIdle, false);
    assert.equal(definition.RunOnlyIfNetworkAvailable, false);
    assert.equal(definition.WakeToRun, false);
    assert.equal(definition.RestartCount, 0);
    assert.equal(definition.Priority, 7);
    assert.match(definition.Arguments, /-NoProfile/);
    assert.match(definition.Arguments, /-ExecutionPolicy Bypass/);
    assert.match(definition.Arguments, /migration-scheduled-backup\.ps1/);
    assert.match(definition.Arguments, /-MigrationId 11111111-1111-4111-8111-111111111111/);
    assert.match(definition.Arguments, /-InvocationRole MigrationScheduled/);
    assert.match(definition.Arguments, /S-1-5-21-100-200-300-1001/);
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("task XML equivalence ignores formatting but not executable authority", () => {
  const one = Buffer.from(
    `<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Actions><Exec><Command>C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe</Command><Arguments>-NoProfile</Arguments></Exec></Actions></Task>`,
    "utf8",
  ).toString("base64");
  const same = Buffer.from(
    `<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n  <Actions>\n    <Exec><Command>C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe</Command><Arguments>-NoProfile</Arguments></Exec>\n  </Actions>\n</Task>`,
    "utf8",
  ).toString("base64");
  const changed = Buffer.from(
    `<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Actions><Exec><Command>powershell.exe</Command><Arguments>-NoProfile</Arguments></Exec></Actions></Task>`,
    "utf8",
  ).toString("base64");
  const result = ps(`
    Import-Module ${quote(modulePath)} -Force
    $one=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${one}'))
    $same=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${same}'))
    $changed=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${changed}'))
    @(
      (Test-EasyFireMigrationTaskXmlEquivalent -LeftXml $one -RightXml $same),
      (Test-EasyFireMigrationTaskXmlEquivalent -LeftXml $one -RightXml $changed)
    ) | ConvertTo-Json -Compress
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), [
    true,
    false,
  ]);
});

test("scheduled-task readback rejects every safety-relevant field drift", () => {
  const item = createTaskFixture();
  try {
    const result = ps(`
      Import-Module ${quote(modulePath)} -Force
      $module = Get-Module migration-windows
      & $module {
        $definition = Get-EasyFireMigrationBackupTaskDefinition \
          -ScriptPath ${quote(item.scriptPath)} \
          -MigrationId '11111111-1111-4111-8111-111111111111' \
          -AuthorityRoot ${quote(item.authorityRoot)} \
          -AuthorityOwnerSid 'S-1-5-21-100-200-300-1001'
        $script:Drift = ''
        function New-TestTask {
          $task = [pscustomobject]@{
            TaskName='easyfire-bookkeeping-prod-backup'; TaskPath='\\'
            Actions=@([pscustomobject]@{
              CimClass=[pscustomobject]@{ CimClassName='MSFT_TaskExecAction' }
              Id=$null; Execute=$definition.Execute; Arguments=$definition.Arguments
              WorkingDirectory=$definition.WorkingDirectory
            })
            Triggers=@([pscustomobject]@{
              CimClass=[pscustomobject]@{ CimClassName='MSFT_TaskDailyTrigger' }
              Id=$null; StartBoundary='2026-07-20T02:00:00'; EndBoundary=$null
              ExecutionTimeLimit=$null; Repetition=$null; RandomDelay=$null
              DaysInterval=1; Enabled=$true
            })
            Principal=[pscustomobject]@{
              CimClass=[pscustomobject]@{ CimClassName='MSFT_TaskPrincipal2' }
              Id=$null; DisplayName=$null; GroupId=$null; UserId='SYSTEM'
              LogonType='ServiceAccount'; RunLevel='Highest'
              ProcessTokenSidType='Default'; RequiredPrivilege=@()
            }
            Settings=[pscustomobject]@{
              CimClass=[pscustomobject]@{ CimClassName='MSFT_TaskSettings3' }
              Enabled=$true; StartWhenAvailable=$true
              DisallowStartIfOnBatteries=$false; StopIfGoingOnBatteries=$false
              ExecutionTimeLimit=[TimeSpan]::FromHours(8); MultipleInstances='IgnoreNew'
              AllowDemandStart=$true; AllowHardTerminate=$true; Compatibility='Win8'
              DeleteExpiredTaskAfter=$null; DisallowStartOnRemoteAppSession=$false
              Hidden=$false; Priority=7; RestartCount=0; RestartInterval=$null
              RunOnlyIfIdle=$false; RunOnlyIfNetworkAvailable=$false
              UseUnifiedSchedulingEngine=$true; volatile=$false; WakeToRun=$false
            }
            Description=$definition.Description
          }
          switch ($script:Drift) {
            'TaskName' { $task.TaskName='other' }
            'TaskPath' { $task.TaskPath='\\other\\' }
            'ActionCount' { $task.Actions=@($task.Actions[0], $task.Actions[0]) }
            'ActionClass' { $task.Actions[0].CimClass.CimClassName='MSFT_TaskComHandlerAction' }
            'ActionId' { $task.Actions[0].Id='unexpected' }
            'ActionExecute' { $task.Actions[0].Execute='powershell.exe' }
            'ActionArguments' { $task.Actions[0].Arguments='-NoProfile' }
            'ActionWorkingDirectory' { $task.Actions[0].WorkingDirectory='C:\\' }
            'TriggerCount' { $task.Triggers=@($task.Triggers[0], $task.Triggers[0]) }
            'TriggerClass' { $task.Triggers[0].CimClass.CimClassName='MSFT_TaskTimeTrigger' }
            'TriggerId' { $task.Triggers[0].Id='unexpected' }
            'TriggerStart' { $task.Triggers[0].StartBoundary='2026-07-20T03:00:00' }
            'TriggerEnd' { $task.Triggers[0].EndBoundary='2027-01-01T00:00:00' }
            'TriggerExecution' { $task.Triggers[0].ExecutionTimeLimit=[TimeSpan]::FromHours(1) }
            'TriggerRepetition' { $task.Triggers[0].Repetition=[pscustomobject]@{ Interval='PT1H' } }
            'TriggerRandomDelay' { $task.Triggers[0].RandomDelay=[TimeSpan]::FromMinutes(5) }
            'TriggerDays' { $task.Triggers[0].DaysInterval=2 }
            'TriggerEnabled' { $task.Triggers[0].Enabled=$false }
            'PrincipalClass' { $task.Principal.CimClass.CimClassName='MSFT_TaskPrincipal' }
            'PrincipalId' { $task.Principal.Id='unexpected' }
            'PrincipalDisplayName' { $task.Principal.DisplayName='unexpected' }
            'PrincipalGroup' { $task.Principal.GroupId='Administrators' }
            'PrincipalUser' { $task.Principal.UserId='Administrator' }
            'PrincipalLogon' { $task.Principal.LogonType='Password' }
            'PrincipalRunLevel' { $task.Principal.RunLevel='Limited' }
            'PrincipalToken' { $task.Principal.ProcessTokenSidType='Unrestricted' }
            'PrincipalPrivilege' { $task.Principal.RequiredPrivilege=@('SeBackupPrivilege') }
            'Description' { $task.Description='other' }
            'SettingsClass' { $task.Settings.CimClass.CimClassName='MSFT_TaskSettings2' }
            'SettingsEnabled' { $task.Settings.Enabled=$false }
            'SettingsAvailable' { $task.Settings.StartWhenAvailable=$false }
            'SettingsDisallowBattery' { $task.Settings.DisallowStartIfOnBatteries=$true }
            'SettingsStopBattery' { $task.Settings.StopIfGoingOnBatteries=$true }
            'SettingsExecution' { $task.Settings.ExecutionTimeLimit=[TimeSpan]::FromHours(9) }
            'SettingsMultiple' { $task.Settings.MultipleInstances='Parallel' }
            'SettingsDemand' { $task.Settings.AllowDemandStart=$false }
            'SettingsHardTerminate' { $task.Settings.AllowHardTerminate=$false }
            'SettingsCompatibility' { $task.Settings.Compatibility='Vista' }
            'SettingsDeleteExpired' { $task.Settings.DeleteExpiredTaskAfter=[TimeSpan]::FromDays(1) }
            'SettingsRemote' { $task.Settings.DisallowStartOnRemoteAppSession=$true }
            'SettingsHidden' { $task.Settings.Hidden=$true }
            'SettingsPriority' { $task.Settings.Priority=4 }
            'SettingsRestartCount' { $task.Settings.RestartCount=1 }
            'SettingsRestartInterval' { $task.Settings.RestartInterval=[TimeSpan]::FromMinutes(5) }
            'SettingsIdle' { $task.Settings.RunOnlyIfIdle=$true }
            'SettingsNetwork' { $task.Settings.RunOnlyIfNetworkAvailable=$true }
            'SettingsUnified' { $task.Settings.UseUnifiedSchedulingEngine=$false }
            'SettingsVolatile' { $task.Settings.volatile=$true }
            'SettingsWake' { $task.Settings.WakeToRun=$true }
          }
          return $task
        }
        function Get-ScheduledTask { New-TestTask }
        function Export-ScheduledTask { '<Task />' }
        $valid = Assert-EasyFireMigrationBackupTask -Definition $definition
        $drifts = @(
          'TaskName','TaskPath','ActionCount','ActionClass','ActionId','ActionExecute',
          'ActionArguments','ActionWorkingDirectory','TriggerCount','TriggerClass','TriggerId',
          'TriggerStart','TriggerEnd','TriggerExecution','TriggerRepetition','TriggerRandomDelay',
          'TriggerDays','TriggerEnabled','PrincipalClass','PrincipalId','PrincipalDisplayName',
          'PrincipalGroup','PrincipalUser','PrincipalLogon','PrincipalRunLevel','PrincipalToken',
          'PrincipalPrivilege','Description','SettingsClass','SettingsEnabled','SettingsAvailable',
          'SettingsDisallowBattery','SettingsStopBattery','SettingsExecution','SettingsMultiple',
          'SettingsDemand','SettingsHardTerminate','SettingsCompatibility','SettingsDeleteExpired',
          'SettingsRemote','SettingsHidden','SettingsPriority','SettingsRestartCount',
          'SettingsRestartInterval','SettingsIdle','SettingsNetwork','SettingsUnified',
          'SettingsVolatile','SettingsWake'
        )
        $accepted = @()
        foreach ($drift in $drifts) {
          $script:Drift = $drift
          try { $null = Assert-EasyFireMigrationBackupTask -Definition $definition; $accepted += $drift }
          catch { }
        }
        [pscustomobject]@{ Exact=$valid.Exact; DriftCount=$drifts.Count; AcceptedDrifts=$accepted } |
          ConvertTo-Json -Depth 5 -Compress
      }
    `);
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(evidence.Exact, true);
    assert.ok(evidence.DriftCount >= 45);
    assert.deepEqual(evidence.AcceptedDrifts, []);
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});

test("task command quoting rejects embedded quotes and noncanonical owner SIDs", () => {
  const item = createTaskFixture();
  try {
    for (const [script, sid] of [
      [`${item.scriptPath}"`, "S-1-5-21-100-200-300-1001"],
      [item.scriptPath, "Administrators"],
    ]) {
      const result = ps(`
        Import-Module ${quote(modulePath)} -Force
        Get-EasyFireMigrationBackupTaskDefinition -ScriptPath ${quote(script)} \
          -MigrationId '11111111-1111-4111-8111-111111111111' -AuthorityRoot ${quote(item.authorityRoot)} \
          -AuthorityOwnerSid ${quote(sid)} | Out-Null
      `);
      assert.notEqual(result.status, 0);
    }
  } finally {
    rmSync(item.fixture, { recursive: true, force: true });
  }
});
