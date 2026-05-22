import { MapStateToProps, connect } from 'react-redux';
import {
  isSubscriptionsInactiveFactory,
  isSubscriptionsActiveFactory,
} from '@/store/subscription/subscription.selectors';
import type { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithSubscriptionssProps {
  isSubscriptionsInactive: ReturnType<
    ReturnType<typeof isSubscriptionsInactiveFactory>
  >;
  isSubscriptionsActive: ReturnType<
    ReturnType<typeof isSubscriptionsActiveFactory>
  >;
}

export const withSubscriptionss = <Props = unknown>(
  mapState?: MapState<WithSubscriptionssProps, Props>,
) => {
  const isSubscriptionsInactive = isSubscriptionsInactiveFactory();
  const isSubscriptionsActive = isSubscriptionsActiveFactory();

  const mapStateToProps: MapStateToProps<
    WithSubscriptionssProps,
    Props,
    ApplicationState
  > = (state, props) => {
    const mapped: WithSubscriptionssProps = {
      isSubscriptionsInactive: isSubscriptionsInactive(state, props as never),
      isSubscriptionsActive: isSubscriptionsActive(state, props as never),
    };
    return mapState
      ? (mapState(mapped, state, props) as WithSubscriptionssProps)
      : mapped;
  };
  return connect(mapStateToProps);
};
