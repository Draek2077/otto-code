# OTTO(editor): the same portable sidecar as npm/desktop, with fixed NuGet inputs.
{ lib, buildDotnetModule, dotnetCorePackages }:
buildDotnetModule {
  pname = "otto-dotnet-probe";
  version = "1.0.0";
  src = lib.cleanSource ../packages/dotnet-probe;
  projectFile = "OttoDotnetProbe.csproj";
  nugetDeps = ./dotnet-probe-deps.json;
  dotnet-sdk = dotnetCorePackages.sdk_8_0;
  dotnet-runtime = dotnetCorePackages.runtime_8_0;
  executables = [ ];
  enableParallelBuilding = false;
  dotnetBuildFlags = [ "-p:UseSharedCompilation=false" ];
  postInstall = ''
    test -f "$out/lib/otto-dotnet-probe/OttoDotnetProbe.dll"
  '';
  meta.license = lib.licenses.agpl3Plus;
}
