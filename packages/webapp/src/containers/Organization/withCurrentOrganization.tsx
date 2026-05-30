import { connect, MapStateToProps } from 'react-redux';
import type { Organization } from '@bigcapital/sdk-ts';
import { getCurrentOrganizationFactory } from '@/store/authentication/authentication.selectors';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithCurrentOrganizationProps {
  organizationTenantId: string | null;
  organizationId: string | null;
  organization: Organization;
}

export function withCurrentOrganization<Props>(mapState?: MapState<WithCurrentOrganizationProps, Props>) {
  const getCurrentOrganization = getCurrentOrganizationFactory();

  const mapStateToProps: MapStateToProps<
    WithCurrentOrganizationProps,
    Props,
    ApplicationState
  > = (state, props) => {
    const mapped: WithCurrentOrganizationProps = {
      organizationTenantId: state.authentication.organizationId,
      organizationId: state.authentication.organizationId,
      organization: getCurrentOrganization(state) as Organization,
    };
    return mapState ? (mapState(mapped, state, props) as WithCurrentOrganizationProps) : mapped;
  };
  return connect(mapStateToProps);
}
