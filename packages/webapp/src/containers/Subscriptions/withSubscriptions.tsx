import { MapStateToProps, connect } from 'react-redux';
import {
  isSubscriptionOnTrialFactory,
  isSubscriptionInactiveFactory,
  isSubscriptionActiveFactory,
} from '@/store/subscription/subscription.selectors';
import type { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithSubscriptionsProps {
  isSubscriptionOnTrial: ReturnType<
    ReturnType<typeof isSubscriptionOnTrialFactory>
  >;
  isSubscriptionInactive: ReturnType<
    ReturnType<typeof isSubscriptionInactiveFactory>
  >;
  isSubscriptionActive: ReturnType<
    ReturnType<typeof isSubscriptionActiveFactory>
  >;
}

export const withSubscriptions = <Props = unknown>(
  mapState?: MapState<WithSubscriptionsProps, Props>,
  slug?: string,
) => {
  const isSubscriptionOnTrial = isSubscriptionOnTrialFactory(slug);
  const isSubscriptionInactive = isSubscriptionInactiveFactory(slug);
  const isSubscriptionActive = isSubscriptionActiveFactory(slug);

  const mapStateToProps: MapStateToProps<
    WithSubscriptionsProps,
    Props,
    ApplicationState
  > = (state, props) => {
    const mapped: WithSubscriptionsProps = {
      isSubscriptionOnTrial: isSubscriptionOnTrial(state, props as never),
      isSubscriptionInactive: isSubscriptionInactive(state, props as never),
      isSubscriptionActive: isSubscriptionActive(state, props as never),
    };
    return mapState
      ? (mapState(mapped, state, props) as WithSubscriptionsProps)
      : mapped;
  };
  return connect(mapStateToProps);
};
