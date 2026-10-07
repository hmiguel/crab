const isMacAgent = (userAgent: string) => /Mac/.test(userAgent);

/** Label for a Mod-key shortcut as the user's platform shows it (⌘ on macOS). */
export function shortcutLabel(key: string, userAgent: string = navigator.userAgent): string {
  return isMacAgent(userAgent) ? `⌘${key}` : `Ctrl+${key}`;
}
