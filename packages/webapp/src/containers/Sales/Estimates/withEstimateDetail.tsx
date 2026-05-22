import { connect, MapStateToProps } from 'react-redux';
import { ApplicationState } from '@/store/reducers';

export interface WithEstimateDetailProps {
  estimate: unknown;
}

export function withEstimateDetail<Props = unknown>() {
  const mapStateToProps: MapStateToProps<
    WithEstimateDetailProps,
    Props,
    ApplicationState
  > = () => ({
    estimate: undefined,
  });
  return connect(mapStateToProps);
}
