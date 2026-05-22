import { connect, MapStateToProps } from 'react-redux';
import { getCurrenciesList } from '@/store/currencies/currencies.selector';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithCurrenciesProps {
  currencies: ApplicationState['currencies']['data'];
  currenciesList: ReturnType<typeof getCurrenciesList>;
  currenciesLoading: boolean;
}

export function withCurrencies<Props>(mapState?: MapState<WithCurrenciesProps, Props>) {
  const mapStateToProps: MapStateToProps<
    WithCurrenciesProps,
    Props,
    ApplicationState
  > = (state, props) => {
    const mapped: WithCurrenciesProps = {
      currencies: state.currencies.data,
      currenciesList: getCurrenciesList(state),
      currenciesLoading: state.currencies.loading,
    };
    return mapState ? (mapState(mapped, state, props) as WithCurrenciesProps) : mapped;
  };
  return connect(mapStateToProps);
}
