import { connect } from 'react-redux';
import { getTrialBalanceSheetFilterDrawer } from '@/store/financial-statement/financial-statements.selectors';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithTrialBalanceProps {
  trialBalanceDrawerFilter: ReturnType<typeof getTrialBalanceSheetFilterDrawer>;
}

export const withTrialBalance = <Props,>(mapState?: MapState<WithTrialBalanceProps, Props>) => {
  const mapStateToProps = (state: ApplicationState, props: Props) => {
    const mapped: WithTrialBalanceProps = {
      trialBalanceDrawerFilter: getTrialBalanceSheetFilterDrawer(state),
    };
    return mapState ? mapState(mapped, state, props) : mapped;
  };
  return connect(mapStateToProps);
};
