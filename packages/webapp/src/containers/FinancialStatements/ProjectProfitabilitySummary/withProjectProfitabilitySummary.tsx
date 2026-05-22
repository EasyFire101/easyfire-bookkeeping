import { connect } from 'react-redux';
import { getProjectProfitabilitySummaryFilterDrawer } from '@/store/financial-statement/financial-statements.selectors';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithProjectProfitabilitySummaryProps {
  projectProfitabilitySummaryDrawerFilter: ReturnType<typeof getProjectProfitabilitySummaryFilterDrawer>;
}

export const withProjectProfitabilitySummary = <Props,>(mapState?: MapState<WithProjectProfitabilitySummaryProps, Props>) => {
  const mapStateToProps = (state: ApplicationState, props: Props) => {
    const mapped: WithProjectProfitabilitySummaryProps = {
      projectProfitabilitySummaryDrawerFilter:
        getProjectProfitabilitySummaryFilterDrawer(state),
    };
    return mapState ? mapState(mapped, state, props) : mapped;
  };

  return connect(mapStateToProps);
};
