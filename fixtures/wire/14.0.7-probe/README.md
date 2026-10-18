# 14.0.7 wire probe

The 14.35 wire probe (`../14.35-probe/README.md`) run against engine 14.0.7's `IOM.dll` and `Libs.dll`, so that `spec/wire.md` can say where 14.35 differs and check a few 14.0.7 statements. Same script (`oracle/wire-probe/probe.ps1 -Engine 14.0.7`), same scripted answers, no server or credential. It has no `F.iomHelpers`: 14.0.7's hash helpers are internal. `isConnected` is whether `CItemHelper.Inn` is set, since 14.0.7 has no `IsConnected` property.
