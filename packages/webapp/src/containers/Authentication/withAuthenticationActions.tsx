import { ComponentType } from 'react';
import { Dispatch } from 'redux';
import { connect } from 'react-redux';

export interface WithAuthenticationActionsProps {
  // Reserved for future authentication actions (login/logout/register/etc.).
}

export const mapDispatchToProps = (
  _dispatch: Dispatch,
): WithAuthenticationActionsProps => ({});

export function withAuthenticationActions<P>(
  WrappedComponent: ComponentType<P>,
): ComponentType<Omit<P, keyof WithAuthenticationActionsProps>> {
  const Connected = connect(null, mapDispatchToProps)(
    WrappedComponent as ComponentType<any>,
  );
  return Connected as unknown as ComponentType<
    Omit<P, keyof WithAuthenticationActionsProps>
  >;
}
