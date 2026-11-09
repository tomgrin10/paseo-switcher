import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useState, type ComponentType } from "react";
import { MAX_LIMIT, MIN_LIMIT, type Layout } from "./model";
import type { Switcher } from "./switcher";
import type { HistoryShortcut } from "./history";

const OPTIONS = Array.from({ length: MAX_LIMIT - MIN_LIMIT + 1 }, (_, i) => {
  const value = String(MIN_LIMIT + i);
  return { label: value, value };
});

const LAYOUTS: Array<{ label: string; value: Layout }> = [
  { label: "List", value: "list" },
  { label: "Thumbnails", value: "strip" },
];

export function makeSettings(switcher: Switcher): ComponentType<PluginSurfaceProps> {
  return function SwitcherSettings() {
    const [limit, setLimit] = useState(String(switcher.getLimit()));
    const [layout, setLayout] = useState<Layout>(switcher.getLayout());
    const [shortcut, setShortcut] = useState(switcher.history.getShortcut());
    const [buttons, setButtons] = useState(switcher.history.getButtons());
    const [enabled, setEnabled] = useState(switcher.history.getEnabled());
    return (
      <>
        <SettingsSection title="Switcher">
          <SettingsCard>
            <SettingsSelect
              label="Layout"
              hint="List: full names, branches, pull requests and agent status. Thumbnails: a preview of each workspace, refreshed in idle time."
              value={layout}
              options={LAYOUTS}
              onValueChange={(value) => {
                switcher.setLayout(value as Layout);
                setLayout(switcher.getLayout());
              }}
            />
            <SettingsSelect
              label="Workspaces shown"
              hint="How many recent workspaces Ctrl+Tab shows. Type while it is open to search all of them."
              value={limit}
              options={OPTIONS}
              onValueChange={(value) => {
                switcher.setLimit(Number(value));
                setLimit(String(switcher.getLimit()));
              }}
            />
          </SettingsCard>
        </SettingsSection>
        <SettingsSection title="Navigation history">
          <SettingsCard>
            <SettingsSwitch
              label="Back and forward"
              hint="Retrace workspaces, sessions, tabs, plugin pages and Settings with the arrows, shortcuts, mouse side buttons or Go back / Go forward commands. History starts fresh when the app reloads."
              value={enabled}
              onValueChange={(value) => {
                switcher.history.setEnabled(value);
                setEnabled(switcher.history.getEnabled());
              }}
            />
            {enabled ? (
              <SettingsSwitch
                label="Arrows in the sidebar"
                hint="Shortcuts, mouse side buttons and commands keep working while the arrows are hidden."
                value={buttons}
                onValueChange={(value) => {
                  switcher.history.setButtons(value);
                  setButtons(value);
                }}
              />
            ) : null}
            {enabled ? (
              <SettingsSelect
                label="Back / forward shortcuts"
                hint="Mouse side buttons work with every choice, including None."
                value={shortcut}
                options={[
                  { label: "Alt+Left / Alt+Right", value: "alt-arrows" },
                  { label: "Ctrl+- / Ctrl+Shift+-", value: "ctrl-minus" },
                  { label: "Cmd+[ / Cmd+]", value: "cmd-brackets" },
                  { label: "None", value: "none" },
                ]}
                onValueChange={(value) => {
                  switcher.history.setShortcut(value as HistoryShortcut);
                  setShortcut(switcher.history.getShortcut());
                }}
              />
            ) : null}
          </SettingsCard>
        </SettingsSection>
      </>
    );
  };
}
