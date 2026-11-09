import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { makeSettings } from "./client/settings";
import { installSwitcher } from "./client/switcher";

export default function contribute(client: PluginClientContext) {
  // Ctrl+Tab only reaches the page in the desktop app (and the web app outside a browser tab).
  if (Platform.OS !== "web") return () => {};
  const switcher = installSwitcher(client.paseo);
  // Go back / Go forward exist only while back and forward is on (a setting).
  let removeHistoryCommands: Array<() => void> = [];
  const syncHistoryCommands = (enabled: boolean) => {
    for (const remove of removeHistoryCommands) remove();
    removeHistoryCommands = enabled
      ? [
          client.addCommandCenterItem({
            id: "history-back",
            title: "Go back",
            icon: "ArrowLeft",
            keywords: ["history", "navigation", "previous"],
            context: "global",
            onSelect() {
              switcher.history.back();
            },
          }),
          client.addCommandCenterItem({
            id: "history-forward",
            title: "Go forward",
            icon: "ArrowRight",
            keywords: ["history", "navigation", "next"],
            context: "global",
            onSelect() {
              switcher.history.forward();
            },
          }),
        ]
      : [];
  };
  syncHistoryCommands(switcher.history.getEnabled());
  const stopSyncing = switcher.history.onEnabledChange(syncHistoryCommands);
  const removers = [
    client.addSettingsScreen({
      id: "switcher",
      title: "Workspace Switcher",
      icon: "GalleryHorizontal",
      Component: makeSettings(switcher),
    }),
    client.addCommandCenterItem({
      id: "switch-workspace",
      title: "Switch workspace (Ctrl+Tab)",
      icon: "GalleryHorizontal",
      keywords: ["workspace", "switch", "recent", "tab", "arc"],
      context: "global",
      onSelect() {
        switcher.open();
      },
    }),
    client.addCommandCenterItem({
      id: "switcher-settings",
      title: "Workspace Switcher: settings",
      icon: "Settings",
      keywords: ["workspace", "switcher", "limit", "recent"],
      context: "global",
      onSelect({ openSettings }) {
        openSettings("switcher");
      },
    }),
  ];
  return () => {
    stopSyncing();
    for (const remove of [...removers, ...removeHistoryCommands]) remove();
    switcher.dispose();
  };
}
