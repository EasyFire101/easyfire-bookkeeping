import { connect, MapStateToProps } from 'react-redux';
import { getCurrencyByCode } from '@/store/currencies/currencies.selector';
import type { ApplicationState } from '@/store/reducers';

interface OwnProps {
  currencyId: string;
}

export interface WithCurrencyDetailProps {
  currency: ReturnType<typeof getCurrencyByCode>;
}

const mapStateToProps: MapStateToProps<
  WithCurrencyDetailProps,
  OwnProps,
  ApplicationState
> = (state, props) => ({
  currency: getCurrencyByCode(state, props),
});

export const withCurrencyDetail = connect(mapStateToProps);
