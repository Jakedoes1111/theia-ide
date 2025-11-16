import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging/proxy-factory';
import { KnowledgeService } from '../common/knowledge-service';
import { KnowledgeServiceImpl } from './knowledge-service-impl';
import { KnowledgeServicePath } from '../common/knowledge-service-path';

export default new ContainerModule(bind => {
    bind(KnowledgeServiceImpl).toSelf().inSingletonScope();
    bind(KnowledgeService).toService(KnowledgeServiceImpl);

    bind<ConnectionHandler>(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(KnowledgeServicePath, () =>
            context.container.get(KnowledgeService)
        )
    ).inSingletonScope();
});
