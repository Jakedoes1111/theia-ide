import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { GlobalShortcutContribution } from './global-shortcut-contribution';

export default new ContainerModule(bind => {
    bind(GlobalShortcutContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(GlobalShortcutContribution);
});
