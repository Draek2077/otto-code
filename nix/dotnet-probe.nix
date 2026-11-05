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
  # buildDotnetModule otherwise overrides the project's portable-IL choice.
  # The daemon invokes dotnet + DLL; an extra native apphost is never used.
  useAppHost = false;
  executables = [ ];
  enableParallelBuilding = false;
  dotnetBuildFlags = [ "-p:UseSharedCompilation=false" ];
  postInstall = ''
    test -f "$out/lib/otto-dotnet-probe/OttoDotnetProbe.dll"
    test ! -e "$out/lib/otto-dotnet-probe/OttoDotnetProbe"
  '';
  meta.license = lib.licenses.agpl3Plus;
}
