import { connect, MapStateToProps } from 'react-redux';
import { getCashFlowStatementFilterDrawer } from '@/store/financial-statement/financial-statements.selectors';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithCashFlowStatementProps {
  cashFlowStatementDrawerFilter: ReturnType<
    typeof getCashFlowStatementFilterDrawer
  >;
}

export const withCashFlowStatement = <Props = unknown,>(
  mapState?: MapState<WithCashFlowStatementProps, Props>,
) => {
  const mapStateToProps: MapStateToProps<
    WithCashFlowStatementProps | Record<string, unknown>,
    Props,
    ApplicationState
  > = (state, props) => {
    const mapped: WithCashFlowStatementProps = {
      cashFlowStatementDrawerFilter: getCashFlowStatementFilterDrawer(state),
    };
    return mapState ? mapState(mapped, state, props) : mapped;
  };
  return connect(mapStateToProps);
};
