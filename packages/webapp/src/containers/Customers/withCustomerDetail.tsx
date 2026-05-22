import { connect, MapStateToProps } from 'react-redux';
import type { ApplicationState } from '@/store/reducers';

interface OwnProps {
  customerId: number | string;
}

export interface WithCustomerDetailProps {
  customer: unknown;
}

const mapStateToProps: MapStateToProps<
  WithCustomerDetailProps,
  OwnProps,
  ApplicationState
> = (_state, _props) => ({
  customer: undefined,
});

export const withCustomerDetail = connect(mapStateToProps);
