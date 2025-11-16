import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandPaletteContribution } from './command-palette-contribution';
import { QuickOpenFuzzySearchContribution } from './quick-open-fuzzy-search-contribution';

export default new ContainerModule(bind => {
    bind(CommandPaletteContribution).toSelf().inSingletonScope();
    bind(QuickOpenFuzzySearchContribution).toSelf().inSingletonScope();
});
