import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser';

@injectable()
export class CommandPaletteContribution implements FrontendApplicationContribution {

    onStart(app: FrontendApplication): void {
        // Placeholder for frontend command palette enhancements
        // The global shortcut is handled in the electron main process
    }
}
