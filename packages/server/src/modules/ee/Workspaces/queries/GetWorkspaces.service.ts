import { Inject, Injectable } from '@nestjs/common';
import { UserTenant } from '@/modules/System/models/UserTenant.model';
import { SystemUser } from '@/modules/System/models/SystemUser';
import { WorkspaceDto } from '../dtos/WorkspaceResponse.dto';
import { WorkspaceTransformer } from '../transformers/WorkspaceTransformer';
import { TransformerInjectable } from '@/modules/Transformer/TransformerInjectable.service';

@Injectable()
export class GetWorkspacesService {
  constructor(
    @Inject(UserTenant.name)
    private readonly userTenantModel: typeof UserTenant,

    @Inject(SystemUser.name)
    private readonly systemUserModel: typeof SystemUser,

    private readonly transformer: TransformerInjectable,
  ) {}

  /**
   * Returns all workspaces (organizations) the given user belongs to,
   * including their metadata, build status, and financial data.
   * @param includeInactive - Whether to include inactive workspaces (default: false)
   * @param currentOrganizationId - Current org ID to sort first (only when includeInactive is false)
   */
  async getWorkspaces(
    userId: number,
    includeInactive: boolean = false,
    currentOrganizationId?: string,
  ): Promise<WorkspaceDto[]> {
    const memberships = await this.userTenantModel
      .query()
      .where('userId', userId)
      .withGraphFetched('tenant.metadata');

    // Get user's default tenant ID
    const user = await this.systemUserModel
      .query()
      .select('defaultTenantId')
      .where('id', userId)
      .first();

    const defaultTenantId = user?.defaultTenantId;

    return this.transformer.transform(
      memberships,
      new WorkspaceTransformer(),
      {
        defaultTenantId,
        includeInactive,
        currentOrganizationId,
      },
    );
  }
}
