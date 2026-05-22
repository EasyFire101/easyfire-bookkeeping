import { connect, MapStateToProps } from 'react-redux';
import { ApplicationState } from '@/store/reducers';

export interface WithItemCategoryDetailProps {
  itemCategoryDetail: unknown;
}

export function withItemCategoryDetail<Props = unknown>() {
  const mapStateToProps: MapStateToProps<
    WithItemCategoryDetailProps,
    Props,
    ApplicationState
  > = () => ({
    itemCategoryDetail: undefined,
  });
  return connect(mapStateToProps);
}
