import { connect, MapStateToProps } from 'react-redux';
import {
  getOrganizationByIdFactory,
  isOrganizationReadyFactory,
  isOrganizationBuiltFactory,
  isOrganizationSubscribedFactory,
  isOrganizationCongratsFactory,
  isOrganizationBuildRunningFactory,
} from '@/store/organizations/organizations.selectors';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithOrganizationProps {
  organization: ReturnType<ReturnType<typeof getOrganizationByIdFactory>>;
  isOrganizationReady: ReturnType<ReturnType<typeof isOrganizationReadyFactory>>;
  isOrganizationInitialized: ReturnType<ReturnType<typeof isOrganizationBuiltFactory>>;
  isOrganizationSubscribed: ReturnType<ReturnType<typeof isOrganizationSubscribedFactory>>;
  isOrganizationSetupCompleted: ReturnType<ReturnType<typeof isOrganizationCongratsFactory>>;
  isOrganizationBuildRunning: ReturnType<ReturnType<typeof isOrganizationBuildRunningFactory>>;
}

export function withOrganization<Props>(mapState?: MapState<WithOrganizationProps, Props>) {
  const getOrganizationById = getOrganizationByIdFactory();
  const isOrganizationReady = isOrganizationReadyFactory();
  const isOrganizationBuilt = isOrganizationBuiltFactory();
  const isOrganizationSubscribed = isOrganizationSubscribedFactory();
  const isOrganizationCongrats = isOrganizationCongratsFactory();
  const isOrganizationBuildRunning = isOrganizationBuildRunningFactory();

  const mapStateToProps: MapStateToProps<
    WithOrganizationProps,
    Props,
    ApplicationState
  > = (state, props) => {
    const mapped: WithOrganizationProps = {
      organization: getOrganizationById(state, props as any),
      isOrganizationReady: isOrganizationReady(state, props as any),
      isOrganizationInitialized: isOrganizationBuilt(state, props as any),
      isOrganizationSubscribed: isOrganizationSubscribed(state, props as any),
      isOrganizationSetupCompleted: isOrganizationCongrats(state, props as any),
      isOrganizationBuildRunning: isOrganizationBuildRunning(state, props as any),
    };
    return mapState ? (mapState(mapped, state, props) as WithOrganizationProps) : mapped;
  };
  return connect(mapStateToProps);
}
