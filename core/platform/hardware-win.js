'use strict';
// Windows PC 사양 읽기(읽기 전용, 일반 권한). 결과는 core/hardware.js가 쉬운 글로 바꾼다.
const { runPowerShell } = require('./exec');

const SCRIPT = `
function Chars($a){ if(-not $a){return ''}; (($a | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }) -join '').Trim() }
$o=@{}
$cs=Get-CimInstance Win32_ComputerSystem
$o.maker=[string]$cs.Manufacturer; $o.model=[string]$cs.Model; $o.ramTotal=[int64]$cs.TotalPhysicalMemory
$o.cpu=@(Get-CimInstance Win32_Processor | ForEach-Object { ([string]$_.Name).Trim() })
$o.ram=@(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { @{maker=([string]$_.Manufacturer).Trim(); part=([string]$_.PartNumber).Trim(); size=[int64]$_.Capacity; speed=[int]$_.ConfiguredClockSpeed; speed2=[int]$_.Speed} })
$d=@(Get-PhysicalDisk | ForEach-Object { @{model=([string]$_.FriendlyName).Trim(); media=[string]$_.MediaType; bus=[string]$_.BusType; size=[int64]$_.Size} })
if(-not $d.Count){ $d=@(Get-CimInstance Win32_DiskDrive | ForEach-Object { @{model=([string]$_.Model).Trim(); media=[string]$_.MediaType; bus=[string]$_.InterfaceType; size=[int64]$_.Size} }) }
$o.disks=$d
$o.monitors=@(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID | Where-Object { $_.Active } | ForEach-Object { @{maker=(Chars $_.ManufacturerName); name=(Chars $_.UserFriendlyName); code=(Chars $_.ProductCodeID); serial=(Chars $_.SerialNumberID)} })
$o.printers=@(Get-CimInstance Win32_Printer | ForEach-Object { @{name=[string]$_.Name; driver=[string]$_.DriverName; port=[string]$_.PortName; network=[bool]$_.Network; isDefault=[bool]$_.Default} })
ConvertTo-Json -InputObject $o -Depth 4 -Compress`;

async function hardware() {
  const r = await runPowerShell(SCRIPT, { timeoutMs: 45000 });
  return r && typeof r === 'object' ? r : null;
}

module.exports = { hardware, SCRIPT };
