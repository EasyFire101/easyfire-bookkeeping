import { connect } from 'react-redux';
import { getInventoryValuationFilterDrawer } from '@/store/financial-statement/financial-statements.selectors';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithInventoryValuationProps {
  inventoryValuationDrawerFilter: ReturnType<typeof getInventoryValuationFilterDrawer>;
}

export const withInventoryValuation = <Props,>(mapState?: MapState<WithInventoryValuationProps, Props>) => {
  const mapStateToProps = (state: ApplicationState, props: Props) => {
    const mapped: WithInventoryValuationProps = {
      inventoryValuationDrawerFilter: getInventoryValuationFilterDrawer(state),
    };
    return mapState ? mapState(mapped, state, props) : mapped;
  };
  return connect(mapStateToProps);
};
