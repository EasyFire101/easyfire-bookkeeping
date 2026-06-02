import { connect, MapStateToProps } from 'react-redux';
import { getCurrentOrganizationFactory } from '@/store/authentication/authentication.selectors';
import { ApplicationState } from '@/store/reducers';

export interface OrganizationStore {
  id: number;
  organization_id: string;
  seeded_at: string;
  initialized_at: string;
  built_at: string;
  database_batch?: string | null;
  is_ready: boolean;
  is_build_running: boolean;
  is_upgrade_running: boolean;
  is_congrats?: boolean;
  subscriptions?: unknown[];

  // Flattened from metadata
  name: string;
  industry?: string;
  location: string;
  base_currency: string;
  language: string;
  timezone: string;
  date_format: string;
  fiscal_year: string;
  tax_number?: string | null;
  primary_color?: string | null;
  logo_key?: string | null;
  logo_uri?: string | null;
  address?: string | null;
}

export interface WithCurrentOrganizationProps {
  organizationTenantId: string | null;
  organizationId: string | null;
  organization: OrganizationStore;
}

export function withCurrentOrganization<
  TInjected extends object = WithCurrentOrganizationProps,
  TOwnProps = {},
>(
  mapState?: (
    storeProps: WithCurrentOrganizationProps,
    state: ApplicationState,
    ownProps: TOwnProps,
  ) => TInjected,
) {
  const getCurrentOrganization = getCurrentOrganizationFactory();

  const mapStateToProps: MapStateToProps<
    TInjected,
    TOwnProps,
    ApplicationState
  > = (state, props) => {
    const mapped: WithCurrentOrganizationProps = {
      organizationTenantId: state.authentication.organizationId,
      organizationId: state.authentication.organizationId,
      organization: getCurrentOrganization(state) as OrganizationStore,
    };
    return (mapState ? mapState(mapped, state, props) : mapped) as TInjected;
  };
  return connect(mapStateToProps);
}
