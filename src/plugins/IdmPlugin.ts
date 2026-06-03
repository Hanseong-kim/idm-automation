import type { AppPlugin } from './AppPlugin';
import { IdmPage } from '../../test/pageobjects/IdmPage';
import type { DownloadItem } from '../agent/types';

/**
 * IDM plugin — wraps IdmPage.ts behind the AppPlugin interface.
 * Any other app plugin follows the same pattern without touching IdmPage.
 */
export class IdmPlugin implements AppPlugin {
    readonly name        = 'IDM';
    readonly processName = 'IDMan.exe';
    readonly capabilities = {
        platformName:              'Windows',
        'appium:automationName':   'Windows',
        'appium:app':              'C:\\Program Files (x86)\\Internet Download Manager\\IDMan.exe',
        'appium:appWorkingDir':    'C:\\Program Files (x86)\\Internet Download Manager',
        'appium:newCommandTimeout': 3600,
    };

    private readonly page = new IdmPage();

    readonly actions = {
        list: (): Promise<DownloadItem[]> => this.page.extractDownloads(),

        execute: async (command: string, target: string): Promise<void> => {
            const downloads = await this.page.extractDownloads();
            const item = downloads.find(d =>
                d.fileName.toLowerCase().includes(target.toLowerCase())
            );
            if (!item) throw new Error(`No download matching "${target}"`);

            switch (command.toLowerCase()) {
                case 'pause':  await this.page.pauseDownload(item);  return;
                case 'resume': await this.page.resumeDownload(item); return;
                case 'start':  await this.page.startDownload(item);  return;
                case 'delete': await this.page.deleteDownload(item); return;
                default:
                    throw new Error(`Unknown command "${command}" for IDM plugin`);
            }
        },
    };
}
