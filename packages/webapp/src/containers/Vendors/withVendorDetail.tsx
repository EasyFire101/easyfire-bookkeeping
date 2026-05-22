import { connect, MapStateToProps } from 'react-redux';
import type { ApplicationState } from '@/store/reducers';

interface OwnProps {
  vendorId?: number | string;
}

export interface WithVendorDetailProps {
  vendor: unknown;
}

export const withVendorDetail = () => {
  const mapStateToProps: MapStateToProps<
    WithVendorDetailProps,
    OwnProps,
    ApplicationState
  > = (_state, _props) => ({
    vendor: undefined,
  });
  return connect(mapStateToProps);
};
