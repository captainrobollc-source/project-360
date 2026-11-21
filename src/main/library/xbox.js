// Xbox app / PC Game Pass: AppX packages that ship a MicrosoftGame.config.
const path = require('path');
const { powershell, sortTitle } = require('./util');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$start = @{}
try { Get-StartApps | ForEach-Object { $start[$_.AppID] = $_.Name } } catch {}
$out = @()
Get-AppxPackage | Where-Object { -not $_.IsFramework -and $_.InstallLocation } | ForEach-Object {
  $pkg = $_
  $loc = $pkg.InstallLocation
  $cfg = Join-Path $loc 'MicrosoftGame.config'
  if (-not (Test-Path -LiteralPath $cfg)) { return }
  [xml]$x = Get-Content -LiteralPath $cfg -Raw
  $man = Get-AppxPackageManifest $pkg
  $app = @($man.Package.Applications.Application)[0]
  $aumid = "$($pkg.PackageFamilyName)!$($app.Id)"
  $name = $start[$aumid]
  if (-not $name) { $name = $x.Game.ShellVisuals.DefaultDisplayName }
  if (-not $name -or $name -like 'ms-resource*') { $name = $man.Package.Properties.DisplayName }
  if (-not $name -or $name -like 'ms-resource*') { $name = $pkg.Name }
  $sv = $x.Game.ShellVisuals
  $out += [pscustomobject]@{
    pfn = $pkg.PackageFamilyName; aumid = $aumid; name = $name; loc = $loc
    exes = @($x.Game.ExecutableList.Executable | ForEach-Object { Split-Path $_.Name -Leaf })
    square = $sv.Square480x480Logo; splash = $sv.SplashScreenImage
  }
}
ConvertTo-Json -InputObject @($out) -Depth 4 -Compress
`;

async function scan() {
  const { err, stdout } = await powershell(SCRIPT, 90000);
  if (err && !stdout.trim()) return { ok: false, games: [], note: 'Xbox scan failed' };
  let rows = [];
  try { rows = JSON.parse(stdout.trim() || '[]'); } catch { return { ok: false, games: [], note: 'Xbox scan parse failed' }; }
  if (!Array.isArray(rows)) rows = [rows];
  const games = rows.filter((r) => r && r.pfn).map((r) => ({
    id: `xbox:${r.pfn}`,
    source: 'xbox',
    title: prettify(r.name),
    sortTitle: sortTitle(prettify(r.name)),
    installDir: r.loc,
    launch: { type: 'shell', target: `shell:AppsFolder\\${r.aumid}` },
    watch: { dirs: [r.loc], exes: (r.exes || []).filter(Boolean) },
    localArt: {
      cover: r.square ? path.join(r.loc, r.square) : null,
      hero: r.splash ? path.join(r.loc, r.splash) : null,
    },
  }));
  return { ok: true, games };
}

function prettify(name) {
  // Fallback package names look like "Microsoft.SunriseBaseGame"; make them readable.
  if (/^[\w]+\.[\w.]+$/.test(name) && !/\s/.test(name)) {
    return name.split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  return name;
}

module.exports = { scan };
