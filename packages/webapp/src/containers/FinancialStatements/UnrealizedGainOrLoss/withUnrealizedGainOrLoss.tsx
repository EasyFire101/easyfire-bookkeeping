import { connect } from 'react-redux';
import { getUnrealizedGainOrLossFilterDrawer } from '@/store/financial-statement/financial-statements.selectors';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithUnrealizedGainOrLossProps {
  unrealizedGainOrLossDrawerFilter: ReturnType<typeof getUnrealizedGainOrLossFilterDrawer>;
}

export const withUnrealizedGainOrLoss = <Props,>(mapState?: MapState<WithUnrealizedGainOrLossProps, Props>) => {
  const mapStateToProps = (state: ApplicationState, props: Props) => {
    const mapped: WithUnrealizedGainOrLossProps = {
      unrealizedGainOrLossDrawerFilter:
        getUnrealizedGainOrLossFilterDrawer(state),
    };
    return mapState ? mapState(mapped, state, props) : mapped;
  };
  return connect(mapStateToProps);
};
