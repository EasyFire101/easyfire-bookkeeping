import { connect, MapStateToProps } from 'react-redux';
import { ApplicationState } from '@/store/reducers';

export interface WithPaymentReceiveDetailProps {
  paymentReceive: unknown;
  paymentReceiveEntries: unknown;
}

export function withPaymentReceiveDetail<Props = unknown>() {
  const mapStateToProps: MapStateToProps<
    WithPaymentReceiveDetailProps,
    Props,
    ApplicationState
  > = () => ({
    paymentReceive: undefined,
    paymentReceiveEntries: undefined,
  });
  return connect(mapStateToProps);
}
