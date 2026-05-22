import { connect } from 'react-redux';
import { getDashboardFeaturesSelector } from '@/store/dashboard/dashboard.selectors';
import { ApplicationState } from '@/store/reducers';

type MapState<Props> = (
  mapped: Record<string, unknown>,
  state: ApplicationState,
  props: Props,
) => Record<string, unknown>;

export const withFeatureCan = <Props extends { feature?: string }>(
  mapState?: MapState<Props>,
) => {
  const featuresSelector = getDashboardFeaturesSelector();

  const mapStateToProps = (state: ApplicationState, props: Props) => {
    const features = featuresSelector(state) as Record<string, unknown>;

    const mapped = {
      isFeatureCan: !!(props.feature && features[props.feature]),
      features,
    };
    return mapState ? mapState(mapped, state, props) : mapped;
  };
  return connect(mapStateToProps);
};
