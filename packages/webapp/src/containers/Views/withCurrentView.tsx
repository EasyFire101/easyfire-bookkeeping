import { connect, MapStateToProps } from 'react-redux';
import { ApplicationState } from '@/store/reducers';

export interface WithCurrentViewProps {
  currentViewId: string | number | undefined;
}

interface WithCurrentViewOwnProps {
  match: { params: { custom_view_id: string | number | undefined } };
}

const mapStateToProps: MapStateToProps<
  WithCurrentViewProps,
  WithCurrentViewOwnProps,
  ApplicationState
> = (_state, props) => ({
  currentViewId: props.match.params.custom_view_id,
});

export const withCurrentView = connect(mapStateToProps);
