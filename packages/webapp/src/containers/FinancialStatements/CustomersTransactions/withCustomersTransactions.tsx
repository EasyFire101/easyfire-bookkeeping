import { connect, MapStateToProps } from 'react-redux';
import { getCustomersTransactionsFilterDrawer } from '@/store/financial-statement/financial-statements.selectors';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithCustomersTransactionsProps {
  customersTransactionsDrawerFilter: ReturnType<
    typeof getCustomersTransactionsFilterDrawer
  >;
}

export const withCustomersTransactions = <Props = unknown,>(
  mapState?: MapState<WithCustomersTransactionsProps, Props>,
) => {
  const mapStateToProps: MapStateToProps<
    WithCustomersTransactionsProps | Record<string, unknown>,
    Props,
    ApplicationState
  > = (state, props) => {
    const mapped: WithCustomersTransactionsProps = {
      customersTransactionsDrawerFilter:
        getCustomersTransactionsFilterDrawer(state),
    };
    return mapState ? mapState(mapped, state, props) : mapped;
  };
  return connect(mapStateToProps);
};
