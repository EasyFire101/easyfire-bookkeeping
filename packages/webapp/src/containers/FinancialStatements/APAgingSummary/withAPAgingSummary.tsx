import { connect, MapStateToProps } from 'react-redux';
import { APAgingSummaryFilterDrawerSelector } from '@/store/financial-statement/financial-statements.selectors';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithAPAgingSummaryProps {
  APAgingSummaryFilterDrawer: ReturnType<
    typeof APAgingSummaryFilterDrawerSelector
  >;
}

export const withAPAgingSummary = <Props = unknown,>(
  mapState?: MapState<WithAPAgingSummaryProps, Props>,
) => {
  const mapStateToProps: MapStateToProps<
    WithAPAgingSummaryProps | Record<string, unknown>,
    Props,
    ApplicationState
  > = (state, props) => {
    const mapped: WithAPAgingSummaryProps = {
      APAgingSummaryFilterDrawer: APAgingSummaryFilterDrawerSelector(state),
    };
    return mapState ? mapState(mapped, state, props) : mapped;
  };
  return connect(mapStateToProps);
};
