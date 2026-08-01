import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useHostChooser } from "@/hosts/host-chooser";
import type { Href } from "expo-router";

// Every "New project" entry point â€” the home tile, the sidebar button, the
// command center, and the keyboard shortcut â€” routes through here. It used to
// open a search-only modal; the New project page replaced it, because adding a
// project now means more than naming a folder that already exists (it can
// create the folder, init or clone a repo, and create the remote).
export function useOpenProjectPicker(): () => void {
  const chooseHost = useHostChooser();
  const router = useRouter();

  return useCallback(() => {
    chooseHost({
      title: "Choose host",
      onChooseHost: (serverId) => {
        router.push(`/new-project?serverId=${encodeURIComponent(serverId)}` as Href);
      },
    });
  }, [chooseHost, router]);
}
