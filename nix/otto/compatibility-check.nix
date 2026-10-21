{ flake }:
let
  makeSystem = settings: flake.inputs.nixpkgs.lib.nixosSystem {
    system = "x86_64-linux";
    modules = [
      flake.nixosModules.otto
      {
        services.otto = { enable = true; } // settings;
        system.stateVersion = "24.11";
      }
    ];
  };
  defaults = (makeSystem { }).config;
  existing = (makeSystem {
    user = "existing-user";
    group = "existing-group";
    dataDir = "/srv/existing-otto";
    port = 7111;
    relay.enable = false;
  }).config;
in
assert defaults.services.otto.user == "otto";
assert defaults.services.otto.group == "otto";
assert defaults.services.otto.dataDir == "/var/lib/otto";
assert defaults.services.otto.port == 6868;
assert defaults.systemd.services.otto.environment.OTTO_HOME == "/var/lib/otto";
assert defaults.systemd.services.otto.serviceConfig.ExecStart == "${defaults.services.otto.package}/bin/otto-server";
assert existing.systemd.services.otto.serviceConfig.User == "existing-user";
assert existing.systemd.services.otto.serviceConfig.Group == "existing-group";
assert existing.systemd.services.otto.environment.OTTO_HOME == "/srv/existing-otto";
assert existing.systemd.services.otto.environment.OTTO_LISTEN == "127.0.0.1:7111";
assert existing.systemd.services.otto.serviceConfig.ExecStart == "${existing.services.otto.package}/bin/otto-server --no-relay";
true
