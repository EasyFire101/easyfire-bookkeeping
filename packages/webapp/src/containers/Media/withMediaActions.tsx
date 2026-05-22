import { ComponentType } from 'react';
import { AnyAction } from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import { connect } from 'react-redux';
import { submitMedia, deleteMedia } from '@/store/media/media.actions';
import type { RootState } from '@/store/reducers';

export interface WithMediaActionsProps {
  requestSubmitMedia: (form: FormData, config: unknown) => unknown;
  requestDeleteMedia: (ids: Array<number | string>) => unknown;
}

export const mapDispatchToProps = (
  dispatch: ThunkDispatch<RootState, unknown, AnyAction>,
): WithMediaActionsProps => ({
  requestSubmitMedia: (form, config) => dispatch(submitMedia({ form, config })),
  requestDeleteMedia: (ids) => dispatch(deleteMedia({ ids })),
});

export function withMediaActions<P>(
  WrappedComponent: ComponentType<P>,
): ComponentType<Omit<P, keyof WithMediaActionsProps>> {
  const Connected = connect(null, mapDispatchToProps)(
    WrappedComponent as ComponentType<any>,
  );
  return Connected as unknown as ComponentType<Omit<P, keyof WithMediaActionsProps>>;
}
