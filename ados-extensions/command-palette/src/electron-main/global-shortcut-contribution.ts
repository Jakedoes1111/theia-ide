import { injectable } from '@theia/core/shared/inversify';
import { ElectronMainApplicationContribution, ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';

@injectable()
export class GlobalShortcutContribution implements ElectronMainApplicationContribution {

    onStart(application: ElectronMainApplication): void {
        this.registerGlobalShortcut(application);
    }

    protected registerGlobalShortcut(application: ElectronMainApplication): void {
        const electronApp = require('electron').app;
        const globalShortcut = require('electron').globalShortcut;

        // Register global shortcut for command palette
        const shortcut = 'CommandOrControl+Shift+P'; // Ctrl+Shift+P on Windows/Linux, Cmd+Shift+P on Mac

        const ret = globalShortcut.register(shortcut, () => {
            // Send message to frontend to open command palette
            // We'll need to implement IPC communication for this
            console.log('Global shortcut activated: Command Palette');
        });

        if (!ret) {
            console.error('Global shortcut registration failed:', shortcut);
        }

        // Handle app events to stay focused
        electronApp.on('browser-window-focus', () => {
            // Re-register shortcut when window gains focus if needed
        });

        electronApp.on('browser-window-blur', () => {
            // Handle blur if needed
        });
    }

    onStop(application: ElectronMainApplication): void {
        const globalShortcut = require('electron').globalShortcut;
        globalShortcut.unregisterAll();
    }
}
