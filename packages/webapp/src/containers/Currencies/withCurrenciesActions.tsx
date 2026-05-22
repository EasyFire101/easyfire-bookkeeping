import { ComponentType } from 'react';
import { AnyAction } from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import { connect } from 'react-redux';
import {
  fetchCurrencies,
  submitCurrencies,
  deleteCurrency,
  editCurrency,
} from '@/store/currencies/currencies.actions';
import type { RootState } from '@/store/reducers';

export interface WithCurrenciesActionsProps {
  requestFetchCurrencies: () => unknown;
  requestSubmitCurrencies: (form: unknown) => unknown;
  requestEditCurrency: (id: number | string, form: unknown) => unknown;
  requestDeleteCurrency: (currency_code: string) => unknown;
}

export const mapDispatchToProps = (
  dispatch: ThunkDispatch<RootState, unknown, AnyAction>,
): WithCurrenciesActionsProps => ({
  requestFetchCurrencies: () => dispatch(fetchCurrencies()),
  requestSubmitCurrencies: (form) => dispatch(submitCurrencies({ form })),
  requestEditCurrency: (id, form) => dispatch(editCurrency({ id, form })),
  requestDeleteCurrency: (currency_code) =>
    dispatch(deleteCurrency({ currency_code })),
});

export function withCurrenciesActions<P>(
  WrappedComponent: ComponentType<P>,
): ComponentType<Omit<P, keyof WithCurrenciesActionsProps>> {
  const Connected = connect(null, mapDispatchToProps)(
    WrappedComponent as ComponentType<any>,
  );
  return Connected as unknown as ComponentType<
    Omit<P, keyof WithCurrenciesActionsProps>
  >;
}
