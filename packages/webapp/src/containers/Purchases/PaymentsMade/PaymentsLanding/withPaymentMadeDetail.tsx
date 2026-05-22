import { connect, MapStateToProps } from 'react-redux';
import { getPaymentMadeByIdFactory } from '@/store/payment-mades/payment-mades.selector';
import { ApplicationState } from '@/store/reducers';

export interface WithPaymentMadeDetailProps {
  paymentMade: ReturnType<ReturnType<typeof getPaymentMadeByIdFactory>>;
}

export function withPaymentMadeDetail<Props = unknown>() {
  const getPaymentMadeById = getPaymentMadeByIdFactory();

  const mapStateToProps: MapStateToProps<
    WithPaymentMadeDetailProps,
    Props,
    ApplicationState
  > = (state, props) => ({
    paymentMade: getPaymentMadeById(state, props as never),
  });
  return connect(mapStateToProps);
}
