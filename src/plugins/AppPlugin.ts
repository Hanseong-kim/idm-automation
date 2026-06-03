/**
 * AppPlugin — interface every application plugin must implement.
 * The plugin architecture allows the automation framework to target
 * any desktop application, not just IDM.
 */
export interface AppPlugin {
    /** Human-readable plugin name, e.g. "IDM", "Notepad", "Chrome" */
    name: string;

    /** Executable process name, e.g. "IDMan.exe" */
    processName: string;

    /** Appium capabilities needed to attach to this application */
    capabilities: object;

    actions: {
        /** Return a list of items the application is currently managing */
        list(): Promise<unknown[]>;

        /**
         * Execute a named command on a target item.
         * @param command  Verb understood by the plugin (pause, resume, delete…)
         * @param target   Filename substring, index token, or status keyword
         */
        execute(command: string, target: string): Promise<void>;
    };
}
