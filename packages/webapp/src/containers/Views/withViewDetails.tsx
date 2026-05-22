import { connect, MapStateToProps } from 'react-redux';
import { ApplicationState } from '@/store/reducers';
import {
  getViewItemFactory,
  getViewMetaFactory,
} from '@/store/custom-views/custom-views.selectors';

export interface WithViewDetailsProps {
  viewMeta: ReturnType<ReturnType<typeof getViewMetaFactory>>;
  viewItem: ReturnType<ReturnType<typeof getViewItemFactory>>;
}

interface ViewDetailsOwnProps {
  viewId: string | number;
}

export const withViewDetails = <Props extends ViewDetailsOwnProps = ViewDetailsOwnProps>() => {
  const getViewItem = getViewItemFactory();
  const getViewMeta = getViewMetaFactory();

  const mapStateToProps: MapStateToProps<
    WithViewDetailsProps,
    Props,
    ApplicationState
  > = (state, props) => ({
    viewMeta: getViewMeta(state, props),
    viewItem: getViewItem(state, props),
  });
  return connect(mapStateToProps);
};
