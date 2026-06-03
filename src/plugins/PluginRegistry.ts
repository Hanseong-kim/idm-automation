import type { AppPlugin } from './AppPlugin';

const registry = new Map<string, AppPlugin>();

/** Register a plugin. Case-insensitive name lookup. */
export function registerPlugin(plugin: AppPlugin): void {
    registry.set(plugin.name.toLowerCase(), plugin);
    console.log(`[PluginRegistry] Registered: ${plugin.name} (${plugin.processName})`);
}

/** Retrieve a registered plugin by name. Throws if not found. */
export function getPlugin(name: string): AppPlugin {
    const p = registry.get(name.toLowerCase());
    if (!p) {
        throw new Error(
            `Plugin "${name}" not found. Registered: ${listPlugins().join(', ') || '(none)'}`
        );
    }
    return p;
}

/** Return all registered plugin names. */
export function listPlugins(): string[] {
    return [...registry.keys()];
}
