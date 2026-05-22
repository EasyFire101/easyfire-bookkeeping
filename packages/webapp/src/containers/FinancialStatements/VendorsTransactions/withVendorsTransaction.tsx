import { connect } from 'react-redux';
import { getVendorsTransactionsFilterDrawer } from '@/store/financial-statement/financial-statements.selectors';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithVendorsTransactionProps {
  vendorsTransactionsDrawerFilter: ReturnType<typeof getVendorsTransactionsFilterDrawer>;
}

export const withVendorsTransaction = <Props,>(mapState?: MapState<WithVendorsTransactionProps, Props>) => {
  const mapStateToProps = (state: ApplicationState, props: Props) => {
    const mapped: WithVendorsTransactionProps = {
      vendorsTransactionsDrawerFilter: getVendorsTransactionsFilterDrawer(
        state,
      ),
    };
    return mapState ? mapState(mapped, state, props) : mapped;
  };
  return connect(mapStateToProps);
};
